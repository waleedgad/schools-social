// Yearbooks: books for a grade or one class, a book for each student, and
// graduation books. The Mac drafts every page; then each page can be
// changed (photos swapped, moved or added, titles and texts in Arabic and
// English, layout), locked when approved, and the book saved as a 300 dpi
// PDF (A4, A5 or square, with bleed and crop marks), as a flipbook, or sent
// to the website for review (class teachers check names on their phones).
const BK = { id: null, page: null, side: "page", wizard: null };
const BOOK_KINDS = () => ({
  grade: [L("Yearbook for a grade", "كتاب سنوي لصف"), "book-open"],
  class: [L("Yearbook for one class", "كتاب سنوي لفصل"), "users"],
  student: [L("A book for each student", "كتاب لكل طالب"), "user"],
  graduation: [L("Graduation book (KG2, Grade 12)", "كتاب التخرج (KG2، الصف 12)"), "graduation-cap"],
});
const PAGE_TYPES = () => ({
  cover: [L("Cover", "الغلاف"), "book"], welcome: [L("Principal's word", "كلمة المدير"), "message-square"], class: [L("Class page", "صفحة الفصل"), "users"],
  teachers: [L("Teachers", "المعلمون"), "presentation"], staff: [L("Staff", "الموظفون"), "briefcase"], event: [L("Event", "فعالية"), "calendar"],
  trips: [L("Trips", "الرحلات"), "map-pin"], sports: [L("Sports", "الرياضة"), "trophy"], firsts: [L("Firsts", "البدايات"), "star"],
  student: [L("My year", "عامي"), "user"], year: [L("A year", "عام"), "calendar"], text: [L("Text page", "صفحة نص"), "type"], end: [L("Last page", "الصفحة الأخيرة"), "flag"],
});
const THEME_NAMES = () => [["classic", L("Classic", "كلاسيكي")], ["bold", L("Bold", "جريء")], ["soft", L("Soft", "ناعم")], ["night", L("Night", "ليلي")]];

