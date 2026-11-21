# Helper report, 21 Nov 2026: tasks 3 and 4 (the "other Claude")

Status: DONE, ready for the coordinator. Written by Waleed's own Claude (Sonnet 5.5, project "School Software 2"). The shared folder `tracker/` is not reachable from this session, so **this repo copy is the report**; please copy it to `tracker/helper-report-21nov-other.md`.
Skipped as instructed: tasks 1 and 2 (other helper thread). Tasks 5-8 were not assigned to me.

## Task 3: fake Meta server tests (L-24): DONE
- PR **#23**, branch `test/fake-meta-graph` (from main d872b95). **Test-only: 3 new files, no app source changed.**
- Found first that `META_GRAPH_URL`, `e2e/fake-meta.mjs` and two database-dependent robot tests (`publish-meta`, `inbox`) already existed, so the switch needed no change. The gap was everything that needs a *scripted* failure.
- Added `e2e/fake-graph.ts` (fake Graph API inside one test file, records every call), `e2e/meta-graph.spec.ts` (**27 tests**, no database, no browser, about 4 s) and `e2e/meta.config.ts` (run alone: `npx playwright test -c e2e/meta.config.ts`).
- Covers: Facebook text/single/multi-photo posts; Instagram single, carousel, story, limits (20 photos, 3 collaborators); processing ERROR / EXPIRED / IN_PROGRESS; expired token (190), rate limit (4), restricted Page message, error inside a 200, non-JSON 502, a failed photo leaves no post; app-secret proof; comment ids cannot aim the Page key elsewhere (B-119 guard); comments, replies, hiding; metrics; sign-in code to Pages.
- Result: 27 passed, `tsc` and `eslint` clean. **Six deliberate breakages** of `meta.ts` were each caught, then `meta.ts` restored.
- The spec lives in `e2e/`, so the existing CI step `npm run test:e2e` runs it (desktop project only).
- Not covered (needs the database): what the publisher does with these errors to a post's status, retries, and Instagram's 30-second "took too long" wait. Suggest a follow-up in CI.
- Bugs found: **none** in `meta.ts`. (No B-numbers taken: I cannot see bugs.md.)

## Task 4: privacy papers for the lawyer: DONE
- PR **#22**, branch `docs/privacy-papers-0.13` (from main d872b95). Documents only. Replaces PR #6 (closed).
- Files: `docs/legal/{README,data-map,privacy-policy-draft,school-terms-draft}.md`. All marked "needs lawyer's check". The banned-word rule (rule 5) was checked.
- Updated for live 0.13: owner page and what owners can read, payments, per-school library key kept in our database, licence check every 6 h, Mac-off emails (Resend, not yet on), 6-month clean-up, blocked schools.
- Law: PDPL 151/2020 and the Executive Regulations of 1 Nov 2025 (summarised from law-firm articles, **lawyer must verify**).
- 16 questions for the lawyer are in `docs/legal/README.md`.

## For Waleed (decisions)
1. **Gemini free tier with students' photos.** Google's terms say free-tier content may be used to improve its products, human reviewers may read it, and personal or sensitive data should not be sent. Our AI picks send student photos. You decided "free now, paid at final release": the lawyer papers recommend **not using real students' photos on the free tier**. Your call.
2. A school that stops paying becomes read-only for 14 days, then blocked. **No rule says what happens to its data.** Needs a decision and a job.

## For the app-code threads (found while writing, nothing changed by me)
- No age limit for error reports, problem reports (screenshots can show students), activity log.
- Delete one student / delete a school end to end; export one person's data.
- Check expired face-question pictures are really deleted by a job.
- Notice before a screenshot is sent with a problem report.
- Confirm in the security test (task 2) that an owner account cannot read students, photos or posts (policies say it cannot).
- Library key is stored in our database (`school_keys`): key custody and loss need a rule.
- A written breach plan (72-hour notice to the Data Protection Centre).

## Next (nothing waiting on me)
Merge order suggestion: #23 (tests, safe), #22 (documents) after Waleed looks. Neither touches app code. Open to tasks 5-8 if the coordinator wants me to take them.
