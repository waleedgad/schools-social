# Face test on the school's own photos: handoff (keep current)

Thread "Prepare face accuracy test for real photos". Branch
`claude/project-thread-5flo3l` (from main bb9832d). Only new files: no app or
website code changed, so it can't clash with 0.17.

## What it is

- `desktop/bench/real-faces/face-test.sh <folder>`: the one command. Checks
  Node 20+, `npm ci` (no Electron download) and `tsc` the first time, finds
  AuraFace (the installed Mac/Windows app's copy, else downloads it once into
  `bench/real-faces/.models/`, git-ignored), runs `run.mjs`.
- `desktop/bench/real-faces/run.mjs`: reads the folder layout in
  `docs/face-test-guide.md` (class list + `Students/<name or ID>/` + optional
  `Staff/`, `Not in list/`, `Class photos/<class>/`). Uses the app's own
  `dist/core` code: findFaces, assignPhoto (one person per photo), gender /
  student-adult guess, isSure + handAgrees, learning (learnFrom) over up to 4
  rounds, class matching like engine.knownFor. Truth = biggest face in a
  student's photo (left out when the second face is >= 1/1.8 of its size, the
  same rule as bench/faces). Confirmed faces: portrait first, then oldest.
  Runs k = 1/3/5 (FACE_TEST_K), own class and whole school.
- Output `<folder>/face-test-results/`: `summary.md` + `summary.json` (codes
  like 5A-07, no names or file names: shareable), `private/` (names, misses
  list, `check.html` with face crops + tick boxes, `faces-cache.json` = face
  descriptions, makes re-runs quick; delete after).
- `make-stand-in.mjs` + `.github/workflows/real-face-test.yml`: dry run on
  GitHub with the Commons stand-in photos (60 people in 3 classes, 10 not in
  list, 15 photos each, NOT cleaned, so misfiled Commons photos count).

## Status

- 25 Nov 01:15 UTC: local smoke test passes (made-up set from the astronaut
  picture, SFace only, broken file, unmatched folder, ID-named folder).
  First GitHub dry run 45524409952 (25 Nov, 1,050 photos read in 28 min with
  AuraFace): works end to end. Numbers low (52.9% of all student photos,
  0 wrong) because the stand-in photos are NOT cleaned: 530 of 900 crowded
  (left out), 40 no face found, ~40 unusable. 7 "not in list" faces named:
  all faces of those photos were counted, so list people in the background
  counted as wrong. Fixed: only the main face of a "not in list" photo counts,
  and the headline is now "of the faces it could see clearly" (as the bench
  measures) with the all-photos number under it. Dry run now 25 photos/person.

## Next

1. Read the dry run's summary (job log tail / step summary); fix anything odd.
2. When Waleed's folder is ready: Remote Control on his Mac, run
   `face-test.sh "$HOME/Desktop/Face test"`, read ONLY summary.md.
3. Don't retry rejected ideas (two-step sure rule, pooling, 10 faces).
