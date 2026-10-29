// Faces, like People in Apple Photos: everyone (students, teachers, staff,
// parents, visitors) as round faces; "Is this …?" with the whole photo
// beside the face; "Who is this?" one face at a time with the three likeliest
// people on keys 1 2 3, or in groups; class photos named row by row;
// look-alikes and twins; and the "Not a face" bin. Suggestions under 50% are
// guesses and never shown. Every naming can be undone (⌘Z).
const FC = { tab: "people", kind: "student", className: "", search: "", event: "", mode: "one", groupOff: new Set(), sel: new Set() };
const faceImg = (s, big = false) => (s?.face ? `<img class="pface ${big ? "big" : ""}" loading="lazy" src="hub://face/${s.face}" />` : avatar(s, big));
const undoToast = (msg) => toastAction(msg, L("Undo", "تراجع"), () => doUndo(), 7000);

// The whole photo with one face (or several, numbered) marked on it.
function photoWithBoxes(photoId, boxes, cls = "") {
  return `<div class="boxphoto ${cls}"><img src="hub://preview/${photoId}" onerror="this.src='hub://thumb/${photoId}'" />${boxes
    .map((b, i) => `<span class="fbox ${b.on ? "on" : ""} ${b.done ? "done" : ""}" data-box="${b.n ?? i}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%">${b.label != null ? `<i>${esc(b.label)}</i>` : ""}</span>`)
    .join("")}</div>`;
}

