import "server-only";
import { getAi, type SchoolProfile } from "@/lib/ai";
import { thumbPath } from "@/lib/images";
import type { PostCtx } from "@/lib/post-core";
import { categoryName, photoLimit, zonedTime } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";

// The Mac app's post editor and calendar extras: frames, snippets, versions,
// change history, review links, photo order and edits made on the Mac,
// several posts at once (Make a week, countdowns), school events and the
// calendar's extra layers. Same token and database rules as the website.

type Body = { action: string; [k: string]: unknown };
const DAY = 86400_000;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export async function handlePosts(ctx: PostCtx, body: Body, locale: "ar" | "en"): Promise<unknown | undefined> {
  const { supabase, membership, userId } = ctx;
  const schoolId = membership.school.id;
  const perms = membership.school.permissions;
  const writer = can(membership.role, "writePosts", perms);
  const tz = membership.school.timezone;
  const audit = (action: string, target: string, details: Record<string, unknown> = {}) =>
    supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action, target, details: { ...details, from: "mac" } });

  switch (body.action) {
    // Everything the editor shows beyond the post itself.
    case "postMore": {
      const id = String(body.id ?? "");
      const { data: post } = await supabase.from("posts").select("id, event_id, platforms, category_id, frame_id, assigned_to, due_on, alt_text, location, countdown_to, caption_ig").eq("id", id).maybeSingle();
      if (!post) return { error: "missing" };
      const [{ data: school }, { data: frames }, { data: snippets }, { data: versions }, { data: links }, { data: people }, { data: history }, { data: cats }, { data: pp }] = await Promise.all([
        supabase.from("schools").select("photo_limit, caption_languages, no_post_days, holidays, profile").eq("id", schoolId).single(),
        supabase.from("frames").select("id, name, kind, storage_path, shape").eq("school_id", schoolId).order("created_at"),
        supabase.from("snippets").select("id, kind, title, body").eq("school_id", schoolId).order("title"),
        supabase.from("post_versions").select("id, caption_ar, caption_en, user_id, created_at").eq("post_id", id).order("created_at", { ascending: false }).limit(20),
        supabase.from("review_links").select("token, label, answer, comment, expires_at").eq("post_id", id).order("created_at", { ascending: false }),
        supabase.from("memberships").select("user_id, full_name, role").eq("school_id", schoolId).eq("active", true),
        supabase.from("audit_log").select("action, user_id, details, created_at").eq("school_id", schoolId).eq("target", id).order("created_at", { ascending: false }).limit(60),
        supabase.from("categories").select("id, name_ar, name_en, color, hashtags, frame_id, language_mode").eq("school_id", schoolId).order("position"),
        supabase.from("post_photos").select("position, photo:photos(id, source_key, storage_path, edited_path, edit_settings, blur_boxes, width, height)").eq("post_id", id).order("position"),
      ]);
      const urls = await signedThumbs(supabase, (frames ?? []).map((f) => f.storage_path as string));
      const names = new Map((people ?? []).map((p) => [p.user_id as string, p.full_name as string]));
      const avoid = (snippets ?? []).filter((s) => s.kind === "avoid").map((s) => s.body as string);
      return {
        extra: post,
        frames: (frames ?? []).map((f) => ({ id: f.id, name: f.name, kind: f.kind, shape: f.shape, url: urls.get(f.storage_path as string) ?? null })),
        snippets: (snippets ?? []).filter((s) => s.kind !== "avoid"),
        avoid,
        versions: (versions ?? []).map((v) => ({ id: v.id, ar: v.caption_ar, en: v.caption_en, by: names.get(v.user_id as string) ?? null, at: v.created_at })),
        links: (links ?? []).map((l) => ({ token: l.token, label: l.label, answer: l.answer, comment: l.comment, expired: Date.parse(l.expires_at as string) < Date.now() })),
        team: (people ?? []).map((p) => ({ id: p.user_id, name: p.full_name, role: p.role })),
        history: (history ?? []).map((h) => ({ action: h.action, by: names.get(h.user_id as string) ?? null, details: h.details, at: h.created_at })),
        categories: (cats ?? []).map((c) => ({ id: c.id, color: c.color, hashtags: c.hashtags ?? "", frame_id: c.frame_id, language_mode: c.language_mode ?? "both", name: categoryName(c as { name_ar: string; name_en: string }, locale) })),
        photos: (pp ?? []).map((r) => r.photo).filter(Boolean),
        photoLimit: photoLimit(post.platforms as string[], (school?.photo_limit as number | null) ?? null),
        languages: school?.caption_languages ?? "ar_en",
        noPostDays: school?.no_post_days ?? {},
        holidays: school?.holidays ?? [],
        profile: school?.profile ?? {},
      };
    }

    // Fields the editor's main buttons don't carry.
    case "setPost": {
      if (!writer) return { error: "role" };
      const v = (body.values ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      if ("frame_id" in v) update.frame_id = (v.frame_id as string) || null;
      if ("assigned_to" in v) update.assigned_to = (v.assigned_to as string) || null;
      if ("due_on" in v) update.due_on = isDay(v.due_on) ? v.due_on : null;
      if ("countdown_to" in v) update.countdown_to = isDay(v.countdown_to) ? v.countdown_to : null;
      if ("location" in v) update.location = String(v.location ?? "").slice(0, 120) || null;
      if ("alt_text" in v && v.alt_text && typeof v.alt_text === "object") {
        const a = v.alt_text as { ar?: string; en?: string };
        update.alt_text = { ar: String(a.ar ?? "").slice(0, 1000), en: String(a.en ?? "").slice(0, 1000) };
      }
      if ("caption_ig" in v) update.caption_ig = String(v.caption_ig ?? "").slice(0, 2200) || null;
      if ("cover_collage" in v) update.cover_collage = !!v.cover_collage;
      if (!Object.keys(update).length) return { error: "nothing" };
      const id = String(body.id ?? "");
      const { error } = await supabase.from("posts").update(update).eq("id", id);
      if (error) return { error: "save" };
      await audit("post.details", id, { fields: Object.keys(update) });
      if (update.assigned_to && update.assigned_to !== userId) {
        await supabase.from("team_alerts").insert({ school_id: schoolId, kind: "remind", to_user: update.assigned_to, created_by: userId, body: { post: id, assigned: true, by: membership.fullName } });
      }
      return { ok: true };
    }

    // Add, remove and reorder the post's photos (web copies already sent).
    case "postPhotos": {
      if (!writer) return { error: "role" };
      const id = String(body.id ?? "");
      const order = Array.isArray(body.order) ? [...new Set((body.order as unknown[]).map(String))].slice(0, 80) : null;
      if (!order) return { error: "order" };
      await supabase.from("post_photos").delete().eq("post_id", id);
      if (order.length) {
        const { error } = await supabase.from("post_photos").insert(order.map((photo_id, position) => ({ post_id: id, photo_id, school_id: schoolId, position })));
        if (error) return { error: "save" };
      }
      await audit("post.photos", id, { count: order.length });
      return { ok: true };
    }

    // A crop, frame or blur made on the Mac from the original. The Mac has
    // already put the new picture (and its _t thumbnail) in storage.
    case "editPhoto": {
      if (!writer) return { error: "role" };
      const photo = String(body.photo ?? "");
      const path = body.path == null ? null : String(body.path);
      if (path && !path.startsWith(`${schoolId}/${photo}_e`)) return { error: "path" };
      const { data: before } = await supabase.from("photos").select("edited_path").eq("id", photo).maybeSingle();
      const update: Record<string, unknown> = { edited_path: path, edit_settings: (body.settings as object) ?? null };
      if (Array.isArray(body.blur)) update.blur_boxes = (body.blur as unknown[]).slice(0, 60);
      const { error } = await supabase.from("photos").update(update).eq("id", photo);
      if (error) return { error: "save" };
      if (before?.edited_path && before.edited_path !== path) await supabase.storage.from("photos").remove([before.edited_path as string, thumbPath(before.edited_path as string)]);
      await audit(path ? "photo.edited" : "photo.edit_cleared", photo, { kind: (body.settings as { kind?: string } | null)?.kind ?? null });
      return { ok: true };
    }

    // Spelling, tone and words to avoid.
    case "spell": {
      const text = String(body.text ?? "").slice(0, 4400);
      if (!text.trim()) return { score: 100, notes: [], spelling: [] };
      const [{ data: school }, { data: avoid }] = await Promise.all([
        supabase.from("schools").select("profile").eq("id", schoolId).single(),
        supabase.from("snippets").select("body").eq("school_id", schoolId).eq("kind", "avoid"),
      ]);
      return getAi().checkCaption(text, (school?.profile ?? null) as SchoolProfile | null, (avoid ?? []).map((a) => a.body as string));
    }

    case "reviewLink": {
      if (!writer) return { error: "role" };
      const id = String(body.id ?? "");
      const label = String(body.label ?? "").trim().slice(0, 80);
      if (label.length < 2) return { error: "label" };
      const { data } = await supabase.from("review_links").insert({ post_id: id, school_id: schoolId, label, created_by: userId }).select("token").single();
      if (!data) return { error: "save" };
      await audit("post.review_link", id, { label });
      return { token: data.token };
    }

    case "restoreVersion": {
      if (!writer) return { error: "role" };
      const id = String(body.id ?? "");
      const { data: v } = await supabase.from("post_versions").select("caption_ar, caption_en, caption_ig, hashtags").eq("id", Number(body.version ?? 0)).eq("post_id", id).single();
      if (!v) return { error: "missing" };
      await supabase.from("posts").update(v).eq("id", id);
      await audit("post.version_restored", id, { version: body.version });
      return { ok: true };
    }

    // Several posts in one go: Make a week, one post per class, countdowns,
    // yearly repeats. Each may bring its photos and a day (and time).
    case "createMany": {
      if (!writer) return { error: "role" };
      const list = Array.isArray(body.posts) ? (body.posts as Record<string, unknown>[]).slice(0, 30) : [];
      const ids: string[] = [];
      for (const p of list) {
        const day = isDay(p.day) ? p.day : null;
        const [h, m] = typeof p.time === "string" && /^\d{2}:\d{2}/.test(p.time) ? p.time.split(":").map(Number) : [18, 0];
        const idea = p.kind === "idea";
        const { data: post } = await supabase
          .from("posts")
          .insert({
            school_id: schoolId,
            created_by: userId,
            status: idea ? "idea" : "draft",
            event_id: (p.event as string) || null,
            category_id: (p.category_id as string) || null,
            idea: String(p.idea ?? "").slice(0, 1000) || null,
            caption_ar: String(p.caption_ar ?? "").slice(0, 2200) || null,
            caption_en: String(p.caption_en ?? "").slice(0, 2200) || null,
            countdown_to: isDay(p.countdown_to) ? p.countdown_to : null,
            due_on: idea && day ? day : null,
            scheduled_at: !idea && day ? zonedTime(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), h % 24, m, tz).toISOString() : null,
          })
          .select("id")
          .single();
        if (!post) continue;
        const photos = Array.isArray(p.photos) ? (p.photos as string[]).slice(0, 80) : [];
        if (photos.length) await supabase.from("post_photos").insert(photos.map((photo_id, position) => ({ post_id: post.id, photo_id, school_id: schoolId, position })));
        ids.push(post.id as string);
      }
      if (ids.length) await audit("post.many", ids[0], { count: ids.length, why: String(body.why ?? "") });
      return { ids };
    }

    // The AI's ideas for the next days (the website's "Make a week").
    case "planWeek": {
      const days = Math.min(14, Math.max(3, Number(body.days ?? 7)));
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: events }, { data: cats }, { data: school }] = await Promise.all([
        supabase.from("events").select("id, title, event_date").eq("school_id", schoolId).gte("event_date", shift(today, -7)).lte("event_date", shift(today, days)).order("event_date"),
        supabase.from("categories").select("id, name_en").eq("school_id", schoolId).order("position"),
        supabase.from("schools").select("profile").eq("id", schoolId).single(),
      ]);
      const plan = await getAi().planPosts({
        schoolName: membership.school.name,
        days,
        events: (events ?? []).map((e) => `${e.event_date}: ${e.title}`),
        categories: (cats ?? []).map((c) => c.name_en as string),
        profile: (school?.profile ?? {}) as SchoolProfile,
      });
      const byName = new Map((cats ?? []).map((c) => [String(c.name_en).toLowerCase(), c.id as string]));
      return { plan: plan.map((p) => ({ ...p, date: shift(today, p.day), category_id: byName.get(p.category.toLowerCase()) ?? null })) };
    }

    // School events on the calendar: trips, exams, open days, occasions.
    case "saveEvent": {
      if (!writer) return { error: "role" };
      const e = (body.event ?? {}) as Record<string, unknown>;
      const title = String(e.title ?? "").trim().slice(0, 120);
      if (title.length < 2 || !isDay(e.event_date)) return { error: "event" };
      const row = {
        title,
        event_date: e.event_date,
        ends_on: isDay(e.ends_on) && e.ends_on >= e.event_date ? e.ends_on : null,
        kind: ["event", "trip", "exam", "holiday", "occasion", "sport", "meeting"].includes(String(e.kind)) ? e.kind : "event",
        class_name: String(e.class_name ?? "").slice(0, 60) || null,
        photos_expected: !!e.photos_expected,
        repeat_yearly: !!e.repeat_yearly,
      };
      const q = e.id
        ? supabase.from("events").update(row).eq("id", String(e.id)).eq("school_id", schoolId).select("id").single()
        : supabase.from("events").insert({ ...row, school_id: schoolId, created_by: userId }).select("id").single();
      const { data, error } = await q;
      if (error || !data) return { error: "save" };
      await audit(e.id ? "event.updated" : "event.created", data.id as string, { title });
      return { id: data.id };
    }

    case "saveEvents": {
      if (!writer) return { error: "role" };
      const list = Array.isArray(body.events) ? (body.events as Record<string, unknown>[]).slice(0, 400) : [];
      const rows = list
        .filter((e) => String(e.title ?? "").trim().length >= 2 && isDay(e.event_date))
        .map((e) => ({
          school_id: schoolId,
          created_by: userId,
          title: String(e.title).trim().slice(0, 120),
          event_date: e.event_date as string,
          ends_on: isDay(e.ends_on) && (e.ends_on as string) >= (e.event_date as string) ? (e.ends_on as string) : null,
          kind: ["event", "trip", "exam", "holiday", "occasion", "sport", "meeting"].includes(String(e.kind)) ? String(e.kind) : "event",
          photos_expected: !!e.photos_expected,
        }));
      if (!rows.length) return { added: 0 };
      const { error } = await supabase.from("events").insert(rows);
      if (error) return { error: "save" };
      await audit("event.imported", schoolId, { count: rows.length });
      return { added: rows.length };
    }

    case "deleteEvent": {
      if (!writer) return { error: "role" };
      const id = String(body.id ?? "");
      const { error } = await supabase.from("events").delete().eq("id", id).eq("school_id", schoolId);
      if (error) return { error: "save" };
      await audit("event.deleted", id);
      return { ok: true };
    }

    // The calendar's extra layers: terms, holidays and no-posting days,
    // yearly repeats, last year's posts this week, best times, the Instagram
    // grid and events whose photos haven't come in.
    case "calendarMore": {
      const from = isDay(body.from) ? body.from : new Date().toISOString().slice(0, 10);
      const to = isDay(body.to) ? body.to : shift(from, 42);
      const lyFrom = shift(from, -364);
      const lyTo = shift(to, -364);
      const [{ data: school }, { data: repeats }, { data: lastYear }, { data: metrics }, { data: grid }, { data: expected }] = await Promise.all([
        supabase.from("schools").select("term_dates, holidays, no_post_days").eq("id", schoolId).single(),
        supabase.from("events").select("id, title, event_date, ends_on, kind").eq("school_id", schoolId).eq("repeat_yearly", true).lt("event_date", from),
        supabase.from("posts").select("id, caption_ar, caption_en, published_at, category_id").eq("school_id", schoolId).eq("status", "published").gte("published_at", `${lyFrom}T00:00:00Z`).lte("published_at", `${lyTo}T23:59:59Z`).limit(60),
        supabase.from("post_metrics").select("post_id, likes, comments, shares, reach, post:posts!inner(published_at, school_id)").eq("post.school_id", schoolId).limit(400),
        supabase.from("posts").select("id, status, scheduled_at, published_at, platforms, post_photos(position, photo:photos(storage_path, edited_path))").eq("school_id", schoolId).contains("platforms", ["instagram"]).in("status", ["approved", "scheduled", "published"]).order("published_at", { ascending: false, nullsFirst: true }).limit(15),
        supabase.from("events").select("id, title, event_date, ends_on").eq("school_id", schoolId).eq("photos_expected", true).lt("event_date", new Date().toISOString().slice(0, 10)).gte("event_date", shift(new Date().toISOString().slice(0, 10), -30)),
      ]);
      // Repeats: move each one into this range's year.
      const inRange: { id: string; title: string; event_date: string; kind: string; from_year: number }[] = [];
      for (const r of repeats ?? []) {
        for (const y of new Set([from.slice(0, 4), to.slice(0, 4)])) {
          const d = `${y}${String(r.event_date).slice(4)}`;
          if (d >= from && d <= to) inRange.push({ id: r.id as string, title: r.title as string, event_date: d, kind: r.kind as string, from_year: +String(r.event_date).slice(0, 4) });
        }
      }
      // Best times: average reactions per weekday and hour in the school's time zone.
      const cell = new Map<string, { n: number; score: number }>();
      for (const m of (metrics ?? []) as unknown as { likes: number; comments: number; shares: number; post: { published_at: string } }[]) {
        if (!m.post?.published_at) continue;
        const at = new Date(m.post.published_at);
        const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
        const hr = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(at);
        const k = `${wd} ${hr}`;
        const c = cell.get(k) ?? { n: 0, score: 0 };
        c.n++;
        c.score += m.likes + m.comments * 2 + m.shares * 3;
        cell.set(k, c);
      }
      const best = [...cell.entries()].filter(([, c]) => c.n >= 2).map(([k, c]) => ({ at: k, avg: Math.round(c.score / c.n), posts: c.n })).sort((a, b) => b.avg - a.avg).slice(0, 5);
      // Instagram grid: what the profile will look like, newest first.
      type G = { id: string; status: string; scheduled_at: string | null; published_at: string | null; post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[] };
      const coverOf = (p: G) => {
        const f = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
        return f ? thumbPath(f.edited_path ?? f.storage_path) : null;
      };
      const g = ((grid ?? []) as unknown as G[]).sort((a, b) => (b.scheduled_at ?? b.published_at ?? "").localeCompare(a.scheduled_at ?? a.published_at ?? ""));
      const urls = await signedThumbs(supabase, g.map(coverOf).filter(Boolean) as string[]);
      // Photos expected: events in the last 30 days with no photos yet.
      const exp = expected ?? [];
      const { data: withPhotos } = exp.length ? await supabase.from("photos").select("event_id").in("event_id", exp.map((e) => e.id as string)) : { data: [] as { event_id: string }[] };
      const has = new Set((withPhotos ?? []).map((p) => p.event_id));
      return {
        terms: school?.term_dates ?? [],
        holidays: school?.holidays ?? [],
        noPostDays: school?.no_post_days ?? {},
        repeats: inRange,
        lastYear: (lastYear ?? []).map((p) => ({ id: p.id, text: p.caption_ar || p.caption_en || "", day: shift(String(p.published_at).slice(0, 10), 364), category_id: p.category_id })),
        best,
        grid: g.map((p) => ({ id: p.id, status: p.status, at: p.scheduled_at ?? p.published_at, cover: coverOf(p) ? urls.get(coverOf(p)!) ?? null : null })),
        photosMissing: exp.filter((e) => !has.has(e.id as string)),
      };
    }
  }
  return undefined;
}
