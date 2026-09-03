async function renderStageGrid(options = {}) {
  const grid = $("stageGridView");
  if (!grid) return;
  const fast = !!options.fast;
  const noAutoScroll = !!options.noAutoScroll;
  const force = !!options.force;
  const version = ++stageGridVersion;
  updateStageModeButton();
  if (stageMode !== "grid" && !force) return;
  const rows = prompts.slice();
  if (!rows.length) {
    grid.innerHTML = `<div class="stageGridEmpty">${esc(t("gridEmpty"))}</div>`;
    return;
  }
  const cards = new Array(rows.length);
  const hero = $("heroImg");
  const heroRatio =
    hero?.naturalWidth && hero?.naturalHeight
      ? Math.max(0.35, Math.min(3.2, hero.naturalWidth / hero.naturalHeight))
      : 1.58;
  let cardIndex = 0;
  const buildCard = async () => {
    while (cardIndex < rows.length) {
      const index = cardIndex++,
        p = rows[index],
        src = imgPath(p);
      let thumb = "",
        ratio = 1.58;
      if (fast) {
        const cachedThumb = thumbCache.get(src + "@520");
        thumb = cachedThumb || (isLocalImg(src) ? "" : pathUrl(src));
        ratio =
          imageMetaCache.get(src)?.ratio ||
          (p.id === currentId ? heroRatio : 1.58);
      } else {
        // The thumbnail load is also the authoritative dimension probe. This keeps
        // the very first grid and every later grid on exactly the same geometry.
        thumb = await resolveThumbSrc(src, 520);
        const meta = imageMetaCache.get(src) || (await resolveImageMeta(src));
        ratio = meta.ratio;
      }
      cards[index] = {
        p,
        src,
        thumb,
        ratio,
        layoutRatio: stageCardSize(ratio),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, buildCard),
  );
  if (version !== stageGridVersion) return;
  const gridStyle = getComputedStyle(grid),
    contentWidth =
      grid.clientWidth -
      (parseFloat(gridStyle.paddingLeft) || 0) -
      (parseFloat(gridStyle.paddingRight) || 0) -
      2;
  const layout = computeStageGridLayout(cards, contentWidth, 12, 172);
  const _oldFrameRect = options.flipFrame
    ? ensureStageGridActiveFrame()?.getBoundingClientRect()
    : null;
  grid.innerHTML = layout
    .map(({ item, w, h }) =>
      [
        `<button type="button" class="stageGridCard ${item.p.id === currentId ? "on" : ""}"`,
        ` data-id="${esc(item.p.id)}" data-src="${esc(item.src)}"`,
        ` style="--card-w:${w}px;--card-h:${h}px">`,
        item.thumb
          ? `<img src="${esc(item.thumb)}" alt="${esc(titleOf(item.p))}">`
          : `<span class="stageGridPlaceholder">${esc(titleOf(item.p))}</span>`,
        "</button>",
      ].join(""),
    )
    .join("");
  ensureStageGridActiveFrame();
  bindStageGridCards();
  updateStageGridActiveFrame(false);
  // Move the persistent selection frame with a FLIP transform.
  if (options.flipFrame && _oldFrameRect) {
    const _frame = ensureStageGridActiveFrame();
    if (_frame && _frame.style.opacity !== "0") {
      const _newRect = _frame.getBoundingClientRect();
      const _dx = _oldFrameRect.left - _newRect.left,
        _dy = _oldFrameRect.top - _newRect.top;
      if (Math.abs(_dx) > 1 || Math.abs(_dy) > 1) {
        _frame.classList.add("noAnim");
        _frame.style.transform = `translate(${_dx}px,${_dy}px)`;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            _frame.classList.remove("noAnim");
            _frame.style.transform = "";
          }),
        );
      }
    }
  }
  if (!noAutoScroll) requestAnimationFrame(() => scrollStageGridActive("auto"));
  requestAnimationFrame(syncScrollCues);
}

/* Background pre-warm of grid thumbnails (520px) + image metadata for every prompt.
   Both resolveThumbSrc and resolveImageMeta share the IndexedDB read + canvas resize,
   so warming them once makes the grid→single zoom and the single→grid rebuild hit the
   cache instantly. Fire-and-forget; each call bumps a version that aborts stale work. */
