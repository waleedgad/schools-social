# Code review of 0.11 and 0.12: handoff note

Thread "Review code of latest release" (started 17 Nov 2026, earlier Fable thread left no notes).
Branch: `claude/project-thread-yt6e2w`, starts from 0.12 branch `claude/project-thread-syqjmv` (abfcca3). Review only: no code fixes here unless noted. Never merge to main.

Scope: 0.11 = 5234bfc..main (81859f1), all desktop. 0.12 = main..syqjmv.
Bugs go in /mnt/project-files/tracker/bugs.md with the next B-number (other threads write there too: check the highest number first; B-110 was next at 09:10 on 17 Nov).

## Done
- 0.11 core reviewed: engine.ts, privacy.ts, sync.ts, web.ts, students.ts, books.ts; features faces/posts/students/library/books; main.ts website-check and can't-appear paths.
- 0.12 core reviewed: lock.ts, faces.ts (reading from original, second look, assignPhoto lead), engine.ts upgradeReading/tidy, B-96 renderer prefetch.
- Logged B-110 (can't-appear changes from class list import / undo / far likely faces never reach the website) and B-111 (website upload that is an exact copy never re-checked later). Both privacy, both New.

## Checked and fine (don't redo)
- B-89 replace then face re-scan race: onUploaded calls syncOptedOut after the replace, so the web copy is re-blurred.
- facePx now assumes the original's pixels: consistent with when the original is read (any face under 160 px on the copy). RAW width comes from the same preview, consistent.
- Mac menu keys vs renderer keys: menu uses registerAccelerator false, no double run.

## Notes (not bugs yet)
- engine.scan: the drive check is only at the start; a library drive unplugged half way through the walk marks the rest of the photos missing (readdir errors are ignored). Recovers when the drive is back; check again before marking missing.
- viewer.js here(): P or X pressed while the next photo is still loading treats it as unpicked (P on an already picked photo picks it again instead of clearing). Cosmetic.
- 0.11 renderer viewer.js and core.js keys reviewed: fine.
- lock.ts: if a job function ever threw synchronously, `running` would stay true and every picture job would wait for ever. All callers today are async functions, so it can't happen now; wrap `job.run()` in try/Promise.resolve when next touched.

## Next
- B-110/B-111 fix is committed (privacy.ts photosOfPeople/withCopies/noPostWebPhoto; main.ts consentNow/consentChanged in undo + commitStudents; syncOptedOut includes copies). Unit tests pass (68/68). Robot test added to e2e/web-replace.spec.ts: check its GitHub CI run (website job) on commit dca3b88 or later.
- Waleed was asked (decision card) whether to fix here; work went ahead on the recommended "yes". If he says "only log", leave the branch unmerged.
- Merge into the 0.12 branch syqjmv only after the CI run is green (and not into main).
- Not yet reviewed in depth: renderer ui.js, library.js, students.js (0.11 UI); website src/ (unchanged since 0.10).
