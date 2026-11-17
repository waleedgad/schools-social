# For the helper: everything you need (updated 17 Nov 2026, 16:25 Cairo)

Read this first. It replaces manager-instructions.md and manager-handoff.md.
Waleed is the product owner and does a short final check; he does not test. Status page for him: https://claude.ai/artifact/691oyedQyELer24ijAXrA5 (keep it current).

## Rules
1. Never touch main. It is fast-forwarded only after Waleed says OK.
2. Only one thread changes app code at a time, on one branch. Document-only work can run in parallel.
3. Log every bug in bugs.md and every new idea in later.md. Read the file right before adding and take the next free number (B- and L- numbers are shared).
4. Commit and push after each fix. Keep a status file in tracker/ and write a handoff note (done / next / branch) before any usage limit.
5. Never write "child" or "children" anywhere. Use Student / Parent / Teacher / Staff.
6. Only use libraries and models that are free for commercial use.
7. Image (sharp) jobs in the Electron main process go through exclusive() (core/lock.ts).
8. Database changes go to Waleed as copy-paste SQL on an artifact page (begin/commit + the schema_migrations insert), not through apply_migration.
9. When a step is finished, post one short line in your thread and go straight to the next step. Stop only for things that need Waleed.

## Where things stand
- Live: 0.11 (main = 81859f1).
- **0.12 is joined** on `claude/project-thread-q91dwp` (head 8b64991). It holds faces, blank-picture fixes, eyes-and-smiles models, code review, security, tricky bugs, Windows, picking/crop, speed and the test school set. Desktop unit tests 104/104, full robot suite 59 passed / 0 failed here. Version is still 0.11.0.
- Not run yet: GitHub CI on Mac/Windows/Linux, website robot tests against the test database, packaged-app and self-update tests.
- Handoff for 0.12: `docs/handoff/0.12-integration.md` on that branch.

## Branches (heads, 17 Nov)
| Branch | Work | Head | In 0.12? |
|---|---|---|---|
| q91dwp | 0.12 join | 8b64991 | the 0.12 line |
| y8c9mf | tricky bugs | 0a24017 | yes |
| tvatsr | Windows | 6ec16b9 | yes |
| tdms9w | security | 2d02c5c | yes |
| yt6e2w | code review | 4a7996f | yes |
| ovrmct | picking/crop | 170a754 | yes |
| j8o33s | test school set | 813a1f2 | yes |
| rm0zqe | speed | 85439fa | yes |
| opamc2 | face accuracy | d058b1a | yes |
| otm2k4 | captions (website) | e03828e | **no, kept off 0.12 on purpose** |
All branch names start with `claude/project-thread-`.

## Waleed's decisions (do not ask again)
- A student's name in a caption: warn only, never block.
- Gemini: free tier now, paid at the final release (only the key/billing changes).
- Eyes-and-smiles models: ship (Apache 2.0, recorded in desktop/models/README.md).
- KG Arabic wording: طلابنا ("our students").
- Real Facebook/Instagram posting test: later, not in 0.12.
- Ignore the leaked Google key note.

