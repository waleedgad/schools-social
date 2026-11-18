import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// The app's licence (0.13). The server (licence() in the database) says
// whether the school is Active, Read-only or Blocked, and hands out the
// school's key for the encrypted library, never to a blocked school. The
// app asks at start and every few hours, and keeps the answer in the
// computer's own key store, so it keeps working offline for up to 10 days.
// After that it acts read-only until it reaches the server again.

export type ServerState = "active" | "read_only" | "blocked";
export type AppState = ServerState | "none";

export type Licence = {
  schoolId: string;
  state: ServerState;
  // The library key, base64 (32 bytes). Null for a blocked school.
  key: string | null;
  checkedAt: string;
  validUntil: string;
  paidUntil: string | null;
  readOnlyLeft: number;
  daysLeft: number;
  forced: boolean;
  plan: string | null;
  contact: string;
};

export const CHECK_EVERY_MS = 6 * 3600_000;
export const OFFLINE_DAYS = 10;

// What the app does now: the server's answer, unless it is too old.
export function appState(lic: Licence | null, now = Date.now()): { state: AppState; offline: boolean; reason: string | null } {
  if (!lic) return { state: "none", offline: false, reason: "sign-in" };
  if (lic.state === "blocked" || !lic.key) return { state: "blocked", offline: false, reason: "blocked" };
  if (now > Date.parse(lic.validUntil)) return { state: "read_only", offline: true, reason: "offline" };
  return { state: lic.state, offline: false, reason: lic.state === "read_only" ? "read-only" : null };
}

export const keyOf = (lic: Licence | null) => (lic?.key ? Buffer.from(lic.key, "base64") : null);

// The server's answer as the app keeps it.
export function fromServer(schoolId: string, r: Record<string, unknown>): Licence | { error: string } {
  if (typeof r.error === "string") return { error: r.error };
  const state = r.state === "active" || r.state === "read_only" || r.state === "blocked" ? r.state : null;
  if (!state) return { error: "bad-answer" };
  const key = typeof r.key === "string" && Buffer.from(r.key, "base64").length === 32 ? r.key : null;
  const plan = r.plan as { name_en?: string; name_ar?: string } | null | undefined;
  return {
    schoolId,
    state,
    key: state === "blocked" ? null : key,
    checkedAt: new Date().toISOString(),
    // Never trust a later date than 10 days from now, whatever the answer says.
    validUntil: new Date(Math.min(Date.parse(String(r.valid_until ?? "")) || 0, Date.now() + OFFLINE_DAYS * 86400_000)).toISOString(),
    paidUntil: typeof r.paid_until === "string" ? r.paid_until : null,
    readOnlyLeft: Number(r.read_only_left) || 0,
    daysLeft: Number(r.days_left) || 0,
    forced: r.forced === true,
    plan: plan ? `${plan.name_en ?? ""}|${plan.name_ar ?? ""}` : null,
    contact: typeof r.contact === "string" ? r.contact.slice(0, 300) : "",
  };
}

// The licence file, locked with the computer's key store (Keychain on a
// Mac, the user's Windows account) like the sign-in session.
export type Protect = { available: () => boolean; encrypt: (s: string) => Buffer; decrypt: (b: Buffer) => string };

export class LicenceStore {
  constructor(
    private file: string,
    private protect: Protect,
  ) {}

  read(): Licence | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = readFileSync(this.file);
      const text = this.protect.available() ? this.protect.decrypt(raw) : raw.toString("utf8");
      const lic = JSON.parse(text) as Licence;
      return lic && typeof lic.schoolId === "string" && typeof lic.validUntil === "string" ? lic : null;
    } catch {
      return null;
    }
  }

  write(lic: Licence) {
    const text = JSON.stringify(lic);
    writeFileSync(this.file, this.protect.available() ? this.protect.encrypt(text) : Buffer.from(text));
  }

  clear() {
    rmSync(this.file, { force: true });
  }
}

// One answer from the server, merged with what the app already knew: a
// school that was blocked loses the key on this computer; an answer without
// a key for an active school keeps the old one (the same school only).
export function merge(old: Licence | null, next: Licence): Licence {
  if (next.state === "blocked") return { ...next, key: null };
  if (!next.key && old?.key && old.schoolId === next.schoolId) return { ...next, key: old.key };
  return next;
}

// What the window may do in each state. Read-only: look at the library,
// tags and faces; no import, AI picks, face matching or new posts.
export const READ_ONLY_BLOCKS = new Set([
  "importChoose", "importCard", "importScan", "importStart", "importRetry", "importLink", "importIphone", "dropFolder",
  "rescan", "rescanFaces", "retryAura", "best", "confirmFaces", "rejectFaces", "tagPhotos", "untagPhotos", "nameClassPhoto",
  "setLink", "sendFaceChecks", "newPost", "sendNow", "makePosts", "preparePost", "postLocal", "sendPhotos", "makeCollage",
  "saveAnnouncement", "bookSend", "commitStudents", "addStudent", "removeStudent", "setMainFace", "mergeStudents",
]);

// Blocked, or not signed in to a school yet: only signing in and the
// notice. Nothing in the library can be opened.
export const LOCKED_ALLOWS = new Set(["state", "reportError", "connect", "signIn", "signOut", "openUrl", "openWeb", "webBase", "contextMenu", "checkLicence", "set"]);

// May this window call run in this state?
export function allowed(name: string, state: AppState) {
  if (state === "active") return true;
  if (state === "read_only") return !READ_ONLY_BLOCKS.has(name);
  return LOCKED_ALLOWS.has(name);
}
