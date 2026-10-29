import "server-only";
import { LIMITS } from "./posting";

// Facebook Pages and Instagram publishing through the Meta Graph API.
// Docs: developers.facebook.com/docs/pages-api and
// developers.facebook.com/docs/instagram-platform/content-publishing

const VERSION = (process.env.META_GRAPH_VERSION ?? "").trim() || "v23.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  // First comments, results and the inbox.
  "pages_manage_engagement",
  "pages_read_user_content",
  "read_insights",
  "instagram_manage_comments",
  "instagram_manage_insights",
];

export const metaAppId = () => (process.env.META_APP_ID ?? "").trim();
const metaSecret = () => (process.env.META_APP_SECRET ?? "").trim();
export const isMetaConfigured = () => metaAppId().length > 0 && metaSecret().length > 0;

export class MetaError extends Error {}

async function graph<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(method === "GET" ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`, {
    method,
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new MetaError(json.error?.error_user_msg || json.error?.message || `Meta request failed (${res.status})`);
  }
  return json as T;
}

export function loginUrl(redirectUri: string, state: string) {
  // Apps set up with "Facebook Login for Business" pick permissions in a
  // configuration on Meta's side and pass its id instead of a scope list.
  const configId = (process.env.META_CONFIG_ID ?? "").trim();
  const params = new URLSearchParams({
    client_id: metaAppId(),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    ...(configId ? { config_id: configId } : { scope: META_SCOPES.join(",") }),
  });
  return `https://www.facebook.com/${VERSION}/dialog/oauth?${params}`;
}

export type MetaPage = { id: string; name: string; token: string; ig_user_id: string | null; ig_username: string | null };

// Swaps the login code for the person's Pages. Page tokens made from a
// long-lived user token don't expire unless the person removes the app.
export async function pagesFromCode(code: string, redirectUri: string): Promise<MetaPage[]> {
  const short = await graph<{ access_token: string }>("oauth/access_token", {
    client_id: metaAppId(),
    client_secret: metaSecret(),
    redirect_uri: redirectUri,
    code,
  });
  const long = await graph<{ access_token: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: metaAppId(),
    client_secret: metaSecret(),
    fb_exchange_token: short.access_token,
  });
  const pages = await graph<{
    data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  }>("me/accounts", {
    access_token: long.access_token,
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
  });
  return pages.data.map((p) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    ig_user_id: p.instagram_business_account?.id ?? null,
    ig_username: p.instagram_business_account?.username ?? null,
  }));
}

// imageUrls must be reachable by Meta's servers (signed storage links are).
// No photos makes a text-only post.
export async function publishToFacebook(pageId: string, token: string, imageUrls: string[], message: string) {
  if (!imageUrls.length) {
    return (await graph<{ id: string }>(`${pageId}/feed`, { message, access_token: token }, "POST")).id;
  }
  if (imageUrls.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`${pageId}/photos`, { url: imageUrls[0], message, access_token: token }, "POST");
    return r.post_id ?? r.id;
  }
  const media = [];
  for (const url of imageUrls) {
    const r = await graph<{ id: string }>(`${pageId}/photos`, { url, published: "false", access_token: token }, "POST");
    media.push({ media_fbid: r.id });
  }
  const r = await graph<{ id: string }>(`${pageId}/feed`, { message, attached_media: JSON.stringify(media), access_token: token }, "POST");
  return r.id;
}

