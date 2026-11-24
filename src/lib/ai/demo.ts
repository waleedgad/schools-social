import type {
  AiProvider,
  BookPageInput,
  BookPageText,
  CaptionCheck,
  CaptionRequest,
  Captions,
  PhotoDescription,
  PhotoInput,
  PhotoVerdict,
  PlannedPost,
  ProfileDraft,
  SchoolProfile,
} from "./types.ts";
import { finishCaptions } from "../captions.ts";

// Used when no AI key is set, so every screen can still be tried out.
// Scores come from file size (busier, sharper photos compress less), which
// is a rough stand-in, and captions are fill-in-the-blank templates.
export class DemoProvider implements AiProvider {
  name = "demo";

  async rankPhotos(photos: PhotoInput[]): Promise<PhotoVerdict[]> {
    const sizes = photos.map((p) => p.jpeg.byteLength);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    return photos.map((p) => ({
      id: p.id,
      score: max === min ? 6 : Math.round(3 + (6 * (p.jpeg.byteLength - min)) / (max - min)),
      reason: "Sample score: add an AI key in settings for real picks.",
      issues: [],
    }));
  }

  async writeCaptions(req: CaptionRequest): Promise<Captions[]> {
    const event = req.eventTitle ?? "يوم مميز";
    const eventEn = req.eventTitle ?? "a special day";
    const tag = `#${req.schoolName.replace(/\s+/g, "")}`;
    const emoji = req.options?.emoji === false ? "" : " ✨";
    const who = req.className ? [` مع ${req.className}`, ` with ${req.className}`] : ["", ""];
    const openers = [
      [`لحظات جميلة من ${event}${who[0]} في ${req.schoolName}. فخورون بطلابنا وبكل ما يتعلمونه${emoji}`, `Lovely moments from ${eventEn}${who[1]} at ${req.schoolName}. Proud of our students and everything they are learning${emoji}`],
      [`يوم رائع قضاه طلابنا في ${event}${who[0]}، تعلّموا فيه وشاركوا بحماس${emoji}`, `A wonderful day for our students at ${eventEn}${who[1]}: they learned, joined in and enjoyed every part${emoji}`],
      [`شكرًا لكل من شارك في ${event}${who[0]}، ولأولياء الأمور على دعمهم الدائم${emoji}`, `Thank you to everyone who took part in ${eventEn}${who[1]}, and to our parents for their support${emoji}`],
      [`ذكريات نعتز بها من ${event}${who[0]} في ${req.schoolName}${emoji}`, `Memories to keep from ${eventEn}${who[1]} at ${req.schoolName}${emoji}`],
      [`طلابنا في ${event}${who[0]}: اجتهاد وتعاون نفخر به${emoji}`, `Our students at ${eventEn}${who[1]}: effort and teamwork we are proud of${emoji}`],
    ];
    const versions = openers.slice(0, req.options?.count ?? 3).map(([ar, en]) => ({
      ar,
      en,
      hashtags: tag,
      ig: req.options?.splitInstagram ? en : "",
      altAr: `طلاب يشاركون في ${event}.`,
      altEn: `Students taking part in ${eventEn}.`,
    }));
    // Sample captions go through the same finishing as real ones.
    return finishCaptions(versions, { languages: req.languages, fixedHashtags: req.hashtags, hashtags: req.options?.hashtags, emoji: req.options?.emoji === false ? false : undefined, avoid: req.avoid });
  }

  async rewrite(text: string, instruction: string): Promise<string> {
    return `${text}${instruction.includes("emoji") ? " 🎉" : ""}`;
  }

  async translate(text: string, to: "ar" | "en"): Promise<string> {
    return to === "ar" ? `(ترجمة تجريبية) ${text}` : `(sample translation) ${text}`;
  }

  async checkCaption(text: string, _profile: SchoolProfile | null, avoid: string[]): Promise<CaptionCheck> {
    const found = avoid.filter((w) => w && text.toLowerCase().includes(w.toLowerCase()));
    return { score: found.length ? 55 : 80, notes: found.length ? [`Remove: ${found.join(", ")}`] : ["Sample check: add the AI key for a real one."], spelling: [] };
  }

  async buildProfile(schoolName: string): Promise<ProfileDraft> {
    return {
      name: schoolName,
      tone: "warm, proud, welcoming",
      audience: "parents and families thinking of joining",
      dialect: "msa",
      emoji: "few",
      useWords: "learning, community, respect",
      categories: [],
    };
  }

  async planPosts(input: { days: number; categories: string[] }): Promise<PlannedPost[]> {
    const ideas = ["Celebrate a class activity", "Show learning in class", "Thank a teacher", "Share student work", "Remind families of a date"];
    const out: PlannedPost[] = [];
    for (let d = 0; d < input.days; d++) {
      const dow = (new Date().getDay() + d) % 7;
      if (dow === 5 || dow === 6) continue;
      out.push({ day: d, title: ideas[d % ideas.length], idea: "Sample idea: add the AI key for a real plan.", category: input.categories[d % Math.max(1, input.categories.length)] ?? "" });
    }
    return out;
  }

  async describePhotos(photos: PhotoInput[]): Promise<PhotoDescription[]> {
    return photos.map((p) => ({ id: p.id, altAr: "طلاب في نشاط مدرسي.", altEn: "Students during a school activity.", topic: "other" }));
  }

  async suggestReplies(comment: string): Promise<string[]> {
    const arabic = /[\u0600-\u06FF]/.test(comment);
    return arabic
      ? ["شكراً جزيلاً لكلماتكم الطيبة! 💙", "سعداء بمتابعتكم، شكراً لكم.", "للاستفسار يرجى التواصل معنا برسالة خاصة."]
      : ["Thank you so much for your kind words! 💙", "We're glad you enjoyed it, thank you.", "Please send us a private message and we'll be happy to help."];
  }

  async bookTexts(input: { pages: BookPageInput[] }): Promise<BookPageText[]> {
    return input.pages.map((p) => ({ titleAr: p.title, titleEn: p.title, textAr: "صفحة تجريبية: أضف مفتاح الذكاء الاصطناعي لنص حقيقي.", textEn: "Sample text: add the AI key for real page texts." }));
  }
}
