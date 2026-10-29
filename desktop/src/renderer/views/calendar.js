// The calendar: Day, Week, Month, List and a whole-year Overview. Posts in
// their category colour, the weekly posting times as "No post yet" slots,
// school events and occasions, terms and Hijri dates, no-posting days,
// gaps, each week's category balance, yearly repeats, last year's posts this
// week, countdowns and events whose photos haven't come in yet.

const CAL_KINDS = () => ({ event: L("Event", "فعالية"), trip: L("Trip", "رحلة"), exam: L("Exams", "امتحانات"), holiday: L("Holiday", "عطلة"), occasion: L("Occasion", "مناسبة"), sport: L("Sports", "رياضة"), meeting: L("Meeting", "اجتماع") });
const calLocale = () => (S.language === "en" ? "en-GB" : "ar-EG");
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fromKey = (k) => new Date(`${k}T12:00:00`);

App.views.calendar = {
  render(main, params) {
    if (!S.signedIn) return needSignIn(main, L("Calendar", "التقويم"));
    this.view = params.view === "4days" ? "week" : params.view ?? this.view ?? "month";
    this.layers = this.layers ?? { lastYear: false, slots: true, events: true, occasions: true };
    this.cat = this.cat ?? null;
    this.status = this.status ?? null;
    const today = new Date();
    if (params.day) this.anchor = fromKey(params.day);
    this.anchor = this.anchor ?? new Date(today.getFullYear(), today.getMonth(), today.getDate());
    main.innerHTML =
      topbar(L("Calendar", "التقويم"), "",
        `<button class="btn ghost" id="c-prev">${icon(S.language === "en" ? "chevron-left" : "chevron-right", 16)}</button><button class="btn" id="c-today">${L("Today", "اليوم")}</button><button class="btn ghost" id="c-next">${icon(S.language === "en" ? "chevron-right" : "chevron-left", 16)}</button>
         ${pills([["day", L("Day", "يوم")], ["week", L("Week", "أسبوع")], ["month", L("Month", "شهر")], ["list", L("List", "قائمة")], ["overview", L("Year", "السنة")]], this.view, "data-cv")}
         <button class="btn primary" id="c-new">${icon("plus", 15)} ${L("New", "جديد")}</button>`) +
      `<div class="content col gap8"><div class="row" id="c-bar"></div><div id="c-notes" class="col gap4"></div><div id="cal" class="cal">${skeletonRows(6)}</div><div id="c-strip"></div></div>`;
    const shift = (n) => {
      const a = this.anchor;
      this.anchor = this.view === "day" ? addDays(a, n) : this.view === "week" ? addDays(a, 7 * n) : this.view === "overview" ? new Date(a.getFullYear() + n, a.getMonth(), 1) : new Date(a.getFullYear(), a.getMonth() + n, 1);
      this.load();
    };
    $("#c-prev", main).onclick = () => shift(-1);
    $("#c-next", main).onclick = () => shift(1);
    $("#c-today", main).onclick = () => { this.anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate()); this.load(); };
    bindPills(main, "data-cv", (v) => go("calendar", { view: v }));
    $("#c-new", main).onclick = () =>
      menu([
        { label: L("New post…", "منشور جديد…"), run: () => newPostMenu() },
        { label: L("New idea…", "فكرة جديدة…"), run: () => newIdea() },
        { label: L("Announcement…", "إعلان…"), run: () => announcementBox() },
        "-",
        { label: L("School event…", "فعالية مدرسية…"), run: () => eventBox({}) },
        { label: L("Import the term calendar…", "استيراد تقويم الفصل…"), run: () => importCalendar() },
        { label: L("Make a week of posts…", "أنشئ منشورات أسبوع…"), run: () => makeWeekBox() },
      ]);
    this.load();
  },
  onKey(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") $(e.key === "ArrowLeft" ? (S.language === "en" ? "#c-prev" : "#c-next") : S.language === "en" ? "#c-next" : "#c-prev")?.click();
    if (e.key === "t") $("#c-today")?.click();
    if (["d", "w", "m"].includes(e.key)) go("calendar", { view: { d: "day", w: "week", m: "month" }[e.key] });
  },
  range() {
    const a = this.anchor;
    const satStart = (d) => addDays(d, -((d.getDay() + 1) % 7));
    if (this.view === "day") return { start: a, days: 1 };
    if (this.view === "week") return { start: satStart(a), days: 7 };
    if (this.view === "list") return { start: a, days: 42 };
    if (this.view === "overview") {
      const s = new Date(a.getFullYear(), 0, 1);
      return { start: s, days: Math.round((new Date(a.getFullYear() + 1, 0, 1) - s) / 864e5) };
    }
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const s = satStart(first);
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: s, days: Math.ceil(((last - s) / 864e5 + 1) / 7) * 7 };
  },
  async load() {
    const { start, days } = this.range();
    const end = addDays(start, days - 1);
    const from = isoDay(start), to = isoDay(end);
    const title =
      this.view === "day" ? start.toLocaleDateString(calLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : this.view === "week" || this.view === "list" ? `${fmtDate(from)} – ${fmtDate(to)}`
      : this.view === "overview" ? String(this.anchor.getFullYear())
      : this.anchor.toLocaleDateString(calLocale(), { month: "long", year: "numeric" });
    const tb = $(".topbar .title");
    if (tb) tb.innerHTML = `<b>${L("Calendar", "التقويم")}</b><span>${esc(title)}${this.view !== "overview" ? ` · ${esc(hijri(from))}` : ""}</span>`;
    const [r, x, occ] = await Promise.all([quiet("app", "calendar", { from, to }), quiet("app", "calendarMore", { from, to }), quiet("occasionsBetween", from, to)]);
    const box = $("#cal");
    if (!box) return;
    if (!r || r.error) {
      box.innerHTML = `<div class="note bad">${L("Couldn't load the calendar. Check the internet.", "تعذّر تحميل التقويم. تحقق من الإنترنت.")}</div>`;
      return;
    }
    this.r = r;
    this.x = x ?? {};
    this.occ = occ ?? [];
    this.posts = r.posts;
    this.start = start;
    this.days = days;
    this.draw();
  },
  // Everything about one day, from all the layers.
  day(k) {
    const r = this.r, x = this.x;
    const tz = r.timezone;
    const dayOf = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const hm = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
    const d = fromKey(k);
    let posts = r.posts.filter((p) => (p.published_at ?? p.scheduled_at ? dayOf(p.published_at ?? p.scheduled_at) === k : p.due_on === k));
    if (this.cat) posts = posts.filter((p) => p.category_id === this.cat);
    if (this.status === "planned") posts = posts.filter((p) => !["published", "failed"].includes(p.status));
    if (this.status === "posted") posts = posts.filter((p) => p.status === "published");
    if (this.status === "waiting") posts = posts.filter((p) => ["in_review", "waiting_extra"].includes(p.status));
    posts = posts.map((p) => ({ ...p, time: p.scheduled_at || p.published_at ? hm(p.published_at ?? p.scheduled_at) : null })).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
    const used = new Set(posts.filter((p) => p.time).map((p) => p.time));
    const off = this.offDay(k);
    const slots = off ? [] : r.slots.filter((s) => s.weekday === d.getDay() && !used.has(s.at_time.slice(0, 5)) && (!this.cat || s.category_id === this.cat)).sort((a, b) => a.at_time.localeCompare(b.at_time));
    const events = [...r.events, ...(x.repeats ?? []).map((e) => ({ ...e, repeat: true }))].filter((e) => e.event_date === k || (e.ends_on && e.event_date <= k && e.ends_on >= k));
    const occ = this.occ.filter((o) => o.date === k);
    const ly = this.layers.lastYear ? (x.lastYear ?? []).filter((p) => p.day === k) : [];
    const countdowns = r.posts.filter((p) => p.countdown_to === k);
    return { k, d, posts, slots, events, occ, ly, off, countdowns };
  },
  offDay(k) {
    const x = this.x;
    const d = fromKey(k);
    if ((x.noPostDays?.weekdays ?? []).includes(d.getDay())) return L("No posting", "بلا نشر");
    if (x.noPostDays?.holidays !== false) {
      const h = (x.holidays ?? []).find((t) => t.start && t.start <= k && (t.end || t.start) >= k);
      if (h) return h.name || L("Holiday", "عطلة");
    }
    return null;
  },
  termOf(k) {
    const t = (this.x.terms ?? S.terms ?? []).find((y) => y.start && y.end && y.start <= k && y.end >= k);
    if (!t) return null;
    return { name: t.name, week: Math.floor((Date.parse(k) - Date.parse(t.start)) / (7 * 864e5)) + 1 };
  },
  catOf(id) {
    return this.r.categories.find((c) => c.id === id);
  },
  postChip(p) {
    const c = this.catOf(p.category_id);
    return `<div class="cpost" draggable="${!["published", "publishing"].includes(p.status)}" data-id="${p.id}" style="${c ? `border-inline-start: 3px solid ${esc(c.color)}` : ""}">
      ${p.cover ? `<img src="${esc(p.cover)}" />` : ""}<span class="sd ${STATUS_TAG[p.status] ?? ""}"></span><span class="grow">${p.time ? `<b>${esc(p.time)}</b> ` : ""}${esc(postText(p) || statusName(p.status))}</span>${p.countdown_to ? icon("timer", 11) : ""}</div>`;
  },
  slotChip(k, s) {
    const c = this.catOf(s.category_id);
    return `<div class="cslot" data-slot="${k}" data-time="${esc(s.at_time.slice(0, 5))}" data-cat="${esc(s.category_id ?? "")}" style="${c ? `border-color: ${esc(c.color)}; color: ${esc(c.color)}` : ""}">${icon("plus", 11)} <b>${esc(s.at_time.slice(0, 5))}</b> ${esc(c?.name ?? "")} <span class="muted">${L("No post yet · Add post", "لا منشور بعد · أضف منشوراً")}</span></div>`;
  },
  eventChip(e) {
    return `<div class="cev k-${esc(e.kind ?? "event")}" data-ev="${esc(e.id)}" ${e.repeat ? `data-rep="1"` : ""} title="${esc(CAL_KINDS()[e.kind] ?? "")}">${e.repeat ? icon("repeat", 10) : e.photos_expected ? icon("camera", 10) : ""} ${esc(e.title)}${e.repeat ? ` <span class="muted">${esc(String(e.from_year))}</span>` : ""}</div>`;
  },
  cell(k, opts = {}) {
    const x = this.day(k);
    const todayKey = isoDay(new Date());
    const out = opts.month !== undefined && x.d.getMonth() !== opts.month;
    const term = this.termOf(k);
    const future = k >= todayKey;
    return `<div class="cday ${out ? "out" : ""} ${k === todayKey ? "today" : ""} ${opts.tall ? "tall" : ""} ${x.off ? "off" : ""}" data-day="${k}">
      <div class="row nowrap"><span class="dn">${x.d.getDate()}</span><span class="hj">${esc(hijriDay(k))}</span><span class="grow"></span>${opts.showTerm && term && x.d.getDay() === 6 ? `<span class="tw">${esc(L(`W${term.week}`, `أ${num(term.week)}`))}</span>` : ""}${future ? `<button class="link small cadd" data-new="${k}" title="${L("Add post", "أضف منشوراً")}">${icon("plus", 12)}</button>` : ""}</div>
      ${x.off ? `<div class="coff">${icon("moon", 10)} ${esc(x.off)}</div>` : ""}
      ${this.layers.occasions ? x.occ.map((o) => `<div class="cev k-occasion" data-occ="${esc(o.id)}">${icon("party-popper", 10)} ${esc(OCC_NAMES()[o.id] ?? o.id)}</div>`).join("") : ""}
      ${this.layers.events ? x.events.map((e) => this.eventChip(e)).join("") : ""}
      ${x.posts.map((p) => this.postChip(p)).join("")}
      ${x.ly.map((p) => `<div class="cpost ghost" data-ly="${esc(p.id)}" title="${L("Last year", "العام الماضي")}">${icon("history", 10)}<span class="grow">${esc(p.text)}</span></div>`).join("")}
      ${future && this.layers.slots ? x.slots.map((s) => this.slotChip(k, s)).join("") : ""}
    </div>`;
  },
  // Each week's mix of categories, as one bar.
  balance(keys) {
    const posts = keys.flatMap((k) => this.day(k).posts);
    if (!posts.length) return `<div class="cbal none">${L("No posts this week", "لا منشورات هذا الأسبوع")}</div>`;
    const by = new Map();
    for (const p of posts) by.set(p.category_id ?? "", (by.get(p.category_id ?? "") ?? 0) + 1);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = parts[0];
    const warn = posts.length >= 3 && top[1] / posts.length > 0.6;
    return `<div class="cbal" title="${parts.map(([c, n]) => `${this.catOf(c)?.name ?? L("No category", "بدون تصنيف")}: ${n}`).join("\n")}">${parts.map(([c, n]) => `<i style="flex: ${n}; background: ${esc(this.catOf(c)?.color ?? "var(--grey-bg)")}"></i>`).join("")}</div>${warn ? `<span class="cbalw">${icon("triangle-alert", 11)} ${L(`Mostly ${this.catOf(top[0])?.name ?? "one kind"}`, `غالباً ${this.catOf(top[0])?.name ?? "نوع واحد"}`)}</span>` : ""}`;
  },
  notes() {
    const box = $("#c-notes");
    if (!box) return;
    const x = this.x;
    const out = [];
    // Photos expected after an event, still missing.
    for (const e of x.photosMissing ?? []) out.push(`<div class="note warn row">${icon("camera", 14)}<span class="grow">${L(`No photos yet from “${esc(e.title)}” (${fmtDate(e.event_date)}).`, `لا صور بعد من «${esc(e.title)}» (${fmtDate(e.event_date)}).`)}</span><button class="btn small" data-go="import">${L("Import them", "استوردها")}</button></div>`);
    // Gaps: the next 14 days with no post and posting allowed.
    const todayKey = isoDay(new Date());
    const gaps = [];
    for (let i = 0; i < 14; i++) {
      const k = isoDay(addDays(new Date(), i));
      if (k < isoDay(this.start) || k > isoDay(addDays(this.start, this.days - 1))) continue;
      if (this.offDay(k)) continue;
      if (!this.r.slots.some((s) => s.weekday === fromKey(k).getDay())) continue;
      if (!this.day(k).posts.length) gaps.push(k);
    }
    if (gaps.length >= 2) out.push(`<div class="note row">${icon("calendar-x", 14)}<span class="grow">${L(`Nothing planned on ${gaps.length} posting days: ${gaps.slice(0, 5).map(fmtDate).join(", ")}${gaps.length > 5 ? "…" : ""}`, `لا شيء مخطط في ${num(gaps.length)} أيام نشر: ${gaps.slice(0, 5).map(fmtDate).join("، ")}${gaps.length > 5 ? "…" : ""}`)}</span><button class="btn small" id="c-fill">${icon("sparkles", 13)} ${L("Make a week of posts", "أنشئ منشورات أسبوع")}</button></div>`);
    // Countdowns to big events coming up.
    const big = (this.r.events ?? []).filter((e) => e.event_date > todayKey && ["event", "sport", "trip"].includes(e.kind) && !this.r.posts.some((p) => p.countdown_to === e.event_date)).slice(0, 2);
    for (const e of big) if (Date.parse(e.event_date) - Date.now() < 21 * 864e5) out.push(`<div class="note row">${icon("timer", 14)}<span class="grow">${L(`“${esc(e.title)}” is on ${fmtDate(e.event_date)}. Count down to it?`, `«${esc(e.title)}» يوم ${fmtDate(e.event_date)}. عدّ تنازلي له؟`)}</span><button class="btn small" data-count="${esc(e.id)}">${L("Make countdown posts", "أنشئ منشورات العد التنازلي")}</button></div>`);
    box.innerHTML = out.join("");
    $$("[data-go]", box).forEach((b) => (b.onclick = () => go(b.dataset.go)));
    $("#c-fill", box)?.addEventListener("click", () => makeWeekBox());
    $$("[data-count]", box).forEach((b) => (b.onclick = () => countdownBox(this.r.events.find((e) => e.id === b.dataset.count))));
  },
  bar() {
    const b = $("#c-bar");
    if (!b) return;
    const cats = this.r.categories;
    b.innerHTML = `${pillMenu("cat", L("Category", "التصنيف"), cats.map((c) => [c.id, c.name]), this.cat)}${pillMenu("st", L("Status", "الحالة"), [["planned", L("Planned", "مخطط")], ["waiting", L("Waiting for approval", "بانتظار الاعتماد")], ["posted", L("Posted", "منشور")]], this.status)}
      <button class="pill ${this.layers.slots ? "on" : ""}" data-layer="slots">${icon("clock", 12)} ${L("Posting times", "مواعيد النشر")}</button>
      <button class="pill ${this.layers.events ? "on" : ""}" data-layer="events">${icon("calendar-days", 12)} ${L("School events", "فعاليات المدرسة")}</button>
      <button class="pill ${this.layers.occasions ? "on" : ""}" data-layer="occasions">${icon("party-popper", 12)} ${L("Occasions", "المناسبات")}</button>
      <button class="pill ${this.layers.lastYear ? "on" : ""}" data-layer="lastYear">${icon("history", 12)} ${L("Last year", "العام الماضي")}</button>
      <span class="grow"></span>${(this.x.best ?? []).length ? `<span class="muted small" title="${L("From reactions to your posts", "من التفاعل مع منشوراتك")}">${icon("trending-up", 12)} ${L("Best times", "أفضل الأوقات")}: ${this.x.best.slice(0, 3).map((t) => esc(t.at)).join(" · ")}</span>` : ""}
      <button class="btn small ghost" id="c-grid">${icon("grid-3x3", 13)} ${L("Instagram grid", "شبكة إنستجرام")}</button>`;
    bindPillMenu(b, "cat", cats.map((c) => [c.id, c.name]), this.cat, (v) => { this.cat = v ?? null; this.draw(); });
    bindPillMenu(b, "st", [["planned", L("Planned", "مخطط")], ["waiting", L("Waiting for approval", "بانتظار الاعتماد")], ["posted", L("Posted", "منشور")]], this.status, (v) => { this.status = v ?? null; this.draw(); });
    $$("[data-layer]", b).forEach((el) => (el.onclick = () => { this.layers[el.dataset.layer] = !this.layers[el.dataset.layer]; this.draw(); }));
    $("#c-grid", b).onclick = () => go("posts", { layout: "grid" });
  },
  draw() {
    const box = $("#cal");
    if (!box || !this.r) return;
    this.bar();
    this.notes();
    const keys = Array.from({ length: this.days }, (_, i) => isoDay(addDays(this.start, i)));
    const heads = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 3 + i).toLocaleDateString(calLocale(), { weekday: "short" }));
    if (this.view === "month") {
      const weeks = [];
      for (let i = 0; i < keys.length; i += 7) weeks.push(keys.slice(i, i + 7));
      box.innerHTML = `<div class="chead">${heads.map((w) => `<div>${esc(w)}</div>`).join("")}</div>
        ${weeks.map((w) => `<div class="calgrid">${w.map((k) => this.cell(k, { month: this.anchor.getMonth(), showTerm: true })).join("")}</div><div class="cweek">${this.termOf(w[0]) ? `<span class="muted small">${esc(this.termOf(w[0]).name)} · ${L(`week ${this.termOf(w[0]).week}`, `الأسبوع ${num(this.termOf(w[0]).week)}`)}</span>` : ""}${this.balance(w)}</div>`).join("")}`;
    } else if (this.view === "week") {
      const term = this.termOf(keys[0]);
      const plan = keys.reduce((n, k) => n + this.day(k).posts.filter((p) => ["approved", "scheduled", "published"].includes(p.status)).length, 0);
      const slots = keys.reduce((n, k) => n + (this.offDay(k) ? 0 : this.r.slots.filter((s) => s.weekday === fromKey(k).getDay()).length), 0);
      box.innerHTML = `<div class="row"><b>${term ? `${esc(term.name)} · ${L(`week ${term.week}`, `الأسبوع ${num(term.week)}`)}` : ""}</b><span class="grow"></span><span class="muted small">${L(`${plan} of ${slots} posting times ready`, `${num(plan)} من ${num(slots)} مواعيد جاهزة`)}</span><div style="width: 180px">${this.balance(keys)}</div></div>
        <div class="chead">${keys.map((k) => `<div>${esc(fromKey(k).toLocaleDateString(calLocale(), { weekday: "short", day: "numeric" }))}</div>`).join("")}</div><div class="calgrid">${keys.map((k) => this.cell(k, { tall: true })).join("")}</div>`;
    } else if (this.view === "day") {
      const x = this.day(keys[0]);
      const term = this.termOf(keys[0]);
      box.innerHTML = `<div class="dayv"><div class="col gap8">
        <div class="row"><b style="font-size: 18px">${esc(x.d.toLocaleDateString(calLocale(), { weekday: "long", day: "numeric", month: "long" }))}</b><span class="muted">${esc(hijri(keys[0]))}${term ? ` · ${esc(term.name)} · ${L(`week ${term.week}`, `الأسبوع ${num(term.week)}`)}` : ""}</span></div>
        ${x.off ? `<div class="note">${icon("moon", 14)} ${esc(x.off)}: ${L("no posts go out today.", "لا تُنشر منشورات اليوم.")}</div>` : ""}
        ${[...x.occ.map((o) => `<div class="cev k-occasion big" data-occ="${esc(o.id)}">${icon("party-popper", 13)} ${esc(OCC_NAMES()[o.id] ?? o.id)}</div>`), ...x.events.map((e) => this.eventChip(e))].join("")}
        <div class="dayline">${Array.from({ length: 16 }, (_, i) => i + 6).map((hr) => {
          const hh = String(hr).padStart(2, "0");
          const ps = x.posts.filter((p) => p.time?.startsWith(hh));
          const sl = x.slots.filter((s) => s.at_time.startsWith(hh));
          return `<div class="dhour" data-day="${keys[0]}" data-hour="${hh}"><span class="muted small">${hh}:00</span><div class="grow col gap4">${ps.map((p) => this.postChip(p)).join("")}${sl.map((s) => this.slotChip(keys[0], s)).join("")}</div></div>`;
        }).join("")}</div>
        ${x.posts.filter((p) => !p.time).map((p) => this.postChip(p)).join("")}
        ${x.ly.length ? `<b class="small">${L("This day last year", "هذا اليوم العام الماضي")}</b>${x.ly.map((p) => `<div class="cpost ghost" data-ly="${esc(p.id)}">${icon("history", 11)}<span class="grow">${esc(p.text)}</span></div>`).join("")}` : ""}
      </div></div>`;
    } else if (this.view === "list") {
      const rows = keys.map((k) => this.day(k)).filter((x) => x.posts.length || x.events.length || x.occ.length || (x.slots.length && x.k >= isoDay(new Date())));
      box.innerHTML = rows.length
        ? `<div class="col gap8">${rows.map((x) => `<div class="lday" data-day="${x.k}"><div class="lhead"><b>${esc(x.d.toLocaleDateString(calLocale(), { weekday: "long", day: "numeric", month: "long" }))}</b> <span class="muted small">${esc(hijri(x.k))}</span>${x.off ? ` <span class="tag">${esc(x.off)}</span>` : ""}</div>
            <div class="col gap4">${[...x.occ.map((o) => `<div class="cev k-occasion" data-occ="${esc(o.id)}">${icon("party-popper", 10)} ${esc(OCC_NAMES()[o.id] ?? o.id)}</div>`), ...x.events.map((e) => this.eventChip(e)), ...x.posts.map((p) => this.postChip(p)), ...(x.k >= isoDay(new Date()) ? x.slots.map((s) => this.slotChip(x.k, s)) : [])].join("")}</div></div>`).join("")}</div>`
        : emptyState("calendar", L("Nothing in the next six weeks", "لا شيء في الأسابيع الستة القادمة"));
    } else {
      // The whole year: each day a dot coloured by how many posts it has.
      const y = this.anchor.getFullYear();
      box.innerHTML = `<div class="yeargrid">${Array.from({ length: 12 }, (_, m) => {
        const first = new Date(y, m, 1);
        const lead = (first.getDay() + 1) % 7;
        const n = new Date(y, m + 1, 0).getDate();
        let posted = 0;
        const cells = Array.from({ length: n }, (_, i) => {
          const k = isoDay(new Date(y, m, i + 1));
          const x = this.day(k);
          posted += x.posts.length;
          const c = x.posts.length ? this.catOf(x.posts[0].category_id)?.color ?? "var(--accent)" : null;
          return `<i class="yd ${x.off ? "off" : ""} ${x.events.length || x.occ.length ? "ev" : ""} ${k === isoDay(new Date()) ? "today" : ""}" data-gday="${k}" title="${esc(fmtDate(k))}${x.posts.length ? ` · ${x.posts.length}` : ""}${x.events.map((e) => ` · ${e.title}`).join("")}${x.occ.map((o) => ` · ${OCC_NAMES()[o.id] ?? o.id}`).join("")}" style="${c ? `background: ${esc(c)}; opacity: ${Math.min(1, 0.45 + x.posts.length * 0.25)}` : ""}">${i + 1}</i>`;
        });
        return `<div class="ymonth"><div class="row"><b>${esc(first.toLocaleDateString(calLocale(), { month: "long" }))}</b><span class="grow"></span><span class="muted small">${L(`${posted} posts`, `${num(posted)} منشور`)}</span></div><div class="ydays">${"<i></i>".repeat(lead)}${cells.join("")}</div></div>`;
      }).join("")}</div>`;
      $$("[data-gday]", box).forEach((el) => (el.onclick = () => { this.anchor = fromKey(el.dataset.gday); go("calendar", { view: "day", day: el.dataset.gday }); }));
    }
    this.bind(box);
    this.strip();
  },
  bind(box) {
    const todayKey = isoDay(new Date());
    $$(".cpost[data-id]", box).forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); openPost(el.dataset.id); };
      el.ondragstart = (e) => e.dataTransfer.setData("text/post", el.dataset.id);
    });
    $$("[data-new]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); newPostMenu(el.dataset.new); }));
    $$("[data-slot]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); slotPost(el.dataset.slot, el.dataset.time, el.dataset.cat); }));
    $$("[data-ev]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); const ev = this.findEvent(el.dataset.ev); if (ev) eventBox(ev); }));
    $$("[data-occ]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); announcementBox({ occasion: el.dataset.occ, day: el.closest("[data-day]")?.dataset.day }); }));
    $$(".cday, .dhour, .lday", box).forEach((cell) => {
      cell.ondblclick = () => cell.dataset.day >= todayKey && newPostMenu(cell.dataset.day);
      cell.ondragover = (e) => { if (cell.dataset.day >= todayKey) { e.preventDefault(); cell.classList.add("over"); } };
      cell.ondragleave = () => cell.classList.remove("over");
      cell.ondrop = async (e) => {
        cell.classList.remove("over");
        const id = e.dataTransfer.getData("text/post");
        const photos = e.dataTransfer.getData("text/photos") || (JSON.parse(e.dataTransfer.getData("text/hub-photos") || "[]").join(","));
        const slot = e.target.closest("[data-slot]");
        const time = slot?.dataset.time ?? (cell.dataset.hour ? `${cell.dataset.hour}:00` : undefined);
        if (id) {
          await quiet("app", "move", { id, day: cell.dataset.day, time });
          return this.load();
        }
        if (photos) makePostsFrom({ ids: photos.split(",").map(Number) }, "", { single: true, day: cell.dataset.day });
      };
    });
    onContext(box, ".cpost[data-id]", (el) => postMenu(el.dataset.id, () => this.load()));
    onContext(box, "[data-ev]", (el) => {
      const ev = this.findEvent(el.dataset.ev);
      if (!ev) return [];
      return [
        { label: L("Edit…", "تعديل…"), run: () => eventBox(ev) },
        { label: L("Make posts from its photos…", "أنشئ منشورات من صوره…"), run: () => makePostsFrom({ search: ev.title }, ev.title, { day: ev.event_date >= todayKey ? ev.event_date : null }) },
        { label: L("Make countdown posts…", "أنشئ منشورات العد التنازلي…"), enabled: ev.event_date > todayKey, run: () => countdownBox(ev) },
        { label: L("Expect photos after it", "انتظر صوراً بعدها"), checked: !!ev.photos_expected, run: () => saveEvent({ ...ev, photos_expected: !ev.photos_expected }) },
        { label: L("Repeat every year", "كرّر كل عام"), checked: !!ev.repeat_yearly, run: () => saveEvent({ ...ev, repeat_yearly: !ev.repeat_yearly }) },
        "-",
        { label: L("Delete", "حذف"), run: async () => { if (await confirmBox(L(`Delete “${ev.title}”?`, `حذف «${ev.title}»؟`), L("Delete", "حذف"))) { await quiet("app", "deleteEvent", { id: ev.id }); this.load(); } } },
      ];
    });
    onContext(box, ".cday, .lday", (el) => {
      const k = el.dataset.day;
      return [
        { label: L("New post…", "منشور جديد…"), enabled: k >= todayKey, run: () => newPostMenu(k) },
        { label: L("New idea…", "فكرة جديدة…"), run: () => newIdea(k) },
        { label: L("Announcement…", "إعلان…"), enabled: k >= todayKey, run: () => announcementBox({ day: k }) },
        { label: L("School event on this day…", "فعالية مدرسية في هذا اليوم…"), run: () => eventBox({ event_date: k }) },
        "-",
        { label: L("Open this day", "افتح هذا اليوم"), run: () => go("calendar", { view: "day", day: k }) },
      ];
    });
  },
  findEvent(id) {
    return this.r.events.find((e) => e.id === id) ?? (this.x.repeats ?? []).find((e) => e.id === id);
  },
  // Picks not posted yet, to drag onto a day.
  async strip() {
    const s = $("#c-strip");
    if (!s || this.view === "overview") return s && (s.innerHTML = "");
    const list = await quiet("photos", { flag: 1, sort: "newest", limit: 40 });
    const fresh = (list ?? []).filter((p) => !p.posts).slice(0, 30);
    s.innerHTML = fresh.length ? `<div class="card tight"><div class="row"><b class="small grow">${icon("star", 13)} ${L("Picks not posted yet: drag them onto a day", "مختارة لم تُنشر: اسحبها إلى يوم")}</b></div><div class="mkstrip drag">${fresh.map((p) => `<img draggable="true" data-pid="${p.id}" src="hub://thumb/${p.id}" />`).join("")}</div></div>` : "";
    const chosen = new Set();
    $$("[data-pid]", s).forEach((img) => {
      img.onclick = () => { const k = Number(img.dataset.pid); chosen.has(k) ? chosen.delete(k) : chosen.add(k); img.classList.toggle("on", chosen.has(k)); };
      img.ondragstart = (e) => { const ids = chosen.size ? [...chosen] : [Number(img.dataset.pid)]; e.dataTransfer.setData("text/photos", ids.join(",")); };
    });
  },
};

const hijriDay = (k) => {
  try {
    return new Intl.DateTimeFormat(S.language === "en" ? "en-u-ca-islamic-umalqura" : "ar-u-ca-islamic-umalqura", { day: "numeric" }).format(fromKey(k));
  } catch {
    return "";
  }
};

// A posting time with nothing in it: make a post there.
function slotPost(day, time, category) {
  menu([
    { label: L("Post from an event…", "منشور من فعالية…"), run: () => eventPicker(day) },
    { label: L("Post from my picks…", "منشور من المختارة…"), run: () => makePostsFrom({ flag: 1 }, L("My picks", "المختارة"), { day }) },
    { label: L("Announcement…", "إعلان…"), run: () => announcementBox({ day }) },
    { label: L("Text only", "نص فقط"), run: async () => { const r = await call("app", "createMany", { posts: [{ day, time, category_id: category || null }] }); if (r.ids?.[0]) openPost(r.ids[0]); } },
    { label: L("Just an idea", "مجرد فكرة"), run: () => newIdea(day) },
  ]);
}

async function saveEvent(ev) {
  const r = await quiet("app", "saveEvent", { event: ev });
  if (!r?.id) return toast(L("Couldn't save the event.", "تعذّر حفظ الفعالية."));
  toast(L("Saved", "تم الحفظ"));
  App.views.calendar.load?.();
  return r.id;
}

// A school event: trip, exams, open day, sports day, holiday.
function eventBox(ev) {
  const m = modal(`<h2>${ev.id ? L("School event", "فعالية مدرسية") : L("New school event", "فعالية مدرسية جديدة")}</h2>
    <label class="field">${L("Name", "الاسم")}<input id="ev-t" value="${esc(ev.title ?? "")}" placeholder="${L("For example: Sports day", "مثلاً: اليوم الرياضي")}" /></label>
    <div class="grid2"><label class="field">${L("Day", "اليوم")}<input type="date" id="ev-d" value="${esc(ev.event_date ?? isoDay(new Date()))}" /></label><label class="field">${L("Ends (optional)", "ينتهي (اختياري)")}<input type="date" id="ev-e" value="${esc(ev.ends_on ?? "")}" /></label></div>
    <div class="grid2"><label class="field">${L("Kind", "النوع")}<select id="ev-k">${Object.entries(CAL_KINDS()).map(([k, l]) => `<option value="${k}" ${k === (ev.kind ?? "event") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field">${L("Class (optional)", "الفصل (اختياري)")}<input id="ev-c" value="${esc(ev.class_name ?? "")}" /></label></div>
    <div class="srow"><span class="grow">${L("Expect photos after it", "انتظر صوراً بعدها")}<span class="muted small block">${L("If no photos come in, the calendar and Today remind you.", "إن لم تصل صور، يذكّرك التقويم واليوم.")}</span></span>${sw('id="ev-p"', ev.photos_expected ?? true)}</div>
    <div class="srow"><span class="grow">${L("Repeat every year", "كرّر كل عام")}<span class="muted small block">${L("Shows on the same day next year, with this year's post to start from.", "يظهر في اليوم نفسه العام القادم مع منشور هذا العام كبداية.")}</span></span>${sw('id="ev-r"', !!ev.repeat_yearly)}</div>
    <div class="row">${ev.id && ev.event_date > isoDay(new Date()) ? `<button class="btn ghost" id="ev-cd">${icon("timer", 14)} ${L("Countdown posts…", "منشورات العد التنازلي…")}</button>` : ""}<span class="grow"></span><button class="btn" id="ev-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="ev-ok">${L("Save", "حفظ")}</button></div>`);
  $("#ev-no", m).onclick = closeOverlay;
  $("#ev-cd", m)?.addEventListener("click", () => countdownBox(ev));
  $("#ev-ok", m).onclick = async () => {
    const id = await saveEvent({ id: ev.repeat ? undefined : ev.id, title: $("#ev-t", m).value, event_date: $("#ev-d", m).value, ends_on: $("#ev-e", m).value || null, kind: $("#ev-k", m).value, class_name: $("#ev-c", m).value, photos_expected: $("#ev-p", m).checked, repeat_yearly: $("#ev-r", m).checked });
    if (id) closeOverlay();
  };
}

// Countdown posts before a big event: "3 days to Sports Day".
function countdownBox(ev) {
  if (!ev) return;
  const chosen = new Set([7, 3, 1]);
  const m = modal(`<h2>${icon("timer", 18)} ${L("Countdown to", "عدّ تنازلي إلى")} ${esc(ev.title)}</h2>
    <p class="muted small">${L("Each one becomes a draft on its day; the AI writes the words when you open it.", "كل واحد يصبح مسودة في يومه، ويكتب الذكاء الاصطناعي النص عند فتحه.")}</p>
    ${pills([14, 7, 5, 3, 2, 1].map((n) => [n, L(`${n} days before`, `قبل ${num(n)} يوم`)]), "", "data-cd")}
    <div class="row"><span class="grow"></span><button class="btn" id="cd-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="cd-ok">${L("Make them", "أنشئها")}</button></div>`);
  const mark = () => $$("[data-cd]", m).forEach((b) => b.classList.toggle("on", chosen.has(Number(b.dataset.cd))));
  mark();
  bindPills(m, "data-cd", (v) => { const n = Number(v); chosen.has(n) ? chosen.delete(n) : chosen.add(n); mark(); });
  $("#cd-no", m).onclick = closeOverlay;
  $("#cd-ok", m).onclick = async () => {
    const today = isoDay(new Date());
    const posts = [...chosen].map((n) => ({ n, day: isoDay(addDays(fromKey(ev.event_date), -n)) })).filter((p) => p.day >= today).map((p) => ({
      day: p.day,
      countdown_to: ev.event_date,
      idea: L(`${p.n} days to ${ev.title}`, `${p.n} أيام على ${ev.title}`),
      caption_ar: `باقي ${p.n === 1 ? "يوم واحد" : p.n === 2 ? "يومان" : `${p.n} أيام`} على ${ev.title}! ⏳`,
      caption_en: `${p.n === 1 ? "Just one day" : `${p.n} days`} to go until ${ev.title}! ⏳`,
    }));
    const r = await quiet("app", "createMany", { posts, why: "countdown" });
    closeOverlay();
    toast(L(`${r?.ids?.length ?? 0} countdown posts made`, `أُنشئ ${num(r?.ids?.length ?? 0)} منشور عد تنازلي`));
    App.views.calendar.load?.();
  };
}

// The term calendar from Excel, CSV or a calendar file.
async function importCalendar() {
  const r = await call("readCalendarFile");
  if (!r) return;
  if (!r.events.length) return toast(L("No dates found in that file.", "لم توجد تواريخ في هذا الملف."));
  const keep = new Set(r.events.map((_, i) => i));
  const m = modal(`<h2>${L("Import the term calendar", "استيراد تقويم الفصل")}</h2><p class="muted small">${esc(r.file)} · ${L(`${r.events.length} dates found`, `${num(r.events.length)} تاريخ`)}</p>
    <div class="col gap4" style="max-height: 50vh; overflow-y: auto">${r.events.map((e, i) => `<label class="wkrow"><input type="checkbox" data-k="${i}" checked /><span class="muted small" style="width: 160px">${esc(fmtDate(e.event_date))}${e.ends_on ? ` – ${esc(fmtDate(e.ends_on))}` : ""}</span><span class="grow">${esc(e.title)}</span><span class="tag">${esc(CAL_KINDS()[e.kind] ?? e.kind)}</span></label>`).join("")}</div>
    <div class="srow"><span class="grow">${L("Holidays also become no-posting days", "العطل تصبح أيام بلا نشر أيضاً")}</span>${sw('id="ic-h"', true)}</div>
    <div class="row"><span class="grow"></span><button class="btn" id="ic-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="ic-ok">${L("Import", "استيراد")}</button></div>`, { wide: true });
  $$("[data-k]", m).forEach((c) => (c.onchange = () => (c.checked ? keep.add(Number(c.dataset.k)) : keep.delete(Number(c.dataset.k)))));
  $("#ic-no", m).onclick = closeOverlay;
  $("#ic-ok", m).onclick = async () => {
    const list = r.events.filter((_, i) => keep.has(i));
    const res = await quiet("app", "saveEvents", { events: list.map((e) => ({ ...e, photos_expected: !["holiday", "exam"].includes(e.kind) })) });
    if ($("#ic-h", m).checked) {
      const s = await quiet("app", "school");
      const hol = list.filter((e) => e.kind === "holiday").map((e) => ({ name: e.title, start: e.event_date, end: e.ends_on ?? e.event_date }));
      if (hol.length && s) await quiet("app", "setSchool", { patch: { holidays: [...(s.holidays ?? []), ...hol] } });
    }
    closeOverlay();
    toast(L(`${res?.added ?? 0} dates added`, `أُضيف ${num(res?.added ?? 0)} تاريخ`));
    App.views.calendar.load?.();
  };
}
