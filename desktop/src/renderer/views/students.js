// Students, teachers, staff and parents. Faces like People in Apple Photos
// (or a list), grouped Stage → Grade → Class, filter chips, select many and
// change them together, clubs and teams, the class teacher, the new school
// year, the class list import showing what changes first, and students
// entered twice. Each person has a page with their photos as a timeline.
const ST = { kind: "student", className: null, stage: null, grade: null, group: null, left: false, search: "", chip: "", view: "grid", sel: new Set(), shut: new Set() };
const STAGES = () => ({ KG: L("KG", "KG"), Primary: L("Primary", "ابتدائي"), Prep: L("Prep", "إعدادي"), Secondary: L("Secondary", "ثانوي") });
const KIND_PLURAL = () => ({ student: L("Students", "الطلاب"), teacher: L("Teachers", "المعلمون"), staff: L("Staff", "الموظفون"), parent: L("Parents", "أولياء الأمور"), visitor: L("Visitors", "الزوار") });
const otherName = (s) => (S.language === "en" ? s.name_ar : s.name_en) ?? "";
const dot = (n) => `<span class="pdot ${n === 0 ? "bad" : n < 3 ? "warn" : "good"}" title="${esc(plural(n, "photo", "photos", "صورة"))}"></span>`;
const MISSING = () => ({ ar: L("No Arabic name", "لا اسم بالعربية"), en: L("No English name", "لا اسم بالإنجليزية"), id: L("No student ID", "لا رقم طالب"), face: L("No face yet", "لا وجه بعد"), class: L("No class", "لا فصل") });
const dayLabel = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(S.language === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

App.views.students = {
  render(main, params) {
    if (params.className !== undefined) Object.assign(ST, { className: params.className, kind: "student", stage: null, grade: null, group: null, left: false });
    if (params.kind) Object.assign(ST, { kind: params.kind, className: null, group: null, left: false });
    if (params.chip !== undefined) ST.chip = params.chip;
    ST.sel.clear();
    main.innerHTML = topbar(L("Students", "الطلاب"), `<span id="st-sub"></span>`,
      `<input type="search" id="st-q" placeholder="${L("Find someone (any spelling)…", "ابحث عن أي شخص (بأي تهجئة)…")}" value="${esc(ST.search)}" style="width: 220px" />
       ${pills([["grid", "", "layout-grid"], ["list", "", "list"]], ST.view, "data-view")}
       <button class="btn" id="st-more">${icon("ellipsis", 15)}</button>
       <button class="btn" id="st-add">${icon("plus", 14)} ${L("Add", "إضافة")}</button>
       <button class="btn primary" id="st-imp">${icon("file-spreadsheet", 14)} ${L("Import class list", "استيراد قائمة الفصول")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree" id="st-tree"></nav><div class="gridwrap"><div class="content" id="st-list"></div><div id="st-bar"></div></div></div></div>`;
    $("#st-imp", main).onclick = () => importList();
    $("#st-add", main).onclick = () => editPerson(null);
    $("#st-more", main).onclick = () => menu([
      { label: L("New school year…", "عام دراسي جديد…"), run: newYear },
      { label: L("Students entered twice…", "طلاب مسجلون مرتين…"), run: duplicatesBox },
      "-",
      { label: L("New club or team…", "نادٍ أو فريق جديد…"), run: () => groupBox() },
      { label: L("Birthdays coming up", "أعياد الميلاد القادمة"), run: () => { ST.chip = "birthday"; this.list(); this.chips(); } },
    ]);
    bindPills(main, "data-view", (v) => { ST.view = v; $$("[data-view]", main).forEach((b) => b.classList.toggle("on", b.dataset.view === v)); this.list(); });
    let t;
    $("#st-q", main).oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => { ST.search = e.target.value.trim(); this.list(); }, 200);
    };
    this.tree();
    this.list();
    if (params.import) importList(params.file);
  },
  onState(changed) {
    if (changed.includes("students") || changed.includes("faces")) {
      clearTimeout(ST.t);
      ST.t = setTimeout(() => { this.tree(); this.list(); }, 800);
    }
  },
  keys: () => [["⌘ A", L("Select all", "تحديد الكل")], ["Esc", L("Clear selection", "إلغاء التحديد")]],
  onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !e.target.closest("input, textarea")) {
      e.preventDefault();
      (ST.rows ?? []).forEach((r) => ST.sel.add(r.id));
      this.drawList();
    } else if (e.key === "Escape" && ST.sel.size) {
      ST.sel.clear();
      this.drawList();
    }
  },

  async tree() {
    const d = await quiet("studentTree");
    const tree = $("#st-tree");
    if (!tree || !d) return;
    ST.tree = d;
    const k = (kind, ic) => `<div class="t ${!ST.left && !ST.group && ST.kind === kind && (kind !== "student" || (!ST.className && !ST.stage && !ST.grade)) ? "on" : ""}" data-kind="${kind}">${icon(ic, 14)}<span class="name">${esc(KIND_PLURAL()[kind])}</span><span class="n">${num(d.kinds[kind] ?? 0)}</span></div>`;
    const out = [
      `<div class="head" style="cursor: default">${L("People", "الأشخاص")}</div>`,
      k("student", "graduation-cap"), k("teacher", "presentation"), k("staff", "briefcase"), k("parent", "users"), k("visitor", "user"),
      `<div class="t ${ST.left ? "on" : ""}" data-left="1">${icon("archive", 14)}<span class="name">${L("Left or graduated", "غادروا أو تخرّجوا")}</span><span class="n">${num(d.left)}</span></div>`,
    ];
    let stage, grade;
    for (const c of d.classes) {
      if (c.stage !== stage) {
        stage = c.stage;
        grade = undefined;
        const n = d.classes.filter((x) => x.stage === stage).reduce((a, x) => a + x.n, 0);
        out.push(`<div class="head ${ST.shut.has("s:" + stage) ? "shut" : ""}" data-shut="s:${esc(stage ?? "")}">${icon("chevron-down", 12)}<span data-stage="${esc(stage ?? "")}" class="grow">${esc(STAGES()[stage] ?? stage ?? L("Other", "أخرى"))}</span><span class="n">${num(n)}</span></div>`);
      }
      if (ST.shut.has("s:" + stage)) continue;
      if (c.grade !== grade) {
        grade = c.grade;
        const n = d.classes.filter((x) => x.stage === stage && x.grade === grade).reduce((a, x) => a + x.n, 0);
        out.push(`<div class="t ${ST.grade === grade && !ST.className ? "on" : ""}" data-grade="${esc(grade ?? "")}"><span class="name"><b>${esc(grade ?? L("No grade", "بلا صف"))}</b></span><span class="n">${num(n)}</span></div>`);
      }
      out.push(`<div class="t lvl1 ${ST.className === c.class_name ? "on" : ""}" data-c="${esc(c.class_name ?? "")}"><span class="name">${esc(c.class_name ?? "—")}</span>${c.zero ? `<span class="pdot bad" title="${esc(L(`${c.zero} with no photos`, `${num(c.zero)} بلا صور`))}"></span>` : ""}<span class="n">${num(c.n)}</span></div>`);
    }
    out.push(`<div class="head" style="cursor: default"><span class="grow">${L("Clubs and teams", "الأندية والفرق")}</span><button class="btn ghost tiny" id="st-newg" title="${esc(L("New club or team", "نادٍ أو فريق جديد"))}">${icon("plus", 12)}</button></div>`);
    out.push(...d.groups.map((g) => `<div class="t ${ST.group === g.id ? "on" : ""}" data-g="${g.id}">${icon(g.kind === "team" ? "trophy" : "star", 14)}<span class="name">${esc(g.name)}</span><span class="n">${num(g.n)}</span></div>`));
    if (!d.groups.length) out.push(`<div class="tiny muted" style="padding: 2px 8px">${L("The football team, the choir…", "فريق كرة القدم، الكورال…")}</div>`);
    if (d.duplicates) out.push(`<div class="t" id="st-dups" style="margin-top: 10px; color: var(--warn)">${icon("copy", 14)}<span class="name">${L("Entered twice?", "مسجّلون مرتين؟")}</span><span class="n">${num(d.duplicates)}</span></div>`);
    tree.innerHTML = out.join("");
    const pick = (o) => { Object.assign(ST, { className: null, stage: null, grade: null, group: null, left: false, kind: "student" }, o); ST.sel.clear(); this.tree(); this.list(); };
    $$("[data-kind]", tree).forEach((el) => (el.onclick = () => pick({ kind: el.dataset.kind })));
    $("[data-left]", tree).onclick = () => pick({ left: true });
    $$("[data-shut]", tree).forEach((el) => (el.onclick = (e) => {
      if (e.target.closest("[data-stage]")) return pick({ stage: e.target.closest("[data-stage]").dataset.stage || null });
      const key = el.dataset.shut;
      ST.shut.has(key) ? ST.shut.delete(key) : ST.shut.add(key);
      this.tree();
    }));
    $$("[data-grade]", tree).forEach((el) => (el.onclick = () => pick({ grade: el.dataset.grade || null })));
    $$("[data-c]", tree).forEach((el) => (el.onclick = () => pick({ className: el.dataset.c || null })));
    $$("[data-g]", tree).forEach((el) => (el.onclick = () => pick({ group: Number(el.dataset.g) })));
    onContext(tree, "[data-g]", (el) => {
      const g = d.groups.find((x) => x.id === Number(el.dataset.g));
      return [{ label: L("Rename…", "إعادة تسمية…"), run: () => groupBox(g) }, { label: L("Delete this club", "حذف هذا النادي"), run: async () => { await call("deleteGroup", g.id); if (ST.group === g.id) ST.group = null; undoToast(L("Club deleted", "حُذف النادي")); } }];
    });
    onContext(tree, "[data-c]", (el) => [
      { label: L("Set the class teacher…", "تعيين معلم الفصل…"), run: () => classTeacherBox(el.dataset.c) },
      { label: L("Class photos", "صور الفصل"), run: () => go("library", { className: el.dataset.c }) },
      { label: L("Coverage for this class", "التغطية لهذا الفصل"), run: () => go("coverage", { className: el.dataset.c }) },
    ]);
    $("#st-newg", tree).onclick = (e) => { e.stopPropagation(); groupBox(); };
    $("#st-dups", tree)?.addEventListener("click", duplicatesBox);
  },

  title() {
    const d = ST.tree;
    if (ST.left) return L("Left or graduated", "غادروا أو تخرّجوا");
    if (ST.group) return d?.groups.find((g) => g.id === ST.group)?.name ?? "";
    if (ST.className) return `${L("Class", "فصل")} ${ST.className}`;
    if (ST.grade) return ST.grade;
    if (ST.stage) return STAGES()[ST.stage] ?? ST.stage;
    return KIND_PLURAL()[ST.kind];
  },

  chips() {
    const el = $("#st-chips");
    if (!el) return;
    const list = [["", L("All", "الكل")], ["nophotos", L("No photos", "بلا صور")], ["notseen", L("Not seen in 3 weeks", "لم يظهروا منذ 3 أسابيع")], ["cantappear", L("Can't appear", "لا يظهرون")], ["missing", L("Missing info", "معلومات ناقصة")], ["birthday", L("Birthdays this month", "أعياد ميلاد هذا الشهر")], ["review", L("Faces to check", "وجوه للتأكيد")]];
    el.innerHTML = pills(ST.kind === "student" || ST.left ? list : list.filter(([v]) => ["", "nophotos", "missing", "review"].includes(v)), ST.chip, "data-chip");
    bindPills(el, "data-chip", (v) => { ST.chip = v; this.chips(); this.list(); });
  },

  async list() {
    const f = { kind: ST.kind, className: ST.className || undefined, stage: ST.stage || undefined, grade: ST.grade || undefined, group: ST.group || undefined, left: ST.left || undefined, search: ST.search || undefined, chip: ST.chip || undefined };
    const rows = (await quiet("studentList", f)) ?? [];
    const box = $("#st-list");
    if (!box) return;
    ST.rows = rows;
    const sub = $("#st-sub");
    if (sub) sub.textContent = `${this.title()} · ${plural(rows.length, "person", "people", "شخص")}`;
    const teacher = ST.className ? ST.tree?.teachers?.[ST.className] : null;
    box.innerHTML = `<div class="col gap12">
      ${ST.className ? `<div class="card"><div class="row"><div class="grow col gap4"><h2 style="margin: 0">${L("Class", "فصل")} ${esc(ST.className)}</h2>
          <span class="muted small">${teacher ? `${L("Class teacher", "معلم الفصل")}: <b>${esc(teacher.name)}</b>` : L("No class teacher set", "لم يُعيَّن معلم للفصل")} · <button class="link small" id="st-ct">${teacher ? L("Change", "تغيير") : L("Set", "تعيين")}</button></span></div>
          <button class="btn small" id="st-check">${icon("smartphone", 14)} ${L("Ask the class teacher", "اسأل معلم الفصل")}</button>
          <button class="btn small" id="st-cov">${icon("chart-pie", 14)} ${L("Coverage", "التغطية")}</button>
          <button class="btn small" id="st-cls">${icon("images", 14)} ${L("Class photos", "صور الفصل")}</button></div></div>` : ""}
      <div class="row" id="st-chips"></div>
      <div id="st-body"></div></div>`;
    this.chips();
    $("#st-ct", box)?.addEventListener("click", () => classTeacherBox(ST.className));
    $("#st-cov", box)?.addEventListener("click", () => go("coverage", { className: ST.className }));
    $("#st-cls", box)?.addEventListener("click", () => go("library", { className: ST.className }));
    $("#st-check", box)?.addEventListener("click", async () => {
      const r = await call("sendFaceChecks", ST.className);
      toast(r.sent ? L(`${r.sent} "Is this …?" questions sent to the class teacher's phone.`, `أُرسل ${num(r.sent)} سؤال «هل هذا …؟» إلى هاتف معلم الفصل.`) : L("Nothing to ask: no suggestions in photos already on the website.", "لا شيء للسؤال: لا اقتراحات في صور موجودة على الموقع."));
    });
    this.drawList();
  },

  drawList() {
    const box = $("#st-body");
    if (!box) return;
    const rows = ST.rows ?? [];
    if (!rows.length) {
      const none = !ST.search && !ST.chip && !ST.className && !ST.group && !ST.left && ST.kind === "student";
      box.innerHTML = none
        ? emptyState("graduation-cap", L("No students yet", "لا يوجد طلاب بعد"), L("Import the class list from Excel. Files from PowerSchool, Classera and Edunation are recognised.", "استورد قائمة الفصول من Excel. ملفات PowerSchool وClassera وEdunation معروفة."), `<button class="btn primary" id="e-imp">${L("Import class list", "استيراد قائمة الفصول")}</button>`)
        : emptyState("search", L("No one here", "لا أحد هنا"), ST.chip ? L("Try another filter.", "جرّب فلترًا آخر.") : "", ST.kind !== "student" ? `<button class="btn" id="e-add">${icon("plus", 14)} ${L(`Add ${KINDS()[ST.kind].toLowerCase()}`, `إضافة ${KINDS()[ST.kind]}`)}</button>` : "");
      $("#e-imp", box)?.addEventListener("click", () => importList());
      $("#e-add", box)?.addEventListener("click", () => editPerson(null, { kind: ST.kind }));
      this.bar();
      return;
    }
    const miss = (r) => (r.missing.length ? `<span class="warnic" title="${esc(r.missing.map((m) => MISSING()[m]).join(" · "))}">${icon("triangle-alert", 12)}</span>` : "");
    const sub = (r) => (r.kind === "student" ? r.class_name ?? "" : KINDS()[r.kind] ?? "");
    if (ST.view === "grid") {
      box.innerHTML = `<div class="people">${rows.map((r) => `<div class="person ${r.can_post ? "" : "off"} ${ST.sel.has(r.id) ? "sel" : ""}" data-id="${esc(r.id)}">
          <span class="ptick">${icon("check", 11)}</span>${faceImg(r, true)}
          <b class="small">${esc(name(r))}</b>${otherName(r) ? `<span class="tiny muted" dir="auto">${esc(otherName(r))}</span>` : ""}
          <span class="tiny muted row nowrap" style="gap: 5px; justify-content: center">${dot(r.photos)}${esc(sub(r))}${miss(r)}</span>
          ${!r.can_post ? `<span class="tag bad tiny">${L("Can't appear", "لا يظهر")}</span>` : r.left_on ? `<span class="tag tiny">${r.left_why === "graduated" ? L("Graduated", "تخرّج") : L("Left", "غادر")} ${esc(r.left_on.slice(0, 4))}</span>` : r.suggested ? `<span class="badge">${L(`${r.suggested} to check`, `${num(r.suggested)} للتأكيد`)}</span>` : ""}</div>`).join("")}</div>`;
    } else {
      box.innerHTML = `<table class="list"><thead><tr><th style="width: 28px"></th><th></th><th>${L("Name", "الاسم")}</th><th>${L("Class", "الفصل")}</th><th>${L("ID", "الرقم")}</th><th>${L("Photos", "الصور")}</th><th>${L("Last seen", "آخر ظهور")}</th><th>${L("Clubs", "الأندية")}</th><th>${L("In posts", "في المنشورات")}</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="click ${ST.sel.has(r.id) ? "on" : ""}" data-id="${esc(r.id)}"><td><input type="checkbox" data-tick ${ST.sel.has(r.id) ? "checked" : ""} /></td><td style="width: 44px">${faceImg(r)}</td>
          <td><b>${esc(name(r))}</b> ${miss(r)}${otherName(r) ? `<div class="small muted" dir="auto">${esc(otherName(r))}</div>` : ""}</td><td>${esc(sub(r))}</td><td class="muted ltr">${esc(r.id)}</td>
          <td>${dot(r.photos)} ${num(r.photos)}${r.suggested ? ` <span class="tag warn">? ${num(r.suggested)}</span>` : ""}</td><td class="muted small">${esc(dayLabel(r.last_seen))}</td><td class="small">${esc(r.clubs ?? "")}</td>
          <td>${r.can_post ? `<span class="tag good">${L("Yes", "نعم")}</span>` : `<span class="tag bad">${L("No", "لا")}</span>`}</td></tr>`).join("")}</tbody></table>`;
    }
    $$("[data-id]", box).forEach((el) => (el.onclick = (e) => {
      const id = el.dataset.id;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.target.closest("[data-tick], .ptick") || ST.sel.size) {
        if (e.shiftKey && ST.last) {
          const ids = rows.map((r) => r.id);
          const [a, b] = [ids.indexOf(ST.last), ids.indexOf(id)].sort((x, y) => x - y);
          ids.slice(a, b + 1).forEach((x) => ST.sel.add(x));
        } else ST.sel.has(id) ? ST.sel.delete(id) : ST.sel.add(id);
        ST.last = id;
        return this.drawList();
      }
      go("student", { id });
    }));
    onContext(box, "[data-id]", (el) => {
      const r = rows.find((x) => x.id === el.dataset.id);
      if (!ST.sel.has(r.id)) { ST.sel.clear(); ST.sel.add(r.id); this.drawList(); }
      return this.bulkItems([...ST.sel]);
    });
    this.bar();
  },

  bulkItems(ids) {
    const groups = ST.tree?.groups ?? [];
    const one = ids.length === 1 ? (ST.rows ?? []).find((r) => r.id === ids[0]) : null;
    return [
      one && { label: L("Open", "فتح"), run: () => go("student", { id: one.id }) },
      one && { label: L("Edit details…", "تعديل البيانات…"), run: () => editPerson(one.id) },
      one && "-",
      { label: L("Move to class…", "نقل إلى فصل…"), run: () => moveToClass(ids) },
      { label: L("Can appear in posts", "يمكن الظهور في المنشورات"), sub: [{ label: L("Yes", "نعم"), run: () => this.bulk(ids, "canPost", true) }, { label: L("No", "لا"), run: () => this.bulk(ids, "canPost", false) }] },
      { label: L("Add to club or team", "إضافة إلى نادٍ أو فريق"), sub: [...groups.map((g) => ({ label: g.name, run: () => this.bulk(ids, "group", g.id) })), groups.length ? "-" : null, { label: L("New club or team…", "نادٍ أو فريق جديد…"), run: () => groupBox(null, ids) }].filter(Boolean) },
      ST.group && { label: L("Remove from this club", "إزالة من هذا النادي"), run: () => this.bulk(ids, "ungroup", ST.group) },
      { label: L("Is a…", "نوعه…"), sub: Object.entries(KINDS()).map(([k, l]) => ({ label: l, run: () => this.bulk(ids, "kind", k) })) },
      "-",
      ST.left ? { label: L("Back at school", "عاد إلى المدرسة"), run: () => this.bulk(ids, "back") } : { label: L("Mark as left", "تسجيل المغادرة"), run: () => this.bulk(ids, "left", "left") },
    ];
  },
  async bulk(ids, op, value) {
    const n = await call("bulkStudents", ids, op, value);
    ST.sel.clear();
    undoToast(L(`${n} changed`, `تم تغيير ${num(n)}`));
    this.tree();
    this.list();
  },
  bar() {
    const el = $("#st-bar");
    if (!el) return;
    if (!ST.sel.size) return (el.innerHTML = "");
    el.innerHTML = `<div class="selbar"><b>${L(`${ST.sel.size} selected`, `${num(ST.sel.size)} محدد`)}</b>
      <button class="btn ghost small" id="sb-class">${icon("school", 14)} ${L("Move to class", "نقل إلى فصل")}</button>
      <button class="btn ghost small" id="sb-club">${icon("star", 14)} ${L("Add to club", "إضافة إلى نادٍ")}</button>
      <button class="btn ghost small" id="sb-more">${icon("ellipsis", 14)}</button>
      <button class="btn ghost small" id="sb-x" title="Esc">${icon("x", 14)}</button></div>`;
    const ids = [...ST.sel];
    $("#sb-class", el).onclick = () => moveToClass(ids);
    $("#sb-club", el).onclick = () => menu(this.bulkItems(ids).find((x) => x && x.sub && x.label.includes(L("club", "نادٍ")))?.sub ?? []);
    $("#sb-more", el).onclick = () => menu(this.bulkItems(ids));
    $("#sb-x", el).onclick = () => { ST.sel.clear(); this.drawList(); };
  },
};

function moveToClass(ids) {
  const classes = (ST.tree?.classes ?? []).map((c) => c.class_name).filter(Boolean);
  const m = modal(`<h2>${L(`Move ${ids.length} to a class`, `نقل ${num(ids.length)} إلى فصل`)}</h2>
    <label class="field">${L("Class", "الفصل")}<input id="mc" list="mc-l" autofocus /><datalist id="mc-l">${classes.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes>${L("Move", "نقل")}</button></div>`);
  $("[data-no]", m).onclick = closeOverlay;
  const go_ = async () => { const v = $("#mc", m).value.trim(); if (!v) return; closeOverlay(); await App.views.students.bulk(ids, "class", v); };
  $("[data-yes]", m).onclick = go_;
  $("#mc", m).onkeydown = (e) => e.key === "Enter" && go_();
}

function groupBox(g = null, addIds = null) {
  const m = modal(`<h2>${g ? L("Rename club or team", "إعادة تسمية النادي أو الفريق") : L("New club or team", "نادٍ أو فريق جديد")}</h2>
    <label class="field">${L("Name", "الاسم")}<input id="g-n" value="${esc(g?.name ?? "")}" placeholder="${esc(L("Football team, Choir, Robotics club…", "فريق كرة القدم، الكورال، نادي الروبوت…"))}" /></label>
    <label class="field">${L("Kind", "النوع")}<select id="g-k"><option value="club" ${g?.kind !== "team" ? "selected" : ""}>${L("Club", "نادٍ")}</option><option value="team" ${g?.kind === "team" ? "selected" : ""}>${L("Team", "فريق")}</option></select></label>
    <p class="muted small">${L("Clubs and teams work like classes: their own coverage, albums and posts.", "تعمل الأندية والفرق مثل الفصول: لها تغطيتها وألبوماتها ومنشوراتها.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes>${L("Save", "حفظ")}</button></div>`);
  $("[data-no]", m).onclick = closeOverlay;
  $("[data-yes]", m).onclick = async () => {
    const id = await call("saveGroup", { id: g?.id, name: $("#g-n", m).value, kind: $("#g-k", m).value });
    if (!id) return $("#g-n", m).focus();
    closeOverlay();
    if (addIds?.length) await call("bulkStudents", addIds, "group", id);
    ST.sel.clear();
    App.views.students.tree?.();
    App.views.students.list?.();
  };
}

async function classTeacherBox(className) {
  pickStudent(L(`Class teacher of ${className}`, `معلم فصل ${className}`), async (t) => {
    await call("setClassTeacher", className, t.id);
    undoToast(L(`${name(t)} is the class teacher of ${className}. They see this class's coverage on their phone.`, `${name(t)} معلم فصل ${className}. يرى تغطية هذا الفصل على هاتفه.`));
    if (App.view === "students") (App.views.students.tree(), App.views.students.list());
    else rerender();
  }, { kind: "teacher" });
}

// ---------- Add or edit a person ----------
async function editPerson(id, preset = {}) {
  const p = id ? (await call("profile", id))?.student : { kind: ST.kind ?? "student", class_name: ST.className ?? "", ...preset };
  if (!p) return;
  const kind = p.kind ?? "student";
  const f = (k, label, type = "text", extra = "") => `<label class="field">${label}<input data-f="${k}" type="${type}" value="${esc(p[k] ?? "")}" ${extra} /></label>`;
  const m = modal(`<h2>${id ? L("Edit details", "تعديل البيانات") : L("Add someone", "إضافة شخص")}</h2>
    <div class="grid2">${f("name_en", L("Name in English", "الاسم بالإنجليزية"))}${f("name_ar", L("Name in Arabic", "الاسم بالعربية"), "text", 'dir="rtl"')}</div>
    <div class="grid2"><label class="field">${L("Is a", "النوع")}<select data-f="kind">${Object.entries(KINDS()).map(([k, l]) => `<option value="${k}" ${k === kind ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${id ? `<label class="field">${L("ID", "الرقم")}<input value="${esc(p.id)}" disabled class="ltr" /></label>` : f("id", L("Student ID (optional)", "رقم الطالب (اختياري)"))}</div>
    <div class="grid2" data-only="student">${f("class_name", L("Class", "الفصل"))}${f("grade", L("Grade", "الصف"))}</div>
    <div class="grid2">${f("birthday", L("Birthday", "تاريخ الميلاد"), "date")}${f("joined", L("Joined the school", "التحق بالمدرسة"), "date")}</div>
    <div class="grid2" data-only="contact">${f("email", L("Email", "البريد"), "email")}${f("phone", L("Phone", "الهاتف"), "tel")}</div>
    ${id ? `<div class="grid2">${f("left_on", L("Left on", "غادر في"), "date")}<label class="field">${L("Why", "السبب")}<select data-f="left_why"><option value="">—</option><option value="left" ${p.left_why === "left" ? "selected" : ""}>${L("Left the school", "غادر المدرسة")}</option><option value="graduated" ${p.left_why === "graduated" ? "selected" : ""}>${L("Graduated", "تخرّج")}</option></select></label></div>` : ""}
    <label class="field">${L("Notes", "ملاحظات")}<textarea data-f="notes" rows="2">${esc(p.notes ?? "")}</textarea></label>
    <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes>${id ? L("Save", "حفظ") : L("Add", "إضافة")}</button></div>`, { wide: true });
  const shown = () => {
    const k = $('[data-f="kind"]', m).value;
    $('[data-only="student"]', m).style.display = k === "student" ? "" : "none";
    $('[data-only="contact"]', m).style.display = k === "student" ? "none" : "";
  };
  $('[data-f="kind"]', m).onchange = shown;
  shown();
  $("[data-no]", m).onclick = closeOverlay;
  $("[data-yes]", m).onclick = async () => {
    const v = Object.fromEntries($$("[data-f]", m).map((el) => [el.dataset.f, el.value.trim()]));
    if ((v.name_en || v.name_ar).length < 2) return $('[data-f="name_en"]', m).focus();
    closeOverlay();
    if (id) {
      await call("saveStudent", id, v);
      undoToast(L("Saved", "تم الحفظ"));
      rerender();
    } else {
      const nid = await call("addStudent", { id: v.id, name_en: v.name_en, name_ar: v.name_ar, class_name: v.class_name, kind: v.kind });
      const rest = Object.fromEntries(Object.entries(v).filter(([k, x]) => x && !["id", "name_en", "name_ar", "class_name", "kind"].includes(k)));
      if (Object.keys(rest).length) await call("saveStudent", nid, rest);
      go("student", { id: nid });
    }
  };
}

// ---------- New school year ----------
async function newYear() {
  const p = await call("promotePlan");
  const m = modal(`<h2>${L(`New school year: ${p.next}`, `عام دراسي جديد: ${p.next}`)}</h2>
    <p class="muted">${L(`Everyone's class for ${p.year} is kept in their school history (for yearbooks and "my years" pages), then they move up. Change any class below before you apply. Those graduating are kept as graduated, out of the current lists.`, `يُحفظ فصل كل طالب لعام ${p.year} في سجله المدرسي (للكتب السنوية وصفحات «سنواتي»)، ثم ينتقلون للصف التالي. غيّر أي فصل أدناه قبل التطبيق. يبقى المتخرجون محفوظين كمتخرجين خارج القوائم الحالية.`)}</p>
    ${p.alreadyDone ? `<div class="note warn small">${L(`The new year was already applied once for ${p.year}. Applying again moves everyone up another class.`, `طُبّق العام الجديد مرة لعام ${p.year}. التطبيق مرة أخرى ينقل الجميع صفًا آخر.`)}</div>` : ""}
    <div style="max-height: 50vh; overflow-y: auto"><table class="list"><thead><tr><th>${L("Now", "الآن")}</th><th>${L("Students", "الطلاب")}</th><th>${L("Next year", "العام القادم")}</th><th>${L("Graduate", "يتخرّج")}</th></tr></thead><tbody>
      ${p.classes.map((c, i) => `<tr><td><b>${esc(c.from ?? "—")}</b></td><td>${num(c.n)}</td><td><input data-to="${i}" value="${esc(c.class_name ?? "")}" ${c.graduates ? "disabled" : ""} style="width: 120px" /></td><td><input type="checkbox" data-grad="${i}" ${c.graduates ? "checked" : ""} /></td></tr>`).join("")}</tbody></table></div>
    <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes>${L("Move everyone up", "نقل الجميع")}</button></div>`, { wide: true, sticky: true });
  $$("[data-grad]", m).forEach((b) => (b.onchange = () => ($(`[data-to="${b.dataset.grad}"]`, m).disabled = b.checked)));
  $("[data-no]", m).onclick = closeOverlay;
  $("[data-yes]", m).onclick = async () => {
    const plan = p.classes.map((c, i) => ({ from: c.from, to: $(`[data-to="${i}"]`, m).value.trim() || c.from, graduates: $(`[data-grad="${i}"]`, m).checked }));
    closeOverlay();
    const r = await call("promote", plan);
    undoToast(L(`Done: ${r.moved} students moved up for ${p.next}.`, `تم: انتقل ${num(r.moved)} طالب إلى ${p.next}.`));
    rerender();
  };
}

// ---------- Entered twice ----------
async function duplicatesBox() {
  const pairs = (await call("studentDuplicates")) ?? [];
  const card = (s) => `<div class="col gap4" style="align-items: center; flex: 1">${faceImg(s, true)}<b>${esc(name(s))}</b><span class="tiny muted">${esc(otherName(s))}</span><span class="small muted ltr">${esc(s.id)}</span><span class="small">${esc(s.class_name ?? KINDS()[s.kind] ?? "")} · ${plural(s.faces ?? 0, "face", "faces", "وجه")}</span></div>`;
  const m = modal(`<div class="row"><h2 class="grow">${L("Students entered twice?", "طلاب مسجّلون مرتين؟")}</h2><button class="btn ghost" data-x>${icon("x")}</button></div>
    ${pairs.length ? `<p class="muted small">${L("Same name by spelling, different IDs. Merging moves every face, photo, parent, club and award to the one you keep.", "نفس الاسم بتهجئة مختلفة وأرقام مختلفة. الدمج ينقل كل الوجوه والصور وأولياء الأمور والأندية والجوائز إلى من تُبقيه.")}</p>
    <div class="col gap12" style="max-height: 60vh; overflow-y: auto">${pairs.map(([a, b], i) => `<div class="card row nowrap" data-pair="${i}">${card(a)}<div class="col gap4" style="min-width: 170px">
        <button class="btn small" data-keep="a">${L("Same person: keep left", "نفس الشخص: أبقِ الأيسر")}</button>
        <button class="btn small" data-keep="b">${L("Same person: keep right", "نفس الشخص: أبقِ الأيمن")}</button>
        <button class="btn small ghost" data-diff>${L("Not the same", "ليسا نفس الشخص")}</button></div>${card(b)}</div>`).join("")}</div>` : emptyState("circle-check", L("No one is entered twice", "لا أحد مسجّل مرتين"))}`, { wide: true });
  $("[data-x]", m).onclick = closeOverlay;
  $$("[data-pair]", m).forEach((row) => {
    const [a, b] = pairs[Number(row.dataset.pair)];
    $$("[data-keep]", row).forEach((btn) => (btn.onclick = async () => {
      const [keep, drop] = btn.dataset.keep === "a" ? [a, b] : [b, a];
      if (!(await confirmBox(L(`Merge ${name(drop)} (${drop.id}) into ${name(keep)} (${keep.id})? This can't be undone.`, `دمج ${name(drop)} (${drop.id}) في ${name(keep)} (${keep.id})؟ لا يمكن التراجع.`), L("Merge", "دمج")))) return duplicatesBox();
      await call("mergeStudents", keep.id, drop.id);
      toast(L("Merged", "تم الدمج"));
      duplicatesBox();
    }));
    $("[data-diff]", row).onclick = async () => { await call("notSame", a.id, b.id); row.remove(); };
  });
}

