// Yearbooks and graduation books: laid out on this Mac, saved as A4 PDFs
// ready for the printer. Parents order and pay later (not in this version).
const BK = { kind: "yearbook", year: "", grade: "", className: "", student: null, language: null };

App.views.books = {
  async render(main) {
    const o = (await quiet("bookOptions")) ?? { years: [], grades: [], classes: [] };
    BK.year ||= o.years[0] ?? "";
    BK.language ||= S.language;
    const grades = [...new Set(o.grades)];
    const classes = [...new Set(o.classes.map((c) => c.class_name).filter(Boolean))];
    BK.grade ||= grades[0] ?? "";
    BK.className ||= classes[0] ?? "";
    const kinds = [
      ["yearbook", L("Yearbook for a grade", "كتاب سنوي لصف")],
      ["student", L("Book for each student", "كتاب لكل طالب")],
      ["graduation", L("Graduation book (KG2, Grade 12)", "كتاب التخرج (KG2، الصف 12)")],
    ];
    main.innerHTML = topbar(L("Yearbooks", "الكتب السنوية"), L("Laid out from your library, saved as print-ready PDFs", "تُصمم من مكتبتك وتُحفظ ملفات PDF جاهزة للطباعة")) +
      `<div class="content col gap16">
        ${!o.years.length ? `<div class="note warn">${L("Import photos and class lists first.", "استورد الصور وقوائم الفصول أولًا.")}</div>` : ""}
        <div class="card"><div class="row">${kinds.map(([k, t]) => `<button class="pill ${BK.kind === k ? "on" : ""}" data-kind="${k}">${t}</button>`).join("")}</div>
          <div class="grid4">
            <label class="field">${L("School year", "العام الدراسي")}<select id="bk-year">${o.years.map((y) => `<option ${y === BK.year ? "selected" : ""}>${esc(y)}</option>`).join("")}</select></label>
            ${BK.kind === "yearbook" ? `<label class="field">${L("Grade", "الصف")}<select id="bk-grade">${grades.map((g) => `<option ${g === BK.grade ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>`
              : `<label class="field">${L("Class", "الفصل")}<select id="bk-class">${classes.map((c) => `<option ${c === BK.className ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
                 <label class="field">${L("Student", "الطالب")}<button class="btn" id="bk-student">${BK.student ? esc(name(BK.student)) : L("Choose…", "اختر…")}</button></label>`}
            <label class="field">${L("Language", "اللغة")}<select id="bk-lang"><option value="ar" ${BK.language === "ar" ? "selected" : ""}>العربية</option><option value="en" ${BK.language === "en" ? "selected" : ""}>English</option></select></label>
          </div>
          <p class="muted small">${BK.kind === "yearbook" ? L("A cover, a page per class with every student's face and name, then the year's events with their best photos.", "غلاف، وصفحة لكل فصل بوجه واسم كل طالب، ثم فعاليات العام بأفضل صورها.")
            : BK.kind === "graduation" ? L("A cover with the student's face, a page for every year they were at the school (from the year they joined), and their class page.", "غلاف بوجه الطالب، وصفحة لكل عام قضاه في المدرسة (من عام انضمامه)، وصفحة فصله.")
            : L("A cover, the student's best photos of the year, their class page and the year's events.", "غلاف، وأفضل صور الطالب في العام، وصفحة فصله، وفعاليات العام.")}</p>
          <div class="row"><button class="btn" id="bk-prev">${L("Preview", "معاينة")}</button><span class="grow"></span>
            ${BK.kind === "yearbook" ? "" : `<button class="btn" id="bk-all">${L("Make a book for every student in the class", "اعمل كتابًا لكل طالب في الفصل")}</button>`}
            <button class="btn primary" id="bk-pdf">⤓ ${L("Save PDF", "حفظ PDF")}</button></div></div>
        <div id="bk-view"></div></div>`;
    $$("[data-kind]", main).forEach((b) => (b.onclick = () => { BK.kind = b.dataset.kind; this.render(main); }));
    $("#bk-year", main).onchange = (e) => (BK.year = e.target.value);
    $("#bk-grade", main)?.addEventListener("change", (e) => (BK.grade = e.target.value));
    $("#bk-class", main)?.addEventListener("change", (e) => { BK.className = e.target.value; BK.student = null; this.render(main); });
    $("#bk-lang", main).onchange = (e) => (BK.language = e.target.value);
    $("#bk-student", main)?.addEventListener("click", () => pickStudent(L("Which student?", "أي طالب؟"), (s) => { BK.student = s; BK.className = s.class_name ?? BK.className; this.render(main); }));
    const spec = () => ({ kind: BK.kind, year: BK.year, grade: BK.grade, className: BK.className, studentId: BK.student?.id ?? null, language: BK.language });
    const needStudent = () => BK.kind !== "yearbook" && !BK.student && (toast(L("Choose a student first.", "اختر طالبًا أولًا.")), true);
    $("#bk-prev", main).onclick = async () => {
      if (needStudent()) return;
      const r = await call("bookPreview", spec());
      const box = $("#bk-view", main);
      if (!r.pages) return (box.innerHTML = `<div class="note warn">${L("Nothing to put in this book yet: name more faces, or check the year.", "لا شيء يوضع في هذا الكتاب بعد: سمِّ المزيد من الوجوه، أو تحقق من العام.")}</div>`);
      box.innerHTML = `<p class="muted small">${L(`${r.pages} pages`, `${num(r.pages)} صفحة`)}</p><div class="bookprev"><iframe id="bk-frame"></iframe></div>`;
      const frame = $("#bk-frame", box);
      frame.onload = () => {
        const doc = frame.contentDocument;
        doc.body.style.zoom = String(Math.min(1, (frame.clientWidth - 40) / 794));
        doc.body.style.background = "#8a8f99";
        doc.querySelectorAll(".page").forEach((p) => (p.style.cssText += "; background-color: #fff; margin: 20px auto; box-shadow: 0 4px 18px rgba(0,0,0,.3)"));
      };
      frame.srcdoc = r.html;
    };
    $("#bk-pdf", main).onclick = async () => {
      if (needStudent()) return;
      const r = await call("makeBook", spec());
      if (r) toast(L(`Saved ${r.pages} pages`, `حُفظت ${num(r.pages)} صفحة`));
    };
    $("#bk-all", main)?.addEventListener("click", async () => {
      toast(L("Making the books. This takes a while for a big class.", "جارٍ عمل الكتب. يستغرق ذلك وقتًا للفصل الكبير."));
      const r = await call("makeClassBooks", spec());
      if (r) toast(L(`${r.made} of ${r.total} books saved`, `حُفظ ${num(r.made)} من ${num(r.total)} كتاب`));
    });
  },
};