App.views.books = {
  async render(main, params = {}) {
    if (params.id) BK.id = params.id;
    if (params.list) BK.id = null;
    if (BK.id) return this.editor(main);
    const list = (await quiet("books")) ?? [];
    main.innerHTML = topbar(L("Yearbooks", "الكتب السنوية"), L("Laid out from your library, printed at 300 dpi", "تُصمم من مكتبتك وتُطبع بدقة 300 نقطة"), `<button class="btn primary" id="bk-new">${icon("plus", 14)} ${L("New book", "كتاب جديد")}</button>`) +
      `<div class="content">${list.length ? `<div class="photos cards">${list.map((b) => `<div class="zcard" data-b="${b.id}">${b.cover ? `<img loading="lazy" src="hub://thumb/${b.cover}" />` : `<div class="zph">${icon(BOOK_KINDS()[b.spec.kind]?.[1] ?? "book-open", 28)}</div>`}
          <div><b>${esc(b.spec.title ?? "")}</b><span>${esc(BOOK_KINDS()[b.spec.kind]?.[0] ?? "")} · ${esc(b.spec.year)} · ${L(`${b.pages} pages`, `${num(b.pages)} صفحة`)}${b.locked ? ` · ${icon("lock", 10)} ${num(b.locked)}` : ""}</span></div></div>`).join("")}</div>`
        : emptyState("book-open", L("No books yet", "لا كتب بعد"), L("Start a yearbook for a grade or a class, a book for each student, or a graduation book. The Mac drafts every page from your library.", "ابدأ كتابًا سنويًا لصف أو فصل، أو كتابًا لكل طالب، أو كتاب تخرج. يصمم الماك كل الصفحات من مكتبتك."), `<button class="btn primary" id="bk-new2">${L("New book", "كتاب جديد")}</button>`)}</div>`;
    const open = () => newBookBox();
    $("#bk-new", main).onclick = open;
    $("#bk-new2", main)?.addEventListener("click", open);
    $$("[data-b]", main).forEach((c) => (c.onclick = () => go("books", { id: Number(c.dataset.b) })));
    onContext(main, "[data-b]", (c) => [
      { label: L("Open", "فتح"), run: () => go("books", { id: Number(c.dataset.b) }) },
      { label: L("Save PDF…", "حفظ PDF…"), run: () => savePdf(Number(c.dataset.b)) },
      "-",
      { label: L("Delete this book", "حذف هذا الكتاب"), run: async () => { await call("deleteBook", Number(c.dataset.b)); undoToast(L("Book deleted", "حُذف الكتاب")); go("books", { list: true }); } },
    ]);
  },

  async editor(main) {
    const b = await quiet("book", BK.id);
    if (!b) return go("books", { list: true });
    BK.book = b;
    if (!b.pages.some((p) => p.id === BK.page)) BK.page = b.pages[0]?.id ?? null;
    main.innerHTML = topbar(esc(b.spec.title ?? ""), `${esc(BOOK_KINDS()[b.spec.kind]?.[0] ?? "")} · ${esc(b.spec.year)} · <span id="bk-n">${L(`${b.pages.length} pages`, `${num(b.pages.length)} صفحة`)}</span>`,
      `<button class="btn" id="bk-back">${icon("chevron-left", 14)} ${L("Books", "الكتب")}</button>
       <button class="btn" id="bk-ai">${icon("sparkles", 14)} ${L("Write page texts", "كتابة نصوص الصفحات")}</button>
       <button class="btn" id="bk-more">${icon("ellipsis", 15)}</button>
       <button class="btn primary" id="bk-pdf">${icon("download", 14)} ${L("Save PDF", "حفظ PDF")}</button>`) +
      `<div class="content flush"><div class="bked"><nav class="bkpages" id="bk-pages"></nav><div class="bkstage"><div class="bkframe"><iframe id="bk-frame"></iframe></div><div id="bk-strip"></div></div><aside class="bkside" id="bk-side"></aside></div></div>`;
    $("#bk-back", main).onclick = () => go("books", { list: true });
    $("#bk-pdf", main).onclick = () => savePdf(b.id);
    $("#bk-ai", main).onclick = async () => {
      toast(L("Writing titles and texts for the unlocked pages… (only page titles and dates are sent, never photos or names)", "جارٍ كتابة العناوين والنصوص للصفحات غير المقفلة… (تُرسل عناوين الصفحات وتواريخها فقط، لا صور ولا أسماء)"), { ms: 5000 });
      try {
        const n = await call("bookTexts", b.id);
        undoToast(L(`${n} pages written. Change anything you like.`, `كُتبت ${num(n)} صفحة. غيّر ما تشاء.`));
        this.editor(main);
      } catch {}
    };
    $("#bk-more", main).onclick = () => menu([
      { label: L("Draft the unlocked pages again", "إعادة تصميم الصفحات غير المقفلة"), run: async () => { await call("redraftBook", b.id); undoToast(L("Drafted again. Locked pages stayed as they were.", "أُعيد التصميم. بقيت الصفحات المقفلة كما هي.")); this.editor(main); } },
      { label: L("Save a version…", "حفظ نسخة…"), run: async () => { await call("bookVersion", b.id, L("Saved by hand", "حُفظت يدويًا")); toast(L("Version saved", "حُفظت النسخة")); this.editor(main); } },
      { label: L("Versions", "النسخ"), sub: b.versions.length ? b.versions.slice().reverse().map((v) => ({ label: `${new Date(v.at).toLocaleString(S.language === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${v.label} · ${v.pages}`, run: async () => { await call("bookRestore", b.id, v.i); undoToast(L("Went back to that version", "تمت العودة إلى تلك النسخة")); this.editor(main); } })) : [{ label: L("No versions yet", "لا نسخ بعد"), enabled: false }] },
      "-",
      { label: L("Send to the website for review", "إرسال إلى الموقع للمراجعة"), run: async () => { toast(L("Making the page pictures and sending them…", "جارٍ عمل صور الصفحات وإرسالها…")); try { const r = await call("bookSend", b.id); toast(L(`Sent ${r.pages} pages (version ${r.version}). Class teachers can check the names on their phones.`, `أُرسلت ${num(r.pages)} صفحة (النسخة ${num(r.version)}). يمكن لمعلمي الفصول مراجعة الأسماء على هواتفهم.`), { ms: 7000 }); } catch {} } },
      { label: L("Save as a flipbook…", "حفظ ككتاب يُقلَّب…"), run: async () => { toast(L("Making the flipbook…", "جارٍ عمل الكتاب…")); const r = await call("bookFlipbook", b.id); if (r) toast(L(`Flipbook of ${r.pages} pages saved. Open index.html in any browser.`, `حُفظ كتاب من ${num(r.pages)} صفحة. افتح index.html في أي متصفح.`)); } },
      b.spec.kind === "student" && b.spec.className && { label: L(`Make a book for every student in ${b.spec.className}…`, `عمل كتاب لكل طالب في ${b.spec.className}…`), run: async () => { toast(L("Making the books. This takes a while for a big class.", "جارٍ عمل الكتب. يستغرق ذلك وقتًا للفصل الكبير.")); const r = await call("bookStudentBooks", b.id); if (r) toast(L(`${r.made} of ${r.total} books saved`, `حُفظ ${num(r.made)} من ${num(r.total)} كتاب`)); } },
      "-",
      { label: L("Delete this book", "حذف هذا الكتاب"), run: async () => { await call("deleteBook", b.id); undoToast(L("Book deleted", "حُذف الكتاب")); go("books", { list: true }); } },
    ]);
    this.pages();
    this.preview();
    this.side();
  },
  keys: () => [["↑ ↓", L("Previous / next page", "الصفحة السابقة / التالية")], ["L", L("Lock or unlock the page", "قفل الصفحة أو فتحها")]],
  onKey(e) {
    if (!BK.book || e.target.closest("input, textarea, select")) return;
    const i = BK.book.pages.findIndex((p) => p.id === BK.page);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const p = BK.book.pages[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (p) (BK.page = p.id, this.pages(), this.preview(), this.side());
      return true;
    }
    if (e.key.toLowerCase() === "l" && BK.book.pages[i]) {
      this.change((p) => (p.locked = !p.locked));
      return true;
    }
  },

  // Change the selected page (or the book) and save, with undo.
  async change(fn, opts = {}) {
    const b = BK.book;
    const p = b.pages.find((x) => x.id === BK.page);
    if (opts.book) fn(b.spec);
    else if (p) fn(p);
    clearTimeout(BK.t);
    const save = () => call("saveBook", b.id, opts.book ? { spec: b.spec } : { pages: b.pages });
    if (opts.later) BK.t = setTimeout(() => { save(); this.preview(); this.pages(); }, 600);
    else {
      await save();
      this.pages();
      this.preview();
      if (!opts.keepSide) this.side();
    }
  },

  pages() {
    const nav = $("#bk-pages");
    if (!nav) return;
    const b = BK.book;
    nav.innerHTML = `${b.pages.map((p, i) => `<div class="bkp ${p.id === BK.page ? "on" : ""}" data-p="${esc(p.id)}" draggable="true"><span class="n">${i + 1}</span>${icon(PAGE_TYPES()[p.type]?.[1] ?? "file", 14)}<span class="grow">${esc(S.language === "ar" ? p.titleAr || p.title : p.title || p.titleAr)}</span>${p.locked ? icon("lock", 12) : ""}</div>`).join("")}
      <button class="btn small ghost" id="bk-add" style="margin: 8px">${icon("plus", 13)} ${L("Add a page", "إضافة صفحة")}</button>`;
    $$("[data-p]", nav).forEach((el) => {
      el.onclick = () => { BK.page = el.dataset.p; this.pages(); this.preview(); this.side(); };
      el.ondragstart = (e) => e.dataTransfer.setData("text/page", el.dataset.p);
      el.ondragover = (e) => { e.preventDefault(); el.classList.add("drop"); };
      el.ondragleave = () => el.classList.remove("drop");
      el.ondrop = (e) => {
        e.preventDefault();
        const from = b.pages.findIndex((p) => p.id === e.dataTransfer.getData("text/page"));
        const to = b.pages.findIndex((p) => p.id === el.dataset.p);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = b.pages.splice(from, 1);
        b.pages.splice(to, 0, moved);
        this.change(() => {});
      };
    });
    onContext(nav, "[data-p]", (el) => {
      const p = b.pages.find((x) => x.id === el.dataset.p);
      return [
        { label: p.locked ? L("Unlock", "فتح القفل") : L("Lock (approved)", "قفل (معتمدة)"), run: () => { BK.page = p.id; this.change((x) => (x.locked = !x.locked)); } },
        { label: L("Duplicate", "تكرار"), run: () => { const i = b.pages.indexOf(p); b.pages.splice(i + 1, 0, { ...structuredClone(p), id: `p${Date.now().toString(36)}`, locked: false }); this.change(() => {}); } },
        "-",
        p.type !== "cover" && { label: L("Delete page", "حذف الصفحة"), run: () => { b.pages.splice(b.pages.indexOf(p), 1); BK.page = b.pages[0]?.id; this.change(() => {}); undoToast(L("Page deleted", "حُذفت الصفحة")); } },
      ];
    });
    $("#bk-add", nav).onclick = () => menu(["text", "event", "trips", "sports", "firsts", "teachers", "staff", "class"].map((t) => ({
      label: PAGE_TYPES()[t][0],
      run: () => {
        const i = Math.max(0, b.pages.findIndex((p) => p.id === BK.page));
        const page = { id: `p${Date.now().toString(36)}`, type: t, title: PAGE_TYPES()[t][0], titleAr: PAGE_TYPES()[t][0], layout: t === "text" ? "single" : "auto", photos: [], students: [] };
        b.pages.splice(i + 1, 0, page);
        BK.page = page.id;
        this.change(() => {});
      },
    })));
  },

  async preview() {
    const frame = $("#bk-frame");
    if (!frame || !BK.page) return;
    const [html, size] = await Promise.all([quiet("bookHtml", BK.book.id, BK.page), quiet("bookSize", BK.book.id)]);
    if (!html || !$("#bk-frame")) return;
    frame.onload = () => {
      const doc = frame.contentDocument;
      const box = frame.parentElement;
      const pw = (size.mmW / 25.4) * 96, ph = (size.mmH / 25.4) * 96;
      const z = Math.min((box.clientWidth - 24) / pw, (box.clientHeight - 24) / ph);
      doc.body.style.zoom = String(z);
      doc.body.style.margin = "12px 0";
      $$("img", doc).forEach((im) => (im.style.cursor = "pointer"));
    };
    frame.srcdoc = html;
    this.strip();
  },

  // The page's photos: move, remove, swap or add.
  strip() {
    const el = $("#bk-strip");
    const p = BK.book.pages.find((x) => x.id === BK.page);
    if (!el || !p) return;
    const faces = ["class", "teachers", "staff"].includes(p.type);
    el.innerHTML = faces
      ? `<div class="row small muted">${icon("users", 14)} ${L(`${(p.students ?? []).length} people on this page. Add or remove them in the panel.`, `${num((p.students ?? []).length)} شخص في هذه الصفحة. أضفهم أو أزلهم من اللوحة.`)}</div>`
      : `<div class="row nowrap bkphotos">${p.photos.map((id, i) => `<div class="bkph" data-ph="${id}"><img src="hub://thumb/${id}" /><div class="bkphbar"><button data-mv="-1" title="${esc(L("Move earlier", "تقديم"))}">${icon(document.dir === "rtl" ? "chevron-right" : "chevron-left", 12)}</button><button data-swap title="${esc(L("Swap", "استبدال"))}">${icon("repeat", 12)}</button><button data-mv="1" title="${esc(L("Move later", "تأخير"))}">${icon(document.dir === "rtl" ? "chevron-left" : "chevron-right", 12)}</button><button data-rm title="${esc(L("Remove", "إزالة"))}">${icon("x", 12)}</button></div></div>`).join("")}
         ${p.type !== "text" && p.type !== "end" && p.type !== "welcome" || p.photos.length ? `<button class="bkph add" id="bk-addph">${icon("plus", 18)}<span class="tiny">${L("Add photos", "إضافة صور")}</span></button>` : ""}</div>
         ${p.locked ? `<div class="tiny muted">${icon("lock", 11)} ${L("This page is locked. Unlock it to change it.", "هذه الصفحة مقفلة. افتحها لتغييرها.")}</div>` : ""}`;
    if (faces) return;
    const guard = () => (p.locked ? (toast(L("Unlock the page first (L).", "افتح قفل الصفحة أولًا (L).")), true) : false);
    $$("[data-ph]", el).forEach((t) => {
      const id = Number(t.dataset.ph);
      $("img", t).ondblclick = () => openViewer(p.photos, p.photos.indexOf(id), {});
      $$("[data-mv]", t).forEach((b) => (b.onclick = () => {
        if (guard()) return;
        const i = p.photos.indexOf(id), j = i + Number(b.dataset.mv);
        if (j < 0 || j >= p.photos.length) return;
        this.change((x) => ([x.photos[i], x.photos[j]] = [x.photos[j], x.photos[i]]));
      }));
      $("[data-rm]", t).onclick = () => { if (guard()) return; this.change((x) => x.photos.splice(x.photos.indexOf(id), 1)); };
      $("[data-swap]", t).onclick = () => { if (guard()) return; pickBookPhotos(p, (ids) => this.change((x) => x.photos.splice(x.photos.indexOf(id), 1, ids[0])), 1); };
    });
    $("#bk-addph", el)?.addEventListener("click", () => { if (guard()) return; pickBookPhotos(p, (ids) => this.change((x) => x.photos.push(...ids)), 9 - p.photos.length); });
  },

  side() {
    const el = $("#bk-side");
    if (!el) return;
    el.innerHTML = `${pills([["page", L("Page", "الصفحة")], ["book", L("Book", "الكتاب")], ["checks", L("Checks", "الفحص")], ["review", L("Review", "المراجعة")]], BK.side, "data-side")}<div id="bk-sidebody" class="col gap12"></div>`;
    bindPills(el, "data-side", (v) => { BK.side = v; this.side(); });
    const body = $("#bk-sidebody", el);
    ({ page: () => this.pageSide(body), book: () => this.bookSide(body), checks: () => this.checksSide(body), review: () => this.reviewSide(body) })[BK.side]();
  },

  pageSide(body) {
    const p = BK.book.pages.find((x) => x.id === BK.page);
    if (!p) return;
    const dis = p.locked ? "disabled" : "";
    const faces = ["class", "teachers", "staff"].includes(p.type);
    body.innerHTML = `<div class="row"><b class="grow">${esc(PAGE_TYPES()[p.type]?.[0] ?? "")}</b><label class="row nowrap small" style="gap: 6px">${icon("lock", 12)} ${L("Locked", "مقفلة")} ${sw('id="pg-lock"', p.locked)}</label></div>
      <label class="field">${L("Title in Arabic", "العنوان بالعربية")}<input data-f="titleAr" dir="rtl" value="${esc(p.titleAr ?? "")}" ${dis} /></label>
      <label class="field">${L("Title in English", "العنوان بالإنجليزية")}<input data-f="title" value="${esc(p.title ?? "")}" ${dis} /></label>
      <label class="field">${L("Text in Arabic", "النص بالعربية")}<textarea data-f="textAr" dir="rtl" rows="3" ${dis}>${esc(p.textAr ?? "")}</textarea></label>
      <label class="field">${L("Text in English", "النص بالإنجليزية")}<textarea data-f="text" rows="3" ${dis}>${esc(p.text ?? "")}</textarea></label>
      ${!faces && p.type !== "cover" ? `<div class="col gap4"><span class="small muted">${L("Layout", "التنسيق")}</span>${pills([["auto", L("Auto", "تلقائي")], ["hero", L("Big first", "الأولى كبيرة")], ["grid", L("Grid", "شبكة")], ["collage", L("Collage", "كولاج")], ["single", L("One", "واحدة")]], p.layout, "data-lay")}</div>` : ""}
      ${faces ? `<div class="col gap4"><div class="row"><span class="small muted grow">${L(`${(p.students ?? []).length} people`, `${num((p.students ?? []).length)} شخص`)}</span><button class="btn small" id="pg-addp" ${dis}>${icon("plus", 12)} ${L("Add someone", "إضافة شخص")}</button></div>
          <div class="col gap4" id="pg-people" style="max-height: 260px; overflow-y: auto"></div></div>` : ""}
      ${p.type === "cover" ? `<p class="small muted">${L("Cover style, subtitle and logo are under Book.", "نمط الغلاف والعنوان الفرعي والشعار في «الكتاب».")}</p>` : ""}`;
    $("#pg-lock", body).onchange = (e) => this.change((x) => (x.locked = e.target.checked));
    $$("[data-f]", body).forEach((inp) => (inp.oninput = () => this.change((x) => (x[inp.dataset.f] = inp.value), { later: true, keepSide: true })));
    bindPills(body, "data-lay", (v) => this.change((x) => (x.layout = v)));
    if (faces) {
      const box = $("#pg-people", body);
      Promise.all((p.students ?? []).map((id) => quiet("student", id))).then((list) => {
        box.innerHTML = list.filter(Boolean).map((s) => `<div class="trow"><span class="grow small">${esc(name(s))} <span class="tiny muted">${esc(s.class_name ?? KINDS()[s.kind] ?? "")}</span>${!s.can_post ? ` <span class="tag bad tiny">${L("Can't appear", "لا يظهر")}</span>` : ""}</span>${p.locked ? "" : `<button class="btn ghost tiny" data-rmp="${esc(s.id)}">${icon("x", 11)}</button>`}</div>`).join("");
        $$("[data-rmp]", box).forEach((b) => (b.onclick = () => this.change((x) => (x.students = x.students.filter((id) => id !== b.dataset.rmp)))));
      });
      $("#pg-addp", body)?.addEventListener("click", () => pickStudent(L("Add to this page", "إضافة إلى هذه الصفحة"), (s) => this.change((x) => (x.students = [...new Set([...(x.students ?? []), s.id])]))));
    }
  },

  bookSide(body) {
    const sp = BK.book.spec;
    body.innerHTML = `<label class="field">${L("Book title", "عنوان الكتاب")}<input id="bs-title" value="${esc(sp.title ?? "")}" /></label>
      <div class="col gap4"><span class="small muted">${L("Design", "التصميم")}</span>${pills(THEME_NAMES(), sp.theme ?? "classic", "data-theme")}</div>
      <div class="row"><span class="small grow">${L("School colour", "لون المدرسة")}</span><input type="color" id="bs-accent" value="${esc(sp.accent ?? "#2f6fdf")}" /></div>
      <div class="row"><span class="small grow">${L("Logo", "الشعار")}${sp.logo ? ` <span class="tag good tiny">${icon("check", 10)}</span>` : ""}</span><button class="btn small" id="bs-logo">${L("Choose…", "اختيار…")}</button>${sp.logo ? `<button class="btn small ghost" id="bs-nologo">${icon("x", 12)}</button>` : ""}</div>
      <div class="col gap4"><span class="small muted">${L("Cover", "الغلاف")}</span>${pills([["photo", L("Big photo", "صورة كبيرة")], ["faces", L("All the faces", "كل الوجوه")], ["plain", L("Plain", "بسيط")]], sp.cover?.style ?? "photo", "data-cover")}
        <input id="bs-sub" placeholder="${esc(L("Subtitle on the cover (optional)", "عنوان فرعي على الغلاف (اختياري)"))}" value="${esc(sp.cover?.subtitle ?? "")}" />
        ${(sp.cover?.style ?? "photo") === "photo" ? `<button class="btn small" id="bs-cphoto">${icon("image", 13)} ${L("Choose the cover photo", "اختيار صورة الغلاف")}</button>` : ""}</div>
      <div class="col gap4"><span class="small muted">${L("Language", "اللغة")}</span>${pills([["ar", "العربية"], ["en", "English"], ["both", L("Both", "الاثنتان")]], sp.language, "data-lang")}</div>
      <div class="col gap4"><span class="small muted">${L("Print size", "مقاس الطباعة")}</span>${pills([["A4", "A4"], ["A5", "A5"], ["square", L("Square", "مربع")]], sp.size ?? "A4", "data-size")}</div>
      <label class="row small"><span class="grow">${L("Bleed (3 mm) for the printer", "هامش قص 3 مم للمطبعة")}</span>${sw('id="bs-bleed"', sp.bleed)}</label>
      <label class="row small"><span class="grow">${L("Crop marks", "علامات القص")}</span>${sw('id="bs-crop"', sp.cropMarks)}</label>
      <div class="col gap4"><span class="small muted">${L("Students who can't appear", "الطلاب الذين لا يظهرون")}</span>${pills([["leave", L("Leave them out", "استبعادهم")], ["blur", L("Blur their faces", "تمويه وجوههم")]], sp.cantAppear ?? "leave", "data-cant")}</div>
      <label class="row small"><span class="grow">${L("Keep students who left during the year", "إبقاء من غادروا خلال العام")}</span>${sw('id="bs-leavers"', sp.leavers !== false)}</label>
      <p class="tiny muted">${L("Changing who is in the book or the photos rule takes effect when you draft the unlocked pages again (… menu).", "تغيير من في الكتاب أو قاعدة الصور يُطبَّق عند إعادة تصميم الصفحات غير المقفلة (القائمة …).")}</p>`;
    const set = (fn) => this.change(fn, { book: true });
    $("#bs-title", body).oninput = (e) => this.change((x) => (x.title = e.target.value), { book: true, later: true, keepSide: true });
    bindPills(body, "data-theme", (v) => set((x) => (x.theme = v)));
    $("#bs-accent", body).onchange = (e) => set((x) => (x.accent = e.target.value));
    $("#bs-logo", body).onclick = async () => { const f = await call("bookLogo"); if (f) set((x) => (x.logo = f)); };
    $("#bs-nologo", body)?.addEventListener("click", () => set((x) => (x.logo = null)));
    bindPills(body, "data-cover", (v) => set((x) => (x.cover = { ...(x.cover ?? {}), style: v })));
    $("#bs-sub", body).oninput = (e) => this.change((x) => (x.cover = { ...(x.cover ?? {}), subtitle: e.target.value }), { book: true, later: true, keepSide: true });
    $("#bs-cphoto", body)?.addEventListener("click", () => {
      const cover = BK.book.pages.find((p) => p.type === "cover");
      pickBookPhotos(cover ?? { id: "", photos: [] }, async (ids) => {
        set((x) => (x.cover = { ...(x.cover ?? {}), photo: ids[0] }));
        if (cover) { cover.photos = [ids[0]]; await call("saveBook", BK.book.id, { pages: BK.book.pages }); BK.page = cover.id; this.pages(); this.preview(); }
      }, 1);
    });
    bindPills(body, "data-lang", (v) => set((x) => (x.language = v)));
    bindPills(body, "data-size", (v) => set((x) => (x.size = v)));
    $("#bs-bleed", body).onchange = (e) => set((x) => (x.bleed = e.target.checked));
    $("#bs-crop", body).onchange = (e) => set((x) => (x.cropMarks = e.target.checked));
    bindPills(body, "data-cant", (v) => set((x) => (x.cantAppear = v)));
    $("#bs-leavers", body).onchange = (e) => set((x) => (x.leavers = e.target.checked));
  },

  async checksSide(body) {
    body.innerHTML = skeletonRows(4);
    const c = await quiet("bookChecks", BK.book.id);
    if (!c || !$("#bk-sidebody")) return;
    const people = (list, extra = () => "") => `<div class="col gap4">${list.slice(0, 40).map((s) => `<div class="trow small" data-st="${esc(s.id)}"><span class="grow">${esc(s.name)} <span class="tiny muted">${esc(s.className ?? "")}</span></span>${extra(s)}</div>`).join("")}${list.length > 40 ? `<span class="tiny muted">+${num(list.length - 40)}</span>` : ""}</div>`;
    const block = (ok, title, list, extra) => `<div class="card side"><div class="row nowrap">${icon(ok ? "circle-check" : "triangle-alert", 15, ok ? "okic" : "warnic")}<b class="grow small">${title}</b>${list ? `<span class="tag ${ok ? "good" : "warn"}">${num(list.length)}</span>` : ""}</div>${!ok && list ? people(list, extra) : ""}</div>`;
    body.innerHTML = `<p class="small muted">${L(`${c.students} people in this book. On average each student is in ${c.average} photos.`, `${num(c.students)} شخص في هذا الكتاب. في المتوسط يظهر كل طالب في ${c.average} صورة.`)}</p>
      ${block(!c.missing.length, L("Everyone is in a photo", "الكل في صورة"), c.missing)}
      ${block(!c.over.length, L("Fair balance (no one far more than others)", "توازن عادل (لا أحد أكثر بكثير من غيره)"), c.over, (s) => `<span class="tag warn tiny">${num(s.n)}</span>`)}
      ${block(!c.notReady.length, L("Yearbook ready (3 good photos, one close-up)", "جاهز للكتاب (3 صور جيدة وواحدة قريبة)"), c.notReady, (s) => `<span class="tiny muted">${num(s.photos)}</span>`)}
      ${block(!c.noFace.length, L("Everyone has a face for the class page", "لكل شخص وجه لصفحة الفصل"), c.noFace)}
      ${block(!c.lowRes.length, L("Photos sharp enough for print (300 dpi)", "الصور واضحة بما يكفي للطباعة (300 نقطة)"), c.lowRes.length ? c.lowRes.map((id) => ({ id: `ph:${id}`, name: L(`Photo ${id}`, `صورة ${id}`) })) : null)}
      <div class="card side"><div class="row nowrap">${icon("shield", 15)}<b class="grow small">${BK.book.spec.cantAppear === "blur" ? L("Can't appear: faces blurred", "لا يظهرون: الوجوه مموهة") : L("Can't appear: left out", "لا يظهرون: مستبعدون")}</b><span class="tag">${num(c.cantAppear.length)}</span></div></div>`;
    $$("[data-st]", body).forEach((r) => (r.onclick = () => {
      const id = r.dataset.st;
      if (id.startsWith("ph:")) return openViewer([Number(id.slice(3))], 0, {});
      go("student", { id });
    }));
  },

  async reviewSide(body) {
    body.innerHTML = skeletonRows(4);
    const r = await quiet("bookReview", BK.book.id);
    if (!$("#bk-sidebody")) return;
    if (!r || !r.sent) {
      body.innerHTML = `<p class="small muted">${L("Send the book to the website (… menu) so the principal and the team can comment on pages, class teachers can check names on their phones, and teachers can write their messages for the book.", "أرسل الكتاب إلى الموقع (القائمة …) ليعلّق المدير والفريق على الصفحات، ويراجع معلمو الفصول الأسماء على هواتفهم، ويكتب المعلمون رسائلهم للكتاب.")}</p>
        <button class="btn primary" id="rv-send">${icon("send", 14)} ${L("Send for review", "إرسال للمراجعة")}</button>`;
      $("#rv-send", body).onclick = async () => { try { await call("bookSend", BK.book.id); toast(L("Sent for review", "أُرسل للمراجعة")); this.side(); } catch {} };
      return;
    }
    const fixes = r.checks.filter((c) => c.fixed_name || c.ok === false);
    const okd = r.checks.filter((c) => c.ok).length;
    body.innerHTML = `<div class="row small"><span class="grow">${L(`Version ${r.version} · ${okd} names checked`, `النسخة ${num(r.version)} · ${num(okd)} اسم مراجَع`)}</span><span class="tag ${r.status === "approved" ? "good" : ""}">${esc(r.status ?? "")}</span></div>
      ${fixes.length ? `<div class="card side"><b class="small">${L("Name fixes from teachers", "تصحيحات الأسماء من المعلمين")}</b>${fixes.map((c) => `<div class="trow small"><span class="grow">${esc(c.student ? name(c.student) : c.student_code)} → <b>${esc(c.fixed_name ?? "")}</b>${c.note ? `<div class="tiny muted">${esc(c.note)}</div>` : ""}</span>${c.fixed_name ? `<button class="btn small" data-fix="${esc(c.student_code)}" data-name="${esc(c.fixed_name)}">${L("Apply", "تطبيق")}</button>` : ""}</div>`).join("")}</div>` : ""}
      ${r.comments.length ? `<div class="card side"><b class="small">${L("Comments", "التعليقات")}</b>${r.comments.map((c) => `<div class="trow small ${c.done ? "muted" : ""}" data-pg="${c.page}"><span class="grow"><b>${L(`Page ${c.page}`, `صفحة ${num(c.page)}`)}</b> · ${esc(c.body)} <span class="tiny muted">${esc(c.author_name ?? "")}</span></span></div>`).join("")}</div>` : ""}
      ${r.texts.length ? `<div class="card side"><b class="small">${L("Texts written for the book", "نصوص كُتبت للكتاب")}</b>${r.texts.map((t, i) => `<div class="col gap4" style="padding: 6px 0; border-top: 1px solid var(--line)"><span class="tiny muted">${esc(t.author_name ?? "")} · ${esc(t.class_name ?? t.kind)}</span><span class="small" dir="auto">${esc(t.body)}</span><button class="btn small" data-use="${i}" style="align-self: flex-start">${L("Use on this page", "استخدامه في هذه الصفحة")}</button></div>`).join("")}</div>` : ""}
      ${!fixes.length && !r.comments.length && !r.texts.length ? `<p class="small muted">${L("No answers yet.", "لا ردود بعد.")}</p>` : ""}`;
    $$("[data-fix]", body).forEach((b) => (b.onclick = async () => { await call("bookFixName", b.dataset.fix, b.dataset.name); undoToast(L("Name fixed in the class list", "صُحّح الاسم في قائمة الفصل")); b.remove(); this.preview(); }));
    $$("[data-pg]", body).forEach((row) => (row.onclick = () => { const p = BK.book.pages[Number(row.dataset.pg) - 1]; if (p) { BK.page = p.id; this.pages(); this.preview(); } }));
    $$("[data-use]", body).forEach((b) => (b.onclick = () => {
      const t = r.texts[Number(b.dataset.use)];
      const arabic = /[؀-ۿ]/.test(t.body);
      this.change((x) => (arabic ? (x.textAr = [x.textAr, t.body].filter(Boolean).join("\n")) : (x.text = [x.text, t.body].filter(Boolean).join("\n"))));
      toast(L("Added to the page", "أُضيف إلى الصفحة"));
    }));
  },
};