const FORMAT_NAMES = { hub: "School Social Hub", powerschool: "PowerSchool", classera: "Classera", edunation: "Edunation", other: "" };

// The class list: what it will change is shown first (new, moved class,
// renamed, no longer on the list, back again), then applied.
async function importList(file) {
  let p;
  try {
    p = await call("previewStudents", file);
  } catch {
    return;
  }
  if (!p) return;
  let portraits = null;
  const c = p.changes ?? { added: [], moved: [], renamed: [], left: [], back: [] };
  const first = p.isNew === p.count && !c.moved.length;
  const listOf = (rows, fmt) => `<div class="small" style="max-height: 120px; overflow-y: auto; columns: 2">${rows.slice(0, 200).map((r) => `<div>${fmt(r)}</div>`).join("")}${rows.length > 200 ? "…" : ""}</div>`;
  const section = (key, title, rows, fmt, cls = "") => (rows.length ? `<details class="card tight ${cls}" ${rows.length < 12 ? "open" : ""}><summary><b>${title}</b> <span class="tag">${num(rows.length)}</span></summary>${listOf(rows, fmt)}${key === "left" ? `<label class="check" style="margin-top: 8px"><input type="checkbox" id="i-left" checked /> ${L("Mark them as left (they stay in past years and their books, out of current lists and coverage)", "سجّلهم كمغادرين (يبقون في الأعوام السابقة وكتبهم، وخارج القوائم الحالية والتغطية)")}</label>` : ""}</details>` : "");
  const m = modal(`<h2>${L("Import class list", "استيراد قائمة الفصول")}</h2>
    <div class="row"><b>${esc(p.file)}</b>${p.format !== "other" ? `<span class="tag good">${icon("check", 12)} ${L("Recognised", "تم التعرّف")}: ${FORMAT_NAMES[p.format]}</span>` : `<span class="tag">${L("Read by column names", "قُرئ حسب أسماء الأعمدة")}</span>`}</div>
    ${p.count ? `<p>${L(`${num(p.count)} people in ${num(p.classes.length)} classes`, `${num(p.count)} شخص في ${num(p.classes.length)} فصل`)}${p.skipped ? ` · <span class="muted">${L(`${num(p.skipped)} rows skipped`, `تم تخطي ${num(p.skipped)} صف`)}</span>` : ""}</p>` : `<div class="note bad">${L("No students found. The file needs at least a name column.", "لم يتم العثور على طلاب. يحتاج الملف على الأقل إلى عمود للاسم.")}</div>`}
    ${first ? `<div class="row">${p.classes.slice(0, 40).map((x) => `<span class="tag">${esc(x.name)} · ${num(x.n)}</span>`).join("")}${p.classes.length > 40 ? "…" : ""}</div>
      <table class="list small"><thead><tr><th>${L("ID", "الرقم")}</th><th>${L("English", "بالإنجليزية")}</th><th>${L("Arabic", "بالعربية")}</th><th>${L("Class", "الفصل")}</th><th>${L("In posts", "في المنشورات")}</th></tr></thead>
      <tbody>${p.sample.map((s) => `<tr><td class="ltr">${esc(s.id)}</td><td>${esc(s.name_en ?? "")}</td><td dir="rtl">${esc(s.name_ar ?? "")}</td><td>${esc(s.class_name ?? "")}</td><td>${s.can_post ? "✓" : "—"}</td></tr>`).join("")}</tbody></table>`
    : `<h3>${L("What changes", "ما الذي سيتغيّر")}</h3><div class="col gap8">
      ${section("added", L("New", "جدد"), c.added, (s) => `${esc(name(s))} <span class="muted">${esc(s.class_name ?? "")}</span>`)}
      ${section("moved", L("Moved class", "انتقلوا من فصل"), c.moved, (s) => `${esc(s.name)} <span class="muted">${esc(s.from ?? "—")} → ${esc(s.to ?? "—")}</span>`)}
      ${section("renamed", L("Name changed", "تغيّر الاسم"), c.renamed, (s) => `<span class="muted">${esc(s.from)}</span> → ${esc(s.to)}`)}
      ${section("back", L("Back at school", "عادوا إلى المدرسة"), c.back, (s) => esc(s.name))}
      ${section("left", L("No longer on the list", "لم يعودوا في القائمة"), c.left, (s) => `${esc(s.name)} <span class="muted">${esc(s.class_name ?? "")}</span>`, "warnbox")}
      ${!c.added.length && !c.moved.length && !c.renamed.length && !c.left.length && !c.back.length ? `<div class="note good small">${L("Nothing changes: the list on this Mac is already up to date.", "لا شيء يتغيّر: القائمة على هذا الماك محدّثة.")}</div>` : ""}</div>`}
    <div class="card tight"><div class="row"><div class="grow"><b>${L("Portraits (optional)", "الصور الشخصية (اختياري)")}</b><div class="small muted" id="pf">${L("A folder of student photos named by ID, like S24001.jpg. The Mac learns each face from them.", "مجلد صور الطلاب بأسماء أرقامهم، مثل S24001.jpg. يتعلّم الماك كل وجه منها.")}</div></div><button class="btn small" id="pick-pf">${L("Choose folder", "اختيار مجلد")}</button></div></div>
    <p class="muted small">${L("The list stays on this Mac. Names and “in posts” are also sent to your website so it can stop a post with a student who mustn't appear. You can undo the import.", "تبقى القائمة على هذا الماك. تُرسل الأسماء و«في المنشورات» إلى موقعك أيضًا ليمنع نشر صورة طالب لا يجب أن يظهر. يمكنك التراجع عن الاستيراد.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="i-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="i-yes" ${p.count ? "" : "disabled"}>${first ? L(`Import ${p.count} people`, `استيراد ${num(p.count)} شخص`) : L("Apply changes", "تطبيق التغييرات")}</button></div>`, { wide: true });
  $("#i-no", m).onclick = closeOverlay;
  $("#pick-pf", m).onclick = async () => {
    const dir = await call("pickPortraits");
    if (dir) {
      portraits = dir;
      $("#pf", m).innerHTML = `${icon("check", 12)} <span class="ltr">${esc(dir)}</span>`;
    }
  };
  $("#i-yes", m).onclick = async () => {
    $("#i-yes", m).disabled = true;
    $("#i-yes", m).textContent = portraits ? L("Importing and reading portraits…", "جارٍ الاستيراد وقراءة الصور الشخصية…") : L("Importing…", "جارٍ الاستيراد…");
    try {
      const r = await call("commitStudents", portraits, { markLeft: !!$("#i-left", m)?.checked });
      closeOverlay();
      const web = typeof r.web === "number" && r.web ? L(" Sent to the website too.", " وأُرسلت إلى الموقع أيضًا.") : typeof r.web === "string" ? L(" (Couldn't send to the website.)", " (تعذّر الإرسال إلى الموقع.)") : "";
      const parts = first ? L(`${r.saved} people imported`, `تم استيراد ${num(r.saved)} شخص`) : L(`${r.added} new, ${r.moved} moved class${r.left ? `, ${r.left} marked as left` : ""}`, `${num(r.added)} جديد، ${num(r.moved)} انتقلوا${r.left ? `، ${num(r.left)} غادروا` : ""}`);
      toastAction(parts + (r.portraits ? L(`, ${r.portraits} portraits learned.`, `، وتعلّم ${num(r.portraits)} صورة شخصية.`) : ".") + web, L("Undo", "تراجع"), () => doUndo(), 9000);
      if (App.view === "students") (App.views.students.tree(), App.views.students.list());
    } catch {
      $("#i-yes", m).disabled = false;
    }
  };
}