let stageThumbPrecacheVersion = 0,
  stageThumbPrecacheIdle = 0;
function cancelStageThumbPrecache() {
  stageThumbPrecacheVersion++;
  cancelIdle(stageThumbPrecacheIdle);
  stageThumbPrecacheIdle = 0;
}
function precacheStageThumbs() {
  cancelStageThumbPrecache();
  const version = stageThumbPrecacheVersion;
  stageThumbPrecacheIdle = scheduleIdle(() => {
    stageThumbPrecacheIdle = 0;
    if (version !== stageThumbPrecacheVersion || stageModeAnimating) return;
    const rows = prompts
      .slice()
      .sort(
        (a, b) => (b.id === currentId ? 1 : 0) - (a.id === currentId ? 1 : 0),
      );
    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        if (version !== stageThumbPrecacheVersion || stageModeAnimating) return;
        const p = rows[idx++],
          src = imgPath(p);
        if (!src) continue;
        await Promise.all([resolveThumbSrc(src, 520), resolveImageMeta(src)]);
      }
    };
    Promise.all(Array.from({ length: Math.min(2, rows.length) }, worker)).catch(
      (err) => reportError("precache stage thumbs", err),
    );
  }, 1400);
}

/* After the single→grid zoom, upgrade grid cards in place instead of rebuilding
   innerHTML. Fills any card still showing a placeholder with its real thumbnail,
   and only triggers one (now fully cached, so near-instant) full re-layout when a
   card's ratio was a fallback at fast-render time. Avoids the lazy-load flash. */
