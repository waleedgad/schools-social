// Library: album sections and school years on the left, photos edge to edge
// on the right under a floating toolbar, and an info panel that slides in.
const lib = {
  filter: {}, list: [], shown: [], sel: new Set(), anchor: null, focus: 0, tile: 170, cols: null, zoom: "all",
  stacks: true, openStacks: new Set(), stackOf: new Map(), info: false, tree: null, albums: null, classes: [],
};
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`hub.${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`hub.${k}`, JSON.stringify(v));
    } catch {}
  },
};
lib.tile = store.get("tile", 170);
lib.stacks = store.get("stacks", true);
lib.info = store.get("info", false);

const ALBUMS = () => [
  { id: "all", sec: "smart", icon: "images", label: L("All photos", "كل الصور") },
  { id: "week", sec: "smart", icon: "clock-3", label: L("Added this week", "أضيفت هذا الأسبوع") },
  { id: "picks", sec: "smart", icon: "flag", label: L("Picks", "المختارة") },
  { id: "five", sec: "smart", icon: "star", label: L("5 stars", "5 نجوم") },
  { id: "lastyear", sec: "smart", icon: "history", label: L("This week in past years", "هذا الأسبوع في سنوات سابقة") },
  { id: "groups", sec: "smart", icon: "users", label: L("Group photos", "صور جماعية") },
  { id: "smiles", sec: "smart", icon: "smile", label: L("Best smiles", "أجمل الابتسامات") },
  { id: "posted", sec: "smart", icon: "send", label: L("Used in posts", "استُخدمت في منشورات") },
  { id: "sent", sec: "smart", icon: "cloud", label: L("On the website", "على الموقع") },
  { id: "nofaces", sec: "smart", icon: "image", label: L("No people", "بلا أشخاص") },
  { id: "raw", sec: "smart", icon: "aperture", label: "RAW" },
  { id: "red", sec: "labels", icon: "circle", label: L("Red", "أحمر"), color: "#e5484d" },
  { id: "yellow", sec: "labels", icon: "circle", label: L("Yellow", "أصفر"), color: "#f5c400" },
  { id: "green", sec: "labels", icon: "circle", label: L("Green", "أخضر"), color: "#30a46c" },
  { id: "ready", sec: "work", icon: "square-pen", label: L("Ready to post", "جاهزة للنشر") },
  { id: "tocull", sec: "work", icon: "play", label: L("To cull", "للفرز") },
  { id: "untagged", sec: "work", icon: "user-search", label: L("Faces to name", "وجوه بلا أسماء") },
  { id: "fix", sec: "work", icon: "triangle-alert", label: L("Needs fixing", "تحتاج إصلاحًا") },
  { id: "nopost", sec: "work", icon: "shield", label: L("Can't appear in posts", "لا يظهرون في المنشورات") },
  { id: "noevent", sec: "work", icon: "folder-input", label: L("Needs sorting", "تحتاج ترتيبًا") },
  { id: "notsent", sec: "work", icon: "cloud-upload", label: L("Picks not on the website", "مختارة لم تُرسل للموقع") },
  { id: "missing", sec: "work", icon: "image-off", label: L("Originals missing", "أصول مفقودة") },
  { id: "rejected", sec: "work", icon: "x", label: L("Rejected", "المرفوضة") },
  { id: "hidden", sec: "work", icon: "eye-off", label: L("Hidden", "المخفية") },
];
const CATS = () => ({
  sports: [L("Sports", "الرياضة"), "trophy"], art: [L("Art and music", "الفن والموسيقى"), "palette"], science: [L("Science", "العلوم"), "lightbulb"],
  celebrations: [L("Celebrations", "الاحتفالات"), "party-popper"], assemblies: [L("Assemblies", "الطابور والإذاعة"), "megaphone"], trips: [L("Trips", "الرحلات"), "map-pin"],
});
const OCC = () => ({
  firstday: L("First days of school", "أول أيام الدراسة"), ramadan: L("Ramadan", "رمضان"), eidfitr: L("Eid al-Fitr", "عيد الفطر"), eidadha: L("Eid al-Adha", "عيد الأضحى"),
  hijrinew: L("Islamic New Year", "رأس السنة الهجرية"), mawlid: L("The Prophet's birthday", "المولد النبوي"), national: L("National days", "الأعياد الوطنية"),
  teachers: L("Teachers' Day", "يوم المعلم"), mothers: L("Mother's Day", "عيد الأم"), graduation: L("Graduations", "حفلات التخرج"),
});
const SECS = () => [
  ["smart", L("Smart albums", "ألبومات ذكية")],
  ["labels", L("Colour labels", "الألوان")],
  ["work", L("To do", "مهام")],
  ["mine", L("My albums", "ألبوماتي")],
  ["cats", L("Kinds of event", "أنواع الفعاليات")],
  ["occ", L("Occasions", "المناسبات")],
  ["people", L("People", "الأشخاص")],
  ["classes", L("Classes", "الفصول")],
  ["books", L("Yearbooks", "الكتب السنوية")],
  ["years", L("School years", "السنوات الدراسية")],
];
const collapsed = new Set(store.get("collapsed", []));
let pinned = store.get("pinned", []);
function toggleSec(id) {
  collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
  store.set("collapsed", [...collapsed]);
  drawTree();
}
function togglePin(id) {
  pinned = pinned.includes(id) ? pinned.filter((p) => p !== id) : [id, ...pinned];
  store.set("pinned", pinned);
  drawTree();
}
// "20 Oct 2020 · Sports Day" instead of folder names.
const eventLabel = (ev) => eventName(ev.event_title, ev.event_date);
const labelName = (l) => ({ red: L("Red", "أحمر"), yellow: L("Yellow", "أصفر"), green: L("Green", "أخضر") })[l] ?? l;
const PROBLEMS = () => ({
  blurry: L("Blurry", "ضبابية"), dark: L("Too dark", "مظلمة"), bright: L("Too bright", "ساطعة جدًا"), "head-cut": L("Head cut off", "رأس مقطوع"), "faces-small": L("Faces too small", "وجوه صغيرة جدًا"),
});

App.views.library = {
  render(main, params) {
    if (params.event !== undefined || params.album || params.student || params.className || params.year || params.together || params.grade || params.stage) {
      lib.filter = { title: params.title, event: params.event, album: params.album, student: params.student, className: params.className, year: params.year, term: params.term, together: params.together, grade: params.grade, stage: params.stage };
    }
    if (!lib.filter.event && !lib.filter.album && !lib.filter.year && !lib.filter.student && !lib.filter.className && !lib.filter.together && !lib.filter.grade && !lib.filter.stage) lib.filter.album = "all";
    main.innerHTML =
      topbar(`<span id="libtitle"></span>`, `<span id="libsub"></span>`,
        `<button class="btn" id="best">${icon("sparkles", 15)} ${L("Best photos", "أفضل الصور")}</button><button class="btn" id="cull">${icon("play", 15)} ${L("Cull", "فرز")}</button><button class="btn primary" id="imp">${icon("download", 15)} ${L("Import", "استيراد")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree" id="tree">${skeletonRows(10)}</nav><div class="gridwrap">
        <div class="filters" id="filters"></div><div class="photos" id="grid">${skeletonTiles(30)}</div><div class="scrub" id="scrub"></div><div id="selbar"></div></div><aside class="infopanel ${lib.info ? "" : "hide"}" id="info"></aside></div></div>`;
    $("#imp", main).onclick = () => go("import", lib.filter.event ? { event: lib.filter.event } : {});
    $("#cull", main).onclick = () => lib.shown.length && openViewer(lib.shown.map((p) => p.id), Math.max(0, lib.shown.findIndex((p) => lib.sel.has(p.id))), { cull: true });
    $("#best", main).onclick = () => bestPicker();
    this.loadTree();
    drawFilters();
    this.load();
  },
  onState(changed) {
    if (changed.includes("photos") || changed.includes("faces") || changed.includes("all")) {
      clearTimeout(lib.reload);
      lib.reload = setTimeout(() => {
        this.loadTree();
        this.load(true);
      }, 800);
    }
  },
  onCommand(c) {
    if (c === "selectAll") {
      lib.shown.forEach((p) => lib.sel.add(p.id));
      refreshSelection();
    }
    if (c === "post") newPostFromSelection();
  },
  keys: () => [
    ["← → ↑ ↓", L("Move", "تنقل")], ["Space", L("Quick look", "نظرة سريعة")], ["Enter", L("Open", "فتح")], ["P", L("Pick", "اختيار")], ["X", L("Reject", "رفض")],
    ["U", L("Clear pick", "إلغاء الاختيار")], ["0-5", L("Stars", "نجوم")], ["6 7 8", L("Red, yellow, green label", "لون أحمر، أصفر، أخضر")], ["9", L("No label", "بلا لون")],
    ["T", L("Name who is in it", "تسمية من فيها")], ["C", L("Compare", "مقارنة")], ["H", L("Hide", "إخفاء")], ["I", L("Info panel", "لوحة المعلومات")], ["S", L("Stack bursts", "تجميع المتتابعة")],
    ["+ −", L("Bigger, smaller", "أكبر، أصغر")], ["⌘ A", L("Select all", "تحديد الكل")], ["⌘ ⌫", L("Move to Bin", "نقل إلى السلة")], ["⌘ N", L("New post", "منشور جديد")],
  ],
  onKey(e) {
    if ($(".quicklook")) return;
    const ids = selectedIds();
    const k = e.key.toLowerCase();
    if (e.metaKey && k === "a") {
      e.preventDefault();
      lib.shown.forEach((p) => lib.sel.add(p.id));
      refreshSelection();
      return true;
    }
    if (e.metaKey && k === "backspace" && ids.length) return act.bin(ids), true;
    if (e.metaKey || e.ctrlKey) return;
    if (k === "escape") {
      lib.sel.clear();
      return refreshSelection(), true;
    }
    if (["arrowright", "arrowleft", "arrowdown", "arrowup"].includes(k)) {
      e.preventDefault();
      const grid = $("#grid");
      const first = $(".tile", grid);
      const cols = first ? Math.max(1, Math.round(grid.clientWidth / (first.getBoundingClientRect().width + 3))) : 1;
      const rtl = document.documentElement.dir === "rtl";
      const step = { arrowright: rtl ? -1 : 1, arrowleft: rtl ? 1 : -1, arrowdown: cols, arrowup: -cols }[k];
      lib.focus = Math.min(lib.shown.length - 1, Math.max(0, lib.focus + step));
      if (!e.shiftKey) lib.sel.clear();
      if (lib.shown[lib.focus]) lib.sel.add(lib.shown[lib.focus].id);
      refreshSelection();
      $(`.tile[data-i="${lib.focus}"]`)?.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (k === " " && lib.shown.length) {
      e.preventDefault();
      return quickLook(), true;
    }
    if (k === "enter" && lib.shown.length) {
      e.preventDefault();
      return openViewer(lib.shown.map((p) => p.id), lib.focus, {}), true;
    }
    if (k === "+" || k === "=") return setTile(Math.min(420, lib.tile + 30)), true;
    if (k === "-") return setTile(Math.max(90, lib.tile - 30)), true;
    if (k === "i") return toggleInfo(), true;
    if (k === "s") {
      lib.stacks = !lib.stacks;
      store.set("stacks", lib.stacks);
      return this.load(true), true;
    }
    if (!ids.length) return;
    if (k === "p") act.flag(ids, 1);
    else if (k === "x") act.flag(ids, -1);
    else if (k === "u") act.flag(ids, 0);
    else if (/^[0-5]$/.test(k)) act.rate(ids, Number(k));
    else if (k === "6") act.label(ids, "red");
    else if (k === "7") act.label(ids, "yellow");
    else if (k === "8") act.label(ids, "green");
    else if (k === "9") act.label(ids, null);
    else if (k === "t") act.tag(ids);
    else if (k === "h") act.hide(ids, lib.filter.album !== "hidden");
    else if (k === "c" && ids.length >= 2) openCompare(ids.slice(0, 4));
    else return;
    return true;
  },
  async loadTree() {
    const [t, cls, albums] = await Promise.all([quiet("tree"), quiet("classes"), quiet("albums")]);
    if (!t || !$("#tree")) return;
    lib.tree = t;
    lib.albums = albums ?? { counts: {}, mine: [], cats: [], occ: [], grades: [], kinds: [], photographers: [] };
    lib.classes = cls ?? [];
    drawTree();
    drawFilters();
    drawTitle();
  },
  async load(keepSel) {
    if (lib.filter.album === "albums") {
      lib.list = lib.shown = [];
      drawTitle();
      return drawAlbumCards();
    }
    const f = { ...lib.filter };
    delete f.title;
    if (f.album === "all") delete f.album;
    const list = await quiet("photos", f);
    if (!list || !$("#grid")) return;
    lib.list = list;
    lib.stackOf = new Map();
    if (lib.stacks && (!f.sort || f.sort === "time" || f.sort === "newest") && list.length > 1) {
      const groups = (await quiet("stacks", list.map((p) => p.id))) ?? [];
      for (const g of groups) lib.stackOf.set(g[0], g);
    }
    const inStack = new Set([...lib.stackOf.values()].flatMap((g) => g.slice(1)));
    lib.shown = list.filter((p) => !inStack.has(p.id) || [...lib.openStacks].some((top) => lib.stackOf.get(top)?.includes(p.id)));
    if (!keepSel) {
      lib.sel.clear();
      lib.focus = 0;
    } else {
      const ids = new Set(lib.shown.map((p) => p.id));
      [...lib.sel].forEach((id) => !ids.has(id) && lib.sel.delete(id));
    }
    drawTitle();
    drawGrid();
    if (f.album === "noevent") strayBanner();
    // "Pick the best" from an import summary goes straight into culling.
    if (App.params.cull && lib.shown.length) {
      App.params.cull = false;
      openViewer(lib.shown.map((p) => p.id), 0, { cull: true });
    }
  },
};

function setTile(n) {
  lib.tile = n;
  lib.cols = null;
  store.set("tile", n);
  drawGrid();
}
function toggleInfo() {
  lib.info = !lib.info;
  store.set("info", lib.info);
  $("#info")?.classList.toggle("hide", !lib.info);
  drawInfo();
}

function selectedIds() {
  return lib.shown.filter((p) => lib.sel.has(p.id)).map((p) => p.id);
}

function drawTitle() {
  const f = lib.filter;
  const a = lib.albums ?? {};
  let title = L("Library", "المكتبة");
  let sub = "";
  if (f.album === "albums") title = L("Albums", "الألبومات");
  else if (f.album?.startsWith("my:")) title = (a.mine ?? []).find((x) => `my:${x.id}` === f.album)?.name ?? title;
  else if (f.album?.startsWith("cat:")) title = CATS()[f.album.slice(4)]?.[0] ?? title;
  else if (f.album?.startsWith("occ:")) title = OCC()[f.album.slice(4)] ?? title;
  else if (f.album?.startsWith("book:")) title = L(`Yearbook photos · ${f.album.slice(5).split("|")[0]}`, `صور الكتاب السنوي · ${f.album.slice(5).split("|")[0]}`);
  else if (f.album?.startsWith("kind:")) title = KINDS()[f.album.slice(5)] ?? title;
  else if (f.album?.startsWith("imp:")) title = f.title ?? L("This import", "هذا الاستيراد");
  else if (f.album) title = ALBUMS().find((x) => x.id === f.album)?.label ?? title;
  if (f.event) {
    const ev = lib.tree?.rows.find((r) => r.event_key === f.event);
    title = ev ? ev.event_title : f.event;
    sub = [ev?.event_date && fmtDate(ev.event_date), ev?.term, ev?.year].filter(Boolean).join(" · ");
  } else if (f.year) title = [f.year, f.term].filter(Boolean).join(" · ");
  if (f.student) title = L("Photos of one person", "صور شخص");
  if (f.together?.length) title = L("Photos of them together", "صورهم معًا");
  if (f.className && !f.event) title = `${L("Class", "فصل")} ${f.className}`;
  else if (f.grade && !f.event) title = f.grade;
  else if (f.stage && !f.event) title = f.stage;
  if ($("#libtitle")) $("#libtitle").textContent = title;
  const picks = lib.list.filter((p) => p.flag === 1).length;
  if ($("#libsub")) $("#libsub").textContent = f.album === "albums" ? "" : [sub, plural(lib.list.length, "photo", "photos", "صورة"), picks ? L(`${num(picks)} picked`, `${num(picks)} مختارة`) : ""].filter(Boolean).join(" · ");
}

// ---------- Sidebar of albums and years ----------
function drawTree() {
  const t = lib.tree;
  const tree = $("#tree");
  if (!t || !tree) return;
  const f = lib.filter;
  const a = lib.albums ?? {};
  const counts = a.counts ?? {};
  const item = (attrs, ic, label, n, on, extra = "") =>
    `<div class="t ${on ? "on" : ""}" ${attrs}>${ic}<span class="name">${esc(label)}</span>${extra}${n !== undefined && n !== null ? `<span class="n">${num(n)}</span>` : ""}</div>`;
  const sections = {
    smart: () => ALBUMS().filter((x) => x.sec === "smart").filter((x) => counts[x.id] !== 0 || x.id === "all" || f.album === x.id).map((x) => item(`data-album="${x.id}"`, icon(x.icon, 14), x.label, counts[x.id], f.album === x.id)),
    labels: () => ALBUMS().filter((x) => x.sec === "labels" && (counts[x.id] || f.album === x.id)).map((x) => item(`data-album="${x.id}"`, `<span class="dot" style="background:${x.color}; margin: 0 3px"></span>`, x.label, counts[x.id], f.album === x.id)),
    work: () => ALBUMS().filter((x) => x.sec === "work").filter((x) => counts[x.id] || f.album === x.id).map((x) => item(`data-album="${x.id}"`, icon(x.icon, 14), x.label, counts[x.id], f.album === x.id)),
    mine: () => [
      item(`data-album="albums"`, icon("layout-grid", 14), L("All albums", "كل الألبومات"), null, f.album === "albums"),
      ...(a.mine ?? []).map((x) => item(`data-album="my:${x.id}" data-mine="${x.id}"`, icon(x.rule ? "wand-sparkles" : x.shared ? "users" : "book-marked", 14), x.name, x.n, f.album === `my:${x.id}`)),
      `<div class="t" id="newalbum">${icon("plus", 14)}<span class="name muted">${L("New album… (or drop photos here)", "ألبوم جديد… (أو أفلت الصور هنا)")}</span></div>`,
    ],
    cats: () => (a.cats ?? []).map((c) => item(`data-album="${c.id}"`, icon(CATS()[c.key]?.[1] ?? "tag", 14), CATS()[c.key]?.[0] ?? c.key, c.n, f.album === c.id)),
    occ: () => (a.occ ?? []).map((o) => item(`data-album="${o.id}"`, icon("calendar-days", 14), OCC()[o.key] ?? o.key, o.n, f.album === o.id)),
    people: () => [
      item(`data-go-faces="1"`, icon("scan-face", 14), L("All people", "كل الأشخاص"), null, false),
      ...(a.kinds ?? []).map((k) => item(`data-album="${k.id}"`, icon(k.key === "teacher" ? "graduation-cap" : k.key === "parent" ? "heart-handshake" : k.key === "visitor" ? "user-round" : "briefcase", 14), KINDS()[k.key], k.n, f.album === k.id)),
      item(`data-together="1"`, icon("users-round", 14), L("Two people together…", "شخصان معًا…"), null, !!f.together?.length),
    ],
    classes: () => {
      const out = [];
      const stages = new Map();
      for (const c of lib.classes) {
        if (!c.class_name) continue;
        const st = c.stage ?? L("Other", "أخرى");
        if (!stages.has(st)) stages.set(st, new Map());
        const g = c.grade ?? "—";
        if (!stages.get(st).has(g)) stages.get(st).set(g, []);
        stages.get(st).get(g).push(c);
      }
      for (const [st, grades] of stages) {
        out.push(item(`data-stage="${esc(st)}"`, icon("school", 14), st, null, f.stage === st && !f.grade && !f.className));
        for (const [g, list] of grades) {
          out.push(`<div class="t lvl1 ${f.grade === g && !f.className ? "on" : ""}" data-grade="${esc(g)}"><span class="name">${esc(g)}</span></div>`);
          if (f.stage === st || f.grade === g || list.some((c) => c.class_name === f.className))
            for (const c of list) out.push(`<div class="t lvl2 ${f.className === c.class_name && !f.event ? "on" : ""}" data-class-only="${esc(c.class_name)}"><span class="name">${esc(c.class_name)}</span></div>`);
        }
      }
      return out;
    },
    books: () => (a.grades ?? []).map((g) => item(`data-album="${esc(g.id)}"`, icon("book-open", 14), `${g.grade} · ${g.year}`, g.n, f.album === g.id)),
    years: () => {
      const out = [];
      const years = new Map();
      for (const r of t.rows) {
        const y = r.year ?? L("No date", "بلا تاريخ");
        if (!years.has(y)) years.set(y, new Map());
        const terms = years.get(y);
        const term = r.term ?? "—";
        if (!terms.has(term)) terms.set(term, []);
        terms.get(term).push(r);
      }
      if (!t.rows.length) out.push(`<p class="muted small" style="padding: 4px 8px">${L("No photos yet. Import some, or choose your library folder in Settings.", "لا توجد صور بعد. استورد بعضها، أو اختر مجلد المكتبة من الإعدادات.")}</p>`);
      for (const [y, terms] of years) {
        const yn = [...terms.values()].flat().reduce((s, r) => s + r.n, 0);
        out.push(item(`data-year="${esc(y)}"`, icon("calendar-range", 14), y, yn, f.year === y && !f.term && !f.event));
        for (const [term, events] of terms) {
          const tn = events.reduce((s, r) => s + r.n, 0);
          out.push(`<div class="t lvl1 ${f.year === y && f.term === term && !f.event ? "on" : ""}" data-year="${esc(y)}" data-term="${esc(term)}"><span class="name">${esc(term)}</span><span class="n">${num(tn)}</span></div>`);
          for (const ev of events) {
            if (!ev.event_key) continue;
            const on = f.event === ev.event_key;
            out.push(`<div class="t lvl2 ${on && !f.className ? "on" : ""}" data-event="${esc(ev.event_key)}" data-title="${esc(ev.event_title)}" data-date="${esc(ev.event_date ?? "")}" title="${esc(ev.event_key)}">${icon("folder", 13)}<span class="name">${esc(eventLabel(ev))}</span>${ev.picks ? `<span class="tag good" style="padding: 0 5px">${num(ev.picks)}</span>` : ""}<span class="n">${num(ev.n)}</span></div>`);
            if (on) for (const c of t.classes.filter((c) => c.event_key === ev.event_key)) out.push(`<div class="t lvl3 ${f.className === c.class_name ? "on" : ""}" data-event="${esc(ev.event_key)}" data-class="${esc(c.class_name)}"><span class="name">${esc(c.class_name)}</span><span class="n">${num(c.n)}</span></div>`);
          }
        }
      }
      return out;
    },
  };
  const order = [...pinned.filter((p) => sections[p]), ...SECS().map(([id]) => id).filter((id) => !pinned.includes(id))];
  const names = Object.fromEntries(SECS());
  const out = [];
  for (const id of order) {
    const rows = sections[id]();
    if (!rows.length && id !== "mine" && id !== "years") continue;
    out.push(`<div class="head ${collapsed.has(id) ? "shut" : ""}" data-sec="${id}">${icon("chevron-down", 12)}<span>${esc(names[id])}</span><button class="btn small ghost pin" data-pin="${id}" title="${pinned.includes(id) ? L("Unpin", "إلغاء التثبيت") : L("Pin to the top", "تثبيت في الأعلى")}">${icon(pinned.includes(id) ? "pin-off" : "pin", 12)}</button></div>`);
    if (!collapsed.has(id)) out.push(...rows);
  }
  tree.innerHTML = out.join("");
  $$("[data-sec]", tree).forEach((el) => (el.onclick = (e) => !e.target.closest("[data-pin]") && toggleSec(el.dataset.sec)));
  $$("[data-pin]", tree).forEach((b) => (b.onclick = () => togglePin(b.dataset.pin)));
  const nb = $("#newalbum", tree);
  nb.onclick = () => albumDialog(selectedIds());
  nb.addEventListener("dragover", (e) => e.dataTransfer.types.includes("text/hub-photos") && (e.preventDefault(), nb.classList.add("drop")));
  nb.addEventListener("dragleave", () => nb.classList.remove("drop"));
  nb.addEventListener("drop", (e) => { e.preventDefault(); nb.classList.remove("drop"); albumDialog(JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]")); });
  $$("[data-mine]", tree).forEach((el) => {
    el.addEventListener("dragover", (e) => e.dataTransfer.types.includes("text/hub-photos") && (e.preventDefault(), el.classList.add("drop")));
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drop");
      const ids = JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]");
      await call("addToAlbum", Number(el.dataset.mine), ids);
      toast(L(`Added ${ids.length} photos`, `أُضيفت ${num(ids.length)} صورة`));
    });
  });
  $$(".t", tree).forEach((el) => {
    if (el.id === "newalbum") return;
    el.onclick = () => {
      const d = el.dataset;
      if (d.goFaces) return go("faces");
      if (d.together) return togetherPicker();
      if (d.album) lib.filter = { album: d.album };
      else if (d.classOnly) lib.filter = { className: d.classOnly };
      else if (d.grade) lib.filter = { grade: d.grade };
      else if (d.stage) lib.filter = { stage: d.stage };
      else if (d.event) lib.filter = { event: d.event, className: d.class };
      else if (d.year) lib.filter = { year: d.year, term: d.term };
      lib.openStacks.clear();
      drawTree();
      drawFilters();
      App.views.library.load();
    };
    // Drop photos on an event to move them there.
    if (el.dataset.event && !el.dataset.class) {
      el.addEventListener("dragover", (e) => e.dataTransfer.types.includes("text/hub-photos") && (e.preventDefault(), el.classList.add("drop")));
      el.addEventListener("dragleave", () => el.classList.remove("drop"));
      el.addEventListener("drop", async (e) => {
        el.classList.remove("drop");
        const ids = JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]");
        if (!ids.length) return;
        e.preventDefault();
        e.stopPropagation();
        await call("moveTo", ids, { title: el.dataset.title, date: el.dataset.date || photosDate(ids) });
        toast(L(`Moved ${ids.length} photos to ${el.dataset.title}`, `نُقلت ${num(ids.length)} صورة إلى ${el.dataset.title}`), { undo: true });
      });
    }
  });
  // Right-click: events, classes, albums.
  onContext(tree, "[data-event], [data-mine], [data-class-only], [data-album]", (el) => {
    const d = el.dataset;
    if (d.event && !d.class) return eventMenu(d.event, d.title, d.date);
    if (d.mine) return albumMenu(Number(d.mine));
    const open = { label: L("Open", "فتح"), run: () => el.click() };
    const filter = d.classOnly ? { className: d.classOnly } : d.album ? { album: d.album } : null;
    if (!filter) return [open];
    return [
      open,
      { label: L("Best photos…", "أفضل الصور…"), run: () => { el.click(); setTimeout(bestPicker, 400); } },
      { label: L("Make posts from these…", "إنشاء منشورات من هذه…"), run: async () => { el.click(); setTimeout(() => typeof makePostsFrom === "function" && makePostsFrom({ ...filter }), 400); } },
      ...(d.classOnly ? [{ label: L("Class coverage", "تغطية الفصل"), run: () => go("coverage", { className: d.classOnly }) }] : []),
    ];
  });
}

function eventMenu(key, title, date) {
  return [
    { label: L("Open", "فتح"), run: () => { lib.filter = { event: key }; drawTree(); drawFilters(); App.views.library.load(); } },
    "-",
    { label: L("Rename…", "إعادة تسمية…"), run: () => renameEvent(key) },
    { label: L("Move to another date…", "نقل إلى تاريخ آخر…"), run: () => renameEvent(key) },
    { label: L("Best photos…", "أفضل الصور…"), run: () => { lib.filter = { event: key }; App.views.library.load().then(bestPicker); } },
    { label: L("Make posts from this event…", "إنشاء منشورات من هذه الفعالية…"), run: () => typeof makePostsFrom === "function" && makePostsFrom({ event: key }, title) },
    { label: L("Set the kind of event", "نوع الفعالية"), sub: Object.entries(CATS()).map(([k, [lab]]) => ({ label: lab, run: async () => { const ids = (await call("photos", { event: key })).map((p) => p.id); await call("setCategory", ids, k); toast(L("Saved", "تم الحفظ")); } })) },
    "-",
    { label: S.platform === "win32" ? L("Show in Explorer", "إظهار في المستكشف") : L("Show in Finder", "إظهار في Finder"), run: async () => { const dir = await call("eventFolderPath", key); if (dir) call("showFile", dir); } },
  ];
}

// ---------- Floating toolbar ----------
function drawFilters() {
  const bar = $("#filters");
  if (!bar) return;
  const f = lib.filter;
  const a = lib.albums ?? {};
  bar.innerHTML = `
    <input type="search" id="q" placeholder="${L("Search: name, event, words…", "ابحث: اسم، فعالية، كلمات…")}" value="${esc(f.search ?? "")}" style="width: 190px" />
    ${pills([["all", L("All", "الكل")], ["days", L("Days", "أيام")], ["months", L("Months", "أشهر")], ["years", L("Years", "سنوات")]], lib.zoom, "data-zoom")}
    <button class="pill menu ${f.className || f.grade || f.stage ? "on" : ""}" id="clsmenu">${esc(f.className || f.grade || f.stage || L("Class", "الفصل"))}${icon("chevron-down", 12)}</button>
    ${pillMenu("rate", L("Rating", "التقييم"), [3, 4, 5].map((n) => [n, `${"★".repeat(n)}+`]), f.minRating)}
    ${pillMenu("label", L("Colour", "اللون"), [["red", labelName("red")], ["yellow", labelName("yellow")], ["green", labelName("green")]], f.label)}
    ${(a.photographers ?? []).length ? pillMenu("who", L("Taken by", "التقطها"), a.photographers.map((p) => [p.photographer, `${p.photographer} (${num(p.n)})`]), f.photographer) : ""}
    ${pillMenu("sort", L("Oldest first", "الأقدم أولًا"), [["time", L("Oldest first", "الأقدم أولًا")], ["newest", L("Newest first", "الأحدث أولًا")], ["quality", L("Best first", "الأفضل أولًا")], ["faces", L("Most faces", "أكثر وجوهًا")], ["unnamed", L("Most unnamed faces", "أكثر وجوه بلا أسماء")], ["name", L("File name", "اسم الملف")]], f.sort ?? "")}
    ${f.event ? `<button class="btn small ghost" id="evmore" title="${L("Event", "الفعالية")}">${icon("ellipsis", 16)}</button>` : ""}
    <span class="grow"></span>
    <button class="btn small ghost ${lib.stacks ? "" : "muted"}" id="stk" title="${L("Stack bursts (S)", "تجميع اللقطات المتتابعة (S)")}">${icon("layers", 15)}</button>
    <button class="btn small ghost" id="sz" title="${L("Photo size (+ −)", "حجم الصور (+ −)")}">${icon("grid-3x3", 15)}</button>
    <button class="btn small ghost ${lib.info ? "" : "muted"}" id="inf" title="${L("Info (I)", "المعلومات (I)")}">${icon("info", 15)}</button>`;
  let t;
  $("#q", bar).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      lib.filter.search = e.target.value.trim() || undefined;
      App.views.library.load();
    }, 250);
  };
  bindPills(bar, "data-zoom", (z) => {
    lib.zoom = z;
    drawFilters();
    drawGrid();
  });
  const reload = () => { drawFilters(); App.views.library.load(); };
  $("#clsmenu", bar).onclick = () => menu(classMenuItems());
  bindPillMenu(bar, "rate", [3, 4, 5].map((n) => [n, `${"★".repeat(n)}+`]), f.minRating, (v) => { lib.filter.minRating = v ? Number(v) : undefined; reload(); });
  bindPillMenu(bar, "label", [["red", labelName("red")], ["yellow", labelName("yellow")], ["green", labelName("green")]], f.label, (v) => { lib.filter.label = v; reload(); });
  bindPillMenu(bar, "who", (a.photographers ?? []).map((p) => [p.photographer, p.photographer]), f.photographer, (v) => { lib.filter.photographer = v; reload(); });
  bindPillMenu(bar, "sort", [["time", L("Oldest first", "الأقدم أولًا")], ["newest", L("Newest first", "الأحدث أولًا")], ["quality", L("Best first", "الأفضل أولًا")], ["faces", L("Most faces", "أكثر وجوهًا")], ["unnamed", L("Most unnamed faces", "أكثر وجوه بلا أسماء")], ["name", L("File name", "اسم الملف")]], f.sort ?? "time", (v) => { lib.filter.sort = v; reload(); }, { any: false });
  $("#evmore", bar)?.addEventListener("click", () => {
    const ev = lib.tree?.rows.find((r) => r.event_key === f.event);
    menu(eventMenu(f.event, ev?.event_title, ev?.event_date));
  });
  $("#stk", bar).onclick = () => { lib.stacks = !lib.stacks; store.set("stacks", lib.stacks); drawFilters(); App.views.library.load(true); };
  $("#inf", bar).onclick = () => { toggleInfo(); drawFilters(); };
  $("#sz", bar).onclick = () =>
    menu([
      { label: L("Small", "صغير"), checked: !lib.cols && lib.tile <= 120, run: () => setTile(110) },
      { label: L("Medium", "متوسط"), checked: !lib.cols && lib.tile > 120 && lib.tile < 220, run: () => setTile(170) },
      { label: L("Large", "كبير"), checked: !lib.cols && lib.tile >= 220, run: () => setTile(280) },
      "-",
      ...[2, 4, 8].map((n) => ({ label: L(`${n} in a row`, `${n} في الصف`), checked: lib.cols === n, run: () => { lib.cols = n; drawGrid(); } })),
    ]);
}

// Stage > Grade > Class, as a menu of menus.
function classMenuItems() {
  const stages = new Map();
  for (const c of lib.classes) {
    if (!c.class_name) continue;
    const st = c.stage ?? L("Other", "أخرى");
    if (!stages.has(st)) stages.set(st, new Map());
    const g = c.grade ?? "—";
    if (!stages.get(st).has(g)) stages.get(st).set(g, new Set());
    stages.get(st).get(g).add(c.class_name);
  }
  const set = (patch) => { lib.filter = { ...lib.filter, stage: undefined, grade: undefined, className: undefined, ...patch }; drawFilters(); App.views.library.load(); };
  return [
    { label: L("Every class", "كل الفصول"), checked: !lib.filter.className && !lib.filter.grade && !lib.filter.stage, run: () => set({}) },
    "-",
    ...[...stages].map(([st, grades]) => ({
      label: st,
      sub: [
        { label: L(`All of ${st}`, `كل ${st}`), run: () => set({ stage: st }) },
        "-",
        ...[...grades].map(([g, cls]) => ({ label: g, sub: [{ label: L(`All of ${g}`, `كل ${g}`), run: () => set({ grade: g }) }, "-", ...[...cls].map((c) => ({ label: c, checked: lib.filter.className === c, run: () => set({ className: c }) }))] })),
      ],
    })),
  ];
}

// ---------- The photos ----------
function tileHtml(p, i) {
  const b = [];
  const stack = lib.stackOf.get(p.id);
  if (p.flag === 1) b.push(`<span class="b pick">${icon("check", 11)}</span>`);
  if (p.flag === -1) b.push(`<span class="b no">${icon("x", 11)}</span>`);
  if (p.posts) b.push(`<span class="b post" title="${L("Used in a post", "استُخدمت في منشور")}">${icon("send", 10)}</span>`);
  if (p.offline) b.push(`<span class="b miss" title="${L("Original missing", "الأصل مفقود")}">${icon("image-off", 10)} ${L("Missing", "مفقود")}</span>`);
  if (p.no_post) b.push(`<span class="b no" title="${L("Someone who can't appear in posts", "شخص لا يظهر في المنشورات")}">${icon("shield", 10)}</span>`);
  if (p.face_count) b.push(`<span class="b">${icon("user", 10)} ${p.tagged}/${p.face_count}</span>`);
  else if (p.tagged) b.push(`<span class="b">${icon("user", 10)} ${p.tagged}</span>`);
  if (p.suggested) b.push(`<span class="b sug">? ${p.suggested}</span>`);
  if (p.is_raw || p.has_raw) b.push(`<span class="b">RAW</span>`);
  if (p.edits) b.push(`<span class="b">${icon("pen-line", 10)}</span>`);
  if (p.problems) b.push(`<span class="b" title="${esc(p.problems.split(",").map((x) => PROBLEMS()[x] ?? x).join(", "))}">${icon("triangle-alert", 10)}</span>`);
  return `<div class="tile ${lib.sel.has(p.id) ? "sel" : ""} ${p.flag === -1 ? "rejected" : ""} ${p.hidden ? "hiddenp" : ""} ${stack ? "stack" : ""}" data-i="${i}" draggable="true">
    ${p.thumb === 1 ? `<img loading="lazy" src="hub://thumb/${p.id}" />` : p.thumb === -1 ? `<div class="empty small" style="position:absolute;inset:0;padding:10px">${icon("image-off", 20)}<span>${L("Can't read", "تعذّرت القراءة")}</span></div>` : `<div class="skel" style="position:absolute;inset:0"></div>`}
    ${p.rating ? `<span class="stars">${"★".repeat(p.rating)}</span>` : ""}${p.label ? `<span class="lab ${esc(p.label)}"></span>` : ""}${stack ? `<span class="stackn" data-stack="${p.id}" title="${L("Burst: click to open the stack", "لقطات متتابعة: انقر لفتح المجموعة")}">${icon("layers", 10)} ${stack.length}</span>` : ""}<div class="badges">${b.join("")}</div></div>`;
}

