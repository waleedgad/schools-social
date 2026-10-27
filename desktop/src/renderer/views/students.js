// Students: class lists by Stage → Grade → Class, the import, each child's page, and coverage.
const ST = { className: null, search: "" };
const STAGES = () => ({ KG: L("KG", "رياض الأطفال"), Primary: L("Primary", "ابتدائي"), Prep: L("Prep", "إعدادي"), Secondary: L("Secondary", "ثانوي") });

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
    <p class="muted small">${L("The list stays on this Mac. Names and “in posts” are also sent to your website so it can stop a post with a child who mustn't appear.", "تبقى القائمة على هذا الماك. تُرسل الأسماء و«في المنشورات» إلى موقعك أيضًا ليمنع نشر صورة طفل لا يجب أن يظهر.")}</p>
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

// One child: portrait, class, whether they can appear in posts, and their photos.
App.views.student = {
  async render(main, params) {
    const s = await call("student", params.id);
    if (!s) return go("students");
    const photos = await call("photos", { student: s.id, limit: 400 });
    main.innerHTML = topbar(esc(name(s)), esc([s.class_name, s.grade, STAGES()[s.stage] ?? s.stage].filter(Boolean).join(" · ")),
      `<button class="btn" id="sp-back">← ${L("Students", "الطلاب")}</button><button class="btn" id="sp-lib">▦ ${L("Open in Library", "فتح في المكتبة")}</button>`) +
      `<div class="content"><div class="col gap16">
        <div class="card"><div class="row nowrap gap16">${avatar(s, true)}<div class="grow col gap4">
          <b style="font-size: 16px">${esc(s.name_en ?? "")}</b><b dir="rtl" style="font-size: 16px; text-align: start">${esc(s.name_ar ?? "")}</b>
          <span class="muted">${L("ID", "الرقم")} <span class="ltr">${esc(s.id)}</span> · ${plural(photos.length, "photo", "photos", "صورة")}</span></div>
          <div class="col gap4" style="align-items: flex-end">
            <label class="check"><input type="checkbox" id="sp-post" ${s.can_post ? "checked" : ""} /> <b>${L("Can appear in posts", "يمكن أن يظهر في المنشورات")}</b></label>
            <span class="small muted" style="max-width: 280px; text-align: end">${L("If off, the website blocks any post with a photo of this child.", "إذا أُوقف، يمنع الموقع أي منشور فيه صورة لهذا الطفل.")}</span>
            <button class="btn small danger" id="sp-del">${L("Remove from the list", "إزالة من القائمة")}</button></div></div></div>
        ${!photos.length ? `<div class="note warn">${L("No photos of this child yet. Tag them in a photo, or add their portrait so the Mac can find them.", "لا توجد صور لهذا الطفل بعد. سمّه في صورة، أو أضف صورته الشخصية ليجده الماك.")}</div>` : ""}
        <div class="photos" style="padding: 0; overflow: visible">${photos.map((p, i) => tileHtml(p, i)).join("")}</div></div></div>`;
    $("#sp-back", main).onclick = () => go("students");
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
  },
};

