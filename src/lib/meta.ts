import "server-only";

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
export async function publishToFacebook(pageId: string, token: string, imageUrls: string[], message: string) {
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

export async function publishToInstagram(igUserId: string, token: string, imageUrls: string[], caption: string) {
  const urls = imageUrls.slice(0, 10);
  let container: string;
  if (urls.length === 1) {
    container = (await graph<{ id: string }>(`${igUserId}/media`, { image_url: urls[0], caption, access_token: token }, "POST")).id;
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
        { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token },
        "POST",
      )
    ).id;
  }
  await waitUntilReady(container, token);
  const r = await graph<{ id: string }>(`${igUserId}/media_publish`, { creation_id: container, access_token: token }, "POST");
  return r.id;
}
