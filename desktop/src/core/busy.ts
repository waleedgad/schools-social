// What the app's background side is doing right now, and a watch that notes
// in the log when it was too busy to answer the window for over a second
// (with what it was doing), so a slow school computer can be looked into.
let doing = "idle";
// Single steps that held the background side up for a while (a slow
// database step, the part of a window request that can't wait), so a stall
// in the log names the step that caused it, not only what was running.
let slowSteps: { what: string; ms: number }[] = [];
export const busy = {
  set(what: string) {
    doing = what;
  },
  get() {
    return doing;
  },
  // Times a step that runs without pausing; notes it if it took 200 ms or more.
  time<T>(what: () => string, step: () => T): T {
    const t = performance.now();
    try {
      return step();
    } finally {
      const ms = performance.now() - t;
      if (ms >= 200) busy.slow(what(), ms);
    }
  },
  slow(what: string, ms: number) {
    slowSteps.push({ what, ms: Math.round(ms) });
    if (slowSteps.length > 20) slowSteps = slowSteps.sort((a, b) => b.ms - a.ms).slice(0, 10);
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
    if (lag > limitMs) {
      const steps = slowSteps.sort((a, b) => b.ms - a.ms).slice(0, 3).map((x) => `${x.what} ${x.ms} ms`);
      log(`busy for ${Math.round(lag)} ms (${before === doing ? doing : `${before} -> ${doing}`})${steps.length ? `; slow steps: ${steps.join("; ")}` : ""}`);
    }
    slowSteps = [];
    last = now;
    before = doing;
  }, tick);
  t.unref?.();
  return () => clearInterval(t);
}
