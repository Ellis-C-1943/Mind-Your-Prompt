function t(key) {
  return LANG_MAP[currentLang]?.[key] || LANG_MAP.zh[key] || key;
}
function applyLang() {
  document.documentElement.setAttribute("data-lang", currentLang);
  document.documentElement.setAttribute(
    "lang",
    currentLang === "zh" ? "zh-CN" : "en",
  );
  const L = LANG_MAP[currentLang];
  const search = $("search");
  if (search) {
    search.placeholder = L.search;
    search.setAttribute("aria-label", L.searchLabel);
  }
  document.querySelectorAll(".filterBtn").forEach((b) => {
    if (b.dataset.filter === "all") b.textContent = L.filterAll;
    else if (b.dataset.filter === "text") b.textContent = L.filterText;
    else if (b.dataset.filter === "image") b.textContent = L.filterImage;
  });
  document.querySelectorAll(".label").forEach((l) => {
    const txt = l.textContent.trim();
    if (txt === "标题" || txt === "Title") l.textContent = L.labelTitle;
    else if (txt === "模型" || txt === "Model") l.textContent = L.labelModel;
    else if (txt === "提示词" || txt === "Prompt")
      l.textContent = L.labelPrompt;
    else if (txt === "生成图" || txt === "Generated" || txt === "Output Image")
      l.textContent = L.labelGenerated;
    else if (txt === "原图" || txt === "Source" || txt === "Input Image")
      l.textContent = L.labelSource;
  });
  const title = $("title");
  if (title) title.placeholder = L.placeholderTitle;
  const prompt = $("prompt");
  if (prompt) prompt.placeholder = L.placeholderPrompt;
  const model = $("modelName");
  if (model) model.placeholder = L.placeholderModel;
  const clearImage = $("clearImageBtn");
  if (clearImage) clearImage.textContent = L.clearImage;
  const clearSource = $("clearSourceBtn");
  if (clearSource) clearSource.textContent = L.clearSource;
  const deleteBtn = $("deleteBtn");
  if (deleteBtn) deleteBtn.textContent = L.deleteBtn;
  const saveBtn = document.querySelector(".actions button[type=submit]");
  if (saveBtn) saveBtn.textContent = L.saveBtn;
  const stageCopySpan = document.querySelector("#stageCopyBtn span");
  if (stageCopySpan) stageCopySpan.textContent = L.copyBtn;
  const copyToastSpan = document.querySelector("#copyToast span");
  if (copyToastSpan) copyToastSpan.textContent = L.copied;
  const saveToastSpan = document.querySelector("#saveToast span");
  if (saveToastSpan) saveToastSpan.textContent = L.saved;
  const statItems = document.querySelector(".sideStats span");
  if (statItems && statItems.closest(".sideStats")) {
    const divs = statItems.closest(".sideStats").querySelectorAll("span");
    if (divs[0]) divs[0].textContent = L.statItems;
    if (divs[1]) divs[1].textContent = serverMode ? L.statLocal : L.statBrowser;
  }
  const langBtn = $("langBtn");
  if (langBtn) {
    langBtn.textContent = currentLang === "zh" ? "中" : "En";
    langBtn.setAttribute("aria-label", L.languageToggleLabel);
  }
  $("themeToggle")?.setAttribute("aria-label", L.themeToggleLabel);
  $("accentBtn")?.setAttribute("aria-label", L.accentToggleLabel);
  $("uploadBox")?.setAttribute("aria-label", L.uploadOutputLabel);
  $("sourceBox")?.setAttribute("aria-label", L.uploadInputLabel);
  $("lightboxClose")?.setAttribute("aria-label", L.closePreviewLabel);
  $("lightbox")?.setAttribute(
    "aria-label",
    currentLang === "zh" ? "图片预览" : "Image preview",
  );
  const heroDraftHintAccent = $("heroDraftHintAccent");
  if (heroDraftHintAccent) heroDraftHintAccent.textContent = L.draftHintAccent;
  const heroDraftHintRest = $("heroDraftHintRest");
  if (heroDraftHintRest) heroDraftHintRest.textContent = L.draftHintRest;
  const lightboxDownload = $("lightboxDownload");
  if (lightboxDownload) lightboxDownload.textContent = L.download;
  /* Update model dropdown custom text */
  const customItem = document.querySelector("#modelDrop .custom");
  if (customItem) customItem.textContent = L.custom;
  /* Update upload box text based on current state */
  const uploadTitle = $("uploadTitle");
  if (uploadTitle) {
    const p = current();
    const imgs = imagesOf(p);
    uploadTitle.textContent = imgs.length
      ? `${imgs.length} ${imgs.length === 1 ? L.imgUploaded : L.imgsUploaded}`
      : L.uploadImage;
  }
  const sourceTitle = $("sourceTitle");
  if (sourceTitle) {
    const p = current();
    const srcs = sourceImagesOf(p);
    sourceTitle.textContent = srcs.length
      ? `${srcs.length} ${srcs.length === 1 ? L.srcUploaded : L.srcsUploaded}`
      : L.uploadSource;
  }
  const imageName = $("imageName");
  if (imageName) {
    const p = current();
    const has = imagesOf(p).length;
    imageName.textContent = has ? L.clickPreview : L.noImage;
  }
  const sourceName = $("sourceName");
  if (sourceName) {
    const p = current();
    const has = sourceImagesOf(p).length;
    sourceName.textContent = has ? L.clickPreview : L.noSource;
  }
  const uploadHint = $("uploadHint");
  if (uploadHint) {
    const p = current();
    const has = imagesOf(p).length;
    uploadHint.textContent = has ? L.clickContinueImage : L.uploadHint;
  }
  const sourceHint = $("sourceHint");
  if (sourceHint) {
    const p = current();
    const has = sourceImagesOf(p).length;
    sourceHint.textContent = has ? L.clickContinueSource : L.uploadHint;
  }
  const status = $("statusDot");
  if (status) setDot(!status.classList.contains("off"));
  updateStageModeButton();
  renderList();
}
$("langBtn").onclick = () => {
  currentLang = currentLang === "zh" ? "en" : "zh";
  localStorage.setItem(LANG_KEY, currentLang);
  applyLang();
};
$("langBtn").onkeydown = (event) =>
  activateOnKey(event, () => $("langBtn").click());
