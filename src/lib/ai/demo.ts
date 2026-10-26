import type { AiProvider, CaptionRequest, Captions, PhotoInput, PhotoVerdict } from "./types";

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

  async writeCaptions(req: CaptionRequest): Promise<Captions> {
    const event = req.eventTitle ?? "يوم مميز";
    const eventEn = req.eventTitle ?? "a special day";
    const tag = `#${req.schoolName.replace(/\s+/g, "")}`;
    return {
      ar: req.languages === "en" ? "" : `لحظات جميلة من ${event}${req.className ? ` مع ${req.className}` : ""} في ${req.schoolName}. فخورون بطلابنا وبكل ما يتعلمونه ✨`,
      en: req.languages === "ar" ? "" : `Lovely moments from ${eventEn}${req.className ? ` with ${req.className}` : ""} at ${req.schoolName}. Proud of our students and everything they are learning ✨`,
      hashtags: [req.hashtags, tag].filter(Boolean).join(" "),
    };
  }
}
