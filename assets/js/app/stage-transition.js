function prepareStageModeTextTransition(nextMode, stage) {
  // renderForm normally caches these measurements. Re-measure only when the
  // variables are missing so the click frame does not pay for forced layouts.
  const heroStyle = getComputedStyle(document.querySelector(".heroText"));
  if (
    !heroStyle.getPropertyValue("--grid-eyebrow-y").trim() ||
    !heroStyle.getPropertyValue("--title-y").trim()
  )
    layoutHeroTitle();
  const eyebrow = document.querySelector(".eyebrow");
  const heroText = document.querySelector(".heroText");
  const heroTitle = $("heroTitle");
  const heroImg = $("heroImg");
  // Capture single-mode geometry before animation classes alter the real nodes.
  const singleToGridEyebrowRect =
    nextMode === "grid" ? eyebrow?.getBoundingClientRect() : null;
  const singleToGridTitleGhost =
    nextMode === "grid" ? createStageTitleGhost(stage, heroTitle) : null;
  const singleToGridEyebrowGhost =
    nextMode === "grid" ? createStageEyebrowGhost(stage, eyebrow) : null;
  if (singleToGridTitleGhost) {
    stageModeTitleGhost = singleToGridTitleGhost;
    singleToGridTitleGhost.style.transition = "none";
    singleToGridTitleGhost.style.transform = "translate3d(0,0,0)";
    singleToGridTitleGhost.style.opacity = "1";
    singleToGridTitleGhost.style.clipPath = "inset(0 0 0 0)";
  }
  if (singleToGridEyebrowGhost)
    stageModeEyebrowGhost = singleToGridEyebrowGhost;
  return {
    eyebrow,
    heroText,
    heroTitle,
    heroImg,
    singleToGridEyebrowRect,
    singleToGridTitleGhost,
    singleToGridEyebrowGhost,
  };
}
function beginStageModeTransition(nextMode, stage, syncCues = false) {
  stageModeAnimating = true;
  stageModeTarget = nextMode;
  const transitionId = ++stageModeTransitionId;
  stage?.classList.add(
    "stageModeAnimating",
    nextMode === "single"
      ? "stageModeAnimatingToSingle"
      : "stageModeAnimatingToGrid",
  );
  updateStageModeButton();
  if (syncCues) syncScrollCues();
  return transitionId;
}
function persistStageMode(mode, save) {
  stageMode = mode;
  if (save) localStorage.setItem(STAGE_MODE_KEY, stageMode);
  updateStageModeButton();
}
async function runTextOnlyStageModeTransition(nextMode, stage, grid, save) {
  const {
    eyebrow,
    heroText,
    heroTitle,
    singleToGridEyebrowRect,
    singleToGridTitleGhost,
    singleToGridEyebrowGhost,
  } = prepareStageModeTextTransition(nextMode, stage);
  const transitionId = beginStageModeTransition(nextMode, stage);
  try {
    if (nextMode === "grid") {
      persistStageMode("grid", save);
      if (heroTitle) {
        heroTitle.style.setProperty("transition", "none", "important");
        heroTitle.style.setProperty("opacity", "0", "important");
      }
      if (eyebrow) {
        const finalGridY =
          parseFloat(
            getComputedStyle(heroText).getPropertyValue("--grid-eyebrow-y"),
          ) || 132;
        eyebrow.style.setProperty("transition", "none", "important");
        eyebrow.style.setProperty("opacity", "0", "important");
        eyebrow.style.setProperty(
          "transform",
          `translate3d(0,${finalGridY}px,0)`,
          "important",
        );
      }
      await renderStageGrid({ fast: true, noAutoScroll: true, force: true });
      if (transitionId !== stageModeTransitionId) return;
      const eyebrowAfterRect = eyebrow?.getBoundingClientRect();
      const eyebrowDeltaY =
        singleToGridEyebrowRect && eyebrowAfterRect
          ? eyebrowAfterRect.top - singleToGridEyebrowRect.top
          : 0;
      const textMotion = singleToGridEyebrowGhost
        ? singleToGridEyebrowGhost
            .animate(
              [
                { transform: "translate3d(0,0,0)", opacity: 1 },
                {
                  transform: `translate3d(0,${eyebrowDeltaY}px,0)`,
                  opacity: 1,
                },
              ],
              {
                duration: GRID_LABEL_MOTION_MS,
                easing: GRID_LABEL_EASE,
                fill: "both",
                composite: "replace",
              },
            )
            .finished.catch(() => {})
        : Promise.resolve();
      const titleExitMotion = animateSingleToGridTitleExit(
        singleToGridTitleGhost,
        stage?.classList.contains("isDraftBlank"),
      );
      await Promise.all([textMotion, titleExitMotion]);
      if (transitionId !== stageModeTransitionId) return;
      handoffSingleToGridText();
      requestAnimationFrame(() => scrollStageGridActive("auto"));
      return;
    }

    const isBlankDraft = stage?.classList.contains("isDraftBlank");
    if (isBlankDraft) {
      // Empty draft grid→single has no image ghost to conceal the handoff. Collapse
      // the grid first, then lift all draft copy together over the single background.
      const textEntrance = prepareGridToSingleTextEntrance(
        stage,
        heroTitle,
        eyebrow,
        { draftHintEl: $("heroDraftHint"), draftBrandEl: $("heroBrand") },
      );
      persistStageMode("single", save);
      let gridFade = null;
      if (grid) {
        const parsedOpacity = parseFloat(getComputedStyle(grid).opacity);
        const fromOpacity = Number.isFinite(parsedOpacity)
          ? Math.max(0, Math.min(1, parsedOpacity))
          : 1;
        gridFade = grid.animate([{ opacity: fromOpacity }, { opacity: 0 }], {
          duration: DRAFT_BLANK_BACKGROUND_LEAD_MS,
          easing: STAGE_ZOOM_EASE,
          fill: "forwards",
          composite: "replace",
        });
        stageModeBlankGridAnimation = gridFade;
        await gridFade.finished.catch(() => {});
        if (
          transitionId !== stageModeTransitionId ||
          !stageModeAnimating ||
          stageModeTarget !== nextMode
        ) {
          gridFade.cancel();
          if (stageModeBlankGridAnimation === gridFade)
            stageModeBlankGridAnimation = null;
          return;
        }
        gridFade.cancel();
        if (stageModeBlankGridAnimation === gridFade)
          stageModeBlankGridAnimation = null;
        grid.style.setProperty("transition", "none", "important");
        grid.style.setProperty("opacity", "0", "important");
        grid.style.setProperty("visibility", "hidden", "important");
        grid.style.setProperty("pointer-events", "none", "important");
      } else await wait(DRAFT_BLANK_BACKGROUND_LEAD_MS);
      if (
        transitionId !== stageModeTransitionId ||
        !stageModeAnimating ||
        stageModeTarget !== nextMode
      )
        return;
      await waitFrames(1);
      await textEntrance.run();
    } else {
      const titleEntrance = startGridToSingleTextEntrance(
        stage,
        heroTitle,
        eyebrow,
      );
      persistStageMode("single", save);
      await titleEntrance;
    }
    if (transitionId !== stageModeTransitionId) return;
    handoffStageTitleGhost(heroTitle);
  } finally {
    if (transitionId === stageModeTransitionId) cleanupStageModeTransition();
  }
}
function primeHeroImageForStageModeTransition(heroImg) {
  if (!heroImg) return;
  heroImg.style.setProperty("transition", "none", "important");
  heroImg.style.setProperty("opacity", ".82", "important");
  heroImg.style.setProperty(
    "filter",
    "blur(18px) contrast(1.02) brightness(.56)",
    "important",
  );
  heroImg.style.setProperty(
    "transform",
    "scale(1.065) translateZ(0)",
    "important",
  );
}
async function runGridToSingleImageTransition({
  resolved,
  stage,
  grid,
  save,
  transitionId,
  heroTitle,
  eyebrow,
}) {
  // The selected card normally exists already. Rebuild or reveal it only when a
  // stale render leaves no measurable source rectangle.
  let activeCard = activeGridCard();
  if (!activeCard) {
    await renderStageGrid({ fast: true, noAutoScroll: true });
    await waitFrames(1);
    activeCard = activeGridCard();
  }
  if (!activeCard) activeCard = await ensureActiveGridCardVisible("auto");
  if (transitionId !== stageModeTransitionId) return;
  const fromRect = activeCard
    ? stageLocalRect(activeCard.getBoundingClientRect(), stage)
    : null;
  const toRect = stageFullRect(stage);
  let ghost = null;

  if (fromRect && fromRect.width > 1 && fromRect.height > 1) {
    stageModeHiddenCard = activeCard;
    activeCard.style.visibility = "hidden";
    updateStageGridActiveFrame(false);
    ghost = createStageModeGhost(resolved, fromRect, stage, activeCard);
    stageModeCurrentGhost = ghost;
    await waitFrames(1);
    const titleEntrance = startGridToSingleTextEntrance(
      stage,
      heroTitle,
      eyebrow,
    );
    await Promise.all([
      animateStageModeGhost(ghost, toRect, "0px", STAGE_ZOOM_MS, {
        shadeFrom: 0,
        shadeTo: stageShadeOpacity(stage),
      }),
      titleEntrance,
    ]);
    if (transitionId !== stageModeTransitionId) return;
  }

  persistStageMode("single", save);
  stageModeTarget = null;
  const heroText = document.querySelector(".heroText");
  const gridEl = $("stageGridView");
  const heroImg = $("heroImg");
  const backdropSolid = document.querySelector(".stageBackdropSolid");
  if (backdropSolid) {
    backdropSolid.style.setProperty("transition", "none", "important");
    backdropSolid.style.setProperty(
      "opacity",
      String(stageShadeOpacity(stage)),
      "important",
    );
  }
  // Hide the grid before the semi-transparent ghost fades so no card flashes through.
  if (gridEl) {
    gridEl.style.setProperty("transition", "none", "important");
    gridEl.style.setProperty("opacity", "0", "important");
    gridEl.style.setProperty("visibility", "hidden", "important");
  }
  stage?.classList.remove("stageModeAnimatingToSingle");
  if (eyebrow) {
    const titleDrop =
      parseFloat(getComputedStyle(heroText).getPropertyValue("--title-drop")) ||
      20;
    eyebrow.style.setProperty("transition", "none", "important");
    eyebrow.style.setProperty(
      "transform",
      `translate3d(0,${titleDrop}px,0)`,
      "important",
    );
  }
  if (heroImg) {
    heroImg.style.setProperty("transition", "none", "important");
    heroImg.style.setProperty("opacity", "1", "important");
    heroImg.style.setProperty("filter", "contrast(1.08)", "important");
    heroImg.style.setProperty("transform", "translateZ(0)", "important");
  }
  handoffStageTitleGhost(heroTitle);
  await waitFrames(1);
  if (ghost) {
    ghost.style.opacity = "0";
    await wait(200);
    ghost.remove();
    if (stageModeCurrentGhost === ghost) stageModeCurrentGhost = null;
  }
}
async function runSingleToGridImageTransition({
  resolved,
  stage,
  grid,
  save,
  transitionId,
  heroTitle,
  heroText,
  singleToGridEyebrowRect,
  singleToGridEyebrowGhost,
  singleToGridTitleGhost,
}) {
  const fromRect = stageFullRect(stage);
  const ghost = createStageModeGhost(resolved, fromRect, stage, $("heroImg"));
  // beginStageModeTransition intentionally blurs the real hero into the grid
  // backdrop before this ghost is created. The moving ghost must retain the
  // sharp single-view image throughout the shrink, so never copy that backdrop
  // blur onto the transition image.
  const ghostImage = ghost.querySelector("img");
  if (ghostImage) ghostImage.style.filter = "contrast(1.08)";
  ghost.classList.add("toGrid");
  ghost.style.borderRadius = "0px";
  stageModeCurrentGhost = ghost;
  persistStageMode("grid", save);
  const eyebrow = document.querySelector(".eyebrow");
  if (heroTitle) {
    heroTitle.style.setProperty("transition", "none", "important");
    heroTitle.style.setProperty("opacity", "0", "important");
  }
  if (eyebrow) {
    const finalGridY =
      parseFloat(
        getComputedStyle(heroText).getPropertyValue("--grid-eyebrow-y"),
      ) || 132;
    eyebrow.style.setProperty("transition", "none", "important");
    eyebrow.style.setProperty("opacity", "0", "important");
    eyebrow.style.setProperty(
      "transform",
      `translate3d(0,${finalGridY}px,0)`,
      "important",
    );
  }
  const eyebrowAfterRect = eyebrow?.getBoundingClientRect();
  const eyebrowDeltaY =
    singleToGridEyebrowRect && eyebrowAfterRect
      ? eyebrowAfterRect.top - singleToGridEyebrowRect.top
      : 0;
  if (grid) {
    grid.style.opacity = "0";
    grid.style.pointerEvents = "none";
  }
  let activeCard = grid?.querySelector(".stageGridCard.on");
  if (!activeCard) {
    await renderStageGrid({ fast: true, noAutoScroll: true, force: true });
    if (transitionId !== stageModeTransitionId) return;
    activeCard = grid?.querySelector(".stageGridCard.on");
  }
  if (activeCard && grid)
    grid.scrollTop = Math.max(
      0,
      activeCard.offsetTop +
        activeCard.offsetHeight / 2 -
        grid.clientHeight / 2,
    );
  const toRect = activeCard
    ? stageLocalRect(activeCard.getBoundingClientRect(), stage)
    : null;
  if (activeCard) {
    stageModeHiddenCard = activeCard;
    activeCard.style.visibility = "hidden";
    updateStageGridActiveFrame(false);
  }
  if (grid) {
    grid.style.opacity = "1";
    grid.style.pointerEvents = "auto";
  }
  const textMotion = singleToGridEyebrowGhost
    ? singleToGridEyebrowGhost
        .animate(
          [
            { transform: "translate3d(0,0,0)", opacity: 1 },
            { transform: `translate3d(0,${eyebrowDeltaY}px,0)`, opacity: 1 },
          ],
          {
            duration: GRID_LABEL_MOTION_MS,
            easing: GRID_LABEL_EASE,
            fill: "both",
            composite: "replace",
          },
        )
        .finished.catch(() => {})
    : Promise.resolve();
  const titleExitMotion = animateSingleToGridTitleExit(
    singleToGridTitleGhost,
    stage?.classList.contains("isDraftBlank"),
  );
  const imageMotion = toRect
    ? animateStageModeGhost(ghost, toRect, "6px", STAGE_ZOOM_MS, {
        shadeFrom: stageShadeOpacity(stage),
        shadeTo: 0,
      })
    : Promise.resolve();
  await Promise.all([imageMotion, textMotion, titleExitMotion]);
  if (transitionId !== stageModeTransitionId) return;
  handoffSingleToGridText();
  if (stageModeHiddenCard) {
    stageModeHiddenCard.style.visibility = "";
    stageModeHiddenCard = null;
  }
  updateStageGridSelection(false);
  ghost.style.opacity = "0";
  await wait(200);
  ghost.remove();
  if (stageModeCurrentGhost === ghost) stageModeCurrentGhost = null;
  stageModeTarget = null;
  updateStageModeButton();
  requestAnimationFrame(() =>
    upgradeStageGridCards().catch((err) =>
      reportError("upgrade stage grid", err),
    ),
  );
}
async function runImageStageModeTransition(
  resolved,
  nextMode,
  stage,
  grid,
  save,
) {
  const text = prepareStageModeTextTransition(nextMode, stage);
  const transitionId = beginStageModeTransition(nextMode, stage, true);
  primeHeroImageForStageModeTransition(text.heroImg);
  try {
    if (nextMode === "single" && stageMode === "grid") {
      await runGridToSingleImageTransition({
        resolved,
        stage,
        grid,
        save,
        transitionId,
        heroTitle: text.heroTitle,
        eyebrow: text.eyebrow,
      });
    } else if (nextMode === "grid" && stageMode === "single") {
      await runSingleToGridImageTransition({
        resolved,
        stage,
        grid,
        save,
        transitionId,
        heroTitle: text.heroTitle,
        heroText: text.heroText,
        singleToGridEyebrowRect: text.singleToGridEyebrowRect,
        singleToGridEyebrowGhost: text.singleToGridEyebrowGhost,
        singleToGridTitleGhost: text.singleToGridTitleGhost,
      });
    }
  } finally {
    if (transitionId === stageModeTransitionId) cleanupStageModeTransition();
  }
}
async function setStageMode(mode, save = true) {
  const nextMode = mode === "grid" ? "grid" : "single";
  const stage = document.querySelector(".stage");
  const grid = $("stageGridView");
  if (stageModeAnimating) {
    const tokenBefore = stageModeTransitionId;
    cleanupStageModeTransition();
    if (nextMode === stageMode && tokenBefore) return;
  }
  if (nextMode === stageMode) {
    stageModeTarget = null;
    updateStageModeButton();
    return;
  }

  cancelStageThumbPrecache();
  const srcPath = imgPath(current());
  const heroImageNode = $("heroImg");
  const renderedHeroSrc =
    srcPath &&
    heroImageNode?.dataset.source === srcPath &&
    heroImageNode.complete &&
    heroImageNode.naturalWidth
      ? heroImageNode.currentSrc || heroImageNode.src
      : "";
  const resolved = renderedHeroSrc || (await resolveImgSrc(srcPath));
  if (!resolved)
    return runTextOnlyStageModeTransition(nextMode, stage, grid, save);
  return runImageStageModeTransition(resolved, nextMode, stage, grid, save);
}
