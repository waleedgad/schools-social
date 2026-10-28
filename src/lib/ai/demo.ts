import type {
  AiProvider,
  CaptionCheck,
  CaptionRequest,
  Captions,
  PhotoDescription,
  PhotoInput,
  PhotoVerdict,
  PlannedPost,
  ProfileDraft,
  SchoolProfile,
} from "./types";

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
    const hashtags = req.options?.hashtags === false ? "" : [req.hashtags, tag].filter(Boolean).join(" ");
    const emoji = req.options?.emoji === false ? "" : " ✨";
    const openers = [
      ["لحظات جميلة من", "Lovely moments from"],
      ["يوم رائع في", "A wonderful day of"],
      ["فخورون بطلابنا في", "So proud of our students at"],
    ];
    return openers.slice(0, req.options?.count ?? 3).map(([ar, en]) => ({
      ar: req.languages === "en" ? "" : `${ar} ${event}${req.className ? ` مع ${req.className}` : ""} في ${req.schoolName}. فخورون بكل ما يتعلمونه${emoji}`,
      en: req.languages === "ar" ? "" : `${en} ${eventEn}${req.className ? ` with ${req.className}` : ""} at ${req.schoolName}. Proud of everything they are learning${emoji}`,
      hashtags,
      ig: req.options?.splitInstagram ? `${en} ${eventEn}${emoji} ${hashtags}`.trim() : "",
      altAr: `طلاب يشاركون في ${event}.`,
      altEn: `Students taking part in ${eventEn}.`,
    }));
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
}
