# Handoff index: what was done on 16-17 Nov 2026 and where it is

Written by a Claude chat session working with Waleed. Read this first if you
are another Claude session or thread picking up this project. See `README.md`
in this folder for the rules.

## State of the branches (as of 17 Nov 2026, early morning Cairo time)

- `main` is behind: it stops at 81859f1 (11 Nov, desktop 0.11.0). Newer work is
  on thread branches. Do not assume `main` is current.
- `claude/project-thread-dmb0um` is the newest faces line (0.12 face reading +
  an unused "eyes and smiles" commit). Includes the work of du5t77 and syqjmv.
- `claude/project-thread-5y4cwl` is Egyptian-school Arabic captions (website only).
- `fix/b96-blank-face-tile` = dmb0um + one commit (the B-96 fix). Pull request #1.
- `fix/silent-blank-pictures` = the B-96 fix + five commits. Pull request #3 (base: the B-96 branch). Merge it after PR #1.

## Reports (all in this folder)

| File | What | Status |
|---|---|---|
| `B-96.md` | Bug B-96 (blank face tile): cause, fix, tests, what to check by eye | READY FOR REVIEW (PR #1) |
| `robot-suite-b96-2026-11-16.md` | Full robot-suite run on the B-96 fix | DONE: safe to merge; 8 database-dependent specs not run here |
| `branch-review-2026-11-16.md` | Review of the captions and faces branches: safety, conflicts, merge order, decisions for Waleed | DONE |
| `silent-blank-pictures-2026-11-17.md` | Sweep for other places a picture can silently come back blank: 5 real bugs fixed with tests on `fix/silent-blank-pictures` (on top of the B-96 fix) | READY FOR REVIEW (PR #3) |

## Suggested order for the release thread

1. Merge `fix/b96-blank-face-tile` (brings the whole faces line and the B-96
   fix). Re-run the Mac packaging job on PR #1 (it was cancelled for lack of a
   GitHub Mac runner, not failed). Run the full desktop suite once on the result.
2. Merge `fix/silent-blank-pictures` (PR #3) after it, then run the desktop suite again.
3. Merge the captions branch separately, after fixing the prompt line that lets a
   writer's request override the style (it makes student names in captions more
   likely) and the Gemini retry time (about 104 s worst case vs a 60 s website
   limit). See `branch-review-2026-11-16.md`.
4. Bump the desktop version (still 0.11.0).

## Decisions waiting on Waleed (details in the branch review)

Block or warn on student names in captions; Gemini free tier vs paid; ship or
hold the unused eyes-and-smiles models (6.8 MB); spot-check automatic naming on
one real class; KG wording (طلابنا vs أطفالنا).

## Not available to this session

The bug tracker (B-1 to B-96), the project plan document and the 0.12 scope live
in the Claude app's "Schools software" project, not in this repo. Take bug
numbers from there. B-96 was already claimed (see `B-96.md`).
