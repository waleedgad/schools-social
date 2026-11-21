// Photos from Google Drive, OneDrive and Dropbox on the upload page.
// A shared link ("anyone with the link") works with no set-up: the server
// turns it into the file's download address and fetches it. The pickers
// (choose from your own account) switch on when each free key is set:
//   Dropbox   NEXT_PUBLIC_DROPBOX_APP_KEY
//   Google    NEXT_PUBLIC_GOOGLE_CLIENT_ID + NEXT_PUBLIC_GOOGLE_PICKER_API_KEY
//   OneDrive  NEXT_PUBLIC_MICROSOFT_CLIENT_ID
// Only these services' own addresses are ever fetched (never any other site,
// and never the server's own network), each hop of a redirect checked again.

export type CloudSource = "google" | "dropbox" | "onedrive";

// Hosts a download may start at or pass through.
const HOSTS: [RegExp, CloudSource][] = [
  [/^(drive|docs)\.google\.com$/, "google"],
  [/^drive\.usercontent\.google\.com$/, "google"],
  [/^[a-z0-9-]+\.googleusercontent\.com$/, "google"],
  [/^www\.googleapis\.com$/, "google"],
  [/^(www\.)?dropbox\.com$/, "dropbox"],
  [/^[a-z0-9-]+\.dropboxusercontent\.com$/, "dropbox"],
  [/^dl\.dropboxusercontent\.com$/, "dropbox"],
  [/^1drv\.ms$/, "onedrive"],
  [/^onedrive\.live\.com$/, "onedrive"],
  [/^api\.onedrive\.com$/, "onedrive"],
  [/^[a-z0-9-]+\.(1drv|files\.1drv)\.com$/, "onedrive"],
  [/^[a-z0-9-]+\.sharepoint\.com$/, "onedrive"],
  [/^[a-z0-9-]+\.livefilestore\.com$/, "onedrive"],
];

export function sourceOf(raw: string): CloudSource | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  return HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
}

// The address that downloads the file a shared link points to, or null for a
// link that isn't a Google Drive, OneDrive or Dropbox file.
export function downloadUrl(raw: string): string | null {
  const src = sourceOf(raw.trim());
  if (!src) return null;
  const u = new URL(raw.trim());
  if (src === "google") {
    if (u.hostname === "www.googleapis.com") return null; // only with a sign-in token
    const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) return null;
    return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  if (src === "dropbox") {
    if (/\.dropboxusercontent\.com$/.test(u.hostname)) return u.toString();
    if (!/^\/(s|scl\/fi|sh)\//.test(u.pathname)) return null;
    u.searchParams.delete("dl");
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  // OneDrive: Microsoft's "shares" address opens any shared link.
  if (/\.(1drv|files\.1drv|sharepoint|livefilestore)\.com$/.test(u.hostname) && u.pathname.includes("download")) return u.toString();
  const encoded = Buffer.from(u.toString()).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return `https://api.onedrive.com/v1.0/shares/u!${encoded}/root/content`;
}

// Is this a photo? By its first bytes, not by what the server says.
export function imageKind(b: Uint8Array): "jpeg" | "png" | "webp" | "heic" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(ascii(8, 12))) return "heic";
  return null;
}

export const MAX_BYTES = 40 * 1024 * 1024;
