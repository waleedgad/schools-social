import { createClient as createSupabase } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { getAi, type CaptionOptions, type SchoolProfile } from "@/lib/ai";
import { handleExtra } from "@/lib/app-extra";
import { thumbPath } from "@/lib/images";
import { generateFor, INTENTS, runIntent, type PostCtx } from "@/lib/post-core";
import { categoryName, zonedTime, type Slot } from "@/lib/posting";
import { loadPost, signedThumbs } from "@/lib/posts";
import { checkPost } from "@/lib/privacy";
import type { PermissionOverrides, Role } from "@/lib/roles";
import type { Membership } from "@/lib/session";
import { reusePost } from "@/lib/reuse";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

// The Mac app's Posts and Calendar screens. The app sends the signed-in
// person's own token, so the same database rules apply as on the website,
// and the posting rules run here, the same code as the website's buttons.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { action: string; locale?: string; school?: string; [k: string]: unknown };

async function context(request: NextRequest, body: Body): Promise<PostCtx | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const supabase = createSupabase(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user.user) return null;
  const { data: rows } = await supabase
    .from("memberships")
    .select("role, full_name, school:schools(id, name, default_locale, timezone, permissions)")
    .eq("user_id", user.user.id)
    .eq("active", true)
    .order("created_at");
  const list = (rows ?? []) as unknown as { role: Role; full_name: string; school: { id: string; name: string; default_locale: string; timezone: string; permissions: PermissionOverrides | null } | null }[];
  const row = list.find((r) => r.school?.id === body.school) ?? list.find((r) => r.school);
  if (!row?.school) return null;
  const membership: Membership = {
    role: row.role,
    fullName: row.full_name,
    school: { id: row.school.id, name: row.school.name, defaultLocale: row.school.default_locale, timezone: row.school.timezone, permissions: row.school.permissions ?? {} },
  };
  return { supabase, userId: user.user.id, membership };
}

const POST_COLUMNS = "id, status, idea, caption_ar, caption_en, scheduled_at, published_at, due_on, urgent, sensitive, category_id, created_by, assigned_to, platforms, countdown_to, updated_at, post_photos(position, photo:photos(storage_path, edited_path))";
type Row = { id: string; status: string; idea: string | null; caption_ar: string | null; caption_en: string | null; scheduled_at: string | null; published_at: string | null; due_on: string | null; urgent: boolean; sensitive: boolean; category_id: string | null; created_by: string | null; assigned_to: string | null; platforms: string[]; countdown_to: string | null; updated_at: string; post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[] };

async function withCovers(ctx: PostCtx, rows: Row[]) {
  const cover = (p: Row) => {
    const f = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return f ? thumbPath(f.edited_path ?? f.storage_path) : null;
  };
  const urls = await signedThumbs(ctx.supabase, rows.map(cover).filter(Boolean) as string[]);
  return rows.map(({ post_photos, ...p }) => ({ ...p, photos: post_photos.length, cover: cover({ ...p, post_photos } as Row) ? urls.get(cover({ ...p, post_photos } as Row)!) ?? null : null }));
}

