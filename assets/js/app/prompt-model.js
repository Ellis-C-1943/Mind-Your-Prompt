/* ── Prompt model, ordering, and data-shape helpers ── */
const id = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
const blank = () => ({
  id: id(),
  title: "",
  prompt: "",
  note: "",
  model: "",
  image: "",
  images: [],
  imageDates: {},
  sourceImages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
function sortPrompts() {
  prompts.sort((a, b) => {
    const ao = Number.isFinite(+a.gridOrder)
      ? +a.gridOrder
      : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(+b.gridOrder)
      ? +b.gridOrder
      : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
}
function promptOrderValue(p) {
  const value = Number(p?.gridOrder);
  return Number.isFinite(value) ? value : null;
}
function promptOrderLabel(p, fallbackIndex = 0) {
  const value = promptOrderValue(p);
  if (value === null) return String(fallbackIndex + 1).padStart(2, "0");
  if (Number.isInteger(value) && value >= 0 && value < 10)
    return String(value).padStart(2, "0");
  return String(Object.is(value, -0) ? 0 : value);
}
function parsePromptOrderInput(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}
function renumberPromptsByPosition() {
  prompts.forEach((p, i) => {
    p.gridOrder = i + 1;
    p.orderVersion = 2;
  });
}
function assignPromptOrderWithSwap(prompt, targetOrder) {
  const target = Number(targetOrder);
  const previous = promptOrderValue(prompt);
  if (
    !prompt ||
    previous === null ||
    !Number.isSafeInteger(target) ||
    target < 1
  )
    return false;
  if (previous === target) return false;
  const occupant =
    prompts.find(
      (other) => other !== prompt && promptOrderValue(other) === target,
    ) || null;
  prompt.gridOrder = target;
  prompt.orderVersion = 2;
  if (occupant) {
    occupant.gridOrder = previous;
    occupant.orderVersion = 2;
  }
  sortPrompts();
  return true;
}
function nextPromptOrder() {
  const values = prompts.map(promptOrderValue).filter((v) => v !== null);
  return values.length ? Math.floor(Math.max(...values)) + 1 : 1;
}
function migratePromptOrders() {
  const legacy = prompts.filter(
    (p) => p.orderVersion !== 2 || promptOrderValue(p) === null,
  );
  if (!legacy.length) return false;
  if (legacy.length === prompts.length) {
    prompts.forEach((p, i) => {
      p.gridOrder = i + 1;
      p.orderVersion = 2;
    });
  } else {
    let next = Math.max(
      0,
      ...prompts
        .filter((p) => p.orderVersion === 2)
        .map(promptOrderValue)
        .filter((v) => v !== null),
    );
    legacy.forEach((p) => {
      p.gridOrder = ++next;
      p.orderVersion = 2;
    });
  }
  return true;
}
function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}
function setSavedSnapshot() {
  savedPrompts = cloneData(prompts);
}
function restoreSavedPrompt(promptId) {
  if (!promptId) return;
  const i = prompts.findIndex((p) => p.id === promptId);
  if (i < 0) return;
  const original = savedPrompts.find((p) => p.id === promptId);
  if (original) prompts[i] = cloneData(original);
}

const imgPath = (p) => imagesOf(p)[0] || "";

const pathUrl = (path) =>
  path ? (isLocalImg(path) ? "" : "/data/" + path) : "";
function current() {
  let p = prompts.find((p) => p.id === currentId);
  if (p) return p;
  if (draft && draft.id === currentId) return draft;
  draft = blank();
  currentId = draft.id;
  return draft;
}
const saved = (p) => !!p && prompts.some((x) => x.id === p.id);
function imagesOf(p) {
  return [
    ...new Set(
      [...(Array.isArray(p?.images) ? p.images : []), p?.image].filter(Boolean),
    ),
  ];
}
function setImages(p, imgs) {
  p.images = [...new Set(imgs.filter(Boolean))];
  p.image = p.images[0] || "";
  if (!p.imageDates || typeof p.imageDates !== "object") p.imageDates = {};
  Object.keys(p.imageDates).forEach((key) => {
    if (!p.images.includes(key)) delete p.imageDates[key];
  });
}
const sourceImagesOf = (p) => [
  ...new Set(
    Array.isArray(p?.sourceImages) ? p.sourceImages.filter(Boolean) : [],
  ),
];
function setSourceImages(p, imgs) {
  p.sourceImages = [...new Set(imgs.filter(Boolean))];
}
const empty = (p) =>
  !(
    (p.title || "").trim() ||
    (p.prompt || "").trim() ||
    imagesOf(p).length ||
    sourceImagesOf(p).length
  );
const titleOf = (p) => (p.title || t("unnamed")).trim();
const modeOf = (p) =>
  sourceImagesOf(p).length ? t("filterImage") : t("filterText");
const countText = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
const MODEL_NAMES = ["GPT Image", "Nano Banana", "Midjourney"];
function normalizeModelName(name) {
  const v = String(name || "").trim(),
    key = v.replace(/\s+/g, "").toLowerCase();
  if (key === "gptimage2") return "GPT Image";
  if (key === "nanobanana" || key === "nanobanana2" || key === "nanobananapro")
    return "Nano Banana";
  return v;
}
