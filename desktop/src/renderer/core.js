// Plain scripts, no build step: the window talks to the Mac only through window.hub.
const App = { state: null, view: "today", params: {}, views: {}, keyHandlers: [] };
let S = null;

const L = (en, ar) => (S?.language === "en" ? en : ar);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = (n) => new Intl.NumberFormat(S?.language === "en" ? "en" : "ar-EG").format(n ?? 0);
const plural = (n, en, enMany, ar) => `${num(n)} ${S?.language === "en" ? (n === 1 ? en : enMany) : ar}`;
const name = (s) => (s ? (S.language === "en" ? s.name_en || s.name_ar : s.name_ar || s.name_en) || s.id : "");
const fmtDate = (d) => {
  if (!d) return "";
  const date = new Date(d.length === 10 ? `${d}T12:00:00` : d);
  return date.toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { day: "numeric", month: "short", year: "numeric" });
};
const fmtBytes = (b) => {
  if (!b) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i > 2 ? 1 : 0)} ${u[i]}`;
};
const initials = (s) => (name(s) || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const avatar = (s, big = false) =>
  `<span class="avatar ${big ? "big" : ""}">${s?.portrait ? `<img src="hub://portrait/${encodeURIComponent(s.id)}" />` : esc(initials(s))}</span>`;

const ERRORS = {
  "not-hub": ["Couldn't reach School Social Hub at that address. Check it and your internet.", "تعذّر الوصول إلى School Social Hub على هذا العنوان. تحقق منه ومن الإنترنت."],
  "bad-login": ["Email or password is incorrect.", "البريد الإلكتروني أو كلمة المرور غير صحيحة."],
  "no-school": ["This account isn't part of a school yet. Set the school up on the website first.", "هذا الحساب غير مرتبط بمدرسة بعد. أنشئ المدرسة على الموقع أولًا."],
  "no-library": ["Choose the library folder first (Settings).", "اختر مجلد المكتبة أولًا (الإعدادات)."],
  "not-signed-in": ["Sign in to the website first (Settings → Account).", "سجّل الدخول إلى الموقع أولًا (الإعدادات ← الحساب)."],
  "upload-slow": ["The photos are taking long to send. Check the internet and try again.", "إرسال الصور يستغرق وقتًا طويلًا. تحقق من الإنترنت وحاول مرة أخرى."],
  "inside-library": ["That folder is already inside the library.", "هذا المجلد موجود بالفعل داخل المكتبة."],
};

async function call(fn, ...args) {
  const r = await window.hub.call(fn, ...args);
  if (!r.ok) {
    const e = ERRORS[r.error];
    toast(e ? L(e[0], e[1]) : `${L("Something went wrong", "حدث خطأ")}: ${r.error}`);
    throw new Error(r.error);
  }
  return r.value;
}
const quiet = (fn, ...args) => window.hub.call(fn, ...args).then((r) => (r.ok ? r.value : null));

function toast(msg, opts = {}) {
  const t = h(`<div class="t"><span class="grow">${esc(msg)}</span>${opts.undo ? `<button>${L("Undo", "تراجع")}</button>` : ""}</div>`);
  t.querySelector("button")?.addEventListener("click", async () => {
    t.remove();
    await doUndo();
  });
  $("#toast").append(t);
  setTimeout(() => t.remove(), opts.ms ?? 4500);
}

async function doUndo() {
  const what = await call("undo");
  toast(what ? L("Undone", "تم التراجع") : L("Nothing to undo", "لا يوجد ما يمكن التراجع عنه"));
  rerender();
}

// ---------- Overlays ----------
function closeOverlay() {
  $("#overlay").replaceChildren();
  App.overlayKeys = null;
}
function modal(html, opts = {}) {
  const back = h(`<div class="modalback"><div class="modal ${opts.wide ? "wide" : ""}">${html}</div></div>`);
  back.addEventListener("mousedown", (e) => {
    if (e.target === back && !opts.sticky) closeOverlay();
  });
  $("#overlay").replaceChildren(back);
  App.overlayKeys = (e) => {
    if (e.key === "Escape") closeOverlay();
  };
  setTimeout(() => back.querySelector("input:not([type=checkbox]), select")?.focus(), 30);
  return back.querySelector(".modal");
}

// Pick a person (for naming a face): type a name (any spelling), ID or
// class. Teachers, staff, parents and visitors are in the same list, and a
// new person can be added right here.
function pickStudent(title, onPick, opts = {}) {
  const m = modal(`<h2>${esc(title)}</h2><input type="search" placeholder="${L("Name, ID or class…", "الاسم أو الرقم أو الفصل…")}" />
    <div class="col gap4 res" style="max-height: 50vh; overflow-y: auto"></div>
    <button class="btn small ghost" id="ps-new" style="align-self: flex-start">${icon("user-plus", 14)} ${L("Add a new person (teacher, staff, parent, visitor)…", "إضافة شخص جديد (معلم، موظف، ولي أمر، زائر)…")}</button>`);
  const input = m.querySelector("input");
  const res = m.querySelector(".res");
  let list = [];
  let on = 0;
  const kinds = KINDS();
  const draw = () => {
    res.replaceChildren(
      ...list.map((s, i) => {
        const el = h(`<div class="row nowrap" style="padding: 6px 8px; border-radius: 8px; cursor: pointer; ${i === on ? "background: var(--accent-bg)" : ""}">${avatar(s)}<div class="grow"><b>${esc(name(s))}</b><div class="small muted">${esc([s.kind && s.kind !== "student" ? kinds[s.kind] : s.class_name, s.id].filter(Boolean).join(" · "))}</div></div>${s.left_on ? `<span class="tag">${L("Left", "غادر")}</span>` : ""}${s.can_post ? "" : `<span class="tag bad">${L("Not in posts", "لا يظهر في المنشورات")}</span>`}</div>`);
        el.onclick = () => {
          closeOverlay();
          onPick(s);
        };
        return el;
      }),
    );
    if (!list.length) res.append(h(`<p class="muted small">${L("Nobody found. Import a class list (Students), or add a new person below.", "لا أحد. استورد قائمة الفصول (الطلاب)، أو أضف شخصًا جديدًا بالأسفل.")}</p>`));
  };
  const load = async () => {
    list = await call("students", { search: input.value.trim(), className: opts.className && !input.value.trim() ? opts.className : undefined, everyone: true });
    list = list.slice(0, 40);
    on = 0;
    draw();
  };
  input.addEventListener("input", load);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { on = Math.min(list.length - 1, on + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { on = Math.max(0, on - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter" && list[on]) { closeOverlay(); onPick(list[on]); }
  });
  $("#ps-new", m).onclick = () => newPerson(input.value.trim(), onPick);
  load();
}

function newPerson(typed, onPick) {
  const m = modal(`<h2>${L("New person", "شخص جديد")}</h2>
    <div class="grid2"><label class="field">${L("Name in English", "الاسم بالإنجليزية")}<input id="np-en" value="${/[a-z]/i.test(typed) ? esc(typed) : ""}" /></label><label class="field">${L("Name in Arabic", "الاسم بالعربية")}<input id="np-ar" value="${/[\u0600-\u06FF]/.test(typed) ? esc(typed) : ""}" /></label></div>
    <label class="field">${L("Who they are", "من هو")}<select id="np-kind">${Object.entries(KINDS()).filter(([k]) => k !== "student").map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}<option value="student">${esc(KINDS().student)}</option></select></label>
    <label class="field hide" id="np-linkf">${L("Parent of", "ولي أمر")}<input id="np-link" placeholder="${L("Student's name", "اسم الطالب")}" /><input type="hidden" id="np-linkid" /></label>
    <div class="row"><span class="grow"></span><button class="btn" data-x>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-ok>${L("Add", "إضافة")}</button></div>`);
  const kind = $("#np-kind", m);
  kind.onchange = () => $("#np-linkf", m).classList.toggle("hide", kind.value !== "parent");
  $("#np-link", m).onfocus = () => {
    const keep = { en: $("#np-en", m).value, ar: $("#np-ar", m).value };
    pickStudent(L("Parent of which student?", "ولي أمر أي طالب؟"), (s) => {
      newPerson(keep.en || keep.ar, onPick);
      setTimeout(() => {
        const mm = $(".modal");
        $("#np-en", mm).value = keep.en;
        $("#np-ar", mm).value = keep.ar;
        $("#np-kind", mm).value = "parent";
        $("#np-linkf", mm).classList.remove("hide");
        $("#np-link", mm).value = name(s);
        $("#np-linkid", mm).value = s.id;
      }, 40);
    });
  };
  $("[data-x]", m).onclick = closeOverlay;
  $("[data-ok]", m).onclick = async () => {
    const en = $("#np-en", m).value.trim(), ar = $("#np-ar", m).value.trim();
    if (!en && !ar) return $("#np-en", m).focus();
    const id = await call("addStudent", { id: "", name_en: en, name_ar: ar, class_name: "", kind: kind.value, linkTo: $("#np-linkid", m).value || undefined });
    closeOverlay();
    onPick({ id, name_en: en, name_ar: ar, kind: kind.value, can_post: 1 });
  };
}

// ⌘K: students, events, classes, screens and commands.
function palette() {
  const back = h(`<div class="modalback"><div class="palette"><input type="search" placeholder="${L("Search students, events, classes, or type a command…", "ابحث عن طالب أو فعالية أو فصل، أو اكتب أمرًا…")}" /><div class="res"></div></div></div>`);
  back.addEventListener("mousedown", (e) => e.target === back && closeOverlay());
  $("#overlay").replaceChildren(back);
  const input = back.querySelector("input");
  const res = back.querySelector(".res");
  let items = [];
  let on = 0;
  const commands = () => [
    ...NAV.flatMap((s) => s.items).map((n) => ({ grp: L("Go to", "انتقال"), label: n.label(), icon: n.icon, run: () => go(n.id) })),
    { grp: L("Do", "إجراء"), label: L("New post", "منشور جديد"), icon: "square-pen", run: () => go("posts", { new: true }) },
    { grp: L("Do", "إجراء"), label: L("Import photos", "استيراد صور"), icon: "download", run: () => go("import") },
    { grp: L("Do", "إجراء"), label: L("Keyboard shortcuts", "اختصارات لوحة المفاتيح"), icon: "keyboard", run: shortcutSheet },
    { grp: L("Do", "إجراء"), label: L("Import a class list", "استيراد قائمة الفصول"), icon: "file-spreadsheet", run: () => go("students", { import: true }) },
    { grp: L("Do", "إجراء"), label: L("Review face suggestions", "مراجعة اقتراحات الوجوه"), icon: "scan-face", run: () => go("faces") },
    { grp: L("Do", "إجراء"), label: L("Undo last change", "التراجع عن آخر تغيير"), icon: "undo-2", run: doUndo },
    { grp: L("Do", "إجراء"), label: S.paused ? L("Resume the library", "استئناف المكتبة") : L("Pause the library", "إيقاف المكتبة مؤقتًا"), icon: S.paused ? "play" : "pause", run: () => call("set", "paused", !S.paused) },
    { grp: L("Albums", "ألبومات"), label: L("Picks", "المختارة"), icon: "flag", run: () => go("library", { album: "picks" }) },
    { grp: L("Albums", "ألبومات"), label: L("Faces to name", "وجوه بلا أسماء"), icon: "user-search", run: () => go("library", { album: "untagged" }) },
    { grp: L("Albums", "ألبومات"), label: L("Students who can't appear in posts", "طلاب لا يظهرون في المنشورات"), icon: "shield", run: () => go("library", { album: "nopost" }) },
  ];
  const draw = () => {
    res.replaceChildren();
    let grp = "";
    items.forEach((it, i) => {
      if (it.grp !== grp) {
        grp = it.grp;
        res.append(h(`<div class="grp">${esc(grp)}</div>`));
      }
      const el = h(`<div class="it ${i === on ? "on" : ""}"><span class="pic">${icon(it.icon, 15)}</span><span class="grow">${esc(it.label)}</span>${it.sub ? `<span class="small muted">${esc(it.sub)}</span>` : ""}</div>`);
      el.onclick = () => {
        closeOverlay();
        it.run();
      };
      res.append(el);
    });
  };
  const load = async () => {
    const q = input.value.trim();
    const cmds = commands().filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
    items = [];
    if (q) {
      const r = await quiet("search", q);
      if (r) {
        items.push(...r.students.map((s) => ({ grp: L("Students", "الطلاب"), label: name(s), sub: s.class_name, icon: "user", run: () => go("student", { id: s.id }) })));
        items.push(...r.classes.map((c) => ({ grp: L("Classes", "الفصول"), label: c.class_name, sub: plural(c.n, "student", "students", "طالب"), icon: "school", run: () => go("students", { className: c.class_name }) })));
        items.push(...r.events.map((e) => ({ grp: L("Events", "الفعاليات"), label: e.event_title, sub: fmtDate(e.event_date), icon: "folder", run: () => go("library", { event: e.event_key }) })));
      }
    }
    items.push(...cmds.slice(0, q ? 8 : 30));
    on = 0;
    draw();
  };
  input.addEventListener("input", load);
  App.overlayKeys = (e) => {
    if (e.key === "Escape") closeOverlay();
    if (e.key === "ArrowDown") { on = Math.min(items.length - 1, on + 1); draw(); e.preventDefault(); }
    if (e.key === "ArrowUp") { on = Math.max(0, on - 1); draw(); e.preventDefault(); }
    if (e.key === "Enter" && items[on]) { const it = items[on]; closeOverlay(); it.run(); }
  };
  input.focus();
  load();
}

// ---------- Navigation ----------
const NAV = [
  { items: [{ id: "today", icon: "house", label: () => L("Today", "اليوم") }] },
  {
    sec: () => L("Photos", "الصور"),
    items: [
      { id: "library", icon: "images", label: () => L("Library", "المكتبة") },
      { id: "import", icon: "download", label: () => L("Import", "استيراد") },
      { id: "faces", icon: "scan-face", label: () => L("Faces", "الوجوه"), count: () => S.counts.suggested },
      { id: "students", icon: "users", label: () => L("Students", "الطلاب") },
      { id: "coverage", icon: "chart-pie", label: () => L("Coverage", "التغطية") },
      { id: "cleanup", icon: "sparkles", label: () => L("Clean up", "تنظيف"), count: () => S.counts.duplicates },
      { id: "books", icon: "book-open", label: () => L("Yearbooks", "الكتب السنوية") },
    ],
  },
  {
    sec: () => L("Posts", "المنشورات"),
    items: [
      { id: "posts", icon: "pen-line", label: () => L("Posts", "المنشورات") },
      { id: "calendar", icon: "calendar", label: () => L("Calendar", "التقويم") },
    ],
  },
  {
    items: [
      { id: "history", icon: "history", label: () => L("History", "السجل") },
      { id: "settings", icon: "settings", label: () => L("Settings", "الإعدادات") },
      { id: "help", icon: "circle-help", label: () => L("Help", "المساعدة") },
    ],
  },
];

function sidebar() {
  const side = $("#side");
  const school = S.schoolName || L("Your school", "مدرستك");
  const parts = [
    `<div class="brand"><span class="logo">${esc(school.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span><div><b>${esc(school)}</b><span>School Social Hub</span></div></div>`,
    `<button class="searchbox" id="sbtn">${icon("search", 14)} ${L("Search", "بحث")}<span class="k ltr">⌘K</span></button>`,
    `<button class="create" id="cbtn">${icon("plus", 15)} ${L("Create post", "إنشاء منشور")}</button>`,
  ];
  for (const sec of NAV) {
    parts.push(sec.sec ? `<div class="navsec">${esc(sec.sec())}</div>` : `<div style="height: 6px"></div>`);
    for (const it of sec.items) {
      const c = it.count?.() ?? 0;
      const on = App.view === it.id || (it.id === "students" && App.view === "student");
      parts.push(`<button class="nav ${on ? "on" : ""}" data-go="${it.id}"><span class="ic">${icon(it.icon, 16)}</span>${esc(it.label())}${c ? `<span class="count">${num(c)}</span>` : ""}</button>`);
    }
  }
  parts.push(`<div class="grow"></div>${macStatus()}`);
  side.innerHTML = parts.join("");
  $$("[data-go]", side).forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#sbtn", side).onclick = palette;
  $("#cbtn", side).onclick = () => go("posts", { new: true });
  onContext(side, "[data-go]", (b) => [
    { label: L("Open", "فتح"), run: () => go(b.dataset.go) },
    { label: L("Keyboard shortcuts", "اختصارات لوحة المفاتيح"), run: shortcutSheet },
  ]);
  $("#pause", side)?.addEventListener("click", () => call("set", "paused", !S.paused));
}

// Sidebar status: what the Mac is doing, imports running, and Pause.
function macStatus() {
  if (!S.library) return `<div class="macstatus off"><b>${icon("folder-search", 13)} ${L("No library folder", "لا يوجد مجلد مكتبة")}</b><button data-go="settings">${L("Choose it in Settings", "اختره من الإعدادات")}</button></div>`;
  if (S.libraryMissing) return `<div class="macstatus paused"><b>${icon("hard-drive", 13)} ${L("Library drive not found", "قرص المكتبة غير موجود")}</b><span>${L("Connect the drive", "وصّل القرص")}</span></div>`;
  const e = S.engine ?? {};
  const work = (e.processing ?? 0) + (e.faceQueue ?? 0);
  const q = S.queue;
  const lines = [];
  if (S.paused) lines.push(L("Paused", "متوقف مؤقتًا"));
  else if (e.scanning) lines.push(L("Looking through the library…", "جارٍ فحص المكتبة…"));
  else if (work) lines.push(L(`${num(work)} photos to read`, `${num(work)} صورة قيد القراءة`));
  else lines.push(L("Library up to date", "المكتبة محدّثة"));
  if (q.pending) lines.push(L(`${num(q.pending)} sending`, `${num(q.pending)} قيد الإرسال`));
  const fm = S.faceModel;
  if (fm?.state === "downloading") lines.push(L(`Better face engine ${fm.total ? Math.round((fm.done / fm.total) * 100) : 0}%`, `محرك الوجوه الأفضل ${fm.total ? Math.round((fm.done / fm.total) * 100) : 0}٪`));
  const imp = (S.imports ?? []).filter((i) => i.state === "running" || i.state === "waiting");
  const impHtml = imp
    .map((i) => `<div class="imp" data-go="import">${icon("download", 12)}<span class="grow">${esc(i.title)}</span><span class="ltr">${i.total ? Math.round((i.done / i.total) * 100) : 0}%</span></div><div class="bar"><i style="width:${i.total ? (i.done / i.total) * 100 : 0}%"></i></div>`)
    .join("");
  return `<div class="macstatus ${S.paused ? "paused" : S.signedIn ? "" : "off"}">
    <div class="row nowrap"><b class="grow">${icon(S.signedIn ? "laptop" : "cloud-off", 13)} ${S.signedIn ? L("Mac online", "الماك متصل") : L("Not signed in", "غير مسجّل الدخول")}</b>
    <button id="pause" class="pz" title="${S.paused ? L("Resume", "استئناف") : L("Pause", "إيقاف مؤقت")}">${icon(S.paused ? "play" : "pause", 13)}</button></div>
    <span>${lines.map(esc).join(" · ")}</span>${impHtml}</div>`;
}

// Big clear page title; the bar is the window's title bar (drag to move).
function topbar(title, sub = "", right = "") {
  return `<header class="topbar"><div class="title"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div><div class="grow"></div><div class="tools">${right}</div></header>`;
}

function go(view, params = {}) {
  if (App.leave) App.leave();
  App.leave = null;
  App.view = view;
  App.params = params;
  closeOverlay();
  rerender();
}

function rerender() {
  sidebar();
  const v = App.views[App.view] ?? App.views.today;
  const main = $("#main");
  main.replaceChildren();
  v.render(main, App.params);
}

function applyLook() {
  const root = document.documentElement;
  root.lang = S.language;
  root.dir = S.language === "ar" ? "rtl" : "ltr";
  const dark = S.theme === "dark" || (S.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.size = S.textSize;
  root.dataset.platform = S.platform ?? "";
  root.dataset.motion = S.motion ?? "full";
  root.style.setProperty("--accent", S.accent || "#2f6fdf");
}

// ---------- Keys, menu commands, drag and drop ----------
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== "checkbox";
  if (e.metaKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return palette();
  }
  if (App.overlayKeys) return App.overlayKeys(e, typing);
  if (typing) return;
  if (App.views[App.view]?.onKey?.(e) === true) return;
  globalKey(e);
});

window.hub.onCommand((c) => {
  if (c.startsWith("go:")) {
    const v = c.slice(3);
    if (v === "students-import") return go("students", { import: true });
    return go(v);
  }
  if (c === "undo") return doUndo();
  if (c === "search") return palette();
  App.views[App.view]?.onCommand?.(c);
});

let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  $("#main").dataset.drop = L("Drop a folder of photos to import, or a class list", "أفلت مجلد صور لاستيراده، أو قائمة فصول");
  document.body.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("dragging");
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  const paths = files.map((f) => window.hub.pathFor(f));
  if (/\.(xlsx|csv)$/i.test(paths[0])) return go("students", { import: true, file: paths[0] });
  // Several folders dropped together: one event each.
  go("import", paths.length > 1 ? { sources: paths } : { source: paths[0] });
});
