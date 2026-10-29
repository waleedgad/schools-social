// Coverage: is every student in the school's photos and posts, fairly?
// Stage → Grade → Class with the classes that need attention first. Only good
// photos count; each student should be the focus of at least one photo;
// photos should vary by category; posts are shared fairly between students
// and classes; and each student needs enough for the yearbook.
const COV = { year: null, term: null, event: "", open: null, group: null, tab: "classes" };
const covBar = (c) => {
  const t = Math.max(1, c.students);
  return `<div class="cbar"><i class="g" style="width: ${(c.good / t) * 100}%"></i><i class="w" style="width: ${(c.low / t) * 100}%"></i><i class="b" style="width: ${(c.zero / t) * 100}%"></i></div>`;
};
const CAT_NAMES = () => (typeof CATS === "function" ? CATS() : {});

App.views.coverage = {
  async render(main, params) {
    if (params.className) (COV.open = params.className, COV.group = null);
    if (params.group) (COV.group = params.group, COV.open = null);
    const [periods, tree, st] = await Promise.all([quiet("periods"), quiet("tree"), quiet("studentTree")]);
    if (COV.year === null && periods?.[0]) {
      COV.year = periods[0].year;
      COV.term = periods[0].term;
    }
    const events = (tree?.rows ?? []).filter((r) => r.event_key && (!COV.year || r.year === COV.year) && (!COV.term || r.term === COV.term));
    const groups = st?.groups ?? [];
    main.innerHTML = topbar(L("Coverage", "التغطية"), L("Every student in the school's photos and posts, fairly", "كل طالب في صور المدرسة ومنشوراتها، بإنصاف"),
      `${pillMenu("cv-p", L("All time", "كل الأوقات"), (periods ?? []).map((p, i) => [i, `${p.year} · ${p.term}`]), (periods ?? []).findIndex((p) => p.year === COV.year && p.term === COV.term) >= 0 ? (periods ?? []).findIndex((p) => p.year === COV.year && p.term === COV.term) : "")}
       ${pillMenu("cv-e", L("All events", "كل الفعاليات"), events.map((e) => [e.event_key, eventLabel(e)]), COV.event)}
       ${groups.length ? pillMenu("cv-g", L("Clubs and teams", "الأندية والفرق"), groups.map((g) => [g.id, g.name]), COV.group ?? "") : ""}`) +
      `<div class="content"><div class="col gap16" id="cv">${skeletonRows(6)}</div></div>`;
    bindPillMenu(main, "cv-p", (periods ?? []).map((p, i) => [i, ""]), null, (v) => {
      const p = v === undefined ? null : periods[Number(v)];
      COV.year = p?.year ?? "";
      COV.term = p?.term ?? "";
      COV.event = "";
      this.render(main, {});
    }, { anyLabel: L("All time", "كل الأوقات") });
    bindPillMenu(main, "cv-e", events.map((e) => [e.event_key, eventLabel(e)]), COV.event, (v) => { COV.event = v ?? ""; this.render(main, {}); }, { anyLabel: L("All events", "كل الفعاليات") });
    bindPillMenu(main, "cv-g", groups.map((g) => [g.id, g.name]), COV.group, (v) => { COV.group = v ? Number(v) : null; COV.open = null; this.render(main, {}); }, { anyLabel: L("Whole school", "كل المدرسة") });
    this.fill();
  },
  onState(changed) {
    if (changed.includes("students") || changed.includes("faces")) {
      clearTimeout(COV.t);
      COV.t = setTimeout(() => this.fill(), 1500);
    }
  },
  filter(extra = {}) {
    return { year: COV.year || undefined, term: COV.term || undefined, event: COV.event || undefined, group: COV.group || undefined, ...extra };
  },
  async fill() {
    const box = $("#cv");
    if (!box) return;
    const r = await quiet("coverage", this.filter());
    if (!$("#cv")) return;
    COV.data = r;
    const rows = r?.classes ?? [];
    if (!rows.length) {
      box.innerHTML = emptyState("chart-pie", L("Import the class lists to see coverage", "استورد قوائم الفصول لرؤية التغطية"), "", `<button class="btn primary" id="cv-imp">${L("Import class list", "استيراد قائمة الفصول")}</button>`);
      $("#cv-imp", box)?.addEventListener("click", () => go("students", { import: true }));
      return;
    }
    const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
    const all = sum("students");
    const zero = sum("zero");
    const attention = rows.filter((x) => x.zero > 0 || x.tooOften > 0).sort((a, b) => b.zero / Math.max(1, b.students) - a.zero / Math.max(1, a.students)).slice(0, 8);
    const stages = STAGES();
    const grouped = new Map();
    for (const x of rows) {
      const key = `${x.stage ?? ""}|${x.grade ?? ""}`;
      if (!grouped.has(key)) grouped.set(key, { stage: x.stage, grade: x.grade, classes: [] });
      grouped.get(key).classes.push(x);
    }
    const maxPps = Math.max(0.1, ...rows.map((x) => x.postsPerStudent));
    const card = (x) => `<div class="c" data-c="${esc(x.className)}"><div class="row nowrap"><b class="grow">${esc(x.className)}</b>${x.zero ? `<span class="tag bad">${num(x.zero)} ${L("missing", "غائب")}</span>` : `<span class="tag good">${icon("check", 11)}</span>`}</div>
      ${covBar(x)}<span class="tiny muted">${L(`${x.students} students · ${x.ready} yearbook-ready`, `${num(x.students)} طالب · ${num(x.ready)} جاهز للكتاب`)}${x.nopost ? ` · ${num(x.nopost)} ${L("can't appear", "لا يظهرون")}` : ""}${x.stale ? ` · ${L(`${x.stale} not seen in 3 weeks`, `${num(x.stale)} لم يظهروا منذ 3 أسابيع`)}` : ""}</span>
      ${heatStrip(r.heat.rows[x.className])}</div>`;
    box.innerHTML = `<div class="grid4">
        <div class="card stat"><b>${num(all - zero)}<span class="muted" style="font-size: 14px"> / ${num(all)}</span></b><span>${L("students in at least one good photo", "طالب في صورة جيدة واحدة على الأقل")}</span></div>
        <div class="card stat"><b style="color: var(--bad)">${num(zero)}</b><span>${L("with no good photos", "بلا صور جيدة")}</span></div>
        <div class="card stat"><b>${num(sum("ready"))}</b><span>${L("ready for the yearbook", "جاهزون للكتاب السنوي")}</span></div>
        <div class="card stat"><b>${num(r.avgPosted)}</b><span>${L("posted photos per student (average)", "صور منشورة لكل طالب (متوسط)")}</span></div></div>
      <p class="muted small">${L("Only good photos count: sharp, face clear and big enough, not hidden. Students who can't appear are counted on their own.", "تُحسب الصور الجيدة فقط: واضحة، والوجه ظاهر وكبير بما يكفي، وغير مخفية. يُحسب من لا يظهرون وحدهم.")} <span class="tag good">3+</span> <span class="tag warn">1-2</span> <span class="tag bad">0</span></p>
      <div class="row">${pills([["classes", L("Classes", "الفصول")], ["posts", L("Fair share in posts", "الإنصاف في المنشورات")], ["variety", L("Variety", "التنوّع")], ["weeks", L("Week by week", "أسبوعًا بأسبوع")]], COV.tab, "data-cvtab")}<span class="grow"></span>
        <button class="btn small" id="cv-gap">${icon("sparkles", 14)} ${L("Fill the gap post", "منشور سدّ الفجوة")}</button></div>
      <div id="cv-tab"></div><div id="cv-class"></div>`;
    bindPills(box, "data-cvtab", (v) => { COV.tab = v; this.fill(); });
    $("#cv-gap", box).onclick = () => fillGapPost(this.filter(COV.open ? { className: COV.open } : {}), COV.open);
    const tab = $("#cv-tab", box);
    if (COV.tab === "classes")
      tab.innerHTML = `${attention.length ? `<div class="card"><h2>${L("Needs attention", "تحتاج اهتمامًا")}</h2><div class="heat">${attention.map(card).join("")}</div></div>` : `<div class="note good">${icon("circle-check", 14)} ${L("Every class has every student in at least one good photo.", "كل الفصول فيها كل الطلاب في صورة جيدة واحدة على الأقل.")}</div>`}
        ${[...grouped.values()].map((g) => `<div class="col gap8"><h3>${esc([stages[g.stage] ?? g.stage, g.grade].filter(Boolean).join(" · ") || L("Other", "أخرى"))}</h3><div class="heat">${g.classes.map(card).join("")}</div></div>`).join("")}`;
    else if (COV.tab === "posts")
      tab.innerHTML = `<div class="card"><h2>${L("Class against class in posts", "الفصول مقارنةً في المنشورات")}</h2><p class="muted small">${L("Posted photos per student in each class. Classes far below the rest should be next.", "الصور المنشورة لكل طالب في كل فصل. الفصول الأقل بكثير يجب أن تكون التالية.")}</p>
        <div class="bars">${rows.map((x) => `<div class="barrow" data-c="${esc(x.className)}"><span class="small" style="width: 80px">${esc(x.className)}</span><div class="barbg"><i style="width: ${(x.postsPerStudent / maxPps) * 100}%" class="${x.postsPerStudent < r.avgPosted / 2 ? "low" : ""}"></i></div><span class="small muted" style="width: 120px">${num(x.postsPerStudent)} ${L("per student", "لكل طالب")}${x.tooOften ? ` · <span style="color: var(--warn)">${num(x.tooOften)} ${L("too often", "كثيرًا")}</span>` : ""}</span></div>`).join("")}</div></div>
        ${tooOftenCard(r)}`;
    else if (COV.tab === "variety") {
      const cats = r.categories.length ? r.categories : [];
      const names = CAT_NAMES();
      tab.innerHTML = cats.length
        ? `<div class="card"><h2>${L("Variety by category", "التنوّع حسب الفئة")}</h2><p class="muted small">${L("Good photos of each class in each category. An empty box means the class has none of that kind yet.", "الصور الجيدة لكل فصل في كل فئة. المربع الفارغ يعني أن الفصل ليس لديه هذا النوع بعد.")}</p>
          <div style="overflow-x: auto"><table class="list small"><thead><tr><th></th>${cats.map((c) => `<th>${esc(names[c]?.[0] ?? c)}</th>`).join("")}</tr></thead><tbody>
          ${rows.map((x) => `<tr class="click" data-c="${esc(x.className)}"><td><b>${esc(x.className)}</b></td>${cats.map((c) => `<td>${x.cats[c] ? num(x.cats[c]) : `<span class="tag bad">0</span>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`
        : `<div class="note small">${L("Give photos a category when you import them (Sports, Art, Academic…) to see variety here.", "اختر فئة للصور عند استيرادها (رياضة، فنون، دراسة…) لترى التنوّع هنا.")}</div>`;
    } else
      tab.innerHTML = `<div class="card"><h2>${L("Week by week", "أسبوعًا بأسبوع")}</h2><p class="muted small">${L("Good photos of each class in each of the last 16 weeks. Pale weeks had none.", "الصور الجيدة لكل فصل في آخر 16 أسبوعًا. الأسابيع الباهتة بلا صور.")}</p>
        <div class="heatmap"><div class="hmrow head"><span></span>${r.heat.weeks.map((w, i) => `<span class="tiny muted">${i % 2 ? "" : esc(new Date(w + "T12:00:00").toLocaleDateString(S.language === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" }))}</span>`).join("")}</div>
        ${rows.map((x) => `<div class="hmrow" data-c="${esc(x.className)}"><span class="small">${esc(x.className)}</span>${(r.heat.rows[x.className] ?? r.heat.weeks.map(() => 0)).map((n) => `<i class="hm${Math.min(4, n === 0 ? 0 : n < 3 ? 1 : n < 8 ? 2 : n < 20 ? 3 : 4)}" title="${n}"></i>`).join("")}</div>`).join("")}</div></div>`;
    $$("[data-c]", box).forEach((c) => (c.onclick = () => { COV.open = c.dataset.c; this.openClass(); }));
    if (COV.open) this.openClass(false);
  },

  async openClass(scroll = true) {
    const el = $("#cv-class");
    if (!el || !COV.data) return;
    const list = COV.data.students.filter((s) => (s.class_name ?? "—") === COV.open);
    list.sort((a, b) => (b.can_post - a.can_post) || a.good - b.good);
    const missing = list.filter((k) => k.can_post && k.good === 0);
    const t = COV.data.classes.find((c) => c.className === COV.open);
    const teacher = (await quiet("studentTree"))?.teachers?.[COV.open];
    const review = (await quiet("people", { className: COV.open })) ?? [];
    const toCheck = new Map(review.map((p) => [p.id, p.review]));
    el.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${L("Class", "فصل")} ${esc(COV.open)} ${teacher ? `<span class="muted small">· ${L("class teacher", "معلم الفصل")} ${esc(teacher.name)}</span>` : ""}</h2>
        ${missing.some((k) => toCheck.get(k.id)) ? `<button class="btn small primary" id="cv-find">${icon("scan-face", 14)} ${L("Find photos of missing students", "ابحث عن صور الطلاب الغائبين")}</button>` : ""}
        <button class="btn small" id="cv-gap2">${icon("sparkles", 14)} ${L("Fill the gap post", "منشور سدّ الفجوة")}</button>
        <button class="btn small" id="cv-shot">${icon("clipboard-list", 14)} ${L("Shot list", "قائمة اللقطات")}</button>
        <button class="btn small" id="cv-lib">${icon("images", 14)} ${L("Class photos", "صور الفصل")}</button></div>
      ${t ? `<div class="row small muted" style="gap: 14px"><span>${icon("check", 12)} ${L(`${t.ready} of ${t.students} ready for the yearbook`, `${num(t.ready)} من ${num(t.students)} جاهزون للكتاب`)}</span>${t.noFocus ? `<span>${icon("user", 12)} ${L(`${t.noFocus} only in groups (never the focus)`, `${num(t.noFocus)} في مجموعات فقط (ليسوا محور الصورة)`)}</span>` : ""}${t.tooOften ? `<span style="color: var(--warn)">${L(`${t.tooOften} in posts too often`, `${num(t.tooOften)} في المنشورات كثيرًا`)}</span>` : ""}</div>` : ""}
      <div class="people">${list.map((k) => `<div class="person ${k.can_post ? "" : "off"}" data-id="${esc(k.id)}">${faceImg({ ...k, face: null }, true)}<b class="small">${esc(name(k))}</b>
        <span class="tag ${!k.can_post ? "" : k.status === "zero" ? "bad" : k.status === "low" ? "warn" : "good"}">${!k.can_post ? L("Can't appear", "لا يظهر") : `${num(k.good)} ${icon("image", 11)}`}</span>
        <span class="tiny muted">${[k.posted ? L(`${k.posted} in posts`, `${num(k.posted)} في منشورات`) : L("no posts", "بلا منشورات"), k.good && !k.focus ? L("only in groups", "في مجموعات فقط") : "", k.ready ? L("yearbook ✓", "الكتاب ✓") : ""].filter(Boolean).join(" · ")}</span>
        ${k.tooOften ? `<span class="badge">${L("Too often", "كثيرًا")}</span>` : toCheck.get(k.id) && k.good < 3 ? `<span class="tiny muted">${L(`${toCheck.get(k.id)} to check`, `${num(toCheck.get(k.id))} للتأكيد`)}</span>` : ""}</div>`).join("")}</div>
      <p class="muted small">${L("The shot list has students with no good photos or only 1-2, and those never the focus. Send it to the photographer's or class teacher's phone for the next event.", "قائمة اللقطات فيها الطلاب بلا صور جيدة أو بصورة أو اثنتين، ومن لم يكونوا محور أي صورة. أرسلها إلى هاتف المصور أو معلم الفصل للفعالية القادمة.")}</p></div>`;
    $$("[data-id]", el).forEach((x) => (x.onclick = () => go("student", { id: x.dataset.id })));
    $("#cv-lib", el).onclick = () => go("library", { className: COV.open });
    $("#cv-gap2", el).onclick = () => fillGapPost(this.filter({ className: COV.open }), COV.open);
    $("#cv-find", el)?.addEventListener("click", () => go("faces", { tab: "review", students: missing.filter((k) => toCheck.get(k.id)).map((k) => k.id) }));
    $("#cv-shot", el).onclick = () => shotListBox(this.filter({ className: COV.open }), COV.open);
    if (scroll) el.scrollIntoView({ behavior: "smooth", block: "start" });
  },
};

function heatStrip(cells) {
  if (!cells) return "";
  return `<div class="hstrip">${cells.slice(-12).map((n) => `<i class="hm${Math.min(4, n === 0 ? 0 : n < 3 ? 1 : n < 8 ? 2 : n < 20 ? 3 : 4)}"></i>`).join("")}</div>`;
}
function tooOftenCard(r) {
  const often = r.students.filter((s) => s.tooOften).sort((a, b) => b.posted - a.posted);
  if (!often.length) return `<div class="note good small">${icon("circle-check", 14)} ${L("No one is in posts far more than the others.", "لا أحد في المنشورات أكثر بكثير من الآخرين.")}</div>`;
  return `<div class="card"><h2>${L("In posts too often", "في المنشورات كثيرًا")}</h2><p class="muted small">${L(`More than 2.5 times the average (${r.avgPosted}). Give others a turn in the next posts.`, `أكثر من ضعفي المتوسط ونصف (${r.avgPosted}). أعطِ غيرهم فرصة في المنشورات القادمة.`)}</p>
    <div class="people">${often.slice(0, 24).map((k) => `<div class="person" data-id="${esc(k.id)}">${avatar(k, true)}<b class="small">${esc(name(k))}</b><span class="tag warn">${num(k.posted)}</span><span class="tiny muted">${esc(k.class_name ?? "")}</span></div>`).join("")}</div></div>`;
}

// Photos already in the library that together show the most students who
// haven't been in a post yet, straight into a new post.
async function fillGapPost(filter, className) {
  const r = await call("fillGap", filter);
  if (!r.missing) return toast(L("Everyone here has been in a post already.", "كل من هنا ظهر في منشور بالفعل."));
  if (!r.ids.length) return toast(L(`${r.missing} students haven't been in a post, but there are no good photos of them yet. Send a shot list.`, `${num(r.missing)} طالب لم يظهروا في منشور، ولا توجد صور جيدة لهم بعد. أرسل قائمة لقطات.`));
  const title = className ? L(`Class ${className}`, `فصل ${className}`) : L("Around the school", "في أرجاء المدرسة");
  toast(L(`${r.ids.length} photos show ${r.students.length} of the ${r.missing} students not in a post yet.`, `${num(r.ids.length)} صور تُظهر ${num(r.students.length)} من ${num(r.missing)} طالب لم يظهروا في منشور.`), { ms: 6000 });
  if (typeof makePostsFrom === "function") makePostsFrom({ ids: r.ids }, title, { single: true });
  else openViewer(r.ids, 0, {});
}

async function shotListBox(filter, className) {
  const list = await call("shotList", filter);
  const text = [`${L("Shot list", "قائمة اللقطات")}${className ? ` · ${className}` : ""}`, "", ...list.map((k) => `□ ${name(k)}${className ? "" : ` (${k.className ?? ""})`} · ${k.good}${k.good && !k.focus ? ` · ${L("close-up", "صورة قريبة")}` : ""}`)].join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const m = modal(`<div class="row"><h2 class="grow">${L("Shot list", "قائمة اللقطات")}${className ? ` · ${esc(className)}` : ""}</h2><button class="btn ghost" data-x>${icon("x")}</button></div>
    ${list.length ? `<p class="muted small">${L(`${list.length} students to photograph. The number is their good photos so far; "close-up" means they're only in groups.`, `${num(list.length)} طالب للتصوير. الرقم عدد صورهم الجيدة حتى الآن؛ «صورة قريبة» تعني أنهم في مجموعات فقط.`)}</p>
    <pre class="shot">${esc(text)}</pre>
    <div class="card tight"><b>${L("Send to the phone for an event", "إرسال إلى الهاتف لفعالية")}</b><div class="grid2"><label class="field">${L("Event", "الفعالية")}<input id="sl-t" placeholder="${esc(L("Sports day", "اليوم الرياضي"))}" /></label><label class="field">${L("Date", "التاريخ")}<input id="sl-d" type="date" value="${today}" /></label></div>
      <span class="tiny muted">${L("The photographer and the class teacher see it on the event's page on their phone and tick names off while they shoot. Names only, no faces.", "يراها المصور ومعلم الفصل في صفحة الفعالية على هواتفهم ويشطبون الأسماء أثناء التصوير. أسماء فقط، بلا وجوه.")}</span></div>
    <div class="row"><span class="grow"></span><button class="btn" id="sl-copy">${icon("copy", 14)} ${L("Copy", "نسخ")}</button><button class="btn primary" id="sl-send">${icon("smartphone", 14)} ${L("Send to phone", "إرسال إلى الهاتف")}</button></div>`
    : emptyState("circle-check", L("No one to add", "لا أحد للإضافة"), L("Everyone here has 3 good photos and one where they're the focus.", "كل من هنا لديه 3 صور جيدة وصورة يكون فيها محورها."))}`, { wide: true });
  $("[data-x]", m).onclick = closeOverlay;
  $("#sl-copy", m)?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(L("Copied. Paste it into WhatsApp or an email.", "تم النسخ. الصقها في واتساب أو بريد."));
    } catch {
      toast(L("Couldn't copy.", "تعذّر النسخ."));
    }
  });
  $("#sl-send", m)?.addEventListener("click", async () => {
    const title = $("#sl-t", m).value.trim();
    if (title.length < 2) return $("#sl-t", m).focus();
    try {
      const n = await call("sendShotList", filter, title, $("#sl-d", m).value);
      closeOverlay();
      toast(L(`Shot list of ${n} students is on the event's page on the phone.`, `قائمة لقطات ${num(n)} طالب موجودة في صفحة الفعالية على الهاتف.`));
    } catch {}
  });
}
