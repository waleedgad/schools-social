// Errors in the window are reported to the builder (see reportError in main).
addEventListener("error", (e) => window.hub.call("reportError", e.message || String(e.error), e.error?.stack ?? null, `tab ${App.view}`).catch(() => {}));
addEventListener("unhandledrejection", (e) => window.hub.call("reportError", e.reason?.message ?? String(e.reason), e.reason?.stack ?? null, `tab ${App.view}`).catch(() => {}));

// First paint, then live updates from the Mac.
window.hub.onState((next, changed) => {
  const before = S;
  S = next;
  applyLook();
  if (!before || before.language !== S.language || before.theme !== S.theme || before.textSize !== S.textSize) return rerender();
  sidebar();
  App.views[App.view]?.onState?.(changed ?? []);
});
window.hub.onProgress((p) => App.views[App.view]?.onProgress?.(p));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => S && applyLook());
call("state").then((s) => {
  S = s;
  applyLook();
  rerender();
});
