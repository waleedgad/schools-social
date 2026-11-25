import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fc from "fast-check";
import { groupMoves, type FilingMove } from "./filing";
import { eventFolder, guessEvent, isoDate, placeFromPath, safeName, schoolYear, term } from "./library";
import { nameKey, nameMatches } from "./names";
import { relInside } from "./paths";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// L-26: "random input" tests. Instead of a few hand-picked examples, the
// computer tries many made-up folder names, dates, names and paths and checks
// rules that must hold for every one of them. A failure prints the smallest
// input that breaks the rule. Same seed every run, so a failure repeats.
const RUNS = { numRuns: 400, seed: 2026_11_25 };

// Text the way schools type it: English, Arabic (with tashkeel), digits,
// symbols Windows refuses, spaces and dots in odd places.
const piece = fc.constantFrom(
  "Sports", "day", "Science", "fair", "KG2", "4B", "Grade 12", "رحلة", "الأول", "يوم", "الرياضة", "مُحَمَّد", "أحمد", "إسراء", "مدرسة",
  " ", "  ", ".", "..", "-", "_", "/", "\\", ":", "*", "?", '"', "<", ">", "|", "\t", "\u0007", "CON", "nul", "com1", "LPT3", "١٢", "2026",
);
const words = fc.array(piece, { maxLength: 12 }).map((a) => a.join(""));
const text = fc.oneof(words, fc.string({ maxLength: 40 }), fc.string({ unit: "grapheme", maxLength: 30 }));
const day = fc.date({ min: new Date(2000, 0, 1), max: new Date(2090, 11, 31), noInvalidDate: true }).map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12));

const WINDOWS_BAD = /[<>:"/\\|?*\u0000-\u001f]/;
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

test("random input: a folder name is always safe on Mac and Windows", () => {
  fc.assert(
    fc.property(text, (name) => {
      const s = safeName(name);
      assert.ok(s.length > 0 && s.length <= 81, `length ${s.length}`);
      assert.ok(!WINDOWS_BAD.test(s), `bad character in ${JSON.stringify(s)}`);
      assert.ok(!/[. ]$/.test(s), `ends in a dot or space: ${JSON.stringify(s)}`);
      assert.ok(!/^\s/.test(s), `starts with a space: ${JSON.stringify(s)}`);
      assert.ok(!DEVICE.test(s), `Windows device name: ${JSON.stringify(s)}`);
      // Made safe once is safe for good: doing it again changes nothing.
      assert.equal(safeName(s), s);
    }),
    RUNS,
  );
});

test("random input: an event folder always reads back to the same date, year, term and name", () => {
  const lib = path.join(path.sep, "School", "Photos");
  fc.assert(
    fc.property(day, text, (d, name) => {
      const folder = eventFolder(lib, d, name);
      const place = placeFromPath(lib, path.join(folder, "IMG_0001.jpg"));
      assert.equal(place.year, schoolYear(d));
      assert.equal(place.term, term(d));
      assert.equal(place.event?.date, isoDate(d));
      assert.equal(place.className, null);
      // Never outside the library.
      assert.notEqual(relInside(lib, folder), null);
      // The name in the folder comes back exactly.
      assert.equal(place.event?.title, path.basename(folder).slice(11));
      assert.ok(place.event!.title.length > 0);
      // It is the school's name for the event, made safe for a folder.
      assert.ok(safeName(name).endsWith(place.event!.title) || place.event!.title === "Event", `${JSON.stringify(name)} -> ${place.event!.title}`);
    }),
    RUNS,
  );
});


test("random input: a date in a folder name is always found, in either order", () => {
  const title = fc.array(fc.constantFrom("Sports", "day", "رحلة", "Trip", "الرياضة", "Fair"), { minLength: 1, maxLength: 4 }).map((a) => a.join(" "));
  fc.assert(
    fc.property(day, title, fc.constantFrom("-", "_", "."), fc.boolean(), (d, t, sep, dateFirst) => {
      const iso = isoDate(d);
      const [y, m, dd] = iso.split("-");
      const name = dateFirst ? `${iso} ${t}` : `${t} ${[dd, m, y].join(sep)}`;
      const g = guessEvent(name);
      assert.equal(g.date, iso, name);
      assert.equal(g.title, t, name);
    }),
    RUNS,
  );
});

test("random input: a guessed date is always a real-looking date or none", () => {
  fc.assert(
    fc.property(text, fc.string({ unit: fc.constantFrom("0", "1", "2", "3", "9", "-", "_", ".", " "), maxLength: 14 }), (a, digits) => {
      const g = guessEvent(a + digits);
      if (g.date === null) return;
      const [y, m, d] = g.date.split("-").map(Number);
      assert.ok(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31, g.date);
    }),
    RUNS,
  );
});

test("random input: nothing outside the library is ever taken for inside (Mac and Windows paths)", () => {
  const seg = fc.constantFrom("2026-2027", "Term 1", "Sports day", "4B", "a", "..", ".", "رحلة", "Photos2", "PHOTOS");
  for (const p of [path.posix, path.win32]) {
    const root = p === path.win32 ? "D:\\School\\Photos" : "/School/Photos";
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 6 }), (segs) => {
        const target = p.join(root, ...segs);
        const rel = relInside(root, target, p);
        const normal = p.normalize(target);
        // Windows compares folder names without case; Mac and Linux paths here do.
        const fold = (x: string) => (p === path.win32 ? x.toLowerCase() : x);
        const reallyInside = fold(normal) === fold(p.normalize(root)) || fold(normal).startsWith(fold(p.normalize(root)) + p.sep);
        assert.equal(rel !== null, reallyInside, `${target} -> ${rel}`);
      }),
      RUNS,
    );
  }
  // Another Windows drive is never inside, whatever the folders are called.
  assert.equal(relInside("D:\\School\\Photos", "E:\\School\\Photos\\IMG.jpg", path.win32), null);
  // A folder that only starts with the same letters is not inside.
  assert.equal(relInside("/School/Photos", "/School/Photos2/IMG.jpg", path.posix), null);
});

