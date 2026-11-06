// Runs before anything is drawn: the right language direction, light or dark
// and text size from the first frame, so the window never flashes white or
// flips sides while it opens (B-76). start.js takes over once the state
// arrives.
(() => {
  const l = window.hub && window.hub.look;
  if (!l) return;
  const root = document.documentElement;
  root.lang = l.language;
  root.dir = l.language === "ar" ? "rtl" : "ltr";
  root.dataset.theme = l.dark ? "dark" : "light";
  root.dataset.size = l.textSize;
  root.dataset.platform = l.platform;
  root.dataset.motion = l.motion;
  root.style.setProperty("--accent", l.accent);
})();
