# Branch review, 16 November 2026

For Waleed. Plain-language review of the two unmerged branches, how they fit with the B-96 fix, and the order to merge them. Nothing on those branches was changed by this review.

## Summary

| | Captions branch | Faces branch |
|---|---|---|
| Branch name | `claude/project-thread-5y4cwl` | `claude/project-thread-dmb0um` |
| Part of the product | Website only (`src/`) | Mac/Windows library app only (`desktop/`) |
| What it is | Better Arabic and English captions from the AI, tidied before anyone sees them | The 0.12 face reading work (9 commits) plus one new commit: "eyes and smiles" |
| Size | 1 commit, 17 files, +923 / -114 lines | 10 commits, 15 files, +800 / -146 lines, 2 new model files (6.8 MB) |
| New packages | None | None |
| Finished? | Yes, it is switched on | Face reading: yes, switched on. Eyes and smiles: **no**, the code is there but nothing uses it |
| Tests | 23 of 23 pass, type check passes, lint passes | 63 of 63 pass, type check passes. Eyes and smiles has no test of its own |
| Verdict | **Needs small work** before going live (student names, waiting time) | **Safe to merge**, with eyes and smiles as unused baggage to tidy |
| Conflicts | None with the faces branch, none with the B-96 fix, none with `main` | None with the captions branch. The B-96 fix sits directly on top of it |

Both branches start from the current end of `main` (81859f1, 11 Nov), so neither is behind.

## How the branches fit together

Checked against every branch on GitHub:

- **Already inside `main`** (nothing to merge): `-1odcui`, `-fwv6s6`, `-8knqd1`, `-uovrjv`, `-h6unqp`.
- **Already inside the faces branch** (merging the faces branch brings them too): `-du5t77` and `-syqjmv` (the Mac release workflow fix of 12 Nov). The faces branch is exactly `-syqjmv` plus one commit, the eyes and smiles one.
- **`fix/b96-blank-face-tile`** is the faces branch plus one commit (the B-96 fix). Merging the fix therefore also merges the whole faces branch.
- **Captions branch** stands alone: `main` plus one commit.
- Not looked at here: `build-0.3`, `build-0.4`, `release-0.11-download`, `desktop-release/0.7.0-rc1` (old release branches), `handoff/b96-claim` (notes).

```
main (81859f1)
 ├─ captions (5y4cwl)                       website only
 └─ du5t77 → syqjmv → faces (dmb0um) → fix/b96-blank-face-tile     Mac/Windows app only
```

## Branch 1: Captions (`claude/project-thread-5y4cwl`)

### What changes for users

- The AI is given clear rules for Arabic for an Egyptian school page: simple Standard Arabic by default, or light Egyptian Arabic when the school chose "Egyptian" in its voice settings. It is told not to write Arabic that reads like translated English, not to use official-letter wording, to use Egyptian month names, Arabic punctuation, and to keep religious phrases for occasions that are religious.
- Captions are cleaned by the app after the AI writes them: Arabic commas and question marks, no stretched letters, hashtags moved out of the text into the hashtag line, the school's own hashtags always first, no repeated hashtags, versions that contain a banned word or are in the wrong language are dropped when a clean one exists, near-copies are dropped.
- Mixed lines read the right way round on Facebook and Instagram: an Arabic line that starts with "KG2" or "STEM" gets an invisible right-to-left mark in front, at publishing time.
- The AI learns from the school's own posts: it is shown up to three of the school's best-performing captions and short hints ("shorter captions do better", "the team removes emojis"). Hints only appear after at least 8 posts with results or 4 edited drafts.
- "Rewrite" now also follows the school's voice (before, only "translate" did).
- When Gemini is busy, the app tries again, then tries a lighter model (`gemini-2.5-flash-lite`), before telling the writer to wait.

### What changes in the code

