# Face test with the school's own photos: how to pick and send them

This test tells us how many faces the app names by itself on the school's
real photos (goal: about 95%, and never a wrong name). It runs on your own
computer. No names, photos or face data leave it: the only thing you share
with Claude is a short summary that uses codes like "5A-07" instead of names.

## 1. Make one folder

Make a folder, for example `Face test` on your Desktop, with these inside:

```
Face test/
  class list.xlsx      the class list straight from the school system
  Students/
    Ahmed Ali/         one folder per student, named exactly as in the list
    Sara Omar/         (English name, Arabic name or student ID all work)
    ...
  Staff/               optional: one folder per teacher, same way
  Not in list/         optional: photos of parents, visitors, other schools
  Class photos/        optional: class or event photos, not sorted by person
    5A/                one folder per class, or loose photos for whole-school events
```

The class list is the same file you import into the Mac app (our template,
PowerSchool, Classera or Edunation, .xlsx or .csv). Nothing needs changing in it.

## 2. Which students

- **2 or 3 whole classes** is best (about 60-90 students). Whole classes
  matter: the app matches a class photo against that class, so a full class
  is the real test.
- Mix ages if you can: one KG or primary class and one older class.
- Twins and brothers/sisters in the same school are very useful. Keep them in.

## 3. Which photos, per student

- **10 to 20 photos of each student**, from normal school life this term:
  classroom, playground, trips, events. Not only nice ones. Real photos with
  turned heads, sunglasses or bad light are exactly what we want to measure.
- **In each photo the student must be the biggest face.** Close-ups and
  photos with a few friends are fine, as long as this student is clearly
  nearest the camera. A photo where two faces are about the same size is left
  out automatically (we can't tell which one is the student).
- If the school has a **portrait** (ID photo), add it and name the file
  `portrait.jpg`. It is used as the first confirmed face, like in the app.
- The same group photo can go in several students' folders only if each of
  them is the biggest face in it, so normally a group photo goes in
  `Class photos/` instead.
- Any size and camera: phone photos, camera JPEGs and HEIC from iPhones all
  work. Please send the original files, not WhatsApp copies (WhatsApp shrinks
  them and faces get blurry).

## 4. Not in list (optional, but it is our "never wrong" check)

10 to 30 photos of people who are **not** in the class list: parents at an
event, visitors, staff from another school. The app must never give any of
them a student's name.

## 5. Class photos (optional)

Real class and event photos with many faces, not sorted by person. There is
no answer key for these, so the test shows a page where you can look at each
name it gave and tick the wrong ones.

## 6. Running it

The easy way: tell Claude "the face test folder is ready" and approve when it
asks to use your Mac. Claude runs one command there:

```
desktop/bench/real-faces/face-test.sh "$HOME/Desktop/Face test"
```

The first run sets itself up (Node.js is needed; Claude can install it) and
reads every face, about 1-3 seconds per photo. Running it again later is
quick: faces already read are remembered.

## 7. What comes out

Inside your folder, `face-test-results/`:

- `summary.md`: the numbers, **no names**: share this with Claude.
  Named by the app itself, named wrong, per class, and why faces were missed
  (photo problems like small or blurred faces, or recogniser limits).
- `private/`: names, file names and small face pictures. **Keep it on your
  computer.** Open `private/check.html` to look at the names by eye. Delete
  the whole `private` folder (it also holds face descriptions) when we are
  done.

## Short version

2-3 whole classes, 10-20 everyday photos per student, the student is the
biggest face, one folder per student named like the class list, original
files. Add a few photos of people not on the list. Everything stays on your
computer; only the no-names summary is shared.
