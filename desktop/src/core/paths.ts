import path from "node:path";

type PathLib = typeof path.posix;

// Where `file` sits inside `root` ("" for root itself), or null when it is
// outside. On Windows a file on another drive (library on D:, archive on E:)
// gives back an absolute path from path.relative, not "..", so a plain
// rel.startsWith("..") check took it for a file inside the library. Drive
// letters and folder names are compared without case there, like Windows does.
export function relInside(root: string, file: string, p: PathLib = path): string | null {
  const rel = p.relative(root, file);
  if (rel === ".." || rel.startsWith(".." + p.sep) || p.isAbsolute(rel)) return null;
  return rel;
}

// Strictly inside (not the folder itself).
export const isInside = (root: string, file: string, p: PathLib = path) => !!relInside(root, file, p);

// The folder itself or anything in it.
export const isAtOrInside = (root: string, file: string, p: PathLib = path) => relInside(root, file, p) !== null;

export const isOutside = (root: string, file: string, p: PathLib = path) => relInside(root, file, p) === null;

// The "Editing app" picker in Settings: Mac apps live in /Applications as
// ".app"; on Windows a program is an ".exe" under Program Files.
export function editorPicker(platform: string, env: Record<string, string | undefined>) {
  if (platform === "darwin") return { title: "Editing app", defaultPath: "/Applications", properties: ["openFile" as const], filters: [{ name: "Apps", extensions: ["app"] }] };
  if (platform === "win32") return { title: "Editing app", defaultPath: env.ProgramFiles || "C:\\Program Files", properties: ["openFile" as const], filters: [{ name: "Programs", extensions: ["exe"] }] };
  return { title: "Editing app", defaultPath: "/usr/bin", properties: ["openFile" as const] };
}
