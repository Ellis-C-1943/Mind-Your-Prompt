(function () {
  var root = document.documentElement;
  if (root.dataset.mypCanvasFrozen === "1") return;

  var sideW = 340;
  var minW = 1720;
  var minH = 690;
  var frozenW = minW;
  var frozenH = minH;
  var scheduled = false;
  var wasFullscreenViewport = false;
  var allowShrinkUntil = 0;

  function viewportSize() {
    return {
      w: Math.round(window.innerWidth || minW),
      h: Math.round(window.innerHeight || minH),
    };
  }

  function isFullscreenViewport(size) {
    if (document.fullscreenElement) return true;

    var screenW =
      window.screen && window.screen.width ? window.screen.width : 0;
    var screenH =
      window.screen && window.screen.height ? window.screen.height : 0;
    if (!screenW || !screenH) return false;

    var outerW = Math.round(window.outerWidth || 0);
    var outerH = Math.round(window.outerHeight || 0);
    var tolerance = 10;

    return (
      (Math.abs(outerW - screenW) <= tolerance &&
        Math.abs(outerH - screenH) <= tolerance) ||
      (Math.abs(size.w - screenW) <= tolerance &&
        Math.abs(size.h - screenH) <= tolerance)
    );
  }

  function setCanvasSize(width, height) {
    frozenW = width;
    frozenH = height;

    var mainW = Math.max(0, frozenW - sideW);
    var stageW = Math.max(360, Math.round(frozenW * 0.43));
    stageW = Math.min(stageW, mainW);
    var editorW = Math.max(0, mainW - stageW);

    root.style.setProperty("--myp-canvas-w", frozenW + "px");
    root.style.setProperty("--myp-canvas-h", frozenH + "px");
    root.style.setProperty("--myp-main-w", mainW + "px");
    root.style.setProperty("--myp-stage-w", stageW + "px");
    root.style.setProperty("--myp-editor-w", editorW + "px");
  }

  function applyCanvasSize(force) {
    var size = viewportSize();
    var fullscreenViewport = isFullscreenViewport(size);
    var now = Date.now();

    if (fullscreenViewport || wasFullscreenViewport) {
      allowShrinkUntil = now + 900;
    }

    var shouldFitViewport =
      force || fullscreenViewport || now <= allowShrinkUntil;
    var nextW = shouldFitViewport
      ? Math.max(minW, size.w)
      : Math.max(minW, frozenW, size.w);
    var nextH = shouldFitViewport
      ? Math.max(minH, size.h)
      : Math.max(minH, frozenH, size.h);

    wasFullscreenViewport = fullscreenViewport;

    if (!force && nextW === frozenW && nextH === frozenH) return;
    setCanvasSize(nextW, nextH);
  }

  function scheduleCanvasSize() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      applyCanvasSize(false);
    });
  }

  applyCanvasSize(true);
  window.addEventListener("resize", scheduleCanvasSize, { passive: true });
  window.addEventListener("orientationchange", scheduleCanvasSize, {
    passive: true,
  });
  document.addEventListener("fullscreenchange", scheduleCanvasSize);
  root.dataset.mypCanvasFrozen = "1";
})();
