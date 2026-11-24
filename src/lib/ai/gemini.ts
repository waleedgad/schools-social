import {
  AiLimitError,
  PHOTO_ISSUES,
  TOPICS,
  type AiProvider,
  type BookPageInput,
  type BookPageText,
  type CaptionCheck,
  type CaptionRequest,
  type Captions,
  type PhotoDescription,
  type PhotoInput,
  type PhotoIssue,
  type PhotoVerdict,
  type PlannedPost,
  type ProfileDraft,
  type SchoolProfile,
  type Topic,
} from "./types.ts";
import { captionPrompt, rewritePrompt, translatePrompt, voiceText } from "./prompts.ts";
import { finishCaptions, tidyArabic, tidyEnglish } from "../captions.ts";

export { voiceText };

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

function image(jpeg: Uint8Array): Part {
  return { inline_data: { mime_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } };
}

const STR = { type: "STRING" };

class RetryError extends Error {
  limit: boolean;
  constructor(message: string, limit = false) {
    super(message);
    this.limit = limit;
  }
}

export class GeminiProvider implements AiProvider {
  name = "gemini";

  private apiKey: string;
  private model: string;
  private fallback: string;
  private waitMs: number;

  constructor(apiKey: string, model: string, fallback = "gemini-2.5-flash-lite", waitMs = 1500) {
    this.apiKey = apiKey;
    this.model = model;
    this.fallback = fallback;
    this.waitMs = waitMs;
  }