// Photos to put on a page: the rest of the same event (or of the year), best first.
async function pickBookPhotos(page, done, max = 9) {
  const ids = page.id ? (await quiet("bookCandidates", BK.book.id, page.id)) ?? [] : [];
  const sel = [];
  const m = modal(`<div class="row"><h2 class="grow">${L("Choose photos", "اختيار الصور")}</h2><span class="muted small" id="pk-n"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes disabled>${L("Use", "استخدام")}</button></div>
    ${ids.length ? `<div class="cgrid" style="max-height: 62vh; overflow-y: auto; padding: 0">${ids.map((id) => `<div class="ctile" data-c="${id}"><img loading="lazy" src="hub://thumb/${id}" /><span class="tick">${icon("check", 11)}</span></div>`).join("")}</div>` : emptyState("image", L("No more photos for this page", "لا صور أخرى لهذه الصفحة"))}`, { wide: true });
  const upd = () => {
    $("#pk-n", m).textContent = max > 1 ? L(`${sel.length} of up to ${max}`, `${num(sel.length)} من ${num(max)}`) : "";
    $("[data-yes]", m).disabled = !sel.length;
  };
  $$("[data-c]", m).forEach((t) => (t.onclick = (e) => {
    const id = Number(t.dataset.c);
    if (e.detail === 2) return openViewer(ids, ids.indexOf(id), {});
    const i = sel.indexOf(id);
    if (i >= 0) sel.splice(i, 1);
    else {
      if (max === 1) (sel.length = 0, $$("[data-c].on", m).forEach((x) => x.classList.remove("on")));
      if (sel.length >= max) return;
      sel.push(id);
    }
    t.classList.toggle("on", sel.includes(id));
    upd();
  }));
  $("[data-no]", m).onclick = closeOverlay;
  $("[data-yes]", m).onclick = () => { closeOverlay(); done(sel); };
  upd();
}

