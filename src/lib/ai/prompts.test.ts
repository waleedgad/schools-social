import assert from "node:assert/strict";
import { test } from "node:test";
import { captionPrompt, rewritePrompt, translatePrompt } from "./prompts.ts";
import type { CaptionRequest } from "./types.ts";

const base: CaptionRequest = {
  schoolName: "Al Nour School",
  brandVoice: null,
  profile: { tone: "warm and proud", dialect: "msa", emoji: "few", signoff: "معًا نصنع الفرق", avoidWords: "cheap" },
  hashtags: "#AlNourSchool",
  languages: "ar_en",
  eventTitle: "Sports Day",
  eventDate: "2026-11-12",
  className: "Grade 4",
  categoryName: "Sports",
  notes: ["Grade 4B won the relay"],
  photos: [],
};

test("the caption request carries the school's voice, facts, notes and learning", () => {
  const p = captionPrompt({
    ...base,
    avoid: ["cheap", "مجاني"],
    hashtagSets: [{ title: "Sports", tags: "#يوم_رياضي #SportsDay" }],
    learning: { best: ["طلابنا أبطال اليوم"], hints: ["Shorter captions do best."] },
    options: { prompt: "Thank the PE teachers", count: 2, tone: "proud" },
  });
  for (const part of ["Al Nour School", "Sports Day", "Grade 4B won the relay", "warm and proud", "معًا نصنع الفرق", "Thank the PE teachers", "مجاني", "#يوم_رياضي #SportsDay", "طلابنا أبطال اليوم", "Shorter captions do best.", "Write 2 caption options", "Tone for this post: proud", "do not repeat them: #AlNourSchool"]) {
    assert.ok(p.includes(part), `missing: ${part}`);
  }
  // The writer's own request comes before the general rules.
  assert.ok(p.indexOf("Thank the PE teachers") < p.indexOf("Arabic rules:"));
});

test("Arabic rules follow the school's choice of Standard or Egyptian Arabic", () => {
  assert.match(captionPrompt(base), /Modern Standard Arabic/);
  assert.match(captionPrompt({ ...base, profile: { dialect: "egyptian" } }), /light Egyptian Arabic/);
  // One language only: the other language's rules are left out.
  const en = captionPrompt({ ...base, languages: "en" });
  assert.ok(!en.includes("Arabic rules:") && en.includes("English rules:"));
  const ar = captionPrompt({ ...base, languages: "ar" });
  assert.ok(ar.includes("Arabic rules:") && !ar.includes("English rules:"));
});

test("emojis and hashtags can be switched off, by the post or by the school", () => {
  assert.match(captionPrompt({ ...base, options: { emoji: false } }), /Emojis: none\./);
  assert.match(captionPrompt({ ...base, profile: { emoji: "none" } }), /Emojis: none\./);
  assert.match(captionPrompt({ ...base, options: { hashtags: false } }), /hashtags: leave empty\./);
});

test("the wording the product never uses is not in what the AI is asked to write", () => {
  for (const p of [captionPrompt(base), rewritePrompt("نص", "shorter", "ar", base.profile), translatePrompt("text", "ar", base.profile)]) {
    assert.ok(!/describe (a|the) child|your child/i.test(p));
    assert.match(p, /Arabic rules:/);
  }
  assert.match(rewritePrompt("Text", "shorter", "en"), /English rules:/);
});