const monthKey = (p) => (p.taken_at ?? p.event_date ?? "").slice(0, 7);
const dayKey = (p) => (p.taken_at ?? p.event_date ?? "").slice(0, 10);
const monthLabel = (k) => (k ? new Date(`${k}-15T12:00:00`).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { month: "long", year: "numeric" }) : L("No date", "بلا تاريخ"));

function drawGrid() {
  const grid = $("#grid");
  if (!grid) return;
  grid.classList.toggle("cols", !!lib.cols);
  grid.style.setProperty("--tile", `${lib.tile}px`);
  if (lib.cols) grid.style.setProperty("--cols", lib.cols);
  const scrub = $("#scrub");
  if (!lib.shown.length) {
    grid.innerHTML = `<div style="grid-column: 1 / -1">${emptyState("images", L("No photos here", "لا توجد صور هنا"), L("Drag a folder of photos onto this window to import it.", "اسحب مجلد صور إلى هذه النافذة لاستيراده."), `<button class="btn primary" data-goimp>${icon("download", 14)} ${L("Import photos", "استيراد صور")}</button>`)}</div>`;
    $("[data-goimp]", grid).onclick = () => go("import");
    if (scrub) scrub.innerHTML = "";
    drawSelbar();
    return;
  }
  const byTime = !lib.filter.sort || lib.filter.sort === "time" || lib.filter.sort === "newest";
  if (lib.zoom === "years" || lib.zoom === "months") {
    // Cards: one per year or month, with the best photo as the cover.
    const key = lib.zoom === "years" ? (p) => p.year ?? L("No date", "بلا تاريخ") : monthKey;
    const groups = new Map();
    for (const p of lib.shown) {
      const k = key(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    grid.innerHTML = [...groups].map(([k, list]) => {
      const cover = list.reduce((a, b) => ((b.quality ?? 0) + (b.flag === 1 ? 5 : 0) > (a.quality ?? 0) + (a.flag === 1 ? 5 : 0) ? b : a), list[0]);
      return `<div class="zcard" data-z="${esc(k)}"><img loading="lazy" src="hub://thumb/${cover.id}" /><div><b>${esc(lib.zoom === "years" ? k : monthLabel(k))}</b><span>${plural(list.length, "photo", "photos", "صورة")}</span></div></div>`;
    }).join("");
    $$(".zcard", grid).forEach((c) => (c.onclick = () => {
      const k = c.dataset.z;
      lib.zoom = lib.zoom === "years" ? "months" : "days";
      drawFilters();
      drawGrid();
      const target = lib.zoom === "months" ? $$(".zcard", grid).find((x) => x.dataset.z.startsWith(k.slice(0, 4))) : $(`.sechead[data-m="${k}"]`, grid);
      target?.scrollIntoView({ block: "start" });
    }));
    if (scrub) scrub.innerHTML = "";
    drawSelbar();
    return;
  }
  const out = [];
  let last = null;
  const sec = lib.zoom === "days" ? dayKey : byTime ? monthKey : null;
  lib.shown.forEach((p, i) => {
    if (sec) {
      const k = sec(p);
      if (k !== last) {
        last = k;
        const label = lib.zoom === "days" && k ? fmtDate(k) : monthLabel(k);
        const ev = lib.zoom === "days" ? [...new Set(lib.shown.filter((x) => dayKey(x) === k).map((x) => x.event_title).filter(Boolean))].slice(0, 3).join(" · ") : "";
        out.push(`<div class="sechead" data-m="${esc(k.slice(0, 7))}"><b>${esc(label)}</b><span>${esc(ev)}</span></div>`);
      }
    }
    out.push(tileHtml(p, i));
  });
  grid.innerHTML = out.join("");
  // Month scrubber down the side.
  if (scrub) {
    const months = [...new Set(lib.shown.map(monthKey))];
    scrub.innerHTML = byTime && months.length > 2 ? months.filter((_, i) => i % Math.ceil(months.length / 24) === 0).map((m) => `<span data-sm="${esc(m)}">${esc(m ? new Date(`${m}-15T12:00:00`).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { month: "short", year: "2-digit" }) : "—")}</span>`).join("") : "";
    $$("[data-sm]", scrub).forEach((s) => (s.onclick = () => $(`.sechead[data-m="${s.dataset.sm}"]`, grid)?.scrollIntoView({ block: "start", behavior: "smooth" })));
  }
  grid.onclick = (e) => {
    const st = e.target.closest("[data-stack]");
    if (st) {
      const top = Number(st.dataset.stack);
      lib.openStacks.has(top) ? lib.openStacks.delete(top) : lib.openStacks.add(top);
      e.stopPropagation();
      return App.views.library.load(true);
    }
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const i = Number(tile.dataset.i);
    const id = lib.shown[i].id;
    if (e.shiftKey && lib.anchor !== null) {
      const [a, b] = [Math.min(lib.anchor, i), Math.max(lib.anchor, i)];
      for (let k = a; k <= b; k++) lib.sel.add(lib.shown[k].id);
    } else if (e.metaKey || e.ctrlKey) {
      lib.sel.has(id) ? lib.sel.delete(id) : lib.sel.add(id);
      lib.anchor = i;
    } else {
      lib.sel.clear();
      lib.sel.add(id);
      lib.anchor = i;
    }
    lib.focus = i;
    refreshSelection();
  };
  grid.ondblclick = (e) => {
    const tile = e.target.closest(".tile");
    if (tile) openViewer(lib.shown.map((p) => p.id), Number(tile.dataset.i), {});
  };
  grid.ondragstart = (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const id = lib.shown[Number(tile.dataset.i)].id;
    if (!lib.sel.has(id)) {
      lib.sel.clear();
      lib.sel.add(id);
    }
    e.dataTransfer.setData("text/hub-photos", JSON.stringify(selectedIds()));
  };
  if (!grid.dataset.ctx) {
    grid.dataset.ctx = "1";
    onContext(grid, ".tile", (tile) => {
      const i = Number(tile.dataset.i);
      const id = lib.shown[i]?.id;
      if (!id) return null;
      if (!lib.sel.has(id)) {
        lib.sel.clear();
        lib.sel.add(id);
        lib.focus = i;
        refreshSelection();
      }
      return photoMenu(selectedIds());
    });
  }
  drawSelbar();
}

function refreshSelection() {
  $$(".tile", $("#grid")).forEach((t) => t.classList.toggle("sel", lib.sel.has(lib.shown[Number(t.dataset.i)]?.id)));
  drawSelbar();
  drawInfo();
}

// The right-click menu on one or more photos.
function photoMenu(ids) {
  const one = ids.length === 1;
  const p = lib.shown.find((x) => x.id === ids[0]) ?? {};
  const mine = (lib.albums?.mine ?? []).filter((a) => !a.rule);
  const finder = S.platform === "win32" ? L("Show in Explorer", "إظهار في المستكشف") : L("Show in Finder", "إظهار في Finder");
  return [
    { label: L("Open", "فتح"), key: "Enter", run: () => openViewer(lib.shown.map((x) => x.id), lib.shown.findIndex((x) => x.id === ids[0]), {}) },
    { label: L("Quick look", "نظرة سريعة"), key: "Space", run: quickLook },
    "-",
    { label: L("Pick", "اختيار"), key: "P", checked: one ? p.flag === 1 : undefined, run: () => act.flag(ids, 1) },
    { label: L("Reject", "رفض"), key: "X", run: () => act.flag(ids, -1) },
    { label: L("Clear pick or reject", "إلغاء الاختيار أو الرفض"), key: "U", run: () => act.flag(ids, 0) },
    { label: L("Rating", "التقييم"), sub: [0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? "★".repeat(n) : L("None", "بدون"), key: String(n), checked: one ? p.rating === n : undefined, run: () => act.rate(ids, n) })) },
    { label: L("Colour label", "لون"), sub: [["red", "6"], ["yellow", "7"], ["green", "8"]].map(([l, k]) => ({ label: labelName(l), key: k, checked: one ? p.label === l : undefined, run: () => act.label(ids, l) })).concat(["-", { label: L("None", "بلا"), key: "9", run: () => act.label(ids, null) }]) },
    "-",
    { label: L("Name who is in it…", "تسمية من فيها…"), key: "T", run: () => act.tag(ids) },
    { label: L("Add to album", "إضافة إلى ألبوم"), sub: [...mine.map((a) => ({ label: a.name, run: async () => { await call("addToAlbum", a.id, ids); toast(L(`Added to ${a.name}`, `أُضيفت إلى ${a.name}`)); } })), ...(mine.length ? ["-"] : []), { label: L("New album…", "ألبوم جديد…"), run: () => albumDialog(ids) }] },
    lib.filter.album?.startsWith("my:") && { label: L("Remove from this album", "إزالة من هذا الألبوم"), run: () => call("removeFromAlbum", Number(lib.filter.album.slice(3)), ids) },
    { label: L("Move to an event…", "نقل إلى فعالية…"), run: () => moveDialog(ids) },
    { label: L("Set the kind of event", "نوع الفعالية"), sub: Object.entries(CATS()).map(([k, [lab]]) => ({ label: lab, run: () => call("setCategory", ids, k) })) },
    "-",
    { label: L("New post with these", "منشور جديد بهذه"), key: "⌘N", run: newPostFromSelection },
    ids.length >= 2 && ids.length <= 4 && { label: L("Compare", "مقارنة"), key: "C", run: () => openCompare(ids) },
    one && p.tagged && { label: L("Set as main photo for…", "تعيين كصورة رئيسية لـ…"), run: () => setMainFrom(ids[0]) },
    "-",
    { label: L("Open in editing app", "فتح في تطبيق التعديل"), run: () => call("openEditor", ids) },
    { label: finder, run: () => call("revealMany", ids) },
    one && { label: L("Copy", "نسخ"), key: "⌘C", run: () => call("copyPhoto", ids[0]).then(() => toast(L("Copied", "تم النسخ"))) },
    S.platform === "darwin" && S.finderTags && { label: L("Green Finder tag", "وسم Finder أخضر"), run: () => call("tagPicksInFinder", ids, true) },
    "-",
    lib.filter.album === "hidden" ? { label: L("Show again", "إظهار مجددًا"), key: "H", run: () => act.hide(ids, false) } : { label: L("Hide", "إخفاء"), key: "H", run: () => act.hide(ids, true) },
    { label: L("Move to Bin…", "نقل إلى السلة…"), key: "⌘⌫", run: () => act.bin(ids) },
  ];
}

