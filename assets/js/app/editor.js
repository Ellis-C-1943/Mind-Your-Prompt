let renderFormVersion = 0;

async function renderForm(options = {}) {
  const version = ++renderFormVersion;
  updateStageModeButton();

  const p = current();
  const promptId = p.id;
  const isActive = () =>
    version === renderFormVersion && currentId === promptId;
  const imgs = imagesOf(p);
  const srcs = sourceImagesOf(p);
  const has = imgs.length > 0;
  const hasSource = srcs.length > 0;

  setImages(p, imgs);
  setSourceImages(p, srcs);
  $("title").value = p.title || "";
  $("prompt").value = p.prompt || "";
  $("modelName").value = p.model || "";
  $("modelDrop").classList.remove("open");
  updateDraftBrand(p.title || "");
  layoutHeroTitle(p.title || "MYP");
  renderList();

  const mainImagePath = imgPath(p);
  const mainSrc = await resolveImgSrc(mainImagePath);
  if (!isActive()) return false;

  const heroImgEl = $("heroImg");
  heroImgEl.dataset.source = mainImagePath || "";
  heroImgEl.src = mainSrc;
  heroImgEl.style.display = mainSrc ? "block" : "none";
  document.querySelector(".stage").classList.toggle("hasImage", !!mainSrc);
  $("uploadPreview").src = mainSrc;
  $("uploadBox").classList.toggle("hasImage", has);
  $("uploadTitle").textContent = has
    ? countText(imgs.length, "imgUploaded", "imgsUploaded")
    : t("uploadImage");
  $("uploadHint").textContent = has ? t("clickContinueImage") : t("uploadHint");
  $("imageName").textContent = has ? t("clickPreview") : t("noImage");
  $("imageStrip").classList.toggle("on", has);
  $("imageStrip").style.setProperty("--thumb-count", Math.max(1, imgs.length));

  const imgEntries = await Promise.all(
    imgs.map(async (src) => [src, await resolveImgSrc(src)]),
  );
  if (!isActive()) return false;
  const imgSrcs = Object.fromEntries(imgEntries);
  $("imageStrip").innerHTML = imgs
    .map((src) =>
      [
        `<button type="button" class="imageThumb" data-src="${esc(src)}">`,
        `<img src="${esc(imgSrcs[src] || "")}" alt="">`,
        `<span class="imgDel" data-del="${esc(src)}">`,
        '<svg viewBox="0 0 12 12" aria-hidden="true">',
        '<line x1="2" y1="2" x2="10" y2="10"/>',
        '<line x1="10" y1="2" x2="2" y2="10"/>',
        "</svg></span></button>",
      ].join(""),
    )
    .join("");
  document
    .querySelectorAll(".imageThumb:not(.sourceThumb)")
    .forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        openLightbox(button.dataset.src, imagesOf(current())).catch((error) =>
          reportError("open generated preview", error),
        );
      };
      button.querySelector(".imgDel")?.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSingleImage(button.dataset.src, "generated").catch((error) =>
          reportError("delete generated image", error),
        );
      });
    });

  const sourceMainSrc = await resolveImgSrc(srcs[0] || "");
  if (!isActive()) return false;
  $("sourcePreview").src = sourceMainSrc;
  $("sourceBox").classList.toggle("hasImage", hasSource);
  $("sourceTitle").textContent = hasSource
    ? countText(srcs.length, "srcUploaded", "srcsUploaded")
    : t("uploadSource");
  $("sourceHint").textContent = hasSource
    ? t("clickContinueSource")
    : t("uploadHint");
  $("sourceName").textContent = hasSource ? t("clickPreview") : t("noSource");
  $("sourceStrip").classList.toggle("on", hasSource);
  $("sourceStrip").style.setProperty("--thumb-count", Math.max(1, srcs.length));

  const srcEntries = await Promise.all(
    srcs.map(async (src) => [src, await resolveImgSrc(src)]),
  );
  if (!isActive()) return false;
  const sourceImages = Object.fromEntries(srcEntries);
  $("sourceStrip").innerHTML = srcs
    .map((src) =>
      [
        `<button type="button" class="imageThumb sourceThumb" data-src="${esc(src)}">`,
        `<img src="${esc(sourceImages[src] || "")}" alt="">`,
        `<span class="imgDel" data-del="${esc(src)}">`,
        '<svg viewBox="0 0 12 12" aria-hidden="true">',
        '<line x1="2" y1="2" x2="10" y2="10"/>',
        '<line x1="10" y1="2" x2="2" y2="10"/>',
        "</svg></span></button>",
      ].join(""),
    )
    .join("");
  document.querySelectorAll(".sourceThumb").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openLightbox(button.dataset.src, sourceImagesOf(current())).catch(
        (error) => reportError("open source preview", error),
      );
    };
    button.querySelector(".imgDel")?.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSingleImage(button.dataset.src, "source").catch((error) =>
        reportError("delete source image", error),
      );
    });
  });

  if (options.skipStageGrid) {
    updateStageGridSelection(true);
  } else if (stageMode === "grid") {
    await renderStageGrid(options);
    if (!isActive()) return false;
  } else {
    requestAnimationFrame(() => {
      if (!isActive()) return;
      renderStageGrid({ fast: true, noAutoScroll: true, force: true }).catch(
        (error) => reportError("prebuild stage grid", error),
      );
    });
  }

  if (!isActive()) return false;
  renderList();
  scheduleMediaFit();
  precacheStageThumbs();
  const title = p.title || "MYP";
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (isActive()) layoutHeroTitle(title);
    }),
  );
  return true;
}

