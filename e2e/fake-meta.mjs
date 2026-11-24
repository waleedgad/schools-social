// A stand-in for Facebook and Instagram (the Meta Graph API) for robot tests.
// The test website is started with META_GRAPH_URL pointing here, so nothing
// ever reaches the real Meta. Tests put comments in with POST /__seed and
// read what the website sent with GET /__calls.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_META_PORT ?? 3998);
const comments = new Map(); // object id -> [{ id, platform, text, author, at, hidden, replies, fail }]
const calls = [];
const convos = new Map(); // page id + platform -> [{ id, withId, withName, messages: [{ text, fromPage, at }] }]
const emails = []; // what the website sent by email
const containers = new Map(); // Instagram media waiting to be published: id -> { owner, caption }
const publishedContainers = new Set(); // containers already published (status PUBLISHED)
const igMedia = new Map(); // Instagram user -> [{ id, caption }] newest first
const fbPosts = new Map(); // Page -> [{ id, message }] newest first
// Check connection (release 0.17): what debug_token answers. Tests change it with POST /__token.
let tokenInfo = { is_valid: true, scopes: null };
// { path, message, code, subcode, status, times, drop }: calls whose path contains `path` are
// refused (`times` of them, or all); with drop the work is done but the answer is lost (500).
let failRule = null;
let n = 0;
const newId = (kind) => `${kind}_${Date.now()}_${++n}`;

