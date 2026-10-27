// Faces: confirm what the Mac suggests, and name groups of unknown faces.
const FC = { tab: "suggest", off: new Set(), groupOff: new Set() };

App.views.faces = {
  render(main, params) {
    if (params.tab) FC.tab = params.tab;
    main.innerHTML = topbar(L("Faces", "الوجوه"), `<span id="fc-sub"></span>`,
      `<button class="pill ${FC.tab === "suggest" ? "on" : ""}" data-tab="suggest">${L("Suggestions", "الاقتراحات")}</button><button class="pill ${FC.tab === "unknown" ? "on" : ""}" data-tab="unknown">${L("Who is this?", "من هذا؟")}</button>`) +
      `<div class="content"><div class="col gap16" id="fc"></div></div>`;
    $$("[data-tab]", main).forEach((b) => (b.onclick = () => { FC.tab = b.dataset.tab; go("faces"); }));
    this.fill();
  },
  onState(changed) {
    this.sub();
    if (changed.includes("faces") && !FC.busy) {
      clearTimeout(FC.t);
      FC.t = setTimeout(() => this.fill(), 1500);
    }
  },
  sub() {
    const e = S.engine ?? {};
    const el = $("#fc-sub");
    if (el) el.textContent = [!S.faces ? L("Face finding is off (Settings)", "البحث عن الوجوه متوقف (الإعدادات)") : e.faceQueue ? L(`Looking for faces in ${num(e.faceQueue)} photos…`, `جارٍ البحث عن الوجوه في ${num(e.faceQueue)} صورة…`) : L("All photos checked for faces", "تم فحص كل الصور"), L(`${num(S.counts.tagged)} named`, `${num(S.counts.tagged)} مسمّاة`)].join(" · ");
  },
  async fill() {
    this.sub();
    const box = $("#fc");
    if (!box) return;
    if (!S.counts.students) {
      box.innerHTML = `<div class="empty"><span class="big">☷</span><b>${L("Import the class lists first", "استورد قوائم الفصول أولًا")}</b><span>${L("The app names faces from your students. Portraits help it learn faster.", "يسمّي التطبيق الوجوه من طلابك. الصور الشخصية تساعده على التعلّم أسرع.")}</span><button class="btn primary" id="go-imp">${L("Import class list", "استيراد قائمة الفصول")}</button></div>`;
      $("#go-imp", box).onclick = () => go("students", { import: true });
      return;
    }
    return FC.tab === "suggest" ? this.suggestions(box) : this.unknown(box);
  },
  async suggestions(box) {
    const groups = (await quiet("suggestions", 30)) ?? [];
    if (!$("#fc")) return;
    if (!groups.length) {
      box.innerHTML = `<div class="empty"><span class="big">☺</span><b>${L("No suggestions right now", "لا توجد اقتراحات الآن")}</b>
        <span>${S.counts.tagged ? L("Name a few more faces in “Who is this?” and the Mac will find the same children in other photos.", "سمِّ بعض الوجوه في «من هذا؟» وسيجد الماك نفس الأطفال في صور أخرى.") : L("Start in “Who is this?”: name a child once and the Mac finds them in the other photos.", "ابدأ من «من هذا؟»: سمِّ الطفل مرة واحدة وسيجده الماك في الصور الأخرى.")}</span>
        <button class="btn primary" id="to-unknown">${L("Who is this?", "من هذا؟")}</button></div>`;
      $("#to-unknown", box).onclick = () => { FC.tab = "unknown"; go("faces"); };
      return;
    }
    box.innerHTML = `<p class="muted">${L("Click a face that isn't them to leave it out, then confirm. Each confirmation teaches the Mac.", "اضغط على أي وجه ليس له لاستبعاده، ثم أكّد. كل تأكيد يعلّم الماك.")}</p>` +
      groups.map((g, gi) => `<div class="card" data-g="${gi}"><div class="row nowrap">${avatar(g.student)}<div class="grow"><b>${esc(name(g.student))}</b><div class="small muted">${esc(g.student?.class_name ?? "")}${g.n > g.faces.length ? ` · ${L(`showing ${g.faces.length} of ${g.n}`, `يُعرض ${num(g.faces.length)} من ${num(g.n)}`)}` : ""}</div></div>
        <button class="btn small" data-none="${gi}">${L("None of these", "ليس أيًّا منهم")}</button><button class="btn small primary" data-ok="${gi}">✓ ${L("Confirm", "تأكيد")} <span data-n="${gi}"></span></button></div>
        <div class="faces">${g.faces.map((f) => `<div class="face ${FC.off.has(f.id) ? "off" : ""}" data-f="${f.id}" title="${L("Click to leave out · double-click to open the photo", "اضغط للاستبعاد · اضغط مرتين لفتح الصورة")}"><img loading="lazy" src="hub://face/${f.id}" /><span class="sc">${Math.round(f.suggest_score * 100)}%</span></div>`).join("")}</div></div>`).join("");
    const count = (gi) => {
      const n = groups[gi].faces.filter((f) => !FC.off.has(f.id)).length;
      const el = $(`[data-n="${gi}"]`, box);
      if (el) el.textContent = `(${num(n)})`;
    };
    groups.forEach((_, gi) => count(gi));
    $$(".face", box).forEach((el) => {
      el.onclick = () => {
        const id = Number(el.dataset.f);
        FC.off.has(id) ? FC.off.delete(id) : FC.off.add(id);
        el.classList.toggle("off");
        count(Number(el.closest("[data-g]").dataset.g));
      };
      el.ondblclick = () => {
        const g = groups[Number(el.closest("[data-g]").dataset.g)];
        const f = g.faces.find((x) => x.id === Number(el.dataset.f));
        openViewer(g.faces.map((x) => x.photo_id), g.faces.indexOf(f), {});
      };
    });
    $$("[data-ok]", box).forEach((b) => (b.onclick = async () => {
      const g = groups[Number(b.dataset.ok)];
      const yes = g.faces.filter((f) => !FC.off.has(f.id)).map((f) => f.id);
      const no = g.faces.filter((f) => FC.off.has(f.id)).map((f) => f.id);
      FC.busy = true;
      if (yes.length) await call("confirmFaces", yes, g.student.id);
      if (no.length) await call("rejectFaces", no);
      FC.busy = false;
      no.forEach((id) => FC.off.delete(id));
      toast(L(`${yes.length} photos of ${name(g.student)} confirmed`, `تم تأكيد ${num(yes.length)} صورة لـ ${name(g.student)}`), { undo: true });
      b.closest(".card").remove();
    }));
    $$("[data-none]", box).forEach((b) => (b.onclick = async () => {
      const g = groups[Number(b.dataset.none)];
      await call("rejectFaces", g.faces.map((f) => f.id));
      b.closest(".card").remove();
    }));
  },
  async unknown(box) {
    const groups = (await quiet("unknownGroups")) ?? [];
    if (!$("#fc")) return;
    if (!groups.length) {
      box.innerHTML = `<div class="empty"><span class="big">✓</span><b>${L("No groups of unknown faces", "لا توجد مجموعات وجوه مجهولة")}</b><span>${L("When the Mac sees the same new face in several photos, it groups them here so you name them once.", "عندما يرى الماك نفس الوجه الجديد في عدة صور، يجمعها هنا لتسمّيها مرة واحدة.")}</span></div>`;
      return;
    }
    box.innerHTML = `<p class="muted">${L("Each group looks like one child. Click faces that don't belong, then give the group a name.", "كل مجموعة تبدو لطفل واحد. اضغط على الوجوه التي لا تنتمي، ثم سمِّ المجموعة.")}</p>` +
      groups.map((g, gi) => `<div class="card" data-g="${gi}"><div class="row"><b class="grow">${L(`Same child? ${g.ids.length} faces in ${g.photos} photos`, `نفس الطفل؟ ${num(g.ids.length)} وجه في ${num(g.photos)} صورة`)}</b>
        <button class="btn small" data-hide="${gi}">${L("Not faces", "ليست وجوهًا")}</button><button class="btn small" data-skip="${gi}">${L("Skip", "تخطٍّ")}</button><button class="btn small primary" data-name="${gi}">${L("Name…", "تسمية…")}</button></div>
        <div class="faces">${g.ids.slice(0, 40).map((id) => `<div class="face ${FC.groupOff.has(id) ? "off" : ""}" data-f="${id}"><img loading="lazy" src="hub://face/${id}" /></div>`).join("")}</div></div>`).join("");
    $$(".face", box).forEach((el) => (el.onclick = () => {
      const id = Number(el.dataset.f);
      FC.groupOff.has(id) ? FC.groupOff.delete(id) : FC.groupOff.add(id);
      el.classList.toggle("off");
    }));
    $$("[data-name]", box).forEach((b) => (b.onclick = () => {
      const g = groups[Number(b.dataset.name)];
      const ids = g.ids.slice(0, 40).filter((id) => !FC.groupOff.has(id));
      pickStudent(L("Who is this?", "من هذا؟"), async (s) => {
        FC.busy = true;
        await call("confirmFaces", ids, s.id);
        FC.busy = false;
        toast(L(`${ids.length} faces named ${name(s)}. Looking for more…`, `سُمّي ${num(ids.length)} وجه باسم ${name(s)}. جارٍ البحث عن المزيد…`), { undo: true });
        b.closest(".card").remove();
      });
    }));
    $$("[data-skip]", box).forEach((b) => (b.onclick = () => b.closest(".card").remove()));
    $$("[data-hide]", box).forEach((b) => (b.onclick = async () => {
      const g = groups[Number(b.dataset.hide)];
      await call("hideFaces", g.ids.slice(0, 40).filter((id) => !FC.groupOff.has(id)));
      b.closest(".card").remove();
    }));
  },
};
