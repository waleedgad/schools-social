import "server-only";
import { getAi, type SchoolProfile } from "@/lib/ai";
import { listComments, replyToComment } from "@/lib/meta";
import type { PostCtx } from "@/lib/post-core";
import { categoryName, isPaused } from "@/lib/posting";
import { can } from "@/lib/roles";
import { setupState } from "@/lib/setup";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// The Mac app's Today, Settings, problem reports, shared albums, team alerts
// and library computers. Same token and database rules as the website.

type Body = { action: string; [k: string]: unknown };
const DAY = 86400_000;
const QUESTION = /[?؟]|\b(how|when|where|price|fees|admission)\b|(كم|متى|أين|فين|ازاي|إزاي|مصاريف|تقديم|القبول)/i;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function pageToken(schoolId: string) {
  if (!isAdminConfigured) return null;
  const { data } = await createAdminClient().from("meta_connections").select("page_token").eq("school_id", schoolId).maybeSingle();
  return (data?.page_token as string | undefined) ?? null;
}

export async function handleExtra(ctx: PostCtx, body: Body, locale: "ar" | "en"): Promise<unknown | undefined> {
  const { supabase, membership, userId } = ctx;
  const schoolId = membership.school.id;
  const perms = membership.school.permissions;
  const admin = membership.role === "admin";
  const comms = ["admin", "comms_lead", "comms"].includes(membership.role);

  switch (body.action) {
    // Everything Today shows that lives on the website.
    case "today": {
      const now = Date.now();
      const from = isDay(body.from) ? body.from : new Date(now - 3 * DAY).toISOString().slice(0, 10);
      const to = isDay(body.to) ? body.to : new Date(now + 10 * DAY).toISOString().slice(0, 10);
      const a = new Date(Date.parse(from) - DAY).toISOString();
      const b = new Date(Date.parse(to) + 2 * DAY).toISOString();
      const cols = "id, status, idea, caption_ar, caption_en, scheduled_at, published_at, due_on, category_id, updated_at, sent_extra_at, publish_error, created_by";
      const [week, waiting, failed, slots, events, cats, school, meta, prefs, alerts, published] = await Promise.all([
        supabase.from("posts").select(cols).eq("school_id", schoolId).or(`and(scheduled_at.gte.${a},scheduled_at.lt.${b}),and(published_at.gte.${a},published_at.lt.${b}),and(due_on.gte.${from},due_on.lte.${to})`),
        supabase.from("posts").select(cols).eq("school_id", schoolId).in("status", ["in_review", "waiting_extra"]).lt("updated_at", new Date(now - DAY).toISOString()).order("updated_at").limit(10),
        supabase.from("posts").select(cols).eq("school_id", schoolId).eq("status", "failed").gte("updated_at", new Date(now - 14 * DAY).toISOString()).limit(5),
        supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId),
        supabase.from("events").select("id, title, event_date, ends_on, kind, photos_expected, repeat_yearly, category_id").eq("school_id", schoolId).gte("event_date", new Date(Date.parse(from) - 400 * DAY).toISOString().slice(0, 10)).lte("event_date", to),
        supabase.from("categories").select("id, name_ar, name_en, color, language_mode").eq("school_id", schoolId).order("position"),
        supabase.from("schools").select("posting_paused_until, pause_reason, no_post_days, holidays, setup").eq("id", schoolId).single(),
        supabase.rpc("meta_status", { p_school: schoolId }),
        supabase.from("user_prefs").select("today, today_layout").eq("user_id", userId).eq("school_id", schoolId).maybeSingle(),
        supabase.from("team_alerts").select("id, kind, body, created_at, read_by").eq("school_id", schoolId).gte("created_at", new Date(now - 7 * DAY).toISOString()).order("created_at", { ascending: false }).limit(10),
        supabase.from("posts").select("id, caption_ar, caption_en, published_at, fb_post_id, ig_media_id").eq("school_id", schoolId).eq("status", "published").gte("published_at", new Date(now - 14 * DAY).toISOString()).order("published_at", { ascending: false }).limit(12),
      ]);
      // Last week's results: reach and reactions of posts published in the last 7 days.
      const lastWeek = (published.data ?? []).filter((p) => Date.parse(p.published_at as string) > now - 7 * DAY);
      const { data: metrics } = lastWeek.length
        ? await supabase.from("post_metrics").select("post_id, likes, comments, shares, reach").in("post_id", lastWeek.map((p) => p.id as string))
        : { data: [] as { post_id: string; likes: number; comments: number; shares: number; reach: number }[] };
      const byPost = new Map<string, number>();
      for (const m of metrics ?? []) byPost.set(m.post_id, (byPost.get(m.post_id) ?? 0) + m.likes + m.comments + m.shares);
      const topId = [...byPost.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      const top = lastWeek.find((p) => p.id === topId);
      const sum = (k: "likes" | "comments" | "shares" | "reach") => (metrics ?? []).reduce((n, m) => n + (m[k] ?? 0), 0);

      // Comments waiting for an answer (only for people who may answer).
      let inbox: { open: number; questions: number; latest: { id: string; platform: string; text: string; author: string; at: string; postText: string }[] } | null = null;
      if (can(membership.role, "writePosts", perms)) {
        const token = await pageToken(schoolId);
        if (token) {
          const lists = await Promise.all(
            (published.data ?? []).slice(0, 8).flatMap((p) => [
              p.fb_post_id ? listComments("facebook", p.fb_post_id as string, token).then((l) => l.map((c) => ({ ...c, postText: (p.caption_ar || p.caption_en || "") as string }))).catch(() => []) : Promise.resolve([]),
              p.ig_media_id ? listComments("instagram", p.ig_media_id as string, token).then((l) => l.map((c) => ({ ...c, postText: (p.caption_ar || p.caption_en || "") as string }))).catch(() => []) : Promise.resolve([]),
            ]),
          );
          const open = lists.flat().filter((c) => !c.replied && !c.hidden).sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
          inbox = { open: open.length, questions: open.filter((c) => QUESTION.test(c.text)).length, latest: open.slice(0, 4).map((c) => ({ id: c.id, platform: c.platform, text: c.text, author: c.author, at: c.at, postText: c.postText.slice(0, 300) })) };
        }
      }
      const m = (meta.data as { page_id: string | null; last_error: string | null; token_expires_at?: string | null }[] | null)?.[0];
      const problems: { kind: string; text?: string; id?: string }[] = [];
      for (const p of failed.data ?? []) problems.push({ kind: "failed", id: p.id as string, text: (p.publish_error as string) ?? "" });
      if (school.data && isPaused(school.data as { posting_paused_until: string | null })) problems.push({ kind: "paused", text: (school.data.pause_reason as string) ?? "" });
      if (m?.page_id && m.token_expires_at && Date.parse(m.token_expires_at) < now + 14 * DAY) problems.push({ kind: "expiring", text: m.token_expires_at });
      if (m?.last_error) problems.push({ kind: "account", text: m.last_error });
      if (!m?.page_id && comms) problems.push({ kind: "notConnected" });
      const setup = await setupState(supabase as never, schoolId);
      return {
        role: membership.role,
        timezone: membership.school.timezone,
        posts: week.data ?? [],
        waiting: (waiting.data ?? []).map((p) => ({ ...p, hours: Math.round((now - Date.parse((p.sent_extra_at as string) ?? (p.updated_at as string))) / 3600_000) })),
        problems,
        slots: slots.data ?? [],
        events: events.data ?? [],
        categories: (cats.data ?? []).map((c) => ({ id: c.id, color: c.color, name: categoryName(c as { name_ar: string; name_en: string }, locale) })),
        noPostDays: school.data?.no_post_days ?? {},
        holidays: school.data?.holidays ?? [],
        results: { posts: lastWeek.length, likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), reach: sum("reach"), top: top ? { id: top.id, text: ((top.caption_ar || top.caption_en || "") as string).slice(0, 140), score: byPost.get(top.id as string) ?? 0 } : null },
        inbox,
        alerts: (alerts.data ?? []).map((x) => ({ id: x.id, kind: x.kind, body: x.body, at: x.created_at, read: ((x.read_by as string[]) ?? []).includes(userId) })),
        layout: prefs.data?.today_layout ?? null,
        webSections: prefs.data?.today ?? [],
        setup: { ...setup.done, ...((school.data?.setup as Record<string, boolean>) ?? {}) },
      };
    }

    // Today's layout follows the person to every Mac and the website.
    case "saveLayout": {
      const layout = Array.isArray(body.layout) ? (body.layout as { key: string; size?: string; hidden?: boolean }[]).slice(0, 30).map((x) => ({ key: String(x.key).slice(0, 30), size: x.size === "wide" ? "wide" : "normal", hidden: !!x.hidden })) : null;
      // The website shows the same sections it knows, in the same order.
      const web = (layout ?? []).filter((x) => !x.hidden).map((x) => x.key);
      await supabase.from("user_prefs").upsert({ user_id: userId, school_id: schoolId, today_layout: layout, today: web, updated_at: new Date().toISOString() });
      return { ok: true };
    }

    // Set-up steps done on the Mac (library, class lists, first import,
    // first faces) show as done on the website too.
    case "setupDone": {
      const step = String(body.step ?? "").slice(0, 30);
      if (!step) return { error: "step" };
      const { data: s } = await supabase.from("schools").select("setup").eq("id", schoolId).single();
      if (!admin) return { ok: false };
      await supabase.from("schools").update({ setup: { ...((s?.setup as Record<string, boolean>) ?? {}), [step]: true } }).eq("id", schoolId);
      return { ok: true };
    }

    case "remind": {
      const id = String(body.id ?? "");
      const { data: post } = await supabase.from("posts").select("id, status, caption_ar, caption_en").eq("id", id).single();
      if (!post) return { error: "missing" };
      await supabase.from("team_alerts").insert({ school_id: schoolId, kind: "remind", created_by: userId, body: { post: id, from: membership.fullName, text: ((post.caption_ar || post.caption_en || "") as string).slice(0, 120) } });
      await supabase.from("post_comments").insert({ post_id: id, school_id: schoolId, user_id: userId, author_name: membership.fullName, body: locale === "ar" ? "تذكير: هذا المنشور ينتظر الموافقة." : "Reminder: this post is waiting for approval." });
      return { ok: true };
    }

    case "suggestReplies": {
      if (!can(membership.role, "writePosts", perms)) return { error: "role" };
      const { data: school } = await supabase.from("schools").select("profile").eq("id", schoolId).single();
      try {
        return { replies: await getAi().suggestReplies(String(body.comment ?? "").slice(0, 1000), String(body.postText ?? "").slice(0, 1000), (school?.profile ?? {}) as SchoolProfile) };
      } catch {
        return { error: "ai" };
      }
    }

    case "reply": {
      if (!can(membership.role, "writePosts", perms)) return { error: "role" };
      const token = await pageToken(schoolId);
      const message = String(body.message ?? "").trim().slice(0, 1000);
      if (!token || !message) return { error: "reply" };
      const platform = body.platform === "instagram" ? "instagram" : "facebook";
      const ok = !!(await replyToComment(platform, String(body.comment ?? ""), token, message).catch(() => null));
      await supabase.from("audit_log").insert({ school_id: schoolId, user_id: userId, action: ok ? "inbox.replied" : "inbox.reply_failed", target: String(body.comment ?? ""), details: { platform, from: "mac" } });
      return ok ? { ok } : { error: "reply" };
    }

    // School settings shown in the Mac app's Settings.
    case "school": {
      const [{ data: s }, { data: cats }] = await Promise.all([
        supabase.from("schools").select("photo_limit, term_dates, holidays, no_post_days, self_filing, computer_limit").eq("id", schoolId).single(),
        supabase.from("categories").select("id, name_ar, name_en, color, language_mode").eq("school_id", schoolId).order("position"),
      ]);
      return { ...(s ?? {}), admin, categories: (cats ?? []).map((c) => ({ id: c.id, color: c.color, language_mode: c.language_mode, name: categoryName(c as { name_ar: string; name_en: string }, locale) })) };
    }

    case "setSchool": {
      if (!admin) return { error: "role" };
      const p = (body.patch ?? body) as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      const ranges = (v: unknown) => (Array.isArray(v) ? (v as { name?: string; start?: string; end?: string }[]).slice(0, 60).map((t) => ({ name: String(t.name ?? "").slice(0, 80), start: isDay(t.start) ? t.start : "", end: isDay(t.end) ? t.end : "" })) : []);
      if ("photo_limit" in p) update.photo_limit = p.photo_limit == null ? null : Math.min(80, Math.max(1, Number(p.photo_limit) || 10));
      if ("term_dates" in p) update.term_dates = ranges(p.term_dates);
      if ("holidays" in p) update.holidays = ranges(p.holidays);
      if ("no_post_days" in p) update.no_post_days = typeof p.no_post_days === "object" && p.no_post_days ? p.no_post_days : {};
      if ("self_filing" in p) update.self_filing = !!p.self_filing;
      if (!Object.keys(update).length) return { error: "nothing" };
      const { error } = await supabase.from("schools").update(update).eq("id", schoolId);
      return error ? { error: "save" } : { ok: true };
    }

    case "setCategory": {
      const mode = String(body.language_mode ?? "");
      if (!["both", "separate", "ar", "en"].includes(mode)) return { error: "mode" };
      const { error } = await supabase.from("categories").update({ language_mode: mode }).eq("id", String(body.id ?? "")).eq("school_id", schoolId);
      return error ? { error: "save" } : { ok: true };
    }

    // The plan and the library computers.
    case "account": {
      const [{ data: s }, { count }] = await Promise.all([
        supabase.from("schools").select("computer_limit").eq("id", schoolId).single(),
        supabase.from("computers").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
      ]);
      return { plan: null, computers: count ?? 0, computerLimit: s?.computer_limit ?? 2, role: membership.role };
    }

    case "hello": {
      const { data, error } = await supabase.rpc("register_computer", { p_school: schoolId, p_device: String(body.device ?? ""), p_name: String(body.name ?? ""), p_platform: String(body.platform ?? "") });
      return error ? { error: "hello" } : data;
    }

    case "report": {
      const text = String(body.body ?? "").trim();
      if (!text) return { error: "empty" };
      const shot = typeof body.screenshot === "string" && body.screenshot.startsWith("data:image/") ? body.screenshot.slice(0, 3_000_000) : null;
      const { error } = await supabase.from("problem_reports").insert({ school_id: schoolId, user_id: userId, body: text.slice(0, 4000), log: String(body.log ?? "").slice(-8000), screenshot: shot, info: String(body.info ?? "").slice(0, 200) });
      return error ? { error: "save" } : { ok: true };
    }

    case "shareAlbum": {
      if (!comms) return { error: "role" };
      const macId = Number(body.localId);
      const { data: album, error } = await supabase
        .from("shared_albums")
        .upsert({ school_id: schoolId, mac_id: macId, name: String(body.name ?? "Album").slice(0, 80), created_by: userId, updated_at: new Date().toISOString() }, { onConflict: "school_id,created_by,mac_id" })
        .select("id")
        .single();
      if (error || !album) return { error: "save" };
      const ids = Array.isArray(body.photos) ? (body.photos as string[]).slice(0, 2000) : [];
      await supabase.from("shared_album_photos").delete().eq("album_id", album.id);
      if (ids.length) await supabase.from("shared_album_photos").insert(ids.map((photo_id, position) => ({ album_id: album.id, photo_id, school_id: schoolId, position })));
      return { id: album.id };
    }

    case "unshareAlbum": {
      await supabase.from("shared_albums").delete().eq("school_id", schoolId).eq("created_by", userId).eq("mac_id", Number(body.localId));
      return { ok: true };
    }

    // An import finished on the Mac: the comms team sees it on Today.
    case "notifyImport": {
      await supabase.from("team_alerts").insert({ school_id: schoolId, kind: "import", created_by: userId, body: { count: Number(body.count) || 0, title: String(body.title ?? "").slice(0, 120), photographer: body.photographer ? String(body.photographer).slice(0, 80) : null, by: membership.fullName } });
      return { ok: true };
    }

    case "readAlert": {
      await supabase.rpc("read_alert", { p_alert: String(body.id ?? "") });
      return { ok: true };
    }

    // Coverage numbers from the Mac (counts only, never faces).
    case "coverage": {
      if (!comms) return { error: "role" };
      type Cov = { code: string; className?: string; photos?: number; good?: number; focus?: number; posts?: number; last?: string; ready?: boolean; tooOften?: boolean };
      const rows = Array.isArray(body.rows) ? (body.rows as Cov[]).slice(0, 5000) : [];
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
      for (let i = 0; i < rows.length; i += 500)
        await supabase.from("student_coverage").upsert(
          rows.slice(i, i + 500).map((r) => ({
            school_id: schoolId, student_code: String(r.code).slice(0, 40), class_name: r.className ?? null, photos: n(r.photos), good: n(r.good), focus: n(r.focus), posts: n(r.posts),
            ready: !!r.ready, too_often: !!r.tooOften, last_photo: isDay(r.last) ? r.last : null, updated_at: new Date().toISOString(),
          })),
        );
      return { ok: true, rows: rows.length };
    }

    // The shot list for an event, shown on the photographer's or teacher's
    // phone while they take photos (names and counts only).
    case "shotList": {
      if (!comms) return { error: "role" };
      const title = String(body.title ?? "").trim().slice(0, 120);
      const date = isDay(body.date) ? String(body.date) : new Date().toISOString().slice(0, 10);
      if (title.length < 2) return { error: "bad-title" };
      type Shot = { code: string; name_en?: string | null; name_ar?: string | null; className?: string | null; good?: number; focus?: number };
      const list = (Array.isArray(body.students) ? (body.students as Shot[]) : []).slice(0, 300).map((s) => ({
        code: String(s.code).slice(0, 40), name_en: s.name_en ? String(s.name_en).slice(0, 120) : null, name_ar: s.name_ar ? String(s.name_ar).slice(0, 120) : null,
        class_name: s.className ? String(s.className).slice(0, 60) : null, good: Number(s.good) || 0, focus: Number(s.focus) || 0, done: false,
      }));
      const { data: ev } = await supabase.from("events").select("id").eq("school_id", schoolId).eq("event_date", date).ilike("title", title).maybeSingle();
      if (ev) await supabase.from("events").update({ shot_list: list }).eq("id", ev.id);
      else await supabase.from("events").insert({ school_id: schoolId, title, event_date: date, class_name: body.className ? String(body.className).slice(0, 60) : null, created_by: userId, shot_list: list });
      return { ok: true, students: list.length };
    }

    // Who is in each photo (student IDs), for "who's in this post".
    case "people": {
      if (!comms) return { error: "role" };
      const list = Array.isArray(body.photos) ? (body.photos as { id: string; people: string[] }[]).slice(0, 500) : [];
      for (const p of list) await supabase.from("photos").update({ people: (p.people ?? []).slice(0, 60).map((x) => String(x).slice(0, 40)) }).eq("id", p.id).eq("school_id", schoolId);
      return { ok: true };
    }

    // Students' extra details synced from the Mac.
    case "studentDetails": {
      if (!comms) return { error: "role" };
      const list = Array.isArray(body.students) ? (body.students as Record<string, unknown>[]).slice(0, 5000) : [];
      for (const s of list) {
        const update: Record<string, unknown> = {};
        if ("kind" in s && ["student", "teacher", "staff", "parent", "visitor"].includes(String(s.kind))) update.kind = s.kind;
        for (const k of ["stage", "grade", "class_teacher"]) if (k in s) update[k] = s[k] == null ? null : String(s[k]).slice(0, k === "class_teacher" ? 120 : 40);
        if ("birthday" in s) update.birthday = isDay(s.birthday) ? s.birthday : null;
        if ("left_on" in s) update.left_on = isDay(s.left_on) ? s.left_on : null;
        if ("left_on" in s) update.active = !isDay(s.left_on);
        if ("joined_on" in s) update.joined_on = isDay(s.joined_on) ? s.joined_on : null;
        if (Array.isArray(s.clubs)) update.clubs = (s.clubs as unknown[]).slice(0, 20).map((c) => String(c).slice(0, 60));
        if (Array.isArray(s.achievements)) update.achievements = (s.achievements as unknown[]).slice(0, 50);
        if (Object.keys(update).length) await supabase.from("students").update(update).eq("school_id", schoolId).eq("student_code", String(s.code ?? ""));
      }
      return { ok: true };
    }

    // "Is this …?" checks for the class teacher's phone.
    case "faceChecks": {
      if (!comms) return { error: "role" };
      const items = Array.isArray(body.items) ? (body.items as { macId: number; photo: string; box: number[]; student: string; score: number }[]).slice(0, 300) : [];
      const className = String(body.className ?? "").slice(0, 60) || null;
      if (items.length)
        await supabase.from("face_checks").upsert(
          items.map((i) => ({ school_id: schoolId, mac_id: i.macId, photo_id: i.photo, box: i.box.slice(0, 4), student_code: String(i.student).slice(0, 40), class_name: className, score: i.score, created_by: userId })),
          { onConflict: "school_id,mac_id", ignoreDuplicates: true },
        );
      return { ok: true, sent: items.length };
    }
    case "faceAnswers": {
      const { data } = await supabase.from("face_checks").select("mac_id, student_code, answer").eq("school_id", schoolId).not("answer", "is", null).limit(1000);
      return { answers: (data ?? []).map((r) => ({ macId: r.mac_id, student: r.student_code, ok: r.answer })) };
    }
    case "faceAnswersDone": {
      if (!comms) return { error: "role" };
      const ids = Array.isArray(body.ids) ? (body.ids as number[]).slice(0, 1000) : [];
      if (ids.length) await supabase.from("face_checks").delete().eq("school_id", schoolId).in("mac_id", ids).not("answer", "is", null);
      return { ok: true };
    }

    // A yearbook sent for review on the website.
    case "book": {
      if (!comms) return { error: "role" };
      const { data, error } = await supabase
        .from("books")
        .upsert(
          {
            school_id: schoolId,
            mac_id: String(body.macId ?? "").slice(0, 60),
            title: String(body.title ?? "Yearbook").slice(0, 120),
            kind: ["grade", "class", "student", "graduation"].includes(String(body.kind)) ? body.kind : "grade",
            grade: body.grade ? String(body.grade).slice(0, 40) : null,
            class_name: body.className ? String(body.className).slice(0, 60) : null,
            version: Number(body.version) || 1,
            pages: Array.isArray(body.pages) ? (body.pages as unknown[]).slice(0, 400) : [],
            status: "review",
            created_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "school_id,mac_id" },
        )
        .select("id")
        .single();
      if (error || !data) return { error: "save" };
      await supabase.from("team_alerts").insert({ school_id: schoolId, kind: "book", created_by: userId, body: { book: data.id, title: String(body.title ?? "") } });
      return { id: data.id };
    }

    case "bookReview": {
      const { data: book } = await supabase.from("books").select("id, version, status").eq("school_id", schoolId).eq("mac_id", String(body.macId ?? "")).maybeSingle();
      if (!book) return { checks: [], comments: [] };
      const [{ data: checks }, { data: comments }] = await Promise.all([
        supabase.from("book_checks").select("student_code, ok, fixed_name, note, checked_at").eq("book_id", book.id),
        supabase.from("book_comments").select("id, page, body, author_name, done, created_at").eq("book_id", book.id).order("created_at"),
      ]);
      return { ...book, checks: checks ?? [], comments: comments ?? [] };
    }
  }
  return undefined;
}
