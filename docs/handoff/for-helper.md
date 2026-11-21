# For the helper: everything you need (updated 17 Nov 2026, 16:25 Cairo)

Read this first. It replaces manager-instructions.md and manager-handoff.md.
Waleed is the product owner and does a short final check; he does not test. Status page for him: https://claude.ai/artifact/691oyedQyELer24ijAXrA5 (keep it current).

## UPDATE 21 Nov 2026 (newer than everything below; the "Where things stand" and "Next, in order" parts are OUT OF DATE)
Live now: 0.12 + 0.13 on main = 0cfc61b. Next release is 0.14 (Mac check, real FB/IG post test, read-excel-file fix, design+accessibility+security). Captions are 0.15.
Two code threads are running on their own branches: (A) "Add design style, accessibility, security check" and (B) "Finish yearbook, graduation, inbox, integrations". Do not touch their files.

### WHO DOES WHAT (21 Nov, decided with Waleed)
- Thread "Test and secure live 0.13 (helper)" already does tasks 1 and 2.
- **The OTHER Claude (Waleed's own Claude, reads this file) does tasks 3 and 4** (fake Meta server tests, then privacy papers for the lawyer). Skip 1 and 2. When done, write tracker/helper-report-21nov-other.md and tell Waleed; the coordinator will check it.

### Helper tasks (do now, in this order; none of them change app code on those branches)
1. **Bug testing of live 0.13 (read-only for code).** Run the Playwright end-to-end suite against a local copy of main (source e2e/test-db.env first). Then click through the owner page, plans, trial, read-only and blocked states in English and Arabic, on phone and desktop sizes. Log every bug in bugs.md with the next free B-number.
2. **Security testing (read-only).** Check that one school can never read or change another school's data (students, photos, posts, face data, plans) through the website routes and Supabase row-level security; check owner-only routes reject non-owners, upload routes reject bad files and sizes, and the licence/read-only/blocked rules are enforced on the server. Add findings to tracker/security-check.md. Do not change code for them; log them so thread A can fix.
3. **Fake Meta server tests (L-24).** New test-only files, no edits to app source except a config switch for the Meta base URL.
4. **Privacy papers for the lawyer** (documents only): data and face-data map, draft privacy policy and school terms (Egypt PDPL 151/2020), marked "needs lawyer's check".

5. **Payment gateways research (document only, L-29).** Compare Paymob, Fawry, Kashier for selling the system to Egyptian schools (fees, recurring billing, EGP/USD, onboarding needs, API). Recommend one. Write tracker/payments-research.md.
6. **Release set-up and monitoring files (L-28, CI/config only, new files, on its own branch).** release-please config, Lighthouse CI, health-ping workflow, Electron Fuses settings proposal, ZAP baseline workflow. Do not edit app source.
7. **Windows signing and Apple Developer prep (documents only).** Compare a normal Windows code-signing certificate vs Microsoft Store for an Egypt-based seller (cost, steps, timing), and list exact steps for the Apple Developer join by about 25 Jan 2027. Write tracker/signing-options.md so Waleed can choose.
8. **Test data and screenshots (read-only on code).** Refresh Arabic/English screenshots of live 0.13 screens into /mnt/project-files/screenshots/0.13/ where missing.

### Report back
When finished (or at each safe point), write tracker/helper-report-21nov.md: done / bugs found (B-numbers, severity) / security findings / what is next / branch names. Post one short line in your thread. The coordinator (me) will check the report when you finish and relay it to Waleed. Commit and push often and leave a handoff note before any usage limit.

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
This repo copy and the shared-folder copy (`tracker/for-helper.md`) hold the same instructions (synced 21 Nov 2026); this log lives here.

- 2026-11-17: read the other Claude's handoff, compared with the plan and rules (no code clashes; process notes reported to Waleed). Branch `claude/project-thread-q91dwp`.
- 2026-11-17: integrated PR #3's five blank-picture fixes (B-97..B-101) and the missing parts of PR #1 (B-102) onto the 0.12 line; dropped the duplicate B-96 fix. Branch q91dwp.
- 2026-11-17: joined opamc2 (face accuracy) and the helper's scan/lock fix (PR #5, logged B-129, B-130); shipped the eyes-and-smiles models (Apache 2.0 confirmed from Google's model cards, recorded in desktop/models/README.md).
- 2026-11-17: after Waleed's "go", joined yt6e2w, tdms9w, y8c9mf, tvatsr (one conflict in engine.scan, both rules kept), ovrmct, rm0zqe, j8o33s, final opamc2. Unit 104/104, robot 59 passed / 0 failed, website tsc + lint clean. Head 8b64991, report posted to Waleed.
- 2026-11-17 (Sonnet 5.5 helper "School Software 2"): ran the full robot suite on the joined 0.12 line (fa4c1a0): 59 passed, 0 failed, 19 skipped (need test database/website, Windows, real photo set, packaged app); unit 104 pass, tsc clean. Report: `docs/handoff/report-for-manager-2026-11-17.md` on `handoff/b96-claim`.
- 2026-11-17 (helper): started the documents-only item "privacy papers for the lawyer" (data and face-data map, draft privacy policy, school terms, Egypt PDPL 151/2020), plus the 0.12 plain release note and Waleed's check list. Docs-only branch `docs/privacy-papers` from main. No app code touched. Status: IN PROGRESS.
- 2026-11-17 (helper): privacy papers, 0.12 release note and Waleed's check list written, documents only. Branch `docs/privacy-papers` (head e0911bd), PR to main (do not merge before Waleed's OK). Files: `docs/legal/{README,data-map,privacy-policy-draft,school-terms-draft}.md`, `docs/release/{0.12-release-note,0.12-check-list}.md`. Status: READY FOR REVIEW. Needs from you: (1) B-numbers for the release note lines (helper cannot see bugs.md); (2) Waleed's decision on the Gemini free tier with student photos (README question 4); (3) the **[DEV]** items listed in `docs/legal/README.md` go to whichever thread owns app code. Owner page and plans spec: NOT touched (release 0.13).
- 2026-11-17 (evening): checked GitHub Checks on q91dwp (head 688ffa7): Mac, Windows, Linux desktop, both packaging jobs and the update test all green. Website job failed twice: first run in 'Mac app and website together' (web-replace.spec timing flake, passed on 8b64991 and 8ef722e); re-run stopped earlier at 'npm audit --omit=dev --audit-level=high': new advisory GHSA-fc5q-39xc-vjpf on picomatch 4.0.7 (latest version, via next-intl > @parcel/watcher), no patched version exists yet, 'npm audit fix' changes nothing. Not a code problem; needs Waleed's/manager's call (allow-list it or wait). Branch q91dwp.
- 2026-11-17 (evening): Waleed OK'd (decision card) allowing only GHSA-fc5q-39xc-vjpf in the website audit step: new scripts/audit-check.mjs with a one-entry allow-list and a remove-me note; checks.yml website job uses it (tested: passes now, fails if the entry is removed). Desktop audit step unchanged. Branch q91dwp.
- 2026-11-17 (night): GitHub Checks on 08284c9 ALL GREEN (website incl. web-replace and the new audit script, desktop Linux/Mac/Windows, both packaging jobs, update test). One Windows robot test (library-fixes B-10+B-19) failed once and passed on re-run: slow-runner flake (passed on the same code in two earlier Windows runs). 0.12 is ready for Waleed's Mac check. Branch q91dwp.