async function select(nextId) {
  if (nextId === currentId) return;
  restoreSavedPrompt(currentId);
  resetPromptBeforeSwitch();
  await transitionView(async () => {
    if (draft && draft.id !== nextId) draft = null;
    currentId = nextId;
    await renderForm({ flipFrame: true });
  });
}

async function saveCurrent() {
  syncFromForm({ force: true });
  const p = current();
  if (!saved(p) && empty(p)) return false;

  const wasDraft = !saved(p);
  if (wasDraft) {
    p.gridOrder = nextPromptOrder();
    p.orderVersion = 2;
    prompts.push(p);
    draft = null;
  }
  sortPrompts();

  try {
    await saveAll();
  } catch (error) {
    if (wasDraft) {
      prompts = prompts.filter((item) => item.id !== p.id);
      draft = p;
      currentId = p.id;
    }
    throw error;
  }

  await renderForm();
  return true;
}

async function startDraft() {
  restoreSavedPrompt(currentId);
  resetPromptBeforeSwitch();
  await transitionView(async () => {
    draft = blank();
    currentId = draft.id;
    await renderForm();
  });
}

function validImage(file) {
  const validType =
    /\.(jpe?g|png)$/i.test(file.name) || /image\/(jpeg|png)/.test(file.type);
  return validType && file.size <= MAX_IMAGE_BYTES;
}

async function deleteDirectImages(images) {
  for (const image of [...new Set(images.filter(Boolean))]) {
    await api("/api/delete-image", {
      method: "POST",
      body: JSON.stringify({ image }),
    });
  }
}

function referencedImageSet() {
  const references = new Set();
  const add = (prompt) => {
    imagesOf(prompt).forEach((image) => references.add(image));
    sourceImagesOf(prompt).forEach((image) => references.add(image));
  };
  prompts.forEach(add);
  if (draft && !saved(draft)) add(draft);
  return references;
}

function unreferencedImages(candidates) {
  const references = referencedImageSet();
  return [
    ...new Set(candidates.filter((image) => image && !references.has(image))),
  ];
}

function captureAppState() {
  return {
    prompts: cloneData(prompts),
    draft: draft ? cloneData(draft) : null,
    currentId,
  };
}

