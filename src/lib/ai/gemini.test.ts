import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GeminiProvider } from "./gemini.ts";
import { AiLimitError, type CaptionRequest } from "./types.ts";

// A pretend Gemini: each call takes the next answer from the list.
const realFetch = globalThis.fetch;
let calls: { model: string; prompt: string }[] = [];
function pretend(answers: (number | object | string)[]) {
  calls = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ model: String(url).split("/models/")[1].split(":")[0], prompt: JSON.parse(init.body).contents[0].parts[0].text });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (typeof a === "number") return new Response("busy", { status: a });
    const text = typeof a === "string" ? a : JSON.stringify(a);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

const req: CaptionRequest = { schoolName: "Al Nour", brandVoice: null, profile: {}, hashtags: "#AlNour", languages: "ar_en", eventTitle: "Sports Day", eventDate: null, className: null, notes: [], photos: [] };
const good = [{ ar: "طلابنا في يوم رياضي رائع , شكرًا لكم #يوم_رياضي", en: "A great sports day for our students", hashtags: "#SportsDay", ig: "", altAr: "", altEn: "" }];
const ai = () => new GeminiProvider("key", "main-model", "light-model", 1);

test("captions come back finished: Arabic punctuation and the school's hashtags first", async () => {
  pretend([good]);
  const out = await ai().writeCaptions(req);
  assert.equal(out[0].ar, "طلابنا في يوم رياضي رائع، شكرًا لكم");
  assert.equal(out[0].hashtags, "#AlNour #SportsDay #يوم_رياضي");
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Arabic rules:/);
});

test("a busy answer is tried again, then the lighter model is used", async () => {
  pretend([429, 503, good]);
  const out = await ai().writeCaptions(req);
  assert.equal(out.length, 1);
  assert.deepEqual(calls.map((c) => c.model), ["main-model", "main-model", "light-model"]);
});

test("a broken answer is asked for again", async () => {
  pretend(['[{"ar": "نص مقطو', good]);
  assert.equal((await ai().writeCaptions(req)).length, 1);
  assert.equal(calls.length, 2);
});

test("when the free limit is really used up the writer is told to wait", async () => {
  pretend([429]);
  await assert.rejects(ai().writeCaptions(req), AiLimitError);
  assert.equal(calls.length, 4);
});

test("a wrong key is not retried", async () => {
  pretend([400]);
  await assert.rejects(ai().writeCaptions(req), /Gemini 400/);
  assert.equal(calls.length, 1);
});

test("rewrite and translate use the school's voice and tidy the Arabic", async () => {
  pretend([{ text: "شكرًا لكم , نراكم قريبًا" }]);
  assert.equal(await ai().rewrite("شكرا", "warmer", "ar", { signoff: "معًا دائمًا" }), "شكرًا لكم، نراكم قريبًا");
  assert.match(calls[0].prompt, /معًا دائمًا/);
  pretend([{ text: "Thank you ." }]);
  assert.equal(await ai().translate("شكرًا", "en", null), "Thank you.");
});

// 0.16: everything else the AI writes follows the caption rules too.
test("reply ideas follow the school's rules: children become students, a banned word drops the idea", async () => {
  pretend([{ replies: ["شكرًا لكم , أطفالنا فخورون بكم", "Thank you! Our kids loved it", "عرض رخيص جدًا", "نسعد بتواصلكم"] }]);
  const out = await ai().suggestReplies("ما شاء الله", "يوم رياضي", { dialect: "egyptian" }, ["رخيص"]);
  assert.deepEqual(out, ["شكرًا لكم، طلابنا فخورون بكم", "Thank you! Our students loved it", "نسعد بتواصلكم"]);
  for (const part of ["Arabic rules:", "light Egyptian", "English rules:", "رخيص", "أطفال"]) assert.ok(calls[0].prompt.includes(part), `missing: ${part}`);
});

test("yearbook texts are Standard Arabic, swap the words for children, and leave a banned text empty", async () => {
  pretend([[
    { index: 0, titleAr: "براعمنا في الروضة", titleEn: "Our little ones", textAr: "عام جميل لأطفال الروضة , مع معلماتهم", textEn: "A great year for the children of KG." },
    { index: 1, titleAr: "رحلة", titleEn: "Trip", textAr: "رحلة بسعر رخيص", textEn: "A cheap trip" },
  ]]);
  const out = await ai().bookTexts({ schoolName: "Al Nour", year: "2026-2027", book: "KG yearbook", pages: [{ kind: "class", title: "KG2 A" }, { kind: "event", title: "Trip" }], profile: { dialect: "egyptian" }, avoid: ["cheap", "رخيص"] });
  assert.deepEqual(out[0], { titleAr: "طلابنا في الروضة", titleEn: "Our students", textAr: "عام جميل لطلاب الروضة، مع معلماتهم", textEn: "A great year for the students of KG." });
  assert.equal(out[1].textEn, "");
  assert.equal(out[1].textAr, "");
  assert.equal(out[1].titleEn, "Trip");
  assert.match(calls[0].prompt, /Modern Standard Arabic/);
  assert.doesNotMatch(calls[0].prompt, /light Egyptian/);
});

test("Make a week ideas say students, never children", async () => {
  pretend([[{ day: 0, title: "Kids' art corner", idea: "Show the children painting", category: "Art" }, { day: 9, title: "Too late", idea: "x", category: "Art" }]]);
  const out = await ai().planPosts({ schoolName: "Al Nour", days: 7, events: [], categories: ["Art"], profile: null });
  assert.deepEqual(out, [{ day: 0, title: "Students' art corner", idea: "Show the students painting", category: "Art" }]);
  assert.match(calls[0].prompt, /never "kids" or "children"/);
});

test("the caption check finds a banned word itself and marks it down", async () => {
  pretend([{ score: 95, notes: ["Nice and warm."], spelling: [] }]);
  const out = await ai().checkCaption("أطفالنا في يوم رياضي رائع", { dialect: "msa" }, ["رخيص"]);
  assert.equal(out.score, 60);
  assert.match(out.notes[0], /أطفال/);
  for (const part of ["Arabic rules:", "English rules:", "رخيص", "طلابنا"]) assert.ok(calls[0].prompt.includes(part), `missing: ${part}`);
});
