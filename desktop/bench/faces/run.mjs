// Face-accuracy test on the stand-in photos (see fetch.mjs).
//   npm run build && node bench/faces/run.mjs <photos-dir> [aura-model.onnx]
// Uses the app's own face code (dist/core/faces.js) exactly as the app does:
// the same face finder, quality filter, recognisers, one-person-per-photo
// rule, "suggest" and "sure" thresholds. Writes report.md and report.json
// into the photos folder and prints the report.
//
// What it measures, for the current recogniser (SFace) and AuraFace:
//  1. Single photos: people "named" from 1, 3 or 5 confirmed faces (like a
//     teacher confirming faces; more confirmed faces should mean better
//     matching). A quarter of the people are never named: they stand in for
//     parents, visitors and other schools' students, and should never get a
//     name.
//  2. Made-up group photos (class-photo style rows, built from the single
//     photos): normal faces, tiny faces at the back and blurred faces. Tiny
//     and blurred faces should never be named.
import { createRequire } from "node:module";
import { readdir, readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "../..");
const F = require(path.join(desktop, "dist/core/faces.js"));
const sharp = require("sharp");
const MODELS = path.join(desktop, "models");

const photos = path.resolve(process.argv[2] ?? "face-bench-photos");
const auraFile = process.argv[3] && existsSync(process.argv[3]) ? path.resolve(process.argv[3]) : null;
// "both" is what the app uses once AuraFace is there: AuraFace (with its
// mirror image) and SFace together.
// "both@v1" is how 0.11 read each face (from the 2000 px copy, eyes and mouth
// as first found), "both@aa" adds the smooth shrink of big faces, and "both"
// is the app now (also the closer second look).
const KINDS = auraFile ? ["sface", "aura+flip", "both@v1", "both@aa", "both"] : ["sface"];
const base = (kind) => kind.split(/[+@]/)[0];
const BIG = Number(process.env.BENCH_BIG ?? 12);
const GROUPS = Number(process.env.BENCH_GROUPS ?? 40);
const DUP = Number(process.env.BENCH_DUP ?? 0.95);
const MIN_PHOTOS = Number(process.env.BENCH_MIN ?? 7);

// Same random choices every run.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (a, r) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};
const unit = (v) => {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / n);
};
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");

// ---- 1. Find and describe every face, with each recogniser ------------------
// "+flip" also describes the mirror image of the face and adds the two (a
// common way to make face descriptions steadier); tested here before the app
// uses it.
const whyCount = {};
async function analyse(file, o = {}) {
  const found = await F.findFaces(MODELS, file, { aura: auraFile, ...o });
  const { info } = await sharp(file, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg().toBuffer({ resolveWithObject: true });
  const out = [];
  for (const f of found) {
    const emb = {};
    if (found.recogniser === "both") {
      emb.both = f.embedding;
      // AuraFace (with its mirror image) and SFace on their own, as 0.11 read them
      if (f.variants?.v1) {
        emb["both@v1"] = f.variants.v1;
        const cutAt = f.variants.v1.length - 128; // AuraFace's part, then SFace's 128
        emb["aura+flip"] = unit(f.variants.v1.slice(0, cutAt));
        emb.sface = unit(f.variants.v1.slice(cutAt));
      }
      if (f.variants?.aa) emb["both@aa"] = f.variants.aa;
    } else emb.sface = f.embedding;
    // pixel box and landmarks too, so the quality filter can be tried with
    // other settings without finding the faces again
    out.push({ box: f.box, score: f.score, usable: f.usable, why: f.why, sharpness: f.sharpness, landmarks: f.landmarks, px: f.px, zoomScore: f.zoomScore, emb });
  }
  return { faces: out, width: info.width, height: info.height };
}

// Faces found in each photo are kept in a cache file between runs (it only
// changes when the face code changes), so trying new settings takes minutes.
const cacheFile = process.env.BENCH_CACHE;
const cache = new Map();
// The cache is only used while the face finding and describing code is the
// same (matching settings can change freely).
const fingerprint = createHash("sha1")
  .update([F.findFaces, F.align, F.faceProblem, F.faceSharpness, F.decode, F.loadModels, F.shrinkForAlign, F.secondLook, F.cut].map(String).join("\n") + KINDS.join() + analyse.toString())
  .digest("hex");
const stored = cacheFile && existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, "utf8")) : null;
// BENCH_TRUST_CACHE=1: use the stored faces although the face code changed
// (only when the change is the "unsure" rule, which is worked out again
// below for the hard cases; the single photos keep their test faces so the
// numbers stay comparable with the last full run). Off in the workflow: a
// stored photo that lacks any of the descriptions this run needs is read
// again either way (a cache from another branch or an older test).
const trusted = !!process.env.BENCH_TRUST_CACHE && stored && stored.fingerprint !== fingerprint;
if (trusted) console.error("stored faces used although the face code changed");
const NEED = auraFile ? ["sface", "aura+flip", "both@v1", "both@aa", "both"] : ["sface"];
let staleCache = 0;
if (stored?.fingerprint === fingerprint || trusted) {
  for (const [k, v] of Object.entries(stored.photos)) {
    if (!v.faces.every((f) => f.emb && NEED.every((e) => typeof f.emb[e] === "string"))) {
      staleCache++;
      continue; // read again below
    }
    for (const f of v.faces) for (const e of Object.keys(f.emb)) f.emb[e] = new Float32Array(new Uint8Array(Buffer.from(f.emb[e], "base64")).buffer);
    if (trusted && k.startsWith("hard|"))
      for (const f of v.faces) {
        if (f.why !== "unsure") continue;
        f.why = F.faceProblem({ box: [f.box[0] * v.width, f.box[1] * v.height, f.box[2] * v.width, f.box[3] * v.height], score: f.score, landmarks: f.landmarks }, f.sharpness, v.width, v.height, { zoomScore: f.zoomScore });
        f.usable = !f.why;
      }
    cache.set(k, v);
  }
}
if (staleCache) console.error(`${staleCache} stored photos lacked a description and are read again`);
async function analyseCached(file) {
  const key = path.relative(photos, file);
  if (!cache.has(key)) cache.set(key, await analyse(file, auraFile ? { variants: ["v1", "aa"] } : {}));
  const a = cache.get(key);
  for (const f of a.faces) if (f.why) whyCount[f.why] = (whyCount[f.why] ?? 0) + 1;
  return a;
}
async function saveCache() {
  if (!cacheFile) return;
  const o = {};
  for (const [k, v] of cache) o[k] = { ...v, faces: v.faces.map((f) => ({ ...f, emb: Object.fromEntries(Object.entries(f.emb).map(([e, x]) => [e, Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString("base64")])) })) };
  await writeFile(cacheFile, JSON.stringify({ fingerprint: trusted ? stored.fingerprint : fingerprint, photos: o }));
}
const credits = existsSync(path.join(photos, "credits.json")) ? new Map(JSON.parse(await readFile(path.join(photos, "credits.json"), "utf8")).map((c) => [c.file, c])) : new Map();
const title = (file) => credits.get(path.relative(photos, file))?.title?.replace(/^File:/, "") ?? path.relative(photos, file);