test("random input: Arabic spellings written either way always match", () => {
  const arabic = fc.string({ unit: fc.constantFrom("ا", "أ", "إ", "آ", "ة", "ه", "ى", "ي", "م", "ح", "د", "س", "ر", "ء", " ", "\u064e", "\u0651", "\u0650"), minLength: 1, maxLength: 12 });
  const plain = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[\u064b-\u0652]/g, "");
  fc.assert(
    fc.property(arabic, (s) => {
      assert.equal(nameKey(s), nameKey(plain(s)), JSON.stringify(s));
      if (nameKey(s)) {
        assert.ok(nameMatches(s, plain(s)));
        assert.ok(nameMatches(plain(s), s));
      }
    }),
    RUNS,
  );
});

test("random input: English names match whatever the capitals, and a name always finds itself", () => {
  const latin = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ -'"), minLength: 1, maxLength: 20 });
  fc.assert(
    fc.property(fc.oneof(latin, text), (s) => {
      assert.equal(nameKey(s.toUpperCase()), nameKey(s.toLowerCase()));
      if (nameKey(s)) assert.ok(nameMatches(s, s), JSON.stringify(s));
      // The search key never holds symbols, double spaces or edge spaces.
      assert.ok(!/ {2}|^ | $/.test(nameKey(s)));
    }),
    RUNS,
  );
  // The spellings the app promises.
  for (const [a, b] of [["Mohamed", "Muhammad"], ["Mohamed", "Mohammed"], ["Youssef", "Yusuf"], ["Abdel Rahman", "Abdulrahman"]]) assert.ok(nameMatches(a, b), `${a} / ${b}`);
});

test("random input: filing groups keep every photo exactly once, each in the right group", () => {
  const move = fc.record({
    id: fc.integer({ min: 1, max: 1_000_000 }),
    title: fc.constantFrom("Sports day", "رحلة", "Unsorted", "Fair"),
    date: fc.constantFrom("2026-10-12", "2026-10-13", "2027-01-05"),
    className: fc.constantFrom(null, "4B", "KG2A"),
  });
  fc.assert(
    fc.property(fc.uniqueArray(move, { selector: (m) => m.id, maxLength: 60 }), (moves: FilingMove[]) => {
      const groups = groupMoves(moves);
      const ids = groups.flatMap((g) => g.ids);
      assert.equal(ids.length, moves.length);
      assert.deepEqual([...ids].sort((a, b) => a - b), moves.map((m) => m.id).sort((a, b) => a - b));
      const byId = new Map(moves.map((m) => [m.id, m]));
      for (const g of groups) for (const id of g.ids) {
        const m = byId.get(id)!;
        assert.deepEqual([m.title, m.date, m.className], [g.title, g.date, g.className]);
      }
      // One group per target folder.
      const keys = groups.map((g) => `${g.date}|${g.title}|${g.className}`);
      assert.equal(new Set(keys).size, keys.length);
    }),
    RUNS,
  );
});

// The Faces tab searches with its own copy of the rules (in the window).
// It must always give the same answer as the rest of the app.
test("random input: the Faces search and the People search always agree", () => {
  const ui = readFileSync(path.join(__dirname, "..", "..", "src", "renderer", "ui.js"), "utf8");
  const start = ui.indexOf("function nameKey(s) {");
  const end = ui.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, "nameKey not found in ui.js");
  const windowKey = vm.runInNewContext(`(${ui.slice(start, end)})`) as (s: string) => string;
  const people = fc.constantFrom("Abdel Rahman", "Abdulrahman", "Mohamed el Sayed", "Philip", "Khaled", "يوسف", "عبد الرحمن", "Ahmed");
  fc.assert(
    fc.property(fc.oneof(text, people), (s) => assert.equal(windowKey(s), nameKey(s), JSON.stringify(s))),
    RUNS,
  );
});
