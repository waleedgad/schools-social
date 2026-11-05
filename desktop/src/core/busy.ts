// What the app's background side is doing right now, and a watch that notes
// in the log when it was too busy to answer the window for over a second
// (with what it was doing), so a slow school computer can be looked into.
let doing = "idle";
export const busy = {
  set(what: string) {
    doing = what;
  },
  get() {
    return doing;
  },
};

export function watchStalls(log: (m: string) => void, limitMs = 1000) {
  const tick = 200;
  let last = performance.now();
  let before = doing;
  const t = setInterval(() => {
    const now = performance.now();
    const lag = now - last - tick;
    // What ran when the stall started, and what was running when it ended.
    if (lag > limitMs) log(`busy for ${Math.round(lag)} ms (${before === doing ? doing : `${before} -> ${doing}`})`);
    last = now;
    before = doing;
  }, tick);
  t.unref?.();
  return () => clearInterval(t);
}
