// On Windows a file can't be moved while anything has it open, even for a
// moment (the app making a thumbnail, the antivirus, the search indexer), so
// a busy file is tried again for a few seconds before giving up. Found by the
// B-04 robot test on Windows.
export async function retryBusy<T>(job: () => Promise<T>, tries = 12): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await job();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= tries || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, Math.min(100 * i, 500)));
    }
  }
}
