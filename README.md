# School Social Hub

Turns the photos teachers and photographers take into approved, consent-safe,
AI-written Facebook and Instagram posts. Arabic first, English alongside.

The full product plan lives in the project's plan document. This repository
holds the web app (Next.js) and, from phase 2, the desktop library app.

## Phase 1 (this code)

- Sign up, sign in and sign out (Supabase Auth, email and password)
- Create a school; the creator becomes its admin
- Invite staff by link with a role: admin, comms, principal or teacher
- Admins change roles and remove staff
- Arabic (right to left) and English screens with a language switch
- Every school's data kept separate by database rules (row level security)
- An audit log of who did what

## Setup

### 1. Database (Supabase)

1. In the Supabase project, open **SQL Editor**, click **New query**.
2. Paste each file in `supabase/migrations/`, in order, and click **Run**.
3. Under **Authentication > URL Configuration**, set **Site URL** to the app's
   address (for example `https://schools-social.vercel.app`) and add
   `https://schools-social.vercel.app/**` to **Redirect URLs**.

### 2. Hosting (Vercel)

1. Import this repository at vercel.com (free Hobby plan).
2. Add the environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase **Project Settings > API > Project URL**
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the **publishable** (or anon) key
3. Deploy.

### Running locally

```bash
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

Open http://localhost:3000. The app redirects to `/ar` by default.

## Structure

| Path | What it holds |
| --- | --- |
| `src/app/[locale]/` | Pages, one folder per screen, under `/ar` or `/en` |
| `src/lib/actions/` | Server actions (sign in, create school, invites, roles) |
| `src/lib/roles.ts` | Who can do what, mirroring the plan's permissions table |
| `src/lib/supabase/` | Supabase clients for server code and the middleware |
| `messages/` | Arabic and English text |
| `supabase/migrations/` | Database tables, rules and functions |
