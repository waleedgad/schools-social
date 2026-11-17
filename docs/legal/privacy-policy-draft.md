# Privacy Policy (DRAFT)

> **DRAFT. Needs lawyer's check before anyone sees it.** Written 17 Nov 2026 by the helper session. Square brackets [ ] are blanks or open points. Facts about the product come from `data-map.md`. An Arabic version is to be written after the lawyer's edits (Arabic first product); do not translate before then.

**Product:** School Social Hub (website) and School Social Hub Library (Mac and Windows app)
**Operator:** [company name, commercial register number, address in Egypt], "we"
**Contact for privacy questions:** [privacy email], Data Protection Officer: [name, PDPC registration code]
**Last updated:** [date]

## 1. Who is responsible for the data
For the photos, names and class lists a school puts into the product, **the school decides why and how they are used (the controller). We process them for the school and only on its instructions (the processor)**, under the School Terms. [LAWYER: confirm this split. We are the controller for staff sign-in data, error reports and our own analytics.]
If you are a parent or guardian, **your school is your first contact** for questions about your student's photos. You can also write to us.

## 2. What we handle
**About students** (and teachers, staff, parents, visitors listed by the school): full name in English and Arabic, school student ID, class, grade, stage, birthday, join and leave dates, clubs and achievements, class teacher, parent phone number if the school adds it, and whether the family agreed to social media use.
**Photos:** school photos. Originals stay on the school's computer. We keep **small web copies** of photos the school chooses, in private storage.
**Face data (biometric):** the Mac app finds faces and turns each into a list of numbers to suggest "this looks like [student]". **These numbers stay on the school's computer. They are not sent to us.** A suggestion becomes a name only after a staff member says yes. To ask a class teacher "is this [student]?", the app may send us **two small pictures** (the face and the whole photo made small). We delete them when the teacher answers, or after 14 days.
**Staff:** email address or phone number, role, school, the computers they use, and a log of actions (who did what and when).
**People outside the school** who use a link: a name or label the school gives the link, and any comment they type.
**Problem and error reports:** what the person typed, technical logs, and, if they choose, a screenshot. A screenshot can show students, so people are told before sending one. [LAWYER/DEV: add this notice in the app]

## 3. Why, and our legal basis
- **To run the product for the school** (library, picking photos, drafting posts, approvals, posting): the school's instructions and its contract with us.
- **Posting a student's photo or name publicly:** **only where the parent or guardian has agreed** ("no answer counts as no"). The product blocks photos of students without agreement. [LAWYER: wording of the family consent form is the school's, we can provide a template.]
- **Face recognition:** only on the school's computer, only after the school has [explicit consent from parents or guardians], and only to help staff find photos and check who may appear. [LAWYER: biometric data of minors is the most sensitive category: confirm lawful basis, licence or permit.]
- **Security, fixing errors, preventing misuse:** our legitimate interest [LAWYER: confirm basis].

## 4. What we do **not** do
- We do not sell personal data or use students' photos or faces to train AI models. [DEV/LAWYER: true only on the **paid** Gemini tier. See section 5.]
- We do not send face numbers to anyone.
- We do not show advertising.
- We do not use coverage or counting numbers for anything but helping staff share photos fairly. [LAWYER: profiling of minors.]

## 5. Who else sees data
- **Google (Gemini)**, to suggest the best photos and write caption drafts. Photos are sent as images. Captions are told never to name a student. [**OPEN, MUST FIX BEFORE REAL SCHOOLS:** on Google's free tier, Google may use submitted content to improve its products and human reviewers may read it. The paid tier does not. State here which tier is used. See `README.md` question 4.]
- **Meta (Facebook and Instagram)**, when the school posts. After posting, Meta's own rules apply.
- **Supabase** (database, file storage, sign-in codes) and **Vercel** (the website). [regions, agreements]
- **Authorities**, only where a law or a court requires it.
Everyone who helps us run the service is bound by a written agreement. [LAWYER: processor contracts.]

## 6. Transfers outside Egypt
Our website, database and files and the AI service are hosted outside Egypt, in [regions]. [LAWYER: licence or permit from the Personal Data Protection Centre; wording of consent; adequacy.] We do this only [with the licence/permit and the school's consent].

## 7. How long we keep it
- Face question pictures: until answered, or 14 days.
- Web copies of photos, students and posts: until the school removes them, or its contract with us ends, then [30] days and deleted. [DEV: build "delete this school" and "delete this student" end to end; today a student can be removed but linked data needs a test.]
- Staff sign-in and activity log: while the school is a customer and [12] months after.
- Error and problem reports: [90] days. [DEV: no limit exists today.]
- Access is checked from a sign-in token, so a removed staff member can keep web access for **up to about 1 hour**. [Tell schools in the product note.]

## 8. Security
Private storage, links to photos that expire (1 hour), every school's data separated by database rules, staff roles (admin, comms, principal, teacher), an activity log, sign-in by one-time code. The Mac app's local database is not yet encrypted (planned for release 0.14). [LAWYER: describe accurately; do not overstate.]
If personal data is breached, we will tell the school and the Personal Data Protection Centre within **72 hours** of knowing, and help the school tell the people affected within three working days. [LAWYER: confirm timings and who notifies whom.]

## 9. Your rights
You can ask, through your school or us, to: see your data, correct it, delete it, limit or object to its use, withdraw agreement (for example, stop a student's photos being used on social media), and complain to the Personal Data Protection Centre. We answer within [period]. [DEV: an export for one person does not exist yet.]

## 10. Students' data
We treat everyone under 18 as needing a parent's or guardian's agreement. The product is for staff; students do not have accounts. [LAWYER: Gemini terms bar services "likely to be accessed by" under-18s: our users are adults, the photos are of students: confirm.]

## 11. Changes
We will tell schools by email [and in the app] before a change that matters, [30] days ahead.
