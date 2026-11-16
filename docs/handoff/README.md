# Handoff notes (for any Claude session working on this repo)

Several Claude sessions and threads work on this project at the same time.
To avoid two of them fixing the same thing, every job that is in progress
has a file in this folder named after the bug or task, for example `B-96.md`.

## Rules

1. **Before you start a bug or task, look in this folder.** If a file for it
   exists and its status is `IN PROGRESS`, do not work on it. Pick another one,
   or ask Waleed.
2. **When you start something, add a file here** (copy `B-96.md` as a template)
   with the status, the branch you work on, and what is done and not done.
   Merge it into `main` (or ask Waleed to) so every session can see it.
3. **Keep a safe point.** After each stage, update the file: what is finished,
   what is next, and which commit it is on. Someone else must be able to
   continue from the file alone.
4. **When you finish,** set the status to `DONE`, name the branch or pull
   request, and say what Waleed must check by eye. Do not delete the file.
5. Never commit secrets (API keys, tokens) to this repo or to these notes.
6. Work on your own branch. Do not push directly to `main`.

## Status words

`IN PROGRESS` · `PAUSED (safe point)` · `READY FOR REVIEW` · `DONE`