function restoreAppState(state) {
  prompts = cloneData(state.prompts);
  // savedPrompts tracks the latest successful queued write and must not be
  // replaced by a rollback snapshot captured before another save completed.
  draft = state.draft ? cloneData(state.draft) : null;
  currentId = state.currentId;
}

async function uploadFiles(fileList, target = "generated") {
  const files = [...fileList].filter(Boolean);
  if (!files.length) return;
  const invalidFiles = files.filter((file) => !validImage(file));
  if (invalidFiles.length) {
    invalidFiles.forEach((file) =>
      console.error(
        "[MYP] image upload rejected:",
        file.name,
        file.size,
        "bytes. Only JPG/PNG up to 80MB is allowed.",
      ),
    );
    return;
  }

  syncFromForm({ force: true });
  const p = current();
  const wasDraft = !saved(p);
  const previousGenerated = imagesOf(p);
  const previousSource = sourceImagesOf(p);
  const previousDates = cloneData(p.imageDates || {});
  const nextImages =
    target === "source" ? [...previousSource] : [...previousGenerated];
  const uploaded = [];

  try {
    for (const file of files) {
      const data = await localFileToDataUrl(file);
      const modified = new Date(file.lastModified || Date.now()).toISOString();
      const out = await api("/api/image", {
        method: "POST",
        body: JSON.stringify({
          id: p.id,
          name: file.name,
          data,
          lastModified: modified,
          oldImage: "",
        }),
      });
      nextImages.push(out.image);
      uploaded.push(out.image);
      if (target !== "source") {
        if (!p.imageDates || typeof p.imageDates !== "object")
          p.imageDates = {};
        p.imageDates[out.image] = out.modified || modified;
      }
    }

    if (target === "source") {
      setSourceImages(p, nextImages);
      $("sourceInput").value = "";
    } else {
      setImages(p, nextImages);
      $("imageInput").value = "";
    }

    if (!wasDraft) await saveAll();
  } catch (error) {
    try {
      await deleteDirectImages(uploaded);
    } catch (cleanupError) {
      reportError("clean uploaded images after failed save", cleanupError);
    }
    setImages(p, previousGenerated);
    setSourceImages(p, previousSource);
    p.imageDates = previousDates;
    await renderForm();
    throw error;
  }

  // Rendering is deliberately outside the persistence rollback boundary. A
  // paint error must never delete files that a successful save now references.
  await renderForm();
}

function detachGeneratedImages(p) {
  const removed = imagesOf(p);
  p.imageDates = {};
  delete p.imageDate;
  setImages(p, []);
  return removed;
}

function detachSourceImages(p) {
  const removed = sourceImagesOf(p);
  setSourceImages(p, []);
  return removed;
}

async function deleteSingleImage(src, target) {
  syncFromForm({ force: true });
  const p = current();
  const state = captureAppState();

  if (target === "source") {
    setSourceImages(
      p,
      sourceImagesOf(p).filter((image) => image !== src),
    );
  } else {
    if (p.imageDates) delete p.imageDates[src];
    setImages(
      p,
      imagesOf(p).filter((image) => image !== src),
    );
  }

  try {
    await saveAll({ deleteImages: unreferencedImages([src]) });
  } catch (error) {
    restoreAppState(state);
    await renderForm();
    throw error;
  }

  await renderForm();
}