async function savePdf(id) {
  toast(L("Making the PDF at print quality. Big books take a minute.", "جارٍ عمل ملف PDF بجودة الطباعة. الكتب الكبيرة تأخذ دقيقة."), { ms: 5000 });
  const r = await call("bookPdf", id);
  if (r) toast(L(`Saved ${r.pages} pages`, `حُفظت ${num(r.pages)} صفحة`));
}

// A new book: which kind, which year, which grade, class or student.
async function newBookBox() {
  const o = (await quiet("bookOptions")) ?? { years: [], grades: [], classes: [] };
  const st = { kind: "grade", year: o.years[0] ?? "", grade: o.grades[0] ?? "", className: o.classes[0]?.class_name ?? "", student: null };
  const draw = () => {
    const m = modal(`<h2>${L("New book", "كتاب جديد")}</h2>
      <div class="grid2">${Object.entries(BOOK_KINDS()).map(([k, [t, ic]]) => `<button class="card bkkind ${st.kind === k ? "on" : ""}" data-k="${k}">${icon(ic, 18)}<b class="small">${t}</b></button>`).join("")}</div>
      ${!o.years.length ? `<div class="note warn small">${L("Import photos and class lists first.", "استورد الصور وقوائم الفصول أولًا.")}</div>` : ""}
      <div class="grid2"><label class="field">${L("School year", "العام الدراسي")}<select id="nb-y">${o.years.map((y) => `<option ${y === st.year ? "selected" : ""}>${esc(y)}</option>`).join("")}</select></label>
        ${st.kind === "grade" ? `<label class="field">${L("Grade", "الصف")}<select id="nb-g">${o.grades.map((g) => `<option ${g === st.grade ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>`
          : `<label class="field">${L("Class", "الفصل")}<select id="nb-c">${o.classes.map((c) => `<option ${c.class_name === st.className ? "selected" : ""}>${esc(c.class_name)}</option>`).join("")}</select></label>`}</div>
      ${st.kind === "student" || st.kind === "graduation" ? `<div class="row"><span class="small grow">${L("Student", "الطالب")}: <b>${st.student ? esc(name(st.student)) : st.kind === "student" ? L("start with one (make the rest later)", "ابدأ بطالب (والباقي لاحقًا)") : "—"}</b></span><button class="btn small" id="nb-s">${L("Choose…", "اختيار…")}</button></div>` : ""}
      <p class="muted small">${{
        grade: L("A cover, the principal's word, a page per class with every face and name, teachers, staff, firsts, trips, sports and the year's events, with the fairest choice of photos.", "غلاف، وكلمة المدير، وصفحة لكل فصل بكل الوجوه والأسماء، والمعلمون والموظفون والبدايات والرحلات والرياضة وفعاليات العام، بأعدل اختيار للصور."),
        class: L("The same for one class: its own page, its teacher, and the year's events it was in.", "مثله لفصل واحد: صفحته ومعلمه وفعاليات العام التي شارك فيها."),
        student: L("A cover with the student, their best photos of the year, their class page and events. Make one for every student in the class from the … menu.", "غلاف بالطالب، وأفضل صوره في العام، وصفحة فصله والفعاليات. اعمل كتابًا لكل طالب في الفصل من القائمة …."),
        graduation: L("A page for every year they were at the school (from the year they joined), and their class page with “With us since”.", "صفحة لكل عام قضاه في المدرسة (من عام انضمامه)، وصفحة فصله مع «معنا منذ»."),
      }[st.kind]}</p>
      <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes ${o.years.length ? "" : "disabled"}>${L("Draft the book", "تصميم الكتاب")}</button></div>`);
    $$("[data-k]", m).forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; draw(); }));
    $("#nb-y", m).onchange = (e) => (st.year = e.target.value);
    $("#nb-g", m)?.addEventListener("change", (e) => (st.grade = e.target.value));
    $("#nb-c", m)?.addEventListener("change", (e) => (st.className = e.target.value));
    $("#nb-s", m)?.addEventListener("click", () => pickStudent(L("Which student?", "أي طالب؟"), (s) => { st.student = s; st.className = s.class_name ?? st.className; draw(); }));
    $("[data-no]", m).onclick = closeOverlay;
    $("[data-yes]", m).onclick = async () => {
      if (st.kind === "graduation" && !st.student) return toast(L("Choose the student first.", "اختر الطالب أولًا."));
      let student = st.student;
      if (st.kind === "student" && !student) {
        const first = ((await quiet("studentList", { className: st.className })) ?? [])[0];
        student = first ?? null;
      }
      closeOverlay();
      toast(L("Drafting the book…", "جارٍ تصميم الكتاب…"));
      const id = await call("newBook", { kind: st.kind, year: st.year, grade: st.kind === "grade" ? st.grade : null, className: st.kind === "grade" ? null : st.className, studentId: student?.id ?? null });
      BK.page = null;
      go("books", { id });
    };
  };
  draw();
}
