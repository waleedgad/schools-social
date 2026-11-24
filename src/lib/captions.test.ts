// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { avoidedIn, avoidList, finishCaptions, finishText, swapAvoided, hintText, learnFromPosts, mergeHashtags, pullHashtags, readsRight, tidyArabic, tidyEnglish, wordCount, type PastPost } from "./captions.ts";

const RLM = "‏";
const LRM = "‎";

test("Arabic gets Arabic punctuation, English numbers and names keep theirs", () => {
  assert.equal(tidyArabic("يوم رائع , تعلّم فيه طلابنا الكثير ; هل أنتم مستعدون ?"), "يوم رائع، تعلّم فيه طلابنا الكثير؛ هل أنتم مستعدون؟");
  assert.equal(tidyArabic("فاز فريقنا بـ 3,000 نقطة في STEM, مبروك"), "فاز فريقنا ب 3,000 نقطة في STEM, مبروك");
  assert.equal(tidyArabic("يوم كـــبير"), "يوم كبير");
  assert.equal(tidyArabic("شكرًا  لكم .\n\n\n\nإلى اللقاء"), "شكرًا لكم.\n\nإلى اللقاء");
  assert.equal(tidyArabic('شعارنا "نتعلم معًا" دائمًا'), "شعارنا «نتعلم معًا» دائمًا");
  assert.equal(tidyArabic("أولًا،ثانيًا"), "أولًا، ثانيًا");
});

test("English is tidied without touching its punctuation", () => {
  assert.equal(tidyEnglish("A great day ,  everyone !‏"), "A great day, everyone!");
});

test("hashtags written inside the caption move out of it", () => {
  assert.deepEqual(pullHashtags("يوم رياضي رائع #يوم_رياضي #AlNour"), { text: "يوم رياضي رائع", tags: ["#يوم_رياضي", "#AlNour"] });
  assert.deepEqual(pullHashtags("A great day.\n\n#SportsDay #AlNour\n"), { text: "A great day.", tags: ["#SportsDay", "#AlNour"] });
  assert.deepEqual(pullHashtags("Our #STEM club met today."), { text: "Our #STEM club met today.", tags: [] });
});

test("the school's own hashtags always come first and nothing repeats", () => {
  assert.equal(mergeHashtags("#AlNourSchool #مدرسة_النور", "#SportsDay #alnourschool، #مدرسه_النور #يوم_رياضي"), "#AlNourSchool #مدرسة_النور #SportsDay #يوم_رياضي");
  assert.equal(mergeHashtags("AlNour", "sports day, #fun!"), "#AlNour #sports #day #fun");
  assert.equal(mergeHashtags("#a1 #b1", "#c1 #d1 #e1", 3), "#a1 #b1 #c1");
  // The school's own are kept even past the limit; the line never passes 300 characters.
  assert.equal(mergeHashtags("#a1 #b1 #c1", "#d1", 2), "#a1 #b1 #c1");
  assert.ok(mergeHashtags(null, Array.from({ length: 80 }, (_, i) => `#hashtag_number_${i}`), 80).length <= 300);
  assert.equal(mergeHashtags(null, "#2026 #Class2026"), "#Class2026");
});

test("banned words are found as whole words, in any Arabic spelling", () => {
  const avoid = avoidList("kid, cheap", "أطفال، مجاني");
  assert.deepEqual(avoid, ["kid", "cheap", "أطفال", "مجاني"]);
  assert.deepEqual(avoidedIn("Our kids loved it", avoid), ["kid"]);
  assert.deepEqual(avoidedIn("A talk about kidney health", avoid), []);
  assert.deepEqual(avoidedIn("فرحة الأطفال اليوم", avoid), ["أطفال"]);
  assert.deepEqual(avoidedIn("وللاطفال نصيب", avoid), ["أطفال"]);
  assert.deepEqual(avoidedIn("طلابنا في يوم رياضي", avoid), []);
});

