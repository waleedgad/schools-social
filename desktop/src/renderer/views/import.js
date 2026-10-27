// Import wizard: a card, a phone, a photographer's folder or an old archive.
const IMP = { src: null, running: false, result: null };

App.views.import = {
  render(main, params) {
    main.innerHTML = topbar(L("Import photos", "استيراد صور"), L("Photos are copied into the library, filed by year, term, event and class", "تُنسخ الصور إلى المكتبة، مرتبة حسب السنة والفصل الدراسي والفعالية والفصل")) +
      `<div class="content"><div class="col gap16" style="max-width: 820px" id="imp"></div></div>`;
    IMP.result = null;
    if (params.source) this.pick(params.source);
    else {
      IMP.src = null;
      this.draw();
    }
  },
  onProgress(p) {
    const bar = $("#imp-bar");
    if (bar) bar.style.width = `${(p.done / p.total) * 100}%`;
    const t = $("#imp-count");
    if (t) t.textContent = `${num(p.done)} / ${num(p.total)}`;
  },
  async pick(dir) {
    try {
      const src = await call("importSource", dir);
      if (src) IMP.src = src;
    } catch {
      IMP.src = null;
    }
    this.draw();
  },
  async draw() {
    const box = $("#imp");
    if (!box) return;
    if (!S.library) {
      box.innerHTML = `<div class="note warn">${L("Choose the library folder first, in Settings.", "اختر مجلد المكتبة أولًا من الإعدادات.")}</div><button class="btn primary" style="align-self: flex-start" data-go="settings">${L("Open Settings", "فتح الإعدادات")}</button>`;
      $("[data-go]", box).onclick = () => go("settings");
      return;
    }
    if (IMP.result) {
      const r = IMP.result;
      box.innerHTML = `<div class="card"><h2>✓ ${L("Import finished", "انتهى الاستيراد")}</h2>
        <p>${L(`${num(r.copied)} photos copied into the library.`, `نُسخت ${num(r.copied)} صورة إلى المكتبة.`)}</p>
        ${r.duplicates ? `<p class="muted">${L(`${num(r.duplicates)} were already in the library and were left out.`, `${num(r.duplicates)} كانت موجودة بالفعل في المكتبة ولم تُنسخ.`)}</p>` : ""}
        ${r.failed ? `<p class="note bad">${L(`${num(r.failed)} files couldn't be copied.`, `تعذّر نسخ ${num(r.failed)} ملف.`)}</p>` : ""}
        <p class="muted small">${L("The Mac is now making thumbnails and looking for faces. You can keep working.", "يعمل الماك الآن على المصغرات والبحث عن الوجوه. يمكنك مواصلة العمل.")}</p>
        <div class="row"><button class="btn primary" id="see">${L("See the photos", "عرض الصور")}</button><button class="btn" id="again">${L("Import more", "استيراد المزيد")}</button></div></div>`;
      $("#see", box).onclick = () => go("library", { album: "week" });
      $("#again", box).onclick = () => { IMP.result = null; IMP.src = null; this.draw(); };
      return;
    }
    if (!IMP.src) {
      const vols = (await quiet("volumes")) ?? [];
      box.innerHTML = `
        <div class="drop" id="drop"><div style="font-size: 30px">⤓</div><b>${L("Drag a folder of photos here", "اسحب مجلد صور إلى هنا")}</b><p class="small">${L("or", "أو")}</p><button class="btn primary" id="choose">${L("Choose a folder…", "اختيار مجلد…")}</button></div>
        ${vols.length ? `<div class="card"><h2>${L("Memory cards", "كروت الذاكرة")}</h2>${vols.map((v) => `<div class="row"><span class="grow">💾 ${esc(v.name)}</span><button class="btn small" data-vol="${esc(v.path)}">${L("Import from this card", "استيراد من هذا الكارت")}</button></div>`).join("")}</div>` : ""}
        <div class="grid3">
          <div class="card"><h3>📷 ${L("Camera card or phone", "كارت كاميرا أو هاتف")}</h3><p class="muted small">${L("Insert the card, or plug in the phone and export its photos to a folder first.", "أدخل الكارت، أو وصّل الهاتف وصدّر صوره إلى مجلد أولًا.")}</p></div>
          <div class="card"><h3>🗂 ${L("Old archive", "أرشيف قديم")}</h3><p class="muted small">${L("Bring in past years. Tick “Keep on this Mac only” so nothing is sent to the website.", "أضف السنوات السابقة. فعّل «على هذا الماك فقط» حتى لا يُرسل شيء للموقع.")}</p></div>
          <div class="card"><h3>☁ ${L("Cloud folder", "مجلد سحابي")}</h3><p class="muted small">${L("For Google Drive, OneDrive or Lightroom exports, add a watched folder in Settings: new photos come in by themselves.", "لـ Google Drive أو OneDrive أو صادرات Lightroom، أضف مجلدًا مراقَبًا من الإعدادات: تدخل الصور الجديدة تلقائيًا.")}</p></div>
        </div>`;
      $("#choose", box).onclick = () => this.pick();
      $$("[data-vol]", box).forEach((b) => (b.onclick = () => this.pick(b.dataset.vol)));
      return;
    }
    const src = IMP.src;
    const classes = [...new Set(((await quiet("classes")) ?? []).map((c) => c.class_name).filter(Boolean))];
    const many = src.days.length > 1;
    box.innerHTML = `<div class="card">
      <div class="row"><h2 class="grow">📁 ${esc(src.name)}</h2><button class="link" id="other">${L("Choose another folder", "اختيار مجلد آخر")}</button></div>
      <p class="muted">${L(`${num(src.count)} photos`, `${num(src.count)} صورة`)}${src.raw ? ` · ${num(src.raw)} RAW` : ""}${src.days.length ? ` · ${src.days.length === 1 ? fmtDate(src.days[0]) : `${fmtDate(src.days[0])} → ${fmtDate(src.days.at(-1))}`}` : ""}</p>
      ${!src.count ? `<div class="note warn">${L("No photos found in this folder.", "لا توجد صور في هذا المجلد.")}</div>` : ""}
      <div class="grid2">
        <label class="field">${L("Event name", "اسم الفعالية")}<input id="i-title" placeholder="${L("e.g. Science fair", "مثال: معرض العلوم")}" value="${esc(src.name.replace(/^\d{4}-\d{2}-\d{2}[\s_-]*/, "").replace(/^DCIM$/i, ""))}" /></label>
        <label class="field">${L("Date", "التاريخ")}<input type="date" id="i-date" value="${esc(src.firstDate ?? new Date().toISOString().slice(0, 10))}" /></label>
      </div>
      <label class="field">${L("Class (optional)", "الفصل (اختياري)")}<input id="i-class" list="i-classes" placeholder="${L("e.g. 4B, or leave empty for the whole school", "مثال: 4B، أو اتركه فارغًا لكل المدرسة")}" /><datalist id="i-classes">${classes.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
      ${many ? `<label class="check"><input type="checkbox" id="i-byday" checked /> ${L(`These photos span ${src.days.length} days: file each day in its own dated folder`, `الصور على مدى ${num(src.days.length)} أيام: ضع كل يوم في مجلد بتاريخه`)}</label>` : ""}
      <label class="check"><input type="checkbox" id="i-dup" checked /> ${L("Leave out photos that are already in the library", "تجاهل الصور الموجودة بالفعل في المكتبة")}</label>
      <label class="check"><input type="checkbox" id="i-arch" /> ${L("Keep on this Mac only (old archive: never sent to the website)", "على هذا الماك فقط (أرشيف قديم: لا يُرسل للموقع أبدًا)")}</label>
      <p class="muted small" id="i-where"></p>
      <div class="row" id="i-go"><span class="grow"></span><button class="btn primary" id="i-run" ${src.count ? "" : "disabled"}>⤓ ${L(`Import ${src.count} photos`, `استيراد ${num(src.count)} صورة`)}</button></div>
      <div class="col hide" id="i-prog"><div class="row"><b class="grow">${L("Copying…", "جارٍ النسخ…")}</b><span id="imp-count" class="muted"></span></div><div class="bar"><i id="imp-bar" style="width: 0%"></i></div></div>
    </div>`;
    const where = () => {
      const t = $("#i-title", box).value.trim() || "…";
      const d = $("#i-date", box).value;
      const c = $("#i-class", box).value.trim();
      const date = d ? new Date(`${d}T12:00:00`) : new Date();
      const y = date.getMonth() >= 8 ? `${date.getFullYear()}-${date.getFullYear() + 1}` : `${date.getFullYear() - 1}-${date.getFullYear()}`;
      const term = date.getMonth() >= 8 || date.getMonth() === 0 ? "Term 1" : "Term 2";
      $("#i-where", box).innerHTML = `${L("They go to", "تذهب إلى")}: <span class="ltr">${esc(`${y} / ${term} / ${d} ${t}${c ? ` / ${c}` : ""}`)}</span>`;
    };
    ["#i-title", "#i-date", "#i-class"].forEach((s) => $(s, box).addEventListener("input", where));
    where();
    $("#other", box).onclick = () => this.pick();
    $("#i-run", box).onclick = async () => {
      const title = $("#i-title", box).value.trim();
      if (title.length < 2) return $("#i-title", box).focus();
      $("#i-go", box).classList.add("hide");
      $("#i-prog", box).classList.remove("hide");
      try {
        IMP.result = await call("runImport", {
          title,
          date: $("#i-date", box).value || null,
          className: $("#i-class", box).value.trim() || null,
          byDay: !!$("#i-byday", box)?.checked,
          skipDuplicates: $("#i-dup", box).checked,
          archive: $("#i-arch", box).checked,
        });
      } finally {
        this.draw();
      }
    };
  },
};