async function handle(ctx: PostCtx, body: Body) {
  const { supabase, membership, userId } = ctx;
  const schoolId = membership.school.id;
  const locale = body.locale === "en" ? "en" : "ar";
  const tz = membership.school.timezone;

  switch (body.action) {
    case "me":
      return { role: membership.role, name: membership.fullName, school: membership.school.name, timezone: tz, permissions: membership.school.permissions };

    case "board": {
      const [{ data: posts }, { data: categories }] = await Promise.all([
        supabase.from("posts").select(POST_COLUMNS).eq("school_id", schoolId).gte("updated_at", new Date(Date.now() - 60 * 86400_000).toISOString()).order("updated_at", { ascending: false }).limit(300).returns<Row[]>(),
        supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId).order("position"),
      ]);
      return {
        posts: (await withCovers(ctx, posts ?? [])).map((p) => ({ ...p, mine: p.created_by === userId, assignedToMe: p.assigned_to === userId })),
        categories: (categories ?? []).map((c) => ({ id: c.id, color: c.color, name: categoryName(c as { name_ar: string; name_en: string }, locale) })),
      };
    }

    case "calendar": {
      const from = String(body.from ?? "");
      const to = String(body.to ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { error: "range" };
      const a = new Date(Date.parse(from) - 86400_000).toISOString();
      const b = new Date(Date.parse(to) + 2 * 86400_000).toISOString();
      const [{ data: posts }, { data: slots }, { data: events }, { data: categories }] = await Promise.all([
        supabase.from("posts").select(POST_COLUMNS).eq("school_id", schoolId).or(`and(scheduled_at.gte.${a},scheduled_at.lt.${b}),and(published_at.gte.${a},published_at.lt.${b}),and(due_on.gte.${from},due_on.lte.${to})`).returns<Row[]>(),
        supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId).returns<Slot[]>(),
        supabase.from("events").select("id, title, event_date, ends_on, kind, class_name, photos_expected, repeat_yearly").eq("school_id", schoolId).lte("event_date", to).or(`event_date.gte.${from},ends_on.gte.${from}`),
        supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId),
      ]);
      return {
        timezone: tz,
        posts: await withCovers(ctx, posts ?? []),
        slots: slots ?? [],
        events: events ?? [],
        categories: (categories ?? []).map((c) => ({ id: c.id, color: c.color, name: categoryName(c as { name_ar: string; name_en: string }, locale) })),
      };
    }

    case "post": {
      const id = String(body.id ?? "");
      const loaded = await loadPost(supabase, id);
      if (!loaded) return { error: "missing" };
      const { post, photos } = loaded;
      const t = await getTranslations({ locale });
      const checks = await checkPost(supabase, post, photos, post.event?.class_name ?? null);
      const thumbs = await signedThumbs(supabase, photos.map((p) => thumbPath(p.edited_path ?? p.storage_path)));
      const [{ data: comments }, { data: categories }, { data: meta }] = await Promise.all([
        supabase.from("post_comments").select("id, author_name, kind, body, created_at").eq("post_id", id).order("created_at"),
        supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId).order("position"),
        supabase.rpc("meta_status", { p_school: schoolId }),
      ]);
      const m = (meta as { page_id: string | null; page_name: string | null; ig_username: string | null }[] | null)?.[0];
      return {
        post,
        photos: photos.map((p) => ({ id: p.id, thumb: thumbs.get(thumbPath(p.edited_path ?? p.storage_path)) ?? null, width: p.width, height: p.height, waiting: p.check_status === "waiting", crop: p.edit_settings?.crop ?? "original" })),
        checks: checks.map((c) => ({ level: c.level, text: t(`posts.check.${c.key}`, c.values ?? {}) })),
        comments: comments ?? [],
        categories: (categories ?? []).map((c) => ({ id: c.id, color: c.color, name: categoryName(c as { name_ar: string; name_en: string }, locale) })),
        account: { connected: !!m?.page_id, page: m?.page_name ?? membership.school.name, ig: m?.ig_username ?? null },
      };
    }

    case "reuse": {
      const r = await reusePost(ctx, String(body.id ?? ""), body.kind === "recap" ? "recap" : "story", locale);
      return r;
    }

    case "intent": {
      const intent = String(body.intent ?? "save");
      if (!(INTENTS as readonly string[]).includes(intent)) return { error: "intent" };
      const v = (body.values ?? {}) as Record<string, unknown>;
      const allowed = ["caption_ar", "caption_en", "caption_ig", "hashtags", "first_comment", "location", "category_id", "platforms", "sensitive", "make_story", "urgent", "scheduled_at", "idea", "frame_id", "alt_text", "assigned_to", "due_on", "countdown_to"];
      const values = Object.fromEntries(Object.entries(v).filter(([k]) => allowed.includes(k)));
      const r = await runIntent(ctx, String(body.id ?? ""), intent, { values, order: Array.isArray(body.order) ? (body.order as string[]) : null, reviewNote: String(body.reviewNote ?? "") });
      if (!r.ok) {
        const t = await getTranslations({ locale });
        return { error: r.error, message: t.has(`posts.errors.${r.error}`) ? t(`posts.errors.${r.error}`) : r.error };
      }
      return r;
    }

    case "generate": {
      const r = await generateFor(ctx, String(body.id ?? ""), (body.options ?? {}) as CaptionOptions);
      return r.ok ? r : { error: r.error };
    }

    case "rewrite": {
      const text = String(body.text ?? "").slice(0, 2200);
      const ai = getAi();
      if (body.to === "ar" || body.to === "en") {
        const { data: school } = await supabase.from("schools").select("profile").eq("id", schoolId).single();
        return { text: await ai.translate(text, body.to, (school?.profile ?? {}) as SchoolProfile) };
      }
      return { text: await ai.rewrite(text, String(body.instruction ?? "").slice(0, 300), body.language === "en" ? "en" : "ar") };
    }

    case "create": {
      const ids = Array.isArray(body.photos) ? (body.photos as string[]).slice(0, 80) : [];
      const day = String(body.day ?? "");
      const { data: post, error } = await supabase
        .from("posts")
        .insert({
          school_id: schoolId,
          created_by: userId,
          event_id: (body.event as string) || null,
          status: body.kind === "idea" ? "idea" : "draft",
          idea: String(body.idea ?? "").slice(0, 1000) || null,
          due_on: body.kind === "idea" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
          scheduled_at: body.kind !== "idea" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? zonedTime(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 18, 0, tz).toISOString() : null,
        })
        .select("id")
        .single();
      if (error || !post) return { error: "save" };
      if (ids.length) await supabase.from("post_photos").insert(ids.map((photo_id, position) => ({ post_id: post.id, photo_id, school_id: schoolId, position })));
      await supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action: body.kind === "idea" ? "post.idea" : "post.created", target: post.id, details: { photos: ids.length, from: "mac" } });
      return { id: post.id };
    }

    case "move": {
      const id = String(body.id ?? "");
      const update: Record<string, unknown> = {};
      if (typeof body.status === "string" && ["idea", "draft", "in_review"].includes(body.status)) update.status = body.status;
      if (typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
        const { data: p } = await supabase.from("posts").select("scheduled_at").eq("id", id).single();
        const at = p?.scheduled_at ? new Date(p.scheduled_at as string) : null;
        const hm = at ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).split(":").map(Number) : [18, 0];
        if (typeof body.time === "string" && /^\d{2}:\d{2}/.test(body.time)) hm.splice(0, 2, ...body.time.split(":").slice(0, 2).map(Number));
        const [y, mo, d] = body.day.split("-").map(Number);
        update.scheduled_at = zonedTime(y, mo, d, hm[0] % 24, hm[1], tz).toISOString();
      }
      if (!Object.keys(update).length) return { error: "move" };
      const { error } = await supabase.from("posts").update(update).eq("id", id);
      if (error) return { error: "move" };
      await supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action: "post.moved", target: id, details: { ...update, from: "mac" } });
      return { ok: true };
    }

    case "comment": {
      const text = String(body.body ?? "").trim().slice(0, 2000);
      if (!text) return { error: "empty" };
      await supabase.from("post_comments").insert({ post_id: String(body.id ?? ""), school_id: schoolId, user_id: userId, author_name: membership.fullName, body: text });
      return { ok: true };
    }
  }
  const extra = await handleExtra(ctx, body, locale);
  return extra ?? { error: "unknown" };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.action) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const ctx = await context(request, body);
  if (!ctx) return NextResponse.json({ error: "not-signed-in" }, { status: 401 });
  try {
    return NextResponse.json(await handle(ctx, body));
  } catch (e) {
    return NextResponse.json({ error: "server", message: String((e as Error).message).slice(0, 200) }, { status: 500 });
  }
}
