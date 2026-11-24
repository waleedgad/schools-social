// What the AI is asked, in one place and with no provider in it: Gemini
// today, any other model tomorrow reads the same instructions. Plain
// functions, tested in prompts.test.ts.

import type { CaptionRequest, SchoolProfile } from "./types.ts";

// The school's voice, as instructions every caption follows.
export function voiceText(profile: SchoolProfile | null | undefined, brandVoice?: string | null) {
  if (!profile && !brandVoice) return "";
  const p = profile ?? {};
  return [
    brandVoice && `How the school sounds: ${brandVoice}`,
    p.tone && `Tone: ${p.tone}`,
    p.audience && `Audience: ${p.audience}`,
    p.stages && `Stages: ${p.stages}`,
    p.curriculum && `Curriculum: ${p.curriculum}`,
    p.emoji && `Emojis: ${{ none: "none", few: "at most two", many: "several are fine" }[p.emoji]}`,
    p.useWords && `Words and values the school likes to use: ${p.useWords}`,
    p.avoidWords && `Never use these words: ${p.avoidWords}`,
    p.signoff && `End with the school's sign-off, exactly as written: ${p.signoff}`,
    p.motto && `Motto (use it rarely, only where it fits): ${p.motto}`,
    p.learnt && `Learnt from the school's own edits and best posts: ${p.learnt}`,
    p.examples?.length && `Captions the school approved before. Match their voice, length and rhythm; never copy their sentences:\n- ${p.examples.slice(0, 5).map((e) => e.replace(/\s*\n\s*/g, " / ").slice(0, 400)).join("\n- ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// How Arabic for an Egyptian school's page is written. Kept as rules with
// real examples, because "write good Arabic" changes nothing.
export function arabicRules(dialect: SchoolProfile["dialect"]) {
  const register =
    dialect === "egyptian"
      ? "Register: light Egyptian Arabic, the way a friendly Egyptian school talks to its parents. The base is simple Standard Arabic warmed with everyday Egyptian words (النهارده، فخورين، مبسوطين، شكرًا لكل اللي شارك). Never street slang, never jokes at anyone's expense, never Arabic in Latin letters."
      : "Register: simple Modern Standard Arabic (فصحى مبسّطة), the way good Egyptian private schools write to parents: short clear sentences, warm, nothing classical or heavy. No Egyptian dialect words.";
  return [
    "Arabic rules:",
    `- ${register}`,
    "- Write the Arabic as Arabic from the start. It must not read like a translation of the English: no English word order, no literal phrases (not «قضاء وقت ممتع», not «نحن متحمسون لمشاركة»).",
    "- Avoid official-letter wording unless the tone is formal: no «في إطار حرص المدرسة على», no «تتشرف إدارة المدرسة», no «قامت المدرسة بتنظيم». Start with the students and what they did.",
    "- People: طلابنا، طالباتنا or طلابنا وطالباتنا; معلمونا ومعلماتنا; أولياء الأمور. Match gender and number to what the facts say; when unsure use the plural that includes everyone.",
    "- KG and the youngest grades too: they are طلابنا (our students), never أطفالنا، أطفال، صغارنا or براعمنا.",
    "- Egyptian month names (يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر), never كانون، شباط، آذار. One kind of digits in a caption.",
    "- Arabic punctuation (، ؛ ؟). No stretched letters (كـــبير). No vowel marks except a tanween that is normally written (شكرًا، أهلًا).",
    "- Never begin an Arabic sentence with a word in English letters. Put an English name (KG2, STEM, a competition's name) inside the sentence, and keep class and grade names exactly as given in the facts.",
    "- Phrases such as ما شاء الله، بالتوفيق، كل عام وأنتم بخير only where a school would really say them. The page speaks to every family: nothing religious unless the occasion itself is.",
  ].join("\n");
}

const ENGLISH_RULES = [
  "English rules:",
  "- Plain, warm international English that a parent reads in five seconds. Written fresh from the same facts, not translated from the Arabic.",
  "- No marketing clichés: no \"we are thrilled to announce\", \"unforgettable\", \"shining stars\", \"little ones\".",
  "- KG and the youngest grades too: \"our students\", never \"kids\", \"children\" or \"little ones\".",
].join("\n");

const SAFETY =
  "Always: celebrate effort and learning. Describe the activity, never one student: no names (even if a name can be read in a photo), no remarks on anyone's looks, no guessing who is who. " +
  "Say only what the facts or the photos show; when the facts are thin, write less. No promises about results, fees or admissions. " +
  "Call them students (طلابنا), not kids or children, unless the school's own words say otherwise.";

function lengthLine(req: CaptionRequest) {
  const o = req.options ?? {};
  if (o.words) return `Length: about ${o.words} words in each language.`;
  return "Length: two to four short sentences in each language (the first line must make sense alone: Facebook and Instagram cut the rest behind \"See more\").";
}

function emojiLine(req: CaptionRequest) {
  if (req.options?.emoji === false || req.profile?.emoji === "none") return "Emojis: none.";
  if (req.profile?.emoji === "many") return "Emojis: a few are fine, never two in a row, never in place of a word.";
  return "Emojis: at most two, at the end of a sentence, never in place of a word.";
}

export function captionPrompt(req: CaptionRequest) {
  const o = req.options ?? {};
  const count = Math.min(5, Math.max(1, o.count ?? 3));
  const wantAr = req.languages !== "en";
  const wantEn = req.languages !== "ar";
  const languages = { ar: "Arabic only (leave \"en\" empty)", en: "English only (leave \"ar\" empty)", ar_en: "Arabic and English" }[req.languages];

  const facts = [
    `School: ${req.schoolName}`,
    req.eventTitle && `Event: ${req.eventTitle}`,
    req.eventDate && `Date: ${req.eventDate}`,
    req.className && `Class or grade: ${req.className}`,
    req.categoryName && `Kind of post: ${req.categoryName}`,
    req.notes.length > 0 && `What staff wrote about it:\n- ${req.notes.join("\n- ")}`,
  ].filter(Boolean);

  const learning = req.learning;
  const learnt = [
    learning?.hints.length && `What this school's results and edits show:\n- ${learning.hints.join("\n- ")}`,
    learning?.best.length && `The school's captions that people responded to most. Learn what works in them (opening, length, warmth); never copy their sentences:\n- ${learning.best.map((b) => b.replace(/\s*\n\s*/g, " / ")).join("\n- ")}`,
  ].filter(Boolean);

  const hashtagLine =
    o.hashtags === false
      ? "hashtags: leave empty."
      : [
          `hashtags: up to ${req.hashtags ? 4 : 5} that fit this post, in one line${wantAr && wantEn ? ", Arabic and English mixed" : wantAr ? ", mostly Arabic" : ""}. Specific to the activity (#يوم_رياضي, #ScienceFair), nothing generic (#love, #instagood). Arabic hashtags join their words with _ . No hashtags inside "ar" or "en".`,
          req.hashtags && `The app adds the school's own hashtags itself, so do not repeat them: ${req.hashtags}`,
          req.hashtagSets?.length && `The school's saved hashtag sets. If one clearly fits this post, use its hashtags exactly as written:\n- ${req.hashtagSets.map((s) => `${s.title}: ${s.tags}`).join("\n- ")}`,
        ]
          .filter(Boolean)
          .join("\n");

  return [
    `You write the social media captions of ${req.schoolName}, a private school in Egypt, for its Facebook page and Instagram. Parents are the readers. You write like the school's own communications officer who was at the event, not like an advertising agency.`,
    `Write ${count} caption option${count > 1 ? "s" : ""} in ${languages}.${count > 1 ? " Each option takes a different angle: what happened; what the students learned or felt; thanks or an invitation to parents." : ""}`,
    o.prompt && `Most important, the writer's request for this post (follow it even where it differs from the usual style): ${o.prompt}`,
    [lengthLine(req), o.tone && `Tone for this post: ${o.tone}.`, emojiLine(req)].filter(Boolean).join(" "),
    SAFETY,
    wantAr && arabicRules(req.profile?.dialect),
    wantEn && ENGLISH_RULES,
    voiceText(req.profile, req.brandVoice) && `The school's voice:\n${voiceText(req.profile, req.brandVoice)}`,
    req.avoid?.length && `Words this school never uses (in any form): ${req.avoid.join("، ")}`,
    ...learnt,
    `Facts for this post:\n${facts.join("\n")}`,
    hashtagLine,
    o.splitInstagram
      ? `ig: a shorter Instagram version in ${wantAr ? "Arabic" : "English"} (one or two lines), without hashtags.`
      : "ig: leave empty.",
    "altAr and altEn: alt text for blind readers describing the first photo, one sentence each, no names. Leave both empty when there is no photo.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function rewritePrompt(text: string, instruction: string, language: "ar" | "en", profile?: SchoolProfile | null) {
  return [
    `Rewrite this caption from an Egyptian private school's Facebook and Instagram page. It is in ${language === "ar" ? "Arabic" : "English"} and stays in that language.`,
    `What to change: ${instruction}`,
    "Change only what was asked. Keep the facts, keep any hashtags as they are, add no names and no new facts.",
    language === "ar" ? arabicRules(profile?.dialect) : ENGLISH_RULES,
    voiceText(profile) && `The school's voice:\n${voiceText(profile)}`,
    `Caption:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function translatePrompt(text: string, to: "ar" | "en", profile?: SchoolProfile | null) {
  return [
    `Write the ${to === "ar" ? "Arabic" : "English"} version of this caption from an Egyptian private school's page. Same facts and about the same length, written the way a native writer would say it, not word for word. No hashtags, no added names or facts.`,
    to === "ar" ? arabicRules(profile?.dialect) : ENGLISH_RULES,
    voiceText(profile) && `The school's voice:\n${voiceText(profile)}`,
    `Caption:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
