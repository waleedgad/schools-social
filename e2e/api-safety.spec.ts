import { expect, test } from "@playwright/test";

// Security (quality plan, Phase 3): every web address the Mac app, Facebook,
// WhatsApp and Google/Microsoft call refuses strangers and nonsense calmly:
// no data, no crash (a crash is a 500 and can show inner workings).
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const JUNK = ['{"call":"__proto__","args":[{"constructor":{"prototype":{"x":1}}}]}', "not json at all", "x".repeat(200_000), "[]", "null"];

test("the Mac app's address refuses anyone without a valid sign-in", async ({ request }) => {
  for (const auth of [undefined, "Bearer ", "Bearer not-a-real-token", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x"]) {
    for (const body of JUNK) {
      const r = await request.post("/api/app", { headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, data: body, maxRedirects: 0 });
      expect(r.status(), `${auth} ${body.slice(0, 30)}`).toBeGreaterThanOrEqual(400);
      expect(r.status(), `${auth} ${body.slice(0, 30)}`).toBeLessThan(500);
      const text = await r.text();
      expect(text).not.toMatch(/student|photo_url|service_role|stack|at \w+ \(/i);
    }
  }
});

test("webhooks and sign-in returns refuse fakes without crashing", async ({ request }) => {
  const calls: [string, string, string?][] = [
    ["POST", "/api/whatsapp", '{"entry":[{"changes":[{"value":{"messages":[{"from":"1","id":"x","type":"image"}]}}]}]}'],
    ["POST", "/api/whatsapp", "garbage"],
    ["GET", "/api/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=hello"],
    ["GET", "/api/meta/connect"],
    ["GET", "/api/meta/callback?code=fake&state=fake"],
    ["GET", "/api/meta/callback?error=access_denied"],
    ["GET", "/api/meta/callback"],
    ["GET", "/api/class-lists/start?provider=google"],
    ["GET", "/api/class-lists/start?provider=../../etc"],
    ["GET", "/api/class-lists/callback?code=fake&state=fake"],
    ["GET", "/api/class-lists/callback"],
    ["GET", "/api/class-lists/file"],
    ["GET", "/api/analytics"],
    ["GET", "/api/analytics?school=00000000-0000-0000-0000-000000000000"],
  ];
  for (const [method, url, body] of calls) {
    const r = await request.fetch(url, { method, data: body, headers: body ? { "content-type": "application/json" } : {}, maxRedirects: 0 });
    const s = r.status();
    expect(s, `${method} ${url}`).not.toBeGreaterThanOrEqual(500);
    // A stranger gets "no", or is sent to the sign-in page; never data.
    if (s === 200) {
      const text = await r.text();
      expect(text, `${method} ${url}`).not.toMatch(/access_token|refresh_token|service_role|"students"|"photos"/i);
      // The WhatsApp check must not echo the challenge back to a wrong guess.
      if (url.includes("verify_token=guess")) expect(text).not.toBe("hello");
    }
    if (s >= 300 && s < 400) expect(r.headers()["location"] ?? "", `${method} ${url}`).not.toMatch(/^https?:\/\/(?!localhost|127\.0\.0\.1|www\.facebook\.com|accounts\.google\.com|login\.microsoftonline\.com)/);
  }
});

test("the app's settings address shares nothing secret", async ({ request }) => {
  const r = await request.get("/api/desktop-config");
  expect(r.status()).toBe(200);
  const text = await r.text();
  expect(text).not.toMatch(/service_role|SERVICE_ROLE|secret|GEMINI|sk-|eyJhbGciOi[^"]*\.eyJ[^"]*role":"service/i);
});
