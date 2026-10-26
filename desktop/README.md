# School Social Hub Library (desktop app)

Runs on the school's computer, next to the photo library.

- Watches the library folder (or drive) and sends a small web copy of every
  new photo to School Social Hub. Originals never leave the school.
- Each event is a folder: `2026-2027/Term 1/2026-10-20 Science fair/`.
  A new folder becomes an event in the web app automatically.
- "Import photos" copies a memory card or a photographer's folder into the
  library, filed by school year, term and event.
- Keeps working offline: photos wait in a queue and send when the internet
  is back. Each photo is sent once, even if it's copied to two folders.
- Optional backup of every original to a second drive.
- Removes location (GPS) data from the copies it sends.
- Starts with the computer and stays in the system tray.

## Build the installers

On GitHub: Actions → "Desktop app" → Run workflow. When it finishes, the
Windows `.exe` and Mac `.dmg` are under Artifacts.

The installers aren't code-signed yet (signing certificates cost money), so
Windows shows "Windows protected your PC" (click More info → Run anyway)
and on a Mac you right-click the app and choose Open the first time.

## Develop

```
cd desktop
npm install
npm test     # folder rules, GPS removal, the upload queue end to end
npm start    # opens the app
```

On first run the app asks for the web app's address (for example
`schools-social.vercel.app`) and gets the database settings from it, so the
installer carries no keys.