async function setMainFrom(photoId) {
  const info = await call("photoInfo", photoId);
  const people = info?.people ?? [];
  if (!people.length) return;
  const set = async (s) => {
    const face = await call("faceOf", photoId, s.id);
    if (!face) return toast(L("No face box for them in this photo.", "لا يوجد إطار وجه لهم في هذه الصورة."));
    await call("setMainFace", s.id, face);
    toast(L(`Main photo set for ${name(s)}`, `تم تعيين الصورة الرئيسية لـ ${name(s)}`));
  };
  if (people.length === 1) return set(people[0]);
  menu(people.map((s) => ({ label: name(s), run: () => set(s) })));
}

function drawSelbar() {
  const bar = $("#selbar");
  if (!bar) return;
  const ids = selectedIds();
  if (!ids.length) return bar.replaceChildren();
  bar.innerHTML = `<div class="selbar"><b style="padding: 0 6px">${plural(ids.length, "selected", "selected", "محددة")}</b>
    <button class="btn small" data-a="pick" title="P">${icon("flag", 14)} ${L("Pick", "اختيار")}</button>
    <button class="btn small" data-a="reject" title="X">${icon("x", 14)}</button>
    <button class="btn small" data-a="rate" title="1-5">${icon("star", 14)}</button>
    <button class="btn small" data-a="tag" title="T">${icon("user-plus", 14)} ${L("Name", "تسمية")}</button>
    <button class="btn small" data-a="move">${icon("folder-input", 14)} ${L("Move", "نقل")}</button>
    ${ids.length >= 2 && ids.length <= 4 ? `<button class="btn small" data-a="compare" title="C">${icon("columns-2", 14)} ${L("Compare", "مقارنة")}</button>` : ""}
    <button class="btn small" data-a="more">${icon("ellipsis", 14)}</button>
    <button class="btn small primary" data-a="post">${icon("square-pen", 14)} ${L("New post", "منشور جديد")}</button></div>`;
  $$("[data-a]", bar).forEach((b) => {
    b.onclick = (e) => {
      const a = b.dataset.a;
      if (a === "pick") act.flag(ids, 1);
      if (a === "reject") act.flag(ids, -1);
      if (a === "rate") menu([0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? "★".repeat(n) : L("None", "بدون"), key: String(n), run: () => act.rate(ids, n) })));
      if (a === "tag") act.tag(ids);
      if (a === "move") moveDialog(ids);
      if (a === "compare") openCompare(ids);
      if (a === "post") newPostFromSelection();
      if (a === "more") menu(photoMenu(ids));
      e.stopPropagation();
    };
  });
}

