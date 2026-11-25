# Help pages for 0.13 to 0.17 features (handoff)

Branch: `claude/project-thread-vvoltq` (from main bb9832d). Thread: "Write Help pages for new features".
Tracker: /mnt/project-files/tracker/help-0.13-0.17-checklist.md

## Done
- Website Help (src/app/[locale]/help/page.tsx + `help` part of messages/en.json, ar.json): 8 new guides
  (captions, posting, check, inbox, books, cloud, connections, look) + an owner-only guide (owner page and
  Keys and switches) + 6 What's new lines (n7-n12, shown first). Only Help text and the Help page changed.
- Mac/Windows app Help (desktop/src/renderer/views/help.js): Yearbooks guide updated (auto layout, page-by-page
  approval, Put them all in the book), new guides Graduation, Easier reading, AI captions, Your plan and this
  computer, On the website; What's new for 0.13.0-0.17.
- Tests: src/lib/help-text.test.ts (both languages for every guide, no child/children/أطفال), e2e/help.spec.ts
  (website, desktop + phone, EN + AR, owner guide only for owners), desktop/e2e/help-guides.spec.ts (app, EN + AR).
  All pass locally, plus every-page (website) and every-tab (app).
- Screenshots: /mnt/project-files/screenshots/help-0.17/

## Important for go-live
The "posting" and "check" guides (and What's new n12 / app 0.17 line) describe release 0.17 features
(retries, Reconnect Facebook, Check connection, Keys and switches), which are on branch
claude/project-thread-6gqust and not live yet. Go live together with 0.17 or after it, not before.
The only shared files with 0.17 are messages/en.json and ar.json; this branch only adds keys inside `help`,
so a merge should be clean.

## Next
- Full GitHub checks ([full ci]) then Waleed's OK, together with 0.17.
- The app text ships with the next app download (no app build needed just for Help).
