import { AiLimitError, PHOTO_ISSUES, type AiProvider, type CaptionRequest, type Captions, type PhotoInput, type PhotoVerdict, type PhotoIssue } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

function image(jpeg: Uint8Array): Part {
  return { inline_data: { mime_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } };
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
          "sharp focus, good light, faces visible and happy, clear story, children shown respectfully. " +
          "Give near-duplicates lower scores than the best of their group. " +
          `List issues using only these words: ${PHOTO_ISSUES.join(", ")}. ` +
          "Use 'sensitive' for anything a school should not post: a child upset, hurt, in swimwear or changing, " +
          "a readable name badge, document or screen with personal data. " +
          "The reason is one short English sentence.",
      },
      ...photos.map((p) => image(p.jpeg)),
    ];
    const schema = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          score: { type: "INTEGER" },
          reason: { type: "STRING" },
          issues: { type: "ARRAY", items: { type: "STRING", enum: [...PHOTO_ISSUES] } },
        },
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

  async writeCaptions(req: CaptionRequest): Promise<Captions> {
    const facts = [
      `School: ${req.schoolName}`,
      req.eventTitle && `Event: ${req.eventTitle}`,
      req.eventDate && `Date: ${req.eventDate}`,
      req.className && `Class or grade: ${req.className}`,
      req.notes.length > 0 && `Notes from staff: ${req.notes.join(" | ")}`,
      req.brandVoice && `The school's voice: ${req.brandVoice}`,
      req.hashtags && `Hashtags the school always uses: ${req.hashtags}`,
    ].filter(Boolean);
    const languages = { ar: "Arabic only (leave en empty)", en: "English only (leave ar empty)", ar_en: "both Arabic and English" }[req.languages];
    const parts: Part[] = [
      {
        text:
          "Write a social media caption for a private school in Egypt, for its Facebook page and Instagram. " +
          `Write it in ${languages}. Arabic is clear Modern Standard Arabic, warm and suitable for parents; ` +
          "the English is natural, not a word-for-word translation. " +
          "Two to four short sentences, at most two emojis, celebrate the students' effort and learning. " +
          "Never name or describe an individual child, never guess names, never mention anything you can't see or read in the facts. " +
          "Return 3 to 6 hashtags (including the school's own) in one line.\n\n" +
          facts.join("\n"),
      },
      ...req.photos.slice(0, 4).map(image),
    ];
    const schema = {
      type: "OBJECT",
      properties: { ar: { type: "STRING" }, en: { type: "STRING" }, hashtags: { type: "STRING" } },
      required: ["ar", "en", "hashtags"],
    };
    const out = await this.generate<Captions>(parts, schema, 0.7);
    return {
      ar: req.languages === "en" ? "" : String(out.ar ?? "").slice(0, 2000),
      en: req.languages === "ar" ? "" : String(out.en ?? "").slice(0, 2000),
      hashtags: String(out.hashtags ?? "").slice(0, 300),
    };
  }
}