// ---------- Info panel ----------
async function drawInfo() {
  const box = $("#info");
  if (!box || !lib.info) return;
  const ids = selectedIds();
  if (ids.length !== 1) {
    const list = lib.shown.filter((p) => !ids.length || lib.sel.has(p.id));
    box.innerHTML = `<h2>${ids.length ? plural(ids.length, "photo selected", "photos selected", "صورة محددة") : plural(list.length, "photo", "photos", "صورة")}</h2>
      <dl><dt>${L("Picks", "المختارة")}</dt><dd>${num(list.filter((p) => p.flag === 1).length)}</dd><dt>${L("Used in posts", "في منشورات")}</dt><dd>${num(list.filter((p) => p.posts).length)}</dd>
      <dt>${L("Faces named", "وجوه مسماة")}</dt><dd>${num(list.reduce((s, p) => s + p.tagged, 0))}</dd><dt>${L("Faces to name", "وجوه بلا أسماء")}</dt><dd>${num(list.reduce((s, p) => s + p.unnamed, 0))}</dd>
      <dt>${L("Originals missing", "أصول مفقودة")}</dt><dd>${num(list.filter((p) => p.offline).length)}</dd></dl><div id="ip-who"></div>`;
    if (lib.filter.event && list.length) {
      const who = await call("whoWasThere", list.map((p) => p.id).slice(0, 4000));
      const el = $("#ip-who", box);
      if (el && who?.length)
        el.innerHTML = `<div class="col gap4"><b>${L("Who was there", "من حضر")}</b><span class="muted tiny">${L("Teachers, staff, parents and visitors named in these photos", "المعلمون والموظفون وأولياء الأمور والزوار المسمَّون في هذه الصور")}</span>${who
          .map((s) => `<div class="row nowrap small">${avatar(s)}<span class="grow">${esc(name(s))}<div class="muted tiny">${esc(KINDS()[s.kind] ?? "")}${s.of.length ? ` · ${L("parent of", "ولي أمر")} ${esc(s.of.map((o) => [name(o), o.class_name].filter(Boolean).join(" ")).join(", "))}` : ""}</div></span><span class="tag">${num(s.n)}</span></div>`)
          .join("")}</div>`;
    }
    return;
  }
  const p = await call("photoInfo", ids[0]);
  if (!p || selectedIds()[0] !== ids[0]) return;
  const row = (k, v) => (v || v === 0 ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : "");
  box.innerHTML = `<img class="big" src="hub://thumb/${p.id}" />
    <div><b class="ltr">${esc(p.name)}</b>${p.there ? "" : `<div class="note warn" style="margin-top:6px">${icon("image-off", 13)} ${p.archived ? L("On the archive drive, which isn't connected.", "على قرص الأرشيف غير الموصول.") : L("Original missing. Posts already sent keep their web copy; new posts can't use it.", "الأصل مفقود. المنشورات المرسلة تحتفظ بنسختها، ولا يمكن استخدامها في منشورات جديدة.")}<br><button class="link" id="ip-find">${L("Find missing photos…", "البحث عن الصور المفقودة…")}</button></div>`}</div>
    <dl>
      ${row(L("Event", "الفعالية"), esc(p.event_title ? eventName(p.event_title, p.event_date) : L("None", "بلا")))}
      ${row(L("Taken", "التُقطت"), p.taken_at ? `${esc(fmtDate(p.taken_at))} <span class="muted">${esc(new Date(p.taken_at).toLocaleTimeString(S.language === "en" ? "en-GB" : "ar-EG", { hour: "2-digit", minute: "2-digit" }))}</span>` : "")}
      ${row(L("Class", "الفصل"), esc(p.class_name ?? ""))}
      ${row(L("Kind", "النوع"), p.category ? esc(CATS()[p.category]?.[0] ?? p.category) : "")}
      ${row(L("Camera", "الكاميرا"), esc(p.camera ?? ""))}
      ${row(L("Taken by", "التقطها"), esc(p.photographer ?? p.import?.photographer ?? ""))}
      ${row(L("Imported by", "استوردها"), p.import ? `${esc(p.import.who ?? "")} <span class="muted">${esc(fmtDate(new Date(p.import.at).toISOString()))}</span>` : "")}
      ${row(L("Size", "الحجم"), `<span class="ltr">${p.width ?? "?"}×${p.height ?? "?"} · ${fmtBytes(p.size)}</span>`)}
      ${row(L("Quality", "الجودة"), p.quality ? `${p.quality}/10` : "")}
      ${row(L("Problems", "مشكلات"), p.problems ? esc(p.problems.split(",").map((x) => PROBLEMS()[x] ?? x).join(", ")) : "")}
      ${row(L("Used in posts", "في منشورات"), num(p.posts ?? 0))}
      ${row(L("On the website", "على الموقع"), p.remote_id ? L("Yes", "نعم") : L("No", "لا"))}
      ${row(L("Albums", "الألبومات"), p.albums.map((a) => esc(a.name)).join(", "))}
    </dl>
    <div class="col gap4"><b>${L("People", "الأشخاص")}</b>${p.people.length ? p.people.map((s) => `<div class="row nowrap small">${avatar(s)}<span class="grow">${esc(name(s))}<div class="muted tiny">${esc([KINDS()[s.kind] ?? "", s.class_name].filter(Boolean).join(" · "))}</div></span>${s.auto ? `<span class="tag">${L("auto", "تلقائي")}</span>` : ""}</div>`).join("") : `<span class="muted small">${L("Nobody named yet", "لم يُسمَّ أحد بعد")}</span>`}</div>`;
  $("#ip-find", box)?.addEventListener("click", findMissing);
}