App.views.faces = {
  render(main, params) {
    if (params.tab) FC.tab = params.tab === "suggest" ? "review" : params.tab === "hidden" ? "notfaces" : params.tab;
    if (params.event) (FC.event = params.event, FC.tab = "unknown");
    if (params.importId) FC.tab = "unknown";
    FC.only = params.students ?? null;
    const tabs = [["people", L("People", "الأشخاص")], ["review", L("Is this …?", "هل هذا …؟")], ["unknown", L("Who is this?", "من هذا؟")], ["class", L("Class photos", "صور الفصول")], ["alike", L("Look-alikes", "متشابهون")], ["notfaces", L("Not a face", "ليس وجهًا")]];
    main.innerHTML = topbar(L("Faces", "الوجوه"), `<span id="fc-sub"></span>`, `<div class="pills">${tabs.map(([id, label]) => `<button class="pill ${FC.tab === id ? "on" : ""}" data-tab="${id}">${label}</button>`).join("")}</div>`) +
      `<div class="content"><div class="col gap16" id="fc">${skeletonTiles(24)}</div></div>`;
    $$("[data-tab]", main).forEach((b) => (b.onclick = () => { FC.tab = b.dataset.tab; FC.only = null; go("faces"); }));
    this.fill();
  },
  onState(changed) {
    this.sub();
    if (changed.includes("faces") && !FC.busy && ["people", "notfaces", "alike"].includes(FC.tab)) {
      clearTimeout(FC.t);
      FC.t = setTimeout(() => this.fill(), 1500);
    }
  },
  keys: () => [["Y N S", L("Yes, no, skip (Is this …?)", "نعم، لا، تخطٍّ (هل هذا …؟)")], ["1 2 3", L("Pick one of the three guesses", "اختيار أحد الاقتراحات الثلاثة")], ["T", L("Type a name", "كتابة اسم")], ["H", L("Not a face", "ليس وجهًا")], ["⌘Z", L("Undo the last naming", "التراجع عن آخر تسمية")]],
  onKey(e) {
    const k = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey) return;
    if (FC.tab === "review" && FC.answer) {
      if (k === "y") return FC.answer(true), true;
      if (k === "n") return FC.answer(false), true;
      if (k === "s") return FC.answer(null), true;
    }
    if (FC.tab === "unknown" && FC.mode === "one" && FC.pick) {
      if (["1", "2", "3"].includes(k)) return FC.pick(Number(k) - 1), true;
      if (k === "t") return FC.pick("type"), true;
      if (k === "h") return FC.pick("hide"), true;
      if (k === "s") return FC.pick("skip"), true;
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
    FC.answer = null;
    FC.pick = null;
    if (!S.counts.students && FC.tab !== "notfaces") {
      box.innerHTML = emptyState("users", L("Import the class lists first", "استورد قوائم الفصول أولًا"), L("The app names faces from your students and staff. Portraits help it learn faster.", "يسمّي التطبيق الوجوه من الطلاب والعاملين. الصور الشخصية تساعده على التعلم أسرع."), `<button class="btn primary" id="go-imp">${L("Import class lists", "استيراد قوائم الفصول")}</button>`);
      $("#go-imp", box).onclick = () => go("students", { import: true });
      return;
    }
    return this[{ people: "people", review: "review", unknown: "unknown", class: "classPhotos", alike: "alike", notfaces: "notFaces" }[FC.tab] ?? "people"](box);
  },

  // ---------- People ----------
  async people(box) {
    const kind = FC.kind === "left" ? undefined : FC.kind;
    const [list, cls] = await Promise.all([quiet("people", { className: FC.className || undefined, kind, left: FC.kind === "left" }), quiet("classes")]);
    if (!list || !$("#fc")) return;
    const classes = [...new Set((cls ?? []).map((c) => c.class_name).filter(Boolean))];
    const q = nameKey(FC.search);
    const shown = list.filter((s) => (FC.kind !== "left" || s.left_on) && (!q || nameKey(`${s.name_en ?? ""} ${s.name_ar ?? ""} ${s.id}`).includes(q)));
    const toReview = shown.filter((s) => s.review);
    const kinds = [["student", L("Students", "الطلاب")], ["teacher", L("Teachers", "المعلمون")], ["staff", L("Staff", "العاملون")], ["parent", L("Parents", "أولياء الأمور")], ["visitor", L("Visitors", "الزوار")], ["left", L("Left or graduated", "غادروا أو تخرجوا")]];
    box.innerHTML = `<div class="row"><input type="search" id="fc-q" placeholder="${L("Find someone (any spelling)…", "ابحث عن شخص (بأي تهجئة)…")}" value="${esc(FC.search)}" style="width: 240px" />
        <div class="pills">${kinds.map(([k, l]) => `<button class="pill ${FC.kind === k ? "on" : ""}" data-kind="${k}">${l}</button>`).join("")}</div>
        ${FC.kind === "student" ? pillMenu("fc-c", L("Class", "الفصل"), [["", L("All classes", "كل الفصول")], ...classes.map((c) => [c, c])], FC.className) : ""}
        <span class="grow"></span>${toReview.length ? `<button class="btn primary" id="fc-go">${icon("play", 14)} ${(() => { const n = toReview.reduce((a, s) => a + s.review, 0); return L(`Review ${n} faces`, `مراجعة ${num(n)} وجه`); })()}</button>` : ""}
        ${FC.className ? `<button class="btn" id="fc-phone" title="${L("The class teacher answers “Is this …?” on the phone", "يجيب معلم الفصل على «هل هذا …؟» من الهاتف")}">${icon("smartphone", 14)} ${L("Ask the class teacher", "اسأل معلم الفصل")}</button>` : ""}</div>
      ${shown.length ? `<div class="people">${shown.slice(0, 900).map((s) => `<div class="person ${s.can_post ? "" : "off"}" data-id="${esc(s.id)}">${faceImg(s, true)}<b class="small">${esc(name(s))}</b>
        <span class="tiny muted">${esc(s.kind && s.kind !== "student" ? KINDS()[s.kind] : s.class_name ?? "")} · ${num(s.photos)}</span>${s.review ? `<span class="badge">${L(`${s.review} to review`, `${num(s.review)} للمراجعة`)}</span>` : ""}${s.can_post ? "" : `<span class="tag bad tiny">${L("Can't appear", "لا يظهر")}</span>`}</div>`).join("")}</div>`
        : emptyState("users", FC.kind === "student" ? L("Nobody found", "لا أحد") : L(`No ${kinds.find((k) => k[0] === FC.kind)[1].toLowerCase()} yet`, `لا يوجد ${kinds.find((k) => k[0] === FC.kind)[1]} بعد`), FC.kind !== "student" && FC.kind !== "left" ? L("Name a face as a teacher, staff member, parent or visitor (“Add a new person…”) and they appear here.", "سمِّ وجهًا كمعلم أو موظف أو ولي أمر أو زائر («إضافة شخص جديد…») ليظهر هنا.") : "")}`;
    const q$ = $("#fc-q", box);
    q$.oninput = () => { FC.search = q$.value; clearTimeout(FC.qt); FC.qt = setTimeout(() => this.people(box).then(() => { const el = $("#fc-q"); el?.focus(); el?.setSelectionRange(99, 99); }), 250); };
    $$("[data-kind]", box).forEach((b) => (b.onclick = () => { FC.kind = b.dataset.kind; FC.className = ""; this.people(box); }));
    bindPillMenu(box, "fc-c", [["", L("All classes", "كل الفصول")], ...classes.map((c) => [c, c])], FC.className, (v) => { FC.className = v; this.people(box); });
    $("#fc-go", box)?.addEventListener("click", () => { FC.only = toReview.map((s) => s.id); FC.tab = "review"; go("faces", { students: FC.only }); });
    $("#fc-phone", box)?.addEventListener("click", async () => {
      const r = await call("sendFaceChecks", FC.className);
      toast(r?.sent ? L(`${r.sent} questions sent to the class teacher's phone`, `أُرسل ${num(r.sent)} سؤال إلى هاتف معلم الفصل`) : L("Nothing to ask: no suggestions in photos already on the website.", "لا أسئلة: لا اقتراحات في صور موجودة على الموقع."));
    });
    $$("[data-id]", box).forEach((el) => {
      el.onclick = () => go("student", { id: el.dataset.id });
      el.oncontextmenu = (e) => {
        e.preventDefault();
        const s = shown.find((x) => x.id === el.dataset.id);
        menu([
          { label: L("Open", "فتح"), run: () => go("student", { id: s.id }) },
          s.review && { label: L(`Review ${s.review} suggestions`, `مراجعة ${num(s.review)} اقتراح`), run: () => go("faces", { tab: "review", students: [s.id] }) },
          { label: L("All photos", "كل الصور"), run: () => go("library", { student: s.id }) },
          { label: L("Photos together with…", "صور مع…"), run: () => pickStudent(L("Together with", "مع"), (o) => go("library", { together: [s.id, o.id] })) },
          "-",
          { label: L("Twin or sibling of…", "توأم أو أخ/أخت لـ…"), run: () => pickStudent(L("Twin or sibling of", "توأم أو أخ/أخت لـ"), (o) => linkMenu(s, o)) },
          { label: s.can_post ? L("Can't appear in posts", "لا يظهر في المنشورات") : L("Can appear in posts", "يظهر في المنشورات"), run: async () => { await call("setCanPost", s.id, !s.can_post); this.people(box); } },
        ]);
      };
    });
  },

  // ---------- Is this …? ----------
  // One face at a time, the whole photo beside it, one student after another.
  async review(box) {
    const raw = (await quiet("isThis", FC.only ?? undefined)) ?? [];
    if (!$("#fc")) return;
    // Grouped by student: finish one, then move on to the next.
    const order = [];
    for (const f of raw) if (!order.includes(f.student_id)) order.push(f.student_id);
    const queue = order.flatMap((id) => raw.filter((f) => f.student_id === id));
    let i = 0, yes = 0;
    const draw = async () => {
      const f = queue[i];
      if (!f) {
        FC.answer = null;
        box.innerHTML = emptyState("circle-check", L("All done", "انتهى"), yes ? L(`${yes} faces named. The Mac is looking for more.`, `سُمّي ${num(yes)} وجه. يبحث الماك عن المزيد.`) : L("Nothing to review right now.", "لا شيء للمراجعة الآن."), `<button class="btn" id="fc-people">${L("Back to People", "العودة إلى الأشخاص")}</button>`);
        $("#fc-people", box).onclick = () => { FC.tab = "people"; go("faces"); };
        return;
      }
      const d = await quiet("faceDetail", f.id);
      const studentNo = order.indexOf(f.student_id) + 1;
      const left = queue.filter((x, k) => k >= i && x.student_id === f.student_id).length;
      box.innerHTML = `<div class="zoomconfirm">
        <div class="col gap12" style="align-items: center">
          <div class="muted small">${L(`Student ${studentNo} of ${order.length} · ${left} left for ${esc(name(f))}`, `الطالب ${num(studentNo)} من ${num(order.length)} · بقي ${num(left)} لـ ${esc(name(f))}`)}</div>
          <div class="pair"><img class="q" src="hub://face/${f.id}" />${f.main ? `<div class="col" style="align-items: center; gap: 4px"><img class="ref" src="hub://face/${f.main}" /><span class="tiny muted">${esc(name(f))}</span></div>` : ""}</div>
          <h2>${L("Is this", "هل هذا")} ${esc(name(f))}${L("?", "؟")} <span class="muted small">${esc(f.class_name ?? "")} · ${Math.round(f.suggest_score * 100)}%</span></h2>
          ${f.twin ? `<div class="note warn small">${L(`Careful: looks like ${esc(f.twin)} too`, `انتبه: يشبه ${esc(f.twin)} أيضًا`)}</div>` : ""}
          <div class="row"><button class="btn" id="a-no">${icon("x", 14)} ${L("No", "لا")} <span class="k">N</span></button><button class="btn" id="a-skip">${L("Skip", "تخطٍّ")} <span class="k">S</span></button><button class="btn primary" id="a-yes">${icon("check", 14)} ${L("Yes", "نعم")} <span class="k">Y</span></button></div>
          <button class="link small" id="a-other">${L("No, it's someone else…", "لا، إنه شخص آخر…")}</button>
        </div>
        ${d ? photoWithBoxes(d.photo_id, [{ x: d.x, y: d.y, w: d.w, h: d.h, on: true }], "zoomable") : ""}</div>`;
      $("#a-no", box).onclick = () => FC.answer(false);
      $("#a-yes", box).onclick = () => FC.answer(true);
      $("#a-skip", box).onclick = () => FC.answer(null);
      $("#a-other", box).onclick = () => pickStudent(L("Who is this?", "من هذا؟"), async (s) => { await call("confirmFaces", [f.id], s.id); i++; draw(); }, { className: f.class_name });
      $(".boxphoto", box)?.addEventListener("click", () => openViewer([f.photo_id], 0, {}));
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

  // ---------- Who is this? ----------
  async unknown(box) {
    const events = (await quiet("eventsToName")) ?? [];
    if (!$("#fc")) return;
    box.innerHTML = `<div class="fcsplit"><aside class="col gap4 fcevents"><b class="small muted">${L("Faces left to name", "وجوه لم تُسمَّ بعد")}</b>
        <button class="trow ${FC.event ? "" : "on"}" data-ev="">${L("All events", "كل الفعاليات")}</button>
        ${events.map((e) => `<button class="trow ${FC.event === e.key ? "on" : ""}" data-ev="${esc(e.key)}"><span class="grow">${esc(eventName(e.title, e.date))}</span><span class="tag">${num(e.n)}</span></button>`).join("")}</aside>
      <div class="col gap12 grow" style="min-width: 0"><div class="row"><div class="pills"><button class="pill ${FC.mode === "one" ? "on" : ""}" data-mode="one">${L("One by one", "واحدًا تلو الآخر")}</button><button class="pill ${FC.mode === "groups" ? "on" : ""}" data-mode="groups">${L("In groups", "في مجموعات")}</button></div></div><div id="fc-who"></div></div></div>`;
    $$("[data-ev]", box).forEach((b) => (b.onclick = () => { FC.event = b.dataset.ev; this.unknown(box); }));
    $$("[data-mode]", box).forEach((b) => (b.onclick = () => { FC.mode = b.dataset.mode; this.unknown(box); }));
    const inner = $("#fc-who", box);
    return FC.mode === "one" ? this.oneByOne(inner) : this.groups(inner);
  },
  async oneByOne(box) {
    const faces = (await quiet("unknownFaces", { event: FC.event || undefined, limit: 300 })) ?? [];
    let i = 0, named = 0;
    const draw = async () => {
      const f = faces[i];
      if (!f) {
        FC.pick = null;
        box.innerHTML = emptyState("circle-check", L("No faces left to name here", "لا وجوه بلا أسماء هنا"), named ? L(`${named} named. Thank you!`, `سُمّي ${num(named)}. شكرًا!`) : "");
        return;
      }
      const guesses = (await quiet("faceGuesses", f.id)) ?? [];
      if (faces[i] !== f) return;
      box.innerHTML = `<div class="zoomconfirm">
        <div class="col gap12" style="align-items: center">
          <div class="muted small">${num(i + 1)} / ${num(faces.length)} · ${esc(eventName(f.event_title, f.event_date))}</div>
          <img class="q" src="hub://face/${f.id}" />
          <div class="col gap4" style="width: 100%; max-width: 340px">
            ${guesses.map((g, k) => `<button class="trow guess" data-g="${k}">${faceImg({ ...g.student, face: null })}<span class="grow"><b>${esc(name(g.student))}</b> <span class="muted small">${esc(g.student.kind && g.student.kind !== "student" ? KINDS()[g.student.kind] : g.student.class_name ?? "")} · ${Math.round(g.score * 100)}%</span></span><span class="k">${k + 1}</span></button>`).join("")}
            ${guesses.length ? "" : `<p class="muted small" style="text-align: center">${L("No good guesses yet. Type the name.", "لا اقتراحات جيدة بعد. اكتب الاسم.")}</p>`}
          </div>
          <div class="row"><button class="btn" id="w-type">${L("Type a name", "كتابة اسم")} <span class="k">T</span></button><button class="btn" id="w-hide">${L("Not a face", "ليس وجهًا")} <span class="k">H</span></button><button class="btn ghost" id="w-skip">${L("Skip", "تخطٍّ")} <span class="k">S</span></button></div>
        </div>
        ${photoWithBoxes(f.photo_id, [{ x: f.x, y: f.y, w: f.w, h: f.h, on: true }])}</div>`;
      $$("[data-g]", box).forEach((b) => (b.onclick = () => FC.pick(Number(b.dataset.g))));
      $("#w-type", box).onclick = () => FC.pick("type");
      $("#w-hide", box).onclick = () => FC.pick("hide");
      $("#w-skip", box).onclick = () => FC.pick("skip");
      FC.guesses = guesses;
    };
    const next = () => { i++; draw(); };
    FC.pick = async (what) => {
      const f = faces[i];
      if (!f) return;
      if (what === "skip") return next();
      if (what === "hide") {
        await call("hideFaces", [f.id]);
        undoToast(L("Moved to “Not a face”", "نُقل إلى «ليس وجهًا»"));
        return next();
      }
      if (what === "type")
        return pickStudent(L("Who is this?", "من هذا؟"), async (s) => {
          await call("confirmFaces", [f.id], s.id);
          named++;
          undoToast(L(`Named ${name(s)}`, `سُمّي ${name(s)}`));
          next();
        }, { className: f.class_name });
      const g = FC.guesses?.[what];
      if (!g) return;
      await call("confirmFaces", [f.id], g.studentId);
      named++;
      undoToast(L(`Named ${name(g.student)}`, `سُمّي ${name(g.student)}`));
      next();
    };
    draw();
  },
  async groups(box) {
    const groups = (await quiet("unknownGroups")) ?? [];
    if (!groups.length) {
      box.innerHTML = emptyState("circle-check", L("No groups of unknown faces", "لا توجد مجموعات وجوه مجهولة"), L("When the Mac sees the same new face in several photos, it groups them here so you name them once.", "عندما يرى الماك نفس الوجه الجديد في عدة صور، يجمعها هنا لتسمّيها مرة واحدة."));
      return;
    }
    box.innerHTML = `<p class="muted">${L("Each group looks like one person. Click faces that don't belong, then give the group a name.", "كل مجموعة تبدو لشخص واحد. اضغط على الوجوه التي لا تنتمي، ثم سمِّ المجموعة.")}</p>` +
      groups.map((g, gi) => `<div class="card" data-g="${gi}"><div class="row"><b class="grow">${L(`Same person? ${g.ids.length} faces in ${g.photos} photos`, `نفس الشخص؟ ${num(g.ids.length)} وجه في ${num(g.photos)} صورة`)}</b>
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
        undoToast(L(`${ids.length} faces named ${name(s)}`, `سُمّي ${num(ids.length)} وجه باسم ${name(s)}`));
        b.closest(".card").remove();
      });
    }));
    $$("[data-skip]", box).forEach((b) => (b.onclick = () => b.closest(".card").remove()));
    $$("[data-hide]", box).forEach((b) => (b.onclick = async () => {
      const g = groups[Number(b.dataset.hide)];
      await call("hideFaces", g.ids.slice(0, 40).filter((id) => !FC.groupOff.has(id)));
      undoToast(L("Moved to “Not a face”", "نُقل إلى «ليس وجهًا»"));
      b.closest(".card").remove();
    }));
  },

  // ---------- Class photos ----------
  async classPhotos(box) {
    const list = (await quiet("groupPhotos")) ?? [];
    if (!$("#fc")) return;
    if (!list.length) {
      box.innerHTML = emptyState("users", L("No class photos yet", "لا صور فصول بعد"), L("Photos with 8 or more faces show here, to name row by row.", "الصور التي فيها 8 وجوه أو أكثر تظهر هنا لتسميتها صفًا صفًا."));
      return;
    }
    box.innerHTML = `<p class="muted">${L("Name a class photo row by row: the faces are numbered from the top row, left to right, and only the class's students are offered.", "سمِّ صورة الفصل صفًا صفًا: الوجوه مرقمة من الصف الأعلى، من اليسار لليمين، ويُعرض طلاب الفصل فقط.")}</p>
      <div class="photos cards" style="padding: 0">${list.map((p) => `<div class="zcard" data-cp="${p.id}"><img class="zph" loading="lazy" src="hub://thumb/${p.id}" /><b>${esc(eventName(p.event_title, p.event_date))}</b><span class="muted small">${esc(p.class_name ?? "")} · ${L(`${p.face_count} faces`, `${num(p.face_count)} وجه`)}${p.unnamed ? ` · <span class="tag warn">${L(`${p.unnamed} to name`, `${num(p.unnamed)} بلا اسم`)}</span>` : ""}</span></div>`).join("")}</div>`;
    $$("[data-cp]", box).forEach((el) => (el.onclick = () => classPhotoMode(Number(el.dataset.cp), () => this.classPhotos(box))));
  },

  // ---------- Look-alikes ----------
  async alike(box) {
    const pairs = (await quiet("lookAlikes")) ?? [];
    if (!$("#fc")) return;
    if (!pairs.length) {
      box.innerHTML = emptyState("users", L("No look-alikes found", "لا يوجد متشابهون"), L("When two people's faces look very alike (twins, brothers and sisters), they show here. The app then always asks before naming them.", "عندما تتشابه وجوه شخصين جدًا (توائم، إخوة وأخوات) يظهران هنا. ثم يسأل التطبيق دائمًا قبل التسمية."));
      return;
    }
    const kinds = { twin: L("Twins", "توأم"), sibling: L("Brothers or sisters", "إخوة"), lookalike: L("Just look alike", "متشابهان فقط") };
    box.innerHTML = `<p class="muted">${L("These people look alike. Tell the app what they are: twins and look-alikes are never named automatically, brothers and sisters show on each other's page.", "هؤلاء متشابهون. أخبر التطبيق بالعلاقة: التوائم والمتشابهون لا يُسمَّون تلقائيًا أبدًا، والإخوة يظهرون في صفحات بعضهم.")}</p>` +
      pairs.map((p, i) => `<div class="card row nowrap" data-pair="${i}">
        <div class="person" data-open="${esc(p.a.id)}">${faceImg(p.a, true)}<b class="small">${esc(name(p.a))}</b><span class="tiny muted">${esc(p.a.class_name ?? "")}</span></div>
        <span class="muted">${Math.round(p.score * 100)}%</span>
        <div class="person" data-open="${esc(p.b.id)}">${faceImg(p.b, true)}<b class="small">${esc(name(p.b))}</b><span class="tiny muted">${esc(p.b.class_name ?? "")}</span></div>
        <span class="grow"></span>
        <div class="pills">${Object.entries(kinds).map(([k, l]) => `<button class="pill ${p.link === k ? "on" : ""}" data-link="${k}">${l}</button>`).join("")}<button class="pill" data-link="different">${L("Not alike", "غير متشابهين")}</button></div></div>`).join("");
    $$("[data-open]", box).forEach((el) => (el.onclick = () => go("student", { id: el.dataset.open })));
    $$("[data-link]", box).forEach((b) => (b.onclick = async () => {
      const p = pairs[Number(b.closest("[data-pair]").dataset.pair)];
      await call("setLink", p.a.id, p.b.id, p.link === b.dataset.link ? null : b.dataset.link);
      this.alike(box);
    }));
  },

  // ---------- Not a face ----------
  async notFaces(box) {
    const list = (await quiet("notFaces")) ?? [];
    if (!$("#fc")) return;
    FC.sel = new Set([...FC.sel].filter((id) => list.some((f) => f.id === id)));
    if (!list.length) {
      box.innerHTML = emptyState("circle-check", L("The bin is empty", "السلة فارغة"), L("Posters, screens, statues and hands you mark as “Not a face” go here. You can put any back.", "الملصقات والشاشات والتماثيل والأيدي التي تعلّمها «ليس وجهًا» تذهب هنا. يمكنك إعادة أي منها."));
      return;
    }
    box.innerHTML = `<div class="row"><span class="muted grow">${L(`${list.length} things marked “Not a face”. Click to choose, then put them back.`, `${num(list.length)} عنصر معلَّم «ليس وجهًا». اضغط للاختيار ثم أعدها.`)}</span>
      <button class="btn small ghost" id="nf-all">${L("Select all", "تحديد الكل")}</button><button class="btn small primary" id="nf-back" ${FC.sel.size ? "" : "disabled"}>${icon("undo-2", 13)} ${L(`Put back ${FC.sel.size || ""}`, `إعادة ${FC.sel.size ? num(FC.sel.size) : ""}`)}</button></div>
      <div class="faces">${list.map((f) => `<div class="face ${FC.sel.has(f.id) ? "sel" : ""}" data-nf="${f.id}"><img loading="lazy" src="hub://face/${f.id}" /></div>`).join("")}</div>`;
    $$("[data-nf]", box).forEach((el) => (el.onclick = () => { const id = Number(el.dataset.nf); FC.sel.has(id) ? FC.sel.delete(id) : FC.sel.add(id); this.notFaces(box); }));
    $("#nf-all", box).onclick = () => { list.forEach((f) => FC.sel.add(f.id)); this.notFaces(box); };
    $("#nf-back", box).onclick = async () => { const n = await call("putBackFaces", [...FC.sel]); FC.sel.clear(); undoToast(L(`${n} put back`, `أُعيد ${num(n)}`)); this.notFaces(box); };
  },
};

function linkMenu(a, b) {
  menu([
    { label: L(`${name(a)} and ${name(b)} are twins`, `${name(a)} و${name(b)} توأم`), run: () => call("setLink", a.id, b.id, "twin") },
    { label: L("Brothers or sisters", "إخوة"), run: () => call("setLink", a.id, b.id, "sibling") },
    { label: L("They just look alike", "متشابهان فقط"), run: () => call("setLink", a.id, b.id, "lookalike") },
  ]);
}

// Class photo mode: the photo with numbered faces, a name for each in rows.
// Tab or Enter moves to the next face; only the class's students are offered.
async function classPhotoMode(photoId, onDone) {
  const d = await call("classPhoto", photoId);
  if (!d) return;
  const faces = d.rows.flat();
  const choice = new Map(faces.map((f) => [f.id, f.student_id ?? f.guess?.id ?? ""]));
  let on = 0;
  const people = d.people;
  const draw = () => {
    let n = 0;
    const m = modal(`<div class="classmode"><div class="row"><h2 class="grow">${L("Class photo", "صورة الفصل")} ${d.className ? `· ${esc(d.className)}` : ""}</h2><span class="muted small">${L("Tab = next face", "Tab = الوجه التالي")}</span></div>
      <div class="row nowrap" style="align-items: flex-start; gap: 16px">
        ${photoWithBoxes(photoId, faces.map((f, i) => ({ x: f.x, y: f.y, w: f.w, h: f.h, on: i === on, done: !!choice.get(f.id), label: i + 1, n: i })))}
        <div class="col gap8 cmlist">${d.rows.map((row, r) => `<b class="small muted">${L(`Row ${r + 1}`, `الصف ${num(r + 1)}`)}</b>${row.map((f) => { const i = n++; return `<label class="row nowrap ${i === on ? "on" : ""}" data-row="${i}"><span class="k">${i + 1}</span><select data-face="${f.id}" data-i="${i}" class="grow"><option value="">—</option>${people.map((p) => `<option value="${esc(p.id)}" ${choice.get(f.id) === p.id ? "selected" : ""}>${esc(name(p))}</option>`).join("")}${f.student_id && !people.some((p) => p.id === f.student_id) ? `<option value="${esc(f.student_id)}" selected>${esc(name(f.person))}</option>` : ""}</select>${f.status === "confirmed" ? icon("check", 13) : f.guess ? `<span class="tiny muted">${L("guess", "اقتراح")}</span>` : ""}</label>`; }).join("")}`).join("")}
          ${people.length ? "" : `<p class="muted small">${L("No class for this photo: put it in a class folder, or name the faces in “Who is this?”.", "لا فصل لهذه الصورة: ضعها في مجلد فصل، أو سمِّ الوجوه في «من هذا؟».")}</p>`}</div></div>
      <div class="row"><span class="grow"></span><button class="btn" id="cm-cancel">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="cm-save">${L("Save names", "حفظ الأسماء")}</button></div></div>`, { wide: true, sticky: true });
    $$("select[data-face]", m).forEach((s) => {
      s.onfocus = () => { on = Number(s.dataset.i); highlight(m); };
      s.onchange = () => choice.set(Number(s.dataset.face), s.value);
      s.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          $(`select[data-i="${Number(s.dataset.i) + 1}"]`, m)?.focus();
        }
      };
    });
    $$(".fbox", m).forEach((b) => (b.onclick = () => $(`select[data-i="${b.dataset.box}"]`, m)?.focus()));
    $("#cm-cancel", m).onclick = closeOverlay;
    $("#cm-save", m).onclick = async () => {
      const items = faces.filter((f) => choice.get(f.id) && choice.get(f.id) !== f.student_id).map((f) => ({ faceId: f.id, studentId: choice.get(f.id) }));
      const n = await call("nameClassPhoto", items);
      closeOverlay();
      undoToast(L(`${n} faces named`, `سُمّي ${num(n)} وجه`));
      onDone?.();
    };
    setTimeout(() => $(`select[data-i="${on}"]`, m)?.focus(), 40);
  };
  const highlight = (m) => {
    $$(".fbox", m).forEach((b) => b.classList.toggle("on", Number(b.dataset.box) === on));
    $$("[data-row]", m).forEach((r) => r.classList.toggle("on", Number(r.dataset.row) === on));
  };
  draw();
}
