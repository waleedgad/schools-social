import { NextResponse } from "next/server";
import { downloadUrl, imageKind, MAX_BYTES, sourceOf } from "@/lib/cloud-links";
import { isActive } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Fetches one photo from Google Drive, OneDrive or Dropbox for the upload
// page, which then makes the web copy and uploads it like any other photo
// (so it goes to the Mac for the face and privacy check first). Only those
// services' addresses are fetched, redirects included; only real photos
// (checked by their first bytes) up to 40 MB come back.
export async function POST(request: Request) {
  const { membership } = await getSession();
  if (!membership) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!(await isActive(await createClient(), membership.school.id))) return NextResponse.json({ error: "readOnly" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; token?: unknown; fileId?: unknown };

  let next: string | null = null;
  const headers: Record<string, string> = {};
  // From the Google picker: a file of the person's own Drive, with their
  // short-lived sign-in token (used for this one download only).
  if (typeof body.fileId === "string" && typeof body.token === "string") {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(body.fileId) || body.token.length > 4000) return NextResponse.json({ error: "link" }, { status: 400 });
    next = `https://www.googleapis.com/drive/v3/files/${body.fileId}?alt=media`;
    headers.authorization = `Bearer ${body.token}`;
  } else if (typeof body.url === "string" && body.url.length <= 2000) {
    next = downloadUrl(body.url);
  }
  if (!next) return NextResponse.json({ error: "link" }, { status: 400 });

  let res: Response | null = null;
  for (let hop = 0; hop < 6 && next; hop++) {
    if (!sourceOf(next)) return NextResponse.json({ error: "link" }, { status: 400 });
    res = await fetch(next, { redirect: "manual", headers: hop === 0 ? headers : {}, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!res) return NextResponse.json({ error: "fetch" }, { status: 502 });
    const loc: string | null = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    next = loc ? new URL(loc, next).toString() : null;
  }
  if (!res || !res.ok || !res.body) return NextResponse.json({ error: res?.status === 404 || res?.status === 403 || res?.status === 401 ? "private" : "fetch" }, { status: 502 });
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return NextResponse.json({ error: "big" }, { status: 413 });

  // Read with a limit, whatever the server claimed.
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return NextResponse.json({ error: "big" }, { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  const kind = imageKind(bytes);
  // Not a photo: often a Google "can't scan this file" page or a sign-in page.
  if (!kind) return NextResponse.json({ error: "notPhoto" }, { status: 415 });
  const cd = res.headers.get("content-disposition") ?? "";
  const name = (/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ? decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)![1]) : /filename="?([^";]+)"?/i.exec(cd)?.[1]) ?? `photo.${kind === "jpeg" ? "jpg" : kind}`;
  return new NextResponse(bytes, {
    headers: {
      "content-type": `image/${kind}`,
      "x-file-name": encodeURIComponent(name.replace(/[\r\n"\\/]/g, "").slice(0, 120)),
      "cache-control": "no-store",
    },
  });
}