async function findMissing() {
  const r = await call("findMissing");
  if (r) toast(L(`Found ${r.found} of the missing photos`, `عُثر على ${num(r.found)} من الصور المفقودة`));
}

// ---------- Quick look (space bar) ----------
function quickLook() {
  const show = () => {
    const p = lib.shown[lib.focus];
    if (!p) return closeOverlay();
    $("#overlay").innerHTML = `<div class="quicklook"><img src="hub://preview/${p.id}" onerror="this.src='hub://thumb/${p.id}'" /><div class="cap">${esc(p.name)} · ${esc(p.event_title ?? "")} · ${num(lib.focus + 1)}/${num(lib.shown.length)}</div></div>`;
    $(".quicklook").onclick = closeOverlay;
  };
  show();
  App.overlayKeys = (e) => {
    const k = e.key.toLowerCase();
    if (k === " " || k === "escape") return e.preventDefault(), closeOverlay();
    if (k === "arrowright" || k === "arrowleft") {
      const rtl = document.documentElement.dir === "rtl";
      lib.focus = Math.max(0, Math.min(lib.shown.length - 1, lib.focus + ((k === "arrowright") !== rtl ? 1 : -1)));
      lib.sel = new Set([lib.shown[lib.focus].id]);
      refreshSelection();
      return show();
    }
    if (k === "enter") {
      closeOverlay();
      return openViewer(lib.shown.map((p) => p.id), lib.focus, {});
    }
    if (k === "p" || k === "x") act.flag([lib.shown[lib.focus].id], k === "p" ? 1 : -1);
  };
}

