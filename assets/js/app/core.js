/* ── Browser fallback storage ── */
const {
  MAX_IMAGE_BYTES,
  getAllPrompts: dbGetAll,
  replaceAllPrompts: dbPutAll,
  commitPromptTransaction: dbCommitTransaction,
  putImage: dbPutImg,
  getImage: dbGetImg,
  deleteImage: dbDelImg,
  isLocalImage: isLocalImg,
} = window.MYPStorage;

/* ── Core app ── */
const $ = (id) => document.getElementById(id);
let prompts = [];
let savedPrompts = [];
let currentId = null;
let draft = null;
let serverMode = true;
let serverConnectionConfirmed = false;
let serverSessionToken = "";
let serverRevision = "";
let listFilter = "all";
let lightboxImages = [];
let lightboxIndex = 0;
const STAGE_MODE_KEY = "myp-stage-mode";
let stageMode =
  localStorage.getItem(STAGE_MODE_KEY) === "grid" ? "grid" : "single";
const imageMetaCache = new Map(),
  imageMetaPending = new Map();
let stageGridVersion = 0;
let stageDrag = null;
let listDrag = null;
let listDragSuppressClickUntil = 0;
let listDragAutoScrollRaf = 0;
let stageGridLayoutTimer = null;
let stageModeAnimating = false;
let stageModeInputLocked = false;
let stageModeTarget = null;
let stageModeTransitionId = 0;
let stageModeCurrentGhost = null;
let stageModeHiddenCard = null;
let stageModeTitleGhost = null;
let stageModeEyebrowGhost = null;
let stageModeDraftHintGhost = null;
let stageModeDraftBrandGhost = null;
let stageModeBlankGridAnimation = null;
let stageModeStartRaf = 0;
const STAGE_ZOOM_MS = 480;
const STAGE_ZOOM_EASE = "cubic-bezier(.22,1,.36,1)";
const GRID_LABEL_MOTION_MS = 330;
const GRID_LABEL_EASE = "cubic-bezier(.2,.78,.2,1)";
const DRAFT_BLANK_BACKGROUND_LEAD_MS = 220;
function renderModelDrop() {
  $("modelDrop").innerHTML =
    MODEL_NAMES.map(
      (n) => `<div role="option" data-v="${esc(n)}">${esc(n)}</div>`,
    ).join("") + '<div class="custom" role="option">自定义</div>';
}
async function copyPrompt() {
  const text = $("prompt")?.value || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
function setDot(on) {
  const dot = $("statusDot");
  const label = on ? t("connected") : t("offline");
  dot.className = "statusDot " + (on ? "on" : "off");
  dot.title = label;
  dot.setAttribute("aria-label", label);
  dot.dataset.label = on ? "" : t("offline");
  const dataLabel = document.querySelector(".sideStats div+div span");
  if (dataLabel) dataLabel.textContent = on ? t("statLocal") : t("statBrowser");
}
function syncFromForm(options = {}) {
  const p = current();
  if (saved(p) && !options.force) return p;
  p.title = $("title").value.trim();
  p.prompt = $("prompt").value;
  p.model = normalizeModelName($("modelName").value);
  delete p.tags;
  p.updatedAt = new Date().toISOString();
  return p;
}
const toastTimers = {};
function showToast(id) {
  const t = $(id);
  if (!t) return;
  clearTimeout(toastTimers[id]);
  t.classList.add("on");
  toastTimers[id] = setTimeout(() => t.classList.remove("on"), 2500);
}
function showSaveToast() {
  const toast = $("saveToast");
  if (toast) {
    const icon = toast.querySelector("i"),
      label = toast.querySelector("span");
    if (icon) icon.textContent = "✓";
    if (label) label.textContent = t("saved");
    toast.classList.remove("error");
  }
  showToast("saveToast");
}
function showSaveFailure(err) {
  const toast = $("saveToast");
  if (toast) {
    const icon = toast.querySelector("i"),
      label = toast.querySelector("span");
    if (icon) icon.textContent = "×";
    if (label) label.textContent = t("saveFailed");
    toast.classList.add("error");
  }
  showToast("saveToast");
  reportError("save prompt", err);
}
function showCopyToast() {
  showToast("copyToast");
}
function reportError(action, err) {
  console.error(`[MYP] ${action} failed:`, err);
}
let promptExpandTimer = null;
let promptExpandTransitionId = 0;
function measureCollapsedPromptLayout(form, field, ta, media) {
  const formExpanded = form?.classList.contains("promptExpanded");
  const fieldExpanded = field.classList.contains("expanded");
  const taHeight = ta.style.getPropertyValue("height"),
    taTransition = ta.style.getPropertyValue("transition"),
    taPriority = ta.style.getPropertyPriority("transition");
  const mediaHeight = media?.style.getPropertyValue("height") || "",
    mediaTransition = media?.style.getPropertyValue("transition") || "",
    mediaPriority = media?.style.getPropertyPriority("transition") || "";
  ta.style.setProperty("transition", "none", "important");
  if (media) media.style.setProperty("transition", "none", "important");
  field.classList.remove("expanded");
  form?.classList.remove("promptExpanded");
  ta.style.removeProperty("height");
  media?.style.removeProperty("height");
  const target = {
    ta: ta.getBoundingClientRect().height,
    media: media?.getBoundingClientRect().height || 0,
  };
  form?.classList.toggle("promptExpanded", formExpanded);
  field.classList.toggle("expanded", fieldExpanded);
  if (taHeight) ta.style.setProperty("height", taHeight);
  else ta.style.removeProperty("height");
  if (taTransition)
    ta.style.setProperty("transition", taTransition, taPriority);
  else ta.style.removeProperty("transition");
  if (media) {
    if (mediaHeight) media.style.setProperty("height", mediaHeight);
    else media.style.removeProperty("height");
    if (mediaTransition)
      media.style.setProperty("transition", mediaTransition, mediaPriority);
    else media.style.removeProperty("transition");
  }
  return target;
}
function setPromptExpanded(on, instant = false) {
  const field = $("promptField"),
    ta = $("prompt"),
    btn = $("promptExpandBtn"),
    form = $("form"),
    media = form?.querySelector(".mediaGrid");
  if (!field || !ta || !btn) return;
  clearTimeout(promptExpandTimer);
  const transitionId = ++promptExpandTransitionId;
  if (on) {
    if (media) {
      media.style.removeProperty("height");
      media.style.removeProperty("transition");
    }
    ta.style.removeProperty("transition");
    const mark =
      $("stageCopyBtn")?.getBoundingClientRect().top || window.innerHeight - 64;
    const top = ta.getBoundingClientRect().top;
    ta.style.height = Math.max(260, Math.round(mark - top)) + "px";
    form?.classList.add("promptExpanded");
    field.classList.add("expanded");
  } else if (instant) {
    ta.style.removeProperty("transition");
    ta.style.removeProperty("height");
    if (media) {
      media.style.removeProperty("transition");
      media.style.removeProperty("height");
    }
    field.classList.remove("expanded");
    form?.classList.remove("promptExpanded");
  } else {
    const currentTa = ta.getBoundingClientRect().height;
    const currentMedia = media?.getBoundingClientRect().height || 0;
    const target = measureCollapsedPromptLayout(form, field, ta, media);
    form?.classList.add("promptExpanded");
    field.classList.remove("expanded");
    ta.style.setProperty("transition", "none", "important");
    ta.style.height = `${currentTa}px`;
    if (media) {
      media.style.setProperty("transition", "none", "important");
      media.style.height = `${currentMedia}px`;
    }
    void form?.offsetHeight;
    const motion = "height .24s ease";
    ta.style.setProperty("transition", motion, "important");
    if (media) media.style.setProperty("transition", motion, "important");
    requestAnimationFrame(() => {
      if (transitionId !== promptExpandTransitionId) return;
      ta.style.height = `${target.ta}px`;
      if (media) media.style.height = `${target.media}px`;
    });
    promptExpandTimer = setTimeout(() => {
      if (transitionId !== promptExpandTransitionId) return;
      ta.style.setProperty("transition", "none", "important");
      if (media) media.style.setProperty("transition", "none", "important");
      ta.style.height = `${target.ta}px`;
      if (media) media.style.height = `${target.media}px`;
      form?.classList.remove("promptExpanded");
      void form?.offsetHeight;
      ta.style.removeProperty("height");
      if (media) media.style.removeProperty("height");
      void form?.offsetHeight;
      ta.style.removeProperty("transition");
      if (media) media.style.removeProperty("transition");
      scheduleMediaFit();
    }, 270);
  }
  scheduleMediaFit();
  btn.setAttribute("aria-expanded", on ? "true" : "false");
  btn.setAttribute("aria-label", on ? "收起提示词" : "展开提示词");
}
function fitPromptExpand() {
  if ($("promptField")?.classList.contains("expanded")) setPromptExpanded(true);
}
let mediaFitQueued = false;
function scheduleMediaFit() {
  if (mediaFitQueued) return;
  mediaFitQueued = true;
  requestAnimationFrame(() => {
    mediaFitQueued = false;
    fitMediaLayout();
    requestAnimationFrame(fitMediaLayout);
  });
}
function fitMediaLayout() {
  const form = $("form"),
    strip = $("imageStrip"),
    source = $("sourceStrip"),
    footer = document.querySelector(".footerBtns"),
    copy = $("stageCopyBtn");
  if (!form || !strip || !source) return;
  if (form.classList.contains("promptExpanded")) return;
  form.style.removeProperty("--media-thumb");
  form.style.removeProperty("--media-frame");
  form.style.removeProperty("--source-strip-height");
  if (strip.classList.contains("on") && strip.querySelector(".imageThumb")) {
    const s = getComputedStyle(strip);
    const pad =
      (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
    const borderX =
      (parseFloat(s.borderLeftWidth) || 0) +
      (parseFloat(s.borderRightWidth) || 0);
    const chrome =
      (parseFloat(s.paddingTop) || 0) +
      (parseFloat(s.paddingBottom) || 0) +
      (parseFloat(s.borderTopWidth) || 0) +
      (parseFloat(s.borderBottomWidth) || 0);
    const width = Math.max(120, strip.clientWidth - pad);
    const footerTop = footer?.getBoundingClientRect().top;
    const maxBottom =
      (footerTop ||
        copy?.getBoundingClientRect().bottom ||
        form.getBoundingClientRect().bottom) - 2;
    const size = Math.max(
      96,
      Math.min(width, maxBottom - strip.getBoundingClientRect().top - chrome),
    );
    form.style.setProperty("--media-thumb", Math.floor(size) + "px");
    form.style.setProperty(
      "--media-frame",
      Math.ceil(size + pad + borderX) + "px",
    );
  }
  requestAnimationFrame(() => {
    if (!source.classList.contains("on")) return;
    if (!strip.classList.contains("on")) return;
    const h = Math.max(
      0,
      strip.getBoundingClientRect().bottom - source.getBoundingClientRect().top,
    );
    form.style.setProperty("--source-strip-height", Math.round(h) + "px");
  });
}
function resetPromptBeforeSwitch() {
  document.querySelector(".app")?.classList.add("switching");
  setPromptExpanded(false, true);
  const form = $("form");
  if (form) form.scrollTop = 0;
}

let heroTitleText = "MYP";
const heroCanvas = document.createElement("canvas");
const heroCtx = heroCanvas.getContext("2d", { willReadFrequently: true });
const heroSegmenter =
  window.Intl && Intl.Segmenter
    ? new Intl.Segmenter("zh", { granularity: "grapheme" })
    : null;
const heroSegmentCache = new Map(),
  heroWidthCache = new Map(),
  heroInkCache = new Map();
function setBoundedCache(cache, key, value, limit) {
  if (cache.size >= limit && !cache.has(key))
    cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}
function fontFor(el) {
  const s = getComputedStyle(el);
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}
function titleSegments(text) {
  const value = String(text || "");
  if (heroSegmentCache.has(value)) return heroSegmentCache.get(value);
  const segments = heroSegmenter
    ? [...heroSegmenter.segment(value)].map((s) => s.segment)
    : Array.from(value);
  return setBoundedCache(heroSegmentCache, value, segments, 512);
}
const HERO_TITLE_LAYOUT_LIMIT = 420;
function limitHeroTitleText(text, limit = HERO_TITLE_LAYOUT_LIMIT) {
  const value = normalizeHeroTitle(text),
    chars = [];
  let clipped = false,
    count = 0;
  if (window.Intl && Intl.Segmenter) {
    for (const item of new Intl.Segmenter("zh", {
      granularity: "grapheme",
    }).segment(value)) {
      if (count >= limit) {
        clipped = true;
        break;
      }
      chars.push(item.segment);
      count++;
    }
  } else {
    for (const ch of value) {
      if (count >= limit) {
        clipped = true;
        break;
      }
      chars.push(ch);
      count++;
    }
  }
  return { text: clipped ? chars.join("") : value, clipped };
}
function visualTitleText(text) {
  return String(text || "").toLocaleUpperCase();
}
function textWidth(text, font, letterSpacing = 0) {
  const key = `${font}\u0000${letterSpacing}\u0000${text}`;
  if (heroWidthCache.has(key)) return heroWidthCache.get(key);
  heroCtx.font = font;
  const chars = titleSegments(text);
  const width = chars.reduce(
    (w, ch, i) => w + heroCtx.measureText(ch).width + (i ? letterSpacing : 0),
    0,
  );
  return setBoundedCache(heroWidthCache, key, width, 2048);
}
function inkLeft(text, font, letterSpacing = 0) {
  const key = `${font}\u0000${letterSpacing}\u0000${text}`;
  if (heroInkCache.has(key)) return heroInkCache.get(key);
  const width = Math.max(
      80,
      Math.ceil(textWidth(text, font, letterSpacing) + 120),
    ),
    height = 180;
  heroCanvas.width = width;
  heroCanvas.height = height;
  heroCtx.clearRect(0, 0, width, height);
  heroCtx.font = font;
  heroCtx.fillStyle = "#fff";
  heroCtx.textBaseline = "alphabetic";
  let x = 60;
  for (const ch of titleSegments(text)) {
    heroCtx.fillText(ch, x, 120);
    x += heroCtx.measureText(ch).width + letterSpacing;
  }
  const data = heroCtx.getImageData(0, 0, width, height).data;
  for (let px = 0; px < width; px++) {
    for (let py = 0; py < height; py++) {
      if (data[(py * width + px) * 4 + 3] > 20)
        return setBoundedCache(heroInkCache, key, px - 60, 512);
    }
  }
  return setBoundedCache(heroInkCache, key, 0, 512);
}
function normalizeHeroTitle(text) {
  return (
    String(text || "MYP")
      .replace(/\s+/g, " ")
      .trim() || "MYP"
  );
}
function titleParts(text) {
  return normalizeHeroTitle(text)
    .split(/(\s+)/u)
    .filter(Boolean)
    .map((part) => (/\s/u.test(part) ? " " : part));
}
function ellipsisLine(line, font, letterSpacing, maxWidth) {
  const dots = "…";
  let chars = titleSegments(line.replace(/\s+$/u, ""));
  while (
    chars.length &&
    textWidth(visualTitleText(chars.join("") + dots), font, letterSpacing) >
      maxWidth
  )
    chars.pop();
  return (chars.join("") || dots) + dots;
}
function wrapHeroTitle(text, font, letterSpacing, maxWidth, lineLimit = 20) {
  const lines = [];
  let line = "",
    pendingSpace = "";
  const fits = (value) =>
    textWidth(visualTitleText(value), font, letterSpacing) <= maxWidth;
  const pushLine = () => {
    const clean = line.replace(/\s+$/u, "");
    if (clean) lines.push(clean);
    line = "";
    pendingSpace = "";
  };
  const addGraphemes = (value) => {
    for (const ch of titleSegments(value)) {
      const next = line + ch;
      if (line && !fits(next)) {
        pushLine();
        line = ch;
      } else line = next;
      if (lines.length >= lineLimit) return false;
    }
    return true;
  };
  for (const part of titleParts(text)) {
    if (part === " ") {
      if (line) pendingSpace = " ";
      continue;
    }
    const next = line + (line && pendingSpace ? pendingSpace : "") + part;
    if (fits(next)) {
      line = next;
      pendingSpace = "";
      continue;
    }
    if (line) pushLine();
    if (lines.length >= lineLimit) return { lines, truncated: true };
    pendingSpace = "";
    if (fits(part)) {
      line = part;
      continue;
    }
    if (!addGraphemes(part)) return { lines, truncated: true };
  }
  if (line) pushLine();
  return { lines, truncated: false };
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const scheduleIdle = (work, timeout = 900) =>
  window.requestIdleCallback
    ? requestIdleCallback(work, { timeout })
    : setTimeout(() => work({ didTimeout: true, timeRemaining: () => 0 }), 180);
const cancelIdle = (id) => {
  if (!id) return;
  if (window.cancelIdleCallback) cancelIdleCallback(id);
  else clearTimeout(id);
};
let transitionBusy = false;
async function transitionView(work) {
  if (transitionBusy) {
    return work();
  }
  transitionBusy = true;
  const root = document.querySelector(".app");
  let releaseTimer = null;
  const release = () => {
    root?.classList.remove("switching");
  };
  root?.classList.add("switching");
  try {
    await wait(100);
    releaseTimer = setTimeout(release, 180);
    const out = await work();
    return out;
  } finally {
    clearTimeout(releaseTimer);
    release();
    scheduleMediaFit();
    transitionBusy = false;
  }
}
function updateDraftBrand(value) {
  const p = current();
  const titleValue = value === undefined ? p.title || "" : value;
  document
    .querySelector(".stage")
    ?.classList.toggle(
      "isDraftBlank",
      !saved(p) && !String(titleValue || "").trim(),
    );
}
function layoutHeroTitle(text = heroTitleText) {
  heroTitleText = normalizeHeroTitle(text);
  const layoutTitle = limitHeroTitleText(heroTitleText);
  const title = $("heroTitle"),
    eyebrow = document.querySelector(".eyebrow"),
    hero = document.querySelector(".heroText");
  const outline = document.querySelector(".outline"),
    stage = document.querySelector(".stage");
  const brandEl = $("heroBrand"),
    hintEl = $("heroDraftHint");
  if (!title || !eyebrow || !hero || !outline) return;
  const strokeBuffer = 14;
  const minFont = 28,
    maxFont = 86.25,
    lineHeight = 1.16;
  const outlineStyle = getComputedStyle(outline),
    outlineFont = fontFor(outline),
    outlineSpacing = parseFloat(outlineStyle.letterSpacing) || 0;
  const outlineInkLeftVal = inkLeft(
    visualTitleText(outline.textContent.trim()),
    outlineFont,
    outlineSpacing,
  );
  const outlineStroke = parseFloat(outlineStyle.webkitTextStrokeWidth) || 1;
  // One canonical visual edge: the visible left stroke of the large PROMPT word.
  // Every draft label is offset by its real glyph ink, not by its CSS box.
  const target = outlineInkLeftVal - outlineStroke / 2;
  const alignPlainText = (el, text) => {
    if (!el) return;
    const style = getComputedStyle(el),
      font = fontFor(el),
      spacing = parseFloat(style.letterSpacing) || 0;
    const offset =
      target -
      inkLeft(String(text || el.textContent || "").trim(), font, spacing);
    el.style.marginLeft = "0px";
    el.style.paddingLeft = "0px";
    el.style.left = `${Math.round(offset)}px`;
  };
  alignPlainText(eyebrow, visualTitleText(eyebrow.textContent.trim()));
  alignPlainText(brandEl, brandEl?.textContent || "");
  alignPlainText(hintEl, hintEl?.textContent || "");
  const maxWidth = Math.max(80, hero.clientWidth - target - strokeBuffer);
  const safeHeight = Math.max(
    126,
    Math.min(248, (stage?.clientHeight || 690) * 0.36),
  );
  const maxLines = Math.max(
    2,
    Math.min(4, Math.floor(safeHeight / (minFont * lineHeight))),
  );
  // Read the title's font family / weight / style / letter-spacing ONCE.
  // Only font-size varies across trials, so each trial font string is built from
  // the loop variable without touching the DOM — no per-iteration setProperty or
  // getComputedStyle, which removes ~30 forced reflows that stalled the zoom start.
  const titleStyle = getComputedStyle(title);
  const titleStroke = parseFloat(titleStyle.webkitTextStrokeWidth) || 2;
  const titleFontBase = `${titleStyle.fontStyle} ${titleStyle.fontWeight}`,
    titleFamily = titleStyle.fontFamily,
    titleSpacing = parseFloat(titleStyle.letterSpacing) || 0;
  let best = null;
  for (let size = maxFont; size >= minFont; size -= 2) {
    const titleFont = `${titleFontBase} ${size}px ${titleFamily}`;
    const wrapped = wrapHeroTitle(
      layoutTitle.text,
      titleFont,
      titleSpacing,
      maxWidth,
      maxLines + 1,
    );
    if (
      !wrapped.truncated &&
      wrapped.lines.length <= maxLines &&
      wrapped.lines.length * size * lineHeight <= safeHeight
    ) {
      best = {
        size,
        font: titleFont,
        spacing: titleSpacing,
        lines: wrapped.lines,
      };
      break;
    }
  }
  if (!best) {
    const titleFont = `${titleFontBase} ${minFont}px ${titleFamily}`;
    const wrapped = wrapHeroTitle(
      layoutTitle.text,
      titleFont,
      titleSpacing,
      maxWidth,
      maxLines,
    );
    const lines = wrapped.lines.length ? wrapped.lines : ["MYP"];
    if (
      wrapped.truncated ||
      layoutTitle.clipped ||
      textWidth(
        visualTitleText(lines[lines.length - 1]),
        titleFont,
        titleSpacing,
      ) > maxWidth
    ) {
      lines[lines.length - 1] = ellipsisLine(
        lines[lines.length - 1],
        titleFont,
        titleSpacing,
        maxWidth,
      );
    }
    best = { size: minFont, font: titleFont, spacing: titleSpacing, lines };
  } else if (layoutTitle.clipped && best.lines.length) {
    best.lines[best.lines.length - 1] = ellipsisLine(
      best.lines[best.lines.length - 1],
      best.font,
      best.spacing,
      maxWidth,
    );
  }
  title.style.setProperty("--hero-title-size", `${best.size}px`);
  title.style.setProperty("--hero-title-leading", String(lineHeight));
  title.innerHTML = best.lines
    .map((line) => {
      const visualInk =
        inkLeft(visualTitleText(line), best.font, best.spacing) -
        titleStroke / 2;
      const shift = target - visualInk;
      return `<span class="heroTitleLine" style="--line-shift:${Math.round(shift)}px">${esc(line)}</span>`;
    })
    .join("");
  title.style.setProperty("--title-y", "0px");
  const isDraftBrand =
    stage?.classList.contains("isDraftBlank") && heroTitleText === "MYP";
  const titlePosition = title.style.getPropertyValue("position"),
    titlePositionPriority = title.style.getPropertyPriority("position");
  const brandDisplay = brandEl?.style.getPropertyValue("display") || "",
    brandDisplayPriority = brandEl?.style.getPropertyPriority("display") || "";
  const restoreMeasureStyles = () => {
    if (titlePosition)
      title.style.setProperty("position", titlePosition, titlePositionPriority);
    else title.style.removeProperty("position");
    if (brandEl) {
      if (brandDisplay)
        brandEl.style.setProperty(
          "display",
          brandDisplay,
          brandDisplayPriority,
        );
      else brandEl.style.removeProperty("display");
    }
  };
  const stageRect = stage?.getBoundingClientRect();

  // Canonical grid geometry: title never occupies flow and the draft brand stays hidden.
  // This keeps AIGC Prompt Library at one fixed grid coordinate in every entry path.
  title.style.setProperty("position", "absolute", "important");
  brandEl?.style.setProperty("display", "none", "important");
  void hero.offsetWidth;
  const gridOutlineRect = outline.getBoundingClientRect(),
    gridHeroRect = hero.getBoundingClientRect();
  const gridEyebrowY = Math.round(
    gridOutlineRect.top -
      gridHeroRect.top -
      eyebrow.offsetTop -
      eyebrow.offsetHeight -
      8,
  );
  const gridEyebrowSafeY = Math.max(8, gridEyebrowY);
  hero.style.setProperty("--grid-eyebrow-y", `${gridEyebrowSafeY}px`);
  if (stage && stageRect) {
    const cutY = Math.round(
      gridHeroRect.top -
        stageRect.top +
        eyebrow.offsetTop +
        gridEyebrowSafeY -
        34,
    );
    stage.style.setProperty("--stage-cut-y", `${Math.max(72, cutY)}px`);
  }

  // Canonical single geometry: title occupies flow and the draft brand is present.
  // Both modes are measured explicitly so their coordinates share one contract.
  title.style.setProperty("position", "static", "important");
  brandEl?.style.setProperty(
    "display",
    isDraftBrand ? "block" : "none",
    "important",
  );
  void hero.offsetWidth;
  const singleOutlineRect = outline.getBoundingClientRect(),
    singleHeroRect = hero.getBoundingClientRect(),
    singleTitleRect = title.getBoundingClientRect(),
    singleBrandRect = brandEl?.getBoundingClientRect();
  const titleDrop =
    parseFloat(getComputedStyle(hero).getPropertyValue("--title-drop")) || 18;
  const singleEyebrowBottom =
    singleHeroRect.top + eyebrow.offsetTop + eyebrow.offsetHeight + titleDrop;
  const titleLines = Math.max(1, best.lines.length);
  const visualGap = isDraftBrand
    ? 16
    : Math.round(
        Math.max(24, Math.min(42, best.size * (titleLines > 2 ? 0.34 : 0.3))),
      );
  const bottomGap = Math.max(14, Math.round(visualGap * 0.58));
  let centeredTop =
    (singleEyebrowBottom + singleOutlineRect.top - singleTitleRect.height) / 2;
  if (stageRect) {
    const topLimit = Math.max(
      stageRect.top + 36,
      singleEyebrowBottom + visualGap,
    );
    const brandLimit =
      isDraftBrand && singleBrandRect?.height
        ? singleBrandRect.top - singleTitleRect.height - 12
        : Infinity;
    const bottomLimit = Math.min(
      stageRect.bottom - singleTitleRect.height - 76,
      singleOutlineRect.top - singleTitleRect.height - bottomGap,
      brandLimit,
    );
    if (topLimit <= bottomLimit)
      centeredTop = Math.max(topLimit, Math.min(centeredTop, bottomLimit));
    else
      centeredTop = Math.max(
        stageRect.top + 36,
        Math.min(centeredTop, stageRect.bottom - singleTitleRect.height - 76),
      );
  }
  const eyebrowFloor = singleEyebrowBottom + visualGap;
  if (centeredTop < eyebrowFloor) centeredTop = eyebrowFloor;
  restoreMeasureStyles();
  title.style.setProperty(
    "--title-y",
    `${Math.round(centeredTop - singleTitleRect.top)}px`,
  );
}

/* ── Image helpers ── */
async function resolveImgSrc(src) {
  if (!src) return "";
  if (isLocalImg(src)) {
    const r = await dbGetImg(src);
    return r?.dataUrl || "";
  }
  return pathUrl(src);
}
const thumbCache = new Map();
async function resolveThumbSrc(src, max = 220) {
  if (!src) return "";
  const key = src + "@" + max;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const full = await resolveImgSrc(src);
  if (!full) return "";
  const out = await new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || img.width || 0,
        naturalH = img.naturalHeight || img.height || 0;
      if (naturalW && naturalH && !imageMetaCache.has(src)) {
        imageMetaCache.set(src, {
          url: full,
          ratio: Math.max(0.35, Math.min(3.2, naturalW / naturalH)),
          w: naturalW,
          h: naturalH,
        });
      }
      const largest = Math.max(naturalW, naturalH);
      if (!largest || largest <= max) {
        res(full);
        return;
      }
      const scale = max / largest,
        w = Math.max(1, Math.round(naturalW * scale)),
        h = Math.max(1, Math.round(naturalH * scale));
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      const webp = canvas.toDataURL("image/webp", 0.95);
      res(
        webp.startsWith("data:image/webp")
          ? webp
          : canvas.toDataURL("image/jpeg", 0.94),
      );
    };
    img.onerror = () => res(full);
    img.src = full;
  });
  thumbCache.set(key, out);
  return out;
}
async function localFileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

/* ── Render ── */
function matchList(p, q = $("search").value.trim().toLowerCase()) {
  const mode = modeOf(p),
    matchFilter =
      listFilter === "all" ||
      (listFilter === "image"
        ? mode === t("filterImage")
        : mode === t("filterText"));
  return (
    matchFilter &&
    [p.title, p.prompt, p.model, mode].join("\n").toLowerCase().includes(q)
  );
}
function updateListActiveFrame() {
  const list = $("list");
  if (!list) return;
  const active = list.querySelector(".item.on");
  if (!active) {
    list.style.setProperty("--active-opacity", "0");
    return;
  }
  list.style.setProperty("--active-height", `${active.offsetHeight}px`);
  list.style.setProperty("--active-top", `${active.offsetTop}px`);
  list.style.setProperty("--active-opacity", "1");
}
async function refreshPromptOrderViews(promptId) {
  renderList();
  try {
    await renderStageGrid({ fast: true, noAutoScroll: true, force: true });
  } catch (err) {
    reportError("refresh prompt order grid", err);
  }
  requestAnimationFrame(() => {
    const item = $("list")?.querySelector(
      `.item[data-id="${CSS.escape(promptId)}"]`,
    );
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    updateListActiveFrame();
  });
}
