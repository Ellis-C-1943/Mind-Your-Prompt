function capturePromptOrderState() {
  return {
    order: prompts.map((prompt) => prompt.id),
    values: prompts.map((prompt) => ({
      id: prompt.id,
      gridOrder: prompt.gridOrder,
      orderVersion: prompt.orderVersion,
    })),
  };
}

function restorePromptOrderState(state) {
  if (!state) return;
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  prompts = state.order.map((id) => byId.get(id)).filter(Boolean);
  state.values.forEach((saved) => {
    const prompt = byId.get(saved.id);
    if (prompt) {
      prompt.gridOrder = saved.gridOrder;
      prompt.orderVersion = saved.orderVersion;
    }
  });
  sortPrompts();
}

function beginPromptOrderEdit(button, event) {
  event?.preventDefault();
  event?.stopPropagation();
  const item = button.closest(".item"),
    zone = button.closest(".numEditZone");
  const p = prompts.find((x) => x.id === item?.dataset.id);
  const valueEl = zone?.querySelector(".numValue");
  if (!item || !zone || !p || !valueEl || zone.classList.contains("editing"))
    return;
  zone.classList.add("editing");
  const input = document.createElement("input");
  input.className = "orderInput";
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", t("editOrder"));
  input.value = promptOrderLabel(p);
  valueEl.replaceWith(input);
  let finished = false;
  const cancel = () => {
    if (finished) return;
    finished = true;
    renderList();
  };
  const commit = async () => {
    if (finished) return;
    finished = true;
    const value = parsePromptOrderInput(input.value);
    if (value === null) {
      renderList();
      return;
    }
    if (promptOrderValue(p) === value) {
      renderList();
      return;
    }
    const previousOrderState = capturePromptOrderState();
    assignPromptOrderWithSwap(p, value);
    try {
      await saveAll();
    } catch (err) {
      restorePromptOrderState(previousOrderState);
      renderList();
      reportError("save prompt order", err);
      return;
    }
    try {
      await refreshPromptOrderViews(p.id);
    } catch (err) {
      reportError("refresh prompt order", err);
    }
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit, { once: true });
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  requestAnimationFrame(() => {
    if (!finished) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
function renderList() {
  const q = $("search").value.trim().toLowerCase();
  document
    .querySelectorAll(".filterBtn")
    .forEach((btn) =>
      btn.classList.toggle("on", btn.dataset.filter === listFilter),
    );
  const rows = prompts.filter((p) => matchList(p, q));
  $("count").textContent = prompts.length;
  const list = $("list");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${esc(t("emptyMsg"))}</div>`;
    updateListActiveFrame();
    return;
  }
  list.innerHTML = rows
    .map((p, i) => {
      const mode = modeOf(p),
        src = imgPath(p),
        cached = thumbCache.get(src + "@320") || "";
      return [
        `<div class="item ${p.id === currentId ? "on" : ""}" data-id="${esc(p.id)}">`,
        `<div class="thumb">${cached ? `<img src="${esc(cached)}" alt="">` : ""}</div>`,
        '<div class="entryBody">',
        '<div class="num numEditZone">',
        `<span class="numValue">${esc(promptOrderLabel(p, i))}</span>`,
        `<button type="button" class="orderEditBtn" aria-label="${esc(t("editOrder"))}" title="${esc(t("editOrder"))}">`,
        '<svg viewBox="0 0 14 14" aria-hidden="true">',
        '<path d="M6.5 2.5h-3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3"/>',
        '<path d="m7.25 9.75-2.75.75.75-2.75 4.9-4.9a1.06 1.06 0 0 1 1.5 1.5z"/>',
        '<path d="m9.45 3.55 1.5 1.5"/>',
        "</svg></button></div>",
        `<h3>${esc(titleOf(p))}</h3>`,
        `<div class="metaPills"><span class="modelName">${esc(p.model || t("noModel"))}</span></div>`,
        `<div class="itemMode">${esc(mode)}</div>`,
        "</div></div>",
      ].join("");
    })
    .join("");
  bindListItemInteractions();
  updateListActiveFrame();
  if (stageMode === "grid")
    requestAnimationFrame(() => scrollActiveListItem("smooth"));
  const version = Date.now() + Math.random();
  renderList._version = version;
  cancelIdle(renderList._thumbIdle);
  const pendingRows = rows.filter((p) => {
    const src = imgPath(p);
    return src && !thumbCache.has(src + "@320");
  });
  if (!pendingRows.length) return;
  renderList._thumbIdle = scheduleIdle(() => {
    renderList._thumbIdle = 0;
    let index = 0;
    const worker = async () => {
      while (index < pendingRows.length) {
        if (renderList._version !== version) return;
        const p = pendingRows[index++],
          src = await resolveThumbSrc(imgPath(p), 320);
        if (renderList._version !== version) return;
        const thumb = list.querySelector(
          `.item[data-id="${CSS.escape(p.id)}"] .thumb`,
        );
        if (!thumb || !src) continue;
        const img = thumb.querySelector("img");
        if (img) img.src = src;
        else thumb.innerHTML = `<img src="${esc(src)}" alt="">`;
      }
    };
    Promise.all(
      Array.from({ length: Math.min(2, pendingRows.length) }, worker),
    ).catch((err) => reportError("render list thumbs", err));
  }, 1100);
}

function listItemRects(list = $("list")) {
  const out = new Map();
  list
    ?.querySelectorAll(".item")
    .forEach((el) => out.set(el.dataset.id, el.getBoundingClientRect()));
  return out;
}
function animateListShift(before) {
  const list = $("list");
  if (!list) return;
  list.querySelectorAll(".item").forEach((el) => {
    if (el.classList.contains("listDragSource")) return;
    const old = before.get(el.dataset.id);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dy = old.top - now.top;
    if (Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translate3d(0,${dy}px,0)`;
    el.offsetHeight;
    clearTimeout(el._listShiftTimer);
    el.style.transition =
      "transform .38s cubic-bezier(.2,1.08,.3,1),background-color .26s cubic-bezier(.25,.46,.45,.94),box-shadow .34s cubic-bezier(.25,.46,.45,.94),border-color .34s cubic-bezier(.25,.46,.45,.94)";
    el.style.transform = "";
    el._listShiftTimer = setTimeout(() => {
      if (!el.classList.contains("listDragSource")) {
        el.style.transition = "";
        el.style.transform = "";
      }
    }, 410);
  });
}
function syncVisiblePromptNumbers() {
  const list = $("list");
  if (!list) return;
  list.querySelectorAll(".item").forEach((el) => {
    const prompt = prompts.find((p) => p.id === el.dataset.id),
      value = el.querySelector(".numValue");
    if (prompt && value) value.textContent = promptOrderLabel(prompt);
  });
}
function moveListPromptRelative(dragId, targetId, placeAfter) {
  if (!dragId || !targetId || dragId === targetId) return false;
  const list = $("list"),
    dragEl = list?.querySelector(`.item[data-id="${CSS.escape(dragId)}"]`),
    targetEl = list?.querySelector(`.item[data-id="${CSS.escape(targetId)}"]`);
  if (!list || !dragEl || !targetEl) return false;
  if (placeAfter && dragEl.previousElementSibling === targetEl) return false;
  if (!placeAfter && dragEl.nextElementSibling === targetEl) return false;
  const before = listItemRects(list);
  const from = prompts.findIndex((p) => p.id === dragId);
  if (from < 0) return false;
  const [moved] = prompts.splice(from, 1);
  const targetIndex = prompts.findIndex((p) => p.id === targetId);
  if (targetIndex < 0) {
    prompts.splice(from, 0, moved);
    return false;
  }
  prompts.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
  renumberPromptsByPosition();
  if (placeAfter) list.insertBefore(dragEl, targetEl.nextSibling);
  else list.insertBefore(dragEl, targetEl);
  syncVisiblePromptNumbers();
  animateListShift(before);
  updateListActiveFrame();
  syncScrollCues();
  return true;
}
function updateListDragTarget() {
  if (!listDrag) return;
  const { clientX, clientY, source } = listDrag;
  source.style.pointerEvents = "none";
  const target = document
    .elementFromPoint(clientX, clientY)
    ?.closest?.(".item");
  source.style.pointerEvents = "";
  if (!target || target === source || !target.closest("#list")) return;
  const rect = target.getBoundingClientRect();
  const after = clientY > rect.top + rect.height / 2;
  if (moveListPromptRelative(listDrag.id, target.dataset.id, after))
    listDrag.moved = true;
}
function stopListDragAutoScroll() {
  if (listDragAutoScrollRaf) cancelAnimationFrame(listDragAutoScrollRaf);
  listDragAutoScrollRaf = 0;
}
function runListDragAutoScroll() {
  stopListDragAutoScroll();
  const tick = () => {
    if (!listDrag) {
      listDragAutoScrollRaf = 0;
      return;
    }
    const list = $("list"),
      rect = list?.getBoundingClientRect();
    if (!list || !rect) {
      listDragAutoScrollRaf = 0;
      return;
    }
    const edge = 52,
      y = listDrag.clientY;
    let velocity = 0;
    if (y < rect.top + edge)
      velocity = -Math.min(14, Math.max(2, (rect.top + edge - y) * 0.28));
    else if (y > rect.bottom - edge)
      velocity = Math.min(14, Math.max(2, (y - (rect.bottom - edge)) * 0.28));
    if (velocity) {
      const before = list.scrollTop;
      list.scrollTop = Math.max(
        0,
        Math.min(
          list.scrollHeight - list.clientHeight,
          list.scrollTop + velocity,
        ),
      );
      if (list.scrollTop !== before) {
        updateListDragTarget();
        updateListActiveFrame();
        syncScrollCues();
      }
    }
    listDragAutoScrollRaf = requestAnimationFrame(tick);
  };
  listDragAutoScrollRaf = requestAnimationFrame(tick);
}
function handleListDragPointerMove(event) {
  if (!listDrag || event.pointerId !== listDrag.pointerId) return;
  event.preventDefault();
  updateListItemDrag(event);
}
function handleListDragPointerEnd(event) {
  if (!listDrag || event.pointerId !== listDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  finishListItemDrag(event.type === "pointercancel");
}
function bindListDragPointerWindow() {
  window.addEventListener("pointermove", handleListDragPointerMove, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", handleListDragPointerEnd, true);
  window.addEventListener("pointercancel", handleListDragPointerEnd, true);
}
function unbindListDragPointerWindow() {
  window.removeEventListener("pointermove", handleListDragPointerMove, true);
  window.removeEventListener("pointerup", handleListDragPointerEnd, true);
  window.removeEventListener("pointercancel", handleListDragPointerEnd, true);
}
function activateListItemForDrag(item) {
  const list = $("list"),
    nextId = item?.dataset.id;
  if (!list || !nextId) return false;
  const changed = nextId !== currentId;
  if (changed) {
    restoreSavedPrompt(currentId);
    if (draft && draft.id !== nextId) draft = null;
    currentId = nextId;
  }
  list.querySelectorAll(".item.on").forEach((el) => {
    if (el !== item) el.classList.remove("on");
  });
  item.classList.add("on");
  // Keep the same persistent selection frame and move it with its existing
  // transform transition. Recreating the frame here would make it flash.
  updateListActiveFrame();
  return changed;
}
function startListItemDrag(item, pointerId, clientX, clientY) {
  const list = $("list");
  if (!list || listDrag || !item) return;
  const selectionChanged = activateListItemForDrag(item);
  const rect = item.getBoundingClientRect(),
    ghost = item.cloneNode(true);
  ghost.classList.remove("on", "listDragSource");
  ghost.classList.add("listDragGhost");
  ghost.removeAttribute("data-id");
  ghost
    .querySelectorAll("button,input")
    .forEach((el) => el.setAttribute("tabindex", "-1"));
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.appendChild(ghost);
  item.classList.add("listDragSource");
  document.body.classList.add("listDragActive");
  list.classList.add("isListDragging");
  listDrag = {
    id: item.dataset.id,
    source: item,
    ghost,
    pointerId,
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top,
    clientX,
    clientY,
    moved: false,
    scrollTop: list.scrollTop,
    selectionChanged,
    orderState: capturePromptOrderState(),
  };
  item.setPointerCapture?.(pointerId);
  bindListDragPointerWindow();
  runListDragAutoScroll();
}
function updateListItemDrag(event) {
  if (!listDrag) return;
  listDrag.clientX = event.clientX;
  listDrag.clientY = event.clientY;
  const x = event.clientX - listDrag.offsetX,
    y = event.clientY - listDrag.offsetY;
  // Move only. The text, labels and thumbnail keep their exact size; a
  // dedicated pseudo-element handles the small expanding glow-frame effect.
  listDrag.ghost.style.transform = `translate3d(${Math.round(x - parseFloat(listDrag.ghost.style.left))}px,${Math.round(y - parseFloat(listDrag.ghost.style.top))}px,0)`;
  updateListDragTarget();
}
async function finishListDragSelection(state, scrollTop, skipStageGrid = true) {
  if (!state?.selectionChanged) return;
  try {
    setPromptExpanded(false, true);
    const form = $("form");
    if (form) form.scrollTop = 0;
    // The persistent list frame is already on the long-pressed project. Only
    // refresh the editor/stage here, after the drag DOM has finished moving.
    await transitionView(async () => {
      await renderForm({ skipStageGrid });
    });
    const list = $("list");
    if (list && Number.isFinite(scrollTop)) list.scrollTop = scrollTop;
    updateListActiveFrame();
    syncScrollCues();
  } catch (err) {
    reportError("refresh long-press selection", err);
  }
}
async function finishListItemDrag(cancel = false) {
  if (!listDrag) return;
  const state = listDrag;
  listDrag = null;
  stopListDragAutoScroll();
  unbindListDragPointerWindow();
  const liveList = $("list"),
    scrollTop = liveList?.scrollTop ?? state.scrollTop;
  state.source.classList.remove("listDragSource");
  state.source.style.pointerEvents = "";
  state.ghost.remove();
  document.body.classList.remove("listDragActive");
  liveList?.classList.remove("isListDragging");
  listDragSuppressClickUntil = performance.now() + 320;
  if (cancel && state.moved) {
    restorePromptOrderState(state.orderState);
    renderList();
    const list = $("list");
    if (list) list.scrollTop = scrollTop;
    await finishListDragSelection(state, scrollTop, true);
    return;
  }
  if (!state.moved) {
    updateListActiveFrame();
    await finishListDragSelection(state, scrollTop, true);
    return;
  }
  try {
    await saveAll();
  } catch (err) {
    restorePromptOrderState(state.orderState);
    renderList();
    const list = $("list");
    if (list) list.scrollTop = scrollTop;
    await finishListDragSelection(state, scrollTop, false);
    reportError("save list order", err);
    return;
  }

  try {
    renderList();
    const list = $("list");
    if (list) list.scrollTop = scrollTop;
    await renderStageGrid({ fast: true, noAutoScroll: true, force: true });
    if (list) list.scrollTop = scrollTop;
    updateListActiveFrame();
    syncScrollCues();
    await finishListDragSelection(state, scrollTop, true);
  } catch (err) {
    // The order is already durable. A render failure must not roll it back.
    reportError("refresh saved list order", err);
  }
}
function bindListItemInteractions() {
  const list = $("list");
  if (list && !list.dataset.selectionGuard) {
    list.dataset.selectionGuard = "1";
    list.addEventListener(
      "selectstart",
      (event) => {
        if (event.target.closest?.(".orderInput")) return;
        event.preventDefault();
      },
      true,
    );
    list.addEventListener(
      "dragstart",
      (event) => {
        if (event.target.closest?.(".orderInput")) return;
        event.preventDefault();
      },
      true,
    );
  }
  document.querySelectorAll(".item").forEach((item) => {
    let hold = 0,
      down = false,
      startX = 0,
      startY = 0,
      pointerId = null;
    const detachWindowRelease = () => {
      window.removeEventListener("pointerup", handleWindowRelease, true);
      window.removeEventListener("pointercancel", handleWindowRelease, true);
    };
    const clearPendingPress = () => {
      clearTimeout(hold);
      hold = 0;
      down = false;
      detachWindowRelease();
    };
    const handleWindowRelease = (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      clearPendingPress();
    };
    item.onclick = (e) => {
      if (performance.now() < listDragSuppressClickUntil) return;
      if (e.target.closest(".numEditZone")) return;
      select(item.dataset.id);
    };
    item.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest(".numEditZone,button,input"))
        return;
      clearPendingPress();
      down = true;
      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      item.setPointerCapture?.(e.pointerId);
      window.addEventListener("pointerup", handleWindowRelease, true);
      window.addEventListener("pointercancel", handleWindowRelease, true);
      // Every project can enter reordering by long-press. If it was not the
      // current project, startListItemDrag selects it first and then drags it.
      hold = setTimeout(() => {
        hold = 0;
        detachWindowRelease();
        const liveList = $("list");
        if (!down || !item.isConnected || item.closest("#list") !== liveList) {
          down = false;
          return;
        }
        startListItemDrag(item, pointerId, startX, startY);
      }, 260);
    };
    item.onpointermove = (e) => {
      if (!down) return;
      if (listDrag) {
        e.preventDefault();
        return;
      }
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 7)
        clearPendingPress();
    };
    item.onpointerup = (e) => {
      clearPendingPress();
      if (listDrag) {
        e.preventDefault();
        e.stopPropagation();
        finishListItemDrag(false);
      }
    };
    item.onpointercancel = () => {
      clearPendingPress();
      if (listDrag) finishListItemDrag(true);
    };
  });
  document
    .querySelectorAll(".orderEditBtn")
    .forEach((btn) => (btn.onclick = (e) => beginPromptOrderEdit(btn, e)));
  document
    .querySelectorAll(".numEditZone")
    .forEach((zone) => (zone.onpointerdown = (e) => e.stopPropagation()));
}

function scrollActiveListItem(behavior = "smooth") {
  const list = $("list"),
    active = list?.querySelector(".item.on");
  if (!list || !active) return;
  const target =
    active.offsetTop + active.offsetHeight / 2 - list.clientHeight / 2;
  list.scrollTo({ top: Math.max(0, target), behavior });
  requestAnimationFrame(updateListActiveFrame);
}
function scrollStageGridActive(behavior = "smooth") {
  if (stageMode !== "grid") return;
  const grid = $("stageGridView"),
    active = grid?.querySelector(".stageGridCard.on");
  if (!grid || !active) return;
  const target =
    active.offsetTop + active.offsetHeight / 2 - grid.clientHeight / 2;
  grid.scrollTo({ top: Math.max(0, target), behavior });
}
