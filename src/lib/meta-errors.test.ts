// Run with: npm test (release 0.17, real posting)
import assert from "node:assert/strict";
import { test } from "node:test";
import { abilities, fitsInstagram, instagramProblems, nextRetry, reasonOf } from "./meta-errors.ts";

test("Meta errors are sorted into what they mean for the school", () => {
  // The key stopped working: password changed, app removed, session expired, permission gone.
  assert.equal(reasonOf({ code: 190, subcode: 460, message: "Error validating access token: The session has been invalidated" }), "reconnect");
  assert.equal(reasonOf({ code: 190, message: "Error validating access token: Session has expired" }), "reconnect");
  assert.equal(reasonOf({ code: 200, message: "(#200) Requires pages_manage_posts permission" }), "reconnect");
  assert.equal(reasonOf({ code: 10, message: "(#10) Application does not have permission for this action" }), "reconnect");
  // Busy or limited for a while: tried again later.
  assert.equal(reasonOf({ code: 4, message: "(#4) Application request limit reached" }), "busy");
  assert.equal(reasonOf({ code: 32, message: "Page request limit reached" }), "busy");
  assert.equal(reasonOf({ code: 2, message: "An unexpected error has occurred. Please retry your request later." }), "busy");
  assert.equal(reasonOf({ code: 1, message: "An unknown error occurred" }), "busy");
  assert.equal(reasonOf({ code: 100, transient: true, message: "Temporary problem" }), "busy");
  assert.equal(reasonOf({ status: 503, message: "Service unavailable" }), "busy");
  assert.equal(reasonOf({ code: 9007, subcode: 2207001, message: "Server error" }), "busy");
  // The post itself is refused: no point trying again unchanged.
  assert.equal(reasonOf({ code: 36003, message: "(#36003) The aspect ratio is not supported" }), "photo");
  assert.equal(reasonOf({ code: 9004, message: "(#9004) The photo link could not be downloaded" }), "photo");
  assert.equal(reasonOf({ code: 100, subcode: 2207009, message: "The submitted image with aspect ratio ('0.56') cannot be published" }), "photo");
  assert.equal(reasonOf({ code: 100, subcode: 2207010, message: "The caption is too long" }), "caption");
  assert.equal(reasonOf({ code: 9, subcode: 2207042, message: "You reached the maximum number of posts allowed" }), "daily_limit");
  assert.equal(reasonOf({ code: 506, message: "(#506) Duplicate status message" }), "duplicate");
  assert.equal(reasonOf({ code: 100, message: "(#100) Invalid parameter" }), "other");
});

test("busy Meta is tried again after 5, 15 and 45 minutes, then the post fails", () => {
  const now = new Date("2026-12-01T09:00:00Z");
  assert.equal(nextRetry(1, now)?.toISOString(), "2026-12-01T09:05:00.000Z");
  assert.equal(nextRetry(2, now)?.toISOString(), "2026-12-01T09:15:00.000Z");
  assert.equal(nextRetry(3, now)?.toISOString(), "2026-12-01T09:45:00.000Z");
  assert.equal(nextRetry(4, now), null);
});

test("Check connection turns Meta permissions into plain abilities", () => {
  const all = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "pages_manage_engagement", "pages_read_user_content", "instagram_manage_comments", "read_insights", "instagram_manage_insights", "pages_messaging", "instagram_manage_messages"];
  assert.ok(abilities(all).every((a) => a.ok));
  const noMessages = abilities(all.filter((p) => !p.includes("messag")));
  assert.deepEqual(noMessages.filter((a) => !a.ok).map((a) => a.key), ["messages"]);
  assert.deepEqual(noMessages.find((a) => a.key === "messages")?.missing, ["pages_messaging", "instagram_manage_messages"]);
  assert.ok(abilities([]).every((a) => !a.ok));
});

test("Instagram rules are checked again just before posting", () => {
  assert.deepEqual(instagramProblems("يوم رائع #مدرستنا", 2), []);
  assert.deepEqual(instagramProblems("text", 0), ["no_photo"]);
  assert.deepEqual(instagramProblems("text", 21), ["too_many_photos"]);
  assert.deepEqual(instagramProblems("ب".repeat(2201), 1), ["caption_long"]);
  assert.deepEqual(instagramProblems("ب".repeat(2200), 1), []);
  assert.deepEqual(instagramProblems(Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" "), 1), ["too_many_hashtags"]);
  assert.deepEqual(instagramProblems(Array.from({ length: 30 }, (_, i) => `#وسم${i}`).join(" "), 1), []);
  assert.deepEqual(instagramProblems(Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" "), 1), ["too_many_mentions"]);
  // Shapes: 4:5 to 1.91:1.
  assert.ok(fitsInstagram(1080, 1350));
  assert.ok(fitsInstagram(1080, 1080));
  assert.ok(fitsInstagram(1910, 1000));
  assert.ok(!fitsInstagram(1080, 1920));
  assert.ok(!fitsInstagram(3000, 1000));
  assert.ok(fitsInstagram(0, 0));
});