const people = (await readdir(photos, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== "groups").map((d) => d.name).sort();
const singles = []; // { person, file, face }
let scanned = 0, noFace = 0, crowded = 0;
const t0 = Date.now();
for (const person of people) {
  const files = (await readdir(path.join(photos, person))).filter((f) => f.endsWith(".jpg")).sort();
  for (const name of files) {
    const file = path.join(photos, person, name);
    let a;
    try {
      a = await analyseCached(file);
    } catch {
      continue;
    }
    scanned++;
    // kept as it goes, so a run that is cut short doesn't start again from nothing
    if (scanned % 300 === 0) {
      await saveCache();
      console.error(`${scanned} photos read, ${((Date.now() - t0) / 60000).toFixed(0)} min`);
    }
    // The person the photo is filed under is its biggest usable face, when
    // that face is clearly the main one (photos of a crowd are left out).
    const usable = a.faces.filter((f) => f.usable).sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3]);
    if (!usable.length) {
      noFace++;
      continue;
    }
    if (usable[1] && usable[1].box[2] * usable[1].box[3] * 1.8 > usable[0].box[2] * usable[0].box[3]) {
      crowded++;
      continue;
    }
    singles.push({ person, file, face: usable[0], size: [a.width, a.height] });
  }
}
const scanSeconds = (Date.now() - t0) / 1000;
await saveCache();

// ---- 2. Clean the labels -----------------------------------------------------
// A photo filed under someone sometimes shows somebody else (a team mate, an
// interviewer). Faces far from the person's average face are dropped, and so
// are near-copies of the same photo (they'd make matching look too easy).
const cleanKind = auraFile ? "aura+flip" : "sface";
const cut = { sface: 0.25, "aura+flip": 0.2 }[cleanKind];
const byPerson = new Map();
for (const s of singles) (byPerson.get(s.person) ?? byPerson.set(s.person, []).get(s.person)).push(s);
let dropped = 0;
// (BENCH_NOCLEAN: a quick check of this script on made-up photos)
const NOCLEAN = !!process.env.BENCH_NOCLEAN;
for (const [person, list] of NOCLEAN ? [] : byPerson) {
  let keep = list;
  for (let round = 0; round < 3; round++) {
    const c = new Float32Array(keep[0]?.face.emb[cleanKind].length ?? 0);
    for (const s of keep) s.face.emb[cleanKind].forEach((v, i) => (c[i] += v));
    const centre = unit(c);
    keep = list.filter((s) => F.cosine(s.face.emb[cleanKind], centre) >= cut);
    if (!keep.length) break;
  }
  const out = [];
  for (const s of keep) if (out.every((o) => F.cosine(o.face.emb[cleanKind], s.face.emb[cleanKind]) < DUP)) out.push(s);
  dropped += list.length - out.length;
  byPerson.set(person, out);
}
// Then a face that looks more like another person's average face than its own,
// with either recogniser, is taken to be filed under the wrong person.
const cleanKinds = auraFile ? ["sface", "aura+flip"] : ["sface"];
const centres = {};
for (const kind of cleanKinds) {
  centres[kind] = new Map();
  for (const [p, list] of byPerson) {
    if (!list.length) continue;
    const c = new Float32Array(list[0].face.emb[kind].length);
    for (const s of list) s.face.emb[kind].forEach((v, i) => (c[i] += v));
    centres[kind].set(p, unit(c));
  }
}
let misfiled = 0;
for (const [p, list] of NOCLEAN ? [] : byPerson) {
  const keep = list.filter((s) =>
    cleanKinds.every((kind) => {
      const own = F.cosine(s.face.emb[kind], centres[kind].get(p));
      for (const [q, c] of centres[kind]) if (q !== p && F.cosine(s.face.emb[kind], c) > own) return false;
      return true;
    }),
  );
  misfiled += list.length - keep.length;
  byPerson.set(p, keep);
}
const usablePeople = [...byPerson.entries()].filter(([, l]) => l.length >= MIN_PHOTOS).map(([p]) => p);

// ---- 3. Who is "named" and who is a stranger --------------------------------
const r = rng(20261106);
const order = shuffle(usablePeople, r);
const strangers = new Set(order.slice(0, Math.round(order.length / 4)));
const named = order.filter((p) => !strangers.has(p));

function gallery(kind, k) {
  const known = [];
  for (const p of named) for (const s of byPerson.get(p).slice(0, k)) known.push({ studentId: p, embedding: s.face.emb[kind] });
  return known;
}
// Probes never include a face used as a confirmed face (index >= 5).
const probes = [];
for (const p of usablePeople) for (const s of byPerson.get(p).slice(strangers.has(p) ? 0 : 5, strangers.has(p) ? 15 : 35)) probes.push({ truth: strangers.has(p) ? null : p, s });

// The app's decision for one face: named by itself ("sure"), suggested, or nothing.
function decide(m, kind) {
  if (!m) return { pick: null, how: "none" };
  if (F.isSure(m, base(kind))) return { pick: m.studentId, how: "sure" };
  if (m.score >= F.SHOW_FROM - 0.1) return { pick: m.studentId, how: "suggest" };
  return { pick: null, how: "none" };
}
function tally() {
  return { n: 0, rank1: 0, sureRight: 0, sureWrong: 0, sugRight: 0, sugWrong: 0, none: 0, strangers: 0, strangerSure: 0, strangerSug: 0 };
}
function count(t, truth, d, top) {
  if (truth) {
    t.n++;
    if (top === truth) t.rank1++;
    if (d.how === "sure") d.pick === truth ? t.sureRight++ : t.sureWrong++;
    else if (d.how === "suggest") d.pick === truth ? t.sugRight++ : t.sugWrong++;
    else t.none++;
  } else {
    t.strangers++;
    if (d.how === "sure") t.strangerSure++;
    else if (d.how === "suggest") t.strangerSug++;
  }
}

