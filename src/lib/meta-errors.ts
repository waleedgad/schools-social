// What a Meta (Facebook / Instagram) error means for the school, release 0.17.
// No server-only imports, so the screens and the unit tests can use it.
//
// Meta answers with { error: { code, error_subcode, message, is_transient } }.
// Codes: developers.facebook.com/docs/graph-api/guides/error-handling and
// developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes

export type MetaReason =
  | "busy" // Meta is busy or limited us for a while: try again later
  | "reconnect" // the school's key stopped working or lost a permission
  | "photo" // a photo was refused (shape, size, couldn't be downloaded)
  | "caption" // the text was refused (too long, too many hashtags)
  | "daily_limit" // Instagram's 50 posts a day
  | "duplicate" // the same text was just posted
  | "other";

export type MetaFault = { code?: number; subcode?: number; transient?: boolean; status?: number; message?: string };

const BUSY_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);
// Instagram subcodes that say "try again".
const IG_BUSY = new Set([2207001, 2207003, 2207032, 2207051]);
const IG_PHOTO = new Set([2207004, 2207005, 2207009, 2207026, 2207052, 2207057, 2207083, 2207085]);
const IG_CAPTION = new Set([2207010, 2207011, 2207049]);

export function reasonOf(f: MetaFault): MetaReason {
  const code = f.code ?? 0;
  const sub = f.subcode ?? 0;
  const msg = (f.message ?? "").toLowerCase();
  // The key: expired, password changed, app removed, or a permission missing.
  if (code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299) || [458, 459, 460, 463, 464, 467, 492].includes(sub)) return "reconnect";
  if (sub === 2207042 || code === 9 || /publish limit|too many posts/.test(msg)) return "daily_limit";
  if (code === 506 || /duplicate/.test(msg)) return "duplicate";
  if (IG_PHOTO.has(sub) || code === 324 || code === 36003 || code === 9004 || /aspect ratio|image.*(size|large|format)|download/.test(msg)) return "photo";
  if (IG_CAPTION.has(sub) || /caption|hashtag/.test(msg)) return "caption";
  if (f.transient || BUSY_CODES.has(code) || IG_BUSY.has(sub) || (f.status ?? 0) >= 500 || /timeout|timed out|temporar|try again|please retry/.test(msg)) return "busy";
  return "other";
}

// Busy Meta: tried again after 5, 15 and 45 minutes, then the post fails.
export const RETRY_MINUTES = [5, 15, 45];
export function nextRetry(attempts: number, now = new Date()): Date | null {
  const wait = RETRY_MINUTES[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000);
}

// Meta's permissions and what each lets the school do, for Check connection.
export const ABILITIES: { key: "posting" | "instagram" | "comments" | "results" | "messages"; needs: string[] }[] = [
  { key: "posting", needs: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"] },
  { key: "instagram", needs: ["instagram_basic", "instagram_content_publish"] },
  { key: "comments", needs: ["pages_manage_engagement", "pages_read_user_content", "instagram_manage_comments"] },
  { key: "results", needs: ["read_insights", "instagram_manage_insights"] },
  { key: "messages", needs: ["pages_messaging", "instagram_manage_messages"] },
];

export function abilities(granted: string[]) {
  const have = new Set(granted);
  return ABILITIES.map((a) => ({ key: a.key, ok: a.needs.every((p) => have.has(p)), missing: a.needs.filter((p) => !have.has(p)) }));
}

// Instagram's own rules for a photo post, checked before approval and again
// before posting (developers.facebook.com/docs/instagram-platform/content-publishing).
export const IG_RULES = { minRatio: 4 / 5, maxRatio: 1.91, caption: 2200, hashtags: 30, photos: 20, mentions: 20 };

export type IgProblem = "no_photo" | "too_many_photos" | "caption_long" | "too_many_hashtags" | "too_many_mentions";

export function instagramProblems(caption: string, photoCount: number): IgProblem[] {
  const out: IgProblem[] = [];
  if (photoCount === 0) out.push("no_photo");
  if (photoCount > IG_RULES.photos) out.push("too_many_photos");
  if ([...caption].length > IG_RULES.caption) out.push("caption_long");
  if ((caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length > IG_RULES.hashtags) out.push("too_many_hashtags");
  if ((caption.match(/(^|\s)@[\w.]+/g) ?? []).length > IG_RULES.mentions) out.push("too_many_mentions");
  return out;
}

// Width / height inside what Instagram takes.
export const fitsInstagram = (width: number, height: number) => !width || !height || (width / height >= IG_RULES.minRatio - 0.01 && width / height <= IG_RULES.maxRatio + 0.01);
