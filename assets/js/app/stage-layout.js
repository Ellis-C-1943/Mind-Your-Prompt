async function resolveImageMeta(src) {
  const fallback = { url: "", ratio: 16 / 9, w: 16, h: 9 };
  if (!src) return fallback;
  if (imageMetaCache.has(src)) return imageMetaCache.get(src);
  if (imageMetaPending.has(src)) return imageMetaPending.get(src);
  const pending = (async () => {
    const url = await resolveImgSrc(src);
    if (!url) return fallback;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (imageMetaCache.has(src)) return imageMetaCache.get(src);
      const requestUrl =
        attempt === 0 || url.startsWith("data:") || url.startsWith("blob:")
          ? url
          : `${url}${url.includes("?") ? "&" : "?"}__myp_meta_retry=${attempt}`;
      const meta = await new Promise((res) => {
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth || img.width || 0,
            h = img.naturalHeight || img.height || 0;
          res(
            w && h
              ? { url, ratio: Math.max(0.35, Math.min(3.2, w / h)), w, h }
              : null,
          );
        };
        img.onerror = () => res(null);
        img.src = requestUrl;
      });
      if (meta) {
        imageMetaCache.set(src, meta);
        return meta;
      }
      if (attempt < 2) await wait(45 * (attempt + 1));
    }
    // A transient first-load failure must never poison the session cache with 16:9.
    // Returning a fallback without caching lets the next render recover automatically.
    return fallback;
  })().finally(() => imageMetaPending.delete(src));
  imageMetaPending.set(src, pending);
  return pending;
}
function stageCardSize(ratio) {
  if (ratio >= 2.05) return 1.78; // ultra-wide normalized close to 16:9
  if (ratio >= 1.35) return 1.58; // landscape bucket
  if (ratio >= 0.92) return 1.0; // square bucket
  return 0.72; // portrait bucket
}
function computeStageGridLayout(
  items,
  containerWidth,
  gap = 12,
  targetRowHeight = 172,
) {
  if (!items.length) return [];
  const safeWidth = Math.max(240, Math.floor(containerWidth || 0));
  const rows = [];
  let row = [];
  let ratioSum = 0;

  const flushRow = (force = false) => {
    if (!row.length) return;
    const totalGap = gap * Math.max(0, row.length - 1);
    let rowHeight = (safeWidth - totalGap) / Math.max(0.001, ratioSum);
    if (force) {
      rowHeight = Math.min(targetRowHeight, rowHeight);
      rowHeight = Math.max(132, rowHeight);
    } else {
      rowHeight = Math.max(150, Math.min(210, rowHeight));
    }

    const baseWidths = row.map((item) => rowHeight * item.layoutRatio);
    const usedBase = baseWidths.reduce((sum, w) => sum + w, 0);
    const remain = safeWidth - totalGap - usedBase;
    const shouldStretch = !force && row.length > 1;
    const extra = shouldStretch ? remain / Math.max(1, row.length) : 0;

    let consumed = 0;
    row.forEach((item, idx) => {
      let w = baseWidths[idx] + extra;
      if (shouldStretch && idx === row.length - 1)
        w = Math.max(84, safeWidth - totalGap - consumed);
      w = Math.max(84, Math.round(w));
      consumed += w;
      rows.push({ item, w, h: Math.round(rowHeight) });
    });

    row = [];
    ratioSum = 0;
  };

  for (const item of items) {
    row.push(item);
    ratioSum += item.layoutRatio;
    const estimated =
      ratioSum * targetRowHeight + gap * Math.max(0, row.length - 1);
    if (estimated >= safeWidth) flushRow(false);
  }
  flushRow(true);
  return rows;
}
function scheduleStageGridLayout() {
  clearTimeout(stageGridLayoutTimer);
  stageGridLayoutTimer = setTimeout(() => {
    if (stageMode === "grid")
      renderStageGrid().catch((err) => reportError("render stage grid", err));
  }, 70);
}
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));
async function waitFrames(count = 1) {
  while (count-- > 0) await nextFrame();
}
function stageLocalRect(rect, stage = document.querySelector(".stage")) {
  const base = stage?.getBoundingClientRect();
  if (!base) return { left: 0, top: 0, width: 0, height: 0 };
  return {
    left: rect.left - base.left,
    top: rect.top - base.top,
    width: rect.width,
    height: rect.height,
  };
}
function stageFullRect(stage = document.querySelector(".stage")) {
  return {
    left: 0,
    top: 0,
    width: stage?.clientWidth || 0,
    height: stage?.clientHeight || 0,
  };
}
function stageShadeOpacity(stage = document.querySelector(".stage")) {
  const value = parseFloat(
    getComputedStyle(stage || document.documentElement).getPropertyValue(
      "--stage-shade-opacity",
    ),
  );
  return Number.isFinite(value) ? value : 0.78;
}
function createStageModeGhost(
  src,
  rect,
  stage = document.querySelector(".stage"),
  sourceEl = null,
) {
  const ghost = document.createElement("div");
  const image = document.createElement("img");
  const sourceImg = sourceEl?.querySelector?.("img") || sourceEl;
  // Use the preloaded full-resolution source for a clean zoom handoff.
  image.src = src;
  image.alt = "";
  image.draggable = false;
  ghost.className = "stageModeGhost";
  ghost.appendChild(image);
  const shade = document.createElement("div");
  shade.className = "stageModeGhostShade";
  shade.setAttribute("aria-hidden", "true");
  ghost.appendChild(shade);
  const radius =
    getComputedStyle(sourceEl || stage || document.documentElement)
      .borderRadius || "6px";
  Object.assign(ghost.style, {
    position: "absolute",
    inset: "auto",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: "12",
    pointerEvents: "none",
    borderRadius: radius,
    boxShadow: "0 22px 54px rgba(0,0,0,.30)",
    opacity: "1",
    transform: "none",
    transformOrigin: "50% 50%",
  });
  if (sourceImg) {
    const st = getComputedStyle(sourceImg);
    image.style.objectPosition = st.objectPosition || "50% 50%";
    image.style.filter =
      st.filter && st.filter !== "none" ? st.filter : "contrast(1.04)";
  }
  stage?.appendChild(ghost);
  return ghost;
}
function captureStageTitleLayout(stage, titleEl) {
  if (!stage || !titleEl) return null;
  const rect = stageLocalRect(titleEl.getBoundingClientRect(), stage),
    computed = getComputedStyle(titleEl);
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    rect,
    style: {
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
    },
  };
}
function captureStageEyebrowLayout(stage, eyebrowEl) {
  if (!stage || !eyebrowEl) return null;
  const rect = stageLocalRect(eyebrowEl.getBoundingClientRect(), stage),
    computed = getComputedStyle(eyebrowEl);
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    rect,
    style: {
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      fontWeight: computed.fontWeight,
    },
  };
}
function createStageTitleGhostFromLayout(stage, titleEl, layout) {
  if (!stage || !titleEl || !layout) return null;
  const { rect, style } = layout,
    clone = titleEl.cloneNode(true);
  clone.removeAttribute("id");
  clone.classList.add("stageTitleGhost");
  Object.assign(clone.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    ...style,
  });
  stage.appendChild(clone);
  return clone;
}
function createStageEyebrowGhostFromLayout(stage, eyebrowEl, layout) {
  if (!stage || !eyebrowEl || !layout) return null;
  const { rect, style } = layout,
    clone = eyebrowEl.cloneNode(true);
  clone.className = "stageEyebrowGhost";
  Object.assign(clone.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    ...style,
    opacity: "1",
    transform: "translate3d(0,0,0)",
  });
  stage.appendChild(clone);
  return clone;
}
function createStageTitleGhost(
  stage = document.querySelector(".stage"),
  titleEl = $("heroTitle"),
) {
  if (!stage || !titleEl) return null;
  stage.classList.add("stageMeasureSingleTitle");
  const layout = captureStageTitleLayout(stage, titleEl);
  stage.classList.remove("stageMeasureSingleTitle");
  return createStageTitleGhostFromLayout(stage, titleEl, layout);
}
function createStageEyebrowGhost(
  stage = document.querySelector(".stage"),
  eyebrowEl = document.querySelector(".eyebrow"),
) {
  return createStageEyebrowGhostFromLayout(
    stage,
    eyebrowEl,
    captureStageEyebrowLayout(stage, eyebrowEl),
  );
}
function captureStageDraftTextLayout(stage, el) {
  if (!stage || !el) return null;
  const rect = stageLocalRect(el.getBoundingClientRect(), stage),
    computed = getComputedStyle(el);
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    rect,
    style: {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
      textAlign: computed.textAlign,
      whiteSpace: computed.whiteSpace,
      color: computed.color,
    },
  };
}
function createStageDraftTextGhostFromLayout(stage, el, layout, className) {
  if (!stage || !el || !layout) return null;
  const { rect, style } = layout,
    clone = el.cloneNode(true);
  clone.removeAttribute("id");
  clone
    .querySelectorAll?.("[id]")
    .forEach((node) => node.removeAttribute("id"));
  clone.className = className;
  Object.assign(clone.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    ...style,
    opacity: "0",
    transform: "translate3d(0,32px,0)",
  });
  stage.appendChild(clone);
  return clone;
}
function measureSingleStageTextLayout(
  stage,
  titleEl,
  eyebrowEl,
  draftHintEl = null,
  draftBrandEl = null,
) {
  if (!stage) return { title: null, eyebrow: null, hint: null, brand: null };
  const className = stage.className;
  const transition = eyebrowEl?.style.getPropertyValue("transition") || "";
  const transitionPriority =
    eyebrowEl?.style.getPropertyPriority("transition") || "";
  const hintStyle = draftHintEl?.style.cssText || "";
  const brandStyle = draftBrandEl?.style.cssText || "";
  eyebrowEl?.style.setProperty("transition", "none", "important");
  stage.classList.remove(
    "gridMode",
    "stageModeAnimatingToSingle",
    "stageModeAnimatingToGrid",
  );
  if (draftHintEl) {
    draftHintEl.style.setProperty("display", "block", "important");
    draftHintEl.style.setProperty("visibility", "hidden", "important");
  }
  if (draftBrandEl) {
    draftBrandEl.style.setProperty("display", "block", "important");
    draftBrandEl.style.setProperty("visibility", "hidden", "important");
  }
  void stage.offsetWidth;
  const layout = {
    title: captureStageTitleLayout(stage, titleEl),
    eyebrow: captureStageEyebrowLayout(stage, eyebrowEl),
    hint: captureStageDraftTextLayout(stage, draftHintEl),
    brand: captureStageDraftTextLayout(stage, draftBrandEl),
  };
  stage.className = className;
  if (draftHintEl) draftHintEl.style.cssText = hintStyle;
  if (draftBrandEl) draftBrandEl.style.cssText = brandStyle;
  void stage.offsetWidth;
  if (eyebrowEl) {
    if (transition)
      eyebrowEl.style.setProperty("transition", transition, transitionPriority);
    else eyebrowEl.style.removeProperty("transition");
  }
  return layout;
}
function prepareGridToSingleTextEntrance(
  stage,
  titleEl,
  eyebrowEl,
  options = {},
) {
  const draftHintEl = options.draftHintEl || null,
    draftBrandEl = options.draftBrandEl || null;
  const eyebrowStart = captureStageEyebrowLayout(stage, eyebrowEl);
  const singleLayout = measureSingleStageTextLayout(
    stage,
    titleEl,
    eyebrowEl,
    draftHintEl,
    draftBrandEl,
  );
  const titleGhost = createStageTitleGhostFromLayout(
    stage,
    titleEl,
    singleLayout.title,
  );
  const eyebrowGhost = createStageEyebrowGhostFromLayout(
    stage,
    eyebrowEl,
    eyebrowStart,
  );
  const hintGhost = createStageDraftTextGhostFromLayout(
    stage,
    draftHintEl,
    singleLayout.hint,
    "stageDraftHintGhost",
  );
  const brandGhost = createStageDraftTextGhostFromLayout(
    stage,
    draftBrandEl,
    singleLayout.brand,
    "stageDraftBrandGhost",
  );
  stageModeTitleGhost = titleGhost;
  stageModeEyebrowGhost = eyebrowGhost;
  stageModeDraftHintGhost = hintGhost;
  stageModeDraftBrandGhost = brandGhost;
  if (titleEl) {
    titleEl.style.setProperty("transition", "none", "important");
    titleEl.style.setProperty("opacity", "0", "important");
  }
  if (eyebrowEl) {
    eyebrowEl.style.setProperty("transition", "none", "important");
    eyebrowEl.style.setProperty("opacity", "0", "important");
  }
  if (draftHintEl) {
    draftHintEl.style.setProperty("transition", "none", "important");
    draftHintEl.style.setProperty("opacity", "0", "important");
  }
  if (draftBrandEl) {
    draftBrandEl.style.setProperty("transition", "none", "important");
    draftBrandEl.style.setProperty("opacity", "0", "important");
  }
  let started = false;
  return {
    run() {
      if (started) return Promise.resolve();
      started = true;
      const riseGhost = (ghost) =>
        ghost
          ? ghost
              .animate(
                [
                  { transform: "translate3d(0,32px,0)", opacity: 0 },
                  { transform: "translate3d(0,0,0)", opacity: 1 },
                ],
                {
                  duration: STAGE_ZOOM_MS,
                  easing: STAGE_ZOOM_EASE,
                  fill: "forwards",
                  composite: "replace",
                },
              )
              .finished.catch(() => {})
          : Promise.resolve();
      const titlePromise = riseGhost(titleGhost);
      const hintPromise = riseGhost(hintGhost);
      const brandPromise = riseGhost(brandGhost);
      const from = eyebrowStart?.rect,
        to = singleLayout.eyebrow?.rect;
      const eyebrowPromise =
        eyebrowGhost && from && to
          ? eyebrowGhost
              .animate(
                [
                  { transform: "translate3d(0,0,0)", opacity: 1 },
                  {
                    transform: `translate3d(${to.left - from.left}px,${to.top - from.top}px,0)`,
                    opacity: 1,
                  },
                ],
                {
                  duration: STAGE_ZOOM_MS,
                  easing: STAGE_ZOOM_EASE,
                  fill: "forwards",
                  composite: "replace",
                },
              )
              .finished.catch(() => {})
          : Promise.resolve();
      return Promise.all([
        titlePromise,
        eyebrowPromise,
        hintPromise,
        brandPromise,
      ]);
    },
  };
}
function startGridToSingleTextEntrance(stage, titleEl, eyebrowEl) {
  return prepareGridToSingleTextEntrance(stage, titleEl, eyebrowEl).run();
}
function handoffStageTitleGhost(titleEl = $("heroTitle")) {
  if (titleEl) {
    titleEl.style.setProperty("transition", "none", "important");
    titleEl.style.setProperty("opacity", "1", "important");
    titleEl.style.setProperty(
      "transform",
      "translateY(var(--title-y,0px))",
      "important",
    );
  }
  stageModeTitleGhost?.remove();
  stageModeTitleGhost = null;
}
function animateSingleToGridTitleExit(titleGhost, isDraftBlank = false) {
  if (!titleGhost) return Promise.resolve();
  const height = titleGhost.getBoundingClientRect().height || 90;
  const titleDrop = isDraftBlank
    ? Math.max(4, Math.min(7, height * 0.055))
    : Math.max(18, Math.min(28, height * 0.18));
  const duration = isDraftBlank ? 125 : GRID_LABEL_MOTION_MS * 0.52;
  const keyframes = isDraftBlank
    ? [
        {
          transform: "translate3d(0,0,0)",
          clipPath: "inset(0 0 0 0)",
          opacity: 1,
          offset: 0,
        },
        {
          transform: `translate3d(0,${titleDrop * 0.35}px,0)`,
          clipPath: "inset(0 0 42% 0)",
          opacity: 0.24,
          offset: 0.38,
        },
        {
          transform: `translate3d(0,${titleDrop}px,0)`,
          clipPath: "inset(0 0 100% 0)",
          opacity: 0,
          offset: 1,
        },
      ]
    : [
        {
          transform: "translate3d(0,0,0)",
          clipPath: "inset(0 0 0 0)",
          opacity: 1,
          offset: 0,
        },
        {
          transform: `translate3d(0,${titleDrop * 0.42}px,0)`,
          clipPath: `inset(0 0 ${titleDrop * 0.42}px 0)`,
          opacity: 0.58,
          offset: 0.46,
        },
        {
          transform: `translate3d(0,${titleDrop}px,0)`,
          clipPath: `inset(0 0 ${titleDrop}px 0)`,
          opacity: 0,
          offset: 1,
        },
      ];
  const animation = titleGhost.animate(keyframes, {
    duration,
    easing: STAGE_ZOOM_EASE,
    fill: "both",
    composite: "replace",
  });
  return animation.finished
    .catch(() => {})
    .then(() => {
      if (stageModeTitleGhost === titleGhost) {
        titleGhost.remove();
        stageModeTitleGhost = null;
      }
    });
}
function rectFromGhost(ghost) {
  return {
    left: parseFloat(ghost.style.left) || 0,
    top: parseFloat(ghost.style.top) || 0,
    width: parseFloat(ghost.style.width) || 0,
    height: parseFloat(ghost.style.height) || 0,
    borderRadius: ghost.style.borderRadius || "6px",
  };
}
async function animateStageModeGhost(
  ghost,
  toRect,
  radius = "6px",
  duration = STAGE_ZOOM_MS,
  options = {},
) {
  if (!ghost) return;
  const from = rectFromGhost(ghost);
  ghost.style.transition = "none";
  ghost.style.transform = "none";
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  const fromRadius = from.borderRadius || "6px";
  // The contained ghost owns geometry interpolation, so the surrounding stage never
  // reflows. The image remains object-fit:cover and hands off at the exact target rect.
  const keyframes = [
    {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      borderRadius: fromRadius,
    },
    {
      left: `${toRect.left}px`,
      top: `${toRect.top}px`,
      width: `${toRect.width}px`,
      height: `${toRect.height}px`,
      borderRadius: radius,
    },
  ];
  try {
    ghost.getAnimations?.().forEach((a) => a.cancel());
    const anim = ghost.animate(keyframes, {
      duration,
      easing: STAGE_ZOOM_EASE,
      fill: "forwards",
      composite: "replace",
    });
    const shade = ghost.querySelector(".stageModeGhostShade");
    const shadeFrom = Number.isFinite(options.shadeFrom)
      ? options.shadeFrom
      : 0;
    const shadeTo = Number.isFinite(options.shadeTo)
      ? options.shadeTo
      : shadeFrom;
    let shadeFinished = Promise.resolve();
    if (shade) {
      shade.style.opacity = String(shadeFrom);
      const shadeAnim = shade.animate(
        [{ opacity: shadeFrom }, { opacity: shadeTo }],
        { duration, easing: STAGE_ZOOM_EASE, fill: "forwards" },
      );
      shadeFinished = shadeAnim.finished.catch(() => {});
    }
    await Promise.all([anim.finished, shadeFinished]);
  } catch {
    /* Transition interrupted; cleanup will remove the ghost. */
  }
}
function activeGridCard() {
  const grid = $("stageGridView");
  if (!grid) return null;
  const id = currentId ? CSS.escape(currentId) : "";
  return (
    (id ? grid.querySelector(`.stageGridCard[data-id="${id}"]`) : null) ||
    grid.querySelector(".stageGridCard.on")
  );
}
function centerGridCard(card, behavior = "smooth") {
  const grid = $("stageGridView");
  if (!grid || !card) return Promise.resolve();
  const target = Math.max(
    0,
    card.offsetTop + card.offsetHeight / 2 - grid.clientHeight / 2,
  );
  if (Math.abs(grid.scrollTop - target) < 1) return waitFrames(1);
  if (behavior !== "smooth") {
    grid.scrollTo({ top: target, behavior: "auto" });
    return waitFrames(1);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      grid.removeEventListener?.("scrollend", finish);
      resolve();
    };
    grid.addEventListener?.("scrollend", finish, { once: true });
    grid.scrollTo({ top: target, behavior });
    setTimeout(finish, 320);
  });
}
async function ensureActiveGridCardVisible(behavior = "smooth") {
  const grid = $("stageGridView");
  if (!grid) return null;
  let active = activeGridCard();
  if (!active) {
    await renderStageGrid();
    await waitFrames(2);
    active = activeGridCard();
  }
  if (!active) return null;
  await centerGridCard(active, behavior);
  await waitFrames(2);
  return activeGridCard() || active;
}