const results = { singles: {}, groups: {}, sweep: {} };
const mistakes = [];
const raw = {}; // for the threshold sweep: top1/top2 raw cosine per probe
for (const kind of KINDS) {
  results.singles[kind] = {};
  for (const k of [1, 3, 5]) {
    const known = gallery(kind, k);
    const t = tally();
    for (const p of probes) {
      const list = F.ranked(p.s.face.emb[kind], known, base(kind));
      const m = list.length && list[0].score >= F.SAME_PERSON ? { studentId: list[0].studentId, score: list[0].score, runnerUp: list[1]?.score ?? 0 } : null;
      const d = decide(m, kind);
      count(t, p.truth, d, list[0]?.studentId);
      if (k === 3 && d.how === "sure" && d.pick !== p.truth && kind === KINDS.at(-1)) mistakes.push(`${p.truth ? "named person" : "stranger"} ${p.s.person}: "${title(p.s.file)}" named as ${d.pick} (${m.score.toFixed(2)}, next ${m.runnerUp.toFixed(2)})`);
      if (k === 3 || k === 5) {
        // Raw cosine of the best and second-best person, three ways of
        // comparing with a person's confirmed faces: the closest one (what
        // the app does), the average of the two closest, and their average face.
        const e = p.s.face.emb[kind];
        const per = new Map();
        for (const g of known) (per.get(g.studentId) ?? per.set(g.studentId, []).get(g.studentId)).push(g.embedding);
        const aggs = {
          max: (list) => Math.max(...list.map((x) => F.cosine(e, x))),
          top2: (list) => {
            const v = list.map((x) => F.cosine(e, x)).sort((a, b) => b - a);
            return v.length > 1 ? (v[0] + v[1]) / 2 : v[0];
          },
          centre: (list) => {
            const c = new Float32Array(e.length);
            for (const x of list) x.forEach((v, i) => (c[i] += v));
            return F.cosine(e, unit(c));
          },
          // half the closest confirmed face, half the person's average face
          blend: (list) => {
            const c = new Float32Array(e.length);
            for (const x of list) x.forEach((v, i) => (c[i] += v));
            return 0.5 * Math.max(...list.map((x) => F.cosine(e, x))) + 0.5 * F.cosine(e, unit(c));
          },
        };
        for (const [agg, fn] of Object.entries(aggs)) {
          const sorted = [...per.entries()].map(([id, list]) => [id, fn(list)]).sort((a, b) => b[1] - a[1]);
          (raw[`${kind}|${agg}|${k}`] ??= []).push({ truth: p.truth, top: sorted[0]?.[0], s1: sorted[0]?.[1] ?? -1, s2: sorted[1]?.[1] ?? -1, px: p.s.face.box[2] * p.s.size[0], sharp: p.s.face.sharpness });
        }
      }
    }
    results.singles[kind][k] = t;
  }
}

// ---- 3b. Class-sized test: the app matches a class photo against that
// class (about 30 students), not the whole school. 20 random "classes" of 30
// named people; every stranger's face is tried against every class.
// Ways tested (env BENCH_* changes the numbers):
//  plain:  only the hand-named (confirmed) faces.
//  learn:  faces the app named by itself become extra known faces (kept apart
//          from hand-named ones), and the rest are matched again, up to 4
//          rounds. A name needs the hand-named faces to agree too (their own
//          top pick, raw score >= handMin, lead >= handLead), and a face is
//          only learned from when its raw score is >= addMin.
//  app:    the app's own rules (faces.ts learnFrom and handAgrees), on the
//          app's own recogniser ("both").
//  (Same-event naming was tried on 6 Nov 2026: under 1% more on these photos.)
const LEARN_HAND = Number(process.env.BENCH_LEARN_HAND ?? 0.3);
const WAYS = {
  plain: null,
  learn: { addMin: -1, handMin: LEARN_HAND, handLead: 0 },
  strict: { addMin: Number(process.env.BENCH_ADD_MIN ?? 0.55), handMin: Number(process.env.BENCH_HAND_MIN ?? 0.4), handLead: Number(process.env.BENCH_HAND_LEAD ?? 0.04) },
  app: { app: true },
  // the app's rules, and also: a face nearly identical (raw score) to a
  // learned example of that person is named even when the hand-named faces
  // alone wouldn't have picked them
  "app+0.60": { app: true, strong: 0.6 },
  "app+0.55": { app: true, strong: 0.55 },
  "app+0.50": { app: true, strong: 0.5 },
};
// Why faces stay unnamed (class of 30, the app's rules): for each face of a
// named person, what stopped it.
const whyNot = {};
const classResults = {};
const classKinds = KINDS;
function bestPer(e, known) {
  const best = new Map();
  for (const g of known) {
    const v = F.cosine(e, g.embedding);
    if (v > (best.get(g.studentId) ?? -1)) best.set(g.studentId, v);
  }
  return [...best.entries()].sort((x, y) => y[1] - x[1]);
}
for (const kind of classKinds) {
  const rk = base(kind);
  for (const k of [3, 5]) {
    for (const [way, opt] of Object.entries(WAYS)) {
      if (way === "strict" && kind !== "both") continue;
      if (way === "app" && !kind.startsWith("both")) continue;
      if (way.startsWith("app+") && kind !== "both") continue;
      const t = { n: 0, right: 0, wrong: 0, strangers: 0, strangerNamed: 0, byEvent: 0, wrongList: [] };
      const cr = rng(1000 + k);
      for (let trial = 0; trial < 20; trial++) {
        const cls = shuffle(named, cr).slice(0, 30);
        const hand = [];
        for (const p of cls) for (const x of byPerson.get(p).slice(0, k)) hand.push({ studentId: p, embedding: x.face.emb[kind] });
        const items = [];
        const more = (x) => ({ px: x.face.px ?? x.face.box[2] * x.size[0], sharp: x.face.sharpness });
        for (const p of cls) for (const x of byPerson.get(p).slice(5, 35)) items.push({ truth: p, e: x.face.emb[kind], file: x.file, ...more(x) });
        for (const p of strangers) for (const x of byPerson.get(p).slice(0, 15)) items.push({ truth: null, e: x.face.emb[kind], file: x.file, ...more(x) });
        if (way === "plain")
          for (const it of items) {
            const sorted = bestPer(it.e, hand);
            (raw[`${kind}|class|${k}`] ??= []).push({ truth: it.truth, top: sorted[0][0], s1: sorted[0][1], s2: sorted[1]?.[1] ?? -1 });
          }
        const learned = [];
        const name = new Map(); // item index -> name
        const how = new Map();
        for (let round = 0; round < (opt ? 4 : 1); round++) {
          let added = 0;
          items.forEach((it, i) => {
            if (name.has(i)) return;
            const list = F.ranked(it.e, opt ? [...hand, ...learned] : hand, rk);
            const m = list.length && list[0].score >= F.SAME_PERSON ? { studentId: list[0].studentId, score: list[0].score, runnerUp: list[1]?.score ?? 0 } : null;
            if (!m || !F.isSure(m, rk)) return;
            m.raw = F.unscaled(m.score, rk);
            if (opt?.app) {
              if (!F.handAgrees(it.e, [...hand, ...learned], m.studentId, rk, { strong: opt.strong })) return;
            } else if (opt) {
              const own = bestPer(it.e, hand);
              if (own[0]?.[0] !== m.studentId || own[0][1] < opt.handMin || own[0][1] - (own[1]?.[1] ?? -1) < opt.handLead) return;
            }
            name.set(i, m.studentId);
            if (opt && (opt.app ? F.learnFrom(m.raw) : m.raw >= opt.addMin)) {
              learned.push({ studentId: m.studentId, embedding: it.e, learned: true });
              added++;
            }
          });
          if (!added) break;
        }
        if (way === "app" && kind === KINDS.at(-1))
          items.forEach((it, i) => {
            if (!it.truth || name.has(i)) return;
            const w = (whyNot[k] ??= { n: 0, reasons: {}, px: {}, sharp: {} });
            w.n++;
            const all = bestPer(it.e, [...hand, ...learned]);
            const own = bestPer(it.e, hand);
            const reason =
              all[0][0] !== it.truth
                ? own[0][0] === it.truth ? "learned faces point to someone else" : "first guess is someone else"
                : all[0][1] < F.unscaled(0.62, rk) - 1e-9
                  ? `right person, score too low (${all[0][1] < 0.3 ? "under 0.30" : all[0][1] < 0.38 ? "0.30-0.38" : "0.38-0.45"})`
                  : all[0][1] - (all[1]?.[1] ?? -1) < 0.06
                    ? "right person, too close to the next"
                    : "right person, but the hand-named faces alone disagree";
            w.reasons[reason] = (w.reasons[reason] ?? 0) + 1;
            // does it look like ANY other photo filed under this person?
            let own2 = -1;
            for (const x of byPerson.get(it.truth)) if (x.face.emb[kind] !== it.e) own2 = Math.max(own2, F.cosine(it.e, x.face.emb[kind]));
            const o2 = own2 < 0.3 ? "like no other photo of the person (under 0.30)" : own2 < 0.45 ? "weakly like another photo (0.30-0.45)" : "clearly like another photo (0.45 up)";
            (w.own ??= {})[o2] = (w.own[o2] ?? 0) + 1;
            const px = it.px < 90 ? "under 90 px" : it.px < 150 ? "90-150 px" : it.px < 250 ? "150-250 px" : "250 px up";
            w.px[px] = (w.px[px] ?? 0) + 1;
            const sh = it.sharp < 50 ? "sharpness under 50" : it.sharp < 200 ? "50-200" : "200 up";
            w.sharp[sh] = (w.sharp[sh] ?? 0) + 1;
          });
        items.forEach((it, i) => {
          const nm = name.get(i);
          if (it.truth) {
            t.n++;
            if (nm === it.truth) t.right++;
            else if (nm) {
              t.wrong++;
              t.wrongList.push(`${it.truth}: "${title(it.file)}" named as ${nm}`);
            }
          } else {
            t.strangers++;
            if (nm) {
              t.strangerNamed++;
              t.wrongList.push(`stranger ${title(it.file)} named as ${nm}`);
            }
          }
        });
      }
      classResults[`${kind}|${k}|${way}`] = t;
    }
  }
}