  // One request. The free tier answers "too many requests" or "busy" often,
  // so each model gets a second try after a short wait, and then a lighter
  // model is tried before the writer is told to wait.
  private async generate<T>(parts: Part[], schema: object, temperature: number): Promise<T> {
    const models = [...new Set([this.model, this.fallback].filter(Boolean))];
    let last: Error = new Error("Gemini: no answer");
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, this.waitMs));
        try {
          return await this.ask<T>(model, parts, schema, temperature);
        } catch (e) {
          last = e as Error;
          if (!(e instanceof RetryError)) throw e;
        }
      }
    }
    throw last instanceof RetryError && last.limit ? new AiLimitError("Gemini rate limit") : new Error(last.message);
  }

  private async ask<T>(model: string, parts: Part[], schema: object, temperature: number): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      throw new RetryError(`Gemini unreachable: ${(e as Error).message}`);
    }
    if (res.status === 429) throw new RetryError("Gemini rate limit", true);
    if (res.status >= 500) throw new RetryError(`Gemini ${res.status}`);
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    // An empty or cut-off answer (a safety block, or the model ran out of room) is worth one more try.
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RetryError(`Gemini gave no usable answer (${body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? "empty"})`);
    }
  }

  async rankPhotos(photos: PhotoInput[], context: string): Promise<PhotoVerdict[]> {
    const parts: Part[] = [
      {
        text:
          "You help a school's social media team choose photos to post. " +
          `Event: ${context || "school activity"}. ` +
          `There are ${photos.length} photos, numbered from 0 in the order given. ` +
          "Score each from 1 (do not post) to 10 (best of the set) for a school Facebook and Instagram page: " +
          "sharp focus, good light, students smiling and looking engaged, real action, good framing, clear story, students shown respectfully. " +
          "Give near-duplicates lower scores than the best of their group. " +
          `List issues using only these words: ${PHOTO_ISSUES.join(", ")}. ` +
          "Use 'sensitive' for anything a school should not post: a student upset, hurt, in swimwear or changing, " +
          "a readable name badge, document or screen with personal data. 'phone_in_hand' when someone holds a phone in a way that looks bad. " +
          "The reason is one short English sentence.",
      },
      ...photos.map((p) => image(p.jpeg)),
    ];
    const schema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { index: { type: "INTEGER" }, score: { type: "INTEGER" }, reason: STR, issues: { type: "ARRAY", items: { type: "STRING", enum: [...PHOTO_ISSUES] } } },
        required: ["index", "score", "reason", "issues"],
      },
    };
    const rows = await this.generate<{ index: number; score: number; reason: string; issues: string[] }[]>(parts, schema, 0.2);
    return rows
      .filter((r) => photos[r.index])
      .map((r) => ({
        id: photos[r.index].id,
        score: Math.min(10, Math.max(1, Math.round(r.score))),
        reason: String(r.reason).slice(0, 300),
        issues: r.issues.filter((i): i is PhotoIssue => (PHOTO_ISSUES as readonly string[]).includes(i)),
      }));
  }

  async writeCaptions(req: CaptionRequest): Promise<Captions[]> {
    const o = req.options ?? {};
    const count = Math.min(5, Math.max(1, o.count ?? 3));
    const parts: Part[] = [{ text: captionPrompt(req) }, ...req.photos.slice(0, 4).map(image)];
    const schema = {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { ar: STR, en: STR, hashtags: STR, ig: STR, altAr: STR, altEn: STR }, required: ["ar", "en", "hashtags", "ig", "altAr", "altEn"] },
    };
    const out = await this.generate<Captions[]>(parts, schema, 0.8);
    return finishCaptions(Array.isArray(out) ? out.slice(0, count) : [], {
      languages: req.languages,
      fixedHashtags: req.hashtags,
      hashtags: o.hashtags,
      emoji: o.emoji === false || req.profile?.emoji === "none" ? false : undefined,
      avoid: req.avoid,
    });
  }

  async rewrite(text: string, instruction: string, language: "ar" | "en", profile?: SchoolProfile | null): Promise<string> {
    const out = await this.generate<{ text: string }>([{ text: rewritePrompt(text, instruction, language, profile) }], { type: "OBJECT", properties: { text: STR }, required: ["text"] }, 0.6);
    const done = String(out.text ?? "");
    return (language === "ar" ? tidyArabic(done) : tidyEnglish(done)).slice(0, 2200);
  }

  async translate(text: string, to: "ar" | "en", profile?: SchoolProfile | null): Promise<string> {
    const out = await this.generate<{ text: string }>([{ text: translatePrompt(text, to, profile) }], { type: "OBJECT", properties: { text: STR }, required: ["text"] }, 0.4);
    const done = String(out.text ?? "");
    return (to === "ar" ? tidyArabic(done) : tidyEnglish(done)).slice(0, 2200);
  }

  async checkCaption(text: string, profile: SchoolProfile | null, avoid: string[]): Promise<CaptionCheck> {
    const out = await this.generate<CaptionCheck>(
      [
        {
          text:
            "Check this school social media caption. 1) Spelling and grammar mistakes in Arabic and English (wrong → right). " +
            "2) How well it matches the school's voice, from 0 to 100. 3) Up to three short notes in English on how to make it fit better. " +
            `Words the school never uses: ${avoid.join(", ") || "none"}.\n${voiceText(profile)}\n\nCaption:\n${text}`,
        },
      ],
      {
        type: "OBJECT",
        properties: {
          score: { type: "INTEGER" },
          notes: { type: "ARRAY", items: STR },
          spelling: { type: "ARRAY", items: { type: "OBJECT", properties: { wrong: STR, right: STR }, required: ["wrong", "right"] } },
        },
        required: ["score", "notes", "spelling"],
      },
      0.2,
    );
    return { score: Math.max(0, Math.min(100, Math.round(out.score ?? 0))), notes: (out.notes ?? []).slice(0, 3), spelling: (out.spelling ?? []).slice(0, 10) };
  }

  async buildProfile(schoolName: string, source: string): Promise<ProfileDraft> {
    return this.generate<ProfileDraft>(
      [
        {
          text:
            `Here is text from the website or Facebook page of a private school in Egypt called ${schoolName}. ` +
            "Fill in the school's social media profile: motto, stages (e.g. KG to Grade 12), curriculum, audience, tone of voice (a few words), " +
            "dialect (msa or egyptian, from how it writes in Arabic), emoji (none, few or many), signoff (a short closing line it uses, or empty), " +
            "useWords (values and words it repeats), avoidWords (empty unless obvious), and 6 to 9 content categories for its posts, each with an English name, " +
            "an Arabic name and a one-line description. Also up to 3 examples of captions it wrote, if the text has posts.\n\n" +
            source.slice(0, 20000),
        },
      ],
      {
        type: "OBJECT",
        properties: {
          motto: STR, stages: STR, curriculum: STR, audience: STR, tone: STR,
          dialect: { type: "STRING", enum: ["msa", "egyptian"] },
          emoji: { type: "STRING", enum: ["none", "few", "many"] },
          signoff: STR, useWords: STR, avoidWords: STR,
          examples: { type: "ARRAY", items: STR },
          categories: { type: "ARRAY", items: { type: "OBJECT", properties: { en: STR, ar: STR, description: STR }, required: ["en", "ar", "description"] } },
        },
        required: ["tone", "dialect", "emoji", "categories"],
      },
      0.3,
    );
  }

  async planPosts(input: { schoolName: string; days: number; events: string[]; categories: string[]; profile: SchoolProfile | null }): Promise<PlannedPost[]> {
    const out = await this.generate<PlannedPost[]>(
      [
        {
          text:
            `Plan social media posts for ${input.schoolName}, a private school in Egypt, for the next ${input.days} days (day 0 is today). ` +
            "About one post a day on school days (Sunday to Thursday), fewer at weekends. Balance the categories, never more than two of the same in a row. " +
            "Use the school's real events where they fit. Each post: day number, a short title, a one-sentence idea of what to show and say, and its category (one of the list). " +
            `Categories: ${input.categories.join(", ")}.\nEvents: ${input.events.join(" | ") || "none listed"}.\n${voiceText(input.profile)}`,
        },
      ],
      {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { day: { type: "INTEGER" }, title: STR, idea: STR, category: STR }, required: ["day", "title", "idea", "category"] },
      },
      0.7,
    );
    return out.filter((p) => p.day >= 0 && p.day < input.days).slice(0, input.days * 2);
  }

  async suggestReplies(comment: string, postText: string, profile: SchoolProfile | null): Promise<string[]> {
    const out = await this.generate<{ replies: string[] }>(
      [
        {
          text:
            `Someone commented on a private school's social media post. Suggest 3 short, polite replies from the school, in the language of the comment. ` +
            `Thank praise warmly; for questions about fees, admissions or complaints, invite them to message or call the school instead of answering publicly. Never name students. ` +
            `${voiceText(profile)}\n\nPost: ${postText.slice(0, 600)}\n\nComment: ${comment.slice(0, 600)}`,
        },
      ],
      { type: "OBJECT", properties: { replies: { type: "ARRAY", items: STR } }, required: ["replies"] },
      0.7,
    );
    return (out.replies ?? []).map((r) => String(r).slice(0, 500)).slice(0, 3);
  }

  async bookTexts(input: { schoolName: string; year: string; book: string; pages: BookPageInput[]; profile: SchoolProfile | null }): Promise<BookPageText[]> {
    const list = input.pages.slice(0, 80);
    const out = await this.generate<(BookPageText & { index: number })[]>(
      [
        {
          text:
            `Write page titles and one or two warm sentences for each page of "${input.book}", a school yearbook of ${input.schoolName} (a private school in Egypt) for ${input.year}. ` +
            "Give each page an Arabic and an English title (short, at most 6 words) and an Arabic and an English text (at most 35 words, Modern Standard Arabic). " +
            "Never invent names of people. Keep it positive and suitable for students and parents. " +
            `${voiceText(input.profile)}\n\nPages:\n${list.map((p, i) => `${i}. ${p.kind}: ${p.title}${p.date ? ` (${p.date})` : ""}`).join("\n")}`,
        },
      ],
      {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { index: { type: "INTEGER" }, titleAr: STR, titleEn: STR, textAr: STR, textEn: STR }, required: ["index", "titleAr", "titleEn", "textAr", "textEn"] },
      },
      0.6,
    );
    return list.map((_, i) => {
      const r = out.find((x) => x.index === i);
      return { titleAr: (r?.titleAr ?? "").slice(0, 80), titleEn: (r?.titleEn ?? "").slice(0, 80), textAr: (r?.textAr ?? "").slice(0, 400), textEn: (r?.textEn ?? "").slice(0, 400) };
    });
  }

  async describePhotos(photos: PhotoInput[]): Promise<PhotoDescription[]> {
    const rows = await this.generate<{ index: number; altAr: string; altEn: string; topic: string }[]>(
      [
        {
          text:
            `For each of these ${photos.length} school photos (numbered from 0), write alt text for blind users in Arabic and English (one sentence, no names), ` +
            `and pick the topic from: ${TOPICS.join(", ")}.`,
        },
        ...photos.map((p) => image(p.jpeg)),
      ],
      {
        type: "ARRAY",
        items: { type: "OBJECT", properties: { index: { type: "INTEGER" }, altAr: STR, altEn: STR, topic: { type: "STRING", enum: [...TOPICS] } }, required: ["index", "altAr", "altEn", "topic"] },
      },
      0.2,
    );
    return rows
      .filter((r) => photos[r.index])
      .map((r) => ({
        id: photos[r.index].id,
        altAr: String(r.altAr).slice(0, 400),
        altEn: String(r.altEn).slice(0, 400),
        topic: ((TOPICS as readonly string[]).includes(r.topic) ? r.topic : "other") as Topic,
      }));
  }
}
