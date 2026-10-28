// Library: Year → Term → Event → Class on the left, photos on the right.
const lib = { filter: {}, list: [], sel: new Set(), anchor: null, focus: 0, tile: 170, tree: null, classes: [] };

const ALBUMS = () => [
  { id: "all", sec: "smart", icon: "▦", label: L("All photos", "كل الصور") },
  { id: "week", sec: "smart", icon: "◷", label: L("Added this week", "أضيفت هذا الأسبوع") },
  { id: "picks", sec: "smart", icon: "✓", label: L("Picks", "المختارة") },
  { id: "five", sec: "smart", icon: "★", label: L("5 stars", "5 نجوم") },
  { id: "lastyear", sec: "smart", icon: "↺", label: L("This day in past years", "هذا اليوم في سنوات سابقة") },
  { id: "nofaces", sec: "smart", icon: "◌", label: L("No people", "بلا أشخاص") },
  { id: "raw", sec: "smart", icon: "◈", label: L("RAW", "RAW") },
  { id: "sent", sec: "smart", icon: "☁", label: L("On the website", "على الموقع") },
  { id: "ready", sec: "work", icon: "✎", label: L("Ready to post", "جاهزة للنشر") },
  { id: "tocull", sec: "work", icon: "▶", label: L("To cull", "للفرز") },
  { id: "untagged", sec: "work", icon: "☺", label: L("Faces to name", "وجوه بلا أسماء") },
  { id: "fix", sec: "work", icon: "◐", label: L("Needs fixing", "تحتاج إصلاحًا") },
  { id: "nopost", sec: "work", icon: "⛔", label: L("Can't appear in posts", "لا يظهرون في المنشورات") },
  { id: "noevent", sec: "work", icon: "?", label: L("Needs sorting", "تحتاج ترتيبًا") },
  { id: "notsent", sec: "work", icon: "⇡", label: L("Picks not on the website", "مختارة لم تُرسل للموقع") },
  { id: "rejected", sec: "work", icon: "✕", label: L("Rejected", "المرفوضة") },
];
const ALBUM_SECS = () => ({ smart: L("Smart albums", "ألبومات ذكية"), work: L("To do", "مهام"), mine: L("My albums", "ألبوماتي") });
const collapsed = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem("hub.collapsed") || "[]"));
  } catch {
    return new Set();
  }
})();
function toggleSec(id) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  try {
    localStorage.setItem("hub.collapsed", JSON.stringify([...collapsed]));
  } catch {}
  drawTree();
}
// "20 Oct 2020 · Sports Day" instead of folder names.
const eventLabel = (ev) => (ev.event_date ? `${new Date(`${ev.event_date}T12:00:00`).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { day: "numeric", month: "short" })} · ${ev.event_title}` : ev.event_title);