async function upgradeStageGridCards() {
  const grid = $("stageGridView");
  if (!grid || stageMode !== "grid") return;
  const version = stageGridVersion;
  const cards = [...grid.querySelectorAll(".stageGridCard")];
  if (!cards.length) return;
  let needsRelayout = false;
  const CONCURRENCY = 4;
  let idx = 0;
  const worker = async () => {
    while (idx < cards.length) {
      if (version !== stageGridVersion) return;
      const card = cards[idx++];
      const src = card.dataset.src;
      if (!src) continue;
      const hadMeta = imageMetaCache.has(src);
      const thumb = await resolveThumbSrc(src, 520);
      await resolveImageMeta(src);
      if (version !== stageGridVersion) return;
      if (!hadMeta) needsRelayout = true;
      if (!thumb) continue;
      const existing = card.querySelector("img");
      if (existing && existing.getAttribute("src")) continue;
      const ph = card.querySelector(".stageGridPlaceholder");
      if (ph) ph.remove();
      let im = existing;
      if (!im) {
        im = document.createElement("img");
        im.alt = "";
        card.insertBefore(im, card.firstChild);
      }
      im.src = thumb;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (version !== stageGridVersion) return;
  if (needsRelayout) await renderStageGrid();
}
async function selectStageGridPrompt(id) {
  const p = prompts.find((x) => x.id === id);
  if (!p) return;
  if (id === currentId) {
    const imgs = imagesOf(p);
    if (imgs.length) openLightbox(imgPath(p) || imgs[0], imgs);
    return;
  }
  listFilter = "all";
  restoreSavedPrompt(currentId);
  setPromptExpanded(false, true);
  const form = $("form");
  if (form) form.scrollTop = 0;
  if (draft && draft.id !== id) draft = null;
  currentId = id;
  updateStageGridSelection(true);
  await renderForm({ skipStageGrid: true });
  updateStageGridSelection(true);
  requestAnimationFrame(() => scrollActiveListItem("smooth"));
}
function gridCardRects(grid = $("stageGridView")) {
  const out = new Map();
  grid
    ?.querySelectorAll(".stageGridCard")
    .forEach((el) => out.set(el.dataset.id, el.getBoundingClientRect()));
  return out;
}
function animateStageGridShift(before) {
  const grid = $("stageGridView");
  if (!grid) return;
  grid.querySelectorAll(".stageGridCard").forEach((el) => {
    if (el.classList.contains("dragging")) return;
    const old = before.get(el.dataset.id);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left,
      dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px,${dy}px)`;
    el.offsetHeight;
    el.style.transition =
      "transform .32s cubic-bezier(.25,.46,.45,.94),background-color .8s cubic-bezier(.25,.46,.45,.94),border-color .22s ease,box-shadow .22s ease,filter .22s ease,opacity .18s ease";
    el.style.transform = "";
    setTimeout(() => {
      el.style.transition = "";
      el.style.transform = "";
    }, 340);
  });
}
function movePromptBefore(dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId) return;
  const from = prompts.findIndex((p) => p.id === dragId),
    to = prompts.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0) return;
  const grid = $("stageGridView"),
    dragEl = grid?.querySelector(
      `.stageGridCard[data-id="${CSS.escape(dragId)}"]`,
    ),
    targetEl = grid?.querySelector(
      `.stageGridCard[data-id="${CSS.escape(targetId)}"]`,
    );
  if (!grid || !dragEl || !targetEl) return;
  const before = gridCardRects(grid);
  const [moved] = prompts.splice(from, 1);
  prompts.splice(to, 0, moved);
  prompts.forEach((p, i) => {
    p.gridOrder = i + 1;
    p.orderVersion = 2;
  });
  if (from < to) grid.insertBefore(dragEl, targetEl.nextSibling);
  else grid.insertBefore(dragEl, targetEl);
  animateStageGridShift(before);
}
function startStageGridDrag(card, e) {
  const grid = $("stageGridView");
  if (!grid) return;
  stageDrag = {
    id: card.dataset.id,
    card,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    orderState: capturePromptOrderState(),
  };
  card.classList.add("dragging");
  card.setPointerCapture?.(e.pointerId);
}
function updateStageGridDrag(e) {
  if (!stageDrag) return;
  const dx = e.clientX - stageDrag.startX,
    dy = e.clientY - stageDrag.startY;
  stageDrag.card.style.transform = `translate(${dx}px,${dy}px) scale(1.035)`;
  stageDrag.card.style.pointerEvents = "none";
  const under = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest?.(".stageGridCard");
  stageDrag.card.style.pointerEvents = "";
  if (under && under !== stageDrag.card) {
    stageDrag.moved = true;
    movePromptBefore(stageDrag.id, under.dataset.id);
  }
}
async function finishStageGridDrag() {
  if (!stageDrag) return;
  const state = stageDrag,
    card = state.card,
    moved = state.moved;
  card.classList.remove("dragging");
  card.style.transform = "";
  card.style.pointerEvents = "";
  stageDrag = null;
  if (!moved) return;

  try {
    await saveAll();
  } catch (err) {
    restorePromptOrderState(state.orderState);
    renderList();
    try {
      await renderStageGrid({ fast: true, noAutoScroll: true, force: true });
    } catch (renderError) {
      reportError("restore grid order view", renderError);
    }
    reportError("save grid order", err);
    return;
  }

  try {
    renderList();
    await renderStageGrid();
    scrollActiveListItem("auto");
  } catch (err) {
    // Persistence already succeeded; keep the durable order and only report UI refresh failure.
    reportError("refresh saved grid order", err);
  }
}
function bindStageGridCards() {
  $("stageGridView")
    ?.querySelectorAll(".stageGridCard")
    .forEach((card) => {
      let hold = null,
        down = false,
        startX = 0,
        startY = 0;
      card.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        down = true;
        startX = e.clientX;
        startY = e.clientY;
        card.setPointerCapture?.(e.pointerId);
        hold = setTimeout(() => {
          if (down) startStageGridDrag(card, e);
        }, 240);
      };
      card.onpointermove = (e) => {
        if (!down) return;
        if (stageDrag) {
          e.preventDefault();
          updateStageGridDrag(e);
          return;
        }
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
          clearTimeout(hold);
        }
      };
      card.onpointerup = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(hold);
        down = false;
        if (stageDrag) {
          await finishStageGridDrag();
          return;
        }
        await selectStageGridPrompt(card.dataset.id);
      };
      card.onpointercancel = () => {
        clearTimeout(hold);
        down = false;
        finishStageGridDrag();
      };
    });
}
