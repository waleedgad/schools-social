import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";
import sharp from "sharp";
import { bookChecks, bookHtml, draftPages, pageCandidates, pageSize, type BookSpec, type Page, type Resolver } from "../core/books";
import { safeName } from "../core/library";
import { exclusive } from "../core/lock";
import { q, type Api, type Ctx } from "./ctx";

// The Yearbooks tab: books kept on this Mac (spec, pages, versions), the
// page editor's questions, AI page texts through the website (titles and
// dates only), the website review (page pictures, the teachers' name checks,
// comments and collected texts), 300 dpi PDFs and flipbooks.
type Row = { id: number; spec: string; pages: string | null; versions: string; updated_at: number };
type Version = { at: number; label: string; pages: Page[]; spec: BookSpec };

export function booksApi(ctx: Ctx): Api {
  const { one, all, run } = q(ctx);
  const s = () => ctx.settings().get() as Record<string, any>;

  function load(id: number) {
    const r = one<Row>("select * from books where id = ?", id);
    if (!r) throw new Error("not-found");
    return { id: r.id, spec: JSON.parse(r.spec) as BookSpec, pages: JSON.parse(r.pages ?? "[]") as Page[], versions: JSON.parse(r.versions || "[]") as Version[], updated: r.updated_at };
  }
  function store(id: number, spec: BookSpec, pages: Page[], undo = true) {
    const before = one<Row>("select spec, pages from books where id = ?", id);
    run("update books set spec = ?, pages = ?, updated_at = ? where id = ?", JSON.stringify(spec), JSON.stringify(pages), Date.now(), id);
    if (undo && before) ctx.remember("book", spec.title ?? "", { kind: "sql", steps: [["update books set spec = ?, pages = ? where id = ?", [before.spec, before.pages, id]]] });
    ctx.push("books");
  }
  const withSchool = (spec: Partial<BookSpec>): BookSpec => ({
    kind: "grade",
    year: "",
    language: s().language === "en" ? "en" : "ar",
    theme: "classic",
    size: "A4",
    bleed: false,
    cropMarks: false,
    cantAppear: "leave",
    leavers: true,
    accent: s().accent,
    cover: { style: "photo" },
    ...spec,
    school: s().schoolName ?? "",
  });

  // The logo inside the app's own window (which only shows hub: and data: pictures).
  const logoData = (spec: BookSpec) => {
    if (!spec.logo || !existsSync(spec.logo)) return null;
    const ext = path.extname(spec.logo).slice(1).toLowerCase();
    return `data:image/${ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext};base64,${readFileSync(spec.logo).toString("base64")}`;
  };

  function list() {
    return all<Row>("select * from books order by updated_at desc").map((r) => {
      const spec = JSON.parse(r.spec) as BookSpec;
      const pages = JSON.parse(r.pages ?? "[]") as Page[];
      return { id: r.id, spec, pages: pages.length, locked: pages.filter((p) => p.locked).length, cover: pages[0]?.photos[0] ?? null, versions: JSON.parse(r.versions || "[]").length, updated: r.updated_at };
    });
  }

  function create(o: Partial<BookSpec>) {
    const spec = withSchool(o);
    if (!spec.title) {
      const who = spec.studentId ? one<{ name_en: string | null; name_ar: string | null }>("select name_en, name_ar from students where id = ?", spec.studentId) : null;
      spec.title = spec.kind === "graduation" ? `Graduation ${who?.name_en ?? who?.name_ar ?? ""}`.trim() : spec.kind === "class" ? `Class ${spec.className}` : spec.kind === "student" ? `${who?.name_en ?? who?.name_ar ?? ""}` : `Yearbook ${spec.grade ?? ""}`.trim();
    }
    const pages = draftPages(ctx.db(), spec);
    const r = run("insert into books (spec, pages, locked, versions, updated_at) values (?, ?, '[]', '[]', ?)", JSON.stringify(spec), JSON.stringify(pages), Date.now());
    ctx.push("books");
    return Number(r.lastInsertRowid);
  }

  // ---------- Pictures of the photos and faces ----------
  const screen: Resolver = { photo: (id) => `hub://preview/${id}`, face: (st) => (st.face ? `hub://face/${st.face}` : st.portrait ? `hub://portrait/${encodeURIComponent(st.id)}` : null), logo: null };

  // For printing: the original file at full size (300 dpi), turned upright,
  // with the faces of students who can't appear pixelated when the book blurs them.
  async function printFile(id: number, spec: BookSpec) {
    const p = one<{ path: string; ext: string }>("select path, ext from photos where id = ?", id);
    if (!p || !existsSync(p.path)) return `hub://preview/${id}`;
    const boxes = spec.cantAppear === "blur"
      ? all<{ x: number; y: number; w: number; h: number }>("select f.x, f.y, f.w, f.h from faces f join students s on s.id = f.student_id where f.photo_id = ? and f.status in ('confirmed', 'manual') and s.can_post = 0", id)
      : [];
    const out = ctx.data(`cache/book/${id}${boxes.length ? "-b" : ""}.jpg`);
    if (!existsSync(out)) {
      await mkdir(path.dirname(out), { recursive: true });
      await exclusive(async () => {
        const base = sharp(p.path, { failOn: "none" }).rotate().resize(4200, 4200, { fit: "inside", withoutEnlargement: true });
        const { data, info } = await base.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
        if (!boxes.length) return writeFile(out, data);
        const parts = await Promise.all(
          boxes.map(async (b) => {
            const left = Math.max(0, Math.round((b.x - b.w * 0.2) * info.width)), top = Math.max(0, Math.round((b.y - b.h * 0.2) * info.height));
            const width = Math.min(info.width - left, Math.round(b.w * 1.4 * info.width)), height = Math.min(info.height - top, Math.round(b.h * 1.4 * info.height));
            const input = await sharp(data).extract({ left, top, width, height }).resize(Math.max(2, Math.round(width / 24)), Math.max(2, Math.round(height / 24))).resize(width, height, { kernel: "cubic" }).blur(Math.max(2, width / 14)).toBuffer();
            return { input, left, top };
          }),
        );
        await writeFile(out, await sharp(data).composite(parts).jpeg({ quality: 92 }).toBuffer());
      });
    }
    return pathToFileURL(out).href;
  }
  async function printResolver(spec: BookSpec, pages: Page[]): Promise<Resolver> {
    const files = new Map<number, string>();
    for (const id of new Set(pages.flatMap((p) => p.photos))) files.set(id, await printFile(id, spec));
    return { photo: (id) => files.get(id) ?? `hub://preview/${id}`, face: screen.face, logo: spec.logo && existsSync(spec.logo) ? pathToFileURL(spec.logo).href : null };
  }

  // A hidden window with the book in it, sized to the page.
  async function withBook<T>(html: string, spec: BookSpec, fn: (w: BrowserWindow) => Promise<T>, pxWidth?: number) {
    const tmp = ctx.data(`book-${Date.now()}.html`);
    writeFileSync(tmp, html);
    const size = pageSize(spec);
    const cssW = (size.mmW / 25.4) * 96, cssH = (size.mmH / 25.4) * 96;
    const zoom = pxWidth ? pxWidth / cssW : 1;
    const w = new BrowserWindow({ show: false, width: Math.ceil(cssW * zoom), height: Math.ceil(cssH * zoom), useContentSize: true, webPreferences: { offscreen: true } });
    try {
      await w.loadFile(tmp);
      w.webContents.setZoomFactor(zoom);
      await w.webContents.executeJavaScript("Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))");
      return await fn(w);
    } finally {
      w.destroy();
      await rm(tmp, { force: true });
    }
  }

  async function pdf(id: number, file?: string) {
    const b = load(id);
    if (!file) {
      const r = await dialog.showSaveDialog(ctx.win()!, { title: "Save the book", defaultPath: path.join(app.getPath("desktop"), `${safeName(b.spec.title ?? "Yearbook")}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    const res = await printResolver(b.spec, b.pages);
    const size = pageSize(b.spec);
    await withBook(bookHtml(ctx.db(), b.spec, b.pages, res), b.spec, async (w) => {
      const out = await w.webContents.printToPDF({ pageSize: { width: size.width, height: size.height }, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
      writeFileSync(file!, out);
    });
    version(id, "PDF saved");
    return { file, pages: b.pages.length };
  }

  // Each page as a picture (for the flipbook and the website review).
  async function pagePictures(id: number, width: number) {
    const b = load(id);
    const out: Buffer[] = [];
    for (const p of b.pages) {
      const html = bookHtml(ctx.db(), { ...b.spec, cropMarks: false, bleed: false }, b.pages, { ...screen, logo: b.spec.logo && existsSync(b.spec.logo) ? pathToFileURL(b.spec.logo).href : null }, { only: p.id });
      out.push(await withBook(html, { ...b.spec, cropMarks: false, bleed: false }, async (w) => (await w.webContents.capturePage()).toJPEG(82), width));
    }
    return { book: b, images: out };
  }

  async function flipbook(id: number) {
    const dir = await ctx.chooseFolder("Folder for the flipbook");
    if (!dir) return null;
    const { book, images } = await pagePictures(id, 1100);
    const folder = path.join(dir, safeName(book.spec.title ?? "Yearbook"));
    await mkdir(path.join(folder, "pages"), { recursive: true });
    for (let i = 0; i < images.length; i++) await writeFile(path.join(folder, "pages", `${String(i + 1).padStart(3, "0")}.jpg`), images[i]);
    const rtl = book.spec.language !== "en";
    await writeFile(path.join(folder, "index.html"), flipbookHtml(book.spec.title ?? "Yearbook", images.length, rtl));
    shell.openPath(path.join(folder, "index.html"));
    return { folder, pages: images.length };
  }

  // ---------- Versions and locked pages ----------
  function version(id: number, label: string) {
    const b = load(id);
    const versions = [...b.versions, { at: Date.now(), label, pages: b.pages, spec: b.spec }].slice(-20);
    run("update books set versions = ? where id = ?", JSON.stringify(versions), id);
    return versions.length;
  }
  function restore(id: number, index: number) {
    const b = load(id);
    const v = b.versions[index];
    if (!v) return;
    version(id, "Before going back");
    store(id, v.spec, v.pages);
  }

  // ---------- The website: AI texts, review, collected texts ----------
  async function aiTexts(id: number) {
    const b = load(id);
    const todo = b.pages.filter((p) => !p.locked);
    if (!todo.length) return 0;
    const r = await ctx.appApi("bookTexts", { title: b.spec.title, year: b.spec.year, pages: todo.map((p) => ({ kind: p.type, title: p.title || p.titleAr, date: p.date })) });
    if (!r?.texts) throw new Error(r?.error === "ai" ? "ai-busy" : "not-signed-in");
    const pages = b.pages.map((p) => {
      const i = todo.indexOf(p);
      if (i < 0) return p;
      const t = r.texts[i] ?? {};
      return { ...p, title: p.type === "event" || p.type === "trips" || p.type === "sports" || p.type === "firsts" ? t.titleEn || p.title : p.title, titleAr: t.titleAr || p.titleAr, text: t.textEn || p.text, textAr: t.textAr || p.textAr };
    });
    store(id, b.spec, pages);
    return todo.length;
  }

  async function send(id: number) {
    const b = load(id);
    const sb = ctx.client();
    const schoolId = s().schoolId;
    if (!sb || !schoolId) throw new Error("not-signed-in");
    const { images } = await pagePictures(id, 900);
    const macId = `${s().deviceId ?? "mac"}-${id}`;
    const v = version(id, "Sent for review");
    const out: { n: number; title: string; image: string; students: string[]; type: string }[] = [];
    for (let i = 0; i < images.length; i++) {
      const p = b.pages[i];
      const storagePath = `${schoolId}/books/${macId}/v${v}-${i + 1}.jpg`;
      const { error } = await sb.storage.from("photos").upload(storagePath, images[i], { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error("upload-failed");
      out.push({ n: i + 1, title: p.titleAr || p.title, image: storagePath, students: p.students ?? [], type: p.type });
    }
    const r = await ctx.appApi("book", { macId, title: b.spec.title, kind: b.spec.kind, grade: b.spec.grade, className: b.spec.className, version: v, pages: out });
    if (r?.error) throw new Error(r.error);
    return { pages: out.length, version: v };
  }

  async function review(id: number) {
    const macId = `${s().deviceId ?? "mac"}-${id}`;
    const [r, t] = await Promise.all([ctx.appApi("bookReview", { macId }).catch(() => null), ctx.appApi("bookCollected", { macId }).catch(() => null)]);
    const names = new Map(all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar from students").map((x) => [x.id, x]));
    return {
      sent: !!r?.id || !!r?.version,
      status: r?.status ?? null,
      version: r?.version ?? null,
      checks: (r?.checks ?? []).map((c: Record<string, unknown>) => ({ ...c, student: names.get(String(c.student_code)) ?? null })),
      comments: r?.comments ?? [],
      texts: t?.texts ?? [],
    };
  }

  // A teacher's corrected spelling goes into the class list.
  function fixName(code: string, fixed: string) {
    const arabic = /[؀-ۿ]/.test(fixed);
    return ctx.call("saveStudent", code, arabic ? { name_ar: fixed } : { name_en: fixed });
  }

  // One book per student in a class: each drafted for that student, all into one folder.
  async function studentBooks(id: number) {
    const b = load(id);
    if (!b.spec.className) return null;
    const dir = await ctx.chooseFolder("Folder for the books");
    if (!dir) return null;
    const list = all<{ id: string; name_en: string | null; name_ar: string | null }>("select id, name_en, name_ar from students where class_name = ? and kind = 'student' order by coalesce(name_en, name_ar)", b.spec.className);
    let made = 0;
    for (const st of list) {
      const spec = { ...b.spec, studentId: st.id, title: st.name_en ?? st.name_ar ?? st.id };
      const pages = draftPages(ctx.db(), spec);
      const file = path.join(dir, `${safeName(`${b.spec.className} ${st.name_en ?? st.name_ar ?? st.id}`)}.pdf`);
      ctx.message(`book:${made + 1}/${list.length}`);
      const res = await printResolver(spec, pages);
      const size = pageSize(spec);
      await withBook(bookHtml(ctx.db(), spec, pages, res), spec, async (w) => writeFileSync(file, await w.webContents.printToPDF({ pageSize: { width: size.width, height: size.height }, printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true })))
        .then(() => made++)
        .catch(() => {});
    }
    ctx.message("");
    shell.openPath(dir);
    return { made, total: list.length };
  }

  return {
    books: () => list(),
    bookOptions: () => ({
      years: all<{ year: string }>("select distinct year from photos where year is not null and missing = 0 order by year desc").map((r) => r.year),
      grades: all<{ grade: string }>("select distinct grade from students where grade is not null and kind = 'student' order by case when grade like 'KG%' then 0 else 1 end, cast(replace(replace(grade, 'Grade ', ''), 'KG', '') as integer)").map((r) => r.grade),
      classes: all<{ class_name: string; grade: string | null }>("select distinct class_name, grade from students where class_name is not null and kind = 'student' order by grade, class_name"),
    }),
    newBook: (o: Partial<BookSpec>) => create(o),
    book: (id: number) => {
      const b = load(id);
      return { ...b, versions: b.versions.map((v, i) => ({ i, at: v.at, label: v.label, pages: v.pages.length })) };
    },
    saveBook: (id: number, o: { spec?: Partial<BookSpec>; pages?: Page[] }) => {
      const b = load(id);
      store(id, { ...b.spec, ...(o.spec ?? {}) }, o.pages ?? b.pages);
    },
    redraftBook: (id: number) => {
      const b = load(id);
      store(id, b.spec, draftPages(ctx.db(), b.spec, b.pages));
    },
    deleteBook: (id: number) => {
      const r = one<Row>("select * from books where id = ?", id);
      if (!r) return;
      run("delete from books where id = ?", id);
      ctx.remember("book", "deleted", { kind: "sql", steps: [["insert into books (id, spec, pages, locked, versions, updated_at) values (?, ?, ?, '[]', ?, ?)", [r.id, r.spec, r.pages, r.versions, r.updated_at]]] });
      ctx.push("books");
    },
    bookHtml: (id: number, pageId?: string) => {
      const b = load(id);
      return bookHtml(ctx.db(), b.spec, b.pages, { ...screen, logo: logoData(b.spec) }, { only: pageId, screen: true });
    },
    bookSize: (id: number) => pageSize(load(id).spec),
    bookCandidates: (id: number, pageId: string) => {
      const b = load(id);
      const p = b.pages.find((x) => x.id === pageId);
      return p ? pageCandidates(ctx.db(), b.spec, p) : [];
    },
    bookChecks: (id: number) => {
      const b = load(id);
      return bookChecks(ctx.db(), b.spec, b.pages);
    },
    bookTexts: (id: number) => aiTexts(id),
    bookVersion: (id: number, label: string) => version(id, label),
    bookRestore: (id: number, index: number) => restore(id, index),
    bookPdf: (id: number) => pdf(id),
    bookFlipbook: (id: number) => flipbook(id),
    bookSend: (id: number) => send(id),
    bookReview: (id: number) => review(id),
    bookFixName: (code: string, fixed: string) => fixName(code, fixed),
    bookStudentBooks: (id: number) => studentBooks(id),
    bookLogo: async () => {
      const r = await dialog.showOpenDialog(ctx.win()!, { title: "School logo", properties: ["openFile"], filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "svg"] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const dest = ctx.data(`logo${path.extname(r.filePaths[0])}`);
      await copyFile(r.filePaths[0], dest);
      return dest;
    },
  };
}

// A flipbook: open index.html in any browser; arrows or a click turn pages.
function flipbookHtml(title: string, n: number, rtl: boolean) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title><style>
  body { margin: 0; background: #2b2e35; font-family: -apple-system, "Segoe UI", sans-serif; color: #fff; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
  h1 { font-size: 16px; font-weight: 600; margin: 14px 0 8px; opacity: .8; }
  .book { position: relative; display: flex; perspective: 2400px; margin: 10px; }
  .book img { height: min(82vh, 120vw); max-width: 46vw; object-fit: contain; box-shadow: 0 10px 30px rgba(0,0,0,.4); background: #fff; transition: transform .5s ease, opacity .5s; }
  .book img.turn { transform: rotateY(${rtl ? "" : "-"}80deg); opacity: .2; }
  .nav { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
  button { background: #fff2; color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 15px; cursor: pointer; }
  @media (max-width: 700px) { .book img { max-width: 92vw; } .book img + img { display: none; } }
  </style></head><body><h1>${esc(title)}</h1><div class="book" id="b"></div><div class="nav"><button id="p">‹</button><span id="c"></span><button id="n">›</button></div><script>
  const N = ${n}; let i = 0; const src = (k) => "pages/" + String(k + 1).padStart(3, "0") + ".jpg";
  function draw() { const b = document.getElementById("b"); b.innerHTML = ""; const show = i === 0 ? [0] : [i, i + 1].filter((k) => k < N);
    for (const k of show) { const im = new Image(); im.src = src(k); b.append(im); }
    document.getElementById("c").textContent = (i + 1) + (show.length > 1 ? "–" + (i + 2) : "") + " / " + N; }
  function go(d) { const imgs = document.querySelectorAll(".book img"); imgs.forEach((x) => x.classList.add("turn")); setTimeout(() => { i = d > 0 ? (i === 0 ? 1 : Math.min(N - 1, i + 2)) : (i <= 1 ? 0 : i - 2); draw(); }, 250); }
  document.getElementById("n").onclick = () => go(${rtl ? -1 : 1}); document.getElementById("p").onclick = () => go(${rtl ? 1 : -1});
  document.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") go(${rtl ? -1 : 1}); if (e.key === "ArrowLeft") go(${rtl ? 1 : -1}); });
  document.getElementById("b").onclick = (e) => go((e.clientX > innerWidth / 2) === ${rtl ? "false" : "true"} ? 1 : -1);
  draw();
  </script></body></html>`;
}
