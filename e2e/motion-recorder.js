// Records how a page LOOKS while it changes, not just whether it works:
// animations that start, layout shifts, long frames, pictures popping in,
// the page going blank, scroll positions thrown away and typing focus lost.
// Shared by the website robot tests (e2e/motion.spec.ts) and the Mac/Windows
// app ones (desktop/e2e/motion.spec.ts). Injected as a plain script.
(() => {
  if (window.__motion) return;
  const M = (window.__motion = { events: [], input: -1e9, frames: 0, mark: 0 });
  const now = () => performance.now();
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return String(el && el.nodeName);
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList && el.classList.length) s += "." + [...el.classList].slice(0, 3).join(".");
    const p = el.parentElement;
    if (p && p !== document.body) s = (p.id ? "#" + p.id : p.tagName.toLowerCase() + (p.classList[0] ? "." + p.classList[0] : "")) + " > " + s;
    return s;
  };
  const log = (kind, data) => M.events.push({ kind, t: Math.round(now()), sinceInput: Math.round(now() - M.input), ...data });
  for (const ev of ["pointerdown", "keydown", "wheel", "input"]) addEventListener(ev, () => (M.input = now()), true);

  // Animations: every one that starts, with what it ran on.
  addEventListener("animationstart", (e) => log("anim", { name: e.animationName, el: sel(e.target) }), true);
  // Layout shifts that the person didn't cause.
  try {
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => {
        if (!e.hadRecentInput && e.value > 0.0005) log("shift", { value: +e.value.toFixed(4), els: (e.sources || []).map((s) => sel(s.node)).slice(0, 3) });
      }),
    ).observe({ type: "layout-shift" });
  } catch {}
  // Frames that took longer than 50 ms (the screen froze for that long).
  try {
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => {
        if (e.duration > 50)
          log("long", {
            ms: Math.round(e.duration),
            scripts: (e.scripts || []).slice(0, 2).map((s) => `${s.sourceFunctionName || s.invoker || ""}@${(s.sourceURL || "").split("/").pop()}`),
          });
      }),
    ).observe({ type: "long-animation-frame" });
  } catch {}

  // A picture taken off the screen and put back as a new element: it can
  // flash empty while it loads again.
  // (The same element only moved to another place doesn't count.)
  const removed = new Map();
  const imgs = (n) => (n.nodeType !== 1 ? [] : n.tagName === "IMG" ? [n] : [...n.querySelectorAll("img")]);
  new MutationObserver((muts) => {
    const t = now();
    const gone = new Set();
    for (const m of muts) m.removedNodes.forEach((n) => imgs(n).forEach((i) => { if (i.src) { removed.set(i.src, t); gone.add(i); } }));
    for (const m of muts)
      m.addedNodes.forEach((n) =>
        imgs(n).forEach((i) => {
          if (!gone.has(i) && removed.has(i.src) && t - removed.get(i.src) < 100) log("reimg", { el: sel(i) });
        }),
      );
    if (removed.size > 5000) removed.clear();
  }).observe(document, { childList: true, subtree: true });

  // Scroll positions: remember where each scrolled box was, so a box that is
  // drawn again back at the top is caught.
  const scrolled = new Map(); // selector -> { el, top }
  addEventListener("scroll", (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || el.nodeType !== 1) return;
    const k = sel(el);
    const was = scrolled.get(k);
    // Thrown back up without the person scrolling (the box was filled again).
    if (was && was.el === el && el.scrollTop < was.top - 40 && now() - M.input > 600) log("scrolljump", { el: k, from: Math.round(was.top), to: Math.round(el.scrollTop) });
    scrolled.set(k, { el, top: el.scrollTop });
  }, true);

  let focused = null;
  addEventListener("focusin", (e) => (focused = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) ? e.target : null), true);

  const frame = () => {
    M.frames++;
    const vw = innerWidth, vh = innerHeight;
    // Pictures on screen that aren't drawn yet (popping in).
    let pending = 0, first = null;
    for (const i of document.images) {
      if (i.complete && i.naturalWidth) continue;
      const r = i.getBoundingClientRect();
      if (r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) {
        const cs = getComputedStyle(i);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        pending++;
        first = first || sel(i);
      }
    }
    if (pending) log("popin", { n: pending, el: first });
    // The main area with nothing in it at all.
    const main = document.querySelector(window.__motionMain || "#main, main");
    if (main && main.getBoundingClientRect().height > 50 && main.innerText.trim().length < 3 && !main.querySelector("img, canvas, svg, video")) log("blank", { el: sel(main) });
    // A scrolled box replaced by one back at the top.
    for (const [k, v] of scrolled) {
      if (v.el.isConnected || v.top < 40) continue;
      scrolled.delete(k);
      const again = [...document.querySelectorAll(v.el.tagName)].find((x) => sel(x) === k);
      if (again && again.scrollTop < v.top - 40) log("scrollreset", { el: k, from: Math.round(v.top), to: Math.round(again.scrollTop) });
    }
    // Typing field taken away while the person was in it.
    if (focused && !focused.isConnected) {
      log("focuslost", { el: sel(focused) });
      focused = null;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // For the tests: everything since the last mark.
  M.take = () => {
    const out = M.events.slice(M.mark);
    M.mark = M.events.length;
    return out;
  };
})();