async function waitUntilReady(containerId: string, token: string) {
  for (let i = 0; i < 15; i++) {
    const r = await graph<{ status_code: string }>(containerId, { fields: "status_code", access_token: token });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new MetaError("Instagram couldn't process a photo");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new MetaError("Instagram took too long to process the photos");
}

export async function publishToInstagram(igUserId: string, token: string, imageUrls: string[], caption: string, collaborators: string[] = []) {
  const urls = imageUrls.slice(0, LIMITS.instagram.photos);
  const extra: Record<string, string> = collaborators.length ? { collaborators: JSON.stringify(collaborators.slice(0, 3)) } : {};
  let container: string;
  if (urls.length === 1) {
    container = (await graph<{ id: string }>(`${igUserId}/media`, { image_url: urls[0], caption, ...extra, access_token: token }, "POST")).id;
  } else {
    const children = [];
    for (const url of urls) {
      const child = await graph<{ id: string }>(`${igUserId}/media`, { image_url: url, is_carousel_item: "true", access_token: token }, "POST");
      children.push(child.id);
    }
    for (const child of children) await waitUntilReady(child, token);
    container = (
      await graph<{ id: string }>(
        `${igUserId}/media`,
        { media_type: "CAROUSEL", children: children.join(","), caption, ...extra, access_token: token },
        "POST",
      )
    ).id;
  }
  await waitUntilReady(container, token);
  const r = await graph<{ id: string }>(`${igUserId}/media_publish`, { creation_id: container, access_token: token }, "POST");
  return r.id;
}

// The cover photo as an Instagram story too.
export async function publishStory(igUserId: string, token: string, imageUrl: string) {
  const container = (await graph<{ id: string }>(`${igUserId}/media`, { image_url: imageUrl, media_type: "STORIES", access_token: token }, "POST")).id;
  await waitUntilReady(container, token);
  return (await graph<{ id: string }>(`${igUserId}/media_publish`, { creation_id: container, access_token: token }, "POST")).id;
}

// First comment (usually the hashtags) on a Facebook post or Instagram media.
export async function addComment(objectId: string, token: string, message: string) {
  return (await graph<{ id: string }>(`${objectId}/comments`, { message, access_token: token }, "POST")).id;
}

// Likes, comments, reach for the analytics page. Missing numbers are 0.
export async function fetchPostMetrics(platform: "facebook" | "instagram", objectId: string, token: string) {
  try {
    if (platform === "facebook") {
      const r = await graph<{ reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } }; shares?: { count: number } }>(objectId, {
        fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
        access_token: token,
      });
      return { likes: r.reactions?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0, reach: 0, saves: 0 };
    }
    const r = await graph<{ like_count?: number; comments_count?: number }>(objectId, { fields: "like_count,comments_count", access_token: token });
    let reach = 0;
    let saves = 0;
    try {
      const ins = await graph<{ data: { name: string; values: { value: number }[] }[] }>(`${objectId}/insights`, { metric: "reach,saved", access_token: token });
      reach = ins.data.find((d) => d.name === "reach")?.values[0]?.value ?? 0;
      saves = ins.data.find((d) => d.name === "saved")?.values[0]?.value ?? 0;
    } catch {}
    return { likes: r.like_count ?? 0, comments: r.comments_count ?? 0, shares: 0, reach, saves };
  } catch {
    return null;
  }
}

export async function fetchAccountNumbers(pageId: string, igUserId: string | null, token: string) {
  const fb = await graph<{ followers_count?: number; fan_count?: number }>(pageId, { fields: "followers_count,fan_count", access_token: token }).catch(() => null);
  const ig = igUserId ? await graph<{ followers_count?: number }>(igUserId, { fields: "followers_count", access_token: token }).catch(() => null) : null;
  return { facebook: fb ? fb.followers_count ?? fb.fan_count ?? 0 : null, instagram: ig ? ig.followers_count ?? 0 : null };
}

export type InboxComment = { id: string; platform: "facebook" | "instagram"; objectId: string; text: string; author: string; at: string; replied: boolean; hidden: boolean };

// Comments on one published post, newest first.
export async function listComments(platform: "facebook" | "instagram", objectId: string, token: string): Promise<InboxComment[]> {
  try {
    if (platform === "facebook") {
      const r = await graph<{ data: { id: string; message?: string; from?: { name: string; id: string }; created_time: string; is_hidden?: boolean; comment_count?: number }[] }>(`${objectId}/comments`, {
        fields: "id,message,from,created_time,is_hidden,comment_count",
        order: "reverse_chronological",
        limit: "25",
        access_token: token,
      });
      return r.data.map((c) => ({ id: c.id, platform, objectId, text: c.message ?? "", author: c.from?.name ?? "", at: c.created_time, replied: (c.comment_count ?? 0) > 0, hidden: !!c.is_hidden }));
    }
    const r = await graph<{ data: { id: string; text: string; username?: string; timestamp: string; hidden?: boolean; replies?: { data: unknown[] } }[] }>(`${objectId}/comments`, {
      fields: "id,text,username,timestamp,hidden,replies{id}",
      limit: "25",
      access_token: token,
    });
    return r.data.map((c) => ({ id: c.id, platform, objectId, text: c.text, author: c.username ?? "", at: c.timestamp, replied: !!c.replies?.data?.length, hidden: !!c.hidden }));
  } catch {
    return [];
  }
}

export async function replyToComment(platform: "facebook" | "instagram", commentId: string, token: string, message: string) {
  const path = platform === "facebook" ? `${commentId}/comments` : `${commentId}/replies`;
  return (await graph<{ id: string }>(path, { message, access_token: token }, "POST")).id;
}

export async function hideComment(platform: "facebook" | "instagram", commentId: string, token: string, hide: boolean) {
  await graph(commentId, platform === "facebook" ? { is_hidden: String(hide), access_token: token } : { hide: String(hide), access_token: token }, "POST");
}

// The page's own past posts, newest first, with how people responded: used
// once to learn the school's voice from what already works.
export async function recentPagePosts(pageId: string, token: string, limit = 100) {
  type P = { message?: string; created_time: string; shares?: { count: number }; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } } };
  const r = await graph<{ data: P[] }>(`${pageId}/posts`, {
    fields: "message,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
    limit: String(Math.min(100, limit)),
    access_token: token,
  });
  return r.data
    .filter((p) => p.message?.trim())
    .map((p) => ({ text: p.message!.trim(), at: p.created_time, score: (p.reactions?.summary.total_count ?? 0) + (p.comments?.summary.total_count ?? 0) * 2 + (p.shares?.count ?? 0) * 3 }));
}