let closeConfirmButton = null;
function confirmButton(btn, action) {
  if (btn.classList.contains("confirming")) return;
  if (closeConfirmButton) closeConfirmButton();
  const html = btn.innerHTML;
  let restored = false;
  const restore = () =>
    new Promise((resolve) => {
      if (restored) {
        resolve();
        return;
      }
      restored = true;
      document.removeEventListener("click", outside, true);
      if (closeConfirmButton === restore) closeConfirmButton = null;
      btn.classList.add("confirmOut");
      setTimeout(() => {
        btn.classList.remove("confirming", "confirmOut");
        btn.innerHTML = html;
        btn.onclick = () => confirmButton(btn, action);
        resolve();
      }, 140);
    });
  const outside = (event) => {
    if (!btn.contains(event.target)) restore();
  };
  closeConfirmButton = restore;
  document.addEventListener("click", outside, true);
  btn.classList.add("confirming");
  btn.innerHTML = `<span data-ok>${t("confirm")}</span><span data-cancel>${t("cancel")}</span>`;
  btn.onclick = async (event) => {
    event.stopPropagation();
    if (event.target.closest("[data-ok]")) {
      await restore();
      try {
        await action();
      } catch (error) {
        reportError("confirmed action", error);
      }
    } else if (event.target.closest("[data-cancel]")) {
      await restore();
    }
  };
}

async function clearGeneratedImages() {
  const p = current();
  if (!imagesOf(p).length) return;
  syncFromForm({ force: true });
  const state = captureAppState();
  const removed = detachGeneratedImages(p);

  try {
    await saveAll({ deleteImages: unreferencedImages(removed) });
  } catch (error) {
    restoreAppState(state);
    await renderForm();
    throw error;
  }

  await renderForm();
}

async function clearOriginalImages() {
  const p = current();
  if (!sourceImagesOf(p).length) return;
  syncFromForm({ force: true });
  const state = captureAppState();
  const removed = detachSourceImages(p);

  try {
    await saveAll({ deleteImages: unreferencedImages(removed) });
  } catch (error) {
    restoreAppState(state);
    await renderForm();
    throw error;
  }

  await renderForm();
}