// ---- 4. Made-up group photos ------------------------------------------------
const gdir = path.join(photos, "groups");
await mkdir(gdir, { recursive: true });
const groupTruth = [];
const W = 2400, H = 1600;
const pool = usablePeople.map((p) => ({ p, list: byPerson.get(p).slice(strangers.has(p) ? 0 : 3) })).filter((x) => x.list.length);
for (let g = 0; g < GROUPS && pool.length >= 8; g++) {
  const rows = 2;
  const perRow = 5 + Math.floor(r() * 3);
  const who = shuffle(pool, r).slice(0, rows * perRow);
  const bgSrc = who[0].list[Math.floor(r() * who[0].list.length)];
  const bg = await sharp(bgSrc.file).rotate().resize(W, H, { fit: "cover" }).blur(30).modulate({ brightness: 0.75 }).toBuffer();
  const layers = [];
  const truth = [];
  for (const [i, w] of who.entries()) {
    const s = w.list[Math.floor(r() * w.list.length)];
    const row = Math.floor(i / perRow), col = i % perRow;
    const roll = r();
    const look = roll < 0.15 ? "tiny" : roll < 0.3 ? "blurred" : "normal";
    const slot = W / perRow;
    const target = look === "tiny" ? 22 + r() * 10 : slot * (0.3 + r() * 0.08) * (row === 0 ? 0.9 : 1);
    const [sw, sh] = s.size;
    const [fx, fy, fw, fh] = [s.face.box[0] * sw, s.face.box[1] * sh, s.face.box[2] * sw, s.face.box[3] * sh];
    const left = Math.max(0, Math.round(fx - fw * 0.7)), top = Math.max(0, Math.round(fy - fh * 0.6));
    const cw = Math.min(sw - left, Math.round(fw * 2.4)), ch = Math.min(sh - top, Math.round(fh * 2.6));
    if (cw < fw || ch < fh) continue;
    const scale = target / fw;
    const outW = Math.max(8, Math.round(cw * scale)), outH = Math.max(8, Math.round(ch * scale));
    const seen = await sharp(s.file, { failOn: "none" }).rotate().resize(sw, sh).toBuffer();
    let img = sharp(await sharp(seen).extract({ left, top, width: cw, height: ch }).toBuffer()).resize(outW, outH);
    if (look === "blurred") img = img.blur(Math.max(2, target * 0.06));
    const buf = await img.jpeg({ quality: 92 }).toBuffer();
    const cx = slot * (col + 0.5) + (r() - 0.5) * slot * 0.15;
    const baseY = row === 0 ? H * 0.22 : H * 0.55;
    const x = Math.round(Math.min(W - outW, Math.max(0, cx - outW / 2)));
    const y = Math.round(Math.min(H - outH, Math.max(0, baseY + (r() - 0.5) * 60)));
    layers.push({ input: buf, left: x, top: y });
    const bx = x + (fx - left) * scale, by = y + (fy - top) * scale;
    truth.push({ person: w.p, stranger: strangers.has(w.p), look, box: [bx / W, by / H, (fw * scale) / W, (fh * scale) / H] });
  }
  const file = path.join(gdir, `group-${String(g).padStart(2, "0")}.jpg`);
  await sharp(bg).composite(layers).jpeg({ quality: 90 }).toFile(file);
  groupTruth.push({ file, truth });
}

// ---- 4a. Big class photos: 6000 x 4000 px, as a photographer's camera
// gives, three rows of ten. Each face is 150-200 px wide in the photo
// itself, and only 50-67 px on the 2000 px copy the face finder looks at.
// Faces are never enlarged: only sources with a face that big are used.
const bigTruth = [];
{
  const BW = 6000, BH = 4000;
  const bigPool = usablePeople.map((p) => ({ p, list: byPerson.get(p).slice(strangers.has(p) ? 0 : 3).filter((x) => x.face.box[2] * x.size[0] >= 130) })).filter((x) => x.list.length);
  for (let g = 0; g < BIG && bigPool.length >= 20; g++) {
    const perRow = 10;
    const who = shuffle(bigPool, r).slice(0, 3 * perRow);
    const bgSrc = who[0].list[0];
    const bg = await sharp(bgSrc.file).rotate().resize(BW, BH, { fit: "cover" }).blur(30).modulate({ brightness: 0.75 }).toBuffer();
    const layers = [], truth = [];
    for (const [i, w] of who.entries()) {
      const s = w.list[Math.floor(r() * w.list.length)];
      const row = Math.floor(i / perRow), col = i % perRow;
      const slot = BW / perRow;
      const [sw, sh] = s.size;
      const [fx, fy, fw, fh] = [s.face.box[0] * sw, s.face.box[1] * sh, s.face.box[2] * sw, s.face.box[3] * sh];
      const target = Math.min(fw, 150 + r() * 50);
      const left = Math.max(0, Math.round(fx - fw * 0.7)), top = Math.max(0, Math.round(fy - fh * 0.6));
      const cw = Math.min(sw - left, Math.round(fw * 2.4)), ch = Math.min(sh - top, Math.round(fh * 2.6));
      if (cw < fw || ch < fh) continue;
      const scale = target / fw;
      const outW = Math.max(8, Math.round(cw * scale)), outH = Math.max(8, Math.round(ch * scale));
      const seen = await sharp(s.file, { failOn: "none" }).rotate().resize(sw, sh).toBuffer();
      const buf = await sharp(await sharp(seen).extract({ left, top, width: cw, height: ch }).toBuffer()).resize(outW, outH).jpeg({ quality: 93 }).toBuffer();
      const cx = slot * (col + 0.5) + (r() - 0.5) * slot * 0.1;
      const x = Math.round(Math.min(BW - outW, Math.max(0, cx - outW / 2)));
      const y = Math.round(Math.min(BH - outH, Math.max(0, BH * (0.08 + row * 0.3) + (r() - 0.5) * 80)));
      layers.push({ input: buf, left: x, top: y });
      truth.push({ person: w.p, stranger: strangers.has(w.p), look: "normal", box: [(x + (fx - left) * scale) / BW, (y + (fy - top) * scale) / BH, (fw * scale) / BW, (fh * scale) / BH] });
    }
    const file = path.join(gdir, `big-${String(g).padStart(2, "0")}.jpg`);
    await sharp(bg).composite(layers).jpeg({ quality: 90 }).toFile(file);
    bigTruth.push({ file, truth });
  }
}