// ---------- Actions ----------
const act = {
  async flag(ids, n) {
    await call("flag", ids, n);
    for (const p of lib.list) if (ids.includes(p.id)) p.flag = n;
    drawGrid();
    if (n === 1 && S.sendMode === "picked" && S.signedIn) toast(L("Picked. Web copies are being sent for posts.", "تم الاختيار. تُرسل نسخ ويب للمنشورات."));
    if (S.finderTags && S.platform === "darwin") call("tagPicksInFinder", ids, n === 1);
  },
  async rate(ids, n) {
    await call("rate", ids, n);
    for (const p of lib.list) if (ids.includes(p.id)) p.rating = n;
    drawGrid();
  },
  async label(ids, l) {
    await call("label", ids, l);
    for (const p of lib.list) if (ids.includes(p.id)) p.label = l;
    drawGrid();
  },
  async hide(ids, on) {
    await call("setHidden", ids, on);
    toast(on ? L(`${ids.length} hidden. They're in the Hidden album.`, `أُخفيت ${num(ids.length)}. موجودة في ألبوم المخفية.`) : L("Shown again", "ظهرت مجددًا"), { undo: true });
  },
  tag(ids) {
    const ev = lib.list.find((p) => p.id === ids[0]);
    pickStudent(L(`Who is in ${ids.length > 1 ? `these ${ids.length} photos` : "this photo"}?`, ids.length > 1 ? `من في هذه الصور (${num(ids.length)})؟` : "من في هذه الصورة؟"), async (s) => {
      await call("tagPhotos", ids, s.id);
      toast(L(`Named ${name(s)}`, `تمت تسمية ${name(s)}`), { undo: true });
    }, { className: lib.filter.className || ev?.class_name });
  },
  async bin(ids) {
    const m = modal(`<h2>${L(`Move ${ids.length} photos to the Bin?`, `نقل ${num(ids.length)} صورة إلى السلة؟`)}</h2>
      <p class="muted">${L("They stay in the Bin for 30 days and can be put back (Clean up → Bin). Web copies are removed, except photos already in a post.", "تبقى في السلة 30 يومًا ويمكن استعادتها (التنظيف ← السلة). تُحذف نسخ الويب، إلا الصور الموجودة في منشور.")}</p>
      <div class="row"><span class="grow"></span><button class="btn" id="no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="yes">${L("Move to Bin", "نقل إلى السلة")}</button></div>`);
    $("#no", m).onclick = closeOverlay;
    $("#yes", m).onclick = async () => {
      closeOverlay();
      const n = await call("bin", ids);
      toast(L(`${n} photos moved to the Bin`, `نُقلت ${num(n)} صورة إلى السلة`), { undo: true });
    };
  },
};

