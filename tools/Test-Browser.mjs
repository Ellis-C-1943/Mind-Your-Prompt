import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(process.argv[2] || ".");
const sleep = (ms) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find(existsSync) || "";
}

const browserPath = chromePath();
if (!browserPath)
  throw new Error(
    "Chrome, Edge, or Chromium was not found. Set CHROME_PATH to run browser tests.",
  );

const indexPath = join(projectRoot, "index.html");
let html = await readFile(indexPath, "utf8");
for (const match of [
  ...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g),
]) {
  const css = await readFile(join(projectRoot, match[1]), "utf8");
  html = html.replace(
    match[0],
    `<style data-source="${match[1]}">${css}</style>`,
  );
}

const mockScript = String.raw`<script>
(() => {
  const memoryStorage = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return memoryStorage.has(String(key)) ? memoryStorage.get(String(key)) : null; },
      setItem(key, value) { memoryStorage.set(String(key), String(value)); },
      removeItem(key) { memoryStorage.delete(String(key)); },
      clear() { memoryStorage.clear(); }
    }
  });
  const nativeFetch = window.fetch.bind(window);
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYGD4z8DAwMDAxAADAAANHQEDasKb6QAAAABJRU5ErkJggg==';
  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() { return descriptor.get.call(this); },
    set(value) {
      const next = String(value || '').startsWith('/data/images/') ? tinyPng : value;
      return descriptor.set.call(this, next);
    }
  });

  window.__mockRevision = 1;
  window.__mockSessionToken = 'browser-test-token';
  window.__mockHealthOnline = true;
  window.__mockClientEvents = [];
  window.__mockBeaconUrls = [];
  window.__mockTransactions = [];
  window.__mockRequestLog = [];
  window.__mockFailTitle = '';
  window.__mockActiveTransactions = 0;
  window.__mockMaxActiveTransactions = 0;
  window.__mockPrompts = [
    {
      id:'p1', title:'Slow Project', prompt:'First prompt', model:'GPT Image',
      image:'images/slow.png', images:['images/slow.png'], imageDates:{}, sourceImages:[],
      gridOrder:1, orderVersion:2, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z'
    },
    {
      id:'p2', title:'Fast Project', prompt:'Second prompt', model:'Nano Banana',
      image:'images/fast.png', images:['images/fast.png'], imageDates:{}, sourceImages:[],
      gridOrder:2, orderVersion:2, createdAt:'2026-01-02T00:00:00Z', updatedAt:'2026-01-02T00:00:00Z'
    }
  ];

  Object.defineProperty(navigator, 'sendBeacon', {
    configurable:true,
    value:(url, data)=>{
      window.__mockBeaconUrls.push(url);
      if(data?.text)data.text().then(body=>window.__mockClientEvents.push({url,body}));
      return true;
    }
  });

  const response = (body, status = 200, extraHeaders = {}) => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'Content-Type':'application/json', ...extraHeaders } }
  );

  window.fetch = async (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
    window.__mockRequestLog.push({ url, method, headers, body:options.body || '' });
    if (url === '/api/session') {
      return response({ ok:true, token:window.__mockSessionToken });
    }
    if (url === '/api/health') {
      return response(
        { ok:window.__mockHealthOnline, instance:'browser-test-instance' },
        window.__mockHealthOnline ? 200 : 503
      );
    }
    if (url === '/api/client/open' && method === 'POST') {
      if (headers['x-myp-session'] !== window.__mockSessionToken) {
        return response({ ok:false, error:'Invalid local session token.' }, 403);
      }
      window.__mockClientEvents.push({url,body:options.body || ''});
      return response({ ok:true, active:true });
    }
    if (url === '/api/prompts' && method === 'GET') {
      return response(window.__mockPrompts, 200, { 'X-MYP-Revision': 'r' + window.__mockRevision });
    }
    if (url === '/api/transaction' && method === 'POST') {
      if (headers['x-myp-session'] !== window.__mockSessionToken) {
        return response({ ok:false, error:'Invalid local session token.' }, 403);
      }
      window.__mockActiveTransactions += 1;
      window.__mockMaxActiveTransactions = Math.max(
        window.__mockMaxActiveTransactions,
        window.__mockActiveTransactions
      );
      const body = JSON.parse(options.body || '{}');
      window.__mockTransactions.push(structuredClone(body));
      try {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 120));
        if (body.prompts?.[0]?.title === window.__mockFailTitle) {
          return response({ ok:false, error:'Forced transaction failure.' }, 500);
        }
        window.__mockPrompts = structuredClone(body.prompts || []);
        window.__mockRevision += 1;
        return response(
          { ok:true, revision:'r' + window.__mockRevision, deleted:(body.deleteImages || []).length },
          200,
          { 'X-MYP-Revision':'r' + window.__mockRevision }
        );
      } finally {
        window.__mockActiveTransactions -= 1;
      }
    }
    if (url === '/api/delete-image' && method === 'POST') return response({ ok:true });
    if (url === '/api/image' && method === 'POST') return response({ ok:true, image:'images/uploaded.png', modified:new Date().toISOString() });
    if (String(url).startsWith('data:')) return nativeFetch(input, options);
    return response({ ok:false, error:'Unhandled mock request: ' + method + ' ' + url }, 404);
  };
})();
</script>`;

