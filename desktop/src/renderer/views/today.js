// Today: cards the person chooses, orders and sizes. The layout is saved
// for them (it follows them to every Mac and the website Today) and starts
// from a sensible default for their role.
const TODAY = { local: null, web: null, editing: false, layout: null };

const CARDS = () => ({
  plan: { title: L("Plan for today", "خطة اليوم"), icon: "list-checks" },
  problems: { title: L("Posting problems", "مشاكل النشر"), icon: "triangle-alert" },
  week: { title: L("This week", "هذا الأسبوع"), icon: "calendar-days", wide: true },
  events: { title: L("Events", "الفعاليات"), icon: "folder" },
  imports: { title: L("Recent imports", "آخر الاستيرادات"), icon: "download" },
  progress: { title: L("This week's plan", "خطة الأسبوع"), icon: "chart-column" },
  waiting: { title: L("Waiting on others", "في انتظار الآخرين"), icon: "hourglass" },
  occasions: { title: L("Coming up", "مناسبات قادمة"), icon: "party-popper" },
  coverage: { title: L("Students not seen lately", "طلاب لم يظهروا مؤخرًا"), icon: "users" },
  results: { title: L("Last week's results", "نتائج الأسبوع الماضي"), icon: "chart-line" },
  inbox: { title: L("Comments to answer", "تعليقات تنتظر الرد"), icon: "message-circle" },
  picks: { title: L("Picks not used yet", "صور مختارة لم تُستخدم"), icon: "star" },
  onthisday: { title: L("On this day", "في مثل هذا اليوم"), icon: "history" },
  alerts: { title: L("Team news", "أخبار الفريق"), icon: "bell" },
  setup: { title: L("Set up", "الإعداد"), icon: "rocket" },
});
// Sensible starting layouts per role (people change them).
const TODAY_DEFAULTS = {
  admin: ["setup", "plan", "problems", "week", "waiting", "results", "coverage", "progress", "events", "imports", "occasions", "alerts"],
  comms_lead: ["setup", "plan", "problems", "week", "waiting", "progress", "events", "imports", "inbox", "occasions", "picks", "coverage", "results", "onthisday", "alerts"],
  comms: ["setup", "plan", "problems", "week", "events", "imports", "picks", "inbox", "occasions", "coverage", "onthisday", "alerts"],
  principal: ["week", "waiting", "results", "coverage", "occasions"],
  teacher: ["events", "imports", "coverage"],
  staff: ["events", "imports"],
  photographer: ["events", "imports"],
};
const defaultLayout = (role) => (TODAY_DEFAULTS[role] ?? TODAY_DEFAULTS.comms).map((key) => ({ key, size: CARDS()[key]?.wide ? "wide" : "normal", hidden: false }));

function hijriLabel(d) {
  try {
    return new Intl.DateTimeFormat(S.language === "en" ? "en-u-ca-islamic-umalqura" : "ar-u-ca-islamic-umalqura", { day: "numeric", month: "long" }).format(d);
  } catch {
    return "";
  }
}
// "Term 1 · week 6" from the school's own term dates.
function termWeek(d = new Date()) {
  const day = d.toISOString().slice(0, 10);
  const t = (S.terms ?? []).find((x) => x.start && x.end && x.start <= day && x.end >= day);
  if (!t) return "";
  const n = Math.floor((Date.parse(day) - Date.parse(t.start)) / (7 * 86400_000)) + 1;
  return L(`${t.name} · week ${n}`, `${t.name} · الأسبوع ${num(n)}`);
}
const OCC_NAMES = () => ({ ...OCC(), national: L("National day", "عيد وطني") });

