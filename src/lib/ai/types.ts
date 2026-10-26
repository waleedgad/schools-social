// The app talks to AI only through this interface, so the provider can be
// swapped (Gemini today, another model later) without touching the screens.

export const PHOTO_ISSUES = [
  "blurry",
  "dark",
  "eyes_closed",
  "cut_off",
  "cluttered",
  "faces_hidden",
  "sensitive",
] as const;
export type PhotoIssue = (typeof PHOTO_ISSUES)[number];

export type PhotoInput = { id: string; jpeg: Uint8Array };
export type PhotoVerdict = { id: string; score: number; reason: string; issues: PhotoIssue[] };

export type CaptionLanguages = "ar" | "en" | "ar_en";

export type CaptionRequest = {
  schoolName: string;
  brandVoice: string | null;
  hashtags: string | null;
  languages: CaptionLanguages;
  eventTitle: string | null;
  eventDate: string | null;
  className: string | null;
  notes: string[];
  photos: Uint8Array[];
};
export type Captions = { ar: string; en: string; hashtags: string };

export interface AiProvider {
  name: string;
  rankPhotos(photos: PhotoInput[], context: string): Promise<PhotoVerdict[]>;
  writeCaptions(request: CaptionRequest): Promise<Captions>;
}

export class AiLimitError extends Error {}
