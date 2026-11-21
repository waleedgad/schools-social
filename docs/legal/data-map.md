# Data map: what School Social Hub holds, where, and who sees it

Status: DRAFT, **needs lawyer's check**. First written 17 Nov 2026 from the 0.12 line, **updated 21 Nov 2026 for live 0.13** (main = d872b95: owner page, plans, licences, encrypted Mac library, Mac-off email, 6-month clean-up). Facts below come from the database migrations (`supabase/migrations/0001..0020`) and the desktop code. Items marked **[CHECK]** are things the code cannot tell us.

## 1. The three places data lives

| Place | What it is | Who runs it |
|---|---|---|
| **The school's Mac or PC** (desktop app) | The photo library and its index, `library.db` (SQLite) in the app's data folder, plus the original photos in the school's own folder | The school |
| **The website** (Next.js on Vercel) and its **database and file storage** (Supabase: Postgres + a private `photos` bucket) | Staff accounts, the class list, small web copies of chosen photos, posts, approvals | Us (the product owner) [CHECK: company name; hosting regions of Vercel and Supabase] |
| **The operator's owner page** (`/owner`, 0.13) | Plans, payments, notes and a log about each school; lets the product owner see every school's staff list | The owner account(s) only (table `owners`) |
| **Outside services** the website calls | Google Gemini (AI picks and captions), Meta (Facebook Page and Instagram posting), Supabase sign-in (email or SMS one-time code), optional WhatsApp photo intake | Third parties, see section 5 |

Principle in the product: **the originals and the face data stay on the school's computer. Only small web copies of chosen photos go to the website.**

## 2. Data about people

### 2.1 Students, teachers, staff, parents, visitors (table `students`, kind = student / teacher / staff / parent / visitor)
Sent from the Mac when the school imports a class list (`desktop/src/core/web.ts`).
- Full name (English, and Arabic `name_ar`), school's own student ID (`student_code`), class, grade, stage
- Birthday (`birthday`), joined and left dates, active flag, history, clubs, achievements, class teacher name
- Parent phone number (`parent_phone`), read from the class list if present [CHECK: confirm whether schools must provide it; if not, consider removing]
- **Consent for social media** (`consent_social`: yes / no / unknown; no answer counts as no)
- Many of these are **minors' data**.

