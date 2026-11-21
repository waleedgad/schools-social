import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FakeGraph } from "./fake-graph";

// What the website sends to Facebook and Instagram, and what it does when
// Meta says no. These tests need no database and no browser: they call the
// publishing code (src/lib/meta.ts) against a stand-in for the Meta Graph API
// that answers exactly what each test decides (see e2e/fake-graph.ts).
// Run alone, without a build:  npx playwright test -c e2e/meta.config.ts

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const fake = new FakeGraph();
type Meta = typeof import("../src/lib/meta");
let meta: Meta;
const TOKEN = "page-token-123";
const photos = (n: number) => Array.from({ length: n }, (_, i) => `https://files.example/p${i + 1}.jpg`);

test.beforeAll(async () => {
  await fake.start();
  // "server-only" refuses to load outside the website's server: a test is not the website.
  const path = require.resolve("server-only");
  require.cache[path] = { id: path, filename: path, loaded: true, exports: {}, children: [], paths: [], path } as unknown as NodeJS.Module;
  process.env.META_GRAPH_URL = fake.url;
  process.env.META_APP_ID = "app-1";
  process.env.META_APP_SECRET = "secret-1";
  meta = await import("../src/lib/meta");
});
test.afterAll(async () => fake.stop());
test.beforeEach(() => fake.reset());

const posts = () => fake.calls.filter((c) => c.method === "POST");

test.describe("Facebook", () => {
  test("no photos: a text post on the Page feed", async () => {
    const id = await meta.publishToFacebook("page1", TOKEN, [], "Hello");
    expect(id).toMatch(/^fbpost_/);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST page1/feed"]);
    expect(fake.calls[0].params).toMatchObject({ message: "Hello", access_token: TOKEN });
  });

  test("one photo: a single photo post with its caption, and the post id comes back", async () => {
    const id = await meta.publishToFacebook("page1", TOKEN, photos(1), "Caption");
    expect(id).toMatch(/^fbpost_/);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ path: "page1/photos", params: { url: photos(1)[0], message: "Caption" } });
  });

  test("several photos: each is added unpublished, then one post lists them in the same order", async () => {
    await meta.publishToFacebook("page1", TOKEN, photos(3), "Album");
    const sent = posts();
    expect(sent.map((c) => c.path)).toEqual(["page1/photos", "page1/photos", "page1/photos", "page1/feed"]);
    expect(sent.slice(0, 3).map((c) => [c.params.url, c.params.published])).toEqual(photos(3).map((u) => [u, "false"]));
    const attached = JSON.parse(sent[3].params.attached_media) as { media_fbid: string }[];
    expect(attached.map((m) => m.media_fbid)).toEqual(["photo_1", "photo_2", "photo_3"]);
    expect(sent[3].params.message).toBe("Album");
  });

  test("a photo Meta refuses stops the post: no feed post is made", async () => {
    fake.when((c) => c.path === "page1/photos" && c.params.url === photos(3)[1], FakeGraph.error("(#100) The photo link could not be downloaded", 100));
    await expect(meta.publishToFacebook("page1", TOKEN, photos(3), "Album")).rejects.toThrow(/could not be downloaded/);
    expect(fake.calls.some((c) => c.path === "page1/feed")).toBe(false);
  });
});

