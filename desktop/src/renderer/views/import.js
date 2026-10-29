// Import: one "Choose folders" button (one folder or many), cards and iPhones
// that open this tab by themselves, shared Drive/OneDrive links, a preview
// of every shot (untick what you don't want, junk shots already left out),
// events split by time gaps and named from the school calendar, a camera
// clock fix, then the copy runs in the background with progress in the
// sidebar. When it finishes: a summary with the next steps.
const IMP = { scan: null, scanning: null, showAlready: false, done: null, device: null, ticked: new Set() };

window.hub.on("importScan", (p) => {
  if (App.view !== "import") return;
  if (p.ready && IMP.scanning === p.id) return App.views.import.openScan(p.id);
  const t = $("#imp-scan");
  if (t) t.innerHTML = progressLine(p.phase === "download" ? L("Copying off the phone or link…", "جارٍ النقل من الهاتف أو الرابط…") : L("Looking at the photos…", "جارٍ فحص الصور…"), p.done, p.total);
});
window.hub.on("importDone", (p) => {
  IMP.done = p;
  if (App.view === "import" && !IMP.scan && !IMP.scanning) App.views.import.draw();
  else toastAction(L(`Import finished: ${num(p.copied)} photos`, `انتهى الاستيراد: ${num(p.copied)} صورة`), L("See summary", "عرض الملخص"), () => go("import", { summary: p.importId }), 9000);
});
window.hub.on("importDevice", (d) => {
  if (IMP.scan || IMP.scanning) return;
  IMP.device = d;
  go("import", { device: d });
});

const progressLine = (label, done, total) =>
  `<div class="row"><b class="grow">${label}</b><span class="muted ltr">${num(done)} / ${num(total)}</span></div><div class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>`;
const timeLeft = (s) => (s == null ? "" : s < 60 ? L("less than a minute left", "أقل من دقيقة متبقية") : s < 3600 ? L(`about ${Math.round(s / 60)} min left`, `حوالي ${num(Math.round(s / 60))} دقيقة متبقية`) : L(`about ${(s / 3600).toFixed(1)} h left`, `حوالي ${num(+(s / 3600).toFixed(1))} ساعة متبقية`));
const JUNK = () => ({ dark: L("Pocket shot", "صورة داخل الجيب"), blank: L("Blank", "فارغة"), blurry: L("Very blurry", "مهزوزة جدًا") });

