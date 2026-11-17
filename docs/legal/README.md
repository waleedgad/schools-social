# Privacy papers for the lawyer

Status: DRAFTS, **all need the lawyer's check**. Nothing here is legal advice and nothing here is for schools or parents yet.
Written 17 Nov 2026 by the helper session ("School Software 2"). Documents only: no app code changed.

| File | What it is |
|---|---|
| `data-map.md` | What data the product holds, where, who sees it, how long it is kept, from the code (0.12 line) |
| `privacy-policy-draft.md` | Draft privacy policy (English; Arabic after the lawyer's edits) |
| `school-terms-draft.md` | Draft school terms and data processing outline (commercial parts left blank for 0.13) |

## The law, in short (from law-firm summaries: **lawyer to verify against the official text**)
- **Law No. 151 of 2020** (Personal Data Protection Law, PDPL). Executive Regulations issued **1 Nov 2025** (reported as Ministerial Decision **816 of 2025**; one summary says 81, check the Gazette). One summary says a one-year compliance period starts from issue.
- Consent must be **explicit, informed, specific and freely given**. Sensitive data (health, **biometric**, religious beliefs, etc.) and **minors' data** get stronger protection; a guardian's consent is needed for minors.
- Most controllers and processors need a **licence or permit** from the **Personal Data Protection Centre (PDPC)**; a **registered Data Protection Officer**; electronic **logs** (data categories, scope, retention, security).
- **Cross-border transfer** needs a separate licence or permit and goes only to places judged adequate, with consent and safeguards.
- **Breach:** tell the PDPC within **72 hours**, tell the people affected within three working days.
- The Regulations restrict **profiling, tracking and monitoring of minors** beyond what is necessary.
- The law reaches foreign companies handling Egyptian residents' data.

Sources read: Baker McKenzie, Al Tamimi, Chambers, CMS, Clyde & Co, Kennedys, Forvis Mazars, Legal 500, Access Partnership (2025-2026 articles), and the law text hosted by Andersen Egypt (`eg.andersen.com`, Law-No.-151-of-2020.pdf). Gemini terms: `ai.google.dev/terms`.

## Questions for the lawyer (most important first)
1. **Cross-border:** the website, database, files, sign-in codes and AI all run outside Egypt. What licence or permit is needed, from whom, how long, what cost, before the first real school?
2. **Roles:** is the school the controller and we the processor for school data? Do we need our own PDPC licence and a registered DPO? Who is the DPO?
3. **Face recognition of minors:** the face numbers stay on the school's computer, but we make the software that creates them. Is the school alone the controller for that? What consent text and permit are needed (biometric + minors)?
4. **Google Gemini free tier:** per Google's terms, free-tier content may be used to improve Google's products and read by human reviewers, and Google says not to send personal or sensitive data to it. The product sends **photos of students** to Gemini. The product owner has decided to stay on the free tier until the final release. **Is it acceptable to run real schools' photos through it before paying? (Our own view: no, do not use real students' photos on the free tier. Decision belongs to the product owner.)**
5. **Coverage counts per student** (`student_coverage`): is this "profiling" of minors under the Regulations?
6. **Parent phone number, birthday:** do we need them at all? Data minimisation.
7. **Retention:** what periods are right for photos, students who left, logs, error and problem reports (screenshots may show students)?
8. **Breach duties:** who notifies the PDPC, the school or us; our wording to schools.
9. **Photographers and the owner using links** (no account): what notice do they get?
10. **Published posts** on Facebook and Instagram: our duty once Meta holds the photo; takedown on a parent's request.
11. **Sign-in token delay:** a removed staff member keeps web access up to about 1 hour. Acceptable? How to say it?
12. **Egyptian-law content** of terms: liability, limits, courts, e-signature, Arabic as the governing text.

## What the product team should fix or build (found while writing)
Marked **[DEV]** in the drafts. These need app code, so they go to the thread that owns app code, not to the helper.
- No automatic age limit found for **error reports, problem reports (with screenshots), activity log, web copies of photos**.
- **Delete one student** and **delete a school** end to end (face-check rows, coverage, pictures, Mac face data); an **export for one person**.
- Check that **expired face-question pictures are really deleted** by a job, not only marked with an expiry date.
- A **notice before sending a screenshot** in problem reports.
- A **written breach plan** (72-hour clock).
- Confirm in a test that **GPS is removed** from web copies.
- Confirm what **WhatsApp intake** stores about the sender.
- Decide the Gemini tier question (4 above) before any real school uses AI picks.

## Open items I could not check from the code
Hosting regions (Vercel, Supabase); the company's legal name and address; whether the Meta Page token is encrypted beyond disk encryption; the SMS provider for sign-in codes.