### 2.2 Face data (**biometric**, highest sensitivity)
- Made **on the Mac only**: faces are found (YuNet) and described as lists of numbers (SFace: 128 numbers; the optional second recogniser: 512 numbers) and stored in `library.db` table `faces` (column `embedding`). A second kind of picture "fingerprint" (`photos.clip`) is stored for picking similar photos.
- The numbers are matched to students only after **a person says yes** (suggestions wait for a person's yes).
- **The face numbers never leave the Mac** (stated in migration 0014 and `desktop/README.md`).
- What does leave: for the "Is this ...?" question to a class teacher, the Mac may upload **two small pictures**: the face (about 200 px) and the whole photo made small (600 px). They are stored in the private bucket at `<school>/checks/...`, opened only by the website server through signed links after it checks the teacher's class, and **deleted when the question is answered or after 14 days** (table `face_checks`, column `expires_at`). The table also keeps: the face box, the student code, class, a match score, who answered and when. [CHECK: confirm the 14-day deletion actually runs as a scheduled job, not only as a default column; a quick test or a look at the cleanup job is needed]
- Face models used and licences: `desktop/models/README.md` (MIT / Apache 2.0).
- Eyes-and-smiles models ship in 0.12 but are not used by any screen yet.

### 2.3 Photos
- Originals: on the school's computer only.
- Web copies (a full-size-for-web JPEG and a thumbnail) in the private `photos` bucket, with a row in `photos`: file path, size, event, who uploaded (staff, photographer through an upload link, or the desktop app), a short note, and `contains_opted_out` (a photo shows someone who must not appear).
- Photos can show students' faces, name badges, documents or screens. Location data: the code removes GPS from web copies (the test list says "GPS removal") [CHECK: confirm with a test on a real phone photo before saying this in the policy].
- Opened by staff through **signed links that expire after 1 hour** (`signedThumbs`, 3600 s).

### 2.4 Staff accounts (website)
- Email address or phone number (one-time code sign-in), role (admin, comms, principal, teacher, ...), school, invitations by link, an **activity log** (`audit_log`: who did what and when).
- Computers that run the Mac app: a device ID, a name, platform, last seen (`computers`).
- Saved preferences (`user_prefs`).
- Sign-in is checked from the token (`getClaims`): a removed user keeps web access until the token ends, **at most about 1 hour**.

### 2.5 People outside the school
- **Photographers and agencies** upload without an account through an **upload link** per event (`upload_links`: token, label, 30-day default expiry, revocable). No personal data is asked of them beyond the label the school types.
- **A person such as the school owner reviews a post through a review link** (`review_links`: token, label, 7-day default expiry, their answer, an optional comment up to 1000 characters).
- **WhatsApp photo intake** (`api/whatsapp`): staff send photos to the school's WhatsApp number; the sender's phone number is therefore seen by the system [CHECK: whether it is stored; read `src/app/api/whatsapp/route.ts` before writing the policy].
- **People in published photos and captions**: once a post is published on Facebook or Instagram it is under Meta's rules, not ours.

### 2.6 Owner page, plans and payments (0.13)
- **Owners** (`owners`: the product owner's account) can read every school's name, plan state, **staff names, roles, emails, last-seen times, invitations and computers** (policies "owners read schools / memberships / computers / invites"; function `owner_school_people`). By the policies in migration 0019 an owner is **not** given read access to students, photos or posts through the app. [CHECK: the helper thread's security test (task 2) should confirm no owner path reaches student or photo data. Also: who exactly holds an owner account, and is it protected by a second step at sign-in?]
- **Payments** (`payments`): amount, currency, date, method (transfer, cash, cheque, card, other), covers-until date, a note (up to 300 characters), who recorded it. This is business data about the **school**, but a note or method could identify a person. No card numbers are stored; payment gateways are not built yet (research L-29).
- **Owner notes** (`owner_notes`) and the **owner log** (`owner_log`, every owner action with before and after values).
- **Plans and limits** per school: plan, number of managing users and library computers, paid-until date, trial flag, forced state (active, read-only, blocked) with a reason.
- **Read-only and blocked schools:** after "paid until" a school has 14 days read-only, then is blocked. **Nothing in the code says what then happens to a blocked school's data** (kept? deleted after how long?). [CHECK: needs a rule and a deletion step, see README.]

### 2.7 Library key and licence check (0.13)
- The Mac and Windows library file is now **encrypted** on the computer (engine `better-sqlite3-multiple-ciphers`, MIT). The key is one **32-byte secret per school kept in our database** (`school_keys`), given only to a computer that has signed in and passed the licence check (`licence()`), and **never to a blocked school**. The computer keeps it in the operating system's secure store and can work offline for up to 10 days. A plain library is encrypted once, after a backup (the backup is encrypted too).
- The computer contacts the website at start, every 6 hours and after sign-in: it sends a **device ID, a name and the platform** (`register_computer`, `licence`). That is the "computers" list.
- Because the key is stored by us, **we could decrypt a library file if we also had the file** (we do not receive it). [CHECK: key custody, rotation (`rotated_at` exists), and what a school does if it loses access.]

### 2.8 Alerts by email (0.13)
- **"Mac off" email** when a library computer has been quiet for more than a day: sent to the school's **Admin and Comms lead emails**, once per time it goes quiet (`computers.off_alert_at`). It contains the school name, the computer's name and kind, and a link.
- **Plan warnings** (in-app alert and email to Admin and Comms lead).
- Sending uses the **Resend** email service and starts only when the key `RESEND_API_KEY` is set (not set at the time of writing). [CHECK: Resend becomes a **new processor** with staff email addresses; region and agreement.]
- **"Who's working on this"**: names of staff with the same post open, over Supabase Realtime; **nothing is stored**.

## 3. Content the system creates
- **Posts**: Arabic and English captions, versions, comments, approvals, schedule, status, metrics from Meta (`posts`, `post_versions`, `post_comments`, `post_metrics`, `account_metrics`).
- **Rules built in**: a post cannot use a photo marked opted-out or "not for posting"; the privacy check blocks **student names in captions** (in 0.12 the plan is: *warn*, not block, for a name in a caption; the captions branch is not in 0.12), and the AI is told never to name or describe an individual student.
- **Books** (yearbook-style): pages, texts, checks, comments (`books`, `book_texts`, `book_checks`, `book_comments`).
- **Coverage numbers per student** (`student_coverage`: how many photos and posts, "too often"): this is **profiling-like** data about a student's visibility [CHECK with lawyer: the Executive Regulations restrict profiling and monitoring of minors beyond what is needed].
- **Shared albums, team alerts** (to named staff).

## 4. Credentials and technical data
- **Meta Page access token** (`meta_connections.page_token`) and Page/Instagram IDs, in the database. This is a **credential**, not personal data, but a leak lets someone post as the school. [CHECK: is it encrypted at rest beyond Supabase's disk encryption? 0.14 plans encryption for the Mac database only.]
- **Error reports** (`error_reports`): error message, stack, a place in the app, version, school ID. No photos. Deduplicated by a hash. [CHECK: error messages might contain a file name that includes a student name; sample some real reports]
- **Problem reports** (`problem_reports`): what the staff member typed, a log (up to 8000 characters) and **an optional screenshot (up to about 3 MB)**. **A screenshot can show students' photos and names**, so treat as personal data. [CHECK: who can read them, and a retention period]
- Logs by Vercel and Supabase (IP addresses etc.) [CHECK: not controlled by us; read their terms].

## 5. Who else receives data (processors and recipients)

| Recipient | What they get | Notes |
|---|---|---|
| **Google (Gemini API)** | Photos (as images, to pick the best and flag sensitive ones) and caption requests: school name, event, class, a prompt | **Open issue.** On the **free tier** Google's terms say it uses submitted content to improve its products, human reviewers may read it, and it says not to submit sensitive or personal information. On the **paid tier** it does not use prompts or files to improve products. The product owner has decided to stay on the free tier until the final release (17 Nov 2026 note). **Photos of students on the free tier is the main privacy risk to resolve before real schools use it.** Also: the Gemini terms (Oct 2025 version) bar services "directed towards or likely to be accessed by" people under 18 [CHECK: our users are staff, but the photos are of students] |
| **Meta (Facebook, Instagram, WhatsApp)** | Published photos and captions; Page token | Under Meta's terms; school is the publisher |
| **Resend** (email, from 0.13; not yet switched on) | Staff email addresses, school and computer names in alert emails | New processor [CHECK: region, agreement] |
| **Supabase** | Everything on the website side (database, files, sign-in, SMS or email codes) | Processor [CHECK: region, data processing agreement] |
| **Vercel** | The website and its server logs | Processor [CHECK: region, DPA] |
| **SMS or email provider for sign-in codes** | Phone number or email | Via Supabase [CHECK: which provider] |
| **GitHub** (code and releases) | No school data. The Mac app is downloaded from GitHub Releases | |

## 6. Where data goes outside Egypt (cross-border)
Almost certainly all of the website, database, files and AI calls run outside Egypt (Supabase, Vercel, Google, Meta). Under the Executive Regulations a licence or permit from the Personal Data Protection Centre is likely needed for such transfers, with the data subject's consent. **This is the first question for the lawyer** (see `README.md`). [CHECK: actual regions]

## 7. How long data is kept (what the code does today)
| Data | Kept |
|---|---|
| Face "Is this ...?" pictures | Until answered, or 14 days |
| Sign-in access after removal | Up to about 1 hour |
| Upload link | 30 days by default, or until revoked |
| Review link | 7 days by default |
| Web copies of photos | **0.13: automatic clean-up of web copies older than 6 months** (batches of 200, 01:00-02:00 UTC), but **only** copies whose original is on the school's computer and that are **unused**: not in a post, a shared album, an AI pick, an open face question, or an announcement design (`old_web_copies()`; one "photos.cleaned" line per school in Activity). Originals on the school's drives are never touched. Otherwise until staff remove them. |
| Blocked school's data | **No rule found** (see 2.6) |
| Payments, owner notes, owner log | No limit found (business records, [CHECK: legal retention period for accounts]) |
| Students | Until staff remove them (`removeStudent`, logged in `audit_log`); former students keep `left_on` |
| Face numbers, the library | On the school's computer, until the school deletes them |
| Error and problem reports | **No limit found** |
| Activity log | **No limit found** |

## 8. Rights and requests (what the product can do today)
- Remove a student: yes (`removeStudent`). Does it also remove their face data on the Mac, their face-check rows, their coverage row? [CHECK: test]
- Export one person's data: no ready screen found [CHECK].
- Withdraw consent: the student's consent flag can be set to "no"; photos that show them are then blocked from posts.
- A **breach** plan (72-hour notice to the Centre): no written plan found. See `README.md`.