App.views.import = {
  render(main, params) {
    main.innerHTML = topbar(L("Import", "استيراد"), L("Cards, phones, photographers' folders and shared links. Photos are filed by year, term, event and class.", "كروت ومواقف وهواتف ومجلدات المصورين والروابط. تُرتب الصور حسب السنة والفصل الدراسي والفعالية والفصل."), `<button class="btn" id="i-hist">${icon("history", 14)} ${L("Import history", "سجل الاستيراد")}</button>`) +
      `<div class="content"><div class="col gap16" style="max-width: 1100px" id="imp"></div></div>`;
    $("#i-hist", main).onclick = () => go("history", { imports: true });
    if (params.summary) return this.summary(params.summary);
    if (params.sources?.length || params.source) return this.choose(params.sources ?? [params.source]);
    if (params.device) IMP.device = params.device;
    if (params.scan) return this.openScan(params.scan);
    if (IMP.scanning) return this.drawScanning();
    if (IMP.scan) return this.drawPreview();
    this.draw();
  },
  keys: () => [["⌘O", L("Choose folders", "اختيار مجلدات")], ["⌘A", L("Tick every photo", "تحديد كل الصور")]],
  onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "o") {
      e.preventDefault();
      this.choose();
      return true;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "a" && IMP.scan) {
      e.preventDefault();
      IMP.scan.files.forEach((f) => IMP.ticked.add(f.n));
      this.drawPreview();
      return true;
    }
  },

  async choose(dirs) {
    const r = await call("importChoose", dirs);
    if (r) this.watchScan(r.id);
  },
  watchScan(id) {
    IMP.scanning = id;
    IMP.scan = null;
    this.drawScanning();
    // In case the "ready" news came before the screen was there.
    const poll = async () => {
      if (IMP.scanning !== id) return;
      const s = await quiet("importScan", id);
      if (s?.ready) return this.openScan(id);
      const t = $("#imp-scan");
      if (t && s) t.innerHTML = progressLine(L("Looking at the photos…", "جارٍ فحص الصور…"), s.done, s.total);
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 1500);
  },
  drawScanning() {
    const box = $("#imp");
    if (!box) return;
    box.innerHTML = `<div class="card col gap8"><div id="imp-scan">${progressLine(L("Looking at the photos…", "جارٍ فحص الصور…"), 0, 0)}</div>
      <p class="muted small">${L("Making small previews, reading dates and cameras, and spotting pocket shots, blank and very blurry photos.", "إنشاء معاينات صغيرة وقراءة التواريخ والكاميرات واكتشاف صور الجيب والفارغة والمهزوزة جدًا.")}</p>
      <div class="row"><span class="grow"></span><button class="btn ghost" id="i-stop">${L("Cancel", "إلغاء")}</button></div></div>${skeletonTiles(18)}`;
    $("#i-stop", box).onclick = () => {
      IMP.scanning = null;
      this.draw();
    };
  },
  async openScan(id) {
    const s = await call("importScan", id);
    IMP.scanning = null;
    if (!s) return this.draw();
    IMP.scan = s;
    // Everything is ticked except junk shots and photos already imported.
    IMP.ticked = new Set(s.files.filter((f) => !f.already && !f.junk).map((f) => f.n));
    IMP.opts = { photographer: S.importPhotographer ?? "", category: S.importCategory ?? "", eject: S.importEject !== false, erase: !!S.importErase, archive: false, offsets: {} };
    IMP.showAlready = false;
    this.drawPreview();
  },

  // ---------- Start ----------
  async draw() {
    const box = $("#imp");
    if (!box) return;
    if (!S.library) {
      box.innerHTML = emptyState("folder-search", L("Choose the library folder first", "اختر مجلد المكتبة أولًا"), L("The library is the folder where the school's photos live.", "المكتبة هي المجلد الذي توجد فيه صور المدرسة."), `<button class="btn primary" data-go="settings">${L("Open Settings", "فتح الإعدادات")}</button>`);
      $("[data-go]", box).onclick = () => go("settings", { page: "library" });
      return;
    }
    const [vols, hist, space] = await Promise.all([quiet("volumes"), quiet("importHistory"), quiet("importSpace")]);
    const jobs = S.imports ?? [];
    const dev = IMP.device;
    box.innerHTML = `
      ${IMP.done ? this.doneBanner(IMP.done) : ""}
      ${dev ? `<div class="card hl row"><span class="sic">${icon(dev.kind === "iphone" ? "smartphone" : "memory-stick", 18)}</span><div class="grow"><b>${dev.kind === "iphone" ? L("An iPhone is plugged in", "تم توصيل iPhone") : L(`Card “${esc(dev.name)}” is plugged in`, `تم إدخال الكارت «${esc(dev.name)}»`)}</b><div class="muted small">${L("Only photos not imported before are offered.", "تُعرض فقط الصور التي لم تُستورد من قبل.")}</div></div>
        <button class="btn primary" id="i-dev">${L("Look at the photos", "عرض الصور")}</button><button class="btn ghost" id="i-devx">${icon("x", 14)}</button></div>` : ""}
      ${jobs.length ? `<div class="card col gap12"><h3>${L("Importing", "جارٍ الاستيراد")}</h3>${jobs.map((j) => this.jobRow(j)).join("")}</div>` : ""}
      <div class="drop col" id="drop" style="align-items: center; gap: 10px">
        <span style="opacity: .7">${icon("download", 34)}</span>
        <b style="font-size: 17px">${L("Drag folders or photos here", "اسحب المجلدات أو الصور إلى هنا")}</b>
        <button class="btn primary" id="choose">${icon("folder-open", 15)} ${L("Choose folders…", "اختيار مجلدات…")}</button>
        <p class="small muted" style="max-width: 520px; text-align: center">${L("One folder or many (⌘-click to choose several). A folder named like “2026-10-12 Sports day” becomes that event; a camera card is split into events by the gaps between photos.", "مجلد واحد أو أكثر (⌘ للاختيار المتعدد). المجلد المسمى مثل «2026-10-12 اليوم الرياضي» يصبح تلك الفعالية؛ ويُقسَّم كارت الكاميرا إلى فعاليات حسب الفترات بين الصور.")}</p>
      </div>
      <div class="grid3">
        <div class="card col gap8"><h3>${icon("memory-stick", 15)} ${L("Cards", "الكروت")}</h3>
          ${(vols ?? []).length ? vols.map((v) => `<div class="row"><span class="grow">${esc(v.name)}</span><button class="btn small" data-vol="${esc(v.path)}">${L("Import", "استيراد")}</button><button class="btn small ghost" data-eject="${esc(v.volume)}" title="${L("Eject", "إخراج")}">${icon("circle-arrow-up", 14)}</button></div>`).join("") : `<p class="muted small">${L("Put a camera card in: this tab opens by itself.", "أدخل كارت الكاميرا: يفتح هذا القسم تلقائيًا.")}</p>`}</div>
        <div class="card col gap8"><h3>${icon("smartphone", 15)} iPhone / iPad</h3><p class="muted small">${L("Plug it in and unlock it, then tap Trust on the phone.", "وصّله وافتح قفله، ثم اضغط «ثقة» على الهاتف.")}</p><button class="btn small" id="i-phone" style="align-self: flex-start">${L("Import from iPhone", "استيراد من iPhone")}</button></div>
        <div class="card col gap8"><h3>${icon("link", 15)} ${L("Shared link", "رابط مشاركة")}</h3><p class="muted small">${L("A Google Drive or OneDrive folder shared with “Anyone with the link”.", "مجلد Google Drive أو OneDrive مُشارك مع «أي شخص لديه الرابط».")}</p>
          <div class="row nowrap"><input id="i-link" class="grow ltr" placeholder="https://drive.google.com/…" /><button class="btn small" id="i-linkgo">${L("Open", "فتح")}</button></div></div>
      </div>
      <div class="card row"><span class="sic">${icon("inbox", 16)}</span><div class="grow"><b>${L("“Drop here” folder", "مجلد «ضع هنا»")}</b><div class="muted small">${L("Anything put in this folder in the library files itself into the right year, term and event after a minute.", "أي صور توضع في هذا المجلد داخل المكتبة تُرتَّب تلقائيًا في السنة والفصل والفعالية الصحيحة بعد دقيقة.")}</div></div><button class="btn small" id="i-drop">${L("Show in Finder", "عرض في Finder")}</button></div>
      ${space ? `<p class="muted small">${L(`${fmtBytes(space.free)} free on the library drive.`, `${fmtBytes(space.free)} متاحة على قرص المكتبة.`)}</p>` : ""}
      ${(hist ?? []).length ? `<div class="card col gap8"><div class="row"><h3 class="grow">${L("Recent imports", "آخر عمليات الاستيراد")}</h3></div>
        ${hist.slice(0, 6).map((h) => `<div class="row srow" data-sum="${h.id}" style="cursor: pointer"><span class="grow">${esc(h.source ?? "")}${h.photographer ? ` · ${esc(h.photographer)}` : ""}</span><span class="muted small">${L(`${num(h.copied)} photos`, `${num(h.copied)} صورة`)} · ${fmtDate(new Date(h.at).toISOString())}${h.undone ? ` · ${L("undone", "أُلغي")}` : ""}</span>${icon("chevron-right", 14)}</div>`).join("")}</div>` : ""}`;
    $("#choose", box).onclick = () => this.choose();
    $("#i-dev", box)?.addEventListener("click", () => (dev.kind === "iphone" ? this.iphone() : this.card(dev.path)));
    $("#i-devx", box)?.addEventListener("click", () => { IMP.device = null; this.draw(); });
    $$("[data-vol]", box).forEach((b) => (b.onclick = () => this.card(b.dataset.vol)));
    $$("[data-eject]", box).forEach((b) => (b.onclick = async () => { if (await call("ejectCard", b.dataset.eject)) toast(L("Safe to remove the card", "يمكن إخراج الكارت بأمان")); this.draw(); }));
    $("#i-phone", box).onclick = () => this.iphone();
    $("#i-linkgo", box).onclick = () => this.link($("#i-link", box).value);
    $("#i-link", box).onkeydown = (e) => e.key === "Enter" && this.link(e.target.value);
    $("#i-drop", box).onclick = () => call("dropFolder");
    $$("[data-sum]", box).forEach((r) => (r.onclick = () => this.summary(Number(r.dataset.sum))));
    this.bindJobs(box);
    $("#i-sum", box)?.addEventListener("click", () => this.summary(IMP.done.importId));
    $("#i-sumx", box)?.addEventListener("click", () => { IMP.done = null; this.draw(); });
  },
  doneBanner(d) {
    return `<div class="card hl row"><span class="sic" style="background: var(--good-bg); color: var(--good)">${icon("check", 16)}</span><div class="grow"><b>${L(`Import finished: ${num(d.copied)} photos`, `انتهى الاستيراد: ${num(d.copied)} صورة`)}</b>
      <div class="muted small">${d.safeToRemove ? (d.ejected ? L("The card was ejected: safe to remove it.", "أُخرج الكارت: يمكن نزعه بأمان.") : L("Every photo was checked: safe to remove the card.", "تم التحقق من كل الصور: يمكن نزع الكارت بأمان.")) : ""}${d.erased ? ` ${L(`${num(d.erased)} photos erased from the card.`, `حُذفت ${num(d.erased)} صورة من الكارت.`)}` : ""}</div></div>
      <button class="btn primary" id="i-sum">${L("See summary", "عرض الملخص")}</button><button class="btn ghost" id="i-sumx">${icon("x", 14)}</button></div>`;
  },
  jobRow(j) {
    const state = j.state === "running" ? timeLeft(j.left) : j.waitingForCard ? L("Waiting: plug the card back in to carry on", "في الانتظار: أعد إدخال الكارت للمتابعة") : j.state === "problem" ? L(`Stopped: ${j.error}`, `توقف: ${j.error}`) : j.state === "waiting" ? L("Waiting for the one before", "في انتظار السابق") : j.state === "done" ? L("Finished", "انتهى") : L("Cancelled", "أُلغي");
    const live = j.state === "running" || j.state === "waiting" || j.state === "problem";
    return `<div class="col gap4"><div class="row nowrap"><b class="grow">${esc(j.title)}</b><span class="muted small">${esc(state)}</span>
      ${live ? `<button class="btn small ghost" data-open="${j.importId}" title="${L("Start picking while it copies", "ابدأ الاختيار أثناء النسخ")}">${icon("images", 14)}</button>` : `<button class="btn small" data-sumj="${j.importId}">${L("Summary", "الملخص")}</button>`}
      ${j.state === "problem" ? `<button class="btn small" data-retry="${j.id}">${L("Try again", "إعادة المحاولة")}</button>` : ""}
      ${live ? `<button class="btn small ghost" data-cancel="${j.id}" title="${L("Stop", "إيقاف")}">${icon("x", 14)}</button>` : ""}</div>
      ${live ? `<div class="bar"><i style="width:${j.total ? (j.done / j.total) * 100 : 0}%"></i></div><span class="muted small ltr">${num(j.done)} / ${num(j.total)}</span>` : ""}</div>`;
  },
  bindJobs(box) {
    $$("[data-open]", box).forEach((b) => (b.onclick = () => go("library", { album: `imp:${b.dataset.open}`, title: L("This import", "هذا الاستيراد") })));
    $$("[data-sumj]", box).forEach((b) => (b.onclick = () => this.summary(Number(b.dataset.sumj))));
    $$("[data-retry]", box).forEach((b) => (b.onclick = () => call("importRetry", Number(b.dataset.retry))));
    $$("[data-cancel]", box).forEach((b) => (b.onclick = async () => { if (await confirmBox(L("Stop this import? Photos already copied stay in the library.", "إيقاف هذا الاستيراد؟ الصور التي نُسخت تبقى في المكتبة."))) call("importCancel", Number(b.dataset.cancel)); }));
  },
  onState(changed) {
    if (App.view !== "import" || IMP.scan || IMP.scanning) return;
    if (changed?.includes("status")) {
      const card = $("#imp .card h3")?.closest(".card");
      if (card && (S.imports ?? []).length && card.textContent.includes(L("Importing", "جارٍ الاستيراد"))) {
        card.innerHTML = `<h3>${L("Importing", "جارٍ الاستيراد")}</h3>${S.imports.map((j) => this.jobRow(j)).join("")}`;
        this.bindJobs(card);
      }
    }
  },
  async card(dcim) {
    IMP.device = null;
    const r = await call("importCard", dcim);
    if (r) this.watchScan(r.id);
  },
  async iphone() {
    IMP.device = null;
    IMP.scanning = "iphone";
    this.drawScanning();
    $("#imp-scan").innerHTML = progressLine(L("Copying off the phone… keep it unlocked", "جارٍ النقل من الهاتف… أبقِه مفتوح القفل"), 0, 0);
    try {
      const r = await call("importIphone");
      if (r?.needTools) {
        IMP.scanning = null;
        this.draw();
        return infoBox(L("One-time step", "خطوة لمرة واحدة"), L("The Mac is asking to install Apple's free developer tools: click Install. When it finishes, click Import from iPhone again.", "يطلب الماك تثبيت أدوات المطوّر المجانية من Apple: اضغط «تثبيت». عند الانتهاء، اضغط «استيراد من iPhone» مرة أخرى."));
      }
      if (r) this.watchScan(r.id);
    } catch {
      IMP.scanning = null;
      this.draw();
      toast(L("Couldn't read the iPhone. Unlock it, tap Trust, and try again.", "تعذّرت قراءة iPhone. افتح قفله واضغط «ثقة» وحاول مرة أخرى."));
    }
  },
  async link(url) {
    if (!url?.trim()) return;
    IMP.scanning = "link";
    this.drawScanning();
    $("#imp-scan").innerHTML = progressLine(L("Downloading from the link…", "جارٍ التنزيل من الرابط…"), 0, 0);
    try {
      const r = await call("importLink", url.trim());
      if (r) this.watchScan(r.id);
    } catch {
      IMP.scanning = null;
      this.draw();
    }
  },

  // ---------- Preview ----------
  async drawPreview() {
    const box = $("#imp");
    const s = IMP.scan;
    if (!box || !s) return;
    const o = IMP.opts;
    const classes = [...new Set(((await quiet("classes")) ?? []).map((c) => c.class_name).filter(Boolean))];
    const files = new Map(s.files.map((f) => [f.n, f]));
    const already = s.files.filter((f) => f.already).length;
    const junk = s.files.filter((f) => f.junk && !f.already).length;
    const chosen = () => [...IMP.ticked].filter((n) => files.has(n));
    const bytes = chosen().reduce((a, n) => a + files.get(n).size, 0);
    const cams = s.cameras.filter((c) => c.camera);
    const card = s.kind === "card";
    box.innerHTML = `
      <div class="card col gap12">
        <div class="row"><h2 class="grow">${icon(card ? "memory-stick" : s.kind === "iphone" ? "smartphone" : s.kind === "link" ? "link" : "folder", 18)} ${esc(s.label)}</h2><button class="btn ghost" id="i-back">${L("Choose other folders", "اختيار مجلدات أخرى")}</button></div>
        <p class="muted">${L(`${num(s.files.length)} photos in ${num(s.events.length)} events`, `${num(s.files.length)} صورة في ${num(s.events.length)} فعاليات`)}${already ? ` · ${L(`${num(already)} imported before (left out)`, `${num(already)} استُوردت من قبل (مستبعدة)`)}` : ""}${junk ? ` · ${L(`${num(junk)} junk shots left out`, `${num(junk)} صور غير صالحة مستبعدة`)}` : ""}</p>
        ${s.tooBig ? `<div class="note warn row"><span class="grow">${L(`Not enough space: these need ${fmtBytes(s.tooBig.need)} and the library drive has ${fmtBytes(s.tooBig.free)} free.`, `المساحة غير كافية: تحتاج ${fmtBytes(s.tooBig.need)} والقرص فيه ${fmtBytes(s.tooBig.free)} فقط.`)}</span><button class="btn small" id="i-arch">${L("Move old years to the archive drive", "نقل السنوات القديمة إلى قرص الأرشيف")}</button></div>` : ""}
        <div class="grid3">
          <label class="field">${L("Taken by", "التصوير بواسطة")}<input id="o-ph" value="${esc(o.photographer)}" placeholder="${L("Photographer's name", "اسم المصور")}" /></label>
          <label class="field">${L("Kind of photos", "نوع الصور")}<select id="o-cat"><option value="">${L("Find out from the event name", "يُحدَّد من اسم الفعالية")}</option>${Object.entries(CATS()).map(([k, [label]]) => `<option value="${k}" ${o.category === k ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
          <div class="col gap4">${card ? `<label class="check">${sw("data-o", o.eject, 'data-k="eject"')} ${L("Eject the card when done", "إخراج الكارت عند الانتهاء")}</label><label class="check">${sw("data-o", o.erase, 'data-k="erase"')} ${L("Erase copied photos from the card", "حذف الصور المنسوخة من الكارت")}</label>` : ""}
            <label class="check">${sw("data-o", o.archive, 'data-k="archive"')} ${L("Keep on this Mac only (never sent)", "على هذا الماك فقط (لا يُرسل)")}</label></div>
        </div>
        ${cams.length ? `<details class="adv"><summary>${L("Camera clock wrong?", "ساعة الكاميرا خاطئة؟")}</summary><div class="col gap8" style="padding-top: 8px">
          <p class="muted small">${L("If a camera's clock was wrong, type the real time of its first photo. Every photo from that camera moves by the same amount.", "إذا كانت ساعة الكاميرا خاطئة، اكتب الوقت الصحيح لأول صورة. تتحرك كل صور هذه الكاميرا بنفس المقدار.")}</p>
          ${cams.map((c, i) => `<div class="row"><span class="grow">${esc(c.camera)} <span class="muted small">(${num(c.n)})</span></span><span class="muted small ltr">${new Date(c.first).toLocaleString()}</span> → <input type="datetime-local" data-cam="${i}" value="${localInput(c.first + (o.offsets[c.camera] ?? 0))}" /></div>`).join("")}</div></details>` : ""}
      </div>
      ${already ? `<label class="check muted">${sw("data-showal", IMP.showAlready)} ${L(`Show the ${num(already)} photos imported before`, `عرض ${num(already)} صورة استُوردت من قبل`)}</label>` : ""}
      ${s.events.map((e) => this.eventBlock(e, files, classes)).join("")}
      <datalist id="i-classes">${classes.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist>
      <div class="ibar"><span class="grow"><b>${L(`${num(chosen().length)} photos ticked`, `${num(chosen().length)} صورة محددة`)}</b> <span class="muted">· ${fmtBytes(bytes)}</span></span>
        <button class="btn primary" id="i-go" ${chosen().length ? "" : "disabled"}>${icon("download", 15)} ${L(`Import ${num(chosen().length)} photos`, `استيراد ${num(chosen().length)} صورة`)}</button></div>`;
    $("#i-back", box).onclick = () => { IMP.scan = null; this.choose(); };
    $("#i-arch", box)?.addEventListener("click", () => go("settings", { page: "storage" }));
    $("#o-ph", box).oninput = (e) => (o.photographer = e.target.value);
    $("#o-cat", box).onchange = (e) => (o.category = e.target.value);
    $$("[data-o]", box).forEach((c) => (c.onchange = () => (o[c.dataset.k] = c.checked)));
    $("[data-showal]", box)?.addEventListener("change", (e) => { IMP.showAlready = e.target.checked; this.drawPreview(); });
    $$("[data-cam]", box).forEach((inp) => (inp.onchange = () => {
      const c = cams[inp.dataset.cam];
      const t = new Date(inp.value).getTime();
      if (!Number.isNaN(t)) o.offsets[c.camera] = t - c.first;
      this.redate();
    }));
    $$("[data-ev]", box).forEach((inp) => (inp.oninput = () => (s.events[inp.dataset.ev][inp.dataset.f] = inp.value)));
    $$("[data-evplace]", box).forEach((inp) => inp.addEventListener("change", () => this.where(Number(inp.dataset.evplace))));
    $$("[data-evall]", box).forEach((c) => (c.onchange = () => {
      const e = s.events[c.dataset.evall];
      e.files.forEach((n) => (c.checked ? IMP.ticked.add(n) : IMP.ticked.delete(n)));
      this.drawPreview();
    }));
    $$("[data-merge]", box).forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.merge);
      s.events[i - 1].files.push(...s.events[i].files);
      s.events.splice(i, 1);
      s.events.forEach((e, k) => (e.id = k));
      this.drawPreview();
    }));
    $$(".itile", box).forEach((t) => {
      t.onclick = (e) => {
        const n = Number(t.dataset.n);
        if (e.shiftKey && IMP.last != null) {
          const all = s.files.map((f) => f.n);
          const [a, b] = [all.indexOf(IMP.last), all.indexOf(n)].sort((x, y) => x - y);
          all.slice(a, b + 1).forEach((k) => IMP.ticked.add(k));
        } else IMP.ticked.has(n) ? IMP.ticked.delete(n) : IMP.ticked.add(n);
        IMP.last = n;
        this.drawPreview();
      };
    });
    s.events.forEach((e) => this.where(e.id));
    $("#i-go", box).onclick = () => this.start();
  },
  eventBlock(e, files, classes) {
    const shown = e.files.map((n) => files.get(n)).filter((f) => f && (IMP.showAlready || !f.already));
    const ticked = e.files.filter((n) => IMP.ticked.has(n)).length;
    if (!shown.length && !ticked) return "";
    return `<div class="card col gap8">
      <div class="row nowrap">
        <input type="checkbox" data-evall="${e.id}" ${ticked === e.files.length ? "checked" : ""} title="${L("Tick all", "تحديد الكل")}" />
        <input data-ev="${e.id}" data-f="title" value="${esc(e.title)}" placeholder="${L("Event name, e.g. Sports day", "اسم الفعالية، مثل اليوم الرياضي")}" class="grow" style="font-weight: 600; font-size: 15px" />
        <input type="date" data-ev="${e.id}" data-f="date" data-evplace="${e.id}" value="${esc(e.date)}" />
        <input data-ev="${e.id}" data-f="className" data-evplace="${e.id}" list="i-classes" placeholder="${L("Class", "الفصل")}" value="${esc(e.className ?? "")}" style="width: 80px" />
        ${e.id > 0 ? `<button class="btn small ghost" data-merge="${e.id}" title="${L("Join with the event above", "دمج مع الفعالية السابقة")}">${icon("merge", 14)}</button>` : ""}
      </div>
      <div class="muted small row"><span class="grow" id="where-${e.id}"></span><span>${L(`${num(ticked)} of ${num(e.files.length)}`, `${num(ticked)} من ${num(e.files.length)}`)}${e.from ? ` · ${esc(e.from)}` : ""}</span></div>
      <div class="igrid">${shown.map((f) => this.tile(f)).join("")}</div></div>`;
  },
  tile(f) {
    const on = IMP.ticked.has(f.n);
    const badge = f.already ? L("Imported before", "استُوردت من قبل") : f.junk ? JUNK()[f.junk] : "";
    return `<div class="tile itile ${on ? "" : "off"}" data-n="${f.n}" title="${esc(f.name)}" style="${on ? "" : "opacity: .38"}">
      ${f.video ? `<div class="vph">${icon("film", 22)}</div>` : `<img loading="lazy" src="hub://ithumb/${f.thumb}" />`}
      <span class="tick" style="position:absolute;top:6px;inset-inline-start:6px">${icon(on ? "circle-check" : "circle", 18)}</span>
      ${f.burst != null && !f.best ? `<span class="b stackn" title="${L("Burst: best shot first", "تتابع: الأفضل أولًا")}">${icon("layers", 11)}</span>` : ""}
      ${f.raw ? `<span class="b">RAW</span>` : ""}${badge ? `<span class="b miss">${esc(badge)}</span>` : ""}</div>`;
  },
  // Dates moved by a camera clock fix: events follow their first photo.
  redate() {
    const s = IMP.scan;
    const byN = new Map(s.files.map((f) => [f.n, f]));
    for (const e of s.events) {
      const f = byN.get(e.files[0]);
      if (!f) continue;
      const d = new Date(f.taken + (IMP.opts.offsets[f.camera] ?? 0));
      e.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    this.drawPreview();
  },
  async where(i) {
    const e = IMP.scan?.events[i];
    const el = $(`#where-${i}`);
    if (!e || !el) return;
    const p = await quiet("placeFor", e.date);
    el.innerHTML = p ? `${icon("folder", 12)} <span class="ltr">${esc(`${p.year} / ${p.term} / ${e.date} ${e.title || "…"}${e.className ? ` / ${e.className}` : ""}`)}</span>` : "";
  },
  async start() {
    const s = IMP.scan;
    const events = s.events.map((e) => ({ title: e.title.trim(), date: e.date, className: e.className?.trim() || null, files: e.files.filter((n) => IMP.ticked.has(n)) })).filter((e) => e.files.length);
    const unnamed = events.findIndex((e) => e.title.length < 2);
    if (unnamed >= 0) {
      toast(L("Give every event a name first", "اكتب اسمًا لكل فعالية أولًا"));
      return $(`[data-ev][data-f="title"]`, $("#imp"))?.focus();
    }
    const o = IMP.opts;
    if (o.erase && !(await confirmBox(L("Erase the photos from the card after each one is checked in the library?", "حذف الصور من الكارت بعد التحقق من وصول كل صورة إلى المكتبة؟")))) return;
    const r = await call("importStart", { scanId: s.id, events, photographer: o.photographer, category: o.category, offsets: o.offsets, eject: o.eject, erase: o.erase, archive: o.archive });
    IMP.scan = null;
    if (!r) return this.draw();
    toastAction(L("Importing in the background. You can keep working.", "يجري الاستيراد في الخلفية. يمكنك مواصلة العمل."), L("Start picking", "ابدأ الاختيار"), () => go("library", { album: `imp:${r.importId}`, title: L("This import", "هذا الاستيراد") }), 8000);
    this.draw();
  },

  // ---------- Summary ----------
  async summary(id) {
    const box = $("#imp");
    if (!box) return;
    const r = await call("importSummary", id);
    if (!r) return this.draw();
    const why = { already: L("Already in the library", "موجودة بالفعل في المكتبة"), unticked: L("Unticked", "غير محددة"), cancelled: L("Import stopped", "أُوقف الاستيراد"), "junk-dark": JUNK().dark, "junk-blank": JUNK().blank, "junk-blurry": JUNK().blurry };
    const counts = {};
    r.report.forEach((x) => (counts[x.why.startsWith("failed") ? "failed" : x.why] = (counts[x.why.startsWith("failed") ? "failed" : x.why] ?? 0) + 1));
    const title = r.events.length === 1 ? r.events[0].title : r.source;
    box.innerHTML = `<div class="card col gap12">
      <div class="row"><h2 class="grow">${icon("circle-check", 18)} ${esc(r.source ?? "")}</h2><span class="muted small">${fmtDate(new Date(r.at).toISOString())}${r.photographer ? ` · ${esc(r.photographer)}` : ""}</span></div>
      <p>${L(`${num(r.photos)} photos are in the library`, `${num(r.photos)} صورة في المكتبة`)}${r.events.length ? ` · ${r.events.map((e) => esc(e.title)).join("، ")}` : ""}</p>
      ${r.undone ? `<div class="note warn">${L("This import was undone: its photos are in the Bin.", "أُلغي هذا الاستيراد: صوره في سلة المحذوفات.")}</div>` : ""}
      ${r.classSuggestion ? `<div class="note row"><span class="grow">${L(`Most students recognised are from ${esc(r.classSuggestion.className)}. File these photos under ${esc(r.classSuggestion.className)}?`, `معظم الطلاب الذين تم التعرف عليهم من ${esc(r.classSuggestion.className)}. ترتيب الصور تحت ${esc(r.classSuggestion.className)}؟`)}</span><button class="btn small primary" id="s-class">${L("Yes, file them", "نعم، رتّبها")}</button></div>` : ""}
      <h3>${L("Next steps", "الخطوات التالية")}</h3>
      <div class="grid3">
        <button class="btn" id="s-pick">${icon("star", 15)} ${L("Pick the best", "اختيار الأفضل")}</button>
        <button class="btn" id="s-faces">${icon("scan-face", 15)} ${r.unnamed ? L(`Name ${num(r.unnamed)} faces`, `تسمية ${num(r.unnamed)} وجه`) : L("Faces", "الوجوه")}</button>
        <button class="btn" id="s-post">${icon("send", 15)} ${L("Make posts", "إنشاء منشورات")}</button>
        <button class="btn" id="s-see">${icon("images", 15)} ${L("See the photos", "عرض الصور")}</button>
        <button class="btn" id="s-finder">${icon("folder-open", 15)} ${L("Show in Finder", "عرض في Finder")}</button>
        ${r.undone ? "" : `<button class="btn ghost" id="s-undo">${icon("undo-2", 15)} ${L("Undo this import", "إلغاء هذا الاستيراد")}</button>`}
      </div>
      ${r.report.length ? `<details class="adv"><summary>${L(`${num(r.report.length)} files left out`, `${num(r.report.length)} ملف مستبعد`)} · ${Object.entries(counts).map(([k, n]) => `${esc(k === "failed" ? L("Couldn't copy", "تعذّر النسخ") : why[k] ?? k)} ${num(n)}`).join(" · ")}</summary>
        <div class="col gap4" style="max-height: 260px; overflow: auto; padding-top: 8px">${r.report.slice(0, 400).map((x) => `<div class="row small"><span class="grow ltr pathtxt">${esc(x.file)}</span><span class="muted">${esc(x.why.startsWith("failed") ? L("Couldn't copy", "تعذّر النسخ") : why[x.why] ?? x.why)}</span></div>`).join("")}</div>
        <button class="btn small" id="s-csv" style="margin-top: 8px">${L("Save the list", "حفظ القائمة")}</button></details>` : ""}
      <div class="row"><span class="grow"></span><button class="btn primary" id="s-more">${L("Import more", "استيراد المزيد")}</button></div></div>`;
    const album = { album: `imp:${id}`, title: L("This import", "هذا الاستيراد") };
    $("#s-pick", box).onclick = () => go("library", { ...album, cull: true });
    $("#s-see", box).onclick = () => go("library", album);
    $("#s-faces", box).onclick = () => go("faces", { importId: id });
    $("#s-post", box).onclick = () => typeof makePostsFrom === "function" && makePostsFrom({ album: `imp:${id}` }, title);
    $("#s-finder", box).onclick = () => r.folders[0] && call("revealFolder", r.folders[0]);
    $("#s-undo", box)?.addEventListener("click", async () => {
      if (!(await confirmBox(L(`Move the ${num(r.photos)} photos of this import to the Bin? They can be put back for 30 days.`, `نقل ${num(r.photos)} صورة من هذا الاستيراد إلى السلة؟ يمكن استعادتها لمدة 30 يومًا.`)))) return;
      await call("undoImport", id);
      this.summary(id);
    });
    $("#s-class", box)?.addEventListener("click", async () => {
      const n = await call("importApplyClass", id, r.classSuggestion.className);
      toast(L(`${num(n)} photos filed under ${r.classSuggestion.className}`, `رُتبت ${num(n)} صورة تحت ${r.classSuggestion.className}`));
      this.summary(id);
    });
    $("#s-csv", box)?.addEventListener("click", () => call("importSaveReport", id));
    $("#s-more", box).onclick = () => { IMP.done = null; this.draw(); };
  },
};

function localInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