- New files: `src/lib/ai/prompts.ts` (everything the AI is asked, in one place), `src/lib/captions.ts` (the cleaning and learning rules, no AI and no database in it), `src/lib/caption-learning.ts` (reads past posts).
- Changed: `src/lib/ai/gemini.ts`, `demo.ts`, `types.ts`, `index.ts`, `src/lib/post-core.ts`, `src/lib/publish.ts`, `src/lib/actions/posts.ts`, `src/app/api/app/route.ts`.
- Three new test files (23 tests). `npm test` is new for the website and is added to the checks that run on GitHub.
- One optional new setting: `GEMINI_FALLBACK_MODEL` (works without it).
- No new packages, no database change.

### Finished or half done

Finished and switched on. Every caption request goes through the new prompt and the new cleaning as soon as this is merged and deployed.

### Tests (run in a private copy)

- `npm test`: 23 passed, 0 failed.
- `npx tsc --noEmit`: passes.
- `npm run lint`: passes.
- The desktop app is not touched, so its tests are unaffected.
- Not tested: real Gemini answers. The tests use a pretend Gemini, so the actual quality of the Arabic can only be judged by reading real captions after deployment.

### The Arabic rules, read for an Egyptian school

Good:

- The dialect choice is right. Standard: "فصحى مبسّطة", short warm sentences, no dialect words. Egyptian: Standard base with real Egyptian words (النهارده، فخورين، مبسوطين، شكرًا لكل اللي شارك), no street slang, no Arabic in Latin letters. The sample words are genuinely Egyptian, not Levantine or Gulf.
- Month names are the Egyptian ones (يناير … ديسمبر) and the Levantine ones (كانون، شباط، آذار) are forbidden.
- The translated-English examples it bans («قضاء وقت ممتع», «نحن متحمسون لمشاركة») and the official-letter examples («في إطار حرص المدرسة على», «تتشرف إدارة المدرسة») are the right ones to ban.
- "Nothing religious unless the occasion itself is" suits a page read by Muslim and Christian families. Everyday phrases (ما شاء الله، بالتوفيق) are allowed only where a school would really say them.
- Safety line: no student names (even one readable in a photo), no remarks on looks, no guessing who is who, no promises about results, fees or admissions, say only what the facts or photos show.

Small points, none of them wrong dialect:

- "Call them students (طلابنا), not kids or children." For KG, many Egyptian schools do say أطفالنا. The rule allows the school's own words to override, so a KG school should put أطفالنا in "words the school likes".
- "معلمونا ومعلماتنا" is given in one grammatical form only; the AI should adapt it in a sentence, but watch for a wrong ending in real captions.
- The prompt always says "a private school in Egypt". Fine today; it would need changing for a school elsewhere.

### Can student names leak into captions?

**Yes, they still can.** The branch does not make this worse than `main`, but it does not close it either.

- The only protection is an instruction to the AI ("no names"). There is no check by the app afterwards. A test caption containing "أحمد محمد" went through the cleaning unchanged.
- Names can reach the AI through: the notes staff write on photos, the post idea, the event description and title, the writer's own request for the post, and the school's past captions that are now shown to the AI as examples. If any of those contain a student's name, the AI may repeat it.
- One line in the new prompt works against the safety rule: the writer's request is introduced as "Most important … follow it even where it differs from the usual style". A writer who types "congratulate Ahmed by name" is likely to get exactly that. The safety line should be stated as stronger than the writer's request.
- Recommended before going live: a check in the app that compares the finished caption with the school's student names and warns or blocks, the same way banned words are handled now. This is new work (not on this branch).

### Other risks

- **Privacy, what leaves the school**: up to four photos per post, the notes and past captions are sent to Google Gemini. Sending photos is not new (it is on `main` already); sending the school's best past captions is new. The code comments say the school is on Gemini's **free tier**. As far as I know, Google's terms for the free tier allow Google to use what is sent to improve its products, which the paid tier does not. With student photos involved this needs a decision (see open questions).
- **Waiting time**: in the worst case the new retries take about 104 seconds (two models, two tries each, 25 seconds per try). The website's limit for one request is 60 seconds. On a bad day the writer would get a generic failure instead of the clean "please wait" message. Easy to fix by shortening the tries; not a data risk.
- **Free limit**: each retry is another request, so one click can use up to four requests of the daily free allowance.
- **School hashtags are rewritten slightly**: "#مدرسة النور" (with a space) becomes two hashtags "#مدرسة #النور"; "#Al_Nour-School" becomes "#Al_NourSchool"; a number-only hashtag such as "#2026" is dropped. Facebook would have broken these anyway, but the result is not "exactly as the school wrote them". Worth checking the real schools' hashtag settings once.
- **Right-to-left**: the direction marks are added only at publishing time and only where a line starts in the other language. Any direction marks a person typed by hand are removed first. Low risk. Hashtag lines are left alone on purpose.
- **Small cleaning gap**: an English comma after a closing Arabic quote (« … » ,) is not turned into an Arabic comma. Cosmetic.
- Nothing in this branch touches the faces, consent or blur checks.

