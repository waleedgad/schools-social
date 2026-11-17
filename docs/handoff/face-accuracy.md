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

- Draft PR #4 (this branch into `claude/project-thread-syqjmv`). The face test
  now runs on pull requests too, so PR #4 uses the 0.12 branch's stored faces.
  Experiments added to `desktop/bench/faces/run.mjs` class-of-30 section:
  `app+two…`, `app+pool…`, and 10 confirmed faces.

## Face test result (run 44050445006, 17 Nov, class of 30, app recogniser "both", 0 wrong unless said)

| Confirmed faces | app now | two-step 0.40/0.12 | two-step 0.37/0.16 | pooling 0.55 |
|---|---|---|---|---|
| 3 | 88.0% | 88.7% but 10 WRONG | 88.9% but 6 WRONG | 88.0% |
| 5 | 90.2% | 90.9% but 4 WRONG | 91.0% but 4 WRONG | 90.2% |
| 10 | 90.4% | 91.3% but 5 WRONG | 91.4% but 5 WRONG | 90.4% |

- Two-step rule: names wrong people. Rejected. Pooling: no gain. 10 confirmed
  faces: +0.2%. The app's rules stay as they are.
- Right first guess is 93-95% on these photos, and 43-47% of unnamed faces have
  the wrong person as first guess. So ~95% named by itself is above what the
  recogniser can do on these stand-in photos (adults, photos years apart).
  Matching rules are at their limit; the next real step needs the school's own
  photos (same students, same term), or a better free-for-commercial recogniser.

## Next

1. CI on PR #4: two test races fixed (face tile waits for the student; web
   copies wait for old pictures to go). Check the next Checks run is green.
2. When Waleed's real class photos arrive: run the class test on them.
3. Possible: try another commercially free recogniser, or extra looks per face
   (small shifts/zoom) when reading; both need a full re-read (~5 h).
