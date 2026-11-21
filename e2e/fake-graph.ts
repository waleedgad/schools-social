// A small stand-in for the Meta Graph API that lives inside one test file.
// Unlike e2e/fake-meta.mjs (one shared server the whole website talks to), a
// test here decides exactly what Meta answers next: a token that has run out,
// a rate limit, an Instagram photo that fails to process, a page that returns
// something that is not JSON. It also records every call so a test can check
// what the website really sent. Nothing ever reaches the real Meta.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Call = { method: string; path: string; params: Record<string, string> };
type Reply = { status: number; body?: unknown; raw?: string };
type Rule = { match: (c: Call) => boolean; reply: Reply | ((c: Call) => Reply); once: boolean };

export class FakeGraph {
  calls: Call[] = [];
  private rules: Rule[] = [];
  private statuses: string[] = []; // answers for Instagram "is it ready?" questions, in order
  private n = 0;
  private server!: Server;
  url = "";

  async start() {
    this.server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const params = Object.fromEntries(req.method === "POST" ? new URLSearchParams(raw) : u.searchParams);
      const call: Call = { method: req.method ?? "GET", path: u.pathname.replace(/^\/+/, ""), params };
      this.calls.push(call);
      const reply = this.answer(call);
      res.writeHead(reply.status, { "content-type": reply.raw !== undefined ? "text/html" : "application/json" });
      res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
    });
    await new Promise<void>((ok) => this.server.listen(0, "127.0.0.1", ok));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise((ok) => this.server.close(ok));
  }

  reset() {
    this.calls = [];
    this.rules = [];
    this.statuses = [];
    this.n = 0;
  }

  // The next call matching `match` gets `reply` (once, unless `always`).
  when(match: (c: Call) => boolean, reply: Reply | ((c: Call) => Reply), always = false) {
    this.rules.push({ match, reply, once: !always });
  }

  // What Instagram says when asked whether a photo or post is ready, one answer per question.
  instagramStatuses(...s: string[]) {
    this.statuses = s;
  }

  // The error Meta sends: { error: { message, code, ... } } with an HTTP 4xx.
  static error(message: string, code: number, extra: Record<string, unknown> = {}, status = 400): Reply {
    return { status, body: { error: { message, type: "OAuthException", code, ...extra } } };
  }

  private answer(c: Call): Reply {
    const i = this.rules.findIndex((r) => r.match(c));
    if (i >= 0) {
      const r = this.rules[i];
      if (r.once) this.rules.splice(i, 1);
      return typeof r.reply === "function" ? r.reply(c) : r.reply;
    }
    const parts = c.path.split("/");
    const edge = parts[1];
    if (c.method === "POST" && edge === "photos") return { status: 200, body: c.params.published === "false" ? { id: `photo_${++this.n}` } : { id: `photo_${++this.n}`, post_id: `fbpost_${this.n}` } };
    if (c.method === "POST" && edge === "feed") return { status: 200, body: { id: `fbpost_${++this.n}` } };
    if (c.method === "POST" && edge === "media") return { status: 200, body: { id: `container_${++this.n}` } };
    if (c.method === "POST" && edge === "media_publish") return { status: 200, body: { id: `igmedia_${++this.n}` } };
    if (c.method === "POST" && edge === "comments") return { status: 200, body: { id: `comment_${++this.n}` } };
    if (c.method === "POST" && edge === "replies") return { status: 200, body: { id: `reply_${++this.n}` } };
    if (c.method === "POST" && parts.length === 1) return { status: 200, body: { success: true } };
    if (c.method === "GET" && c.params.fields === "status_code") return { status: 200, body: { status_code: this.statuses.shift() ?? "FINISHED" } };
    return FakeGraph.error(`Fake Graph doesn't know ${c.method} ${c.path}`, 100);
  }
}