## Known trade-off from the speed work
The website now checks sign-in from the token (getClaims instead of getUser, Supabase's advice). A user who is removed keeps web access until their token runs out, at most about 1 hour. Tell Waleed in the 0.12 note.

## Known flaky CI tests (re-run before calling a failure real)
- Mac app robot tests on the macOS runner: sometimes fail, then pass on the next run.
- Windows: motion.spec (Faces tab moved 3% while still), books.spec B-88, huge-library "slowest" 2076 ms vs 2000 limit (slow runner).
- Windows "update" job (self-update test) failed once without logging "started".
- face-tile.spec (B-96) failed on all systems on the old base; fixed on q91dwp, so watch it.

## Owner page and plans spec
Spec (document only): https://claude.ai/artifact/K95DcwkWJkqZdH1wCNZkhS. Status: tracker/owner-plans-status.md.
It has **6 questions waiting for Waleed**. Read the doc first because he may have edited it. Do not re-raise the 12-month option.

## Next, in order
1. **0.12 live.** Run GitHub CI on q91dwp and fix real failures. Then Waleed's check on his Mac, using this list:
   1. Run Clean up, then without restarting open a photo big and open Faces > "Is this ...?": both sharp.
   2. Bin the newest photos, empty the Bin, import different photos, open them big: each shows itself.
   3. On a person's page choose "Use as main photo", then edit that photo in another app: the circle still shows their face.
   4. Make a book with an iPhone HEIC photo and a RAW-only photo, save the PDF: every picture present.
   5. Open Albums: no event card is empty.

   After his OK: bump to 0.12.0, write a plain note (with the ~1h trade-off), take screenshots in English and Arabic, publish the download via GitHub Releases, then fast-forward main.
2. **Captions.** Rebase otm2k4 onto the new main, get checks green, then Waleed looks at real captions on the test site.
3. **0.13 = owner page, plans and licences** (database + website), from the approved spec. Fresh branch from main; Waleed approves the release checklist first.
4. **0.14 = encrypted Mac database + app licence check** (swap node:sqlite for an encrypted library such as better-sqlite3-multiple-ciphers, MIT; one-time move of existing libraries; upgrade tests).
5. **Held items, one release at a time:** fake Meta server tests (L-24), yearbook auto-layout, release set-up (L-28), payment gateways (L-29). Ask Waleed again about the real posting test after 0.13.
6. **Phase 5:** Apple Developer by about 25 Jan 2027, signed Mac app, outside tester, 1.0 RC.

## Safe to do in parallel (documents only)
- Privacy papers for the lawyer: data and face-data map, draft privacy policy and school terms (Egypt PDPL 151/2020), marked "needs lawyer's check".
- 0.12 plain release note and Waleed's check list.

## Only ask Waleed for
Approving a spec or a release checklist, his short check of a release, OK to fast-forward main, anything that costs money, his own school photos (needed to get faces named past ~90% toward his 95% goal).

---
## Log of what the helper did (append one line after each step: date, what, branch/commit)
This repo copy is the source of truth. The copy in `tracker/for-helper.md` points here.

- 2026-11-17: read the other Claude's handoff, compared with the plan and rules (no code clashes; process notes reported to Waleed). Branch `claude/project-thread-q91dwp`.
- 2026-11-17: integrated PR #3's five blank-picture fixes (B-97..B-101) and the missing parts of PR #1 (B-102) onto the 0.12 line; dropped the duplicate B-96 fix. Branch q91dwp.
- 2026-11-17: joined opamc2 (face accuracy) and the helper's scan/lock fix (PR #5, logged B-129, B-130); shipped the eyes-and-smiles models (Apache 2.0 confirmed from Google's model cards, recorded in desktop/models/README.md).
- 2026-11-17: after Waleed's "go", joined yt6e2w, tdms9w, y8c9mf, tvatsr (one conflict in engine.scan, both rules kept), ovrmct, rm0zqe, j8o33s, final opamc2. Unit 104/104, robot 59 passed / 0 failed, website tsc + lint clean. Head 8b64991, report posted to Waleed.
- 2026-11-17 (Sonnet 5.5 helper "School Software 2"): ran the full robot suite on the joined 0.12 line (fa4c1a0): 59 passed, 0 failed, 19 skipped (need test database/website, Windows, real photo set, packaged app); unit 104 pass, tsc clean. Report: `docs/handoff/report-for-manager-2026-11-17.md` on `handoff/b96-claim`.
- 2026-11-17 (helper): started the documents-only item "privacy papers for the lawyer" (data and face-data map, draft privacy policy, school terms, Egypt PDPL 151/2020), plus the 0.12 plain release note and Waleed's check list. Docs-only branch `docs/privacy-papers` from main. No app code touched. Status: IN PROGRESS.
