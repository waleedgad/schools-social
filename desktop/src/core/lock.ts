// Image work runs one job at a time. Several sharp calls at once crash
// Electron's main process, and one job already uses every CPU core.
//
// Background work (reading photos, finding faces) waits in line. A picture a
// person is looking at right now (a face tile, a preview, a thumbnail) is
// "urgent": it goes ahead of the background jobs that are still waiting, so
// the screen never sits blank behind minutes of face finding (B-96).
type Job = { run: () => Promise<unknown>; done: (ok: boolean, v: unknown) => void; urgent: boolean };
const waiting: Job[] = [];
let running = false;

function next() {
  if (running) return;
  const i = waiting.findIndex((j) => j.urgent);
  const job = waiting.splice(i >= 0 ? i : 0, 1)[0];
  if (!job) return;
  running = true;
  // A job that throws before it returns a promise must not leave the line stuck.
  let started: Promise<unknown>;
  try {
    started = job.run();
  } catch (e) {
    started = Promise.reject(e);
  }
  started
    .then((v) => job.done(true, v), (e) => job.done(false, e))
    .finally(() => {
      running = false;
      next();
    });
}

export function exclusive<T>(fn: () => Promise<T>, opts: { urgent?: boolean } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({ run: fn, urgent: !!opts.urgent, done: (ok, v) => (ok ? resolve(v as T) : reject(v)) });
    next();
  });
}