// Coverage: which children are missing from this term's photos, class by class.
const COV = { year: null, term: null, open: null };
App.views.coverage = {
  async render(main) {
    const periods = (await quiet("periods")) ?? [];
    if (!COV.year && periods[0]) {
      COV.year = periods[0].year;
      COV.term = periods[0].term;
    }
    main.innerHTML = topbar(L("Coverage", "التغطية"), L("Every child should appear in the school's photos", "يجب أن يظهر كل طفل في صور المدرسة"),
      `<select id="cv-p"><option value="">${L("All time", "كل الأوقات")}</option>${periods.map((p, i) => `<option value="${i}" ${p.year === COV.year && p.term === COV.term ? "selected" : ""}>${esc(p.year)} · ${esc(p.term)}</option>`).join("")}</select>`) +
      `<div class="content"><div class="col gap16" id="cv"></div></div>`;
    $("#cv-p", main).onchange = (e) => {
      const p = periods[Number(e.target.value)];
      COV.year = e.target.value ? p.year : null;
      COV.term = e.target.value ? p.term : null;
      COV.open = null;
      this.fill();
    };
    this.fill();
  },
  async fill() {
    const box = $("#cv");
    if (!box) return;
    const f = { year: COV.year || undefined, term: COV.term || undefined };
    const rows = (await quiet("coverage", f)) ?? [];
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><span class="big">◔</span><b>${L("Import the class lists to see coverage", "استورد قوائم الفصول لرؤية التغطية")}</b></div>`;
      return;
    }
    const all = rows.reduce((s, r) => s + r.students, 0);
    const zero = rows.reduce((s, r) => s + r.zero, 0);
    const low = rows.reduce((s, r) => s + r.low, 0);
    box.innerHTML = `<div class="grid3"><div class="card stat"><b>${num(all - zero)}<span class="muted" style="font-size: 14px"> / ${num(all)}</span></b><span>${L("children with at least one photo", "طفل لديه صورة واحدة على الأقل")}</span></div>
      <div class="card stat"><b style="color: var(--bad)">${num(zero)}</b><span>${L("with no photos", "بلا صور")}</span></div>
      <div class="card stat"><b style="color: #b9850f">${num(low)}</b><span>${L("with only 1 or 2", "لديهم صورة أو اثنتان فقط")}</span></div></div>
      <p class="muted small">${L("Counts named faces only. Confirm suggestions in Faces to make this complete.", "يحسب الوجوه المسمّاة فقط. أكّد الاقتراحات في الوجوه ليكتمل.")} <span class="tag good">■ 3+</span> <span class="tag warn">■ 1-2</span> <span class="tag bad">■ 0</span></p>
      <div class="heat">${rows.map((r, i) => `<div class="c" data-i="${i}"><div class="row nowrap"><b class="grow">${esc(r.className)}</b>${r.zero ? `<span class="tag bad">${num(r.zero)}</span>` : `<span class="tag good">✓</span>`}</div><span class="small muted">${L(`${r.students} students · ${r.photos} tags`, `${num(r.students)} طالب · ${num(r.photos)} وسم`)}</span><div class="bar"><i style="width: ${((r.students - r.zero) / r.students) * 100}%; background: ${r.zero ? "#e0a526" : "var(--good)"}"></i></div></div>`).join("")}</div>
      <div id="cv-class"></div>`;
    $$(".heat .c", box).forEach((c) => (c.onclick = () => { COV.open = rows[Number(c.dataset.i)].className; this.openClass(); }));
    if (COV.open) this.openClass();
  },
  async openClass() {
    const el = $("#cv-class");
    if (!el) return;
    const kids = (await quiet("students", { className: COV.open, year: COV.year || undefined, term: COV.term || undefined })) ?? [];
    kids.sort((a, b) => a.photos - b.photos);
    el.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${L("Class", "فصل")} ${esc(COV.open)}</h2><button class="btn small" id="cv-lib">▦ ${L("Class photos", "صور الفصل")}</button></div>
      <div class="grid3">${kids.map((k) => `<div class="row nowrap" style="cursor: pointer" data-id="${esc(k.id)}">${avatar(k)}<span class="grow">${esc(name(k))}</span>${k.photos === 0 ? `<span class="tag bad">0</span>` : k.photos < 3 ? `<span class="tag warn">${num(k.photos)}</span>` : `<span class="tag good">${num(k.photos)}</span>`}</div>`).join("")}</div>
      <p class="muted small">${L("Tip: share the list of children with no photos with the class teacher before the next event.", "تلميح: شارك قائمة الأطفال بلا صور مع معلم الفصل قبل الفعالية القادمة.")}</p></div>`;
    $$("[data-id]", el).forEach((r) => (r.onclick = () => go("student", { id: r.dataset.id })));
    $("#cv-lib", el).onclick = () => go("library", { className: COV.open });
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  },
};