const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};
// "Unsure" faces (the face finder's confidence below F.UNSURE_SCORE) that
// pass every other check: would they be safe to name, with a stricter rule?
const softItems = [];
const softOk = (f, a, minScore) =>
  f.why === "unsure" && f.landmarks && F.faceProblem({ box: [f.box[0] * a.width, f.box[1] * a.height, f.box[2] * a.width, f.box[3] * a.height], score: f.score, landmarks: f.landmarks }, f.sharpness, a.width, a.height, { minScore }) === null;
function softItem(where, truth, f, known, kind) {
  const list = F.ranked(f.emb[kind], known, base(kind));
  if (!list.length) return;
  const m = { studentId: list[0].studentId, score: list[0].score, runnerUp: list[1]?.score ?? 0 };
  softItems.push({ where, truth, score: f.score, sure: F.isSure(m, base(kind)), raw: F.unscaled(m.score, base(kind)), pick: m.studentId });
}
// Three ways: as 0.11 did everything; the new reading with 0.11's plain
// lead; and the app now (new reading, and "one person per photo" used to
// sharpen each lead).
const GWAYS = auraFile
  ? [
      { label: "0.11", kind: "both@v1", legacy: true, plain: true },
      { label: "new reading only", kind: "both", plain: true },
      { label: "app now", kind: "both" },
    ]
  : [{ label: "sface", kind: "sface" }];
const groupCache = new Map();
const scoreCells = {}; // what the finder's two looks said, by kind of face
function scoreCell(what, f) {
  if (f.zoomScore === undefined) return;
  const d = f.score >= F.UNSURE_SCORE ? "sure" : "unsure";
  const z = f.zoomScore == null ? "none" : f.zoomScore >= F.UNSURE_SCORE ? "sure" : f.zoomScore >= 0.6 ? "mid" : "low";
  ((scoreCells[what] ??= {})[`${d}/${z}`] ??= 0), scoreCells[what][`${d}/${z}`]++;
}
async function evalGroups(list, into) {
  for (const way of GWAYS) {
    const kind = way.kind;
    const last = way === GWAYS.at(-1);
    const known = gallery(kind, 3);
    const g = { normal: tally(), found: 0, usable: 0, clear: 0, faces: 0, tinyNamed: 0, tiny: 0, blurNamed: 0, blurred: 0, blurUsable: 0, extra: 0, extraNamed: 0, twice: 0 };
    for (const { file, truth } of list) {
      const ck = `${file}|${way.legacy ? "legacy" : "new"}`;
      const a = groupCache.get(ck) ?? (await analyse(file, way.legacy ? { legacy: true } : {}));
      groupCache.set(ck, a);
      const embOf = (f) => f.emb.both ?? f.emb.sface;
      const free = a.faces.map((f) => (f.usable ? embOf(f) : null));
      const matches = F.assignPhoto(free, known, base(kind), new Set(), undefined, { plain: !!way.plain });
      const decisions = matches.map((m) => decide(m, kind));
      const usedTruth = new Set();
      const names = decisions.filter((d) => d.pick).map((d) => d.pick);
      if (new Set(names).size !== names.length) g.twice++;
      a.faces.forEach((f, i) => {
        let best = -1, bi = -1;
        truth.forEach((t, j) => {
          const v = iou(f.box, t.box);
          if (v > best && !usedTruth.has(j)) [best, bi] = [v, j];
        });
        const cell = (what) => last && scoreCell(what, f);
        if (best < 0.3) {
          g.extra++;
          cell("not a real face");
          if (decisions[i].pick) g.extraNamed++;
          if (last && softOk(f, a, 0.5)) softItem("group photos", "extra", f, known, kind);
          return;
        }
        usedTruth.add(bi);
        const t = truth[bi];
        cell(t.look === "normal" ? (into === "big" ? "big photo face" : "normal face") : t.look);
        if (last && softOk(f, a, 0.5)) softItem("group photos", t.look !== "normal" ? t.look : t.stranger ? null : t.person, f, known, kind);
        if (t.look === "tiny") {
          if (decisions[i].pick) g.tinyNamed++;
        } else if (t.look === "blurred") {
          if (f.usable) g.blurUsable++;
          if (decisions[i].pick) g.blurNamed++;
        } else {
          g.found++;
          if (f.usable) g.usable++;
          if (f.usable && F.clearEnough(f.px ?? f.box[2] * a.width, f.sharpness)) g.clear++;
          count(g.normal, t.stranger ? null : t.person, decisions[i], matches[i]?.studentId);
        }
      });
      for (const t of truth) {
        if (t.look === "tiny") g.tiny++;
        else if (t.look === "blurred") g.blurred++;
        else g.faces++;
      }
      // Normal faces the finder missed still count as "nothing" for the named ones.
    }
    (results[into] ??= {})[way.label] = g;
  }
}
await evalGroups(groupTruth, "groups");
await evalGroups(bigTruth, "big");