App.views.today = {
  render(main) {
    const hour = new Date().getHours();
    const hello = hour < 12 ? L("Good morning", "صباح الخير") : L("Good afternoon", "مساء الخير");
    const now = new Date();
    const date = now.toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "long", day: "numeric", month: "long" });
    main.innerHTML =
      topbar(hello, [date, hijriLabel(now), termWeek(now)].filter(Boolean).map(esc).join(" · "),
        `<button class="btn ghost" id="t-edit">${icon("layout-grid", 14)} ${L("Customise", "تخصيص")}</button><button class="btn" id="t-imp">${icon("download", 14)} ${L("Import", "استيراد")}</button><button class="btn primary" id="t-post">${icon("plus", 14)} ${L("New post", "منشور جديد")}</button>`) +
      `<div class="content"><div id="today" class="tgrid">${skeletonRows(6)}</div></div>`;
    $("#t-imp", main).onclick = () => go("import");
    $("#t-post", main).onclick = () => go("posts", { new: true });
    $("#t-edit", main).onclick = () => {
      TODAY.editing = !TODAY.editing;
      this.draw();
    };
    this.fill();
  },
  onState(changed) {
    if (TODAY.editing) return;
    if (changed.some((c) => ["photos", "faces", "students", "all"].includes(c))) {
      clearTimeout(TODAY.t);
      TODAY.t = setTimeout(() => this.fill(true), 1200);
    }
  },
  keys: () => [["⌘N", L("New post", "منشور جديد")], ["E", L("Customise", "تخصيص")]],
  onKey(e) {
    if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
      TODAY.editing = !TODAY.editing;
      this.draw();
      return true;
    }
  },
  async fill(quietly) {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
    const [local, web] = await Promise.all([quiet("todayLocal"), S.signedIn ? quiet("app", "today", { from, to }) : null]);
    TODAY.local = local;
    TODAY.web = web && !web.error ? web : null;
    // The layout follows the person: the website copy wins when there is one.
    const saved = TODAY.web?.layout ?? S.todayLayout;
    TODAY.layout = Array.isArray(saved) && saved.length ? saved.filter((x) => CARDS()[x.key]) : defaultLayout(TODAY.web?.role ?? S.role);
    for (const key of Object.keys(CARDS())) if (!TODAY.layout.some((x) => x.key === key)) TODAY.layout.push({ key, size: CARDS()[key].wide ? "wide" : "normal", hidden: true });
    if (!quietly || !TODAY.editing) this.draw();
  },
  async saveLayout(layout) {
    TODAY.layout = layout;
    await call("set", "todayLayout", layout);
    if (S.signedIn) quiet("app", "saveLayout", { layout });
  },
  draw() {
    const box = $("#today");
    if (!box || !TODAY.layout) return;
    const cards = CARDS();
    const shown = TODAY.layout.filter((x) => !x.hidden);
    const html = shown
      .map((x) => {
        const body = this.card(x.key);
        if (body == null && !TODAY.editing) return "";
        return `<section class="card tcard ${x.size === "wide" ? "wide" : ""} ${TODAY.editing ? "editing" : ""}" data-key="${x.key}" ${TODAY.editing ? 'draggable="true"' : ""}>
          <div class="row nowrap thead"><span class="sic">${icon(cards[x.key].icon, 15)}</span><h3 class="grow">${cards[x.key].title}</h3>
          ${TODAY.editing ? `<button class="btn small ghost" data-size="${x.key}" title="${L("Wider or narrower", "أعرض أو أضيق")}">${icon(x.size === "wide" ? "minimize-2" : "maximize-2", 14)}</button><button class="btn small ghost" data-hide="${x.key}" title="${L("Hide", "إخفاء")}">${icon("eye-off", 14)}</button><span class="grip" title="${L("Drag to move", "اسحب للنقل")}">${icon("grip-vertical", 14)}</span>` : ""}</div>
          ${body ?? `<p class="muted small">${L("Nothing here right now.", "لا شيء هنا الآن.")}</p>`}</section>`;
      })
      .join("");
    const hidden = TODAY.layout.filter((x) => x.hidden);
    box.innerHTML =
      (TODAY.editing
        ? `<div class="card wide row"><span class="grow"><b>${L("Customise Today", "تخصيص اليوم")}</b> <span class="muted small">${L("Drag cards to move them, make them wider, or hide them. Your layout follows you to every computer and the website.", "اسحب البطاقات لنقلها، أو اجعلها أعرض، أو أخفها. يتبعك ترتيبك على كل جهاز وعلى الموقع.")}</span></span>
            <button class="btn small ghost" id="t-reset">${L("Back to default", "الوضع الافتراضي")}</button><button class="btn small primary" id="t-done">${L("Done", "تم")}</button></div>
            ${hidden.length ? `<div class="card wide"><b class="small">${L("Add a card", "إضافة بطاقة")}</b><div class="row" style="margin-top: 8px">${hidden.map((x) => `<button class="btn small" data-show="${x.key}">${icon(cards[x.key].icon, 13)} ${cards[x.key].title}</button>`).join("")}</div></div>` : ""}`
        : this.computerLimit()) + html;
    this.bind(box);
  },
  computerLimit() {
    const m = /^computer-limit:(\d+)$/.exec(S.message ?? "");
    return m ? `<div class="note warn wide">${L(`This school's plan allows ${m[1]} library computers and they are all in use. Remove one on the website (Settings → Account) to use this one.`, `خطة المدرسة تسمح بـ ${num(+m[1])} أجهزة مكتبة وكلها مستخدمة. احذف جهازًا من الموقع (الإعدادات ← الحساب) لاستخدام هذا الجهاز.`)}</div>` : "";
  },

  // ---------- The cards ----------
  card(key) {
    const l = TODAY.local ?? {};
    const w = TODAY.web;
    const c = S.counts ?? {};
    const needWeb = `<p class="muted small">${L("Sign in to the website to see this (Settings → Account).", "سجّل الدخول إلى الموقع لترى هذا (الإعدادات ← الحساب).")}</p>`;
    const tiles = (ids, extra = "") => `<div class="tstrip">${ids.map((id) => `<img src="hub://thumb/${id}" data-photo="${id}" loading="lazy" />`).join("")}${extra}</div>`;
    const day = (d) => fmtDate(d);
    switch (key) {
      case "setup":
        return this.setupCard();
      case "plan": {
        const items = [];
        const today = new Date().toISOString().slice(0, 10);
        for (const p of (w?.posts ?? []).filter((p) => (p.scheduled_at ?? "").slice(0, 10) === today && p.status !== "published"))
          items.push([p.status === "scheduled" ? "clock" : "pen-line", L(`Post at ${new Date(p.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: ${postText(p) || statusName(p.status)}`, `منشور الساعة ${new Date(p.scheduled_at).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" })}: ${postText(p) || statusName(p.status)}`), `data-post="${p.id}"`]);
        const todaysEvents = (w?.events ?? []).filter((e) => e.event_date <= today && (e.ends_on ?? e.event_date) >= today && e.kind !== "holiday");
        for (const e of todaysEvents) items.push(["camera", L(`${e.title} today: remember to take photos`, `${e.title} اليوم: لا تنسَ التصوير`), ""]);
        const freeSlot = this.freeSlots(today);
        if (freeSlot) items.push(["calendar-plus", L(`${freeSlot} empty posting slot today`, `${num(freeSlot)} موعد نشر فارغ اليوم`), `data-go="calendar"`]);
        if (l.toCull) items.push(["star", L(`${num(l.toCull)} new photos to pick from`, `${num(l.toCull)} صورة جديدة للاختيار منها`), `data-golib="tocull"`]);
        if (l.facesToConfirm) items.push(["scan-face", L(`${num(l.facesToConfirm)} faces to confirm`, `${num(l.facesToConfirm)} وجه للتأكيد`), `data-go="faces"`]);
        if (w?.waiting?.length && ["admin", "comms_lead", "principal"].includes(w.role)) items.push(["badge-check", L(`${num(w.waiting.length)} posts waiting for approval`, `${num(w.waiting.length)} منشورات تنتظر الموافقة`), `data-go="posts"`]);
        if (l.birthdays?.length) items.push(["cake", L(`${num(l.birthdays.length)} student birthdays this week`, `${num(l.birthdays.length)} أعياد ميلاد طلاب هذا الأسبوع`), `data-go="students"`]);
        return items.length ? `<div class="col gap4">${items.map(([ic, t, a]) => `<button class="trow" ${a}>${icon(ic, 15)}<span class="grow">${esc(t)}</span>${icon("chevron-right", 14)}</button>`).join("")}</div>` : `<p class="muted">${L("Nothing planned. A good day to pick photos.", "لا شيء مخطط. يوم جيد لاختيار الصور.")}</p>`;
      }
      case "problems": {
        if (!w) return null;
        const p = w.problems ?? [];
        if (!p.length && !S.queue?.failed) return null;
        const text = { failed: L("A post failed to publish", "فشل نشر منشور"), paused: L("Posting is paused", "النشر متوقف مؤقتًا"), expiring: L("The Facebook connection ends soon: reconnect it", "ينتهي ربط فيسبوك قريبًا: أعد الربط"), account: L("Facebook or Instagram reported a problem", "أبلغ فيسبوك أو إنستجرام عن مشكلة"), notConnected: L("Facebook and Instagram aren't connected", "فيسبوك وإنستجرام غير مربوطين") };
        return `<div class="col gap4">${p.map((x) => `<button class="trow bad" ${x.id ? `data-post="${x.id}"` : `data-web="${x.kind === "paused" ? "/settings" : "/accounts"}"`}>${icon("triangle-alert", 15)}<span class="grow">${esc(text[x.kind] ?? x.kind)}${x.text && x.kind !== "expiring" ? ` <span class="muted small">${esc(String(x.text).slice(0, 90))}</span>` : x.kind === "expiring" ? ` <span class="muted small">${day(x.text)}</span>` : ""}</span>${icon("chevron-right", 14)}</button>`).join("")}
          ${S.queue?.failed ? `<button class="trow bad" id="t-retry">${icon("cloud-off", 15)}<span class="grow">${L(`${num(S.queue.failed)} photos couldn't be sent to the website`, `${num(S.queue.failed)} صورة تعذّر إرسالها`)}</span><span class="link small">${L("Try again", "إعادة المحاولة")}</span></button>` : ""}</div>`;
      }
      case "week":
        return this.weekStrip();
      case "events": {
        const lib = l.events ?? [];
        const upcoming = (w?.events ?? []).filter((e) => e.event_date >= new Date().toISOString().slice(0, 10) && e.kind !== "holiday").slice(0, 4);
        if (!lib.length && !upcoming.length) return null;
        return `<div class="col gap4">${upcoming.map((e) => `<div class="trow">${icon("calendar", 15)}<span class="grow">${esc(e.title)} <span class="muted small">${day(e.event_date)}</span></span>${e.photos_expected ? `<span class="tag warn">${L("Photos expected", "صور متوقعة")}</span>` : ""}</div>`).join("")}
          ${lib.map((e) => `<button class="trow" data-event="${esc(e.key)}">${e.cover ? `<img class="tthumb" src="hub://thumb/${e.cover}" />` : icon("folder", 15)}<span class="grow">${esc(e.title ?? "")} <span class="muted small">${day(e.date)} · ${plural(e.n, "photo", "photos", "صورة")}</span></span>${e.picks ? `<span class="tag good">${L(`${num(e.picks)} picked`, `${num(e.picks)} مختارة`)}</span>` : `<span class="tag">${L("Not picked yet", "لم يُختر بعد")}</span>`}</button>`).join("")}</div>`;
      }
      case "imports": {
        if (!l.imports?.length) return null;
        return `<div class="col gap12">${l.imports.map((i) => `<div class="col gap4"><div class="row nowrap"><b class="grow">${esc(i.source ?? "")}</b><span class="muted small">${fmtDate(new Date(i.at).toISOString())} · ${plural(i.copied, "photo", "photos", "صورة")}</span></div>
          ${tiles(i.covers)}<div class="row"><button class="btn small" data-impcull="${i.id}">${icon("star", 13)} ${L("Pick best", "اختيار الأفضل")}</button><button class="btn small" data-imppost="${i.id}" data-title="${esc(i.source ?? "")}">${icon("send", 13)} ${L("Make a post", "إنشاء منشور")}</button><button class="btn small ghost" data-impsum="${i.id}">${L("Summary", "الملخص")}</button></div></div>`).join("")}</div>`;
      }
      case "progress": {
        if (!w) return needWeb;
        const slots = this.weekSlots();
        const ready = slots.filter((s) => s.post && ["approved", "scheduled", "published"].includes(s.post.status)).length;
        const planned = slots.filter((s) => s.post).length;
        if (!slots.length) return `<p class="muted small">${L("No weekly posting times yet. Set them on the website (Categories → Times).", "لا توجد مواعيد نشر أسبوعية بعد. اضبطها على الموقع (التصنيفات ← المواعيد).")}</p><button class="btn small" data-web="/categories?tab=slots">${L("Set posting times", "ضبط مواعيد النشر")}</button>`;
        return `<div class="col gap8"><div class="row"><b style="font-size: 26px">${num(ready)}<span class="muted" style="font-size: 15px"> / ${num(slots.length)}</span></b><span class="muted small grow">${L("posts ready this week", "منشورات جاهزة هذا الأسبوع")}${planned > ready ? ` · ${L(`${num(planned - ready)} in progress`, `${num(planned - ready)} قيد العمل`)}` : ""}</span></div>
          <div class="bar"><i style="width:${(ready / slots.length) * 100}%"></i></div>
          ${slots.filter((s) => !s.post).slice(0, 4).map((s) => `<button class="trow" data-newday="${s.day}">${icon("calendar-plus", 14)}<span class="grow">${L("Empty", "فارغ")}: ${esc(new Date(`${s.day}T12:00:00`).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "short" }))} ${esc(s.at.slice(0, 5))}${s.category ? ` · <span style="color:${esc(s.category.color)}">${esc(s.category.name)}</span>` : ""}</span><span class="link small">${L("Add post", "إضافة منشور")}</span></button>`).join("")}</div>`;
      }
      case "waiting": {
        if (!w) return needWeb;
        if (!w.waiting?.length) return `<p class="muted small">${L("Nobody is holding anything up.", "لا شيء متوقف عند أحد.")}</p>`;
        return `<div class="col gap4">${w.waiting.map((p) => `<div class="trow"><span class="grow" data-post="${p.id}" style="cursor: pointer">${esc(postText(p) || statusName(p.status))} <span class="muted small">${p.status === "waiting_extra" ? L("with the principal", "عند المدير") : L("waiting for approval", "ينتظر الموافقة")} · ${L(`${num(p.hours)} h`, `${num(p.hours)} ساعة`)}</span></span><button class="btn small" data-remind="${p.id}">${icon("bell-ring", 13)} ${L("Remind", "تذكير")}</button></div>`).join("")}</div>`;
      }
      case "occasions": {
        const o = l.occasions ?? [];
        const ev = (w?.events ?? []).filter((e) => e.kind === "occasion" && e.event_date >= new Date().toISOString().slice(0, 10));
        if (!o.length && !ev.length) return null;
        return `<div class="col gap4">${[...o.map((x) => ({ name: OCC_NAMES()[x.id] ?? x.id, date: x.date, inDays: x.inDays, id: x.id })), ...ev.map((e) => ({ name: e.title, date: e.event_date, inDays: Math.round((Date.parse(e.event_date) - Date.now()) / 86400_000), id: null }))]
          .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
          .map((x) => `<div class="trow">${icon("party-popper", 15)}<span class="grow">${esc(x.name)} <span class="muted small">${day(x.date)} · ${x.inDays <= 0 ? L("today", "اليوم") : L(`in ${x.inDays} days`, `بعد ${num(x.inDays)} يوم`)}</span></span>
            <button class="btn small" data-occpost="${esc(x.id ?? "")}" data-occname="${esc(x.name)}">${L("Make the post", "إنشاء المنشور")}</button>${x.id ? `<button class="btn small ghost" data-occphotos="${x.id}" title="${L("Photos from other years", "صور من سنوات سابقة")}">${icon("images", 13)}</button>` : ""}</div>`).join("")}</div>`;
      }
      case "coverage": {
        const n = l.notSeen;
        if (!n?.students) return null;
        if (!n.total) return `<p class="muted">${L("Every student appeared in a photo in the last 3 weeks.", "ظهر كل الطلاب في صورة خلال آخر 3 أسابيع.")}</p>`;
        return `<div class="col gap8"><div class="row"><b style="font-size: 26px">${num(n.total)}</b><span class="muted small grow">${L(`of ${n.students} students not in any photo for 3 weeks`, `من ${num(n.students)} طالب لم يظهروا في أي صورة منذ 3 أسابيع`)}</span></div>
          ${n.classes.map((c) => `<button class="trow" data-cov="${esc(c.class_name ?? "")}"><span class="grow">${esc(c.class_name ?? "—")}</span><span class="tag warn">${num(c.n)}</span>${icon("chevron-right", 14)}</button>`).join("")}</div>`;
      }
      case "results": {
        if (!w) return needWeb;
        const r = w.results;
        if (!r?.posts) return `<p class="muted small">${L("No posts were published last week.", "لم يُنشر شيء الأسبوع الماضي.")}</p>`;
        const stat = (n, t) => `<div class="col"><b style="font-size: 20px">${num(n)}</b><span class="muted small">${t}</span></div>`;
        return `<div class="row" style="gap: 22px">${stat(r.posts, L("posts", "منشورات"))}${stat(r.reach, L("people reached", "شخص وصل إليهم"))}${stat(r.likes, L("likes", "إعجاب"))}${stat(r.comments, L("comments", "تعليق"))}${stat(r.shares, L("shares", "مشاركة"))}</div>
          ${r.top ? `<button class="trow" data-post="${r.top.id}" style="margin-top: 8px">${icon("trophy", 15)}<span class="grow"><b>${L("Best post", "أفضل منشور")}</b> <span class="muted small">${esc(r.top.text)}</span></span></button>` : ""}`;
      }
      case "inbox": {
        if (!w) return needWeb;
        if (!w.inbox) return null;
        if (!w.inbox.open) return `<p class="muted">${L("All comments answered.", "تم الرد على كل التعليقات.")}</p>`;
        return `<div class="col gap8"><div class="muted small">${L(`${num(w.inbox.open)} waiting · ${num(w.inbox.questions)} questions`, `${num(w.inbox.open)} في الانتظار · ${num(w.inbox.questions)} أسئلة`)}</div>
          ${w.inbox.latest.map((m, i) => `<div class="col gap4 tcomment"><div><b>${esc(m.author)}</b> <span class="muted small">${icon(m.platform === "instagram" ? "instagram" : "facebook", 11)}</span> ${esc(m.text)}</div><div class="row" id="rep-${i}"><button class="btn small" data-suggest="${i}">${icon("sparkles", 13)} ${L("Suggest replies", "اقتراح ردود")}</button></div></div>`).join("")}
          <button class="btn small ghost" data-web="/inbox" style="align-self: flex-start">${L("Open the inbox", "فتح صندوق التعليقات")}</button></div>`;
      }
      case "picks": {
        if (!l.readyCount) return null;
        return `${tiles(l.ready)}<div class="row" style="margin-top: 8px"><span class="muted small grow">${L(`${num(l.readyCount)} picked photos aren't in any post yet`, `${num(l.readyCount)} صورة مختارة ليست في أي منشور بعد`)}</span><button class="btn small" data-golib="ready">${L("See them", "عرضها")}</button></div>`;
      }
      case "onthisday": {
        if (!l.onThisDay?.length) return null;
        const years = [...new Set(l.onThisDay.map((p) => p.y))];
        return `${tiles(l.onThisDay.map((p) => p.id))}<div class="row" style="margin-top: 8px"><span class="muted small grow">${L(`This week in ${years.join(", ")}`, `هذا الأسبوع في ${years.join("، ")}`)}</span><button class="btn small" data-golib="lastyear">${L("See all", "عرض الكل")}</button></div>`;
      }
      case "alerts": {
        const a = (w?.alerts ?? []).filter((x) => !x.read).slice(0, 5);
        if (!a.length) return null;
        return `<div class="col gap4">${a.map((x) => `<div class="trow">${icon(x.kind === "import" ? "download" : x.kind === "book" ? "book-open" : "bell-ring", 15)}<span class="grow">${esc(x.kind === "import" ? L(`${x.body.by ?? ""} imported ${x.body.count} photos: ${x.body.title}`, `${x.body.by ?? ""} استورد ${num(x.body.count)} صورة: ${x.body.title}`) : x.kind === "book" ? L(`Yearbook sent for review: ${x.body.title}`, `كتاب سنوي أُرسل للمراجعة: ${x.body.title}`) : L(`${x.body.from} reminds you: ${x.body.text}`, `${x.body.from} يذكّرك: ${x.body.text}`))} <span class="muted small">${fmtDate(x.at)}</span></span><button class="btn small ghost" data-read="${x.id}">${icon("check", 13)}</button></div>`).join("")}</div>`;
      }
    }
    return null;
  },

  // Posting times this week, each with the post planned for it (if any).
  weekSlots() {
    const w = TODAY.web;
    if (!w?.slots?.length) return [];
    const out = [];
    const used = new Set();
    const cats = new Map((w.categories ?? []).map((c) => [c.id, c]));
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() + i * 86400_000);
      const iso = d.toISOString().slice(0, 10);
      if (this.noPost(iso)) continue;
      for (const s of w.slots.filter((x) => x.weekday === d.getDay()).sort((a, b) => a.at_time.localeCompare(b.at_time))) {
        const post = (w.posts ?? []).find((p) => !used.has(p.id) && (p.scheduled_at ?? p.published_at ?? "").slice(0, 10) === iso && (!s.category_id || !p.category_id || p.category_id === s.category_id));
        if (post) used.add(post.id);
        out.push({ day: iso, at: s.at_time, category: cats.get(s.category_id) ?? null, post });
      }
    }
    return out;
  },
  freeSlots(day) {
    return this.weekSlots().filter((s) => s.day === day && !s.post).length;
  },
  noPost(iso) {
    const w = TODAY.web;
    const npd = w?.noPostDays ?? {};
    const wd = new Date(`${iso}T12:00:00`).getDay();
    if ((npd.weekdays ?? []).includes(wd)) return true;
    if (npd.holidays !== false && (w?.holidays ?? []).some((h) => h.start && h.start <= iso && (h.end || h.start) >= iso)) return true;
    return false;
  },
  weekStrip() {
    const w = TODAY.web;
    const cats = new Map((w?.categories ?? []).map((c) => [c.id, c]));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() + i * 86400_000);
      const iso = d.toISOString().slice(0, 10);
      const posts = (w?.posts ?? []).filter((p) => (p.scheduled_at ?? p.published_at ?? p.due_on ?? "").slice(0, 10) === iso);
      const events = (w?.events ?? []).filter((e) => e.event_date <= iso && (e.ends_on ?? e.event_date) >= iso);
      const free = this.weekSlots().filter((s) => s.day === iso && !s.post).length;
      days.push(`<div class="wday ${i === 0 ? "now" : ""} ${this.noPost(iso) ? "off" : ""}" data-day="${iso}">
        <div class="row nowrap"><b>${esc(d.toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "short" }))}</b><span class="grow"></span><span>${esc(d.toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { day: "numeric" }))}</span></div>
        <div class="muted tiny">${esc(hijriLabel(d))}</div>
        ${events.map((e) => `<div class="wev">${esc(e.title)}</div>`).join("")}
        ${posts.map((p) => `<div class="wpost" data-post="${p.id}" style="--c:${esc(cats.get(p.category_id)?.color ?? "var(--accent)")}"><span class="sd ${STATUS_TAG[p.status] ?? ""}"></span>${esc(postText(p) || statusName(p.status))}</div>`).join("")}
        ${free ? `<button class="wfree" data-newday="${iso}">${icon("plus", 12)} ${L(`${free} empty`, `${num(free)} فارغ`)}</button>` : ""}</div>`);
    }
    return `${w ? "" : `<p class="muted small">${L("Sign in to see the posts planned this week.", "سجّل الدخول لترى منشورات هذا الأسبوع.")}</p>`}<div class="wstrip">${days.join("")}</div><div class="muted tiny" style="margin-top: 6px">${esc(termWeek())}</div>`;
  },
  setupCard() {
    const c = S.counts ?? {};
    const web = TODAY.web?.setup ?? {};
    const steps = [
      ["library", !!S.library, L("Choose the photo library folder", "اختر مجلد مكتبة الصور"), () => go("settings", { page: "library" })],
      ["signin", !!S.signedIn, L("Sign in to your school", "سجّل الدخول إلى مدرستك"), () => go("settings", { page: "account" })],
      ["classLists", c.students > 0, L("Import the class lists", "استورد قوائم الفصول"), () => go("students", { import: true })],
      ["firstImport", c.photos > 0, L("Import the first photos", "استورد أول الصور"), () => go("import")],
      ["firstFaces", c.tagged >= 10, L("Name 10 faces so the app learns the students", "سمِّ 10 وجوه ليتعرف التطبيق على الطلاب"), () => go("faces")],
      ["accounts", !!web.accounts, L("Connect Facebook and Instagram", "اربط فيسبوك وإنستجرام"), () => call("openWeb", "/accounts")],
      ["brand", !!web.brand, L("Tell the AI about the school (website set-up)", "عرّف الذكاء الاصطناعي بالمدرسة (إعداد الموقع)"), () => call("openWeb", "/setup")],
      ["slots", !!web.slots, L("Choose the weekly posting times", "اختر مواعيد النشر الأسبوعية"), () => call("openWeb", "/categories?tab=slots")],
      ["firstPost", !!web.firstPost, L("Publish the first post", "انشر أول منشور"), () => go("posts", { new: true })],
    ];
    const done = steps.filter((s) => s[1]).length;
    if (done === steps.length) return null;
    this._steps = steps;
    return `<div class="row"><span class="muted small grow">${L(`${done} of ${steps.length} done. Steps done on the website show here too.`, `تم ${num(done)} من ${num(steps.length)}. الخطوات المنجزة على الموقع تظهر هنا أيضًا.`)}</span><button class="btn small" id="t-wizard">${L("Set-up guide", "دليل الإعداد")}</button></div>
      <div class="bar" style="margin: 8px 0"><i style="width:${(done / steps.length) * 100}%"></i></div>
      <div class="steps">${steps.map((s, i) => `<div class="s ${s[1] ? "done" : ""}"><span class="ck">${s[1] ? icon("check", 12) : i + 1}</span><span class="lab grow">${s[2]}</span>${s[1] ? "" : `<button class="btn small" data-step="${i}">${L("Start", "ابدأ")}</button>`}</div>`).join("")}</div>`;
  },

  bind(box) {
    $$("[data-go]", box).forEach((b) => (b.onclick = () => go(b.dataset.go)));
    $$("[data-golib]", box).forEach((b) => (b.onclick = () => go("library", { album: b.dataset.golib })));
    $$("[data-post]", box).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); go("posts", { post: b.dataset.post }); }));
    $$("[data-web]", box).forEach((b) => (b.onclick = () => call("openWeb", b.dataset.web)));
    $$("[data-event]", box).forEach((b) => (b.onclick = () => go("library", { event: b.dataset.event })));
    $$("[data-photo]", box).forEach((b) => (b.onclick = () => openViewer([...b.parentElement.querySelectorAll("[data-photo]")].map((x) => Number(x.dataset.photo)), [...b.parentElement.children].indexOf(b))));
    $$("[data-impcull]", box).forEach((b) => (b.onclick = () => go("library", { album: `imp:${b.dataset.impcull}`, title: L("This import", "هذا الاستيراد"), cull: true })));
    $$("[data-imppost]", box).forEach((b) => (b.onclick = () => typeof makePostsFrom === "function" && makePostsFrom({ album: `imp:${b.dataset.imppost}` }, b.dataset.title)));
    $$("[data-impsum]", box).forEach((b) => (b.onclick = () => go("import", { summary: Number(b.dataset.impsum) })));
    $$("[data-newday]", box).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); go("posts", { new: true, day: b.dataset.newday }); }));
    $$("[data-cov]", box).forEach((b) => (b.onclick = () => go("coverage", { className: b.dataset.cov })));
    $$("[data-remind]", box).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      const r = await call("app", "remind", { id: b.dataset.remind });
      if (r?.ok) toast(L("Reminder sent", "أُرسل التذكير"));
    }));
    $$("[data-read]", box).forEach((b) => (b.onclick = async () => {
      await quiet("app", "readAlert", { id: b.dataset.read });
      const a = TODAY.web?.alerts?.find((x) => x.id === b.dataset.read);
      if (a) a.read = true;
      this.draw();
    }));
    $$("[data-occphotos]", box).forEach((b) => (b.onclick = () => go("library", { album: `occ:${b.dataset.occphotos}` })));
    $$("[data-occpost]", box).forEach((b) => (b.onclick = () => call("openWeb", `/posts/new/announcement?occasion=${encodeURIComponent(b.dataset.occpost)}&title=${encodeURIComponent(b.dataset.occname)}`)));
    $$("[data-suggest]", box).forEach((b) => (b.onclick = async () => {
      const m = TODAY.web.inbox.latest[Number(b.dataset.suggest)];
      const row = $(`#rep-${b.dataset.suggest}`, box);
      row.innerHTML = `<span class="muted small">${L("Thinking…", "جارٍ التفكير…")}</span>`;
      const r = await quiet("app", "suggestReplies", { comment: m.text, postText: m.postText });
      if (!r?.replies?.length) return (row.innerHTML = `<span class="muted small">${L("No ideas this time. Answer on the website.", "لا اقتراحات هذه المرة. رد من الموقع.")}</span>`);
      row.innerHTML = `<div class="col gap4 grow">${r.replies.map((t, i) => `<div class="row nowrap"><textarea class="grow" rows="2" data-rt="${i}">${esc(t)}</textarea><button class="btn small primary" data-send="${i}">${L("Send", "إرسال")}</button></div>`).join("")}</div>`;
      $$("[data-send]", row).forEach((s) => (s.onclick = async () => {
        const text = $(`[data-rt="${s.dataset.send}"]`, row).value.trim();
        if (!text) return;
        const ok = await call("app", "reply", { comment: m.id, platform: m.platform, message: text });
        if (ok?.ok) {
          toast(L("Reply sent", "أُرسل الرد"));
          row.closest(".tcomment").remove();
        }
      }));
    }));
    $("#t-retry", box)?.addEventListener("click", () => call("retryFailed"));
    $("#t-wizard", box)?.addEventListener("click", () => setupWizard());
    $$("[data-step]", box).forEach((b) => (b.onclick = () => this._steps[Number(b.dataset.step)][3]()));
    // Customising.
    if (!TODAY.editing) return;
    const layout = () => TODAY.layout.map((x) => ({ ...x }));
    $("#t-done", box).onclick = () => { TODAY.editing = false; this.draw(); };
    $("#t-reset", box).onclick = async () => { await this.saveLayout(defaultLayout(TODAY.web?.role ?? S.role)); await this.fill(); };
    $$("[data-hide]", box).forEach((b) => (b.onclick = () => { const l = layout(); l.find((x) => x.key === b.dataset.hide).hidden = true; this.saveLayout(l); this.draw(); }));
    $$("[data-show]", box).forEach((b) => (b.onclick = () => {
      const l = layout();
      const i = l.findIndex((x) => x.key === b.dataset.show);
      const [x] = l.splice(i, 1);
      x.hidden = false;
      l.splice(l.filter((y) => !y.hidden).length, 0, x);
      this.saveLayout(l);
      this.draw();
    }));
    $$("[data-size]", box).forEach((b) => (b.onclick = () => { const l = layout(); const x = l.find((y) => y.key === b.dataset.size); x.size = x.size === "wide" ? "normal" : "wide"; this.saveLayout(l); this.draw(); }));
    let dragging = null;
    $$(".tcard.editing", box).forEach((c) => {
      c.ondragstart = (e) => { dragging = c.dataset.key; e.dataTransfer.effectAllowed = "move"; c.classList.add("lift"); };
      c.ondragend = () => c.classList.remove("lift");
      c.ondragover = (e) => { e.preventDefault(); c.classList.add("over"); };
      c.ondragleave = () => c.classList.remove("over");
      c.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        c.classList.remove("over");
        if (!dragging || dragging === c.dataset.key) return;
        const l = layout();
        const from = l.findIndex((x) => x.key === dragging);
        const [x] = l.splice(from, 1);
        l.splice(l.findIndex((y) => y.key === c.dataset.key), 0, x);
        this.saveLayout(l);
        this.draw();
      };
    });
  },
};

