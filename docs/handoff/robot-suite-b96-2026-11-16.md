# Full robot-suite run on the B-96 fix (16-17 Nov 2026)

Branch tested: `fix/b96-blank-face-tile` (commit db4e538), pull request #1.
Base: `claude/project-thread-dmb0um` (b57e3a0). Run on Linux, headless (xvfb).

**Verdict: safe to merge.** No failure was caused by B-96. Nothing needed fixing.
This is a report from a helper agent; the release thread should still run the
full suite once on the merged result.

## What ran here: 67 tests in 15 minutes

52 passed, 0 failed, 15 skipped themselves.

Passed: accessibility, announcements, big-import, books, electron-security,
every-tab, face-flaws, face-tile, huge-library, imports, keyboard-text,
library, library-fixes, missing-folders, motion, names-and-paths,
nothing-hangs, pc-keys, shortcuts, update-check, upgrade, web-address.

## What could not run here, and why

- Need the test database and website keys (not available in this session):
  book-review, calendar, error-reports, make-week, post-pictures,
  teacher-check, web-replace, web-sync. Treat these as NOT independently
  verified from this run.
- faces-real: needs stand-in face photos downloaded from Wikimedia; blocked by
  the session's network proxy (403).
- packaged: only runs against a packaged build.
- windows-card: Windows only.
- motion-sweep and make-old-library: opt-in tools, not regular checks.

## What GitHub's own runs show for the same commit

- "Faces in the app" (the faces-real test) passed on Linux, Windows and Mac.
- "Checks" for the push passed in full: desktop robot suite on Linux, Windows
  and Mac, both packaged builds, and the website.
- Not confirmed: whether the eight database-dependent specs actually executed
  inside those GitHub runs.

## The red mark on pull request #1

The pull-request copy of "Checks" shows as failed only because the Mac
packaging job was cancelled after about 30 minutes: GitHub had no free Mac
machine ("job was not acquired by Runner"). The identical job passed in the
push run of the same commit. Re-run that one job to clear it.

## Pre-existing, for the release thread

The base commit b57e3a0 has a failed GitHub run in the Windows desktop robot
tests. The same job passes on the B-96 commit. Which test failed on the base was
not investigated.