if (currentLang !== "zh") applyLang();
$("search").oninput = renderList;
$("title").oninput = () => {
  const p = current(),
    value = $("title").value.trim();
  if (!saved(p)) p.title = value;
  updateDraftBrand(value);
  layoutHeroTitle(value || "MYP");
};
document.querySelectorAll(".filterBtn").forEach(
  (btn) =>
    (btn.onclick = () =>
      transitionView(async () => {
        listFilter = btn.dataset.filter;
        const first = prompts.find((p) => matchList(p));
        if (first && first.id !== currentId) {
          restoreSavedPrompt(currentId);
          resetPromptBeforeSwitch();
          if (draft && draft.id !== first.id) draft = null;
          currentId = first.id;
          await renderForm();
        } else renderList();
      })),
);
$("modelName").onfocus = () => {
  const r = $("modelName").getBoundingClientRect();
  const d = $("modelDrop");
  d.style.left = r.left + "px";
  d.style.top = r.bottom + 2 + "px";
  d.style.width = r.width + "px";
  d.classList.add("open");
};
$("modelDrop").onmousedown = (e) => e.preventDefault();
$("modelDrop").onclick = (e) => {
  const item = e.target.closest("[data-v],.custom");
  if (!item) return;
  const value = item.dataset.v;
  if (value) {
    $("modelName").value = value;
    $("modelDrop").classList.remove("open");
  } else if (item.classList.contains("custom")) {
    $("modelDrop").classList.remove("open");
    $("modelName").focus();
  }
};
$("modelName").onblur = () =>
  setTimeout(() => $("modelDrop").classList.remove("open"), 200);
$("promptExpandBtn").onclick = () =>
  setPromptExpanded(!$("promptField").classList.contains("expanded"));