// ---------- One person's page ----------
// Their face and names, how often they appear, their photos as a timeline by
// school year and event, face examples (right-click one to make it the main
// photo), parents, brothers and sisters, years at school, clubs, awards and
// notes. Teachers see the classes they teach; parents see their students.
App.views.student = {
  async render(main, params) {
    if (params.id == null) return go("students");
    const d = await call("profile", params.id);
    if (!d) return go("students");
    const s = d.student;
    const isStudent = (s.kind ?? "student") === "student";
    const review = (await quiet("people", { kind: s.kind ?? "student", left: true }))?.find((p) => p.id === s.id)?.review ?? 0;
    const subtitle = isStudent ? [s.class_name, s.grade, STAGES()[s.stage] ?? s.stage].filter(Boolean).join(" · ") : KINDS()[s.kind];
    main.innerHTML = topbar(esc(name(s)), esc(subtitle),
      `<button class="btn" id="sp-back">${icon("chevron-left", 14)} ${isStudent ? L("Students", "الطلاب") : KIND_PLURAL()[s.kind]}</button>
       <button class="btn" id="sp-edit">${icon("pencil", 14)} ${L("Edit details", "تعديل البيانات")}</button>
       <button class="btn" id="sp-lib">${icon("images", 14)} ${L("Open in Library", "فتح في المكتبة")}</button>
       <button class="btn primary" id="sp-post">${icon("pen-line", 14)} ${L("Make a post", "إنشاء منشور")}</button>`) +
      `<div class="content"><div class="profile">
        <div class="col gap16" style="min-width: 0">
          <div class="card"><div class="row nowrap phead" style="gap: 16px">${faceImg(s, true)}<div class="grow col gap4">
              <b style="font-size: 19px" dir="auto">${esc(name(s))}</b>${otherName(s) ? `<span class="muted" dir="auto" style="font-size: 15px; align-self: flex-start">${esc(otherName(s))}</span>` : ""}
              <span class="muted small"><span class="ltr">${esc(s.id)}</span>${s.left_on ? ` · <span class="tag">${s.left_why === "graduated" ? L("Graduated", "تخرّج") : L("Left", "غادر")} ${esc(dayLabel(s.left_on))}</span>` : ""}</span>
              ${s.missing.length ? `<div class="row" style="gap: 4px">${s.missing.map((k) => `<span class="tag warn tiny">${icon("triangle-alert", 11)} ${esc(MISSING()[k])}</span>`).join("")}</div>` : ""}</div>
            <div class="col gap4" style="align-items: flex-end"><label class="row nowrap small" style="gap: 8px"><b>${L("Can appear in posts", "يمكن أن يظهر في المنشورات")}</b>${sw('id="sp-can"', s.can_post)}</label>
              <span class="tiny muted" style="max-width: 260px; text-align: end">${L("If off, the website blocks (or blurs) them in any post.", "إذا أُوقف، يمنعه الموقع (أو يموّهه) في أي منشور.")}</span></div></div></div>
          <div class="grid4">
            <div class="card stat"><b>${num(d.counts?.photos ?? 0)}</b><span>${L("photos", "صورة")}</span></div>
            <div class="card stat"><b>${num(d.counts?.posted ?? 0)}</b><span>${L("in posts", "في منشورات")}</span></div>
            <div class="card stat"><b style="font-size: 16px">${esc(dayLabel(d.counts?.last) || "—")}</b><span>${L("last seen", "آخر ظهور")}</span></div>
            <div class="card stat"><b style="font-size: 16px">${num(d.events.length)}</b><span>${L("events", "فعالية")}</span></div></div>
          ${review ? `<div class="note warn row"><span class="grow">${L(`${review} faces might be ${name(s)}.`, `${num(review)} وجه قد يكون ${name(s)}.`)}</span><button class="btn small primary" id="sp-review">${L("Check them", "تأكيدها")}</button></div>` : ""}
          <div class="card"><h2>${L("Photos by event", "الصور حسب الفعالية")}</h2>
            ${d.events.length ? timeline(d.events) : `<p class="muted">${L("No photos yet. Name them in a photo, or add their portrait so the Mac can find them.", "لا صور بعد. سمّه في صورة، أو أضف صورته الشخصية ليجده الماك.")}</p>`}</div>
        </div>
        <aside class="col gap12">
          ${side(L("About", "عن"), `<div class="kv">
            ${s.birthday ? `<span>${L("Birthday", "الميلاد")}</span><b>${esc(dayLabel(s.birthday))}</b>` : ""}
            ${s.joined ? `<span>${L("Joined", "التحق")}</span><b>${esc(dayLabel(s.joined))}</b>` : ""}
            ${d.counts?.first ? `<span>${L("First photo", "أول صورة")}</span><b>${esc(dayLabel(d.counts.first))}</b>` : ""}
            ${s.campus ? `<span>${L("Campus", "الفرع")}</span><b>${esc(s.campus)}</b>` : ""}
            ${s.email ? `<span>${L("Email", "البريد")}</span><b class="ltr">${esc(s.email)}</b>` : ""}
            ${s.phone ? `<span>${L("Phone", "الهاتف")}</span><b class="ltr">${esc(s.phone)}</b>` : ""}
            ${isStudent && d.teacher ? `<span>${L("Class teacher", "معلم الفصل")}</span><b>${esc(name(d.teacher))}</b>` : ""}
            ${d.teaches.length ? `<span>${L("Class teacher of", "معلم فصل")}</span><b>${esc(d.teaches.join(", "))}</b>` : ""}</div>
            <textarea id="sp-notes" rows="2" placeholder="${esc(L("Notes (only on this Mac)…", "ملاحظات (على هذا الماك فقط)…"))}">${esc(s.notes ?? "")}</textarea>`)}
          ${isStudent ? side(L("Years at school", "السنوات في المدرسة"), `<div class="kv">${d.history.map((h) => `<span>${esc(h.year)}</span><b>${esc(h.class_name ?? "—")}</b>`).join("")}${s.left_on ? "" : `<span>${esc(d.year)}</span><b>${esc(s.class_name ?? "—")}</b>`}</div>`) : ""}
          ${isStudent ? side(L("Parents", "أولياء الأمور"), people(d.parents, "parent"), `<button class="btn ghost tiny" id="sp-addpar">${icon("plus", 12)}</button>`) : ""}
          ${!isStudent && (s.kind === "parent" || d.parentOf.length) ? side(L("Parent of", "ولي أمر"), people(d.parentOf, "parentOf"), `<button class="btn ghost tiny" id="sp-addkid">${icon("plus", 12)}</button>`) : ""}
          ${isStudent ? side(L("Brothers and sisters", "الإخوة والأخوات"), people(d.siblings, "sibling"), `<button class="btn ghost tiny" id="sp-addsib">${icon("plus", 12)}</button>`) : ""}
          ${side(L("Clubs and teams", "الأندية والفرق"), d.groups.length ? `<div class="row" style="gap: 4px">${d.groups.map((g) => `<span class="tag" data-grp="${g.id}">${esc(g.name)} <button class="x" data-ungrp="${g.id}">×</button></span>`).join("")}</div>` : `<span class="muted small">${L("None yet", "لا شيء بعد")}</span>`, `<button class="btn ghost tiny" id="sp-addgrp">${icon("plus", 12)}</button>`)}
          ${isStudent ? side(L("Achievements and awards", "الإنجازات والجوائز"), d.achievements.length ? `<div class="col gap4">${d.achievements.map((a) => `<div class="row nowrap small"><span>${icon("award", 13)}</span><span class="grow"><b>${esc(a.title)}</b> <span class="muted">${esc(dayLabel(a.on_date))}</span></span><button class="btn ghost tiny" data-awpost="${a.id}" title="${esc(L("Make a post", "إنشاء منشور"))}">${icon("pen-line", 12)}</button><button class="btn ghost tiny" data-awdel="${a.id}">${icon("x", 12)}</button></div>`).join("")}</div>` : `<span class="muted small">${L("Student of the month, competitions, certificates…", "طالب الشهر، المسابقات، الشهادات…")}</span>`, `<button class="btn ghost tiny" id="sp-addaw">${icon("plus", 12)}</button>`) : ""}
          ${d.examples.length ? side(L("Face examples", "أمثلة الوجه"), `<div class="faces small">${d.examples.map((f) => `<div class="face ${f.id === s.face ? "on" : ""}" data-ex="${f.id}" data-photo="${f.photo_id}"><img loading="lazy" src="hub://face/${f.id}" /></div>`).join("")}</div><p class="tiny muted" style="margin: 6px 0 0">${L("Right-click a face to make it the main photo.", "انقر بزر الفأرة الأيمن على وجه لجعله الصورة الرئيسية.")}</p>`) : ""}
          <button class="btn ghost small danger" id="sp-del" style="align-self: flex-start">${L("Remove from the list…", "إزالة من القائمة…")}</button>
        </aside></div></div>`;

    const reload = () => this.render(main, params);
    $("#sp-back", main).onclick = () => go("students", isStudent ? {} : { kind: s.kind });
    $("#sp-edit", main).onclick = () => editPerson(s.id);
    $("#sp-lib", main).onclick = () => go("library", { student: s.id });
    $("#sp-post", main).onclick = () => (typeof makePostsFrom === "function" ? makePostsFrom({ student: s.id }, name(s)) : go("library", { student: s.id }));
    $("#sp-review", main)?.addEventListener("click", () => go("faces", { tab: "review", students: [s.id] }));
    $("#sp-can", main).onchange = async (e) => {
      await call("setCanPost", s.id, e.target.checked);
      undoToast(e.target.checked ? L("Can appear in posts", "يمكن أن يظهر في المنشورات") : L("Won't appear in posts", "لن يظهر في المنشورات"));
    };
    let nt;
    $("#sp-notes", main).oninput = (e) => { clearTimeout(nt); nt = setTimeout(() => call("saveStudent", s.id, { notes: e.target.value }), 600); };
    $$("[data-ev]", main).forEach((b) => (b.onclick = () => go("library", { event: b.dataset.ev || undefined, student: s.id })));
    $$("[data-ph]", main).forEach((t) => (t.onclick = () => {
      const ids = d.events.flatMap((e) => e.ids);
      openViewer(ids, ids.indexOf(Number(t.dataset.ph)), {});
    }));
    $$("[data-person]", main).forEach((el) => (el.onclick = (e) => !e.target.closest("[data-unlink]") && go("student", { id: el.dataset.person })));
    $$("[data-unlink]", main).forEach((b) => (b.onclick = async () => {
      const [kind, other] = b.dataset.unlink.split("|");
      if (kind === "parent") await call("linkPeople", other, s.id, "parent", false);
      else if (kind === "parentOf") await call("linkPeople", s.id, other, "parent", false);
      else await call("linkPeople", s.id, other, b.dataset.kind ?? "sibling", false);
      undoToast(L("Removed", "تمت الإزالة"));
      reload();
    }));
    $("#sp-addpar", main)?.addEventListener("click", () => pickStudent(L(`Parent of ${name(s)}`, `ولي أمر ${name(s)}`), async (p) => { await call("linkPeople", p.id, s.id, "parent", true); reload(); }, { kind: "parent", linkTo: s.id }));
    $("#sp-addkid", main)?.addEventListener("click", () => pickStudent(L(`${name(s)} is the parent of…`, `${name(s)} ولي أمر…`), async (p) => { await call("linkPeople", s.id, p.id, "parent", true); reload(); }));
    $("#sp-addsib", main)?.addEventListener("click", () => pickStudent(L(`Brother or sister of ${name(s)}`, `أخ أو أخت ${name(s)}`), async (p) => { await call("linkPeople", s.id, p.id, "sibling", true); reload(); }));
    $("#sp-addgrp", main)?.addEventListener("click", async () => {
      const t = await quiet("studentTree");
      menu([...(t?.groups ?? []).map((g) => ({ label: g.name, run: async () => { await call("bulkStudents", [s.id], "group", g.id); reload(); } })), "-", { label: L("New club or team…", "نادٍ أو فريق جديد…"), run: () => groupBox(null, [s.id]) }]);
    });
    $$("[data-ungrp]", main).forEach((b) => (b.onclick = async () => { await call("bulkStudents", [s.id], "ungroup", Number(b.dataset.ungrp)); reload(); }));
    $("#sp-addaw", main)?.addEventListener("click", () => {
      const m = modal(`<h2>${L("Add an achievement", "إضافة إنجاز")}</h2>
        <label class="field">${L("What", "ماذا")}<input id="aw-t" placeholder="${esc(L("Student of the month, 1st in the maths olympiad…", "طالب الشهر، الأول في أولمبياد الرياضيات…"))}" /></label>
        <label class="field">${L("When", "متى")}<input id="aw-d" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
        <div class="row"><span class="grow"></span><button class="btn" data-no>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-yes>${L("Add", "إضافة")}</button></div>`);
      $("[data-no]", m).onclick = closeOverlay;
      $("[data-yes]", m).onclick = async () => { const t = $("#aw-t", m).value.trim(); if (!t) return; closeOverlay(); await call("addAchievement", s.id, t, $("#aw-d", m).value); reload(); };
    });
    $$("[data-awdel]", main).forEach((b) => (b.onclick = async () => { await call("removeAchievement", Number(b.dataset.awdel)); undoToast(L("Removed", "تمت الإزالة")); reload(); }));
    $$("[data-awpost]", main).forEach((b) => (b.onclick = () => {
      const a = d.achievements.find((x) => x.id === Number(b.dataset.awpost));
      if (typeof makePostsFrom === "function") makePostsFrom({ student: s.id }, `${a.title}: ${name(s)}`, { notes: `${a.title} — ${name(s)} (${s.class_name ?? ""})` });
      else go("library", { student: s.id });
    }));
    onContext(main, "[data-ex]", (el) => [
      { label: L("Use as main photo", "استخدامه صورةً رئيسية"), run: async () => { await call("setMainFace", s.id, Number(el.dataset.ex)); reload(); } },
      { label: L("Show the photo", "عرض الصورة"), run: () => openViewer([Number(el.dataset.photo)], 0, {}) },
      "-",
      { label: L(`This isn't ${name(s)}`, `هذا ليس ${name(s)}`), run: async () => { await call("rejectFaces", [Number(el.dataset.ex)]); undoToast(L("Removed", "تمت الإزالة")); reload(); } },
    ]);
    $$("[data-ex]", main).forEach((el) => (el.onclick = () => openViewer([Number(el.dataset.photo)], 0, {})));
    $("#sp-del", main).onclick = async () => {
      if (!(await confirmBox(L(`Remove ${name(s)} from the list? Their faces become unnamed again.`, `إزالة ${name(s)} من القائمة؟ تعود وجوهه بلا أسماء.`), L("Remove", "إزالة")))) return;
      await call("removeStudent", s.id);
      go("students");
    };
  },
};