test("a line that starts in the other language still reads the right way", () => {
  assert.equal(readsRight("KG2 قضوا يومًا رائعًا في الحديقة."), `${RLM}KG2 قضوا يومًا رائعًا في الحديقة.`);
  assert.equal(readsRight("طلابنا في STEM اليوم"), "طلابنا في STEM اليوم");
  assert.equal(readsRight("النور school had a great sports day today"), `${LRM}النور school had a great sports day today`);
  assert.equal(readsRight("A great day at school"), "A great day at school");
  assert.equal(readsRight("#AlNour يوم رياضي رائع"), "#AlNour يوم رياضي رائع");
  // Doing it twice adds nothing.
  const once = readsRight("STEM يوم ممتع لطلابنا\n\nA fun STEM day");
  assert.equal(readsRight(once), once);
  assert.equal(once.split("\n")[2], "A fun STEM day");
});

test("finished versions: right language, no banned words, no copies, school hashtags kept", () => {
  const raw = [
    { ar: "يوم رائع للأطفال في الملعب", en: "A great day for the kids", hashtags: "#fun", ig: "" },
    { ar: "Our students had a great day", en: "Our students had a great day", hashtags: "", ig: "" },
    { ar: "طلابنا قضوا يومًا رياضيًا رائعًا ,شكرًا لمعلمينا 🎉 #يوم_رياضي", en: "Our students had a wonderful sports day 🎉", hashtags: "#SportsDay #alnour", ig: "" },
    { ar: "طلابنا قضوا يومًا رياضيًا رائعًا، شكرًا لمعلمينا", en: "Our students had a wonderful sports day", hashtags: "", ig: "" },
  ];
  const out = finishCaptions(raw, { languages: "ar_en", fixedHashtags: "#AlNour", avoid: ["kids", "أطفال"], emoji: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].ar, "طلابنا قضوا يومًا رياضيًا رائعًا، شكرًا لمعلمينا");
  assert.equal(out[0].en, "Our students had a wonderful sports day");
  assert.equal(out[0].hashtags, "#AlNour #SportsDay #يوم_رياضي");
  // When every version breaks a rule the writer still gets them (the check on the post flags the word).
  assert.equal(finishCaptions(raw.slice(0, 1), { languages: "ar_en", avoid: ["kids"] }).length, 1);
  // One language only: the other stays empty, and hashtags can be switched off.
  const arOnly = finishCaptions([{ ar: "يوم جميل لطلابنا", en: "A lovely day", hashtags: "#x1", ig: "" }], { languages: "ar", hashtags: false, fixedHashtags: "#AlNour" });
  assert.deepEqual([arOnly[0].ar, arOnly[0].en, arOnly[0].hashtags], ["يوم جميل لطلابنا", "", ""]);
});

test("words are counted the same in Arabic and English, without hashtags", () => {
  assert.equal(wordCount("طلابنا قضوا يومًا رائعًا #يوم_رياضي"), 4);
  assert.equal(wordCount("Our students' big day!"), 4);
});

const post = (ar: string, likes: number, more: Partial<PastPost> = {}): PastPost => ({ caption_ar: ar, caption_en: null, category_id: null, variations: null, metrics: likes < 0 ? [] : [{ likes, comments: 0, shares: 0, reach: 0, saves: 0 }], ...more });
const long = "في إطار حرص المدرسة على تنمية مهارات الطلاب نظمت المدرسة يومًا رياضيًا شارك فيه جميع الطلاب من مختلف الصفوف الدراسية وقد حضر عدد كبير من أولياء الأمور";

test("nothing is claimed from a handful of posts", () => {
  const few = learnFromPosts([post("يوم جميل 🎉", 90), post(long, 2), post("فخورون بطلابنا", 50), post("شكرًا لكم", 40)], { languages: "ar" });
  assert.deepEqual([few.best, few.hints], [[], []]);
});

test("the school's best posts become examples, this category's first", () => {
  const posts = [
    post("طلابنا أبطال اليوم 🎉", 200),
    post("رحلة ممتعة إلى المتحف", 150, { category_id: "trips" }),
    post("فخورون بفريقنا", 120),
    post(long, 5),
    post(`${long} 1`, 4),
    post(`${long} 2`, 3),
  ];
  const l = learnFromPosts(posts, { languages: "ar", categoryId: "trips" });
  assert.equal(l.best[0], "رحلة ممتعة إلى المتحف");
  assert.equal(l.best.length, 3);
  assert.ok(!l.best.includes(long));
});