// ---- 4b. Hard cases: the same test faces made harder, then found and
// matched by the app's own code (3 confirmed faces each, whole set, so
// harder than a class of 30). Each kind of trouble on its own:
//   mask, sunglasses, hat, hand: part of the face covered
//   dark: low light (dim and grainy); motion: camera or student moving
//   small: a face at the back of a crowd (about 40 px wide)
// A good result: as many named right as possible, none named wrong, and
// faces too damaged to trust kept as "not usable" rather than guessed.
const HARD = (process.env.BENCH_HARD ?? "mask,sunglasses,hat,hand,dark,motion,small").split(",").filter(Boolean);
// Suggestions (not sure names) with the face's size and sharpness, for
// "what a shown score means" on hard faces.
const quality = [];
const hardResults = {};
if (HARD.length) {
  const hardKind = KINDS.at(-1);
  const known = gallery(hardKind, 3);
  const hardProbes = [];
  for (const p of usablePeople) for (const s of byPerson.get(p).slice(strangers.has(p) ? 0 : 5, strangers.has(p) ? 4 : 11)) hardProbes.push({ truth: strangers.has(p) ? null : p, s });
  const noise = (w, h, seed) => {
    const rr = rng(seed);
    const b = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = Math.floor(rr() * 255);
      b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = v;
      b[i * 4 + 3] = 22;
    }
    return sharp(b, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  };
  const rect = (w, h, colour, round = 0) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${round}" fill="${colour}"/></svg>`);
  const ellipse = (w, h, colour) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${colour}"/></svg>`);
  async function variant(s, how, seed) {
    const [sw, sh] = s.size;
    const [fx, fy, fw, fh] = [s.face.box[0] * sw, s.face.box[1] * sh, s.face.box[2] * sw, s.face.box[3] * sh];
    const left = Math.max(0, Math.round(fx - fw * 0.7)), top = Math.max(0, Math.round(fy - fh * 0.7));
    const cw = Math.min(sw - left, Math.round(fw * 2.4)), ch = Math.min(sh - top, Math.round(fh * 2.6));
    const seen = await sharp(s.file, { failOn: "none" }).rotate().resize(sw, sh).toBuffer();
    let img = await sharp(seen).extract({ left, top, width: cw, height: ch }).toBuffer();
    // keep crops modest, as a face in an ordinary photo would be
    const k = Math.min(1, 700 / Math.max(cw, ch));
    const W = Math.max(16, Math.round(cw * k)), Hh = Math.max(16, Math.round(ch * k));
    img = await sharp(img).resize(W, Hh).toBuffer();
    const X = (fx - left) * k, Y = (fy - top) * k, FW = fw * k, FH = fh * k;
    const at = (x, y) => ({ left: Math.max(0, Math.round(x)), top: Math.max(0, Math.round(y)) });
    const clip = (w, h, x, y) => [Math.max(1, Math.min(Math.round(w), W - Math.max(0, Math.round(x)))), Math.max(1, Math.min(Math.round(h), Hh - Math.max(0, Math.round(y))))];
    const over = async (svg, x, y, w, h) => {
      const [cw2, ch2] = clip(w, h, x, y);
      return sharp(img).composite([{ input: await sharp(svg).resize(cw2, ch2, { fit: "fill" }).png().toBuffer(), ...at(x, y) }]).toBuffer();
    };
    if (how === "mask") img = await over(rect(100, 100, "#a9c6dd", 30), X + FW * 0.05, Y + FH * 0.55, FW * 0.9, FH * 0.5);
    if (how === "sunglasses") img = await over(rect(100, 30, "#111", 12), X + FW * 0.08, Y + FH * 0.22, FW * 0.84, FH * 0.24);
    if (how === "hat") img = await over(rect(100, 100, "#7a2e2e", 8), X - FW * 0.25, Y - FH * 0.6, FW * 1.5, FH * 0.78);
    if (how === "hand") img = await over(ellipse(100, 140, "#c99a7b"), X + FW * (seed % 2 ? 0.55 : -0.15), Y + FH * 0.35, FW * 0.6, FH * 0.75);
    if (how === "dark") img = await sharp(await sharp(img).linear(0.35, 0).toBuffer()).composite([{ input: await noise(W, Hh, seed), left: 0, top: 0 }]).toBuffer();
    if (how === "motion") {
      const n = Math.max(5, Math.round(FW * 0.09)) | 1;
      // (sharp needs at least 3 rows: a blur along the middle one only)
      img = await sharp(img).convolve({ width: n, height: 3, kernel: [...Array(n).fill(0), ...Array(n).fill(1), ...Array(n).fill(0)], scale: n }).toBuffer();
    }
    if (how === "small") {
      const k2 = 40 / FW;
      img = await sharp(img).resize(Math.max(16, Math.round(W * k2)), Math.max(16, Math.round(Hh * k2))).toBuffer();
      return { buf: await sharp(img).jpeg({ quality: 85 }).toBuffer(), box: [X / W, Y / Hh, FW / W, FH / Hh] };
    }
    return { buf: await sharp(img).jpeg({ quality: 88 }).toBuffer(), box: [X / W, Y / Hh, FW / W, FH / Hh] };
  }
  for (const how of HARD) {
    const t = { n: 0, found: 0, usable: 0, right: 0, wrong: 0, suggestRight: 0, strangers: 0, strangerNamed: 0, why: {}, wrongList: [] };
    for (const [i, p] of hardProbes.entries()) {
      const key = `hard|${how}|${path.relative(photos, p.s.file)}`;
      let a = cache.get(key);
      if (!a) {
        try {
          const v = await variant(p.s, how, i);
          a = { ...(await analyse(v.buf)), target: v.box };
        } catch (e) {
          continue;
        }
        cache.set(key, a);
      }
      if (p.truth) t.n++;
      else t.strangers++;
      // the face we made harder: the found face that overlaps it most
      let best = null, bi = 0.25;
      for (const f of a.faces) {
        const v = iou(f.box, a.target);
        if (v > bi) [best, bi] = [f, v];
      }
      if (!best) continue;
      scoreCell(`hard: ${how}`, best);
      if (p.truth) t.found++;
      if (!best.usable) {
        t.why[best.why] = (t.why[best.why] ?? 0) + 1;
        if (softOk(best, a, 0.5)) softItem(how, p.truth, best, known, hardKind);
        continue;
      }
      if (p.truth) t.usable++;
      const list = F.ranked(best.emb[hardKind], known, base(hardKind));
      const m = list.length && list[0].score >= F.SAME_PERSON ? { studentId: list[0].studentId, score: list[0].score, runnerUp: list[1]?.score ?? 0 } : null;
      const d = decide(m, hardKind);
      if (d.how !== "sure" && list[0]) {
        const raw2 = list[1] ? F.unscaled(list[1].score, base(hardKind)) : -1;
        quality.push({ where: how, shown: list[0].score, lead: F.unscaled(list[0].score, base(hardKind)) - raw2, right: !!p.truth && list[0].studentId === p.truth, px: best.box[2] * (a.width ?? 0), sharp: best.sharpness });
      }
      if (p.truth) {
        if (d.how === "sure") d.pick === p.truth ? t.right++ : (t.wrong++, t.wrongList.push(`${how}: ${p.truth} "${title(p.s.file)}" named as ${d.pick}`));
        else if (d.how === "suggest" && d.pick === p.truth) t.suggestRight++;
      } else if (d.how === "sure") {
        t.strangerNamed++;
        t.wrongList.push(`${how}: stranger ${p.s.person} "${title(p.s.file)}" named as ${d.pick}`);
      }
    }
    hardResults[how] = t;
  }
  await saveCache();
}