function ensureStageGridActiveFrame() {
  const stage = document.querySelector(".stage");
  if (!stage) return null;
  let frame =
    stage.querySelector(":scope > .stageGridActiveFrame") ||
    stage.querySelector(".stageGridActiveFrame");
  if (!frame) {
    frame = document.createElement("div");
    frame.className = "stageGridActiveFrame";
    frame.setAttribute("aria-hidden", "true");
    stage.appendChild(frame);
  }
  return frame;
}
function updateStageGridActiveFrame(animate = true) {
  const stage = document.querySelector(".stage"),
    grid = $("stageGridView");
  if (!stage || !grid) return;
  const frame = ensureStageGridActiveFrame();
  const active = grid.querySelector(".stageGridCard.on");
  if (!frame || !active || active.style.visibility === "hidden") {
    if (frame) frame.style.opacity = "0";
    return;
  }
  const stageRect = stage.getBoundingClientRect();
  const gridRect = grid.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  const visible =
    activeRect.bottom > gridRect.top + 1 &&
    activeRect.top < gridRect.bottom - 1 &&
    activeRect.right > gridRect.left + 1 &&
    activeRect.left < gridRect.right - 1;
  if (!visible) {
    frame.style.opacity = "0";
    return;
  }
  frame.classList.toggle("noAnim", !animate);
  Object.assign(frame.style, {
    left: `${Math.round(activeRect.left - stageRect.left)}px`,
    top: `${Math.round(activeRect.top - stageRect.top)}px`,
    width: `${Math.round(activeRect.width)}px`,
    height: `${Math.round(activeRect.height)}px`,
    opacity: "1",
  });
  if (!animate) requestAnimationFrame(() => frame.classList.remove("noAnim"));
}
function updateStageGridSelection(animate = true) {
  const grid = $("stageGridView");
  if (!grid) return;
  grid
    .querySelectorAll(".stageGridCard")
    .forEach((card) =>
      card.classList.toggle("on", card.dataset.id === currentId),
    );
  updateStageGridActiveFrame(animate);
}

