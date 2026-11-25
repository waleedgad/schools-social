// Run with: npm test
// Help text in both languages, on the website and in the Mac app: every
// guide has an Arabic and an English title and body, and none uses the words
// the school never uses about its students (Student / Parent / Teacher /
// Staff only; KG and every grade are "طلابنا" / "our students").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const en = JSON.parse(readFileSync("messages/en.json", "utf8")).help;
const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")).help;
const page = readFileSync("src/app/[locale]/help/page.tsx", "utf8");
const mac = readFileSync("desktop/src/renderer/views/help.js", "utf8");

const NEVER_EN = /\b(child|children|kids?|kiddos?)\b/i;
const NEVER_AR = /(أطفال|الأطفال|طفل|صغارنا|براعمنا)/;

const listed = (name: string) => [...(page.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);

test("every guide and news line on the Help page exists in Arabic and English", () => {
  const guides = [...listed("GUIDES"), ...listed("OWNER_GUIDES")];
  assert.ok(guides.length >= 18, `only ${guides.length} guides listed`);
  for (const g of guides) {
    for (const [lang, h] of [["en", en], ["ar", ar]] as const) {
      assert.ok(h.guides[g]?.title?.trim(), `${lang} guide ${g} has no title`);
      assert.ok(h.guides[g]?.body?.trim().length > 60, `${lang} guide ${g} body is missing or too short`);
    }
    assert.match(ar.guides[g].title + ar.guides[g].body, /[؀-ۿ]{3}/, `Arabic guide ${g} isn't in Arabic`);
  }
  for (const n of listed("NEWS")) {
    assert.ok(en.whatsNew[n] && ar.whatsNew[n], `what's new ${n} missing in one language`);
  }
});

test("the new features have their own guide", () => {
  const guides = listed("GUIDES");
  for (const g of ["captions", "posting", "check", "inbox", "books", "cloud", "connections", "plan", "look"]) assert.ok(guides.includes(g), `${g} guide is not on the Help page`);
  assert.deepEqual(listed("OWNER_GUIDES"), ["owner"]);
  for (const id of ["books", "graduation", "look", "captions", "plan", "website"]) assert.match(mac, new RegExp(`id: "${id}", group:`), `Mac Help has no ${id} guide`);
});

test("Help never says child or children, in either language", () => {
  const all = JSON.stringify(en) + mac.replace(/[؀-ۿ]+/g, " ");
  assert.doesNotMatch(all, NEVER_EN);
  assert.doesNotMatch(JSON.stringify(ar) + mac, NEVER_AR);
});

test("Mac Help guides each have both languages", () => {
  // Each guide body is L(`English`, `Arabic`): the second text must be Arabic.
  const bodies = [...mac.matchAll(/body: L\(\s*`([\s\S]*?)`,\s*`([\s\S]*?)`,?\s*\)/g)];
  assert.ok(bodies.length >= 18, `only ${bodies.length} Mac guides found`);
  for (const [, e, a] of bodies) {
    assert.doesNotMatch(e.replace("طلابنا", ""), /[؀-ۿ]{4,}/, `English text has Arabic in it: ${e.slice(0, 60)}`);
    assert.match(a, /[؀-ۿ]{3}/, `Arabic text missing: ${e.slice(0, 60)}`);
  }
});
