import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bookHtml, placeTexts, type Page } from "./books";
import { openDb } from "./db";

// Texts collected on the website go where they belong by themselves.
const pages = (): Page[] => [
  { id: "c", type: "cover", title: "Book", layout: "hero", photos: [] },
  { id: "w", type: "welcome", title: "A word from the principal", layout: "single", photos: [] },
  { id: "a", type: "class", title: "Class 5A", layout: "grid", photos: [], className: "5A", students: ["s1", "s2"] },
  { id: "b", type: "class", title: "Class 5B", layout: "grid", photos: [], className: "5B", students: ["s3"], locked: true },
];

test("principal's word, teacher messages and quotes are placed; locked pages untouched; no doubles", () => {
  const texts = [
    { kind: "principal", body: "كلمة المدير هنا" },
    { kind: "teacher", class_name: "5A", body: "A great year, 5A!" },
    { kind: "teacher", class_name: "5B", body: "Locked page message" },
    { kind: "quote", student_code: "s1", body: "I loved the science fair" },
    { kind: "quote", student_code: "s3", body: "On a locked page" },
    { kind: "other", body: "Nowhere to go" },
  ];
  const r = placeTexts(pages(), texts);
  assert.equal(r.placed, 3);
  assert.equal(r.pages[1].textAr, "كلمة المدير هنا");
  assert.equal(r.pages[2].text, "A great year, 5A!");
  assert.deepEqual(r.pages[2].quotes, { s1: "I loved the science fair" });
  assert.equal(r.pages[3].text, undefined);
  assert.equal(r.pages[3].quotes, undefined);
  // Again: nothing new.
  assert.equal(placeTexts(r.pages, texts).placed, 0);
});

test("a quote shows under the student's name on the class page", () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "bt-")), "l.db"));
  db.prepare("insert into students (id, name_en, class_name, kind, can_post, added_at) values ('s1', 'Omar K.', '5A', 'student', 1, 1)").run();
  const page: Page = { id: "a", type: "class", title: "Class 5A", layout: "grid", photos: [], className: "5A", students: ["s1"], quotes: { s1: "Science <3" } };
  const html = bookHtml(db, { kind: "class", year: "2026-2027", className: "5A", school: "School", language: "en" }, [page], { photo: () => "", face: () => null, logo: null });
  assert.match(html, /<q dir="auto">Science &lt;3<\/q>/);
});