// The date most of these photos were taken on (their own date, never today).
function photosDate(ids) {
  const days = new Map();
  for (const p of lib.list.filter((x) => ids.includes(x.id))) {
    const d = (p.taken_at ?? p.event_date ?? "").slice(0, 10);
    if (d) days.set(d, (days.get(d) ?? 0) + 1);
  }
  return [...days].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().toISOString().slice(0, 10);
}

function moveDialog(ids) {
  const events = (lib.tree?.rows ?? []).filter((r) => r.event_key);
  const own = photosDate(ids);
  const first = lib.list.find((p) => p.id === ids[0]);
  const m = modal(`<h2>${L(`Move ${ids.length} photos`, `نقل ${num(ids.length)} صورة`)}</h2>
    <label class="field">${L("To an event", "إلى فعالية")}<select id="mv-ev"><option value="">${L("A new event…", "فعالية جديدة…")}</option>${events.map((e, i) => `<option value="${i}" ${first?.event_key === e.event_key ? "" : ""}>${esc(eventLabel(e))}</option>`).join("")}</select></label>
    <div class="grid2" id="mv-new"><label class="field">${L("Event name", "اسم الفعالية")}<input id="mv-title" /></label><label class="field">${L("Date", "التاريخ")}<input type="date" id="mv-date" value="${own}" /></label></div>
    <label class="field">${L("Class folder (optional)", "مجلد الفصل (اختياري)")}<input id="mv-class" list="mv-classes" /><datalist id="mv-classes">${[...new Set(lib.classes.map((c) => c.class_name))].map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
    <div class="note" id="mv-where"></div>
    <p class="muted small">${L("The files move on the disk. Names, faces, picks and ratings stay with them.", "تنتقل الملفات على القرص. تبقى معها الأسماء والوجوه والاختيارات والتقييمات.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="mv-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="mv-yes">${L("Move", "نقل")}</button></div>`);
  // "" is "A new event…": Number("") is 0, which would pick the first event.
  const pickEv = () => { const v = $("#mv-ev", m).value; return v === "" ? null : events[Number(v)]; };
  const where = async () => {
    const ev = pickEv();
    const date = ev ? ev.event_date || own : $("#mv-date", m).value || own;
    const title = ev ? ev.event_title : $("#mv-title", m).value.trim() || L("New event", "فعالية جديدة");
    const place = await quiet("placeFor", date);
    const cls = $("#mv-class", m).value.trim();
    $("#mv-where", m).innerHTML = `${icon("folder", 13)} ${L("They will go to", "ستنتقل إلى")} <b class="ltr">${esc([place?.year, place?.term, `${date} ${title}`, cls].filter(Boolean).join(" / "))}</b>`;
  };
  $("#mv-ev", m).onchange = (e) => {
    $("#mv-new", m).classList.toggle("hide", !!e.target.value);
    where();
  };
  ["#mv-title", "#mv-date", "#mv-class"].forEach((s) => $(s, m).addEventListener("input", where));
  where();
  $("#mv-no", m).onclick = closeOverlay;
  $("#mv-yes", m).onclick = async () => {
    const ev = pickEv();
    const title = ev ? ev.event_title : $("#mv-title", m).value.trim();
    const date = ev ? ev.event_date || own : $("#mv-date", m).value || own;
    if (!title || title.length < 2) return $("#mv-title", m).focus();
    closeOverlay();
    await call("moveTo", ids, { title, date, className: $("#mv-class", m).value.trim() || null });
    toast(L(`Moved to ${title}`, `نُقلت إلى ${title}`), { undo: true });
  };
}

function renameEvent(key = lib.filter.event) {
  const ev = lib.tree?.rows.find((r) => r.event_key === key);
  if (!ev) return;
  const m = modal(`<h2>${L("Rename event", "إعادة تسمية الفعالية")}</h2>
    <div class="grid2"><label class="field">${L("Name", "الاسم")}<input id="rn-title" value="${esc(ev.event_title)}" /></label><label class="field">${L("Date", "التاريخ")}<input type="date" id="rn-date" value="${esc(ev.event_date ?? "")}" /></label></div>
    <p class="muted small">${L("The folder on the disk is renamed too. Nothing is lost.", "يُعاد تسمية المجلد على القرص أيضًا. لا يضيع شيء.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="rn-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="rn-yes">${L("Rename", "إعادة تسمية")}</button></div>`);
  $("#rn-no", m).onclick = closeOverlay;
  $("#rn-yes", m).onclick = async () => {
    const title = $("#rn-title", m).value.trim();
    const date = $("#rn-date", m).value;
    if (title.length < 2 || !date) return;
    closeOverlay();
    await call("renameEvent", ev.event_key, title, date);
    lib.filter = { album: "all" };
    toast(L("Event renamed", "تمت إعادة التسمية"));
  };
}

