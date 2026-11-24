# Release and monitoring set-up (L-25, L-27, L-28; helper 24 Nov 2026)

New CI/config files only. No app source changed. All free tools.

| File | What it does | When it runs | Needs from Waleed |
|---|---|---|---|
| `.github/workflows/lighthouse.yml` + `lighthouserc.json` | Lighthouse (Apache-2.0) scores the public pages (EN/AR sign-in, sign-up, forgot password) on a phone: speed, accessibility, best practice. Report kept as "lighthouse-report". Warns, never fails. | Monday 04:23 UTC + "Run workflow" | nothing |
| `.github/workflows/health-ping.yml` | Every 30 min checks that schoolsocialhub.seen-marketing.net/en/login and /ar/login answer 200. | every 30 min (main only) | optional: a free healthchecks.io check (period 30 min, grace 30 min), its ping URL saved as repo secret `HEALTHCHECK_URL`, so a missed ping emails him |
| `.github/workflows/release-please.yml` + `release-please-config.json` + `.release-please-manifest.json` | release-please (Apache-2.0) opens one pull request that raises desktop/package.json and writes desktop/CHANGELOG.md from commit messages. Does not tag or publish (desktop-v* flow stays). | on demand only | nothing |

Already in place before this (no change): Electron Fuses in `desktop/electron-builder.yml` (runAsNode off, NODE_OPTIONS off, only load from asar; checked by `desktop/e2e/packaged.spec.ts`), ZAP weekly scan (`zap.yml`), CodeQL (`codeql.yml`). Still open: cookie-encryption and asar-integrity fuses after a signed build (L-34), ZAP of signed-in pages (L-35).

## First local Lighthouse run (24 Nov 2026, built site, no database)
Speed 83-89, accessibility 100, best practice 100, SEO 100 on all four pages. Limits: speed warns below 80, accessibility below 95, best practice below 90.

## release-please only works with typed commit messages
It reads the start of each commit message: `feat:` (New), `fix:` (Fixed), `perf:` (Faster), `security:`; `docs:`, `test:`, `ci:`, `chore:` are hidden. Our commits are plain sentences today, so it would find nothing. To use it, code threads start commit messages with one of those words (keep the plain sentence after it, and B-numbers). Note: a pull request opened by the built-in GitHub token does not start the Checks workflow; run Checks on it by hand ("Run workflow") or with `[full ci]` in a follow-up commit.

## Posting-timer monitoring (needs a small app change later, not done)
The real risk is "posts silently never go out": Supabase pg_cron calls `/api/cron/publish` every 5 minutes. The health ping does NOT call that address (calling it runs publishing). Proposal for the code thread: at the end of a successful run, `/api/cron/publish` fetches `process.env.HEALTHCHECK_CRON_URL` (a second healthchecks.io check, period 5 min, grace 15 min) with a 3 s timeout and ignores errors. Logged as part of L-27.
