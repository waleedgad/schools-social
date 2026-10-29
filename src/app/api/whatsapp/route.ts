import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// WhatsApp photo intake: staff send photos to the school's WhatsApp
// Business number and they arrive as uploads, waiting for the Mac check
// like any other phone upload. Only numbers of people in the school's team
// are accepted. Needs the WhatsApp product on the school's Meta app:
// WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN and META_APP_SECRET in Vercel.

const VERSION = (process.env.META_GRAPH_VERSION ?? "").trim() || "v23.0";
const token = () => (process.env.WHATSAPP_TOKEN ?? "").trim();
const verify = () => (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
const secret = () => (process.env.META_APP_SECRET ?? "").trim();
const digits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "").slice(-10);

// Meta checks the address once when the webhook is set up.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  if (q.get("hub.mode") === "subscribe" && verify() && q.get("hub.verify_token") === verify()) return new NextResponse(q.get("hub.challenge") ?? "");
  return new NextResponse("Forbidden", { status: 403 });
}

// The size of a JPEG, read from its header.
function jpegSize(b: Uint8Array) {
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}

async function graph(path: string) {
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${path}`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`whatsapp ${res.status}`);
  return res.json();
}

type Message = { from: string; id: string; type: string; image?: { id: string; mime_type?: string; caption?: string } };
type Change = { value?: { metadata?: { phone_number_id?: string }; messages?: Message[] } };

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", secret()).update(raw).digest("hex")}`;
  if (!secret() || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return new NextResponse("Bad signature", { status: 401 });
  if (!token() || !isAdminConfigured) return NextResponse.json({ ok: true });

  let body: { entry?: { changes?: Change[] }[] } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const admin = createAdminClient();
  for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
    const phoneId = change.value?.metadata?.phone_number_id;
    const images = (change.value?.messages ?? []).filter((m) => m.type === "image" && m.image?.id);
    if (!phoneId || !images.length) continue;
    const { data: link } = await admin.from("school_integrations").select("school_id, whatsapp_event").eq("whatsapp_phone_id", phoneId).maybeSingle();
    if (!link) continue;
    const { data: team } = await admin.from("memberships").select("user_id, phone, full_name").eq("school_id", link.school_id).eq("active", true).not("phone", "is", null);
    for (const m of images) {
      const who = (team ?? []).find((p) => digits(p.phone as string) && digits(p.phone as string) === digits(m.from));
      if (!who) continue;
      try {
        const media = await graph(m.image!.id);
        const file = await fetch(media.url, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000) });
        if (!file.ok) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length > 25 * 1024 * 1024 || !(media.mime_type ?? "").includes("jpeg")) continue;
        const id = crypto.randomUUID();
        const path = `${link.school_id}/${id}.jpg`;
        const bucket = admin.storage.from("photos");
        await bucket.upload(path, bytes, { contentType: "image/jpeg" });
        // The Mac makes the proper small copy when it checks the photo.
        await bucket.upload(`${link.school_id}/${id}_t.jpg`, bytes, { contentType: "image/jpeg" });
        const size = jpegSize(bytes);
        await admin.from("photos").insert({
          id,
          school_id: link.school_id,
          event_id: link.whatsapp_event,
          uploaded_by: who.user_id,
          source: "whatsapp",
          source_key: `wa:${m.id}`,
          storage_path: path,
          width: size?.width ?? null,
          height: size?.height ?? null,
          size_bytes: bytes.length,
          original_name: `whatsapp-${m.id.slice(-12)}.jpg`,
          note: m.image!.caption?.slice(0, 280) || null,
        });
      } catch (e) {
        console.error("whatsapp photo failed", String(e).slice(0, 200));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
