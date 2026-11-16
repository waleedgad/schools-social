// What happens to a caption after the AI writes it and before anyone sees
// it: Arabic punctuation, hashtags, the school's banned words, text that
// reads the right way round on Facebook and Instagram, and what the school's
// own past posts teach. Plain functions with no AI and no database, so every
// rule is tested (captions.test.ts) and works the same with any AI provider.

import type { CaptionLanguages, Captions } from "./ai/types.ts";

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ARABIC_LETTER = /[ء-يٮ-ۓ]/;
const LATIN = /[A-Za-zÀ-ɏ]/;
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic})*/gu;
const MARKS = /[‎‏؜‪-‮⁦-⁩]/g;
const RLM = "‏";
const LRM = "‎";

export const hasArabic = (s: string) => ARABIC.test(s);
export const stripEmoji = (s: string) => s.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "");
export const countEmoji = (s: string) => (s.match(EMOJI) ?? []).length;
export const wordCount = (s: string) => (s.replace(/#[^\s#]+/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) ?? []).length;

// Shared clean-up for both languages: no invisible direction marks left by
// the AI, no runs of spaces, no space before a full stop, at most one empty
// line between paragraphs.
function tidySpaces(s: string) {
  return s
    .replace(MARKS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ +([.!،؛؟:])/g, "$1")
    .replace(/^ +| +$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Arabic as Arabic is written: Arabic comma, semicolon and question mark
// (the AI often leaves the English ones), no stretched letters (كـــبير),
// a space after punctuation and none before it.
export function tidyArabic(text: string) {
  let s = tidySpaces(text).replace(/ـ+/g, "");
  // An English mark that follows an Arabic word (not a number or a Latin word).
  s = s.replace(/([ء-يً-ْ]) ?([,;?])/g, (_m, letter: string, mark: string) => letter + { ",": "،", ";": "؛", "?": "؟" }[mark]);
  s = s.replace(/([،؛])(?=[^\s\d،؛.!؟)»"'\n])/g, "$1 ");
  // Brackets and quotes the wrong way round are common in generated Arabic.
  s = s.replace(/"([^"\n]*[ء-ي][^"\n]*)"/g, "«$1»");
  return s;
}

export function tidyEnglish(text: string) {
  return tidySpaces(text).replace(/ +([,;?])/g, "$1");
}

// Hashtags the AI put inside the caption move to the hashtags line (they are
// published after the caption anyway, and twice looks careless).
export function pullHashtags(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const lines = text.split("\n");
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (last === "") {
      lines.pop();
      continue;
    }
    const tokens = last.split(/\s+/);
    if (tokens.every((t) => /^#[^\s#]+$/.test(t))) {
      tags.unshift(...tokens);
      lines.pop();
      continue;
    }
    // Hashtags at the end of the last sentence.
    let cut = tokens.length;
    while (cut > 0 && /^#[^\s#]+$/.test(tokens[cut - 1])) cut--;
    if (cut < tokens.length && cut > 0) {
      tags.unshift(...tokens.slice(cut));
      lines[lines.length - 1] = tokens.slice(0, cut).join(" ");
    }
    break;
  }
  return { text: lines.join("\n").trim(), tags };
}

function hashtagTokens(line: string | null | undefined) {
  if (!line) return [];
  const out: string[] = [];
  // "#مدرسة النور" is two words to Facebook: only what follows a # counts,
  // and words without one are taken as one hashtag each.
  for (const raw of line.replace(MARKS, "").split(/[\s,،]+/)) {
    for (const piece of raw.split("#")) {
      const tag = piece.replace(/[^\p{L}\p{N}\p{M}_]/gu, "").replace(/ـ/g, "");
      if (tag && !/^\d+$/.test(tag)) out.push(`#${tag}`);
    }
  }
  return out;
}

const tagKey = (tag: string) => foldArabic(tag.toLowerCase());

// One hashtag line: the school's own hashtags first, exactly as the school
// wrote them and never dropped; then the AI's, without repeats, up to the limit.
export function mergeHashtags(fixed: string | null | undefined, extra: string | string[] | null | undefined, max = 8) {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tag: string, force: boolean) => {
    const key = tagKey(tag);
    if (seen.has(key)) return;
    if (!force && out.length >= max) return;
    if ([...out, tag].join(" ").length > 300) return;
    seen.add(key);
    out.push(tag);
  };
  for (const t of hashtagTokens(fixed)) add(t, true);
  for (const t of Array.isArray(extra) ? extra.flatMap(hashtagTokens) : hashtagTokens(extra)) add(t, false);
  return out.slice(0, 30).join(" ");
}

// Arabic letters that are written more than one way count as the same letter
// when looking for a banned word (أ إ آ ا, ى ي, ة ه, with or without marks).
export function foldArabic(s: string) {
  return s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

export function avoidList(...sources: (string | null | undefined)[]) {
  const seen = new Set<string>();
  return sources
    .flatMap((s) => (s ?? "").split(/[,،;\n]/))
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()))
    .slice(0, 60);
}

// The banned words found in a text. Whole words only ("kid" is not found in
// "kidney"); Arabic also matches with the usual prefixes (ال، و، ب، ل…).
export function avoidedIn(text: string, avoid: string[]) {
  const hay = foldArabic(text.toLowerCase());
  return avoid.filter((word) => {
    const w = foldArabic(word.toLowerCase().trim());
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const pattern = hasArabic(w) ? `(?<![\\p{L}\\p{M}])(?:[وفبلك]{0,2}(?:ال|ل)?)?${escaped}(?![\\p{L}\\p{M}])` : `(?<![\\p{L}\\p{N}])${escaped}(?:s|es)?(?![\\p{L}\\p{N}])`;
    return new RegExp(pattern, "u").test(hay);
  });
}

// Facebook and Instagram decide which way each line reads from its first
// letter. An Arabic line that begins with an English name ("KG2 …", "STEM …")
// would be drawn left-to-right with its full stop on the wrong side, so an
// invisible right-to-left mark goes in front of it (and the opposite for an
// English line that starts with an Arabic word). Lines that start with a
// hashtag are left alone: a mark in front can stop the hashtag working.
export function readsRight(text: string) {
  return text
    .replace(MARKS, "")
    .split("\n")
    .map((line) => {
      const first = line.match(/[\p{L}#]/u)?.[0];
      if (!first || first === "#") return line;
      const arabic = (line.match(new RegExp(ARABIC_LETTER.source, "g")) ?? []).length;
      const latin = (line.match(new RegExp(LATIN.source, "g")) ?? []).length;
      if (LATIN.test(first) && arabic > latin) return RLM + line;
      if (ARABIC.test(first) && latin > arabic) return LRM + line;
      return line;
    })
    .join("\n");
}

export type FinishOptions = {
  languages: CaptionLanguages;
  fixedHashtags?: string | null;
  hashtags?: boolean;
  emoji?: boolean;
  avoid?: string[];
  maxHashtags?: number;
};

const similar = (a: string, b: string) => {
  const wa = new Set(foldArabic(a.toLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? []);
  const wb = new Set(foldArabic(b.toLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? []);
  if (!wa.size || !wb.size) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both);
};

// Everything the app does to the AI's versions before showing them. A
// version in the wrong language or with a banned word goes to the end of the
// list (and is dropped when a clean one exists); near-copies are dropped.
export function finishCaptions(versions: Captions[], o: FinishOptions): Captions[] {
  const wantAr = o.languages !== "en";
  const wantEn = o.languages !== "ar";
  const avoid = o.avoid ?? [];
  const done = versions.map((v) => {
    const arPart = pullHashtags(wantAr ? String(v.ar ?? "") : "");
    const enPart = pullHashtags(wantEn ? String(v.en ?? "") : "");
    let ar = tidyArabic(arPart.text);
    let en = tidyEnglish(enPart.text);
    let ig = tidySpaces(String(v.ig ?? ""));
    if (o.emoji === false) {
      ar = stripEmoji(ar);
      en = stripEmoji(en);
      ig = stripEmoji(ig);
    }
    const hashtags = o.hashtags === false ? "" : mergeHashtags(o.fixedHashtags, [String(v.hashtags ?? ""), ...arPart.tags, ...enPart.tags], o.maxHashtags ?? 8);
    const wrongLanguage = (wantAr && !(hasArabic(ar) && arabicShare(ar) >= 0.5)) || (wantEn && (!en || arabicShare(en) > 0.2));
    const bad = wrongLanguage || avoidedIn(`${ar}\n${en}\n${ig}`, avoid).length > 0;
    return {
      caption: { ar: ar.slice(0, 2000), en: en.slice(0, 2000), hashtags, ig: ig.slice(0, 2000), altAr: tidyArabic(String(v.altAr ?? "")).slice(0, 400), altEn: tidyEnglish(String(v.altEn ?? "")).slice(0, 400) },
      bad,
    };
  });
  const unique: typeof done = [];
  for (const d of done) {
    if (!d.caption.ar && !d.caption.en) continue;
    const text = `${d.caption.ar} ${d.caption.en}`;
    if (unique.some((u) => similar(`${u.caption.ar} ${u.caption.en}`, text) > 0.85)) continue;
    unique.push(d);
  }
  const good = unique.filter((d) => !d.bad);
  return (good.length ? good : unique).map((d) => d.caption);
}

function arabicShare(s: string) {
  const arabic = (s.match(new RegExp(ARABIC_LETTER.source, "g")) ?? []).length;
  const latin = (s.match(new RegExp(LATIN.source, "g")) ?? []).length;
  return arabic + latin === 0 ? 0 : arabic / (arabic + latin);
}

// ---- Learning from the school's own posts -------------------------------

export type PastPost = {
  caption_ar: string | null;
  caption_en: string | null;
  category_id: string | null;
  variations: Captions[] | null;
  metrics: { likes: number; comments: number; shares: number; reach: number; saves: number }[];
};

export type LearningHint =
  | { code: "short_wins" | "long_wins" | "team_shortens" | "team_lengthens"; words: number }
  | { code: "emoji_wins" | "emoji_loses" | "question_wins" | "team_drops_emoji" };

export type Learning = { best: string[]; hints: LearningHint[]; measured: number; edited: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const share = <T,>(xs: T[], test: (x: T) => boolean) => (xs.length ? xs.filter(test).length / xs.length : 0);
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

// What the school's results and its own edits say about captions:
//  - best: the captions people responded to most (this category's first),
//    shown to the AI as examples to learn from, not to copy;
//  - hints: patterns that are clear enough to act on (never from a handful
//    of posts: at least 8 with results, or 4 edited drafts).
export function learnFromPosts(posts: PastPost[], o: { categoryId?: string | null; languages: CaptionLanguages }): Learning {
  const main = (p: { caption_ar: string | null; caption_en: string | null }) => ((o.languages === "en" ? p.caption_en || p.caption_ar : p.caption_ar || p.caption_en) ?? "").trim();
  const both = (p: PastPost) => [o.languages !== "en" && p.caption_ar, o.languages !== "ar" && p.caption_en].filter(Boolean).join("\n").trim();

  // Results. With reach known for most posts the measure is response per
  // person reached (fair to a post shown to few people), else plain response.
  const withResults = posts
    .map((p) => {
      const sum = (k: "likes" | "comments" | "shares" | "reach" | "saves") => p.metrics.reduce((n, m) => n + (m[k] ?? 0), 0);
      const response = sum("likes") + 2 * sum("comments") + 3 * sum("shares") + 2 * sum("saves");
      return { post: p, response, reach: sum("reach"), text: main(p) };
    })
    .filter((x) => x.text && (x.response > 0 || x.reach > 0));
  const byReach = share(withResults, (x) => x.reach >= 20) >= 0.7;
  const scored = withResults
    .filter((x) => !byReach || x.reach >= 20)
    .map((x) => ({ ...x, score: byReach ? x.response / x.reach : x.response }))
    .sort((a, b) => b.score - a.score);

  const best: string[] = [];
  const hints: LearningHint[] = [];
  if (scored.length >= 5) {
    const top = scored.slice(0, Math.max(3, Math.ceil(scored.length / 3))).filter((x) => x.score > 0);
    const sameCategory = o.categoryId ? top.filter((x) => x.post.category_id === o.categoryId) : [];
    for (const x of [...sameCategory.slice(0, 2), ...top]) {
      const text = both(x.post).slice(0, 600);
      if (text && !best.includes(text) && best.length < 3) best.push(text);
    }
  }
  if (scored.length >= 8) {
    const third = Math.floor(scored.length / 3);
    const top = scored.slice(0, third);
    const bottom = scored.slice(-third);
    const topWords = median(top.map((x) => wordCount(x.text)));
    const bottomWords = median(bottom.map((x) => wordCount(x.text)));
    if (topWords > 0 && bottomWords > 0) {
      if (topWords <= bottomWords * 0.7) hints.push({ code: "short_wins", words: round5(topWords) });
      else if (topWords >= bottomWords * 1.4) hints.push({ code: "long_wins", words: round5(topWords) });
    }
    const emojiTop = share(top, (x) => countEmoji(x.text) > 0);
    const emojiBottom = share(bottom, (x) => countEmoji(x.text) > 0);
    if (emojiTop - emojiBottom >= 0.5) hints.push({ code: "emoji_wins" });
    else if (emojiBottom - emojiTop >= 0.5) hints.push({ code: "emoji_loses" });
    const asks = (s: string) => /[?؟]/.test(s);
    if (share(top, (x) => asks(x.text)) - share(bottom, (x) => asks(x.text)) >= 0.5) hints.push({ code: "question_wins" });
  }

  // Edits: the AI's draft next to what the team finally approved.
  const edits = posts
    .map((p) => {
      const final = main(p);
      const drafts = (p.variations ?? []).map((v) => (o.languages === "en" ? v.en || v.ar : v.ar || v.en) ?? "").filter(Boolean);
      if (!final || !drafts.length) return null;
      const draft = drafts.map((d) => ({ d, s: similar(d, final) })).sort((a, b) => b.s - a.s)[0];
      // An untouched draft teaches nothing; a caption with nothing in common was written by hand.
      if (draft.s > 0.97 || draft.s < 0.2) return null;
      return { draft: draft.d, final };
    })
    .filter((x) => x !== null);
  if (edits.length >= 4) {
    const ratio = median(edits.map((e) => wordCount(e.final) / Math.max(1, wordCount(e.draft))));
    const finalWords = round5(median(edits.map((e) => wordCount(e.final))));
    if (ratio <= 0.8) hints.push({ code: "team_shortens", words: finalWords });
    else if (ratio >= 1.25) hints.push({ code: "team_lengthens", words: finalWords });
    const hadEmoji = edits.filter((e) => countEmoji(e.draft) > 0);
    if (hadEmoji.length >= 4 && share(hadEmoji, (e) => countEmoji(e.final) === 0) >= 0.6) hints.push({ code: "team_drops_emoji" });
  }
  // The team's own choice wins over a pattern in the results.
  const has = (code: LearningHint["code"]) => hints.some((h) => h.code === code);
  const kept = hints.filter(
    (h) => !((h.code === "short_wins" || h.code === "long_wins") && (has("team_shortens") || has("team_lengthens"))) && !(h.code === "emoji_wins" && has("team_drops_emoji")),
  );
  return { best, hints: kept, measured: scored.length, edited: edits.length };
}

// The hints as instructions for the AI (the screens show them from the
// translation files instead).
export function hintText(h: LearningHint) {
  switch (h.code) {
    case "short_wins":
      return `This school's shorter captions get the most response: aim for about ${h.words} words.`;
    case "long_wins":
      return `This school's fuller captions get the most response: aim for about ${h.words} words.`;
    case "team_shortens":
      return `The team usually cuts the AI's drafts down: write about ${h.words} words.`;
    case "team_lengthens":
      return `The team usually adds detail to the AI's drafts: write about ${h.words} words with concrete detail from the facts.`;
    case "emoji_wins":
      return "Captions with an emoji do better with this school's audience: use one or two.";
    case "emoji_loses":
      return "Captions without emojis do better with this school's audience: use none.";
    case "team_drops_emoji":
      return "The team removes the emojis from the AI's drafts: use none.";
    case "question_wins":
      return "Captions that ask parents a question get more response: one option should end with a simple question.";
  }
}
