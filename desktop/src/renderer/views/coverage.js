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