// ---- 5. Fair comparison: the most faces named by themselves with at most
// 0.5% of all test faces named wrongly, each way at its own best setting.
const q = (v, f) => {
  const a = [...v].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2) : "–";
};
for (const [key, list] of Object.entries(raw)) {
  const all = list.length;
  const genuine = list.filter((x) => x.truth);
  let best = null;
  for (let sure = 0.15; sure <= 0.85; sure += 0.01) {
    for (const gap of [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
      let right = 0, wrong = 0;
      for (const x of list) {
        if (x.s1 < sure || x.s1 - x.s2 < gap) continue;
        x.truth && x.top === x.truth ? right++ : wrong++;
      }
      if (wrong <= all * 0.005 && (!best || right > best.right)) best = { sure: +sure.toFixed(2), gap, right, wrong };
    }
  }
  results.sweep[key] = {
    rank1: pct(genuine.filter((x) => x.top === x.truth).length, genuine.length),
    best,
    autoPct: best ? pct(best.right, genuine.length) : "–",
    // where the right person's score sits, and where a stranger's best score sits
    genuine: [0.1, 0.5].map((f) => q(genuine.filter((x) => x.top === x.truth).map((x) => x.s1), f)),
    stranger: [0.5, 0.99].map((f) => q(list.filter((x) => !x.truth).map((x) => x.s1), f)),
  };
}

// ---- 5b. Settings to choose from: how many faces each "named by itself"
// setting would name, and how many wrongly (named people and strangers).
const grid = {};
for (const key of Object.keys(raw).filter((k) => k.includes("|max|3") || (k.includes("|class|") && (k.startsWith(KINDS.at(-1)) || k.startsWith("aura+flip"))))) {
  const list = raw[key];
  const genuine = list.filter((x) => x.truth).length;
  grid[key] = [];
  for (const sure of [0.38, 0.4, 0.42, 0.45, 0.48, 0.5, 0.55, 0.6])
    for (const gap of [0.04, 0.06, 0.08, 0.1, 0.14]) {
      let right = 0, wrong = 0, stranger = 0;
      for (const x of list) {
        if (x.s1 < sure || x.s1 - x.s2 < gap) continue;
        if (!x.truth) stranger++;
        else x.top === x.truth ? right++ : wrong++;
      }
      grid[key].push({ sure, gap, right: pct(right, genuine), wrong, stranger });
    }
}

// ---- 5c. What a shown score means: of the faces NOT named by the app
// itself, how often is the top suggestion right, by shown score (strangers
// count as wrong). This is what a suggestion's label should be based on.
const calib = {};
for (const key of Object.keys(raw).filter((k) => k.startsWith(`${KINDS.at(-1)}|`) && (k.includes("|max|") || k.includes("|class|")))) {
  const r = base(KINDS.at(-1));
  const bands = [0.4, 0.45, 0.5, 0.55, 0.58, 0.6, 0.62, 1.01];
  calib[key] = [];
  for (let b = 0; b < bands.length - 1; b++) {
    for (const lead of [0, 0.04, 0.08]) {
      let right = 0, n = 0;
      for (const x of raw[key]) {
        const shown = F.scaled(x.s1, r), next = F.scaled(x.s2, r);
        if (F.isSure({ score: shown, runnerUp: next }, r)) continue;
        if (shown < bands[b] || shown >= bands[b + 1] || x.s1 - x.s2 < lead) continue;
        n++;
        if (x.truth && x.top === x.truth) right++;
      }
      calib[key].push({ from: bands[b], to: Math.min(1, bands[b + 1]), lead, n, right });
    }
  }
}

// ---- 6. Report ---------------------------------------------------------------
const L = [];
L.push(`# Face test on stand-in photos`, "");
L.push(`${scanned} photos of ${people.length} people read in ${scanSeconds.toFixed(0)} s. ${noFace} had no usable face, ${crowded} were crowds (left out), ${dropped} dropped as far from the person's other photos or near-copies, ${misfiled} more because they look more like someone else.`);
L.push(`${usablePeople.length} people with enough photos: ${named.length} named (like students), ${strangers.size} never named (like parents and visitors). ${probes.length} test faces. Group photos: ${groupTruth.length}.`, "");
L.push(`## Single photos`, "");
L.push(`| Recogniser | Confirmed faces each | Right first guess | Named by itself: right | Named by itself: WRONG | Suggested: right | Suggested: wrong | Nothing | Strangers named by itself | Strangers suggested |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|`);
for (const kind of KINDS)
  for (const k of [1, 3, 5]) {
    const t = results.singles[kind][k];
    L.push(`| ${kind} | ${k} | ${pct(t.rank1, t.n)} | ${pct(t.sureRight, t.n)} | ${pct(t.sureWrong, t.n)} | ${pct(t.sugRight, t.n)} | ${pct(t.sugWrong, t.n)} | ${pct(t.none, t.n)} | ${pct(t.strangerSure, t.strangers)} | ${pct(t.strangerSug, t.strangers)} |`);
  }
L.push("", `## Class-sized (30 people, 20 classes)`, "");
L.push(`plain = confirmed faces only; learn = also learns from its own sure names; strict = learns, with stricter rules; app = the app's own learning rules. both = AuraFace and SFace together (what the app uses).`, "");
L.push(`| Recogniser | Confirmed faces | Way | Named by itself: right | Named WRONG | Strangers named |`);
L.push(`|---|---|---|---|---|---|`);
for (const [key, t] of Object.entries(classResults)) {
  const [kind, k, way] = key.split("|");
  L.push(`| ${kind} | ${k} | ${way} | ${pct(t.right, t.n)} | ${t.wrong} | ${t.strangerNamed} of ${t.strangers} |`);
}
for (const [k, w] of Object.entries(whyNot)) {
  const show = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).map(([name, n]) => `${name} ${pct(n, w.n)}`).join(" · ");
  L.push("", `Why faces stayed unnamed (app, ${k} confirmed faces, ${w.n} faces): ${show(w.reasons)}. By size: ${show(w.px)}. By sharpness: ${show(w.sharp)}. Against all the person's other photos: ${show(w.own ?? {})}.`);
}
const classWrong = [...new Set(Object.entries(classResults).filter(([k]) => k.startsWith(KINDS.at(-1))).flatMap(([, t]) => t.wrongList))];
if (classWrong.length) L.push("", "Wrong in the class test (the app's recogniser):", "", ...classWrong.slice(0, 20).map((x) => `- ${x}`));
for (const [into, head] of [["groups", "Group photos (2400 px, 3 confirmed faces each)"], ["big", `Big class photos (6000 x 4000 px, 30 faces each 150-200 px wide, ${bigTruth.length} photos)`]]) {
  if (!results[into]) continue;
  L.push("", `## ${head}`, "");
  L.push(`| Way | Normal faces found | Kept as usable | Clear enough to ask about | Named by itself: right | WRONG | Suggested: right | wrong | Strangers named by itself / suggested | Tiny faces named | Blurred kept as usable | Blurred named | Not-real faces found / named | Photos with a name twice |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const [label, g] of Object.entries(results[into])) {
    const t = g.normal;
    L.push(`| ${label} | ${pct(g.found, g.faces)} | ${pct(g.usable, g.faces)} | ${pct(g.clear, g.faces)} | ${pct(t.sureRight, t.n)} | ${pct(t.sureWrong, t.n)} | ${pct(t.sugRight, t.n)} | ${pct(t.sugWrong, t.n)} | ${t.strangerSure} / ${t.strangerSug} of ${t.strangers} | ${g.tinyNamed} of ${g.tiny} | ${g.blurUsable} of ${g.blurred} | ${g.blurNamed} of ${g.blurred} | ${g.extra} / ${g.extraNamed} | ${g.twice} |`);
  }
}
if (Object.keys(scoreCells).length) {
  L.push("", `### The face finder's two looks (whole photo / closer look at the face): faces by what each said`, "");
  for (const [what, cells] of Object.entries(scoreCells)) L.push(`- ${what}: ${Object.entries(cells).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
}
if (Object.keys(hardResults).length) {
  L.push("", `## Hard cases (${KINDS.at(-1)}, 3 confirmed faces each, matched against everyone)`, "");
  L.push(`| Trouble | Face still found | Kept as usable | Named by itself: right | Named WRONG | Suggested right | Strangers named | Why left out |`);
  L.push(`|---|---|---|---|---|---|---|---|`);
  for (const [how, t] of Object.entries(hardResults))
    L.push(`| ${how} | ${pct(t.found, t.n)} | ${pct(t.usable, t.n)} | ${pct(t.right, t.n)} | ${t.wrong} | ${pct(t.suggestRight, t.n)} | ${t.strangerNamed} of ${t.strangers} | ${Object.entries(t.why).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  if (softItems.length) {
    L.push("", `### "Unsure" faces that pass every other check: named right / named WRONG (wrong = another person, a stranger, or a tiny, blurred or not-real face), by lowest finder confidence allowed and extra raw score needed`, "");
    const wheres = [...new Set(softItems.map((x) => x.where))];
    L.push(`| Lowest confidence | Extra score | ${wheres.join(" | ")} |`);
    L.push(`|---|---|${wheres.map(() => "---").join("|")}|`);
    for (const minScore of [0.5, 0.6, 0.7, 0.8])
      for (const extra of [0, 0.05, 0.1]) {
        const cells = wheres.map((w) => {
          let right = 0, wrong = 0;
          for (const x of softItems) {
            if (x.where !== w || x.score < minScore || !x.sure || x.raw < 0.45 + extra) continue;
            x.truth && x.truth === x.pick ? right++ : wrong++;
          }
          const n = w === "group photos" ? null : hardResults[w]?.n;
          return `${n ? pct(right, n) : right} / ${wrong}`;
        });
        L.push(`| ${minScore} | ${extra} | ${cells.join(" | ")} |`);
      }
  }
  const hw = Object.values(hardResults).flatMap((t) => t.wrongList);
  if (hw.length) L.push("", ...hw.slice(0, 30).map((x) => `- ${x}`));
}
L.push("", `## What a shown score means (${KINDS.at(-1)}): faces not named by the app itself, how often the top suggestion is right (shown score band, raw lead over the next person -> right / faces)`, "");
for (const [key, rows] of Object.entries(calib)) {
  const [, how, k] = key.split("|");
  L.push(`- ${how === "class" ? "class of 30" : "whole set"}, ${k} confirmed faces: ${rows.filter((x) => x.n).map((x) => `${Math.round(x.from * 100)}-${Math.round(x.to * 100)}% lead ${x.lead}: ${pct(x.right, x.n)} of ${x.n}`).join(" · ")}`);
}
{
  // Pool: whole set (3 confirmed faces) + hard cases, suggestions only.
  const r = base(KINDS.at(-1));
  const pool = [
    ...(raw[`${KINDS.at(-1)}|max|3`] ?? []).filter((x) => !F.isSure({ score: F.scaled(x.s1, r), runnerUp: F.scaled(x.s2, r) }, r)).map((x) => ({ where: "normal", shown: F.scaled(x.s1, r), lead: x.s1 - x.s2, right: !!x.truth && x.top === x.truth, px: x.px, sharp: x.sharp })),
    ...quality,
  ];
  const cuts = [0, 0.45, 0.5, 0.55, 0.58, 0.6];
  const cell = (list) => cuts.map((c) => { const l = list.filter((x) => x.shown >= c); return `${pct(l.filter((x) => x.right).length, l.length)} of ${l.length}`; }).join(" | ");
  L.push("", `## Suggestions by face (${KINDS.at(-1)}, not named by itself): right / shown, at each lowest shown score`, "");
  L.push(`| Faces | ${cuts.map((c) => `from ${Math.round(c * 100)}%`).join(" | ")} |`, `|---|${cuts.map(() => "---").join("|")}|`);
  for (const w of [...new Set(pool.map((x) => x.where))]) L.push(`| ${w} | ${cell(pool.filter((x) => x.where === w))} |`);
  for (const [a, b] of [[0, 60], [60, 90], [90, 130], [130, 200], [200, 1e9]]) L.push(`| ${a}-${b > 1e8 ? "" : b} px wide | ${cell(pool.filter((x) => x.px >= a && x.px < b))} |`);
  for (const [a, b] of [[0, 25], [25, 50], [50, 100], [100, 200], [200, 1e9]]) L.push(`| sharpness ${a}-${b > 1e8 ? "" : b} | ${cell(pool.filter((x) => x.sharp >= a && x.sharp < b))} |`);
  for (const lead of [0.02, 0.04, 0.06, 0.08]) L.push(`| lead ≥ ${lead} | ${cell(pool.filter((x) => x.lead >= lead))} |`);
}
L.push("", `## Fair comparison (each at its own best setting, at most 0.5% named wrongly)`, "");
L.push(`| Recogniser | Compare with | Confirmed faces | Right first guess | Named by itself | Setting (raw score, lead) | Right person's score (10th pct / median) | Stranger's best score (median / 99th pct) |`);
L.push(`|---|---|---|---|---|---|---|---|`);
for (const [key, v] of Object.entries(results.sweep)) {
  const [kind, agg, k] = key.split("|");
  L.push(`| ${kind} | ${agg} | ${k} | ${v.rank1} | ${v.autoPct} | ${v.best ? `${v.best.sure}, ${v.best.gap}` : "–"} | ${v.genuine.join(" / ")} | ${v.stranger.join(" / ")} |`);
}
for (const [key, rows] of Object.entries(grid)) {
  L.push("", `### Settings for ${key.split("|")[0]} (${key.includes("class") ? `class of 30, ${key.split("|")[2]}` : "whole set, 3"} confirmed faces): raw score, lead -> named right / named wrong / strangers named`, "");
  L.push(rows.map((x) => `${x.sure}/${x.gap}: ${x.right} ${x.wrong} ${x.stranger}`).join(" · "));
}
L.push("", `## Named by itself but WRONG (${KINDS.at(-1)}, 3 confirmed faces): check the photo`, "", ...mistakes.slice(0, 40).map((x) => `- ${x}`));
L.push("", `Faces left out as not usable: ${Object.entries(whyCount).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
L.push("", "Photos: Wikimedia Commons, free licences (CC0 / public domain / CC BY / CC BY-SA); authors and licences in credits.json.");
const report = L.join("\n");
console.log(report);
// The main tables once more at the very end, where the log is quick to read.
{
  const want = ["Single photos", "Class-sized", "Group photos", "Big class photos", "Hard cases", "Fair comparison"];
  const parts = report.split("\n## ").filter((x) => want.some((w) => x.startsWith(w)));
  console.log("\n=== SHORT VERSION ===\n" + parts.map((x) => "## " + x.split("\n### ")[0].split("\n").filter((l) => !/^\| (sface|aura\+flip) /.test(l)).join("\n")).join("\n"));
  for (const [what, cells] of Object.entries(scoreCells)) console.log(`looks, ${what}: ${Object.entries(cells).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  for (const l of L.filter((x) => x.startsWith("Why faces stayed unnamed"))) console.log(l);
  console.log("=== END ===");
}
await writeFile(path.join(photos, "report.md"), report);
await writeFile(path.join(photos, "report.json"), JSON.stringify({ results, raw }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");