// The first-run set-up guide: the Mac's own steps (library folder, class
// lists, first import, first faces) joined with the website's AI set-up
// (Facebook page, school profile, categories, posting times, first two
// weeks). A step done on either side shows done on both.
async function setupWizard(start = 0) {
  const web = S.signedIn ? await quiet("app", "today", {}) : null;
  const done = web?.setup ?? {};
  const c = S.counts ?? {};
  const steps = [
    { key: "welcome", title: L("Welcome", "أهلًا بك"), text: L("A few steps and the app is ready: where the photos are, who the students are, and the school's Facebook and Instagram. You can stop at any step and come back from Today.", "بضع خطوات ويصبح التطبيق جاهزًا: مكان الصور، ومن هم الطلاب، وصفحات المدرسة على فيسبوك وإنستجرام. يمكنك التوقف عند أي خطوة والعودة من «اليوم»."), ok: true },
    { key: "library", title: L("Your photo library", "مكتبة الصور"), text: L("Choose the folder (or drive) where the school's photos are kept. Nothing is moved unless you turn on filing in place later.", "اختر المجلد (أو القرص) الذي تُحفظ فيه صور المدرسة. لا يُنقل شيء إلا إذا فعّلت الترتيب في المكان لاحقًا."), ok: !!S.library, act: [L("Choose folder…", "اختيار مجلد…"), () => call("chooseLibrary")] },
    { key: "signin", title: L("Sign in to your school", "تسجيل الدخول إلى مدرستك"), text: L("Use the account you made on the website. Posts, approvals and the calendar come from there.", "استخدم الحساب الذي أنشأته على الموقع. المنشورات والموافقات والتقويم تأتي من هناك."), ok: !!S.signedIn, act: [L("Open sign in", "فتح تسجيل الدخول"), () => { closeOverlay(); go("settings", { page: "account" }); }] },
    { key: "classLists", title: L("Class lists", "قوائم الفصول"), text: L("Import the students from Excel (PowerSchool, Classera and Edunation files are recognised). Portraits named by student ID help faces learn faster.", "استورد الطلاب من Excel (ملفات PowerSchool وClassera وEdunation معروفة). الصور الشخصية بأسماء أرقام الطلاب تسرّع تعلّم الوجوه."), ok: c.students > 0, act: [L("Import class lists", "استيراد القوائم"), () => { closeOverlay(); go("students", { import: true }); }] },
    { key: "firstImport", title: L("First photos", "أول الصور"), text: L("Import a card or a folder. The app makes previews, finds faces and files them by year, term and event.", "استورد كارتًا أو مجلدًا. ينشئ التطبيق معاينات ويجد الوجوه ويرتبها حسب السنة والفصل والفعالية."), ok: c.photos > 0, act: [L("Import photos", "استيراد صور"), () => { closeOverlay(); go("import"); }] },
    { key: "firstFaces", title: L("Teach it the students", "علّمه الطلاب"), text: L("Name about 10 faces. After that the app suggests names by itself and gets better with every one you confirm.", "سمِّ حوالي 10 وجوه. بعد ذلك يقترح التطبيق الأسماء بنفسه ويتحسن مع كل تأكيد."), ok: c.tagged >= 10, act: [L("Name faces", "تسمية الوجوه"), () => { closeOverlay(); go("faces"); }] },
    { key: "ai", title: L("Facebook, Instagram and the school's voice", "فيسبوك وإنستجرام وأسلوب المدرسة"), text: L("On the website: connect the pages, then the AI reads them and suggests the school profile, post categories, weekly times and the first two weeks of posts.", "على الموقع: اربط الصفحات، ثم يقرؤها الذكاء الاصطناعي ويقترح ملف المدرسة وتصنيفات المنشورات والمواعيد الأسبوعية وأول أسبوعين من المنشورات."), ok: !!(done.accounts && done.brand && done.categories && done.slots), act: [L("Open website set-up", "فتح إعداد الموقع"), () => call("openWeb", "/setup")], needs: !S.signedIn },
  ];
  let i = Math.min(start, steps.length - 1);
  const draw = () => {
    const s = steps[i];
    const m = modal(`<div class="wizard">
      <div class="row nowrap wsteps">${steps.map((x, k) => `<span class="dot ${k === i ? "on" : ""} ${x.ok ? "ok" : ""}" title="${esc(x.title)}"></span>`).join("")}</div>
      <h2>${s.ok && i ? `${icon("circle-check", 18)} ` : ""}${s.title}</h2><p>${s.text}</p>
      ${s.needs ? `<p class="note warn small">${L("Sign in first.", "سجّل الدخول أولًا.")}</p>` : ""}
      <div class="row">${s.act && !s.needs ? `<button class="btn ${s.ok ? "" : "primary"}" id="w-act">${s.act[0]}</button>` : ""}<span class="grow"></span>
        ${i ? `<button class="btn ghost" id="w-back">${L("Back", "رجوع")}</button>` : ""}
        <button class="btn ${s.act && !s.ok ? "" : "primary"}" id="w-next">${i === steps.length - 1 ? L("Finish", "إنهاء") : s.ok || !s.act ? L("Next", "التالي") : L("Skip for now", "تخطَّ الآن")}</button></div></div>`, { sticky: true });
    $("#w-act", m)?.addEventListener("click", async () => {
      await s.act[1]();
      if (!$(".wizard")) return;
      s.ok = s.key === "library" ? !!S.library : s.ok;
      draw();
    });
    $("#w-back", m)?.addEventListener("click", () => { i--; draw(); });
    $("#w-next", m).onclick = () => {
      if (i === steps.length - 1) {
        closeOverlay();
        call("set", "setupDone", true);
        if (App.view === "today") App.views.today.fill();
        return;
      }
      i++;
      draw();
    };
  };
  draw();
}

// First run: the guide opens by itself once.
window.addEventListener("load", () => setTimeout(() => {
  if (S && !S.setupDone && !(S.counts?.photos > 0)) setupWizard();
}, 1200));
