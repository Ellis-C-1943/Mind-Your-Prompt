const getTheme = () =>
  document.documentElement.getAttribute("data-theme") || "dark";
function syncThemeToggleState(theme) {
  const btn = $("themeToggle");
  if (!btn) return;
  const isLight = theme === "light";
  btn.classList.toggle("light", isLight);
  btn.setAttribute("aria-checked", String(isLight));
}
function activateOnKey(event, action) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}
const setTheme = (theme, animate = true) => {
  const oldTheme = getTheme();
  if (oldTheme === theme) return;
  const root = document.documentElement;
  const btn = $("themeToggle");
  if (animate) {
    clearTimeout(themeAnimationTimer);
    root.classList.add("themeAnimating");
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const ripple = document.createElement("div");
    ripple.className = "themeRipple";
    ripple.style.left = x + "px";
    ripple.style.top = y + "px";
    ripple.style.width = "200vmax";
    ripple.style.height = "200vmax";
    ripple.style.marginLeft = "-100vmax";
    ripple.style.marginTop = "-100vmax";
    ripple.style.background = theme === "light" ? "#F5F3ED" : "#050505";
    document.body.appendChild(ripple);
    requestAnimationFrame(() => {
      root.setAttribute("data-theme", theme);
      localStorage.setItem(THEME_KEY, theme);
      syncThemeToggleState(theme);
      ripple.classList.add("expanding");
      const accentDark =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-dark")
          .trim() || "#d4ff00";
      const accentLight =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-light")
          .trim() || "#96C93B";
      document.documentElement.style.setProperty(
        "--accent",
        theme === "light" ? accentLight : accentDark,
      );
      const accentBtn = $("accentBtnInner");
      if (accentBtn)
        accentBtn.style.background =
          theme === "light" ? accentLight : accentDark;
      buildSwatches(currentAccentDark);
      setTimeout(() => ripple.remove(), 850);
      themeAnimationTimer = setTimeout(() => {
        root.classList.remove("themeAnimating");
        themeAnimationTimer = 0;
      }, 850);
    });
  } else {
    clearTimeout(themeAnimationTimer);
    themeAnimationTimer = 0;
    root.classList.remove("themeAnimating");
    root.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    syncThemeToggleState(theme);
  }
};

/* Initialize theme */
const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
syncThemeToggleState(savedTheme);

/* Theme toggle click handler */
$("themeToggle").onclick = () => {
  const newTheme = getTheme() === "dark" ? "light" : "dark";
  setTheme(newTheme);
};
$("themeToggle").onkeydown = (event) =>
  activateOnKey(event, () => $("themeToggle").click());

/* ── Accent Color Picker ── */
const ACCENT_COLORS = [
  { dark: "#d4ff00", light: "#96C93B" },
  { dark: "#FDFF00", light: "#B7D232" },
  { dark: "#FC8613", light: "#D69A46" },
  { dark: "#1D99FF", light: "#4E9AE0" },
  { dark: "#FF0D61", light: "#CC465A" },
  { dark: "#C302FF", light: "#C92CD4" },
  { dark: "#ffffff", light: "#474747" },
];
const ACCENT_KEY = "myp-accent";
let currentAccentDark = "#d4ff00";

function setAccentColor(darkColor, lightColor, save = true) {
  currentAccentDark = darkColor;
  const root = document.documentElement;
  root.style.setProperty("--accent-dark", darkColor);
  root.style.setProperty("--accent-light", lightColor);
  const theme = getTheme();
  root.style.setProperty(
    "--accent",
    theme === "light" ? lightColor : darkColor,
  );
  const btn = $("accentBtnInner");
  if (btn) btn.style.background = theme === "light" ? lightColor : darkColor;
  /* Rebuild swatches to exclude current color */
  buildSwatches(darkColor);
  if (save)
    localStorage.setItem(
      ACCENT_KEY,
      JSON.stringify({ dark: darkColor, light: lightColor }),
    );
}

function setAccentPickerOpen(isOpen) {
  const btn = $("accentBtn");
  btn.classList.toggle("open", isOpen);
  btn.setAttribute("aria-expanded", String(isOpen));
  $("langBtn").classList.toggle("shifted", isOpen);
}

function buildSwatches(excludeDark) {
  const btn = $("accentBtn");
  btn.querySelectorAll(".accentSwatch").forEach((swatch) => swatch.remove());
  ACCENT_COLORS.filter((color) => color.dark !== excludeDark).forEach(
    (color) => {
      const swatch = document.createElement("span");
      swatch.className = "accentSwatch";
      swatch.dataset.dark = color.dark;
      swatch.dataset.light = color.light;
      swatch.style.background =
        getTheme() === "light" ? color.light : color.dark;
      swatch.setAttribute("role", "button");
      swatch.setAttribute("tabindex", "0");
      swatch.setAttribute("aria-label", `${color.dark} / ${color.light}`);
      const selectColor = (event) => {
        event.stopPropagation();
        setAccentColor(color.dark, color.light);
        setAccentPickerOpen(false);
      };
      swatch.onclick = selectColor;
      swatch.onkeydown = (event) =>
        activateOnKey(event, () => selectColor(event));
      btn.appendChild(swatch);
    },
  );
}

buildSwatches(currentAccentDark);

/* Accent button toggle expand */
$("accentBtn").onclick = (event) => {
  if (event.target.closest(".accentSwatch")) return;
  event.stopPropagation();
  setAccentPickerOpen(!$("accentBtn").classList.contains("open"));
};
$("accentBtn").onkeydown = (event) => {
  if (event.target.closest(".accentSwatch")) return;
  activateOnKey(event, () => $("accentBtn").click());
};

/* Close when clicking outside */
document.addEventListener("click", (event) => {
  const btn = $("accentBtn");
  if (btn.classList.contains("open") && !btn.contains(event.target))
    setAccentPickerOpen(false);
});

/* Initialize accent color */
(function () {
  const saved = localStorage.getItem(ACCENT_KEY);
  if (saved) {
    try {
      const c = JSON.parse(saved);
      const knownAccent = ACCENT_COLORS.find(
        (item) => item.dark === c.dark && item.light === c.light,
      );
      if (knownAccent)
        setAccentColor(knownAccent.dark, knownAccent.light, false);
    } catch {
      /* Ignore malformed saved accent preference and fall back to default. */
    }
  }
  /* Ensure accent matches current theme */
  const theme = getTheme();
  const darkVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-dark")
    .trim();
  const lightVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-light")
    .trim();
  if (darkVar && lightVar) {
    document.documentElement.style.setProperty(
      "--accent",
      theme === "light" ? lightVar : darkVar,
    );
    const btn = $("accentBtnInner");
    if (btn) btn.style.background = theme === "light" ? lightVar : darkVar;
  }
})();

$("newBtn").onclick = startDraft;

/* ── Language Toggle ── */
const { LANG_KEY, LANG_MAP } = window.MYPI18N;
let currentLang = localStorage.getItem(LANG_KEY) || "zh";
