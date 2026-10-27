// Image work runs one job at a time. Several sharp calls at once crash
// Electron's main process, and one job already uses every CPU core.
let tail: Promise<unknown> = Promise.resolve();

export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}
