# Sweep for other places a picture can silently come back blank (16-17 Nov 2026)

Branch: `fix/silent-blank-pictures`, five commits on top of the B-96 fix
(db4e538). Written by a helper agent; not yet checked by eye on a Mac.

## Real bugs found and fixed (each has a test that failed before the fix)

1. **"Clean up" made every big photo blurry until restart** (39af839).
   "Clean up" and "clear big copies" delete the whole folder of big copies; the
   app only creates it at startup. Until restart every big photo silently fell
   back to the small 420 px copy, and faces were cut from it. Fix: the folder is
   made again whenever a copy is written (`desktop/src/core/media.ts`). Test:
   `desktop/src/core/blank-pictures.test.ts`. This could be why the big copy
   was missing in B-96 on the Mac; not confirmed.
2. **A new photo could open as an old, deleted photo** (3d1fa53). Photo numbers
   are reused after the Bin is emptied and the old big copy stayed on disk under
   that number. Fix: old copies are cleared when a new photo comes in
   (`desktop/src/core/engine.ts`). Only the Bin case was reproduced. Same test file.
3. **A person's hand-chosen main face went blank or showed someone else**
   (a01bdbc). The choice is stored as a face number; after a re-read or a bin
   that number is gone (blank circle in People, Faces and book class pages) or
   belongs to another person's face, which could print the wrong child above a
   name. Fix: the choice is used only while that face still belongs to that
   person, else the automatic best face (`desktop/src/main.ts`,
   `desktop/src/features/students.ts`, `desktop/src/core/books.ts`). Same test file.
4. **A book with a RAW-only photo could not be saved as a PDF** (61cbbfd). Book
   printing read the original without the shared image reader, so saving failed
   ("unsupported image format"). Loud failure, same kind of gap. Fix: use the
   shared reader (`desktop/src/features/books.ts`). Test:
   `desktop/e2e/book-raw.spec.ts`. HEIC should be covered by the same change but
   is untested (needs a Mac).
5. **An event's card in Albums was an empty picture** (5c28e96). The card always
   used the event's first photo even if unreadable. Fix: first readable photo,
   or a plain folder icon (`desktop/src/features/library.ts`). Test:
   `desktop/e2e/event-cover.spec.ts`.

## Places audited

Fine: library grid thumbnails; big photo view (apart from bugs 1 and 2); photo
strip, quick look, compare; people portraits; Today screen (a tiny import of
mostly unreadable files could show one blank tile; left alone); Posts and
Calendar on the Mac; web app and web copies (read only, not run here); EXIF
rotation and HEIC/RAW reading except in book printing.
Bugs: Albums event cards (5); books and yearbook pages (3 and 4); Faces
main-face circles (3). The question tile is B-96.

## Known gaps, not fixed

- If the small-copy folder is deleted by hand while the original is unreachable,
  tiles go blank (the app never does this itself).
- Picture addresses on the website and in Posts last one hour; a page left open
  longer could show broken pictures on redraw. Not reproduced.
- HEIC photos can't be read on Windows ("Can't read"): a limitation, not a blank.
- If an original in a book truly can't be decoded, the PDF save still fails.
- After a photo is re-read, a hand-chosen main face is forgotten (automatic one used).

## Test results

`npm test` 70 pass, 0 fail (3 new); `tsc --noEmit` clean; robot tests headless
58 passed, 0 failed, 14 skipped (they appear to need the website, face models, a
packaged app or Windows; each skip reason was not checked). Not run: anything
needing a real Mac (HEIC) or real RAW files.

## Waleed's check by eye on the Mac

1. Run Clean up, then without restarting open a photo big and open Faces >
   "Is this ...?": both sharp.
2. Bin the most recently imported photos, empty the Bin, import different
   photos, open them big: each shows itself, not a deleted one.
3. On a person's page choose "Use as main photo", then edit and save that photo
   in another app: the person's circle still shows their own face.
4. Make a book with an iPhone HEIC photo and a RAW-only photo and save the PDF:
   every picture present.
5. Open Albums: no event card is an empty picture.
