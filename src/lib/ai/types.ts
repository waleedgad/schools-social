// The app talks to AI only through this interface, so the provider can be
// swapped (Gemini today, another model later) without touching the screens.
// Face data never goes to AI: photos are sent for captions and checks only.

export const PHOTO_ISSUES = [
  "blurry",
  "dark",
  "eyes_closed",
  "cut_off",
  "cluttered",
  "faces_hidden",
  "sensitive",
  "phone_in_hand",
] as const;
export type PhotoIssue = (typeof PHOTO_ISSUES)[number];

export const TOPICS = ["sports", "art", "science", "celebration", "assembly", "trip", "classroom", "music", "graduation", "other"] as const;
export type Topic = (typeof TOPICS)[number];

export type PhotoInput = { id: string; jpeg: Uint8Array };
export type PhotoVerdict = { id: string; score: number; reason: string; issues: PhotoIssue[] };

export type CaptionLanguages = "ar" | "en" | "ar_en";

export const TONES = ["warm", "proud", "formal", "friendly", "fun", "informative"] as const;
export type Tone = (typeof TONES)[number];

// What the school's voice profile holds (built by the set-up wizard, learnt
// from past posts and edits, and editable on the Brand page).
export type SchoolProfile = {
  motto?: string;
  stages?: string;
  curriculum?: string;
  audience?: string;
  tone?: string;
  dialect?: "msa" | "egyptian";
  emoji?: "none" | "few" | "many";
  signoff?: string;
  useWords?: string;
  avoidWords?: string;
  examples?: string[];
  learnt?: string;
};

export type CaptionOptions = {
  tone?: Tone | null;
  words?: number | null;
  emoji?: boolean;
  hashtags?: boolean;
  count?: number;
  prompt?: string | null;
  splitInstagram?: boolean;
};

export type CaptionRequest = {
  schoolName: string;
  brandVoice: string | null;
  profile?: SchoolProfile | null;
  hashtags: string | null;
  languages: CaptionLanguages;
  eventTitle: string | null;
  eventDate: string | null;
  className: string | null;
  categoryName?: string | null;
  notes: string[];
  photos: Uint8Array[];
  options?: CaptionOptions;
};
export type Captions = { ar: string; en: string; hashtags: string; ig?: string; altAr?: string; altEn?: string };

export type CaptionCheck = { score: number; notes: string[]; spelling: { wrong: string; right: string }[] };

export type ProfileDraft = SchoolProfile & { name?: string; categories?: { en: string; ar: string; description: string }[] };

export type PlannedPost = { day: number; title: string; idea: string; category: string };

export type PhotoDescription = { id: string; altAr: string; altEn: string; topic: Topic };

// A yearbook page to write for: only its kind, title and date (never photos or names).
export type BookPageInput = { kind: string; title: string; date?: string | null };
export type BookPageText = { titleAr: string; titleEn: string; textAr: string; textEn: string };

export interface AiProvider {
  name: string;
  rankPhotos(photos: PhotoInput[], context: string): Promise<PhotoVerdict[]>;
  writeCaptions(request: CaptionRequest): Promise<Captions[]>;
  rewrite(text: string, instruction: string, language: "ar" | "en"): Promise<string>;
  translate(text: string, to: "ar" | "en", profile?: SchoolProfile | null): Promise<string>;
  checkCaption(text: string, profile: SchoolProfile | null, avoid: string[]): Promise<CaptionCheck>;
  buildProfile(schoolName: string, source: string): Promise<ProfileDraft>;
  planPosts(input: { schoolName: string; days: number; events: string[]; categories: string[]; profile: SchoolProfile | null }): Promise<PlannedPost[]>;
  describePhotos(photos: PhotoInput[]): Promise<PhotoDescription[]>;
  suggestReplies(comment: string, postText: string, profile: SchoolProfile | null): Promise<string[]>;
  bookTexts(input: { schoolName: string; year: string; book: string; pages: BookPageInput[]; profile: SchoolProfile | null }): Promise<BookPageText[]>;
}

export class AiLimitError extends Error {}
