# Face accuracy thread: handoff (keep current)

Thread "Improve face recognition accuracy". Branch `claude/project-thread-opamc2`.
Goal: about 95% of faces named by the app itself, with no wrong names.

## Done (17 Nov 2026)

- Branch made from the 0.12 line `claude/project-thread-syqjmv` (abfcca3, which
  already had one B-96 fix: urgent lane + look-ahead + white ring).
- The other B-96 fix (PR #1, db4e538) and the five blank-picture fixes (PR #3)
  were cherry-picked on top and joined with it, so B-96 is done once:
  urgent lane, look-ahead, small-copy fallback, picture names by face+photo+box,
  plain figure when there is no picture, white ring + dimming in both places.
  The unused "eyes and smiles" commit (b57e3a0, 6.8 MB of models) was NOT taken.
- Checks: desktop `npm test` 73/73; robot tests face-tile, face-tile-fallback,
  face-flaws, library-fixes, post-pictures, books pass under xvfb.
- The earlier face branch `claude/project-thread-56l8bf` was never pushed; its
  accuracy ideas below were not built yet.

## Next

1. Measure: run the face test (`.github/workflows/face-bench.yml`) on this branch.
2. Ideas to measure (from the 16 Nov notes): pool an unnamed face with its
   near-identical unnamed neighbours before matching; two-step "sure" rule
   (lower score allowed with a bigger lead); up to 10 confirmed faces per person.
   Last full run 43199549955 (12 Nov): class of 30 named by itself 84.8% (3
   confirmed) / 90.6% (5), 0 wrong.

## How to pick this up

`git fetch origin claude/project-thread-opamc2 && git checkout claude/project-thread-opamc2`,
read this file, carry on from "Next". Update this file and push after each step.
