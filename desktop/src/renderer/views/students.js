// Students: class lists by Stage → Grade → Class, the import, each student's page, and coverage.
const ST = { className: null, search: "" };
const STAGES = () => ({ KG: L("KG", "KG"), Primary: L("Primary", "ابتدائي"), Prep: L("Prep", "إعدادي"), Secondary: L("Secondary", "ثانوي") });

App.views.students = {
  render(main, params) {
    if (params.className !== undefined) ST.className = params.className;
    main.innerHTML = topbar(L("Students", "الطلاب"), `<span id="st-sub"></span>`,
      `<input type="search" id="st-q" placeholder="${L("Find a student…", "ابحث عن طالب…")}" value="${esc(ST.search)}" style="width: 200px" /><button class="btn" id="st-add">+ ${L("Add student", "إضافة طالب")}</button><button class="btn primary" id="st-imp">☷ ${L("Import class list", "استيراد قائمة الفصول")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree" id="st-tree"></nav><div class="gridwrap"><div class="content" id="st-list"></div></div></div></div>`;
    $("#st-imp", main).onclick = () => importList();
    $("#st-add", main).onclick = addStudent;
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
      ST.t = setTimeout(() => { this.tree(); this.list(); }, 1000);
    }
  },
  async tree() {
    const cls = (await quiet("classes")) ?? [];
    const tree = $("#st-tree");
    if (!tree) return;
    const total = cls.reduce((s, c) => s + c.n, 0);
    $("#st-sub").textContent = plural(total, "student", "students", "طالب");
    const out = [`<div class="t ${!ST.className ? "on" : ""}" data-c=""><span class="name"><b>${L("Everyone", "الجميع")}</b></span><span class="n">${num(total)}</span></div>`];
    let stage = null, grade = null;
    for (const c of cls) {
      if (c.stage !== stage) {
        stage = c.stage;
        grade = null;
        out.push(`<div class="head">${esc(STAGES()[stage] ?? stage ?? L("Other", "أخرى"))}</div>`);
      }
      if (c.grade !== grade) {
        grade = c.grade;
        out.push(`<div class="t muted" style="cursor: default"><span class="name">${esc(grade ?? "")}</span></div>`);
      }
      out.push(`<div class="t lvl1 ${ST.className === c.class_name ? "on" : ""}" data-c="${esc(c.class_name ?? "")}"><span class="name">${esc(c.class_name ?? "—")}</span><span class="n">${num(c.n)}</span></div>`);
    }
    tree.innerHTML = out.join("");
    $$("[data-c]", tree).forEach((el) => (el.onclick = () => { ST.className = el.dataset.c || null; this.tree(); this.list(); }));
  },
  async list() {
    const rows = (await quiet("students", { className: ST.className || undefined, search: ST.search || undefined })) ?? [];
    const box = $("#st-list");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><span class="big">☷</span><b>${ST.search ? L("No one matches", "لا يوجد تطابق") : L("No students yet", "لا يوجد طلاب بعد")}</b>
        <span>${L("Import the class list from Excel. The app recognises files from PowerSchool, Classera and Edunation.", "استورد قائمة الفصول من Excel. يتعرّف التطبيق على ملفات PowerSchool وClassera وEdunation.")}</span>
        <button class="btn primary" id="e-imp">☷ ${L("Import class list", "استيراد قائمة الفصول")}</button></div>`;
      $("#e-imp", box).onclick = () => importList();
      return;
    }
    const zero = rows.filter((r) => !r.photos).length;
    box.innerHTML = `${ST.className ? `<div class="row" style="margin-bottom: 10px"><h2 class="grow">${L("Class", "فصل")} ${esc(ST.className)}</h2>${zero ? `<span class="tag bad">${L(`${zero} with no photos`, `${num(zero)} بلا صور`)}</span>` : `<span class="tag good">${L("Everyone has photos", "الكل لديه صور")}</span>`}<button class="btn small" id="cls-photos">▦ ${L("Class photos", "صور الفصل")}</button></div>` : ""}
      <table class="list"><thead><tr><th></th><th>${L("Name", "الاسم")}</th><th>${L("Class", "الفصل")}</th><th>${L("ID", "الرقم")}</th><th>${L("Photos", "الصور")}</th><th>${L("In posts", "في المنشورات")}</th></tr></thead><tbody>
      ${rows.map((s) => `<tr class="click" data-id="${esc(s.id)}"><td style="width: 48px">${avatar(s)}</td><td><b>${esc(name(s))}</b>${s.name_en && s.name_ar ? `<div class="small muted">${esc(S.language === "en" ? s.name_ar : s.name_en)}</div>` : ""}</td><td>${esc(s.class_name ?? "")}</td><td class="muted ltr">${esc(s.id)}</td>
        <td>${s.photos ? num(s.photos) : `<span class="tag bad">0</span>`}${s.suggested ? ` <span class="tag warn" title="${L("Suggestions to confirm", "اقتراحات للتأكيد")}">? ${num(s.suggested)}</span>` : ""}</td>
        <td>${s.can_post ? `<span class="tag good">${L("Yes", "نعم")}</span>` : `<span class="tag bad">⛔ ${L("No", "لا")}</span>`}</td></tr>`).join("")}</tbody></table>`;
    $$("tr[data-id]", box).forEach((tr) => (tr.onclick = () => go("student", { id: tr.dataset.id })));
    $("#cls-photos", box)?.addEventListener("click", () => go("library", { className: ST.className }));
  },
};

function addStudent() {
  const m = modal(`<h2>${L("Add a student", "إضافة طالب")}</h2>
    <div class="grid2"><label class="field">${L("Name in English", "الاسم بالإنجليزية")}<input id="a-en" /></label><label class="field">${L("Name in Arabic", "الاسم بالعربية")}<input id="a-ar" dir="rtl" /></label></div>
    <div class="grid2"><label class="field">${L("Class", "الفصل")}<input id="a-cls" value="${esc(ST.className ?? "")}" /></label><label class="field">${L("Student ID (optional)", "رقم الطالب (اختياري)")}<input id="a-id" /></label></div>
    <div class="row"><span class="grow"></span><button class="btn" id="a-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="a-yes">${L("Add", "إضافة")}</button></div>`);
  $("#a-no", m).onclick = closeOverlay;
  $("#a-yes", m).onclick = async () => {
    const en = $("#a-en", m).value.trim(), ar = $("#a-ar", m).value.trim();
    if ((en || ar).length < 2) return $("#a-en", m).focus();
    closeOverlay();
    const id = await call("addStudent", { id: $("#a-id", m).value.trim(), name_en: en, name_ar: ar, class_name: $("#a-cls", m).value.trim() });
    go("student", { id });
  };
}

const FORMAT_NAMES = { hub: "School Social Hub", powerschool: "PowerSchool", classera: "Classera", edunation: "Edunation", other: "" };

async function importList(file) {
  let p;
  try {
    p = await call("previewStudents", file);
  } catch {
    return;
  }
  if (!p) return;
  let portraits = null;
  const m = modal(`<h2>☷ ${L("Import class list", "استيراد قائمة الفصول")}</h2>
    <div class="row"><b>${esc(p.file)}</b>${p.format !== "other" ? `<span class="tag good">✓ ${L("Recognised", "تم التعرّف")}: ${FORMAT_NAMES[p.format]}</span>` : `<span class="tag">${L("Read by column names", "قُرئ حسب أسماء الأعمدة")}</span>`}</div>
    ${p.count ? `<p>${L(`${num(p.count)} students in ${num(p.classes.length)} classes`, `${num(p.count)} طالب في ${num(p.classes.length)} فصل`)}${p.isNew < p.count ? ` · ${L(`${num(p.isNew)} new, ${num(p.count - p.isNew)} updated`, `${num(p.isNew)} جديد، ${num(p.count - p.isNew)} تحديث`)}` : ""}${p.skipped ? ` · <span class="muted">${L(`${num(p.skipped)} rows skipped`, `تم تخطي ${num(p.skipped)} صف`)}</span>` : ""}</p>` : `<div class="note bad">${L("No students found. The file needs at least a name column.", "لم يتم العثور على طلاب. يحتاج الملف على الأقل إلى عمود للاسم.")}</div>`}
    <div class="row">${p.classes.slice(0, 40).map((c) => `<span class="tag">${esc(c.name)} · ${num(c.n)}</span>`).join("")}${p.classes.length > 40 ? "…" : ""}</div>
    <table class="list small"><thead><tr><th>${L("ID", "الرقم")}</th><th>${L("English", "بالإنجليزية")}</th><th>${L("Arabic", "بالعربية")}</th><th>${L("Class", "الفصل")}</th><th>${L("In posts", "في المنشورات")}</th></tr></thead>
      <tbody>${p.sample.map((s) => `<tr><td class="ltr">${esc(s.id)}</td><td>${esc(s.name_en ?? "")}</td><td dir="rtl">${esc(s.name_ar ?? "")}</td><td>${esc(s.class_name ?? "")}</td><td>${s.can_post ? "✓" : "⛔"}</td></tr>`).join("")}</tbody></table>
    <div class="card tight"><div class="row"><div class="grow"><b>${L("Portraits (optional)", "الصور الشخصية (اختياري)")}</b><div class="small muted" id="pf">${L("A folder of student photos named by ID, like S24001.jpg. The Mac learns each face from them.", "مجلد صور الطلاب بأسماء أرقامهم، مثل S24001.jpg. يتعلّم الماك كل وجه منها.")}</div></div><button class="btn small" id="pick-pf">${L("Choose folder", "اختيار مجلد")}</button></div></div>
    <p class="muted small">${L("The list stays on this Mac. Names and “in posts” are also sent to your website so it can stop a post with a student who mustn't appear.", "تبقى القائمة على هذا الماك. تُرسل الأسماء و«في المنشورات» إلى موقعك أيضًا ليمنع نشر صورة طالب لا يجب أن يظهر.")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="i-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="i-yes" ${p.count ? "" : "disabled"}>${L(`Import ${p.count} students`, `استيراد ${num(p.count)} طالب`)}</button></div>`, { wide: true });
  $("#i-no", m).onclick = closeOverlay;
  $("#pick-pf", m).onclick = async () => {
    const dir = await call("pickPortraits");
    if (dir) {
      portraits = dir;
      $("#pf", m).innerHTML = `✓ <span class="ltr">${esc(dir)}</span>`;
    }
  };
  $("#i-yes", m).onclick = async () => {
    $("#i-yes", m).disabled = true;
    $("#i-yes", m).textContent = portraits ? L("Importing and reading portraits…", "جارٍ الاستيراد وقراءة الصور الشخصية…") : L("Importing…", "جارٍ الاستيراد…");
    try {
      const r = await call("commitStudents", portraits);
      closeOverlay();
      const web = typeof r.web === "number" && r.web ? L(" Sent to the website too.", " وأُرسلت إلى الموقع أيضًا.") : typeof r.web === "string" ? L(" (Couldn't send to the website.)", " (تعذّر الإرسال إلى الموقع.)") : "";
      toast(L(`${r.saved} students imported${r.portraits ? `, ${r.portraits} portraits learned` : ""}.`, `تم استيراد ${num(r.saved)} طالب${r.portraits ? `، وتعلّم ${num(r.portraits)} صورة شخصية` : ""}.`) + web, { ms: 7000 });
      App.views.students.tree();
      App.views.students.list();
    } catch {
      $("#i-yes", m).disabled = false;
    }
  };
}

// One student, like a person in Apple Photos: their face, whether they can
// appear in posts, faces to review (sure ones ticked), auto-named faces to
// check, their events and photos. Enter confirms and moves to the next.
App.views.student = {
  async render(main, params) {
    const d = await call("person", params.id);
    if (!d) return go("students");
    const s = d.student;
    const photos = d.photoIds.length ? await call("photos", { ids: d.photoIds.slice(0, 600), sort: "time" }) : [];
    const sel = new Set(d.review.filter((f) => f.sure).map((f) => f.id));
    main.innerHTML = topbar(esc(name(s)), esc([s.class_name, s.grade, STAGES()[s.stage] ?? s.stage].filter(Boolean).join(" · ")),
      `<button class="btn" id="sp-back">← ${L("People", "الأشخاص")}</button><button class="btn" id="sp-lib">▦ ${L("Open in Library", "فتح في المكتبة")}</button>`) +
      `<div class="content"><div class="col gap16">
        <div class="card"><div class="row nowrap gap16">${faceImg({ ...s, face: s.face }, true)}<div class="grow col gap4">
          <b style="font-size: 16px">${esc(s.name_en ?? "")}</b><b dir="rtl" style="font-size: 16px; text-align: start">${esc(s.name_ar ?? "")}</b>
          <span class="muted">${L("ID", "الرقم")} <span class="ltr">${esc(s.id)}</span> · ${plural(d.photoIds.length, "photo", "photos", "صورة")} · ${plural(d.events.length, "event", "events", "فعالية")}</span></div>
          <div class="col gap4" style="align-items: flex-end">
            <label class="check"><input type="checkbox" id="sp-post" ${s.can_post ? "checked" : ""} /> <b>${L("Can appear in posts", "يمكن أن يظهر في المنشورات")}</b></label>
            <span class="small muted" style="max-width: 280px; text-align: end">${L("If off, the website blocks any post with a photo of this student.", "إذا أُوقف، يمنع الموقع أي منشور فيه صورة لهذا الطالب.")}</span>
            <button class="btn small danger" id="sp-del">${L("Remove from the list", "إزالة من القائمة")}</button></div></div></div>
        ${d.review.length ? `<div class="card" id="sp-review"><div class="row"><h2 class="grow">${L(`Is this ${name(s)}?`, `هل هذا ${name(s)}؟`)} <span class="muted small">${num(d.review.length)}</span></h2>
            <button class="btn small" id="sp-all">${L("Select all", "تحديد الكل")}</button><button class="btn small" id="sp-none">${L("Select none", "إلغاء التحديد")}</button>
            <button class="btn small primary" id="sp-ok">✓ ${L("Confirm", "تأكيد")} <span id="sp-n"></span> <span class="k">↵</span></button></div>
          <p class="muted small">${L("The likely ones are ticked. Click to change. Enter confirms the ticked ones, leaves out the rest, and opens the next student.", "المرجّحة محددة. اضغط للتغيير. Enter يؤكد المحددة ويستبعد الباقي ويفتح الطالب التالي.")}</p>
          <div class="faces big">${d.review.map((f) => `<div class="face ${sel.has(f.id) ? "on" : ""}" data-f="${f.id}"><img loading="lazy" src="hub://face/${f.id}" /><span class="tick">✓</span><span class="sc">${Math.round(f.suggest_score * 100)}%</span></div>`).join("")}</div></div>` : ""}
        ${d.auto.length ? `<div class="card"><div class="row"><h3 class="grow">${L(`Named by the Mac (${d.auto.length})`, `سمّاها الماك (${num(d.auto.length)})`)}</h3><span class="muted small">${L("Click any that aren't them.", "اضغط على أي وجه ليس له.")}</span></div>
          <div class="faces">${d.auto.map((f) => `<div class="face" data-auto="${f.id}"><img loading="lazy" src="hub://face/${f.id}" /><span class="sc">auto</span></div>`).join("")}</div></div>` : ""}
        ${d.examples.length > 1 ? `<div class="card"><h3>${L("Main photo", "الصورة الرئيسية")}</h3><p class="muted small">${L("Click a face to use it as their main photo.", "اضغط على وجه لاستخدامه صورةً رئيسية.")}</p>
          <div class="faces">${d.examples.map((f) => `<div class="face ${f.id === s.face ? "on" : ""}" data-main="${f.id}"><img loading="lazy" src="hub://face/${f.id}" /></div>`).join("")}</div></div>` : ""}
        ${d.events.length ? `<div class="row">${d.events.map((e) => `<button class="pill" data-ev="${esc(e.event_key ?? "")}">${esc(e.event_title ? eventLabel(e) : L("No event", "بلا فعالية"))} · ${num(e.n)}</button>`).join("")}</div>` : ""}
        ${!photos.length ? `<div class="note warn">${L("No photos of this student yet. Tag them in a photo, or add their portrait so the Mac can find them.", "لا توجد صور لهذا الطالب بعد. سمّه في صورة، أو أضف صورته الشخصية ليجده الماك.")}</div>` : ""}
        <div class="photos" style="padding: 0; overflow: visible">${photos.map((p, i) => tileHtml(p, i)).join("")}</div></div></div>`;
    const count = () => { const el = $("#sp-n", main); if (el) el.textContent = `(${num(sel.size)})`; };
    count();
    $$("[data-f]", main).forEach((el) => {
      el.onclick = () => {
        const id = Number(el.dataset.f);
        sel.has(id) ? sel.delete(id) : sel.add(id);
        el.classList.toggle("on", sel.has(id));
        count();
      };
      el.ondblclick = () => openViewer([d.review.find((f) => f.id === Number(el.dataset.f)).photo_id], 0, {});
    });
    const pick = (all) => { d.review.forEach((f) => (all ? sel.add(f.id) : sel.delete(f.id))); $$("[data-f]", main).forEach((el) => el.classList.toggle("on", all)); count(); };
    $("#sp-all", main)?.addEventListener("click", () => pick(true));
    $("#sp-none", main)?.addEventListener("click", () => pick(false));
    const confirm = async () => {
      const yes = d.review.filter((f) => sel.has(f.id)).map((f) => f.id);
      const no = d.review.filter((f) => !sel.has(f.id)).map((f) => f.id);
      if (yes.length) await call("confirmFaces", yes, s.id);
      if (no.length) await call("rejectFaces", no);
      toast(L(`${yes.length} photos of ${name(s)} confirmed`, `تم تأكيد ${num(yes.length)} صورة لـ ${name(s)}`), { undo: true });
      // Straight on to the next student with faces to review.
      const next = ((await quiet("people", {})) ?? []).find((p) => p.review && p.id !== s.id);
      if (next) go("student", { id: next.id, review: true });
      else go("student", { id: s.id });
    };
    $("#sp-ok", main)?.addEventListener("click", confirm);
    this.enter = d.review.length ? confirm : null;
    $$("[data-auto]", main).forEach((el) => (el.onclick = async () => {
      await call("rejectFaces", [Number(el.dataset.auto)]);
      el.remove();
    }));
    $$("[data-main]", main).forEach((el) => (el.onclick = async () => {
      await call("setMainFace", s.id, Number(el.dataset.main));
      $$("[data-main]", main).forEach((x) => x.classList.toggle("on", x === el));
    }));
    $$("[data-ev]", main).forEach((b) => (b.onclick = () => go("library", { event: b.dataset.ev || undefined, student: s.id })));
    $("#sp-back", main).onclick = () => go("faces", { tab: "people" });
    $("#sp-lib", main).onclick = () => go("library", { student: s.id });
    $("#sp-post", main).onchange = async (e) => {
      await call("setCanPost", s.id, e.target.checked);
      toast(e.target.checked ? L("Can appear in posts", "يمكن أن يظهر في المنشورات") : L("Won't appear in posts", "لن يظهر في المنشورات"), { undo: true });
    };
    $("#sp-del", main).onclick = async () => {
      await call("removeStudent", s.id);
      go("students");
    };
    $$(".tile", main).forEach((t) => (t.ondblclick = t.onclick = () => openViewer(photos.map((p) => p.id), Number(t.dataset.i), {})));
    if (params.review) $("#sp-review", main)?.scrollIntoView({ block: "start" });
  },
  onKey(e) {
    if (e.key === "Enter" && this.enter) {
      e.preventDefault();
      this.enter();
    }
  },
};

// Coverage: which students are missing from the photos, Stage → Grade →
// Class, the classes that need attention first.
const COV = { year: null, term: null, event: "", open: null };
const covBar = (c) => {
  const t = Math.max(1, c.students);
  return `<div class="cbar"><i class="g" style="width: ${(c.good / t) * 100}%"></i><i class="w" style="width: ${(c.low / t) * 100}%"></i><i class="b" style="width: ${(c.zero / t) * 100}%"></i></div>`;
};
App.views.coverage = {
  async render(main) {
    const [periods, tree] = await Promise.all([quiet("periods"), quiet("tree")]);
    if (!COV.year && periods?.[0]) {
      COV.year = periods[0].year;
      COV.term = periods[0].term;
    }
    const events = (tree?.rows ?? []).filter((r) => r.event_key && (!COV.year || r.year === COV.year) && (!COV.term || r.term === COV.term));
    main.innerHTML = topbar(L("Coverage", "التغطية"), L("Every student should appear in the school's photos", "يجب أن يظهر كل طالب في صور المدرسة"),
      `<select id="cv-p"><option value="">${L("All time", "كل الأوقات")}</option>${(periods ?? []).map((p, i) => `<option value="${i}" ${p.year === COV.year && p.term === COV.term ? "selected" : ""}>${esc(p.year)} · ${esc(p.term)}</option>`).join("")}</select>
       <select id="cv-e"><option value="">${L("All events", "كل الفعاليات")}</option>${events.map((e) => `<option value="${esc(e.event_key)}" ${COV.event === e.event_key ? "selected" : ""}>${esc(eventLabel(e))}</option>`).join("")}</select>`) +
      `<div class="content"><div class="col gap16" id="cv"></div></div>`;
    $("#cv-p", main).onchange = (e) => {
      const p = periods[Number(e.target.value)];
      COV.year = e.target.value ? p.year : null;
      COV.term = e.target.value ? p.term : null;
      COV.event = "";
      COV.open = null;
      this.render(main);
    };
    $("#cv-e", main).onchange = (e) => {
      COV.event = e.target.value;
      this.fill();
    };
    this.fill();
  },
  async fill() {
    const box = $("#cv");
    if (!box) return;
    const f = { year: COV.year || undefined, term: COV.term || undefined, event: COV.event || undefined };
    const rows = (await quiet("coverage", f)) ?? [];
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><span class="big">◔</span><b>${L("Import the class lists to see coverage", "استورد قوائم الفصول لرؤية التغطية")}</b></div>`;
      return;
    }
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const all = sum("students");
    const zero = sum("zero");
    const attention = rows.filter((r) => r.zero > 0).sort((a, b) => b.zero / b.students - a.zero / a.students).slice(0, 8);
    const stages = STAGES();
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.stage ?? ""}|${r.grade ?? ""}`;
      if (!groups.has(key)) groups.set(key, { stage: r.stage, grade: r.grade, classes: [] });
      groups.get(key).classes.push(r);
    }
    const card = (r) => `<div class="c" data-c="${esc(r.className)}"><div class="row nowrap"><b class="grow">${esc(r.className)}</b>${r.zero ? `<span class="tag bad">${num(r.zero)} ${L("missing", "غائب")}</span>` : `<span class="tag good">✓</span>`}</div>
      ${covBar(r)}<span class="tiny muted">${L(`${r.students} students`, `${num(r.students)} طالب`)}${r.nopost ? ` · ⛔ ${num(r.nopost)}` : ""}${r.stale ? ` · ${L(`${r.stale} not seen in 3 weeks`, `${num(r.stale)} لم يظهروا منذ 3 أسابيع`)}` : ""}</span></div>`;
    box.innerHTML = `<div class="grid4"><div class="card stat"><b>${num(all - zero)}<span class="muted" style="font-size: 14px"> / ${num(all)}</span></b><span>${L("students with at least one photo", "طالب لديه صورة واحدة على الأقل")}</span></div>
      <div class="card stat"><b style="color: var(--bad)">${num(zero)}</b><span>${L("with no photos", "بلا صور")}</span></div>
      <div class="card stat"><b style="color: var(--warn)">${num(sum("low"))}</b><span>${L("with only 1 or 2", "لديهم صورة أو اثنتان فقط")}</span></div>
      <div class="card stat"><b>${num(sum("nopost"))}</b><span>${L("can't appear in posts (not counted)", "لا يظهرون في المنشورات (غير محسوبين)")}</span></div></div>
      <p class="muted small">${L("Counts named faces only. Confirm suggestions in Faces to make this complete.", "يحسب الوجوه المسمّاة فقط. أكّد الاقتراحات في الوجوه ليكتمل.")} <span class="tag good">■ 3+</span> <span class="tag warn">■ 1-2</span> <span class="tag bad">■ 0</span></p>
      ${attention.length ? `<div class="card"><h2>${L("Needs attention", "تحتاج اهتمامًا")}</h2><div class="heat">${attention.map(card).join("")}</div></div>` : `<div class="note good">✓ ${L("Every class has every student in at least one photo.", "كل الفصول فيها كل الطلاب في صورة واحدة على الأقل.")}</div>`}
      ${[...groups.values()].map((g) => `<div class="col gap8"><h3>${esc([stages[g.stage] ?? g.stage, g.grade].filter(Boolean).join(" · ") || L("Other", "أخرى"))}</h3><div class="heat">${g.classes.map(card).join("")}</div></div>`).join("")}
      <div id="cv-class"></div>`;
    $$(".heat .c", box).forEach((c) => (c.onclick = () => { COV.open = c.dataset.c; this.openClass(); }));
    if (COV.open) this.openClass();
  },
  async openClass() {
    const el = $("#cv-class");
    if (!el) return;
    const list = (await quiet("students", { className: COV.open, year: COV.year || undefined, term: COV.term || undefined, event: COV.event || undefined })) ?? [];
    list.sort((a, b) => (b.can_post - a.can_post) || a.photos - b.photos);
    const missing = list.filter((k) => k.can_post && k.photos === 0);
    const low = list.filter((k) => k.can_post && k.photos > 0 && k.photos < 3);
    el.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${L("Class", "فصل")} ${esc(COV.open)}</h2>
        ${missing.some((k) => k.suggested) ? `<button class="btn small primary" id="cv-find">☺ ${L("Find photos of missing students", "ابحث عن صور الطلاب الغائبين")}</button>` : ""}
        <button class="btn small" id="cv-shot">✎ ${L("Copy shot list", "نسخ قائمة اللقطات")}</button><button class="btn small" id="cv-lib">▦ ${L("Class photos", "صور الفصل")}</button></div>
      <div class="people">${list.map((k) => `<div class="person ${k.can_post ? "" : "off"}" data-id="${esc(k.id)}">${avatar(k, 64)}<b class="small">${esc(name(k))}</b>
        <span class="tag ${!k.can_post ? "" : k.photos === 0 ? "bad" : k.photos < 3 ? "warn" : "good"}">${!k.can_post ? "⛔" : num(k.photos)}</span>${k.suggested && k.photos < 3 ? `<span class="tiny muted">${L(`${k.suggested} to confirm`, `${num(k.suggested)} للتأكيد`)}</span>` : ""}</div>`).join("")}</div>
      <p class="muted small">${L("The shot list has the students with no photos or only 1-2: share it with the class teacher or photographer before the next event.", "قائمة اللقطات فيها الطلاب بلا صور أو بصورة أو اثنتين: شاركها مع معلم الفصل أو المصور قبل الفعالية القادمة.")}</p></div>`;
    $$("[data-id]", el).forEach((r) => (r.onclick = () => go("student", { id: r.dataset.id })));
    $("#cv-lib", el).onclick = () => go("library", { className: COV.open });
    $("#cv-find", el)?.addEventListener("click", () => go("faces", { tab: "review", students: missing.filter((k) => k.suggested).map((k) => k.id) }));
    $("#cv-shot", el).onclick = async () => {
      const text = [`${L("Shot list", "قائمة اللقطات")} · ${COV.open}`, "", ...missing.map((k) => `□ ${name(k)} (0)`), ...low.map((k) => `□ ${name(k)} (${k.photos})`)].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toast(L("Shot list copied. Paste it into WhatsApp or an email.", "نُسخت قائمة اللقطات. الصقها في واتساب أو بريد."));
      } catch {
        toast(L("Couldn't copy.", "تعذّر النسخ."));
      }
    };
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  },
};