test.describe("Instagram", () => {
  test("one photo: a container, a check that it is ready, then publish", async () => {
    const id = await meta.publishToInstagram("ig1", TOKEN, photos(1), "Hi #school");
    expect(id).toMatch(/^igmedia_/);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST ig1/media", "GET container_1", "POST ig1/media_publish"]);
    expect(fake.calls[0].params).toMatchObject({ image_url: photos(1)[0], caption: "Hi #school" });
    expect(fake.calls[2].params.creation_id).toBe("container_1");
  });

  test("several photos: carousel items first, each checked, then the carousel with the items in order", async () => {
    await meta.publishToInstagram("ig1", TOKEN, photos(3), "Album");
    const made = posts().filter((c) => c.path === "ig1/media");
    expect(made.slice(0, 3).map((c) => [c.params.image_url, c.params.is_carousel_item])).toEqual(photos(3).map((u) => [u, "true"]));
    expect(made[3].params).toMatchObject({ media_type: "CAROUSEL", children: "container_1,container_2,container_3", caption: "Album" });
    expect(made[3].params.is_carousel_item).toBeUndefined();
    expect(posts().at(-1)).toMatchObject({ path: "ig1/media_publish", params: { creation_id: "container_4" } });
  });

  test("never more than Instagram's photo limit, and never more than three collaborators", async () => {
    await meta.publishToInstagram("ig1", TOKEN, photos(25), "Big", ["a", "b", "c", "d", "e"]);
    const items = posts().filter((c) => c.params.is_carousel_item === "true");
    expect(items).toHaveLength(20);
    const carousel = posts().find((c) => c.params.media_type === "CAROUSEL")!;
    expect(JSON.parse(carousel.params.collaborators)).toEqual(["a", "b", "c"]);
  });

  test("an Instagram photo that fails to process stops everything: nothing is published", async () => {
    fake.instagramStatuses("FINISHED", "ERROR");
    await expect(meta.publishToInstagram("ig1", TOKEN, photos(3), "Album")).rejects.toThrow(/couldn't process a photo/);
    expect(fake.calls.some((c) => c.path === "ig1/media_publish")).toBe(false);
    expect(fake.calls.some((c) => c.params.media_type === "CAROUSEL")).toBe(false);
  });

  test("an expired container is treated like a failure", async () => {
    fake.instagramStatuses("EXPIRED");
    await expect(meta.publishToInstagram("ig1", TOKEN, photos(1), "x")).rejects.toThrow(/couldn't process/);
    expect(fake.calls.some((c) => c.path === "ig1/media_publish")).toBe(false);
  });

  test("a container still in progress is asked again, then published when ready", async () => {
    fake.instagramStatuses("IN_PROGRESS", "FINISHED");
    const id = await meta.publishToInstagram("ig1", TOKEN, photos(1), "x");
    expect(id).toMatch(/^igmedia_/);
    expect(fake.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  test("a story is a STORIES container, checked, then published", async () => {
    await meta.publishStory("ig1", TOKEN, photos(1)[0]);
    expect(posts()[0].params).toMatchObject({ media_type: "STORIES", image_url: photos(1)[0] });
    expect(posts().at(-1)?.path).toBe("ig1/media_publish");
  });
});

test.describe("when Meta says no", () => {
  test("a token that has run out: Meta's own words come through, and nothing else is tried", async () => {
    fake.when(() => true, FakeGraph.error("Error validating access token: Session has expired", 190, { error_subcode: 463 }, 401), true);
    await expect(meta.publishToFacebook("page1", TOKEN, photos(1), "x")).rejects.toThrow(/Session has expired/);
    expect(fake.calls).toHaveLength(1);
  });

  test("a message written for the user wins over the technical one", async () => {
    fake.when(() => true, FakeGraph.error("(#368) technical", 368, { error_user_msg: "Your Page is restricted from posting for now." }));
    await expect(meta.publishToFacebook("page1", TOKEN, [], "x")).rejects.toThrow("Your Page is restricted from posting for now.");
  });

  test("rate limit (code 4): the error is raised, not swallowed", async () => {
    fake.when(() => true, FakeGraph.error("(#4) Application request limit reached", 4, {}, 429));
    await expect(meta.publishToInstagram("ig1", TOKEN, photos(1), "x")).rejects.toThrow(/request limit reached/);
  });

  test("an error inside a 200 answer is still an error", async () => {
    fake.when(() => true, { status: 200, body: { error: { message: "Unsupported post request" } } });
    await expect(meta.publishToFacebook("page1", TOKEN, [], "x")).rejects.toThrow(/Unsupported post request/);
  });

  test("a server error that is not JSON gives a plain message with the status", async () => {
    fake.when(() => true, { status: 502, raw: "<html>Bad gateway</html>" });
    await expect(meta.publishToFacebook("page1", TOKEN, [], "x")).rejects.toThrow("Meta request failed (502)");
  });

  test("one failing Facebook photo in the middle leaves the earlier unpublished photos unused, and no post", async () => {
    let seen = 0;
    fake.when((c) => c.path === "page1/photos" && ++seen === 2, FakeGraph.error("(#1) An unknown error occurred", 1, {}, 500), false);
    await expect(meta.publishToFacebook("page1", TOKEN, photos(3), "Album")).rejects.toThrow(/unknown error/);
    expect(posts().map((c) => c.path)).toEqual(["page1/photos", "page1/photos"]);
  });
});

test.describe("what is sent with every call", () => {
  test("a proof made with the app secret travels with the token", async () => {
    await meta.publishToFacebook("page1", TOKEN, [], "x");
    const proof = createHmac("sha256", "secret-1").update(TOKEN).digest("hex");
    expect(fake.calls[0].params.appsecret_proof).toBe(proof);
  });

  test("without an app secret no proof is sent", async () => {
    const secret = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = "";
    try {
      await meta.publishToFacebook("page1", TOKEN, [], "x");
      expect(fake.calls[0].params.appsecret_proof).toBeUndefined();
    } finally {
      process.env.META_APP_SECRET = secret;
    }
  });

  test("a screen can never aim the Page key at another Graph address", async () => {
    const bad = ["../me", "123/../me", "1?access_token=x", "1 2", "", "a".repeat(101), "1/2", "1&hide=true", "é"];
    for (const id of bad) {
      await expect(meta.replyToComment("facebook", id, TOKEN, "hi"), JSON.stringify(id)).rejects.toThrow(/bad comment id/);
      await expect(meta.hideComment("instagram", id, TOKEN, true), JSON.stringify(id)).rejects.toThrow(/bad comment id/);
    }
    for (const id of ["../me", "1/../2", "1?x=1", "x y"]) {
      await expect(meta.addComment(id, TOKEN, "hi"), JSON.stringify(id)).rejects.toThrow(/bad Graph address/);
    }
    expect(fake.calls).toHaveLength(0);
    expect(meta.isGraphId("123_456")).toBe(true);
    expect(meta.isGraphId("1/2")).toBe(false);
    expect(meta.isGraphId(123)).toBe(false);
  });
});

test.describe("comments", () => {
  test("Facebook comments are mapped, replies and hiding use the Facebook names", async () => {
    fake.when(
      (c) => c.method === "GET" && c.path === "post1/comments",
      { status: 200, body: { data: [{ id: "c1", message: "Nice", from: { name: "Mona", id: "u1" }, created_time: "2026-11-20T10:00:00+0000", is_hidden: false, comment_count: 1 }, { id: "c2", created_time: "2026-11-20T09:00:00+0000", is_hidden: true }] } },
    );
    const list = await meta.listComments("facebook", "post1", TOKEN);
    expect(list).toEqual([
      { id: "c1", platform: "facebook", objectId: "post1", text: "Nice", author: "Mona", at: "2026-11-20T10:00:00+0000", replied: true, hidden: false },
      { id: "c2", platform: "facebook", objectId: "post1", text: "", author: "", at: "2026-11-20T09:00:00+0000", replied: false, hidden: true },
    ]);
    await meta.replyToComment("facebook", "c1", TOKEN, "Thank you");
    await meta.hideComment("facebook", "c2", TOKEN, true);
    expect(posts()[0]).toMatchObject({ path: "c1/comments", params: { message: "Thank you" } });
    expect(posts()[1]).toMatchObject({ path: "c2", params: { is_hidden: "true" } });
  });

  test("Instagram comments are mapped, replies and hiding use the Instagram names", async () => {
    fake.when(
      (c) => c.method === "GET" && c.path === "media1/comments",
      { status: 200, body: { data: [{ id: "i1", text: "Love it", username: "parent_a", timestamp: "2026-11-20T10:00:00+0000", replies: { data: [{ id: "r" }] } }] } },
    );
    const list = await meta.listComments("instagram", "media1", TOKEN);
    expect(list).toEqual([{ id: "i1", platform: "instagram", objectId: "media1", text: "Love it", author: "parent_a", at: "2026-11-20T10:00:00+0000", replied: true, hidden: false }]);
    await meta.replyToComment("instagram", "i1", TOKEN, "Thanks");
    await meta.hideComment("instagram", "i1", TOKEN, false);
    expect(posts()[0].path).toBe("i1/replies");
    expect(posts()[1]).toMatchObject({ path: "i1", params: { hide: "false" } });
  });

  test("when Meta fails, the inbox shows no comments instead of breaking", async () => {
    fake.when(() => true, FakeGraph.error("token", 190, {}, 401), true);
    expect(await meta.listComments("facebook", "post1", TOKEN)).toEqual([]);
    expect(await meta.listComments("instagram", "media1", TOKEN)).toEqual([]);
  });
});

test.describe("numbers and sign-in", () => {
  test("post numbers: missing values are 0 and a failure gives null, never a made-up number", async () => {
    fake.when((c) => c.path === "post1", { status: 200, body: { reactions: { summary: { total_count: 7 } }, shares: { count: 2 } } });
    expect(await meta.fetchPostMetrics("facebook", "post1", TOKEN)).toEqual({ likes: 7, comments: 0, shares: 2, reach: 0, saves: 0 });
    fake.when(() => true, FakeGraph.error("gone", 100, {}, 404), true);
    expect(await meta.fetchPostMetrics("facebook", "post1", TOKEN)).toBeNull();
  });

  test("Instagram numbers: reach and saves are optional, likes and comments still count", async () => {
    fake.when((c) => c.path === "media1", { status: 200, body: { like_count: 5, comments_count: 3 } });
    fake.when((c) => c.path === "media1/insights", FakeGraph.error("(#10) not enough viewers", 10));
    expect(await meta.fetchPostMetrics("instagram", "media1", TOKEN)).toEqual({ likes: 5, comments: 3, shares: 0, reach: 0, saves: 0 });
  });

  test("sign-in: the login code becomes a long-lived key and the list of Pages with their Instagram accounts", async () => {
    fake.when((c) => c.path === "oauth/access_token" && c.params.code === "CODE", { status: 200, body: { access_token: "short" } });
    fake.when((c) => c.path === "oauth/access_token" && c.params.grant_type === "fb_exchange_token", { status: 200, body: { access_token: "long" } });
    fake.when(
      (c) => c.path === "me/accounts",
      { status: 200, body: { data: [{ id: "p1", name: "School", access_token: "pt1", instagram_business_account: { id: "ig1", username: "school_ig" } }, { id: "p2", name: "Other", access_token: "pt2" }] } },
    );
    const pages = await meta.pagesFromCode("CODE", "https://site.example/api/meta/callback");
    expect(pages).toEqual([
      { id: "p1", name: "School", token: "pt1", ig_user_id: "ig1", ig_username: "school_ig" },
      { id: "p2", name: "Other", token: "pt2", ig_user_id: null, ig_username: null },
    ]);
    expect(fake.calls[1].params).toMatchObject({ fb_exchange_token: "short", client_id: "app-1" });
    expect(fake.calls[2].params.access_token).toBe("long");
  });

  test("sign-in with a wrong or used code fails with Meta's message", async () => {
    fake.when(() => true, FakeGraph.error("This authorization code has been used.", 100));
    await expect(meta.pagesFromCode("USED", "https://site.example/api/meta/callback")).rejects.toThrow(/authorization code has been used/);
    expect(fake.calls).toHaveLength(1);
  });
});