### Verdict: needs small work

1. The Arabic rules are sound for Egypt and well tested.
2. Student names can still appear in captions; one prompt line makes it more likely when the writer asks. Fix the line and add a name check.
3. Shorten the retry timing to fit inside 60 seconds, and decide on the Gemini free tier.

## Branch 2: Faces (`claude/project-thread-dmb0um`)

This branch is really two things.

### Part A: better face reading for 0.12 (9 commits, also on `-syqjmv`)

What changes for users:

- Small faces in big photos (students at the back of a class photo from a good camera) are read from the original photo instead of the 2000-pixel copy, so more of them can be recognised.
- Each face gets a closer second look, which places eyes, nose and mouth more exactly. A face the finder was unsure of now counts when the second look is sure.
- In one photo a person can appear only once; this is now also used to make each match clearer, so more faces are named by the app itself. Twins and look-alikes are deliberately left out of this shortcut.
- After updating, old big photos with small faces are read again once, in the background. Names, "not this person" and "not a face" are kept.
- The Mac release workflow keeps the zip in a draft release, and no longer fails when no signing certificate is set.

Code: `desktop/src/core/faces.ts`, `engine.ts`, `db.ts` (one new column, `faces.read`, added automatically), a new test file `face-reading.test.ts`, the face test bench, two workflow files, and one public-domain NASA portrait used as the test face (no student photo is in the repository).

Finished: yes, switched on.

### Part B: eyes and smiles (1 commit, the newest)

What it adds:

- `desktop/src/core/expression.ts` (165 lines): for one face it reports eyes open or closed, smile, turned away, looking down. Meant for picking the best photos later.
- Two model files from Google's MediaPipe Face Landmarker, converted to ONNX and stored directly in the repository:
  - `face_landmarks_detector.onnx`, 4.9 MB (478 points on a face)
  - `face_blendshapes.onnx`, 1.9 MB (52 expression strengths)
- Licence: the commit says Apache 2.0, free for commercial use. That matches what I know of Google's model cards for these models, but the repository does not record where the converted files were downloaded from.

Finished: **no**. Nothing in the app calls this code. No screen, no setting, no database field uses it. It also has no test. I tried it by hand on the NASA test portrait: it works (smile 0.90, eyes open, 58 ms for the face) and it runs through the same engine as the other face models, with no new package.

Loose ends in Part B:

- `desktop/models/README.md` still lists only the two older models. The code says "see models/README.md" for the licence, but the README does not mention the new files, their licence or their source.
- The code comment says it returns nothing when there is no face. In fact it returns a result with "presence" near zero (checked on a blank picture), so whoever wires it in must check "presence".
- The app installer copies the whole `models` folder, so every download grows by 6.8 MB for something not used yet. Small next to the 38.7 MB recogniser already there.
- The app version in `desktop/package.json` is still 0.11.0 although the code comments call this work 0.12.

### Tests (run in a private copy)

- `npm test` in `desktop/`: 63 passed, 0 failed (includes 6 new face reading tests).
- `npx tsc --noEmit`: passes.
- The window tests (Playwright) were not run in this review.
- Eyes and smiles: no automatic test.

### Risks