html = html.replace(
  '<script src="assets/js/canvas-freeze.js"></script>',
  mockScript + '\n<script src="assets/js/canvas-freeze.js"></script>',
);
for (const match of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]) {
  const js = await readFile(join(projectRoot, match[1]), "utf8");
  html = html.replace(
    match[0],
    `<script data-source="${match[1]}">${js}</script>`,
  );
}

const userDataDir = await mkdtemp(join(tmpdir(), "myp-browser-"));
const port = 9333 + Math.floor(Math.random() * 200);
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let sequence = 0;
const pending = new Map();
const consoleErrors = [];

async function waitForDebugger() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const pages = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = pages.find((item) => item.type === "page");
      if (page) return page;
    } catch {}
    await sleep(100);
  }
  throw new Error("Timed out waiting for Chromium DevTools.");
}

function call(method, params = {}) {
  return new Promise((resolveCall, rejectCall) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = true) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  }
  return result.result?.value;
}

async function waitFor(expression, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`, false)) return;
    await sleep(50);
  }
  throw new Error(message);
}

try {
  const page = await waitForDebugger();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.onopen = resolveOpen;
    ws.onerror = rejectOpen;
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
      return;
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    ) {
      consoleErrors.push(
        message.params.args
          .map((arg) => arg.value || arg.description || "")
          .join(" "),
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
    }
  };

  await call("Runtime.enable");
  await call("Page.enable");
  const frameTree = await call("Page.getFrameTree");
  await call("Page.setDocumentContent", {
    frameId: frameTree.frameTree.frame.id,
    html,
  });
  await waitFor(
    "document.querySelectorAll('#list .item').length === 2",
    "Project list did not render.",
  );

  await evaluate(`(async()=>{
    const originalResolve=resolveImgSrc;
    resolveImgSrc=async src=>{
      if(src==='images/slow.png')await new Promise(r=>setTimeout(r,500));
      if(src==='images/fast.png')await new Promise(r=>setTimeout(r,10));
      return originalResolve(src);
    };
    currentId='p1';
    const slow=renderForm();
    await new Promise(r=>setTimeout(r,20));
    currentId='p2';
    const fast=renderForm();
    await Promise.all([slow,fast]);
  })()`);
  const selected = await evaluate(`({
    title:document.querySelector('#title').value,
    source:document.querySelector('#heroImg').dataset.source,
    current:currentId
  })`);
  if (
    selected.current !== "p2" ||
    selected.title !== "Fast Project" ||
    selected.source !== "images/fast.png"
  ) {
    throw new Error(
      `Stale render overwrote the selected project: ${JSON.stringify(selected)}`,
    );
  }

  await evaluate(`(async()=>{
    prompts[0].title='Queue A';
    const first=saveAll();
    prompts[0].title='Queue B';
    const second=saveAll();
    await Promise.all([first,second]);
  })()`);
  const queueResult = await evaluate(`({
    max:__mockMaxActiveTransactions,
    tx:__mockTransactions.slice(-2),
    request:__mockRequestLog.filter(item=>item.url==='/api/transaction').at(-1)
  })`);
  if (queueResult.max !== 1)
    throw new Error(`Save queue allowed ${queueResult.max} concurrent writes.`);
  if (
    queueResult.tx[0]?.prompts?.[0]?.title !== "Queue A" ||
    queueResult.tx[1]?.prompts?.[0]?.title !== "Queue B"
  ) {
    throw new Error("Save queue did not preserve snapshot order.");
  }

  if (
    queueResult.request?.headers?.["x-myp-session"] !== "browser-test-token"
  ) {
    throw new Error(
      "Mutation request did not include the local session token.",
    );
  }
  if (queueResult.request?.headers?.["content-type"] !== "application/json") {
    throw new Error("Mutation request did not enforce JSON content type.");
  }
  if (!queueResult.request?.headers?.["x-myp-revision"]) {
    throw new Error(
      "Mutation request did not include optimistic-concurrency revision data.",
    );
  }

  const queueFailure = await evaluate(`(async()=>{
    __mockFailTitle='Queue Fail';
    prompts[0].title='Queue Durable';
    const durable=saveAll();
    prompts[0].title='Queue Fail';
    const failed=saveAll();
    const settled=await Promise.allSettled([durable,failed]);
    const beforeRecovery={
      statuses:settled.map(item=>item.status),
      saved:savedPrompts[0].title,
      durable:__mockPrompts[0].title,
      live:prompts[0].title
    };
    __mockFailTitle='';
    prompts[0].title='Queue Recovery';
    await saveAll();
    return {...beforeRecovery,recovered:__mockPrompts[0].title};
  })()`);
  if (queueFailure.statuses.join(",") !== "fulfilled,rejected") {
    throw new Error(
      `Save failure was not surfaced correctly: ${JSON.stringify(queueFailure)}`,
    );
  }
  if (
    queueFailure.saved !== "Queue Durable" ||
    queueFailure.durable !== "Queue Durable"
  ) {
    throw new Error(
      `Failed save replaced the last durable snapshot: ${JSON.stringify(queueFailure)}`,
    );
  }
  if (
    queueFailure.live !== "Queue Fail" ||
    queueFailure.recovered !== "Queue Recovery"
  ) {
    throw new Error(
      `Save queue did not recover after a rejected write: ${JSON.stringify(queueFailure)}`,
    );
  }

  const sessionRecovery = await evaluate(`(async()=>{
    const before=__mockRequestLog.length;
    serverSessionToken='expired-browser-token';
    __mockSessionToken='browser-test-token-refreshed';
    prompts[0].title='Session Recovery';
    await saveAll();
    const requests=__mockRequestLog.slice(before);
    return {
      sessionRequests:requests.filter(item=>item.url==='/api/session').length,
      transactionTokens:requests
        .filter(item=>item.url==='/api/transaction')
        .map(item=>item.headers['x-myp-session']),
      durable:__mockPrompts[0].title,
      token:serverSessionToken
    };
  })()`);
  if (
    sessionRecovery.sessionRequests !== 1 ||
    sessionRecovery.transactionTokens.join(',') !==
      'expired-browser-token,browser-test-token-refreshed' ||
    sessionRecovery.durable !== 'Session Recovery' ||
    sessionRecovery.token !== 'browser-test-token-refreshed'
  ) {
    throw new Error(
      `Expired server session was not recovered: ${JSON.stringify(sessionRecovery)}`,
    );
  }

  const connectionStatus = await evaluate(`(async()=>{
    __mockHealthOnline=false;
    const offline=await refreshServerConnection();
    const offlineClass=document.querySelector('#statusDot').className;
    __mockHealthOnline=true;
    const online=await refreshServerConnection();
    const onlineClass=document.querySelector('#statusDot').className;
    return {offline,offlineClass,online,onlineClass};
  })()`);
  if (
    connectionStatus.offline !== false ||
    !connectionStatus.offlineClass.includes('off') ||
    connectionStatus.online !== true ||
    !connectionStatus.onlineClass.includes('on')
  ) {
    throw new Error(
      `Server connection status did not recover: ${JSON.stringify(connectionStatus)}`,
    );
  }

  const clientLifecycle = await evaluate(`(async()=>{
    const firstId=serverClientId;
    const opensBefore=__mockRequestLog.filter(item=>item.url==='/api/client/open').length;
    closeServerClient();
    await new Promise(resolveDelay=>setTimeout(resolveDelay,20));
    const closeSent=__mockBeaconUrls.includes('/api/client/close');
    const closing=serverClientClosing&&!serverClientRegistered;
    await resumeServerClient();
    const opensAfter=__mockRequestLog.filter(item=>item.url==='/api/client/open').length;
    return {
      closeSent,
      closing,
      reopened:serverClientRegistered&&!serverClientClosing,
      renewed:firstId!==serverClientId,
      opensBefore,
      opensAfter
    };
  })()`);
  if (
    !clientLifecycle.closeSent ||
    !clientLifecycle.closing ||
    !clientLifecycle.reopened ||
    !clientLifecycle.renewed ||
    clientLifecycle.opensAfter !== clientLifecycle.opensBefore + 1
  ) {
    throw new Error(
      `Browser client lifecycle did not close and resume cleanly: ${JSON.stringify(clientLifecycle)}`,
    );
  }

  const uploadRenderFailure = await evaluate(`(async()=>{
    currentId='p1';
    await renderForm();
    const originalRender=renderForm;
    const cleanupBefore=__mockRequestLog.filter(item=>item.url==='/api/delete-image').length;
    renderForm=async()=>{throw new Error('Forced paint failure after save.');};
    let rejected=false;
    try {
      const file=new File(['test-image'], 'test.png', {type:'image/png',lastModified:Date.now()});
      await uploadFiles([file], 'generated');
    } catch {
      rejected=true;
    } finally {
      renderForm=originalRender;
    }
    const committed=__mockPrompts.find(item=>item.id==='p1')?.images || [];
    const cleanupAfter=__mockRequestLog.filter(item=>item.url==='/api/delete-image').length;
    await originalRender();
    return { rejected, committed, cleanupBefore, cleanupAfter };
  })()`);
  if (
    !uploadRenderFailure.rejected ||
    !uploadRenderFailure.committed.includes("images/uploaded.png")
  ) {
    throw new Error(
      `Post-save render failure rolled back durable upload data: ${JSON.stringify(uploadRenderFailure)}`,
    );
  }
  if (uploadRenderFailure.cleanupAfter !== uploadRenderFailure.cleanupBefore) {
    throw new Error(
      "Post-save render failure deleted an image already referenced by durable prompt data.",
    );
  }

  await evaluate(`(async()=>{
    currentId='p2';
    await renderForm();
    await deleteSingleImage('images/fast.png','generated');
  })()`);
  const deleteTransaction = await evaluate("__mockTransactions.at(-1)");
  if (!deleteTransaction.deleteImages?.includes("images/fast.png"))
    throw new Error("Image deletion was not committed with prompt data.");
  if (
    deleteTransaction.prompts.find((item) => item.id === "p2")?.images?.length
  )
    throw new Error("Deleted image remained in the committed prompt snapshot.");

  const singleToGridSharpness = await evaluate(`(async()=>{
    currentId='p1';
    await renderForm();
    await setStageMode('single',false);
    const motion=setStageMode('grid',false);
    const deadline=performance.now()+1000;
    let ghostImage=null;
    while(performance.now()<deadline&&!ghostImage){
      ghostImage=document.querySelector('.stageModeGhost.toGrid img');
      if(!ghostImage)await new Promise(resolveFrame=>requestAnimationFrame(resolveFrame));
    }
    const startFilter=ghostImage?getComputedStyle(ghostImage).filter:'';
    await new Promise(resolveDelay=>setTimeout(resolveDelay,120));
    const midFilter=ghostImage?.isConnected?getComputedStyle(ghostImage).filter:'';
    await motion;
    return {startFilter,midFilter,mode:stageMode};
  })()`);
  if (
    !singleToGridSharpness.startFilter ||
    singleToGridSharpness.startFilter.includes("blur") ||
    singleToGridSharpness.midFilter.includes("blur") ||
    singleToGridSharpness.mode !== "grid"
  ) {
    throw new Error(
      `Single-to-grid ghost lost sharpness: ${JSON.stringify(singleToGridSharpness)}`,
    );
  }

  await evaluate(
    "document.querySelector('#stageModeBtn').click();document.querySelector('#stageModeBtn').click();",
    false,
  );
  await waitFor(
    `!stageModeInputLocked &&
      !document.querySelector('.stage').classList.contains('stageModeAnimating')`,
    "Rapid stage mode input left the transition locked.",
    2500,
  );

  const rapidListSelection = await evaluate(`(async()=>{
    currentId='p1';
    await renderForm();
    const originalCapture=Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture=()=>{};
    let result;
    try {
      // A fast second press can outlive the list node replaced by the first
      // selection render. Releasing on window must cancel that stale hold.
      const stale=document.querySelector('#list .item[data-id="p2"]');
      stale.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,button:0,pointerId:77,clientX:120,clientY:260
      }));
      renderList();
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,button:0,pointerId:77,clientX:120,clientY:260
      }));
      await new Promise(resolveDelay=>setTimeout(resolveDelay,340));
      result={
        ghost:!!document.querySelector('.listDragGhost'),
        drag:!!listDrag,
        current:currentId,
        active:[...document.querySelectorAll('#list .item.on')].map(item=>item.dataset.id),
        frameOpacity:getComputedStyle(document.querySelector('#list'))
          .getPropertyValue('--active-opacity').trim()
      };
    } finally {
      Element.prototype.setPointerCapture=originalCapture;
      if(listDrag)await finishListItemDrag(true);
    }
    return result;
  })()`);
  if (
    rapidListSelection.ghost ||
    rapidListSelection.drag ||
    rapidListSelection.current !== 'p1' ||
    rapidListSelection.active.length !== 1 ||
    rapidListSelection.active[0] !== 'p1' ||
    rapidListSelection.frameOpacity !== '1'
  ) {
    throw new Error(
      `Rapid project presses created a stale drag ghost: ${JSON.stringify(rapidListSelection)}`,
    );
  }

  const listLongPress = await evaluate(`(async()=>{
    const originalCapture=Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture=()=>{};
    let started=false;
    try {
      const item=document.querySelector('#list .item[data-id="p2"]');
      item.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,button:0,pointerId:88,clientX:140,clientY:300
      }));
      await new Promise(resolveDelay=>setTimeout(resolveDelay,310));
      started=!!listDrag&&!!document.querySelector('.listDragGhost');
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,button:0,pointerId:88,clientX:140,clientY:300
      }));
      await new Promise(resolveDelay=>setTimeout(resolveDelay,420));
      return {
        started,
        finished:!listDrag&&!document.querySelector('.listDragGhost')
      };
    } finally {
      Element.prototype.setPointerCapture=originalCapture;
      if(listDrag)await finishListItemDrag(true);
    }
  })()`);
  if (!listLongPress.started || !listLongPress.finished) {
    throw new Error(
      `List long-press behavior changed: ${JSON.stringify(listLongPress)}`,
    );
  }

  if (consoleErrors.length)
    throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
  console.log("MYP browser regression test passed.");
} finally {
  try {
    ws?.close();
  } catch {}
  browser.kill("SIGKILL");
  await sleep(250);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(200);
    }
  }
}
