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
const KINDS = auraFile ? ["sface", "aura", "aura+flip"] : ["sface"];
const base = (kind) => kind.split("+")[0];
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
const sessions = { sface: (await F.loadModels(MODELS)).recognizer };
if (auraFile) sessions.aura = (await F.loadModels(MODELS, auraFile)).recognizer;
const { ort } = await F.loadModels(MODELS);
const flipped = (t) => {
  const o = new Float32Array(t.length);
  for (let c = 0; c < 3; c++) for (let y = 0; y < 112; y++) for (let x = 0; x < 112; x++) o[c * 12544 + y * 112 + x] = t[c * 12544 + y * 112 + 111 - x];
  return o;
};
async function describe(kind, tensor) {
  const r = sessions[kind];
  const o = await r.run({ [r.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, 112, 112]) });
  return Float32Array.from(o[r.outputNames[0]].data);
}
const whyCount = {};
async function analyse(file) {
  const found = await F.findFaces(MODELS, file, { aura: auraFile });
  const { data: rgb, info } = await sharp(file, { failOn: "none" })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = [];
  for (const f of found) {
    const emb = {};
    for (const kind of Object.keys(sessions)) {
      const aligned = F.align(rgb, info.width, info.height, f.landmarks, kind);
      const a = await describe(kind, aligned);
      const b = kind === "aura" ? await describe(kind, flipped(aligned)) : null;
      emb[kind] = unit(a);
      if (b) emb[`${kind}+flip`] = unit(Float32Array.from(a, (v, i) => v + b[i]));
    }
    out.push({ box: f.box, score: f.score, usable: f.usable, why: f.why, sharpness: f.sharpness, emb });
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
  .update([F.findFaces, F.align, F.faceProblem, F.faceSharpness, F.decode, F.loadModels].map(String).join("\n") + KINDS.join() + analyse.toString())
  .digest("hex");
const stored = cacheFile && existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, "utf8")) : null;
if (stored?.fingerprint === fingerprint) {
  for (const [k, v] of Object.entries(stored.photos)) {
    for (const f of v.faces) for (const e of Object.keys(f.emb)) f.emb[e] = new Float32Array(new Uint8Array(Buffer.from(f.emb[e], "base64")).buffer);
    cache.set(k, v);
  }
}
async function analyseCached(file) {
  const key = path.relative(photos, file);
  if (!cache.has(key)) cache.set(key, await analyse(file));
  const a = cache.get(key);
  for (const f of a.faces) if (f.why) whyCount[f.why] = (whyCount[f.why] ?? 0) + 1;
  return a;
}
async function saveCache() {
  if (!cacheFile) return;
  const o = {};
  for (const [k, v] of cache) o[k] = { ...v, faces: v.faces.map((f) => ({ ...f, emb: Object.fromEntries(Object.entries(f.emb).map(([e, x]) => [e, Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString("base64")])) })) };
  await writeFile(cacheFile, JSON.stringify({ fingerprint, photos: o }));
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
const cleanKind = auraFile ? "aura" : "sface";
const cut = { sface: 0.25, aura: 0.2 }[cleanKind];
const byPerson = new Map();
for (const s of singles) (byPerson.get(s.person) ?? byPerson.set(s.person, []).get(s.person)).push(s);
let dropped = 0;
for (const [person, list] of byPerson) {
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
const cleanKinds = auraFile ? ["sface", "aura"] : ["sface"];
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
for (const [p, list] of byPerson) {
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
function decide(m) {
  if (!m) return { pick: null, how: "none" };
  if (F.isSure(m)) return { pick: m.studentId, how: "sure" };
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
      const d = decide(m);
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
        };
        for (const [agg, fn] of Object.entries(aggs)) {
          const sorted = [...per.entries()].map(([id, list]) => [id, fn(list)]).sort((a, b) => b[1] - a[1]);
          (raw[`${kind}|${agg}|${k}`] ??= []).push({ truth: p.truth, top: sorted[0]?.[0], s1: sorted[0]?.[1] ?? -1, s2: sorted[1]?.[1] ?? -1 });
        }
      }
    }
    results.singles[kind][k] = t;
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

const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};
for (const kind of KINDS) {
  const known = gallery(kind, 3);
  const g = { normal: tally(), found: 0, faces: 0, tinyNamed: 0, tiny: 0, blurNamed: 0, blurred: 0, blurUsable: 0, extra: 0, extraNamed: 0, twice: 0 };
  for (const { file, truth } of groupTruth) {
    const a = (groupTruth.cache ??= new Map()).get(file) ?? (await analyse(file));
    groupTruth.cache.set(file, a);
    const free = a.faces.map((f) => (f.usable ? f.emb[kind] : null));
    const matches = F.assignPhoto(free, known, base(kind));
    const decisions = matches.map((m) => decide(m));
    const usedTruth = new Set();
    const names = decisions.filter((d) => d.pick).map((d) => d.pick);
    if (new Set(names).size !== names.length) g.twice++;
    a.faces.forEach((f, i) => {
      let best = -1, bi = -1;
      truth.forEach((t, j) => {
        const v = iou(f.box, t.box);
        if (v > best && !usedTruth.has(j)) [best, bi] = [v, j];
      });
      if (best < 0.3) {
        g.extra++;
        if (decisions[i].pick) g.extraNamed++;
        return;
      }
      usedTruth.add(bi);
      const t = truth[bi];
      if (t.look === "tiny") {
        if (decisions[i].pick) g.tinyNamed++;
      } else if (t.look === "blurred") {
        if (f.usable) g.blurUsable++;
        if (decisions[i].pick) g.blurNamed++;
      } else {
        g.found++;
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
  results.groups[kind] = g;
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
L.push("", `## Group photos (3 confirmed faces each)`, "");
L.push(`| Recogniser | Normal faces found | Named by itself: right | WRONG | Suggested: right | wrong | Strangers named | Tiny faces named | Blurred faces kept as usable | Blurred faces named | Not-real faces found / named | Photos with a name twice |`);
L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const kind of KINDS) {
  const g = results.groups[kind];
  const t = g.normal;
  L.push(`| ${kind} | ${pct(g.found, g.faces)} | ${pct(t.sureRight, t.n)} | ${pct(t.sureWrong, t.n)} | ${pct(t.sugRight, t.n)} | ${pct(t.sugWrong, t.n)} | ${pct(t.strangerSure + t.strangerSug, t.strangers)} | ${g.tinyNamed} of ${g.tiny} | ${g.blurUsable} of ${g.blurred} | ${g.blurNamed} of ${g.blurred} | ${g.extra} / ${g.extraNamed} | ${g.twice} |`);
}
L.push("", `## Fair comparison (each at its own best setting, at most 0.5% named wrongly)`, "");
L.push(`| Recogniser | Compare with | Confirmed faces | Right first guess | Named by itself | Setting (raw score, lead) | Right person's score (10th pct / median) | Stranger's best score (median / 99th pct) |`);
L.push(`|---|---|---|---|---|---|---|---|`);
for (const [key, v] of Object.entries(results.sweep)) {
  const [kind, agg, k] = key.split("|");
  L.push(`| ${kind} | ${agg} | ${k} | ${v.rank1} | ${v.autoPct} | ${v.best ? `${v.best.sure}, ${v.best.gap}` : "–"} | ${v.genuine.join(" / ")} | ${v.stranger.join(" / ")} |`);
}
L.push("", `## Named by itself but WRONG (${KINDS.at(-1)}, 3 confirmed faces): check the photo`, "", ...mistakes.slice(0, 40).map((x) => `- ${x}`));
L.push("", `Faces left out as not usable: ${Object.entries(whyCount).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
L.push("", "Photos: Wikimedia Commons, free licences (CC0 / public domain / CC BY / CC BY-SA); authors and licences in credits.json.");
const report = L.join("\n");
console.log(report);
await writeFile(path.join(photos, "report.md"), report);
await writeFile(path.join(photos, "report.json"), JSON.stringify({ results, raw }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");
