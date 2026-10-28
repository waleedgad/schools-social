// Faces, like the People album in Apple Photos: a grid of round faces, a
// page per student, a quick "Is this …?" review, and groups of new faces to
// name. Suggestions under 50% are guesses and never shown.
const FC = { tab: "people", off: new Set(), groupOff: new Set(), className: "", search: "" };
const faceImg = (s, big = false) => (s?.face ? `<img class="pface ${big ? "big" : ""}" loading="lazy" src="hub://face/${s.face}" />` : avatar(s, big));

App.views.faces = {
  render(main, params) {
    if (params.tab) FC.tab = params.tab === "suggest" ? "review" : params.tab;
    FC.only = params.students ?? null;
    const tab = (id, label) => `<button class="pill ${FC.tab === id ? "on" : ""}" data-tab="${id}">${label}</button>`;
    main.innerHTML = topbar(L("Faces", "الوجوه"), `<span id="fc-sub"></span>`,
      tab("people", L("People", "الأشخاص")) + tab("review", L("Is this …?", "هل هذا …؟")) + tab("unknown", L("Who is this?", "من هذا؟"))) +
      `<div class="content"><div class="col gap16" id="fc"></div></div>`;
    $$("[data-tab]", main).forEach((b) => (b.onclick = () => { FC.tab = b.dataset.tab; go("faces"); }));
    this.fill();
  },
  onState(changed) {
    this.sub();
    if (changed.includes("faces") && !FC.busy && FC.tab !== "review") {
      clearTimeout(FC.t);
      FC.t = setTimeout(() => this.fill(), 1500);
    }
  },
  onKey(e) {
    if (FC.tab === "review" && FC.answer) {
      const k = e.key.toLowerCase();
      if (k === "y") return FC.answer(true);
      if (k === "n") return FC.answer(false);
      if (k === "s") return FC.answer(null);
    }
  },
  sub() {
    const e = S.engine ?? {};
    const el = $("#fc-sub");
    if (el) el.textContent = [!S.faces ? L("Face finding is off (Settings)", "البحث عن الوجوه متوقف (الإعدادات)") : e.faceQueue ? L(`Looking for faces in ${num(e.faceQueue)} photos…`, `جارٍ البحث عن الوجوه في ${num(e.faceQueue)} صورة…`) : L(`${num(S.counts.tagged)} faces named`, `${num(S.counts.tagged)} وجه مسمّى`)].join(" · ");
  },
  async fill() {
    this.sub();
    const box = $("#fc");
    if (!box) return;
    if (!S.counts.students) {
      box.innerHTML = `<div class="empty"><span class="big">☷</span><b>${L("Import the class lists first", "استورد قوائم الفصول أولًا")}</b><span>${L("The app names faces from your students. Portraits help it learn faster.", "يسمّي التطبيق الوجوه من طلابك. الصور الشخصية تساعده على التعلم أسرع.")}</span><button class="btn primary" id="go-imp">${L("Import class lists", "استيراد قوائم الفصول")}</button></div>`;
      $("#go-imp", box).onclick = () => go("students", { import: true });
      return;
    }
    if (FC.tab === "people") return this.people(box);
    if (FC.tab === "review") return this.review(box);
    return this.unknown(box);
  },
  async people(box) {
    const [list, cls] = await Promise.all([quiet("people", { className: FC.className || undefined }), quiet("classes")]);
    if (!list || !$("#fc")) return;
    const classes = [...new Set((cls ?? []).map((c) => c.class_name).filter(Boolean))];
    const q = FC.search.trim().toLowerCase();
    const shown = list.filter((s) => !q || `${s.name_en ?? ""} ${s.name_ar ?? ""} ${s.id}`.toLowerCase().includes(q));
    const toReview = list.filter((s) => s.review).length;
    box.innerHTML = `<div class="row"><input type="search" id="fc-q" placeholder="${L("Find a student…", "ابحث عن طالب…")}" value="${esc(FC.search)}" style="width: 220px" />
        <select id="fc-c"><option value="">${L("All classes", "كل الفصول")}</option>${classes.map((c) => `<option ${c === FC.className ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <span class="grow"></span>${toReview ? `<button class="btn primary" id="fc-go">▶ ${L(`Review ${toReview} students`, `مراجعة ${num(toReview)} طالب`)}</button>` : ""}</div>
      <div class="people">${shown.slice(0, 800).map((s) => `<div class="person ${s.can_post ? "" : "off"}" data-id="${esc(s.id)}">${faceImg(s, true)}<b class="small">${esc(name(s))}</b>
        <span class="tiny muted">${esc(s.class_name ?? "")} · ${num(s.photos)}</span>${s.review ? `<span class="badge">${L(`${s.review} to review`, `${num(s.review)} للمراجعة`)}</span>` : ""}</div>`).join("")}</div>`;
    const q$ = $("#fc-q", box);
    q$.oninput = () => { FC.search = q$.value; clearTimeout(FC.qt); FC.qt = setTimeout(() => this.people(box).then(() => { const el = $("#fc-q"); el?.focus(); el?.setSelectionRange(99, 99); }), 250); };
    $("#fc-c", box).onchange = (e) => { FC.className = e.target.value; this.people(box); };
    $("#fc-go", box)?.addEventListener("click", () => go("student", { id: list.find((s) => s.review).id, review: true }));
    $$("[data-id]", box).forEach((el) => (el.onclick = () => go("student", { id: el.dataset.id })));
  },
  // "Is this …?": one face at a time. Y yes, N no, S skip.
  async review(box) {
    const queue = (await quiet("isThis", FC.only ?? undefined)) ?? [];
    if (!$("#fc")) return;
    let i = 0;
    let yes = 0;
    const draw = () => {
      const f = queue[i];
      if (!f) {
        FC.answer = null;
        box.innerHTML = `<div class="empty"><span class="big">✓</span><b>${L("All done", "انتهى")}</b><span>${yes ? L(`${yes} faces named. The Mac is looking for more.`, `سُمّي ${num(yes)} وجه. يبحث الماك عن المزيد.`) : L("Nothing to review right now.", "لا شيء للمراجعة الآن.")}</span><button class="btn" id="fc-people">${L("Back to People", "العودة إلى الأشخاص")}</button></div>`;
        $("#fc-people", box).onclick = () => { FC.tab = "people"; go("faces"); };
        return;
      }
      box.innerHTML = `<div class="isthis"><div class="muted small">${num(i + 1)} / ${num(queue.length)}</div>
        <div class="pair"><img class="q" src="hub://face/${f.id}" />${f.main ? `<img class="ref" src="hub://face/${f.main}" />` : ""}</div>
        <h2>${L("Is this", "هل هذا")} ${esc(name(f))}${L("?", "؟")} <span class="muted small">${esc(f.class_name ?? "")} · ${Math.round(f.suggest_score * 100)}%</span></h2>
        <div class="row"><button class="btn" id="a-no">✕ ${L("No", "لا")} <span class="k">N</span></button><button class="btn" id="a-skip">${L("Skip", "تخطٍّ")} <span class="k">S</span></button><button class="btn primary" id="a-yes">✓ ${L("Yes", "نعم")} <span class="k">Y</span></button></div>
        <button class="link small" id="a-photo">${L("See the whole photo", "عرض الصورة كاملة")}</button></div>`;
      $("#a-no", box).onclick = () => FC.answer(false);
      $("#a-yes", box).onclick = () => FC.answer(true);
      $("#a-skip", box).onclick = () => FC.answer(null);
      $("#a-photo", box).onclick = () => openViewer([f.photo_id], 0, {});
    };
    FC.answer = async (ok) => {
      const f = queue[i];
      if (!f) return;
      i++;
      draw();
      FC.busy = true;
      if (ok === true) {
        yes++;
        await call("confirmFaces", [f.id], f.student_id);
      } else if (ok === false) await call("rejectFaces", [f.id]);
      FC.busy = false;
    };
    draw();
  },
  async unknown(box) {
    const groups = (await quiet("unknownGroups")) ?? [];
    if (!$("#fc")) return;
    if (!groups.length) {
      box.innerHTML = `<div class="empty"><span class="big">✓</span><b>${L("No groups of unknown faces", "لا توجد مجموعات وجوه مجهولة")}</b><span>${L("When the Mac sees the same new face in several photos, it groups them here so you name them once.", "عندما يرى الماك نفس الوجه الجديد في عدة صور، يجمعها هنا لتسمّيها مرة واحدة.")}</span></div>`;
      return;
    }
    box.innerHTML = `<p class="muted">${L("Each group looks like one student. Click faces that don't belong, then give the group a name.", "كل مجموعة تبدو لطالب واحد. اضغط على الوجوه التي لا تنتمي، ثم سمِّ المجموعة.")}</p>` +
      groups.map((g, gi) => `<div class="card" data-g="${gi}"><div class="row"><b class="grow">${L(`Same student? ${g.ids.length} faces in ${g.photos} photos`, `نفس الطالب؟ ${num(g.ids.length)} وجه في ${num(g.photos)} صورة`)}</b>
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
