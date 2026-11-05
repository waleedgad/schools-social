import { execFileSync } from "node:child_process";

// Can this copy of the app replace itself with a new version?
// Windows: yes (the installer runs quietly when the app closes).
// Mac: only once it is signed with Apple's Developer ID: macOS refuses to
// let an unsigned app swap itself, so until signing day the Mac app keeps
// showing the "new version ready" steps instead.
export function canSelfUpdate(platform: NodeJS.Platform, packaged: boolean, signer: () => string | null): boolean {
  if (!packaged) return false;
  if (platform === "win32") return true;
  if (platform !== "darwin") return false;
  return /Authority=Developer ID Application:/.test(signer() ?? "");
}

// Who signed the running Mac app ("Authority=..." lines), or null.
export function macSigner(appPath: string): string | null {
  try {
    // codesign writes its details to stderr.
    return execFileSync("codesign", ["-dv", "--verbose=2", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }) || null;
  } catch (e) {
    const err = (e as { stderr?: string }).stderr;
    return typeof err === "string" ? err : null;
  }
}