function updateStageModeButton() {
  const stage = document.querySelector(".stage"),
    btn = $("stageModeBtn"),
    label = $("stageModeLabel");
  const buttonMode = stageModeTarget || stageMode;
  stage?.classList.toggle("gridMode", stageMode === "grid");
  btn?.setAttribute("aria-pressed", buttonMode === "grid" ? "true" : "false");
  btn?.setAttribute("aria-disabled", stageModeInputLocked ? "true" : "false");
  btn?.setAttribute(
    "title",
    buttonMode === "grid" ? t("singlePreview") : t("gridPreview"),
  );
  btn?.setAttribute(
    "aria-label",
    buttonMode === "grid" ? t("singlePreview") : t("gridPreview"),
  );
  if (label)
    label.textContent =
      buttonMode === "grid" ? t("singleModeBtn") : t("gridModeBtn");
}
function settleStageTextForMode(mode = stageMode) {
  const stage = document.querySelector(".stage"),
    heroEl = document.querySelector(".heroText");
  const eyebrowEl = document.querySelector(".eyebrow"),
    titleEl = $("heroTitle");
  const gridFinal = mode === "grid";
  const titleDrop =
    parseFloat(
      getComputedStyle(heroEl || document.documentElement).getPropertyValue(
        "--title-drop",
      ),
    ) || 20;
  const gridY =
    parseFloat(
      getComputedStyle(heroEl || document.documentElement).getPropertyValue(
        "--grid-eyebrow-y",
      ),
    ) || 132;
  eyebrowEl?.getAnimations?.().forEach((a) => a.cancel());
  titleEl?.getAnimations?.().forEach((a) => a.cancel());
  if (eyebrowEl) {
    eyebrowEl.style.setProperty("transition", "none", "important");
    eyebrowEl.style.setProperty(
      "transform",
      `translate3d(0,${gridFinal ? gridY : titleDrop}px,0)`,
      "important",
    );
    eyebrowEl.style.setProperty("opacity", "1", "important");
  }
  if (titleEl) {
    titleEl.style.setProperty("transition", "none", "important");
    titleEl.style.setProperty(
      "transform",
      "translateY(var(--title-y,0px))",
      "important",
    );
    titleEl.style.setProperty("opacity", gridFinal ? "0" : "1", "important");
  }
  // Activate the final CSS selectors while the real nodes are pinned to the exact
  // same pixels. This prevents cleanup from briefly restoring the single-mode
  // coordinates and then starting a second CSS transition.
  stage?.classList.remove(
    "stageModeAnimatingToSingle",
    "stageModeAnimatingToGrid",
  );
  if (eyebrowEl) {
    eyebrowEl.style.removeProperty("opacity");
    eyebrowEl.style.removeProperty("transform");
  }
  if (titleEl) {
    titleEl.style.removeProperty("opacity");
    titleEl.style.removeProperty("transform");
  }
  // One batched style flush pins both real text nodes before transitions return.
  void stage?.offsetWidth;
  eyebrowEl?.style.removeProperty("transition");
  titleEl?.style.removeProperty("transition");
}
function handoffSingleToGridText() {
  settleStageTextForMode("grid");
  stageModeTitleGhost?.remove();
  stageModeTitleGhost = null;
  stageModeEyebrowGhost?.remove();
  stageModeEyebrowGhost = null;
}
function cleanupStageModeTransition() {
  const stage = document.querySelector(".stage"),
    grid = $("stageGridView");
  settleStageTextForMode(stageMode);
  const heroImgEl = $("heroImg");
  if (heroImgEl) {
    heroImgEl.style.removeProperty("transition");
    heroImgEl.style.removeProperty("opacity");
    heroImgEl.style.removeProperty("filter");
    heroImgEl.style.removeProperty("transform");
  }
  const backdropEl = document.querySelector(".stageBackdropSolid");
  if (backdropEl) {
    backdropEl.style.removeProperty("transition");
    backdropEl.style.removeProperty("opacity");
  }
  stageModeCurrentGhost?.remove();
  stageModeCurrentGhost = null;
  stageModeTitleGhost?.remove();
  stageModeTitleGhost = null;
  stageModeEyebrowGhost?.remove();
  stageModeEyebrowGhost = null;
  stageModeDraftHintGhost?.remove();
  stageModeDraftHintGhost = null;
  stageModeDraftBrandGhost?.remove();
  stageModeDraftBrandGhost = null;
  stageModeBlankGridAnimation?.cancel();
  stageModeBlankGridAnimation = null;
  const draftHintEl = $("heroDraftHint"),
    draftBrandEl = $("heroBrand");
  if (draftHintEl) {
    draftHintEl.style.removeProperty("transition");
    draftHintEl.style.removeProperty("opacity");
    draftHintEl.style.removeProperty("transform");
  }
  if (draftBrandEl) {
    draftBrandEl.style.removeProperty("transition");
    draftBrandEl.style.removeProperty("opacity");
    draftBrandEl.style.removeProperty("transform");
  }
  stage?.classList.remove("stageMeasureSingleTitle");
  if (stageModeHiddenCard) {
    stageModeHiddenCard.style.visibility = "";
    stageModeHiddenCard = null;
  }
  if (grid) {
    grid.style.opacity = "";
    grid.style.pointerEvents = "";
    grid.style.transition = "";
    grid.style.visibility = "";
    updateStageGridSelection(false);
  }
  stage?.classList.remove("stageModeAnimating");
  stageModeAnimating = false;
  stageModeTarget = null;
  updateStageModeButton();
  requestAnimationFrame(syncScrollCues);
  precacheStageThumbs();
}
