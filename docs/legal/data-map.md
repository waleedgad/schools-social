# Data map: what School Social Hub holds, where, and who sees it

Status: DRAFT, **needs lawyer's check**. Written by the helper session on 17 Nov 2026 from the code of the 0.12 line (`claude/project-thread-q91dwp`, head 8b64991). Facts below come from the database migrations (`supabase/migrations/0001..0018`) and the desktop code. Items marked **[CHECK]** are things the code cannot tell us.

## 1. The three places data lives

| Place | What it is | Who runs it |
|---|---|---|
| **The school's Mac or PC** (desktop app) | The photo library and its index, `library.db` (SQLite) in the app's data folder, plus the original photos in the school's own folder | The school |
| **The website** (Next.js on Vercel) and its **database and file storage** (Supabase: Postgres + a private `photos` bucket) | Staff accounts, the class list, small web copies of chosen photos, posts, approvals | Us (the product owner) [CHECK: company name; hosting regions of Vercel and Supabase] |
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
| Web copies of photos | Until staff remove them (Bin on the Mac; the web copy is removed when the photo is replaced or deleted) [CHECK: no automatic age limit found] |
| Students | Until staff remove them (`removeStudent`, logged in `audit_log`); former students keep `left_on` |
| Face numbers, the library | On the school's computer, until the school deletes them |
| Error and problem reports | **No limit found** |
| Activity log | **No limit found** |

## 8. Rights and requests (what the product can do today)
- Remove a student: yes (`removeStudent`). Does it also remove their face data on the Mac, their face-check rows, their coverage row? [CHECK: test]
- Export one person's data: no ready screen found [CHECK].
- Withdraw consent: the student's consent flag can be set to "no"; photos that show them are then blocked from posts.
- A **breach** plan (72-hour notice to the Centre): no written plan found. See `README.md`.
