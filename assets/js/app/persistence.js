/* ── API layer with IndexedDB fallback ── */
function isMutationRequest(method) {
  return method !== "GET" && method !== "HEAD";
}

async function ensureServerSession() {
  if (serverSessionToken) return serverSessionToken;
  const response = await fetch("/api/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("无法建立本地安全会话");
  const payload = await response.json();
  if (!payload?.token) throw new Error("本地安全会话无效");
  serverSessionToken = payload.token;
  return serverSessionToken;
}

async function serverApi(url, opt = {}) {
  const method = (opt.method || "GET").toUpperCase();
  const mutation = isMutationRequest(method);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = { Accept: "application/json", ...(opt.headers || {}) };
    if (opt.body !== undefined && !headers["Content-Type"])
      headers["Content-Type"] = "application/json";
    if (mutation) headers["X-MYP-Session"] = await ensureServerSession();
    if (
      serverRevision &&
      (url === "/api/prompts" || url === "/api/transaction") &&
      mutation
    ) {
      headers["X-MYP-Revision"] = serverRevision;
    }

    const response = await fetch(url, {
      ...opt,
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 403 && mutation && attempt === 0) {
      serverSessionToken = "";
      continue;
    }

    const nextRevision = response.headers.get("X-MYP-Revision");
    if (nextRevision) serverRevision = nextRevision;
    if (!response.ok) {
      let message = "请求失败";
      try {
        message = (await response.json()).error || message;
      } catch {
        /* Keep the default message for non-JSON errors. */
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    serverConnectionConfirmed = true;
    const payload = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : await response.text();
    if (payload?.revision) serverRevision = payload.revision;
    return payload;
  }

  throw new Error("本地安全会话恢复失败");
}

function createServerClientId() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

let serverClientId = createServerClientId();
let serverClientRegistered = false;
let serverClientClosing = false;
let serverInstanceId = "";

async function registerServerClient() {
  if (!serverMode || serverClientClosing) return false;
  const result = await serverApi("/api/client/open", {
    method: "POST",
    body: JSON.stringify({ clientId: serverClientId }),
  });
  serverClientRegistered = result?.active === true;
  return serverClientRegistered;
}

function closeServerClient() {
  if (
    !serverMode ||
    !serverClientRegistered ||
    !serverSessionToken ||
    serverClientClosing
  )
    return;

  serverClientClosing = true;
  serverClientRegistered = false;
  const body = JSON.stringify({
    clientId: serverClientId,
    token: serverSessionToken,
  });
  const payload = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.("/api/client/close", payload)) return;
  fetch("/api/client/close", {
    method: "POST",
    body,
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

async function resumeServerClient() {
  if (serverClientClosing) {
    serverClientId = createServerClientId();
    serverClientClosing = false;
    serverClientRegistered = false;
  }
  return refreshServerConnection();
}

async function refreshServerConnection() {
  if (!serverMode || serverClientClosing) return false;
  try {
    const response = await fetch("/api/health", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Local server health check failed.");
    const health = await response.json();
    if (health.instance && health.instance !== serverInstanceId) {
      serverInstanceId = health.instance;
      serverSessionToken = "";
      serverClientRegistered = false;
    }
    if (!serverClientRegistered) await registerServerClient();
    serverConnectionConfirmed = true;
    setDot(true);
    return true;
  } catch {
    setDot(false);
    return false;
  }
}

async function api(url, opt = {}) {
  if (serverMode) {
    try {
      return await serverApi(url, opt);
    } catch (error) {
      const networkFailure =
        error instanceof TypeError || error.message === "Failed to fetch";
      const initialPromptLoad =
        !serverConnectionConfirmed &&
        url === "/api/prompts" &&
        (opt.method || "GET").toUpperCase() === "GET";
      if (networkFailure && initialPromptLoad) {
        serverMode = false;
        setDot(false);
        return await api(url, opt);
      }
      throw error;
    }
  }

  const method = (opt.method || "GET").toUpperCase();
  if (url === "/api/prompts" && method === "GET") return await dbGetAll();
  if (url === "/api/prompts" && method === "POST") {
    const data = JSON.parse(opt.body);
    await dbPutAll(data);
    return { ok: true };
  }
  if (url === "/api/transaction" && method === "POST") {
    const body = JSON.parse(opt.body);
    await dbCommitTransaction(body.prompts || [], body.deleteImages || []);
    return { ok: true };
  }
  if (url === "/api/image" && method === "POST") {
    const body = JSON.parse(opt.body);
    const key = "local:" + id();
    await dbPutImg(key, {
      dataUrl: body.data,
      name: body.name,
      lastModified: body.lastModified,
    });
    return { ok: true, image: key, modified: body.lastModified };
  }
  if (url === "/api/delete-image" && method === "POST") {
    const body = JSON.parse(opt.body);
    if (isLocalImg(body.image)) await dbDelImg(body.image);
    return { ok: true };
  }
  throw new Error("本地模式: 未知请求");
}

let saveQueue = Promise.resolve();

async function saveAll(options = {}) {
  const snapshot = cloneData(prompts);
  const deleteImages = [
    ...new Set((options.deleteImages || []).filter(Boolean)),
  ];

  const execute = async () => {
    const result = await api("/api/transaction", {
      method: "POST",
      body: JSON.stringify({
        prompts: snapshot,
        deleteImages,
        expectedRevision: serverRevision,
      }),
    });
    // The queue guarantees response order, so every successful snapshot is the
    // latest durable server state even when the UI has already moved ahead.
    savedPrompts = cloneData(snapshot);
    return result;
  };

  const pending = saveQueue.then(execute, execute);
  saveQueue = pending.catch(() => {});
  return pending;
}