test("patterns in the results become hints", () => {
  const posts = [
    ...["طلابنا أبطال اليوم 🎉", "يوم رائع في الملعب ✨", "فخورون بفريقنا 🎉", "هل أنتم مستعدون للحفل؟ 🎉"].map((t, i) => post(t, 300 - i)),
    ...["يوم عادي في المدرسة مع الطلاب", "حصة علوم جديدة للصف الرابع اليوم", "نشاط فني في الفصل مع المعلمة", "زيارة قصيرة إلى مكتبة المدرسة اليوم"].map((t, i) => post(t, 100 - i)),
    ...[0, 1, 2, 3].map((i) => post(`${long} ${i}`, 5 - i)),
  ];
  const l = learnFromPosts(posts, { languages: "ar" });
  assert.deepEqual(l.hints.map((h) => h.code), ["short_wins", "emoji_wins"]);
  assert.equal(l.measured, 12);
  assert.match(hintText(l.hints[0]), /about 5 words/);
});

test("reach makes the measure fair to a post shown to few people", () => {
  const seen = (ar: string, likes: number, reach: number): PastPost => ({ caption_ar: ar, caption_en: null, category_id: null, variations: null, metrics: [{ likes, comments: 0, shares: 0, reach, saves: 0 }] });
  const l = learnFromPosts([seen("منشور صغير ناجح", 40, 100), seen("منشور كبير عادي", 60, 3000), seen("ثالث", 10, 500), seen("رابع", 5, 500), seen("خامس", 4, 500)], { languages: "ar" });
  assert.equal(l.best[0], "منشور صغير ناجح");
});

test("the team's own edits are learnt, and win over the results", () => {
  const draft = "طلابنا قضوا اليوم يومًا رياضيًا رائعًا مليئًا بالحماس والتعاون والروح الرياضية العالية بين جميع الفصول 🎉";
  const final = "طلابنا قضوا يومًا رياضيًا رائعًا مليئًا بالحماس";
  const edited = [0, 1, 2, 3].map((i) => post(`${final} ${i}`, -1, { variations: [{ ar: `${draft} ${i}`, en: "", hashtags: "" }] }));
  const untouched = post("نص لم يتغير أبدًا", -1, { variations: [{ ar: "نص لم يتغير أبدًا", en: "", hashtags: "" }] });
  const l = learnFromPosts([...edited, untouched], { languages: "ar" });
  assert.deepEqual(l.hints.map((h) => h.code), ["team_shortens", "team_drops_emoji"]);
  assert.equal(l.edited, 4);
});

test("KG students are our students: the words for children are always avoided", async () => {
  const { ALWAYS_AVOID } = await import("./captions.ts");
  const avoid = avoidList(ALWAYS_AVOID, "cheap");
  assert.ok(avoid.includes("cheap"));
  assert.deepEqual(avoidedIn("فرحة أطفالنا في الروضة", avoid), ["أطفالنا"]);
  assert.deepEqual(avoidedIn("Our KG kids had fun", avoid), ["kids"]);
  assert.deepEqual(avoidedIn("طلابنا في KG1 استمتعوا", avoid), []);
  const out = finishCaptions(
    [
      { ar: "فرحة أطفالنا في يوم الرياضة.", en: "Our children enjoyed Sports Day.", hashtags: "" },
      { ar: "طلابنا في KG2 استمتعوا بيوم الرياضة.", en: "Our KG2 students enjoyed Sports Day.", hashtags: "" },
    ],
    { languages: "ar_en", avoid },
  );
  assert.equal(out.length, 1);
  assert.match(out[0].en, /students/);
});

test("the words for children are swapped for the school word, with Arabic prefixes kept", () => {
  assert.equal(swapAvoided("أطفالنا والأطفال وللأطفال وطفل وصغارنا وبراعمنا"), "طلابنا والطلاب وللطلاب وطالب وطلابنا وطلابنا");
  assert.equal(swapAvoided("Children and kids, our little ones; a child"), "Students and students, our students; a student");
  assert.equal(swapAvoided("kidney beans"), "kidney beans");
});

test("finishText tidies by language and flags a banned word", () => {
  assert.deepEqual(finishText("شكرًا , أطفالنا", ["رخيص"]), { text: "شكرًا، طلابنا", bad: false });
  assert.equal(finishText("A cheap deal", ["cheap"]).bad, true);
});