// Meta downloads every photo from its link; a link it can't open is refused.
async function fetchImage(url) {
  try {
    const r = await fetch(url);
    const type = r.headers.get("content-type") ?? "";
    const size = (await r.arrayBuffer()).byteLength;
    return r.ok && type.startsWith("image/") && size > 1000;
  } catch {
    return false;
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const read = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
const find = (id) => {
  for (const list of comments.values()) {
    const c = list.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const body = await read(req);
  if (url.pathname === "/__seed") {
    const { objectId, platform, list } = JSON.parse(body);
    comments.set(objectId, list.map((c, i) => ({ id: `${objectId}_c${i}`, platform, hidden: false, replies: [], at: new Date(Date.now() - i * 60_000).toISOString(), ...c })));
    return json(res, 200, { ok: true });
  }
  // Private conversations for the inbox's Messages view (release 0.15).
  if (url.pathname === "/__seedConvos") {
    const { pageId, platform, list } = JSON.parse(body);
    convos.set(`${pageId}|${platform}`, list.map((c, i) => ({ id: `t_${pageId}_${platform}_${i}`, messages: [{ text: c.text, fromPage: !!c.fromPage, at: new Date(Date.now() - i * 60_000).toISOString() }], ...c })));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/__calls") {
    const prefix = url.searchParams.get("prefix") ?? "";
    return json(res, 200, calls.filter((c) => c.path.startsWith(prefix)));
  }
  if (url.pathname === "/__up") return json(res, 200, { ok: true });
  // A stand-in for the email service (Resend): the website is started with
  // RESEND_URL pointing here; tests read what was sent with GET /__emails.
  if (url.pathname === "/resend/emails" && req.method === "POST") {
    emails.push({ ...JSON.parse(body), at: new Date().toISOString() });
    return json(res, 200, { id: newId("email") });
  }
  if (url.pathname === "/__emails") return json(res, 200, emails);
  if (url.pathname === "/__fail") {
    failRule = body ? JSON.parse(body) : null;
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/__token") {
    tokenInfo = body ? JSON.parse(body) : { is_valid: true, scopes: null };
    return json(res, 200, { ok: true });
  }

  // A stand-in for Gemini (release 0.16): the caption robot test starts a
  // second website with GEMINI_URL pointing here. The answers are messy on
  // purpose (Latin commas in Arabic, repeated hashtags, a word for children,
  // a banned word, a student's name) so the test proves the website cleans them.
  if (url.pathname.startsWith("/gemini/") && req.method === "POST") {
    const prompt = JSON.parse(body).contents?.[0]?.parts?.[0]?.text ?? "";
    calls.push({ path: url.pathname, prompt, at: new Date().toISOString() });
    let answer = {};
    if (prompt.includes("caption option")) {
      answer = [
        { ar: "أطفالنا في يوم رياضي رائع , عرض cheap", en: "Our children loved sports day", hashtags: "#SportsDay", ig: "", altAr: "", altEn: "" },
        { ar: "طلابنا في يوم رياضي رائع , شكرًا لكل من شارك #يوم_رياضي", en: "A great sports day for our students. Well done, Omar Hassan! #SportsDay", hashtags: "#SportsDay #SportsDay", ig: "", altAr: "", altEn: "" },
      ];
    } else if (prompt.includes("Check this caption")) {
      answer = { score: 92, notes: ["Warm and clear."], spelling: [] };
    } else if (prompt.includes("polite replies")) {
      answer = { replies: ["شكرًا لكم , أطفالنا فخورون", "Thank you! Our kids loved it", "A cheap reply"] };
    }
    return json(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  }

  const params = Object.fromEntries(req.method === "POST" ? new URLSearchParams(body) : url.searchParams);
  const parts = url.pathname.split("/").filter(Boolean);
  // A version first, like /v23.0/..., is allowed and ignored.
  if (/^v\d/.test(parts[0] ?? "")) parts.shift();
  const [id, edge] = parts;
  const path = parts.join("/");
  calls.push({ method: req.method, path, params: { ...params, access_token: params.access_token ? "(token)" : undefined } });

  if (req.method === "GET" && edge === "comments" && comments.has(id)) {
    const list = comments.get(id);
    const fb = list[0]?.platform !== "instagram";
    return json(res, 200, {
      data: list.map((c) =>
        fb
          ? { id: c.id, message: c.text, from: { name: c.author, id: "u1" }, created_time: c.at, is_hidden: c.hidden, comment_count: c.replies.length }
          : { id: c.id, text: c.text, username: c.author, timestamp: c.at, hidden: c.hidden, replies: { data: c.replies.map((_, i) => ({ id: `r${i}` })) } },
      ),
    });
  }
  if (req.method === "GET" && edge === "conversations") {
    const list = convos.get(`${id}|${params.platform === "instagram" ? "instagram" : "messenger"}`) ?? [];
    return json(res, 200, {
      data: list.map((c) => {
        const last = c.messages.at(-1);
        return { id: c.id, updated_time: last.at, participants: { data: [{ id, name: "Test Page" }, { id: c.withId, name: c.withName, username: c.withName }] }, messages: { data: [{ message: last.text, created_time: last.at, from: last.fromPage ? { id } : { id: c.withId } }] } };
      }),
    });
  }
  if (req.method === "POST" && edge === "messages") {
    const to = JSON.parse(params.recipient ?? "{}").id;
    const text = JSON.parse(params.message ?? "{}").text;
    for (const list of convos.values()) {
      const c = list.find((x) => x.withId === to);
      if (c) {
        if (c.fail) return json(res, 400, { error: { message: "(#10) This message is sent outside of allowed window." } });
        c.messages.push({ text, fromPage: true, at: new Date().toISOString() });
        return json(res, 200, { recipient_id: to, message_id: newId("m") });
      }
    }
    return json(res, 400, { error: { message: "(#100) No matching user found" } });
  }
  // Check connection: Meta's answer about the school's key.
  if (req.method === "GET" && id === "debug_token") {
    const all = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management", "instagram_basic", "instagram_content_publish", "pages_manage_engagement", "pages_read_user_content", "read_insights", "instagram_manage_comments", "instagram_manage_insights", "pages_messaging", "instagram_manage_messages"];
    return json(res, 200, { data: { is_valid: tokenInfo.is_valid, scopes: tokenInfo.scopes ?? all, expires_at: 0 } });
  }
  let dropAnswer = false;
  if (failRule && path.includes(failRule.path) && failRule.times !== 0) {
    if (typeof failRule.times === "number") failRule.times--;
    if (failRule.drop) dropAnswer = true;
    else return json(res, failRule.status ?? 400, { error: { message: failRule.message, code: failRule.code, error_subcode: failRule.subcode, is_transient: failRule.transient } });
  }
  const answer = (status, body) => (dropAnswer ? json(res, 500, { error: { message: "An unexpected error has occurred. Please retry your request later.", code: 2, is_transient: true } }) : json(res, status, body));

  // Lists the website reads to find a post an earlier try made, and post addresses.
  if (req.method === "GET" && edge === "posts") return json(res, 200, { data: fbPosts.get(id) ?? [] });
  if (req.method === "GET" && edge === "media") return json(res, 200, { data: igMedia.get(id) ?? [] });
  if (req.method === "GET" && !edge && params.fields === "permalink_url") return json(res, 200, { id, permalink_url: `https://www.facebook.com/fake/posts/${id}` });
  if (req.method === "GET" && !edge && params.fields === "permalink") return json(res, 200, { id, permalink: `https://www.instagram.com/p/${id}/` });

  // Publishing: Facebook photos and posts, Instagram media and stories.
  if (req.method === "POST" && (edge === "photos" || edge === "media")) {
    const link = params.url ?? params.image_url;
    if (link && !(await fetchImage(link))) return json(res, 400, { error: { message: "(#100) The photo link could not be downloaded" } });
    if (edge === "photos") {
      if (params.published === "false") return answer(200, { id: newId("photo") });
      const post = newId("fbpost");
      fbPosts.set(id, [{ id: post, message: params.message ?? "", created_time: new Date().toISOString() }, ...(fbPosts.get(id) ?? [])]);
      return answer(200, { id: newId("photo"), post_id: post });
    }
    const id2 = newId("container");
    containers.set(id2, { owner: id, caption: params.caption ?? "" });
    return answer(200, { id: id2 });
  }
  if (req.method === "POST" && edge === "feed") {
    const post = newId("fbpost");
    fbPosts.set(id, [{ id: post, message: params.message ?? "", created_time: new Date().toISOString() }, ...(fbPosts.get(id) ?? [])]);
    return answer(200, { id: post });
  }
  if (req.method === "POST" && edge === "media_publish") {
    const c = containers.get(params.creation_id);
    if (!c) return json(res, 400, { error: { message: "(#9007) Media not found" } });
    containers.delete(params.creation_id);
    publishedContainers.add(params.creation_id);
    const media = newId("igmedia");
    igMedia.set(id, [{ id: media, caption: c.caption, timestamp: new Date().toISOString() }, ...(igMedia.get(id) ?? [])]);
    return answer(200, { id: media });
  }
  if (req.method === "GET" && !edge && params.fields === "status_code") return json(res, 200, { status_code: containers.has(id) ? "FINISHED" : publishedContainers.has(id) ? "PUBLISHED" : "ERROR" });
  if (req.method === "POST" && edge === "comments" && !find(id)) return json(res, 200, { id: newId("comment") });

  const c = find(id);
  if (req.method === "POST" && c && (edge === "comments" || edge === "replies")) {
    if (c.fail) return json(res, 400, { error: { message: "(#10) This comment can't be replied to" } });
    c.replies.push(params.message);
    return json(res, 200, { id: `${c.id}_r${c.replies.length}` });
  }
  if (req.method === "POST" && c && !edge) {
    c.hidden = (params.is_hidden ?? params.hide) === "true";
    return json(res, 200, { success: true });
  }
  return json(res, 400, { error: { message: `Fake Meta doesn't know ${req.method} ${path}` } });
}).listen(port, "127.0.0.1", () => console.log(`fake Meta on ${port}`));
