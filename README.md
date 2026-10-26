# School Social Hub

Turns the photos teachers and photographers take into approved, consent-safe,
AI-written Facebook and Instagram posts. Arabic first, English alongside.

The full product plan lives in the project's plan document. This repository
holds the web app (Next.js) and, from phase 2, the desktop library app.

## What it does

- **Accounts and roles:** schools, staff invites by link, roles (admin,
  comms, principal, teacher), every school's data kept apart by database rules.
- **Photos in:** phone and computer upload, a no-account upload link per
  event for photographers and agencies, and the desktop library app
  (`desktop/`) that watches the school's photo folder.
- **Library:** events, AI "best first" picks with quality and sensitivity
  flags, a photo editor (auto enhance, light, colour, crop for Instagram),
  "not for posting" flags.
- **Students and consent:** import class lists from Excel or CSV (Arabic or
  English headers); no answer counts as no.
- **Posts:** pick photos, AI writes Arabic and English captions in the
  school's voice, draft → review → approve → schedule or publish now.
  Sensitive posts need the principal or admin. Privacy checks block
  opted-out photos, student names in captions and bad Instagram shapes.
- **Publishing:** Facebook Page and Instagram business account through the
  Meta Graph API; a Supabase job runs the publisher every 5 minutes.
- **Calendar, school settings, activity log.**

## Setup

### 1. Database (Supabase)

1. In the Supabase project, open **SQL Editor**, click **New query**.
2. Paste each file in `supabase/migrations/`, in order, and click **Run**.
   `0006_publish_schedule.sql` holds the app's address; change it first if
   yours isn't `schools-social.vercel.app`.
3. Under **Authentication > URL Configuration**, set **Site URL** to the app's
   address (for example `https://schools-social.vercel.app`) and add
   `https://schools-social.vercel.app/**` to **Redirect URLs**.

### 2. Hosting (Vercel)

1. Import this repository at vercel.com (free Hobby plan).
2. Add the environment variables from `.env.example` (the Vercel and
   Supabase integration adds the Supabase ones for you):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret, server only)
   - `GEMINI_API_KEY` for AI
   - `META_APP_ID`, `META_APP_SECRET` for Facebook and Instagram
3. Deploy. **School settings > Setup status** shows which keys are missing.

### 3. Facebook and Instagram (Meta)

1. At developers.facebook.com create an app (type Business).
2. Add **Facebook Login for Business**; in its settings add the redirect URL
   `https://schools-social.vercel.app/api/meta/callback`.
3. While testing, add yourself as an app tester/admin and use a test
   Facebook Page linked to an Instagram **business** account. Real schools
   need Meta's App Review for `pages_manage_posts` and
   `instagram_content_publish` (and business verification).
4. In the web app: School settings → Connect Facebook and Instagram.

### 4. Desktop app

See `desktop/README.md`. Build the Windows and Mac installers from GitHub
Actions → "Desktop app".

### Running locally

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev
```

Open http://localhost:3000. The app redirects to `/ar` by default.

## Structure

| Path | What it holds |
| --- | --- |
| `src/app/[locale]/` | Pages, one folder per screen, under `/ar` or `/en` |
| `src/lib/actions/` | Server actions (one file per area) |
| `src/lib/ai/` | AI provider interface, Gemini and the no-key sample provider |
| `src/lib/meta.ts`, `src/lib/publish.ts` | Facebook and Instagram publishing |
| `src/lib/privacy.ts` | Checks run before a post is approved |
| `src/app/api/` | Meta login, the publish job and the desktop app's config |
| `desktop/` | The Electron desktop library app |
| `src/lib/roles.ts` | Who can do what, mirroring the plan's permissions table |
| `src/lib/supabase/` | Supabase clients for server code and the middleware |
| `messages/` | Arabic and English text |
| `supabase/migrations/` | Database tables, rules and functions |
