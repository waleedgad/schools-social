// Shared posting rules, used by the website screens, the server actions and
// the publisher. No server-only imports, so client components can use it.

export const STATUSES = ["idea", "draft", "in_review", "waiting_extra", "rejected", "approved", "scheduled", "publishing", "published", "failed"] as const;
export type PostStatus = (typeof STATUSES)[number];

// Board columns, left to right.
export const BOARD: { key: string; statuses: PostStatus[] }[] = [
  { key: "idea", statuses: ["idea"] },
  { key: "draft", statuses: ["draft", "rejected"] },
  { key: "waiting", statuses: ["in_review", "waiting_extra"] },
  { key: "scheduled", statuses: ["approved", "scheduled", "publishing"] },
  { key: "posted", statuses: ["published", "failed"] },
];

export const STATUS_TONE: Record<PostStatus, "grey" | "accent" | "good" | "warn" | "danger" | "violet" | "info"> = {
  idea: "violet",
  draft: "grey",
  in_review: "warn",
  waiting_extra: "warn",
  rejected: "danger",
  approved: "info",
  scheduled: "accent",
  publishing: "accent",
  published: "good",
  failed: "danger",
};

// Each platform's own limits. A school can set a lower photo limit.
export const LIMITS = {
  instagram: { photos: 20, caption: 2200, hashtags: 30 },
  facebook: { photos: 80, caption: 63206 },
};

export function photoLimit(platforms: string[], schoolLimit: number | null) {
  const platform = platforms.includes("facebook") ? LIMITS.facebook.photos : LIMITS.instagram.photos;
  return Math.min(platform, schoolLimit ?? Infinity);
}

// Where Instagram and Facebook cut a caption off with "… more".
export const MORE_AFTER = { instagram: 125, facebook: 480 };

export type Slot = { id: string; weekday: number; at_time: string; category_id: string | null; platforms: string[] };

// Local wall-clock parts of a date in the school's time zone.
function parts(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, weekday };
}

// The UTC instant of a wall-clock time in a time zone.
export function zonedTime(y: number, m: number, d: number, h: number, min: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = parts(new Date(guess), timeZone);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  return new Date(guess - offset);
}

// The next time slots from now, in order, for the next `days` days.
export function upcomingSlots(slots: Slot[], timeZone: string, days = 21, from = new Date()) {
  const out: { at: Date; slot: Slot }[] = [];
  const start = parts(from, timeZone);
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    const weekday = day.getUTCDay();
    for (const s of slots.filter((x) => x.weekday === weekday)) {
      const [h, min] = s.at_time.split(":").map(Number);
      const at = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min, timeZone);
      if (at.getTime() > from.getTime() + 5 * 60_000) out.push({ at, slot: s });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// The first free slot for a category (or any slot without a category).
export function nextFreeSlot(slots: Slot[], taken: Date[], categoryId: string | null, timeZone: string) {
  const busy = new Set(taken.map((d) => Math.round(d.getTime() / 60_000)));
  const fits = (s: Slot) => !categoryId || !s.category_id || s.category_id === categoryId;
  return upcomingSlots(slots, timeZone).find((x) => fits(x.slot) && !busy.has(Math.round(x.at.getTime() / 60_000)))?.at ?? null;
}

// Spread posts over the next days: one per free slot, or one a day at 6pm
// on school days when the school has no slots yet.
export function spread(count: number, slots: Slot[], taken: Date[], timeZone: string) {
  const busy = new Set(taken.map((d) => Math.round(d.getTime() / 60_000)));
  const free = upcomingSlots(slots, timeZone, 60).filter((x) => !busy.has(Math.round(x.at.getTime() / 60_000))).map((x) => x.at);
  if (free.length >= count) return free.slice(0, count);
  const start = parts(new Date(), timeZone);
  for (let i = 1; free.length < count && i < 120; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    if (day.getUTCDay() === 5 || day.getUTCDay() === 6) continue;
    const at = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 18, 0, timeZone);
    if (!busy.has(Math.round(at.getTime() / 60_000))) free.push(at);
  }
  return free.slice(0, count);
}

export function isPaused(school: { posting_paused_until: string | null }) {
  return !!school.posting_paused_until && Date.parse(school.posting_paused_until) > Date.now();
}

// @mentions in a comment: "@Mona" matches a colleague whose name starts so.
export function findMentions(body: string, people: { user_id: string; full_name: string }[]) {
  const words = [...body.matchAll(/@([\p{L}\p{N}_.-]{2,})/gu)].map((m) => m[1].toLowerCase());
  return people.filter((p) => words.some((w) => p.full_name.toLowerCase().replace(/\s+/g, "").startsWith(w) || p.full_name.toLowerCase().split(/\s+/)[0] === w)).map((p) => p.user_id);
}

export function categoryName(c: { name_ar: string; name_en: string } | null | undefined, locale: string) {
  if (!c) return "";
  return locale === "ar" ? c.name_ar : c.name_en;
}
