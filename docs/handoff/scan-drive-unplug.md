# Scan: drive unplugged mid-walk + lock sync-throw

Status: READY FOR REVIEW (branch `fix/scan-drive-unplug`, based on `claude/project-thread-syqjmv`)
Written by: helper session (Sonnet 5.5, "School Software 2"). Needs B-numbers from the tracker (helper cannot see it).

## 1. Scan marks photos missing when the drive drops out during the walk
- Cause: `Engine.scan()` checked the library folder only at the start. A folder that failed to read part-way (EIO, ETIMEDOUT, ENOTCONN, EACCES) was skipped silently, so everything under it counted as "not seen" and got `missing = 1`.
- Fix: unreadable folders (anything but ENOENT/ENOTDIR) are tracked; after the walk the library root is checked again. New pure helper `src/core/scan-missing.ts` (`missingAfterScan`) decides what is really missing: nothing if the root is gone, nothing under an unreadable folder. Photos on the archive drive are still ignored as before.
- Tests: `src/core/scan-missing.test.ts` (4 cases).

## 2. lock.ts: a job that throws synchronously froze the whole queue
- Cause: `job.run()` throwing before returning a promise left `running = true` forever, so every later picture/import waited for ever.
- Fix: the call is wrapped so a sync throw becomes a rejection and the line is released.
- Test: `src/core/lock.test.ts` new case (fails without the fix, passes with it).

## Checked
- `npm test`: 71/71 pass. `npx tsc --noEmit`: clean. Robot `missing-folders.spec.ts`: 3/3 pass.
- Not run: the other robot specs (library, imports, nothing-hangs, big-import). Please run before merging.

## Next
Reviewer/manager: give B-numbers, run the remaining robot specs, merge into the syqjmv line.