App.views.library = {
  render(main, params) {
    if (params.event !== undefined || params.album || params.student || params.className || params.year) {
      lib.filter = { event: params.event, album: params.album, student: params.student, className: params.className, year: params.year, term: params.term };
    }
    if (!lib.filter.event && !lib.filter.album && !lib.filter.year && !lib.filter.student && !lib.filter.className) lib.filter.album = "all";
    main.innerHTML = topbar(`<span id="libtitle"></span>`, `<span id="libsub"></span>`,
      `<button class="btn" id="best">✦ ${L("Best photos", "أفضل الصور")}</button><button class="btn" id="cull">▶ ${L("Cull", "فرز")}</button><button class="btn primary" id="imp">⤓ ${L("Import", "استيراد")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree" id="tree"></nav><div class="gridwrap" style="position: relative">
        <div class="filters" id="filters"></div><div class="photos" id="grid"></div><div id="selbar"></div></div></div></div>`;
    $("#imp", main).onclick = () => go("import", lib.filter.event ? { event: lib.filter.event } : {});
    $("#cull", main).onclick = () => lib.list.length && openViewer(lib.list.map((p) => p.id), Math.max(0, lib.list.findIndex((p) => lib.sel.has(p.id))), { cull: true });
    $("#best", main).onclick = () => bestPicker();
    this.loadTree();
    this.drawFilters();
    this.load();
  },
  onState(changed) {
    const sending = /^sending:(\d+)\/(\d+)/.exec(S.message || "");
    if (sending && $("#np-bar")) $("#np-bar").style.width = `${Math.max(5, (sending[1] / sending[2]) * 100)}%`;
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
      lib.list.forEach((p) => lib.sel.add(p.id));
      drawGrid();
    }
    if (c === "post") newPostFromSelection();
  },
  onKey(e) {
    const ids = selectedIds();
    const k = e.key.toLowerCase();
    if (e.metaKey && k === "a") {
      e.preventDefault();
      lib.list.forEach((p) => lib.sel.add(p.id));
      return drawGrid();
    }
    if (k === "escape") {
      lib.sel.clear();
      return drawGrid();
    }
    if (["arrowright", "arrowleft", "arrowdown", "arrowup"].includes(k)) {
      e.preventDefault();
      const cols = Math.max(1, Math.floor(($("#grid").clientWidth - 32) / (lib.tile + 8)));
      const rtl = document.documentElement.dir === "rtl";
      const step = { arrowright: rtl ? -1 : 1, arrowleft: rtl ? 1 : -1, arrowdown: cols, arrowup: -cols }[k];
      lib.focus = Math.min(lib.list.length - 1, Math.max(0, lib.focus + step));
      if (!e.shiftKey) lib.sel.clear();
      lib.sel.add(lib.list[lib.focus]?.id);
      drawGrid();
      $(`.tile[data-i="${lib.focus}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if ((k === "enter" || k === " ") && lib.list.length) {
      e.preventDefault();
      return openViewer(lib.list.map((p) => p.id), lib.focus, {});
    }
    if (!ids.length) return;
    if (k === "p") act.flag(ids, 1);
    else if (k === "x") act.flag(ids, -1);
    else if (k === "u") act.flag(ids, 0);
    else if (/^[0-5]$/.test(k)) act.rate(ids, Number(k));
    else if (k === "t") act.tag(ids);
    else if (k === "c" && ids.length >= 2) openCompare(ids.slice(0, 4));
    else if (k === "backspace" && e.metaKey) act.bin(ids);
  },
  async loadTree() {
    const [t, cls, albums] = await Promise.all([quiet("tree"), quiet("classes"), quiet("albums")]);
    if (!t || !$("#tree")) return;
    lib.tree = t;
    lib.albums = albums ?? { counts: {}, mine: [] };
    lib.classes = cls ?? [];
    drawTree();
    drawFilters();
  },
  async load(keepSel) {
    const f = { ...lib.filter };
    if (f.album === "all") delete f.album;
    const list = await quiet("photos", f);
    if (!list || !$("#grid")) return;
    lib.list = list;
    if (!keepSel) {
      lib.sel.clear();
      lib.focus = 0;
    } else {
      const ids = new Set(list.map((p) => p.id));
      [...lib.sel].forEach((id) => !ids.has(id) && lib.sel.delete(id));
    }
    drawTitle();
    drawGrid();
  },
  drawFilters() {
    drawFilters();
  },
};

function selectedIds() {
  return lib.list.filter((p) => lib.sel.has(p.id)).map((p) => p.id);
}

function drawTitle() {
  const f = lib.filter;
  let title = L("Library", "المكتبة");
  let sub = "";
  if (f.album) title = ALBUMS().find((a) => a.id === f.album)?.label ?? (lib.albums?.mine ?? []).find((a) => `my:${a.id}` === f.album)?.name ?? title;
  if (f.event) {
    const ev = lib.tree?.rows.find((r) => r.event_key === f.event);
    title = ev?.event_title ?? f.event;
    sub = [ev?.event_date && fmtDate(ev.event_date), ev?.term, ev?.year].filter(Boolean).join(" · ");
  } else if (f.year) {
    title = [f.year, f.term].filter(Boolean).join(" · ");
  }
  if (f.student) title = L("Photos of a student", "صور طالب");
  if (f.className && !f.event) title = `${L("Class", "فصل")} ${f.className}`;
  $("#libtitle").textContent = title;
  const picks = lib.list.filter((p) => p.flag === 1).length;
  $("#libsub").textContent = [sub, plural(lib.list.length, "photo", "photos", "صورة"), picks ? L(`${num(picks)} picked`, `${num(picks)} مختارة`) : ""].filter(Boolean).join(" · ");
}

function drawTree() {
  const t = lib.tree;
  const tree = $("#tree");
  if (!t || !tree) return;
  const f = lib.filter;
  const out = [];
  const counts = lib.albums?.counts ?? {};
  const head = (id, label, extra = "") => `<div class="head row nowrap" data-sec="${id}" style="cursor: pointer"><span class="grow">${collapsed.has(id) ? "▸" : "▾"} ${esc(label)}</span>${extra}</div>`;
  for (const [sec, label] of Object.entries(ALBUM_SECS())) {
    if (sec === "mine") {
      out.push(head("mine", label, `<button class="link small" id="newalbum" title="${L("New album", "ألبوم جديد")}">+</button>`));
      if (collapsed.has("mine")) continue;
      for (const a of lib.albums?.mine ?? []) out.push(`<div class="t ${f.album === `my:${a.id}` ? "on" : ""}" data-album="my:${a.id}" data-mine="${a.id}"><span>${a.rule ? "⚙" : "▣"}</span><span class="name">${esc(a.name)}</span><span class="n">${num(a.n)}</span></div>`);
      if (!(lib.albums?.mine ?? []).length) out.push(`<p class="muted tiny" style="padding: 2px 8px">${L("Drag photos onto + or select and press “Add to album”.", "اسحب الصور إلى + أو حددها واضغط «إضافة إلى ألبوم».")}</p>`);
      continue;
    }
    out.push(head(sec, label));
    if (collapsed.has(sec)) continue;
    for (const a of ALBUMS().filter((x) => x.sec === sec)) {
      const n = counts[a.id];
      // Empty albums hide (except All photos and the one open now).
      if (n === 0 && a.id !== "all" && f.album !== a.id) continue;
      out.push(`<div class="t ${f.album === a.id ? "on" : ""}" data-album="${a.id}"><span>${a.icon}</span><span class="name">${esc(a.label)}</span>${n !== undefined ? `<span class="n">${num(n)}</span>` : ""}</div>`);
    }
  }
  const years = new Map();
  for (const r of t.rows) {
    const y = r.year ?? L("No date", "بلا تاريخ");
    if (!years.has(y)) years.set(y, new Map());
    const terms = years.get(y);
    const term = r.term ?? "—";
    if (!terms.has(term)) terms.set(term, []);
    terms.get(term).push(r);
  }
  out.push(`<div class="head">${L("School years", "السنوات الدراسية")}</div>`);
  if (!t.rows.length) out.push(`<p class="muted small" style="padding: 4px 8px">${L("No photos yet. Import some, or choose your library folder in Settings.", "لا توجد صور بعد. استورد بعضها، أو اختر مجلد المكتبة من الإعدادات.")}</p>`);
  for (const [y, terms] of years) {
    const yn = [...terms.values()].flat().reduce((s, r) => s + r.n, 0);
    out.push(`<div class="t ${f.year === y && !f.term && !f.event ? "on" : ""}" data-year="${esc(y)}"><span>▾</span><span class="name"><b>${esc(y)}</b></span><span class="n">${num(yn)}</span></div>`);
    for (const [term, events] of terms) {
      const tn = events.reduce((s, r) => s + r.n, 0);
      out.push(`<div class="t lvl1 ${f.year === y && f.term === term && !f.event ? "on" : ""}" data-year="${esc(y)}" data-term="${esc(term)}"><span class="name">${esc(term)}</span><span class="n">${num(tn)}</span></div>`);
      for (const ev of events) {
        if (!ev.event_key) continue;
        const on = f.event === ev.event_key;
        out.push(`<div class="t lvl2 ${on && !f.className ? "on" : ""}" data-event="${esc(ev.event_key)}" data-title="${esc(ev.event_title)}" data-date="${esc(ev.event_date ?? "")}" title="${esc(ev.event_key)}"><span class="name">${esc(eventLabel(ev))}</span>${ev.picks ? `<span class="tag good" style="padding: 0 5px">${num(ev.picks)}</span>` : ""}<span class="n">${num(ev.n)}</span></div>`);
        if (on) {
          for (const c of t.classes.filter((c) => c.event_key === ev.event_key)) {
            out.push(`<div class="t lvl3 ${f.className === c.class_name ? "on" : ""}" data-event="${esc(ev.event_key)}" data-class="${esc(c.class_name)}"><span class="name">${esc(c.class_name)}</span><span class="n">${num(c.n)}</span></div>`);
          }
        }
      }
    }
  }
  tree.innerHTML = out.join("");
  $$("[data-sec]", tree).forEach((el) => (el.onclick = (e) => e.target.id !== "newalbum" && toggleSec(el.dataset.sec)));
  const nb = $("#newalbum", tree);
  if (nb) {
    nb.onclick = (e) => { e.stopPropagation(); albumDialog(selectedIds()); };
    nb.addEventListener("dragover", (e) => e.dataTransfer.types.includes("text/hub-photos") && e.preventDefault());
    nb.addEventListener("drop", (e) => { e.preventDefault(); albumDialog(JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]")); });
  }
  $$("[data-mine]", tree).forEach((el) => {
    el.addEventListener("dragover", (e) => e.dataTransfer.types.includes("text/hub-photos") && (e.preventDefault(), el.classList.add("on")));
    el.addEventListener("dragleave", () => el.classList.toggle("on", lib.filter.album === el.dataset.album));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      const ids = JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]");
      await call("addToAlbum", Number(el.dataset.mine), ids);
      toast(L(`Added ${ids.length} photos`, `أُضيفت ${num(ids.length)} صورة`));
    });
    el.oncontextmenu = (e) => { e.preventDefault(); albumMenu(Number(el.dataset.mine)); };
  });
  $$(".t", tree).forEach((el) => {
    el.onclick = () => {
      const d = el.dataset;
      if (d.album) lib.filter = { album: d.album };
      else if (d.event) lib.filter = { event: d.event, className: d.class };
      else if (d.year) lib.filter = { year: d.year, term: d.term };
      drawTree();
      drawFilters();
      App.views.library.load();
    };
    // Drop photos on an event to move them there.
    if (el.dataset.event && !el.dataset.class) {
      el.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes("text/hub-photos")) {
          e.preventDefault();
          el.classList.add("on");
        }
      });
      el.addEventListener("dragleave", () => el.classList.toggle("on", lib.filter.event === el.dataset.event));
      el.addEventListener("drop", async (e) => {
        const ids = JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]");
        if (!ids.length) return;
        e.preventDefault();
        e.stopPropagation();
        await call("moveTo", ids, { title: el.dataset.title, date: el.dataset.date || new Date().toISOString().slice(0, 10) });
        toast(L(`Moved ${ids.length} photos to ${el.dataset.title}`, `نُقلت ${num(ids.length)} صورة إلى ${el.dataset.title}`), { undo: true });
      });
    }
  });
}

function drawFilters() {
  const bar = $("#filters");
  if (!bar) return;
  const f = lib.filter;
  const classOptions = [...new Set(lib.classes.map((c) => c.class_name).filter(Boolean))];
  bar.innerHTML = `
    <input type="search" id="q" placeholder="${L("Search file or event…", "ابحث باسم الملف أو الفعالية…")}" value="${esc(f.search ?? "")}" style="width: 170px" />
    <select id="cls"><option value="">${L("Every class", "كل الفصول")}</option>${classOptions.map((c) => `<option ${f.className === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    <select id="rate"><option value="">${L("Any rating", "أي تقييم")}</option>${[3, 4, 5].map((n) => `<option value="${n}" ${f.minRating === n ? "selected" : ""}>${"★".repeat(n)}+</option>`).join("")}</select>
    <select id="sort"><option value="time">${L("By time", "حسب الوقت")}</option><option value="quality" ${f.sort === "quality" ? "selected" : ""}>${L("Best first", "الأفضل أولًا")}</option><option value="name" ${f.sort === "name" ? "selected" : ""}>${L("By name", "حسب الاسم")}</option></select>
    ${f.event ? `<button class="btn small" id="evedit">✎ ${L("Rename event", "إعادة تسمية")}</button><button class="btn small" id="evopen">${L("Show in Finder", "إظهار في Finder")}</button>` : ""}
    <span class="grow"></span>
    <input type="range" id="size" min="110" max="320" value="${lib.tile}" style="width: 80px; flex-shrink: 1; min-width: 50px" title="${L("Tile size", "حجم الصور")}" />`;
  let t;
  $("#q", bar).oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      lib.filter.search = e.target.value.trim() || undefined;
      App.views.library.load();
    }, 250);
  };
  $("#cls", bar).onchange = (e) => {
    lib.filter.className = e.target.value || undefined;
    App.views.library.load();
  };
  $("#rate", bar).onchange = (e) => {
    lib.filter.minRating = Number(e.target.value) || undefined;
    App.views.library.load();
  };
  $("#sort", bar).onchange = (e) => {
    lib.filter.sort = e.target.value;
    App.views.library.load();
  };
  $("#size", bar).oninput = (e) => {
    lib.tile = Number(e.target.value);
    $("#grid").style.setProperty("--tile", `${lib.tile}px`);
  };
  $("#evedit", bar)?.addEventListener("click", renameEvent);
  $("#evopen", bar)?.addEventListener("click", async () => {
    const dir = await call("eventFolderPath", lib.filter.event);
    if (dir) call("showFile", dir);
  });
}

function tileHtml(p, i) {
  const badges = [];
  if (p.flag === 1) badges.push(`<span class="b pick">✓</span>`);
  if (p.flag === -1) badges.push(`<span class="b no">✕</span>`);
  if (p.face_count) badges.push(`<span class="b">☺ ${p.tagged}/${p.face_count}</span>`);
  else if (p.tagged) badges.push(`<span class="b">☺ ${p.tagged}</span>`);
  if (p.suggested) badges.push(`<span class="b sug">? ${p.suggested}</span>`);
  if (p.no_post) badges.push(`<span class="b no">⛔</span>`);
  if (p.is_raw || p.has_raw) badges.push(`<span class="b">RAW</span>`);
  if (p.edits) badges.push(`<span class="b">✎</span>`);
  if (p.remote_id) badges.push(`<span class="b">☁</span>`);
  return `<div class="tile ${lib.sel.has(p.id) ? "sel" : ""} ${p.flag === -1 ? "rejected" : ""}" data-i="${i}" draggable="true">
    ${p.thumb === 1 ? `<img loading="lazy" src="hub://thumb/${p.id}" />` : p.thumb === -1 ? `<div class="empty small">⚠︎<br>${L("Can't read", "تعذّرت القراءة")}</div>` : `<div class="empty small">…</div>`}
    ${p.rating ? `<span class="stars">${"★".repeat(p.rating)}</span>` : ""}<div class="badges">${badges.join("")}</div></div>`;
}

function drawGrid() {
  const grid = $("#grid");
  if (!grid) return;
  grid.style.setProperty("--tile", `${lib.tile}px`);
  if (!lib.list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column: 1 / -1"><span class="big">▦</span><b>${L("No photos here", "لا توجد صور هنا")}</b><span>${L("Drag a folder of photos onto this window to import it.", "اسحب مجلد صور إلى هذه النافذة لاستيراده.")}</span></div>`;
  } else {
    grid.innerHTML = lib.list.map(tileHtml).join("");
  }
  grid.onclick = (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const i = Number(tile.dataset.i);
    const id = lib.list[i].id;
    if (e.shiftKey && lib.anchor !== null) {
      const [a, b] = [Math.min(lib.anchor, i), Math.max(lib.anchor, i)];
      for (let k = a; k <= b; k++) lib.sel.add(lib.list[k].id);
    } else if (e.metaKey) {
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
    if (tile) openViewer(lib.list.map((p) => p.id), Number(tile.dataset.i), {});
  };
  grid.ondragstart = (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const id = lib.list[Number(tile.dataset.i)].id;
    if (!lib.sel.has(id)) {
      lib.sel.clear();
      lib.sel.add(id);
    }
    e.dataTransfer.setData("text/hub-photos", JSON.stringify(selectedIds()));
  };
  drawSelbar();
}

function refreshSelection() {
  $$(".tile", $("#grid")).forEach((t) => t.classList.toggle("sel", lib.sel.has(lib.list[Number(t.dataset.i)]?.id)));
  drawSelbar();
}

function drawSelbar() {
  const bar = $("#selbar");
  if (!bar) return;
  const ids = selectedIds();
  if (!ids.length) return bar.replaceChildren();
  bar.innerHTML = `<div class="selbar"><b style="padding: 0 6px">${plural(ids.length, "selected", "selected", "محددة")}</b>
    <button class="btn small" data-a="pick" title="P">✓ ${L("Pick", "اختيار")}</button>
    <button class="btn small" data-a="reject" title="X">✕</button>
    <button class="btn small" data-a="rate">★</button>
    <button class="btn small" data-a="tag" title="T">☺ ${L("Tag", "وسم")}</button>
    <button class="btn small" data-a="move">⇢ ${L("Move", "نقل")}</button>
    ${ids.length >= 2 && ids.length <= 4 ? `<button class="btn small" data-a="compare" title="C">◫ ${L("Compare", "مقارنة")}</button>` : ""}
    <button class="btn small" data-a="edit">${L("Edit in app", "تعديل في تطبيق")}</button>
    <button class="btn small" data-a="more">⋯</button>
    <button class="btn small primary" data-a="post">✎ ${L("New post", "منشور جديد")}</button></div>`;
  $$("[data-a]", bar).forEach((b) => {
    b.onclick = (e) => {
      const a = b.dataset.a;
      if (a === "pick") act.flag(ids, 1);
      if (a === "reject") act.flag(ids, -1);
      if (a === "rate") rateMenu(ids);
      if (a === "tag") act.tag(ids);
      if (a === "move") moveDialog(ids);
      if (a === "compare") openCompare(ids);
      if (a === "edit") call("openEditor", ids);
      if (a === "post") newPostFromSelection();
      if (a === "more") moreMenu(ids);
      e.stopPropagation();
    };
  });
}

const act = {
  async flag(ids, n) {
    await call("flag", ids, n);
    for (const p of lib.list) if (ids.includes(p.id)) p.flag = n;
    drawGrid();
    if (n === 1 && S.sendMode === "picked" && S.signedIn) toast(L("Picked. Web copies are being sent for posts.", "تم الاختيار. تُرسل نسخ ويب للمنشورات."));
  },
  async rate(ids, n) {
    await call("rate", ids, n);
    for (const p of lib.list) if (ids.includes(p.id)) p.rating = n;
    drawGrid();
  },
  tag(ids) {
    const ev = lib.list.find((p) => p.id === ids[0]);
    pickStudent(L(`Who is in ${ids.length > 1 ? `these ${ids.length} photos` : "this photo"}?`, ids.length > 1 ? `من في هذه الصور (${num(ids.length)})؟` : "من في هذه الصورة؟"), async (s) => {
      await call("tagPhotos", ids, s.id);
      toast(L(`Tagged ${name(s)}`, `تم وسم ${name(s)}`), { undo: true });
    }, { className: lib.filter.className || ev?.class_name });
  },
  async bin(ids) {
    const m = modal(`<h2>${L(`Move ${ids.length} photos to the Bin?`, `نقل ${num(ids.length)} صورة إلى سلة المهملات؟`)}</h2>
      <p class="muted">${L("They go to the Mac's Bin, so you can still put them back from there.", "تذهب إلى سلة مهملات الماك، ويمكنك إرجاعها من هناك.")}</p>
      <div class="row"><span class="grow"></span><button class="btn" id="no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="yes">${L("Move to Bin", "نقل إلى السلة")}</button></div>`);
    $("#no", m).onclick = closeOverlay;
    $("#yes", m).onclick = async () => {
      closeOverlay();
      const n = await call("bin", ids);
      toast(L(`${n} photos moved to the Bin`, `نُقلت ${num(n)} صورة إلى السلة`));
    };
  },
};

function rateMenu(ids) {
  const m = modal(`<h2>${L("Rating", "التقييم")}</h2><div class="row">${[0, 1, 2, 3, 4, 5].map((n) => `<button class="btn" data-n="${n}">${n ? "★".repeat(n) : L("None", "بدون")}</button>`).join("")}</div><p class="muted small">${L("Tip: press 1 to 5 on the keyboard.", "تلميح: اضغط من 1 إلى 5 على لوحة المفاتيح.")}</p>`);
  $$("[data-n]", m).forEach((b) => (b.onclick = () => { closeOverlay(); act.rate(ids, Number(b.dataset.n)); }));
}

function moreMenu(ids) {
  const m = modal(`<h2>${plural(ids.length, "photo", "photos", "صورة")}</h2><div class="col">
    <button class="btn" id="m-finder">${L("Show in Finder", "إظهار في Finder")}</button>
    <button class="btn" id="m-album">▣ ${L("Add to album…", "إضافة إلى ألبوم…")}</button>
    ${lib.filter.album?.startsWith("my:") ? `<button class="btn" id="m-unalbum">${L("Remove from this album", "إزالة من هذا الألبوم")}</button>` : ""}
    <button class="btn" id="m-unpick">${L("Clear pick / reject", "إلغاء الاختيار أو الرفض")}</button>
    <button class="btn" id="m-similar">${L("Find similar shots in this selection", "البحث عن لقطات متشابهة في المحدد")}</button>
    <button class="btn danger" id="m-bin">${L("Move to Bin", "نقل إلى السلة")}</button></div>`);
  $("#m-finder", m).onclick = () => { closeOverlay(); call("reveal", ids[0]); };
  $("#m-unpick", m).onclick = () => { closeOverlay(); act.flag(ids, 0); };
  $("#m-album", m).onclick = () => albumDialog(ids);
  $("#m-unalbum", m)?.addEventListener("click", async () => { closeOverlay(); await call("removeFromAlbum", Number(lib.filter.album.slice(3)), ids); });
  $("#m-similar", m).onclick = async () => {
    closeOverlay();
    const groups = await call("similar", ids);
    if (!groups.length) return toast(L("No near-identical shots found.", "لم يتم العثور على لقطات شبه متطابقة."));
    openCompare(groups[0].slice(0, 4));
    toast(L(`${groups.length} groups of similar shots. Showing the first.`, `${num(groups.length)} مجموعة لقطات متشابهة. تُعرض الأولى.`));
  };
  $("#m-bin", m).onclick = () => act.bin(ids);
}

function moveDialog(ids) {
  const events = (lib.tree?.rows ?? []).filter((r) => r.event_key);
  const today = new Date().toISOString().slice(0, 10);
  const m = modal(`<h2>${L(`Move ${ids.length} photos`, `نقل ${num(ids.length)} صورة`)}</h2>
    <label class="field">${L("To an event", "إلى فعالية")}<select id="mv-ev"><option value="">${L("A new event…", "فعالية جديدة…")}</option>${events.map((e, i) => `<option value="${i}">${esc(e.event_title)} · ${esc(e.event_date ?? "")}</option>`).join("")}</select></label>
    <div class="grid2" id="mv-new"><label class="field">${L("Event name", "اسم الفعالية")}<input id="mv-title" /></label><label class="field">${L("Date", "التاريخ")}<input type="date" id="mv-date" value="${today}" /></label></div>
    <label class="field">${L("Class folder (optional)", "مجلد الفصل (اختياري)")}<input id="mv-class" list="mv-classes" /><datalist id="mv-classes">${[...new Set(lib.classes.map((c) => c.class_name))].map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
    <p class="muted small">${L("The files move to that folder on the Mac. Tags, picks and ratings stay with them.", "تنتقل الملفات إلى ذلك المجلد على الماك، وتبقى معها الأسماء والاختيارات والتقييمات.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="mv-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="mv-yes">${L("Move", "نقل")}</button></div>`);
  $("#mv-ev", m).onchange = (e) => $("#mv-new", m).classList.toggle("hide", !!e.target.value);
  $("#mv-no", m).onclick = closeOverlay;
  $("#mv-yes", m).onclick = async () => {
    const ev = events[Number($("#mv-ev", m).value)];
    const title = ev ? ev.event_title : $("#mv-title", m).value.trim();
    const date = ev ? ev.event_date || today : $("#mv-date", m).value || today;
    if (!title || title.length < 2) return $("#mv-title", m).focus();
    closeOverlay();
    await call("moveTo", ids, { title, date, className: $("#mv-class", m).value.trim() || null });
    toast(L(`Moved to ${title}`, `نُقلت إلى ${title}`), { undo: true });
  };
}

function renameEvent() {
  const ev = lib.tree?.rows.find((r) => r.event_key === lib.filter.event);
  if (!ev) return;
  const m = modal(`<h2>${L("Rename event", "إعادة تسمية الفعالية")}</h2>
    <div class="grid2"><label class="field">${L("Name", "الاسم")}<input id="rn-title" value="${esc(ev.event_title)}" /></label><label class="field">${L("Date", "التاريخ")}<input type="date" id="rn-date" value="${esc(ev.event_date ?? "")}" /></label></div>
    <p class="muted small">${L("The folder on the Mac is renamed too. Nothing is lost.", "يُعاد تسمية المجلد على الماك أيضًا. لا يضيع شيء.")}</p>
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

// "Best photos": the app's own picks from this event or class, checked on
// this Mac (sharpness, light, faces, one per burst, many different students).
function bestPicker() {
  if (!lib.list.length) return;
  const m = modal(`<h2>✦ ${L("Best photos", "أفضل الصور")}</h2>
    <p class="muted">${L("The Mac picks the sharpest, best-lit shots, one from each burst, with as many different students as possible. Nothing is sent anywhere.", "يختار الماك أوضح اللقطات وأفضلها إضاءة، لقطة من كل مجموعة متتابعة، وبأكبر عدد من الطلاب المختلفين. لا يُرسل شيء لأي مكان.")}</p>
    <label class="field">${L("How many", "العدد")}<select id="bp-n">${[4, 6, 8, 10].map((n) => `<option ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="row"><span class="grow"></span><button class="btn" id="bp-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="bp-yes">${L("Choose", "اختيار")}</button></div>`);
  $("#bp-no", m).onclick = closeOverlay;
  $("#bp-yes", m).onclick = async () => {
    const n = Number($("#bp-n", m).value);
    closeOverlay();
    const ids = await call("best", lib.list.map((p) => p.id), n);
    lib.sel = new Set(ids);
    drawGrid();
    toast(L(`Selected the best ${ids.length}. Press P to pick them, or ✎ New post.`, `حُدد أفضل ${num(ids.length)}. اضغط P لاختيارها، أو ✎ منشور جديد.`), { ms: 7000 });
  };
}

async function newPostFromSelection() {
  const ids = selectedIds();
  if (!ids.length) return toast(L("Select photos first, then press New post.", "حدد الصور أولًا، ثم اضغط منشور جديد."));
  if (!S.signedIn) return toast(L(ERRORS["not-signed-in"][0], ERRORS["not-signed-in"][1]));
  const nopost = lib.list.filter((p) => ids.includes(p.id) && p.no_post);
  if (nopost.length) toast(L(`${nopost.length} of these photos show a student who can't appear in posts. The website will stop the post until they are removed.`, `${num(nopost.length)} من هذه الصور فيها طالب لا يظهر في المنشورات. سيمنع الموقع النشر حتى إزالتها.`), { ms: 8000 });
  const m = modal(`<h2>✎ ${L("Making the post…", "جارٍ إنشاء المنشور…")}</h2><p class="muted" id="np-msg">${L("Sending web copies of the photos. Originals stay on this Mac.", "تُرسل نسخ ويب من الصور، وتبقى الأصول على هذا الماك.")}</p><div class="bar"><i id="np-bar" style="width: 5%"></i></div>`, { sticky: true });
  try {
    const id = await call("newPost", ids.slice(0, 20));
    closeOverlay();
    go("posts", { post: id });
  } catch {
    closeOverlay();
  }
}

// Add photos to an album, make a new one, or build a smart album from rules.
function albumDialog(ids = []) {
  const mine = (lib.albums?.mine ?? []).filter((a) => !a.rule);
  const classes = [...new Set((lib.classes ?? []).map((c) => c.class_name).filter(Boolean))];
  const m = modal(`<h2>▣ ${ids.length ? L(`Add ${ids.length} photos to an album`, `إضافة ${num(ids.length)} صورة إلى ألبوم`) : L("New album", "ألبوم جديد")}</h2>
    ${ids.length && mine.length ? `<div class="col gap4">${mine.map((a) => `<button class="btn" data-add="${a.id}" style="justify-content: space-between"><span>${esc(a.name)}</span><span class="muted small">${num(a.n)}</span></button>`).join("")}</div><div class="muted small">${L("or a new one:", "أو ألبوم جديد:")}</div>` : ""}
    <label class="field">${L("Name", "الاسم")}<input id="al-name" placeholder="${L("e.g. Best of Term 1", "مثال: أفضل صور الفصل الأول")}" /></label>
    ${ids.length ? "" : `<label class="check"><input type="checkbox" id="al-smart" /> ${L("Smart album: fill it by rules", "ألبوم ذكي: يمتلئ حسب قواعد")}</label>
    <div class="grid2 hide" id="al-rules">
      <label class="field">${L("At least", "على الأقل")}<select id="r-rating"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${"★".repeat(n)}</option>`).join("")}</select></label>
      <label class="field">${L("Class", "الفصل")}<select id="r-class"><option value="">—</option>${classes.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
      <label class="field">${L("Event name has", "اسم الفعالية يحتوي")}<input id="r-event" /></label>
      <label class="field">${L("People", "الأشخاص")}<select id="r-people"><option value="">—</option><option value="none">${L("No people", "بلا أشخاص")}</option><option value="some">${L("1 to 4 people", "1 إلى 4 أشخاص")}</option><option value="group">${L("Groups (5+)", "مجموعات (5+)")}</option></select></label>
      <label class="field">${L("From", "من")}<input type="date" id="r-from" /></label>
      <label class="field">${L("To", "إلى")}<input type="date" id="r-to" /></label>
      <label class="check"><input type="checkbox" id="r-picked" /> ${L("Picks only", "المختارة فقط")}</label>
    </div>`}
    <div class="row"><span class="grow"></span><button class="btn" id="al-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="al-yes">${L("Create", "إنشاء")}</button></div>`);
  $("#al-no", m).onclick = closeOverlay;
  $("#al-smart", m)?.addEventListener("change", (e) => $("#al-rules", m).classList.toggle("hide", !e.target.checked));
  $$("[data-add]", m).forEach((b) => (b.onclick = async () => {
    await call("addToAlbum", Number(b.dataset.add), ids);
    closeOverlay();
    toast(L(`Added ${ids.length} photos`, `أُضيفت ${num(ids.length)} صورة`));
  }));
  $("#al-yes", m).onclick = async () => {
    const name = $("#al-name", m).value.trim();
    if (!name) return $("#al-name", m).focus();
    let rule = null;
    if ($("#al-smart", m)?.checked) {
      rule = {
        minRating: Number($("#r-rating", m).value) || undefined,
        className: $("#r-class", m).value || undefined,
        event: $("#r-event", m).value.trim() || undefined,
        people: $("#r-people", m).value || undefined,
        from: $("#r-from", m).value || undefined,
        to: $("#r-to", m).value || undefined,
        picked: $("#r-picked", m).checked || undefined,
      };
    }
    const id = await call("newAlbum", name, rule, ids);
    closeOverlay();
    lib.filter = { album: `my:${id}` };
    App.views.library.loadTree();
    App.views.library.load();
  };
}

function albumMenu(id) {
  const a = (lib.albums?.mine ?? []).find((x) => x.id === id);
  if (!a) return;
  const m = modal(`<h2>${esc(a.name)}</h2><label class="field">${L("Name", "الاسم")}<input id="am-name" value="${esc(a.name)}" /></label>
    <div class="row"><button class="btn danger" id="am-del">${L("Delete album (photos stay)", "حذف الألبوم (تبقى الصور)")}</button><span class="grow"></span><button class="btn primary" id="am-save">${L("Save", "حفظ")}</button></div>`);
  $("#am-save", m).onclick = async () => { await call("renameAlbum", id, $("#am-name", m).value.trim() || a.name); closeOverlay(); App.views.library.loadTree(); };
  $("#am-del", m).onclick = async () => { await call("deleteAlbum", id); closeOverlay(); lib.filter = { album: "all" }; App.views.library.loadTree(); App.views.library.load(); };
}
