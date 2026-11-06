// A stand-in for Facebook and Instagram (the Meta Graph API) for robot tests.
// The test website is started with META_GRAPH_URL pointing here, so nothing
// ever reaches the real Meta. Tests put comments in with POST /__seed and
// read what the website sent with GET /__calls.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_META_PORT ?? 3998);
const comments = new Map(); // object id -> [{ id, platform, text, author, at, hidden, replies, fail }]
const calls = [];
const emails = []; // what the website sent by email
const containers = new Set(); // Instagram media waiting to be published
let failRule = null; // { path, message }: the next calls whose path contains it are refused
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
  if (failRule && path.includes(failRule.path)) return json(res, 400, { error: { message: failRule.message } });

  // Publishing: Facebook photos and posts, Instagram media and stories.
  if (req.method === "POST" && (edge === "photos" || edge === "media")) {
    const link = params.url ?? params.image_url;
    if (link && !(await fetchImage(link))) return json(res, 400, { error: { message: "(#100) The photo link could not be downloaded" } });
    if (edge === "photos") return json(res, 200, params.published === "false" ? { id: newId("photo") } : { id: newId("photo"), post_id: newId("fbpost") });
    const id2 = newId("container");
    containers.add(id2);
    return json(res, 200, { id: id2 });
  }
  if (req.method === "POST" && edge === "feed") return json(res, 200, { id: newId("fbpost") });
  if (req.method === "POST" && edge === "media_publish") {
    if (!containers.has(params.creation_id)) return json(res, 400, { error: { message: "(#9007) Media not found" } });
    containers.delete(params.creation_id);
    return json(res, 200, { id: newId("igmedia") });
  }
  if (req.method === "GET" && !edge && params.fields === "status_code") return json(res, 200, { status_code: containers.has(id) ? "FINISHED" : "ERROR" });
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