async function deleteCurrentProject() {
  const p = current();
  const removed = [...imagesOf(p), ...sourceImagesOf(p)];

  const state = captureAppState();
  if (!saved(p)) {
    setImages(p, []);
    setSourceImages(p, []);
    try {
      await saveAll({ deleteImages: unreferencedImages(removed) });
    } catch (error) {
      restoreAppState(state);
      await renderForm();
      throw error;
    }
    await startDraft();
    return;
  }

  prompts = prompts.filter((item) => item.id !== p.id);
  if (prompts.length) {
    currentId = prompts[0].id;
  } else {
    draft = blank();
    currentId = draft.id;
  }

  try {
    await saveAll({ deleteImages: unreferencedImages(removed) });
  } catch (error) {
    restoreAppState(state);
    await renderForm();
    throw error;
  }

  await renderForm();
}
async function renderLightbox() {
  const src = lightboxImages[lightboxIndex] || "";
  const img = $("lightboxImg");
  img.onload = positionLightboxTools;
  img.src = await resolveImgSrc(src);
  const multi = lightboxImages.length > 1;
  $("lightboxPrev").hidden = !multi;
  $("lightboxNext").hidden = !multi;
  requestAnimationFrame(positionLightboxTools);
}
async function openLightbox(src, gallery) {
  lightboxImages = [
    ...new Set(
      (Array.isArray(gallery) && gallery.length ? gallery : [src]).filter(
        Boolean,
      ),
    ),
  ];
  lightboxIndex = Math.max(0, lightboxImages.indexOf(src));
  await renderLightbox();
  $("lightbox").classList.add("on");
  requestAnimationFrame(positionLightboxTools);
}
function stepLightbox(dir) {
  if (!$("lightbox").classList.contains("on") || lightboxImages.length < 2)
    return;
  lightboxIndex =
    (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
  renderLightbox();
}
function positionLightboxTools() {
  const box = $("lightbox"),
    img = $("lightboxImg");
  if (!box.classList.contains("on") || !img.complete || !img.naturalWidth)
    return;
  const br = box.getBoundingClientRect(),
    ir = img.getBoundingClientRect();
  box.style.setProperty(
    "--tools-top",
    Math.max(8, Math.round(ir.top - br.top - 64)) + "px",
  );
  box.style.setProperty(
    "--tools-right",
    Math.max(8, Math.round(br.right - ir.right - 80)) + "px",
  );
}
async function downloadLightboxImage() {
  const src = lightboxImages[lightboxIndex] || "";
  if (!src) return;
  const url = await resolveImgSrc(src),
    blob = await fetch(url).then((r) => r.blob());
  const name = decodeURIComponent(
    String(src).split("/").pop() || "image.png",
  ).replace(/[\\/:*?"<>|]/g, "_");
  if (window.showSaveFilePicker) {
    const ext = (name.split(".").pop() || "png").toLowerCase(),
      mime = blob.type || "image/png";
    const handle = await showSaveFilePicker({
      suggestedName: name,
      types: [{ description: "Image", accept: { [mime]: ["." + ext] } }],
    });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
function closeLightbox() {
  const box = $("lightbox");
  if (!box.classList.contains("on")) return;
  box.classList.remove("on");
  setTimeout(() => {
    if (box.classList.contains("on")) return;
    $("lightboxImg").onload = null;
    $("lightboxImg").src = "";
    lightboxImages = [];
    lightboxIndex = 0;
    $("lightboxPrev").hidden = true;
    $("lightboxNext").hidden = true;
  }, 240);
}
function previewStage() {
  if (stageMode === "grid") return;
  const imgs = imagesOf(current());
  if (imgs.length) openLightbox(imgPath(current()) || imgs[0], imgs);
}
function setupMediaLayout() {
  const generated = $("uploadBox").closest(".field"),
    source = $("sourceBox").closest(".field");
  if (
    !generated ||
    !source ||
    generated.parentElement?.classList.contains("mediaGrid")
  )
    return;
  generated.classList.add("mediaField", "generatedField");
  source.classList.add("mediaField", "sourceField");
  const grid = document.createElement("div");
  grid.className = "mediaGrid";
  source.before(grid);
  grid.append(generated, source);
}

setupMediaLayout();
renderModelDrop();

/* ── Unified overlay scrollbars ── */
const customScrollbars = [];
const OverlayScrollbar = window.MYPOverlayScrollbar;

function syncScrollCues() {
  customScrollbars.forEach((scrollbar) => scrollbar.schedule());
}
const sideRoot = document.querySelector(".side");
const stageRoot = document.querySelector(".stage");
const promptRoot = document.querySelector(".promptWrap");
if ($("list") && sideRoot) {
  customScrollbars.push(
    new OverlayScrollbar($("list"), {
      host: sideRoot,
      kind: "list",
      arrows: true,
      insetTop: -2,
      insetBottom: 7,
      insetRight: 0,
      stateHost: sideRoot,
      stateClassBase: "list-scroll",
    }),
  );
}
if ($("stageGridView") && stageRoot) {
  customScrollbars.push(
    new OverlayScrollbar($("stageGridView"), {
      host: stageRoot,
      kind: "grid",
      arrows: true,
      insetTop: 8,
      insetBottom: 8,
      insetRight: 1,
      enabled: () => {
        const stage = document.querySelector(".stage");
        return (
          (stageMode === "grid" || stageModeTarget === "grid") &&
          !stage?.classList.contains("stageModeAnimatingToSingle")
        );
      },
    }),
  );
}
if ($("prompt") && promptRoot)
  customScrollbars.push(
    new OverlayScrollbar($("prompt"), {
      host: promptRoot,
      kind: "prompt",
      insetTop: 3,
      insetBottom: 3,
      insetRight: 4,
    }),
  );
window.addEventListener("resize", syncScrollCues, { passive: true });
requestAnimationFrame(syncScrollCues);
$("stageGridView")?.addEventListener(
  "scroll",
  () => {
    if (stageMode === "grid" || stageModeTarget === "grid")
      updateStageGridActiveFrame(false);
  },
  { passive: true },
);
window.addEventListener(
  "resize",
  () => requestAnimationFrame(() => updateStageGridActiveFrame(false)),
  { passive: true },
);

/* ── Theme Toggle ── */
const THEME_KEY = "myp-theme";
let themeAnimationTimer = 0;