- **Privacy**: everything runs on the Mac or PC. Nothing in this branch sends a face, a photo or a name anywhere. No new network call. The consent and blur checks are not changed, and their tests still pass ("faces of students who can't appear are blurred" is among the 63).
- **Privacy, later**: eyes and smiles reads expressions of children's faces. It stays on the computer, but it is a new kind of information about students. If scores are ever stored or synced to the website, that needs a deliberate decision. Today nothing is stored.
- **More faces named automatically**: the "one person per photo" shortcut and the relaxed "too small" rule mean more faces get a name without a person confirming. A wrong automatic name matters here because consent is checked by name. The branch's own notes report about 95% named by themselves on the face test and that the second look lets in 1 of 14 unsure non-faces. Worth a spot check on a real class photo set before release.
- **Performance**: reading from the original uses much more memory per photo (a 6000 x 4000 photo is about 72 MB while it is being read) and one extra pass per face. The one-time re-reading of old big photos after the update can take a long time on a large library; it runs in the background on two threads. An older Mac with 8 GB should be tried once.
- **Release workflow**: the Mac release workflow now has permission to write releases and replaces the draft release of the same version each time. It only runs when started by hand. Low risk.
- **Arabic and right-to-left**: no screen text or layout is touched by this branch.

### Verdict: safe to merge

1. All tests and the type check pass, and the privacy checks are untouched.
2. Nothing leaves the computer; no new package.
3. Eyes and smiles is unused, untested and undocumented: harmless to ship, but it adds 6.8 MB and should be either finished or left out of the 0.12 release.

## Conflicts and merge order

Trial merges were done without touching any branch:

| Merge | Result |
|---|---|
| Captions + Faces | Clean, no file in common |
| Captions + `fix/b96-blank-face-tile` | Clean, no file in common |
| `main` + Captions | Clean (straight continuation of `main`) |
| `main` + `fix/b96-blank-face-tile` | Clean (straight continuation of `main`) |
| Faces + `fix/b96-blank-face-tile` | The fix already contains the faces branch |

Safest order into the 0.12 line:

1. **Faces line first, as one piece**: merge `fix/b96-blank-face-tile`. That brings `-du5t77`, `-syqjmv`, the faces branch and the B-96 fix together, in the order they were built. Run the desktop tests and the window tests once on the result. This is the 0.12 desktop app.
2. **Captions second, on its own**: merge `claude/project-thread-5y4cwl` after the small fixes above. It only changes the website, so it can go before or after step 1 without conflict; keeping it separate means a caption problem can be undone without touching the app.
3. After both are in, the old thread branches (`-1odcui`, `-fwv6s6`, `-8knqd1`, `-uovrjv`, `-h6unqp`, `-du5t77`, `-syqjmv`) hold nothing that is not already merged and can be deleted when you wish.

If you would rather not ship eyes and smiles yet: merge `-syqjmv` instead of the faces branch, and move the B-96 fix onto it. The fix touches `engine.ts`, `faces.js` and `styles.css`, none of which the eyes and smiles commit touches, so that move should be clean. This costs a little work and saves 6.8 MB; shipping it unused is also fine.

## Open questions for Waleed

1. **Student names in captions**: should the app block or warn when a caption contains a name from the student list? Today only the AI is asked not to. Should the writer be able to override "no names" (for example a prize winner with consent)?
2. **Gemini free tier**: is the school's key on the free tier? If yes, are you content with student photos and captions going to Google under the free-tier terms, or should it move to the paid tier before more schools use it?
3. **Eyes and smiles**: ship the two unused models in 0.12, or hold them until the feature that uses them is built? And is reading children's expressions (on the computer only) something the schools should be told about?
4. **Automatic naming**: are you happy for more faces to be named without confirmation in 0.12, given consent depends on the name? A spot check on one real class set would settle it.
5. **Version number**: the desktop app still says 0.11.0. Who bumps it to 0.12.0, and when?
6. **KG wording**: should KG schools default to أطفالنا instead of طلابنا?

## How this review was done

- Read every changed file on both branches against `main`.
- Ran the tests in private copies: desktop `npm test` and type check on the faces branch; website `npm test`, type check and lint on the captions branch.
- Tried the caption cleaning by hand with names, mixed Arabic and English lines and awkward hashtags; tried eyes and smiles by hand on the public-domain test portrait.
- Trial merges with `git merge-tree`; no branch was changed.
- Not done: Playwright window tests, a run against real Gemini, a run on real school photos.
