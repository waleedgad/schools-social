# School Social Hub Library (Mac app)

The school's photo library on the Mac. Everything here runs on the school's
computer; only small web copies of chosen photos go to the website.

- **Library**: reads the library folder in place, laid out as
  `2026-2027/Term 1/2026-10-20 Science fair/4B/`. Thumbnails, quality scores,
  duplicates (to the Bin), RAW and iPhone HEIC photos, edited copies (`-edit`),
  renames and moves that keep every tag. The index is a SQLite file in the
  app's data folder (`library.db`).
- **Import**: cards, phones, photographers' folders, old archives ("Mac only"),
  and watched folders (cloud drives, Lightroom exports).
- **Students and faces**: class lists from our template, PowerSchool, Classera
  or Edunation; portraits; YuNet + SFace face finding and matching on the Mac
  (`models/`); suggestions wait for a person's yes; coverage per class.
- **Culling**: P / X / 1-5 / T / Y / N / B / C keys, compare, best-photo picks.
- **Posts and Calendar**: the website's own screens inside the app. "New post"
  sends web copies of the selected photos and opens the draft.
- Settings, history with undo (⌘Z), ⌘K search, Arabic and English, dark mode.

## Build the installers

On GitHub: Actions → "Desktop app" → Run workflow. When it finishes, the
Windows `.exe` and Mac `.dmg` are under Artifacts. An Apple Silicon zip can
also be built from Linux:
`npm run build && npx electron-builder --mac zip --arm64 --publish never -c.mac.identity=null`.

The installers aren't code-signed yet (signing certificates cost money), so
Windows shows "Windows protected your PC" (click More info → Run anyway)
and on a Mac you right-click the app and choose Open the first time.

## Develop

```
cd desktop
npm install
npm test     # folder rules, class lists, import, GPS removal, the upload queue
npm start    # opens the app
```

On first run the app asks for the web app's address (for example
`schools-social.vercel.app`) and gets the database settings from it, so the
installer carries no keys.