// "Best photos": the app's own picks, checked on this computer (sharpness,
// light, smiles, the main subject, one per burst, many different students).
function bestPicker() {
  if (!lib.shown.length) return;
  const m = modal(`<h2>${icon("sparkles", 18)} ${L("Best photos", "أفضل الصور")}</h2>
    <p class="muted">${L("Picks the sharpest, best-lit shots with good smiles and a clear main subject, one from each burst, with as many different students as possible. Nothing is sent anywhere.", "يختار أوضح اللقطات وأفضلها إضاءة مع ابتسامات جميلة وموضوع واضح، لقطة من كل مجموعة متتابعة، وبأكبر عدد من الطلاب المختلفين. لا يُرسل شيء لأي مكان.")}</p>
    <label class="field">${L("How many", "العدد")}<select id="bp-n">${[4, 6, 8, 10, 15, 20].map((n) => `<option ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="row"><span class="grow"></span><button class="btn" id="bp-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="bp-yes">${L("Choose", "اختيار")}</button></div>`);
  $("#bp-no", m).onclick = closeOverlay;
  $("#bp-yes", m).onclick = async () => {
    const n = Number($("#bp-n", m).value);
    closeOverlay();
    const ids = await call("best", lib.list.map((p) => p.id), n);
    lib.sel = new Set(ids);
    refreshSelection();
    toast(L(`Selected the best ${ids.length}. Press P to pick them, or New post.`, `حُدد أفضل ${num(ids.length)}. اضغط P لاختيارها، أو منشور جديد.`), { ms: 7000 });
  };
}

// Making a post never blocks the app: a small card shows progress with
// Cancel, and the post opens when it is ready.
async function newPostFromSelection(idsIn) {
  const ids = idsIn ?? selectedIds();
  if (!ids.length) return toast(L("Select photos first, then press New post.", "حدد الصور أولًا، ثم اضغط منشور جديد."));
  if (!S.signedIn) return toast(L(ERRORS["not-signed-in"][0], ERRORS["not-signed-in"][1]));
  const missing = lib.list.filter((p) => ids.includes(p.id) && p.offline && !p.remote_id);
  const usable = ids.filter((id) => !missing.some((p) => p.id === id));
  if (missing.length) toast(L(`${missing.length} photos have no original on this computer and were left out. Use “Find missing photos” to reconnect them.`, `${num(missing.length)} صورة بلا أصل على هذا الجهاز واستُبعدت. استخدم «البحث عن الصور المفقودة» لإعادة ربطها.`), { ms: 8000 });
  if (!usable.length) return;
  postProgress.start(usable.length);
  try {
    const id = await call("newPost", usable);
    postProgress.done();
    if (id) toastAction(L("The post is ready", "المنشور جاهز"), L("Open", "فتح"), () => go("posts", { post: id }), 9000);
  } catch {
    postProgress.done();
  }
}
const postProgress = {
  start(n) {
    $("#postprog")?.remove();
    const el = h(`<div id="postprog" class="progcard"><div class="row nowrap">${icon("square-pen", 15)}<b class="grow">${L("Making the post…", "جارٍ إنشاء المنشور…")}</b><button class="btn small ghost" id="pp-x">${L("Cancel", "إلغاء")}</button></div><span class="small muted" id="pp-msg">${L(`Sending web copies of ${n} photos first, even while sending is paused.`, `تُرسل نسخ ويب من ${num(n)} صورة أولًا، حتى مع إيقاف الإرسال.`)}</span><div class="bar"><i id="np-bar" style="width: 4%"></i></div></div>`);
    document.body.append(el);
    $("#pp-x", el).onclick = () => {
      call("cancelPost");
      el.remove();
    };
  },
  done() {
    $("#postprog")?.remove();
  },
};
window.hub.onState((s) => {
  const m = /^sending:(\d+)\/(\d+)/.exec(s.message || "");
  if (m && $("#np-bar")) $("#np-bar").style.width = `${Math.max(5, (m[1] / m[2]) * 100)}%`;
});

// ---------- Albums ----------
function drawAlbumCards() {
  const grid = $("#grid");
  if (!grid) return;
  const a = lib.albums ?? {};
  const card = (id, cover, title, n, ic) => `<div class="zcard" data-al="${esc(id)}">${cover ? `<img loading="lazy" src="hub://thumb/${cover}" />` : `<div class="zph">${icon(ic, 30)}</div>`}<div><b>${esc(title)}</b><span>${plural(n, "photo", "photos", "صورة")}</span></div></div>`;
  const sec = (title, cards) => (cards.length ? `<div class="sechead"><b>${esc(title)}</b></div>${cards.join("")}` : "");
  grid.classList.remove("cols");
  grid.innerHTML =
    sec(L("My albums", "ألبوماتي"), (a.mine ?? []).map((x) => card(`my:${x.id}`, x.cover, x.name, x.n, "book-marked"))) +
    sec(L("Kinds of event", "أنواع الفعاليات"), (a.cats ?? []).map((c) => card(c.id, c.cover, CATS()[c.key]?.[0] ?? c.key, c.n, CATS()[c.key]?.[1] ?? "tag"))) +
    sec(L("Occasions", "المناسبات"), (a.occ ?? []).map((o) => card(o.id, null, OCC()[o.key] ?? o.key, o.n, "calendar-days"))) +
    sec(L("Yearbooks", "الكتب السنوية"), (a.grades ?? []).map((g) => card(g.id, null, `${g.grade} · ${g.year}`, g.n, "book-open"))) || emptyState("book-marked", L("No albums yet", "لا توجد ألبومات بعد"), L("Select photos and choose “Add to album”, or make a smart album that fills itself.", "حدد صورًا واختر «إضافة إلى ألبوم»، أو أنشئ ألبومًا ذكيًا يمتلئ تلقائيًا."));
  grid.classList.add("cards");
  $$("[data-al]", grid).forEach((c) => (c.onclick = () => {
    grid.classList.remove("cards");
    lib.filter = { album: c.dataset.al };
    drawTree();
    drawFilters();
    App.views.library.load();
  }));
  if ($("#scrub")) $("#scrub").innerHTML = "";
}

// Add photos to an album, make a new one, or build a smart album from rules.
function albumDialog(ids = [], edit = null) {
  const mine = (lib.albums?.mine ?? []).filter((a) => !a.rule);
  const classes = [...new Set((lib.classes ?? []).map((c) => c.class_name).filter(Boolean))];
  const r = edit?.rule ? JSON.parse(edit.rule) : {};
  const sel = (id, opts, v) => `<select id="${id}"><option value="">—</option>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(v ?? "") === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const m = modal(`<h2>${icon("book-marked", 18)} ${edit ? esc(edit.name) : ids.length ? L(`Add ${ids.length} photos to an album`, `إضافة ${num(ids.length)} صورة إلى ألبوم`) : L("New album", "ألبوم جديد")}</h2>
    ${ids.length && mine.length ? `<div class="col gap4">${mine.map((a) => `<button class="btn" data-add="${a.id}" style="justify-content: space-between"><span>${esc(a.name)}</span><span class="muted small">${num(a.n)}</span></button>`).join("")}</div><div class="muted small">${L("or a new one:", "أو ألبوم جديد:")}</div>` : ""}
    <label class="field">${L("Name", "الاسم")}<input id="al-name" value="${esc(edit?.name ?? "")}" placeholder="${L("e.g. Best of Term 1", "مثال: أفضل صور الفصل الأول")}" /></label>
    <label class="check">${sw('id="al-share"', !!edit?.shared)} ${L("Share with the team (they see it on the website)", "مشاركة مع الفريق (يرونه على الموقع)")}</label>
    ${ids.length ? "" : `<label class="check">${sw('id="al-smart"', !!edit?.rule)} ${L("Smart album: fills itself by rules", "ألبوم ذكي: يمتلئ تلقائيًا حسب قواعد")}</label>
    <div class="grid2 ${edit?.rule ? "" : "hide"}" id="al-rules">
      <label class="field">${L("At least", "على الأقل")}${sel("r-rating", [1, 2, 3, 4, 5].map((n) => [n, "★".repeat(n)]), r.minRating)}</label>
      <label class="field">${L("Class", "الفصل")}${sel("r-class", classes.map((c) => [c, c]), r.className)}</label>
      <label class="field">${L("Event name has", "اسم الفعالية يحتوي")}<input id="r-event" value="${esc(r.event ?? "")}" /></label>
      <label class="field">${L("Kind of event", "نوع الفعالية")}${sel("r-cat", Object.entries(CATS()).map(([k, [l]]) => [k, l]), r.category)}</label>
      <label class="field">${L("People", "الأشخاص")}${sel("r-people", [["none", L("No people", "بلا أشخاص")], ["some", L("1 to 4 people", "1 إلى 4 أشخاص")], ["group", L("Groups (5+)", "مجموعات (5+)")]], r.people)}</label>
      <label class="field">${L("With", "مع")}${sel("r-kind", Object.entries(KINDS()).map(([k, l]) => [k, l]), r.kind)}</label>
      <label class="field">${L("Colour", "اللون")}${sel("r-label", [["red", labelName("red")], ["yellow", labelName("yellow")], ["green", labelName("green")]], r.label)}</label>
      <label class="field">${L("Taken by", "التقطها")}${sel("r-who", (lib.albums?.photographers ?? []).map((p) => [p.photographer, p.photographer]), r.photographer)}</label>
      <label class="field">${L("From", "من")}<input type="date" id="r-from" value="${esc(r.from ?? "")}" /></label>
      <label class="field">${L("To", "إلى")}<input type="date" id="r-to" value="${esc(r.to ?? "")}" /></label>
      <label class="field">${L("In posts", "في المنشورات")}${sel("r-posted", [["no", L("Not posted yet", "لم تُنشر بعد")], ["yes", L("Already posted", "نُشرت")]], r.posted === undefined ? "" : r.posted ? "yes" : "no")}</label>
      <label class="check">${sw('id="r-picked"', !!r.picked)} ${L("Picks only", "المختارة فقط")}</label>
    </div><div class="small muted" id="al-count"></div>`}
    <div class="row"><span class="grow"></span><button class="btn" id="al-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="al-yes">${edit ? L("Save", "حفظ") : L("Create", "إنشاء")}</button></div>`);
  $("#al-no", m).onclick = closeOverlay;
  const rule = () => {
    if (!$("#al-smart", m)?.checked) return null;
    const v = (id) => $(id, m).value || undefined;
    return {
      minRating: Number(v("#r-rating")) || undefined, className: v("#r-class"), event: $("#r-event", m).value.trim() || undefined, category: v("#r-cat"), people: v("#r-people"),
      kind: v("#r-kind"), label: v("#r-label"), photographer: v("#r-who"), from: v("#r-from"), to: v("#r-to"), picked: $("#r-picked", m).checked || undefined,
      posted: v("#r-posted") ? v("#r-posted") === "yes" : undefined,
    };
  };
  // Live count while the rules change.
  const count = async () => {
    const rl = rule();
    if (!rl || !$("#al-count", m)) return;
    const n = await quiet("countRule", rl);
    $("#al-count", m).textContent = n === null ? "" : L(`${num(n)} photos match now`, `${num(n)} صورة مطابقة الآن`);
  };
  $("#al-smart", m)?.addEventListener("change", (e) => { $("#al-rules", m).classList.toggle("hide", !e.target.checked); count(); });
  $$("#al-rules select, #al-rules input", m).forEach((el) => el.addEventListener("change", count));
  count();
  $$("[data-add]", m).forEach((b) => (b.onclick = async () => {
    await call("addToAlbum", Number(b.dataset.add), ids);
    closeOverlay();
    toast(L(`Added ${ids.length} photos`, `أُضيفت ${num(ids.length)} صورة`));
  }));
  $("#al-yes", m).onclick = async () => {
    const nm = $("#al-name", m).value.trim();
    if (!nm) return $("#al-name", m).focus();
    const share = $("#al-share", m).checked;
    let id = edit?.id;
    if (edit) await call("updateAlbum", edit.id, nm, rule());
    else id = await call("newAlbum", nm, rule(), ids);
    if (share !== !!edit?.shared) await call("setAlbumShared", id, share);
    closeOverlay();
    lib.filter = { album: `my:${id}` };
    App.views.library.loadTree();
    App.views.library.load();
  };
}

function albumMenu(id) {
  const a = (lib.albums?.mine ?? []).find((x) => x.id === id);
  if (!a) return [];
  return [
    { label: L("Open", "فتح"), run: () => { lib.filter = { album: `my:${id}` }; drawTree(); App.views.library.load(); } },
    { label: a.rule ? L("Edit rules and name…", "تعديل القواعد والاسم…") : L("Rename…", "إعادة تسمية…"), run: () => albumDialog([], a) },
    { label: L("Shared with the team", "مشارك مع الفريق"), checked: !!a.shared, run: () => call("setAlbumShared", id, !a.shared).then(() => App.views.library.loadTree()) },
    { label: L("Make posts from this album…", "إنشاء منشورات من هذا الألبوم…"), run: () => typeof makePostsFrom === "function" && makePostsFrom({ album: `my:${id}` }, a.name) },
    "-",
    { label: L("Delete album (photos stay)", "حذف الألبوم (تبقى الصور)"), run: async () => { await call("deleteAlbum", id); lib.filter = { album: "all" }; App.views.library.loadTree(); App.views.library.load(); } },
  ];
}

// Photos of two (or more) people together.
function togetherPicker() {
  const picked = [];
  const next = () =>
    pickStudent(picked.length ? L(`And who else, with ${picked.map(name).join(", ")}?`, `ومن أيضًا مع ${picked.map(name).join("، ")}؟`) : L("Photos of who together?", "صور من معًا؟"), (s) => {
      picked.push(s);
      if (picked.length < 2) return setTimeout(next, 50);
      lib.filter = { together: picked.map((x) => x.id) };
      drawTree();
      drawFilters();
      App.views.library.load();
    });
  next();
}

// Photos with no event: suggest the event they probably belong to.
async function strayBanner() {
  const grid = $("#grid");
  if (!grid || !lib.list.length) return;
  const sug = await quiet("suggestEvents", lib.list.map((p) => p.id));
  if (!sug?.length || lib.filter.album !== "noevent") return;
  const byEvent = new Map();
  for (const s of sug) byEvent.set(s.event_key, [...(byEvent.get(s.event_key) ?? []), s]);
  const el = h(`<div class="note" style="grid-column: 1 / -1; margin: 0 8px 8px">${icon("lightbulb", 14)} ${L(`${sug.length} of these photos were taken on the same day as an event:`, `${num(sug.length)} من هذه الصور التُقطت في يوم فعالية:`)}
    <div class="col gap4" style="margin-top: 6px">${[...byEvent].slice(0, 6).map(([, list]) => `<div class="row small"><b class="grow">${esc(eventName(list[0].title, list[0].date))}</b><span>${plural(list.length, "photo", "photos", "صورة")}</span></div>`).join("")}</div>
    <div class="row" style="margin-top: 8px"><button class="btn small primary" id="sg-all">${L("Move them to those events", "انقلها إلى تلك الفعاليات")}</button><button class="btn small" id="sg-sel">${L("Select them", "حددها")}</button></div></div>`);
  grid.prepend(el);
  $("#sg-all", el).onclick = async () => {
    const n = await call("applySuggestedEvents", sug.map((s) => ({ id: s.id, title: s.title, date: s.date })));
    toast(L(`${n} photos moved. ⌘Z undoes it.`, `نُقلت ${num(n)} صورة. ⌘Z للتراجع.`), { undo: true });
  };
  $("#sg-sel", el).onclick = () => {
    lib.sel = new Set(sug.map((s) => s.id));
    refreshSelection();
  };
}