$("form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (await saveCurrent()) showSaveToast();
  } catch (err) {
    showSaveFailure(err);
  }
};
$("stageCopyBtn").onclick = async (e) => {
  e.stopPropagation();
  try {
    await copyPrompt();
  } finally {
    showCopyToast();
  }
};
$("stageModeBtn").onclick = (e) => {
  e.stopPropagation();
  if (stageModeInputLocked) return;
  stageModeInputLocked = true;
  const nextMode = stageMode === "grid" ? "single" : "grid";
  stageModeTarget = nextMode;
  updateStageModeButton();
  // Paint the button state before measuring the stage. The interaction lock stays
  // active until the complete mode transition settles, so rapid clicks cannot
  // reverse or interrupt a partially rendered animation.
  stageModeStartRaf = requestAnimationFrame(() => {
    stageModeStartRaf = requestAnimationFrame(() => {
      stageModeStartRaf = 0;
      setStageMode(nextMode)
        .catch((err) => reportError("toggle stage mode", err))
        .finally(() => {
          stageModeInputLocked = false;
          updateStageModeButton();
        });
    });
  });
};
document.querySelector(".stage").onclick = (e) => {
  if (e.target.closest("#stageModeBtn,#stageCopyBtn,.stageGridView")) return;
  previewStage();
};
$("uploadBox").onclick = () => $("imageInput").click();
$("uploadBox").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("imageInput").click();
  }
};
$("uploadBox").ondragover = (e) => {
  e.preventDefault();
  $("uploadBox").classList.add("drag");
};
$("uploadBox").ondragleave = () => $("uploadBox").classList.remove("drag");
$("uploadBox").ondrop = async (e) => {
  e.preventDefault();
  $("uploadBox").classList.remove("drag");
  try {
    await uploadFiles(e.dataTransfer.files);
  } catch (err) {
    reportError("upload output image", err);
  }
};
$("imageInput").onchange = async () => {
  try {
    await uploadFiles($("imageInput").files);
  } catch (err) {
    reportError("upload output image", err);
  }
};
$("sourceBox").onclick = () => $("sourceInput").click();
$("sourceBox").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("sourceInput").click();
  }
};
$("sourceBox").ondragover = (e) => {
  e.preventDefault();
  $("sourceBox").classList.add("drag");
};
$("sourceBox").ondragleave = () => $("sourceBox").classList.remove("drag");
$("sourceBox").ondrop = async (e) => {
  e.preventDefault();
  $("sourceBox").classList.remove("drag");
  try {
    await uploadFiles(e.dataTransfer.files, "source");
  } catch (err) {
    reportError("upload input image", err);
  }
};
$("sourceInput").onchange = async () => {
  try {
    await uploadFiles($("sourceInput").files, "source");
  } catch (err) {
    reportError("upload input image", err);
  }
};
$("clearImageBtn").onclick = () =>
  confirmButton($("clearImageBtn"), clearGeneratedImages);
$("clearSourceBtn").onclick = () =>
  confirmButton($("clearSourceBtn"), clearOriginalImages);
$("deleteBtn").onclick = () =>
  confirmButton($("deleteBtn"), deleteCurrentProject);
$("lightboxPrev").onclick = (e) => {
  e.stopPropagation();
  stepLightbox(-1);
};
$("lightboxNext").onclick = (e) => {
  e.stopPropagation();
  stepLightbox(1);
};
$("lightboxClose").onclick = closeLightbox;
$("lightboxDownload").onclick = (e) => {
  e.stopPropagation();
  downloadLightboxImage().catch((err) => reportError("download image", err));
};
$("lightbox").onclick = (e) => {
  if (e.target.id === "lightbox") closeLightbox();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setAccentPickerOpen(false);
    closeLightbox();
    return;
  }
  if (!$("lightbox").classList.contains("on")) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    stepLightbox(-1);
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    stepLightbox(1);
  }
});
window.addEventListener("resize", () => {
  layoutHeroTitle();
  positionLightboxTools();
  fitPromptExpand();
  scheduleMediaFit();
  scheduleStageGridLayout();
});
if (document.fonts)
  document.fonts.ready.then(() => {
    layoutHeroTitle();
    requestAnimationFrame(() => layoutHeroTitle());
  });

(async () => {
  try {
    await refreshServerConnection();
    prompts = await api("/api/prompts");
    if (serverMode && !serverClientRegistered) await registerServerClient();
    if (!Array.isArray(prompts)) prompts = [];
    let modelChanged = false;
    prompts = prompts.map((p) => {
      const x = { ...blank(), ...p, id: p.id || id() };
      setImages(x, imagesOf(x));
      setSourceImages(x, sourceImagesOf(x));
      delete x.tags;
      const m = normalizeModelName(x.model);
      if (m !== x.model) {
        x.model = m;
        modelChanged = true;
      }
      return x;
    });
    sortPrompts();
    const orderChanged = migratePromptOrders();
    sortPrompts();
    if (modelChanged || orderChanged) {
      try {
        await saveAll();
      } catch (err) {
        setSavedSnapshot();
        reportError("persist migrated prompts", err);
      }
    } else setSavedSnapshot();
    if (prompts.length) {
      currentId = prompts[0].id;
    } else {
      draft = blank();
      currentId = draft.id;
    }
    renderList();
    await renderForm();
    setDot(serverMode);
  } catch (err) {
    serverMode = false;
    setDot(false);
    reportError("load prompts", err);
  }
})();

/* ── Local server connection status ── */
setInterval(refreshServerConnection, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshServerConnection();
});
window.addEventListener("pageshow", resumeServerClient);
window.addEventListener("pagehide", closeServerClient);
