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