function side(title, body, action = "") {
  return `<div class="card side"><div class="row nowrap"><h3 class="grow" style="margin: 0">${title}</h3>${action}</div>${body}</div>`;
}
function people(list, kind) {
  if (!list.length) return `<span class="muted small">${L("None yet", "لا أحد بعد")}</span>`;
  return `<div class="col gap4">${list.map((p) => `<div class="trow" data-person="${esc(p.id)}">${faceImg(p)}<span class="grow"><b class="small">${esc(name(p))}</b> <span class="tiny muted">${esc(p.link === "twin" ? L("Twin", "توأم") : p.kind === "student" ? p.class_name ?? "" : KINDS()[p.kind] ?? "")}</span></span><button class="btn ghost tiny" data-unlink="${kind}|${esc(p.id)}" data-kind="${esc(p.link ?? "")}">${icon("x", 12)}</button></div>`).join("")}</div>`;
}
// School year → term → event, each with a strip of the best photos.
function timeline(events) {
  let year;
  return `<div class="tl">${events.map((e) => {
    const head = e.year && e.year !== year ? `<div class="tlyear">${esc(e.year)}</div>` : "";
    year = e.year ?? year;
    return `${head}<div class="tlev"><div class="row nowrap"><button class="link grow" data-ev="${esc(e.event_key ?? "")}" style="text-align: start"><b>${esc(e.event_title ? eventName(e.event_title, e.event_date) : L("No event", "بلا فعالية"))}</b></button><span class="tiny muted">${esc(e.term ?? "")} · ${plural(e.n, "photo", "photos", "صورة")}</span></div>
      <div class="tlstrip">${e.ids.map((id) => `<img loading="lazy" data-ph="${id}" src="hub://thumb/${id}" />`).join("")}</div></div>`;
  }).join("")}</div>`;
}
