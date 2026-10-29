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
} from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

function image(jpeg: Uint8Array): Part {
  return { inline_data: { mime_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } };
}

const STR = { type: "STRING" };

// The school's voice, as instructions every caption follows.
export function voiceText(profile: SchoolProfile | null | undefined, brandVoice?: string | null) {
  if (!profile && !brandVoice) return "";
  const p = profile ?? {};
  return [
    brandVoice && `How the school sounds: ${brandVoice}`,
    p.tone && `Tone: ${p.tone}`,
    p.audience && `Audience: ${p.audience}`,
    p.dialect && `Arabic style: ${p.dialect === "egyptian" ? "friendly Egyptian Arabic" : "clear Modern Standard Arabic"}`,
    p.emoji && `Emojis: ${{ none: "none", few: "at most two", many: "several are fine" }[p.emoji]}`,
    p.useWords && `Words and values the school likes to use: ${p.useWords}`,
    p.avoidWords && `Never use these words: ${p.avoidWords}`,
    p.signoff && `End with the school's sign-off: ${p.signoff}`,
    p.motto && `Motto: ${p.motto}`,
    p.learnt && `Learnt from the school's own edits and best posts: ${p.learnt}`,
    p.examples?.length && `Examples of captions the school liked:\n- ${p.examples.slice(0, 5).join("\n- ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export class GeminiProvider implements AiProvider {
  name = "gemini";

  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private async generate<T>(parts: Part[], schema: object, temperature: number): Promise<T> {
    const res = await fetch(`${ENDPOINT}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (res.status === 429) throw new AiLimitError("Gemini rate limit");
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return JSON.parse(text) as T;
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
    const facts = [
      `School: ${req.schoolName}`,
      req.eventTitle && `Event: ${req.eventTitle}`,
      req.eventDate && `Date: ${req.eventDate}`,
      req.className && `Class or grade: ${req.className}`,
      req.categoryName && `Post category: ${req.categoryName}`,
      req.notes.length > 0 && `Notes from staff: ${req.notes.join(" | ")}`,
      req.hashtags && `Hashtags the school always uses: ${req.hashtags}`,
      o.prompt && `What this post should say: ${o.prompt}`,
    ].filter(Boolean);
    const languages = { ar: "Arabic only (leave en empty)", en: "English only (leave ar empty)", ar_en: "both Arabic and English" }[req.languages];
    const parts: Part[] = [
      {
        text:
          `Write ${count} different caption options for a private school in Egypt, for its Facebook page and Instagram. ` +
          `Write each in ${languages}. Arabic is warm and suitable for parents; the English is natural, not a word-for-word translation. ` +
          `${o.words ? `About ${o.words} words each.` : "Two to four short sentences."} ` +
          `${o.tone ? `Tone: ${o.tone}.` : ""} ` +
          `${o.emoji === false ? "No emojis." : "At most two emojis."} ` +
          "Celebrate the students' effort and learning. Describe the activity, never name or describe an individual student, never guess names, never mention anything you can't see or read in the facts. " +
          `${o.hashtags === false ? "Return an empty hashtags line." : "Return 3 to 6 hashtags (including the school's own) in one line."} ` +
          `${o.splitInstagram ? "Also write 'ig': a shorter Instagram version (one or two lines, in the main language) that ends with the hashtags." : "Leave 'ig' empty."} ` +
          "Also write alt text for blind users describing the first photo, one sentence each in Arabic (altAr) and English (altEn), no names.\n\n" +
          [voiceText(req.profile, req.brandVoice), ...facts].filter(Boolean).join("\n"),
      },
      ...req.photos.slice(0, 4).map(image),
    ];
    const schema = {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { ar: STR, en: STR, hashtags: STR, ig: STR, altAr: STR, altEn: STR }, required: ["ar", "en", "hashtags", "ig", "altAr", "altEn"] },
    };
    const out = await this.generate<Captions[]>(parts, schema, 0.8);
    return out.slice(0, count).map((c) => ({
      ar: req.languages === "en" ? "" : String(c.ar ?? "").slice(0, 2000),
      en: req.languages === "ar" ? "" : String(c.en ?? "").slice(0, 2000),
      hashtags: String(c.hashtags ?? "").slice(0, 300),
      ig: String(c.ig ?? "").slice(0, 2000),
      altAr: String(c.altAr ?? "").slice(0, 400),
      altEn: String(c.altEn ?? "").slice(0, 400),
    }));
  }

  async rewrite(text: string, instruction: string, language: "ar" | "en"): Promise<string> {
    const out = await this.generate<{ text: string }>(
      [{ text: `Rewrite this school social media caption (${language === "ar" ? "Arabic" : "English"}). Instruction: ${instruction}. Keep it in the same language, keep any hashtags, never add student names.\n\n${text}` }],
      { type: "OBJECT", properties: { text: STR }, required: ["text"] },
      0.6,
    );
    return String(out.text ?? "").slice(0, 2200);
  }

  async translate(text: string, to: "ar" | "en", profile?: SchoolProfile | null): Promise<string> {
    const out = await this.generate<{ text: string }>(
      [
        {
          text:
            `Write the ${to === "ar" ? "Arabic" : "English"} version of this school caption. Natural, not word for word, same meaning and length, no hashtags. ` +
            `${voiceText(profile)}\n\n${text}`,
        },
      ],
      { type: "OBJECT", properties: { text: STR }, required: ["text"] },
      0.4,
    );
    return String(out.text ?? "").slice(0, 2200);
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
