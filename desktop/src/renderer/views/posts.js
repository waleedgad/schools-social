// Posts, built into the app. They use the website's posting rules
// (approvals, privacy checks) through the signed-in person's account, so the
// Mac, the website and phones always see the same posts. What only the Mac
// can do happens here: crops and frames from the originals, faces of people
// who can't appear blurred, collages, and "who's in this post" by name.

const BOARD_COLS = [
  { key: "idea", statuses: ["idea"], en: "Ideas", ar: "أفكار" },
  { key: "draft", statuses: ["draft", "rejected"], en: "Drafts", ar: "مسودات" },
  { key: "waiting", statuses: ["in_review", "waiting_extra"], en: "Waiting for approval", ar: "بانتظار الاعتماد" },
  { key: "scheduled", statuses: ["approved", "scheduled", "publishing"], en: "Approved and scheduled", ar: "معتمد ومجدول" },
  { key: "posted", statuses: ["published", "failed"], en: "Posted", ar: "منشور" },
];
const DROP_TO = { idea: "idea", draft: "draft", waiting: "in_review" };
const STATUS_TAG = { idea: "violet", draft: "", rejected: "bad", in_review: "warn", waiting_extra: "warn", approved: "info", scheduled: "info", publishing: "info", published: "good", failed: "bad" };
const LIMIT = { facebook: 63206, instagram: 2200, tags: 30 };

function statusName(s) {
  return (
    {
      idea: L("Idea", "فكرة"),
      draft: L("Draft", "مسودة"),
      in_review: L("Waiting for approval", "بانتظار الاعتماد"),
      waiting_extra: L("Waiting for the principal", "بانتظار الناظر"),
      approved: L("Approved", "معتمد"),
      scheduled: L("Scheduled", "مجدول"),
      publishing: L("Publishing", "جارٍ النشر"),
      published: L("Published", "منشور"),
      failed: L("Failed", "فشل"),
      rejected: L("Changes asked", "طُلبت تعديلات"),
    }[s] ?? s
  );
}

const fmtWhen = (iso) =>
  iso ? new Date(iso).toLocaleString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const postText = (p) => (S.language === "en" ? p.caption_en || p.caption_ar : p.caption_ar || p.caption_en) || p.idea || "";
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Ready-made prompts for the AI, written for schools.
const PROMPTS = () => [
  ["recap", L("Event recap", "ملخص فعالية"), "Write a recap of this event: what the students did, what they learned and one proud moment."],
  ["achievement", L("Achievement", "إنجاز"), "Celebrate an achievement: who won or did well, what it was, and thank the teachers who helped. Proud, not boastful."],
  ["welcome", L("Welcome back", "عودة للمدرسة"), "A warm welcome back to school for students and parents, with one practical reminder."],
  ["occasion", L("Occasion", "مناسبة"), "A greeting for this occasion from the whole school family. Short, warm and respectful."],
  ["thanks", L("Thank a teacher", "شكر معلم"), "Thank the teacher or staff member behind this activity, by role, and say what it meant to the students."],
  ["learning", L("Learning in class", "التعلم في الفصل"), "Show learning in class: the subject, what the students practised, and why it matters."],
  ["sports", L("Sports result", "نتيجة رياضية"), "Report a sports match or day: the teams, the spirit, the result, and thanks to the coaches."],
  ["trip", L("Trip", "رحلة"), "A school trip: where they went, what they saw and learned, and thanks to the hosts."],
  ["reminder", L("Reminder for parents", "تذكير لأولياء الأمور"), "A clear reminder for parents: what, when, and what to bring or do. Friendly, not bossy."],
  ["admissions", L("Open day / admissions", "يوم مفتوح / القبول"), "Invite families thinking of joining: what makes the school special, with the date and how to book."],
];
const TONES = () => [["", L("Tone: the school's voice", "النبرة: صوت المدرسة")], ["warm", L("Warm", "دافئة")], ["proud", L("Proud", "فخورة")], ["formal", L("Formal", "رسمية")], ["fun", L("Fun", "مرحة")], ["informative", L("Informative", "معلوماتية")]];
const REWRITES = () => [
  ["shorter", L("Shorter", "أقصر"), "make it shorter, about half the length"],
  ["longer", L("Longer", "أطول"), "make it a little longer with one more detail"],
  ["warmer", L("Warmer", "أدفأ"), "make it warmer and more personal for parents"],
  ["formal", L("More formal", "أكثر رسمية"), "make it more formal"],
  ["emoji", L("Add emoji", "إضافة رموز"), "add two or three fitting emoji"],
  ["spelling", L("Fix spelling", "تصحيح الإملاء"), "fix spelling and grammar only, change nothing else"],
];
const SHAPES = () => [["4:5", L("Instagram 4:5", "إنستجرام 4:5")], ["1:1", L("Square", "مربع")], ["9:16", L("Story 9:16", "قصة 9:16")], ["fb", L("Facebook (whole photo)", "فيسبوك (الصورة كاملة)")]];

function needSignIn(main, title) {
  main.innerHTML = topbar(title) + `<div class="content">${emptyState("send", L("Sign in first", "سجّل الدخول أولًا"), L("Posts are shared with your School Social Hub website. Sign in from Settings.", "المنشورات مشتركة مع موقع School Social Hub. سجّل الدخول من الإعدادات."), `<button class="btn primary" id="w-set">${L("Open Settings", "فتح الإعدادات")}</button>`)}</div>`;
  $("#w-set", main).onclick = () => go("settings");
}

async function postMe() {
  return (App.me ??= await quiet("app", "me")) ?? {};
}

// ---------- Board, list and Instagram grid ----------
App.views.posts = {
  render(main, params) {
    if (!S.signedIn) return needSignIn(main, L("Posts", "المنشورات"));
    this.filter = this.filter ?? "all";
    this.layout = params.layout ?? this.layout ?? "board";
    main.innerHTML =
      topbar(L("Posts", "المنشورات"), L("Ideas, drafts, approvals and what's scheduled", "الأفكار والمسودات والاعتمادات والمجدول"),
        `${pills([["board", L("Board", "لوحة"), "layout-grid"], ["list", L("List", "قائمة"), "list"], ["grid", L("Instagram grid", "شبكة إنستجرام"), "grid-3x3"]], this.layout, "data-lay")}
         <button class="btn" id="p-week">${icon("sparkles", 15)} ${L("Make a week of posts", "أنشئ منشورات أسبوع")}</button>
         <button class="btn" id="p-ann">${icon("megaphone", 15)} ${L("Announcement", "إعلان")}</button>
         <button class="btn primary" id="p-new">${icon("plus", 15)} ${L("New post", "منشور جديد")} <span class="k">N</span></button>`) +
      `<div class="content col gap12"><div class="row" id="p-filters"></div><div id="board">${skeletonRows(4)}</div></div>`;
    $("#p-new", main).onclick = () => newPostMenu();
    $("#p-week", main).onclick = () => makeWeekBox();
    $("#p-ann", main).onclick = () => announcementBox();
    bindPills(main, "data-lay", (v) => { this.layout = v; go("posts", { layout: v }); });
    this.load();
    if (params.post) openPost(params.post);
    else if (params.new) newPostMenu(params.day);
  },
  async load() {
    const r = await quiet("app", "board");
    const box = $("#board");
    if (!box) return;
    if (!r || r.error) {
      box.innerHTML = `<div class="note bad">${L("Couldn't load posts. Check the internet.", "تعذّر تحميل المنشورات. تحقق من الإنترنت.")}</div>`;
      return;
    }
    this.data = r;
    App.postCats = r.categories;
    if (this.layout === "grid") {
      const x = await quiet("app", "calendarMore", {});
      this.grid = x?.grid ?? [];
    }
    this.draw();
  },
  shown() {
    const { posts } = this.data;
    return posts.filter((p) => this.filter === "all" || (this.filter === "mine" ? p.mine : this.filter === "assigned" ? p.assignedToMe : p.category_id === this.filter));
  },
  card(p, cat) {
    const c = cat.get(p.category_id);
    return `<div class="bcard" draggable="true" data-id="${p.id}">
      ${p.cover ? `<img src="${esc(p.cover)}" />` : ""}
      <p>${esc(postText(p)) || `<span class="muted">${L("No caption yet", "بلا نص بعد")}</span>`}</p>
      <div class="row small">${c ? `<span class="tag" style="background:${esc(c.color)}22;color:${esc(c.color)}">${esc(c.name)}</span>` : ""}${p.status !== "idea" ? `<span class="tag ${STATUS_TAG[p.status] ?? ""}">${esc(statusName(p.status))}</span>` : ""}${p.urgent ? `<span class="tag bad">${L("Urgent", "عاجل")}</span>` : ""}${p.assignedToMe ? `<span class="tag info">${L("For you", "لك")}</span>` : ""}</div>
      <div class="row small muted"><span class="grow">${p.scheduled_at || p.published_at ? icon("clock", 12) + " " + fmtWhen(p.published_at ?? p.scheduled_at) : p.due_on ? L("Due ", "موعده ") + fmtDate(p.due_on) : ""}</span>${p.photos ? `${icon("images", 12)} ${num(p.photos)}` : ""}</div>
    </div>`;
  },
  draw() {
    const box = $("#board");
    const f = $("#p-filters");
    if (!box || !this.data) return;
    const { categories } = this.data;
    f.innerHTML = pills(
      [["all", L("All", "الكل")], ["mine", L("Mine", "منشوراتي")], ["assigned", L("Given to me", "مسندة إليّ")], ...categories.map((c) => [c.id, c.name])],
      this.filter,
      "data-f",
    );
    bindPills(f, "data-f", (v) => { this.filter = v; this.draw(); });
    const cat = new Map(categories.map((c) => [c.id, c]));
    const shown = this.shown();
    if (this.layout === "list") {
      const rows = [...shown].sort((a, b) => (b.scheduled_at ?? b.published_at ?? b.updated_at).localeCompare(a.scheduled_at ?? a.published_at ?? a.updated_at));
      box.className = "";
      box.innerHTML = rows.length
        ? `<div class="plist">${rows.map((p) => {
            const c = cat.get(p.category_id);
            return `<div class="prow" data-id="${p.id}">${p.cover ? `<img src="${esc(p.cover)}" />` : `<span class="noimg">${icon("type", 16)}</span>`}<span class="grow">${esc(postText(p)) || `<span class="muted">${L("No caption yet", "بلا نص بعد")}</span>`}</span>
              ${c ? `<span class="tag" style="background:${esc(c.color)}22;color:${esc(c.color)}">${esc(c.name)}</span>` : ""}<span class="tag ${STATUS_TAG[p.status] ?? ""}">${esc(statusName(p.status))}</span><span class="muted small" style="min-width: 130px">${esc(fmtWhen(p.published_at ?? p.scheduled_at)) || (p.due_on ? fmtDate(p.due_on) : "")}</span></div>`;
          }).join("")}</div>`
        : emptyState("send", L("No posts here", "لا منشورات هنا"));
    } else if (this.layout === "grid") {
      box.className = "";
      const g = this.grid ?? [];
      box.innerHTML = `<div class="row" style="align-items: flex-start; gap: 24px"><div class="iggrid">${g.map((p) => `<div class="igcell ${p.status !== "published" ? "next" : ""}" data-id="${p.id}">${p.cover ? `<img src="${esc(p.cover)}" />` : ""}${p.status !== "published" ? `<span>${esc(fmtWhen(p.at))}</span>` : ""}</div>`).join("") || `<p class="muted">${L("Nothing on Instagram yet.", "لا شيء على إنستجرام بعد.")}</p>`}</div>
        <div class="card" style="max-width: 320px"><b>${L("How the profile will look", "كيف سيبدو الحساب")}</b><p class="muted small">${L("Faded squares are approved or scheduled posts, newest first. Look for two similar photos side by side, or too many of one colour.", "المربعات الباهتة منشورات معتمدة أو مجدولة، الأحدث أولاً. انتبه لصورتين متشابهتين متجاورتين أو لكثرة لون واحد.")}</p></div></div>`;
    } else {
      box.className = "board";
      box.innerHTML = BOARD_COLS.map((col) => {
        const cards = shown.filter((p) => col.statuses.includes(p.status));
        return `<section class="bcol" data-col="${col.key}"><header><span>${L(col.en, col.ar)}</span><span class="n">${num(cards.length)}</span></header>
          ${cards.map((p) => this.card(p, cat)).join("") || `<p class="muted small center">${L("Nothing here", "لا شيء هنا")}</p>`}</section>`;
      }).join("");
    }
    $$("[data-id]", box).forEach((el) => {
      el.onclick = () => openPost(el.dataset.id);
      el.ondragstart = (e) => e.dataTransfer.setData("text/post", el.dataset.id);
    });
    onContext(box, "[data-id]", (el) => postMenu(el.dataset.id, () => this.load()));
    $$(".bcol", box).forEach((col) => {
      const to = DROP_TO[col.dataset.col];
      if (!to) return;
      col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
      col.ondragleave = () => col.classList.remove("over");
      col.ondrop = async (e) => {
        col.classList.remove("over");
        const id = e.dataTransfer.getData("text/post");
        if (!id) return;
        const r = await quiet("app", "move", { id, status: to });
        toast(r?.ok ? L("Moved", "تم النقل") : L("Approval and scheduling happen inside the post.", "الاعتماد والجدولة من داخل المنشور."));
        this.load();
      };
    });
  },
  onKey(e) {
    if (e.key === "n") newPostMenu();
  },
};

// Right-click on a post anywhere (board, list, calendar).
function postMenu(id, after) {
  const p = [...(App.views.posts.data?.posts ?? []), ...(App.views.calendar?.posts ?? [])].find((x) => x.id === id);
  const locked = p && ["publishing", "published"].includes(p.status);
  return [
    { label: L("Open", "فتح"), run: () => openPost(id) },
    { label: L("Duplicate", "نسخ"), run: async () => { const r = await quiet("app", "intent", { id, intent: "duplicate" }); if (r?.id) openPost(r.id); } },
    { label: L("Reschedule…", "إعادة الجدولة…"), enabled: !locked, run: () => rescheduleBox(id, after) },
    { label: L("Add to the next free slot", "أضف إلى أقرب موعد متاح"), enabled: !locked, run: async () => { const r = await quiet("app", "intent", { id, intent: "queue" }); toast(r?.ok ? L("Added to the next free slot", "أُضيف إلى أقرب موعد") : r?.message ?? L("Approve it first", "اعتمده أولاً")); after?.(); } },
    { label: L("Open on the website", "افتح على الموقع"), run: () => call("openWeb", `/posts/${id}`) },
    "-",
    { label: L("Share as a story", "شاركه كقصة"), run: async () => { const r = await quiet("app", "reuse", { id, kind: "story" }); toast(r?.ok ? (r.story === "sent" ? L("Shared as an Instagram story", "تمت مشاركته كقصة على إنستجرام") : L("A story will go out with this post", "ستُنشر قصة مع هذا المنشور")) : r?.error === "instagram" ? L("Connect Instagram first", "اربط إنستجرام أولاً") : L("Couldn't share it as a story", "تعذرت مشاركته كقصة")); after?.(); } },
    { label: L("Make a week recap", "اصنع ملخص الأسبوع"), run: async () => { const r = await quiet("app", "reuse", { id, kind: "recap" }); if (r?.id) openPost(r.id); else toast(L("Couldn't make the recap", "تعذر صنع الملخص")); } },
    { label: L("Use in the yearbook", "استخدمه في الكتاب السنوي"), run: async () => { const d = await quiet("app", "post", { id }); const r = await call("yearbookPick", (d?.photos ?? []).map((p) => p.id)); toast(r?.added ? L(`${r.added} photos added to Yearbook picks; yearbook drafts use them first`, `أُضيفت ${num(r.added)} صورة إلى اختيارات الكتاب السنوي؛ تستخدمها مسودات الكتب أولاً`) : L("None of this post's photos are in this Mac's library", "لا توجد صور هذا المنشور في مكتبة هذا الجهاز")); } },
    "-",
    { label: L("Delete", "حذف"), enabled: !locked, run: async () => { if (!(await confirmBox(L("Delete this post?", "حذف هذا المنشور؟"), L("Delete", "حذف")))) return; await quiet("app", "intent", { id, intent: "delete" }); toast(L("Deleted", "حُذف")); after?.(); } },
  ];
}

function rescheduleBox(id, after) {
  const m = modal(`<h2>${L("Reschedule", "إعادة الجدولة")}</h2><label class="field">${L("New day", "اليوم الجديد")}<input type="date" id="rs-d" value="${isoDay(new Date())}" /></label>
    <div class="row"><span class="grow"></span><button class="btn" id="rs-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="rs-ok">${L("Move", "نقل")}</button></div>`);
  $("#rs-no", m).onclick = closeOverlay;
  $("#rs-ok", m).onclick = async () => {
    await quiet("app", "move", { id, day: $("#rs-d", m).value });
    closeOverlay();
    toast(L("Moved", "تم النقل"));
    after?.();
  };
}

function newIdea(day) {
  const m = modal(`<h2>${L("New idea", "فكرة جديدة")}</h2>
    <textarea id="i-text" rows="3" placeholder="${L("What could we post? For example: Science fair winners", "ماذا يمكن أن ننشر؟ مثلاً: الفائزون في معرض العلوم")}"></textarea>
    <label class="field">${L("For which day? (optional)", "لأي يوم؟ (اختياري)")}<input type="date" id="i-day" value="${esc(day ?? "")}" /></label>
    <div class="row"><div class="grow"></div><button class="btn" id="i-cancel">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="i-save">${L("Save idea", "احفظ الفكرة")}</button></div>`);
  $("#i-cancel", m).onclick = closeOverlay;
  $("#i-save", m).onclick = async () => {
    const idea = $("#i-text", m).value.trim();
    if (!idea) return;
    await call("app", "create", { kind: "idea", idea, day: $("#i-day", m).value });
    closeOverlay();
    toast(L("Idea saved", "حُفظت الفكرة"));
    App.views[App.view]?.load?.();
  };
}

function newPostMenu(day) {
  const opt = (id, ic, title, text) => `<button class="trow big" id="${id}">${icon(ic, 18)}<span class="grow col"><b>${title}</b><span class="muted small">${text}</span></span>${icon("chevron-right", 14)}</button>`;
  const m = modal(`<h2>${L("New post", "منشور جديد")}${day ? ` <span class="muted small">${esc(fmtDate(day))}</span>` : ""}</h2>
    <div class="col gap4">
      ${opt("n-event", "calendar-days", L("From an event or class", "من فعالية أو فصل"), L("The app picks the best photos (4 to 10)", "يختار التطبيق أفضل الصور (4 إلى 10)"))}
      ${opt("n-picks", "star", L("From my picks", "من الصور المختارة"), L("Photos you marked as picks in the library", "صور اخترتها في المكتبة"))}
      ${opt("n-ann", "megaphone", L("Announcement", "إعلان"), L("A designed picture with text, from the school's templates", "صورة مصممة بنص من قوالب المدرسة"))}
      ${opt("n-text", "type", L("Text only", "نص فقط"), L("Facebook only, no photo", "فيسبوك فقط، بلا صورة"))}
      ${opt("n-idea", "lightbulb", L("Just an idea for later", "مجرد فكرة لوقت لاحق"), L("A card on the board to write later", "بطاقة على اللوحة تُكتب لاحقاً"))}
      ${opt("n-week", "sparkles", L("Make a week of posts", "أنشئ منشورات أسبوع"), L("The app plans the next days from your events and free slots", "يخطط التطبيق للأيام القادمة من فعالياتك ومواعيدك"))}
    </div>`);
  $("#n-picks", m).onclick = () => makePostsFrom({ flag: 1 }, L("My picks", "المختارة"), { day });
  $("#n-event", m).onclick = () => eventPicker(day);
  $("#n-ann", m).onclick = () => announcementBox({ day });
  $("#n-idea", m).onclick = () => newIdea(day);
  $("#n-week", m).onclick = () => makeWeekBox();
  $("#n-text", m).onclick = async () => {
    const r = await call("app", "create", { day });
    closeOverlay();
    openPost(r.id);
  };
}

// Pick an event (or a class of it); then the usual "make posts" box.
async function eventPicker(day) {
  const { rows } = await call("tree");
  const events = rows.filter((r) => r.event_key).slice(0, 80);
  const m = modal(`<h2>${icon("calendar-days", 18)} ${L("From an event", "من فعالية")}</h2>
    <input type="search" id="ep-q" placeholder="${L("Search events…", "ابحث في الفعاليات…")}" />
    ${events.length ? `<div class="col gap4" id="ep-list" style="max-height: 380px; overflow-y: auto">${events.map((e, i) => `<button class="trow" data-i="${i}" data-q="${esc(`${e.event_title ?? ""} ${e.event_key}`.toLowerCase())}"><span class="grow">${esc(eventName(e.event_title || e.event_key, e.event_date))}</span><span class="muted small">${num(e.n)}</span></button>`).join("")}</div>` : `<p class="muted">${L("No events in the library yet.", "لا توجد فعاليات في المكتبة بعد.")}</p>`}`);
  $("#ep-q", m).oninput = (e) => $$("[data-q]", m).forEach((b) => (b.style.display = b.dataset.q.includes(e.target.value.toLowerCase()) ? "" : "none"));
  $$("[data-i]", m).forEach((b) => (b.onclick = () => { const e = events[Number(b.dataset.i)]; makePostsFrom({ event: e.event_key }, e.event_title || e.event_key, { day }); }));
}

// Make posts from any set of photos: the library's filter, an event, an
// import, a student, a coverage gap, a yearbook page. One post with the best
// photos, one post per class or one per day; the AI can write the captions.
async function makePostsFrom(filter, title = "", opts = {}) {
  if (!S.signedIn) return toast(L("Sign in from Settings to make posts.", "سجّل الدخول من الإعدادات لإنشاء منشورات."));
  const m = modal(`<h2>${icon("send", 18)} ${L("Make posts", "إنشاء منشورات")}${title ? `: ${esc(title)}` : ""}</h2>${skeletonRows(3)}`, { wide: true });
  const c = await quiet("postCandidates", filter, 8);
  if (!c?.total) {
    m.innerHTML = `<h2>${L("Make posts", "إنشاء منشورات")}</h2>${emptyState("image-off", L("No usable photos here", "لا صور صالحة هنا"), L("Rejected photos are left out.", "الصور المرفوضة مستبعدة."))}<div class="row"><span class="grow"></span><button class="btn" onclick="closeOverlay()">${L("Close", "إغلاق")}</button></div>`;
    return;
  }
  const cats = App.postCats ?? (await quiet("app", "board"))?.categories ?? [];
  App.postCats = cats;
  let mode = opts.single ? "single" : "one";
  let count = 8;
  const draw = async () => {
    const best = mode === "single" ? c.ids.slice(0, 80) : await quiet("best", c.ids, count);
    const groups = mode === "class" ? c.classes.length : mode === "day" ? c.days.length : 1;
    m.innerHTML = `<h2>${icon("send", 18)} ${L("Make posts", "إنشاء منشورات")}${title ? `: ${esc(title)}` : ""}</h2>
      <p class="muted small">${L(`${num(c.total)} photos`, `${num(c.total)} صورة`)}${c.posted ? ` · ${L(`${num(c.posted)} already posted`, `${num(c.posted)} نُشرت من قبل`)}` : ""}${c.noPost ? ` · <span style="color: var(--warn)">${L(`${num(c.noPost)} with someone who can't appear (blurred on the website)`, `${num(c.noPost)} فيها من لا يظهر (مموّه على الموقع)`)}</span>` : ""}</p>
      ${opts.single ? "" : `<div class="row">${pills([["one", L("One post", "منشور واحد")], ...(c.classes.length > 1 ? [["class", L(`One per class (${c.classes.length})`, `منشور لكل فصل (${num(c.classes.length)})`)]] : []), ...(c.days.length > 1 ? [["day", L(`One per day (${c.days.length})`, `منشور لكل يوم (${num(c.days.length)})`)]] : []), ["single", L("Use all I chose", "كل ما اخترته")]], mode, "data-mode")}
        ${mode !== "single" ? `<span class="grow"></span><span class="muted small">${L("Photos per post", "صور لكل منشور")}</span>${pills([4, 6, 8, 10].map((n) => [n, num(n)]), count, "data-n")}` : ""}</div>`}
      <div class="mkstrip">${(best ?? []).slice(0, 12).map((id) => `<img src="hub://thumb/${id}" />`).join("")}${(best ?? []).length > 12 ? `<span class="muted">+${num(best.length - 12)}</span>` : ""}</div>
      ${groups > 1 ? `<p class="muted small">${L(`${groups} posts will be made, each with its best photos.`, `سيُنشأ ${num(groups)} منشور، لكل منها أفضل صوره.`)}</p>` : ""}
      <label class="field">${L("What happened? (the AI uses this, the website keeps it as a note)", "ماذا حدث؟ (يستخدمه الذكاء الاصطناعي ويُحفظ كملاحظة)")}<textarea id="mk-notes" rows="2" placeholder="${L("For example: Grade 4 visited the science museum and built their own circuits", "مثلاً: زار الصف الرابع متحف العلوم وصنعوا دوائر كهربائية")}">${esc(opts.notes ?? "")}</textarea></label>
      <div class="grid2">
        <label class="field">${L("Category", "التصنيف")}<select id="mk-cat"><option value="">${L("No category", "بدون تصنيف")}</option>${cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label>
        <label class="field">${L("Day (optional)", "اليوم (اختياري)")}<input type="date" id="mk-day" value="${esc(opts.day ?? "")}" /></label>
      </div>
      <div class="srow"><span class="grow">${L("Let the AI write the captions now", "دع الذكاء الاصطناعي يكتب النصوص الآن")}<span class="muted small block">${L("Only small web copies of up to 4 photos are read. Faces and names never leave the Mac.", "تُقرأ نسخ ويب صغيرة لأربع صور فقط. الوجوه والأسماء لا تغادر الماك.")}</span></span>${sw('id="mk-ai"', S.postAiWrite !== false)}</div>
      <div class="row"><span class="grow"></span><button class="btn" id="mk-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="mk-go">${groups > 1 ? L(`Make ${groups} posts`, `أنشئ ${num(groups)} منشور`) : L("Make the post", "أنشئ المنشور")}</button></div>`;
    bindPills(m, "data-mode", (v) => { mode = v; draw(); });
    bindPills(m, "data-n", (v) => { count = Number(v); draw(); });
    $("#mk-no", m).onclick = closeOverlay;
    $("#mk-go", m).onclick = async () => {
      const o = { mode, count, notes: $("#mk-notes", m).value.trim(), write: $("#mk-ai", m).checked, day: $("#mk-day", m).value || null, category: $("#mk-cat", m).value || null };
      S.postAiWrite = o.write;
      m.innerHTML = `<h2>${L("Making the posts…", "جارٍ إنشاء المنشورات…")}</h2><p class="muted">${L("Sending web copies of the photos first, even while sending is paused. Originals stay on this Mac.", "تُرسل نسخ ويب من الصور أولاً حتى لو كان الإرسال متوقفاً. وتبقى الأصول على هذا الماك.")}</p>${skeletonRows(2)}<div class="row"><span class="grow"></span><button class="btn" id="mk-stop">${L("Cancel", "إلغاء")}</button></div>`;
      $("#mk-stop", m).onclick = () => { call("cancelPost"); closeOverlay(); };
      try {
        const made = await call("makePosts", mode === "single" ? { ids: c.ids } : filter, o);
        closeOverlay();
        if (made.length === 1) openPost(made[0].id);
        else {
          toast(L(`${made.length} posts made`, `أُنشئ ${num(made.length)} منشور`));
          go("posts");
        }
      } catch {
        closeOverlay();
      }
    };
  };
  draw();
}

// ---------- Make a week of posts ----------
// The AI's plan for the next days, matched to free posting times; each line
// can bring the best photos of an event from the library.
async function makeWeekBox() {
  const m = modal(`<h2>${icon("sparkles", 18)} ${L("Make a week of posts", "أنشئ منشورات أسبوع")}</h2>${skeletonRows(4)}`, { wide: true });
  const [plan, tree, cal, more] = await Promise.all([quiet("app", "planWeek", { days: 7 }), quiet("tree"), quiet("app", "calendar", { from: isoDay(new Date()), to: isoDay(new Date(Date.now() + 7 * 864e5)) }), quiet("app", "calendarMore", {})]);
  // No posts on no-posting days or holidays: move those to the next open day.
  const off = (k) => (more?.noPostDays?.weekdays ?? []).includes(new Date(`${k}T12:00:00`).getDay()) || (more?.noPostDays?.holidays !== false && (more?.holidays ?? []).some((hd) => hd.start && hd.start <= k && (hd.end || hd.start) >= k));
  for (const p of plan?.plan ?? []) for (let i = 0; i < 14 && off(p.date); i++) p.date = isoDay(new Date(Date.parse(`${p.date}T12:00:00`) + 864e5));
  if (!plan?.plan) {
    m.innerHTML = `<h2>${L("Make a week of posts", "أنشئ منشورات أسبوع")}</h2><div class="note bad">${L("The AI couldn't plan just now. Try again in a minute.", "تعذّر التخطيط الآن. حاول بعد دقيقة.")}</div>`;
    return;
  }
  const events = (tree?.rows ?? []).filter((r) => r.event_key).slice(0, 40);
  const slots = cal?.slots ?? [];
  const lines = plan.plan.map((p) => {
    const wd = new Date(`${p.date}T12:00:00`).getDay();
    const slot = slots.find((s) => s.weekday === wd);
    const ev = events.find((e) => (e.event_title ?? "").toLowerCase() && p.title.toLowerCase().includes((e.event_title ?? "").toLowerCase()));
    return { ...p, time: slot?.at_time?.slice(0, 5) ?? "18:00", event: ev?.event_key ?? "", on: true };
  });
  const draw = () => {
    m.innerHTML = `<h2>${icon("sparkles", 18)} ${L("Make a week of posts", "أنشئ منشورات أسبوع")}</h2>
      <p class="muted small">${L("Untick what you don't want. Lines with an event get its best photos; the others become ideas to fill in.", "ألغِ ما لا تريده. السطور المرتبطة بفعالية تأخذ أفضل صورها، والباقي يصبح أفكاراً.")}</p>
      <div class="col gap4">${lines.map((p, i) => `<div class="wkrow"><input type="checkbox" data-on="${i}" ${p.on ? "checked" : ""} />
        <span class="muted small" style="width: 92px">${esc(fmtDate(p.date))} ${esc(p.time)}</span>
        <span class="grow col"><b>${esc(p.title)}</b><span class="muted small">${esc(p.idea)}</span></span>
        <select data-ev="${i}" style="max-width: 200px"><option value="">${L("No photos (idea)", "بلا صور (فكرة)")}</option>${events.map((e) => `<option value="${esc(e.event_key)}" ${e.event_key === p.event ? "selected" : ""}>${esc(eventName(e.event_title || e.event_key, e.event_date))}</option>`).join("")}</select></div>`).join("")}</div>
      <div class="row"><span class="grow"></span><button class="btn" id="wk-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="wk-go">${L("Make them", "أنشئها")}</button></div>`;
    $$("[data-on]", m).forEach((x) => (x.onchange = () => (lines[x.dataset.on].on = x.checked)));
    $$("[data-ev]", m).forEach((x) => (x.onchange = () => (lines[x.dataset.ev].event = x.value)));
    $("#wk-no", m).onclick = closeOverlay;
    $("#wk-go", m).onclick = async () => {
      const chosen = lines.filter((l) => l.on);
      m.innerHTML = `<h2>${L("Making the week…", "جارٍ إنشاء الأسبوع…")}</h2>${skeletonRows(3)}`;
      let n = 0;
      const ideas = [];
      for (const l of chosen) {
        if (l.event) {
          await call("makePosts", { event: l.event }, { mode: "one", count: 6, notes: `${l.title}. ${l.idea}`, write: true, day: l.date, category: l.category_id }).catch(() => null);
          n++;
        } else ideas.push({ kind: "idea", idea: `${l.title}\n${l.idea}`, day: l.date, category_id: l.category_id });
      }
      if (ideas.length) await quiet("app", "createMany", { posts: ideas, why: "week" });
      closeOverlay();
      toast(L(`${n} posts and ${ideas.length} ideas made`, `أُنشئ ${num(n)} منشور و${num(ideas.length)} فكرة`));
      go("calendar", { view: "week" });
    };
  };
  draw();
}

// ---------- Announcements ----------
// The school's template pack and its own designs, drawn here with the same
// code as the website, then turned into a draft post.
async function announcementBox(opts = {}) {
  if (!S.signedIn) return toast(L("Sign in from Settings first.", "سجّل الدخول من الإعدادات أولاً."));
  const m = modal(`<h2>${icon("megaphone", 18)} ${L("Announcement", "إعلان")}</h2>${skeletonRows(3)}`, { wide: true });
  const [designs, board] = await Promise.all([quiet("announceDesigns"), App.postCats ? null : quiet("app", "board")]);
  const cats = App.postCats ?? board?.categories ?? [];
  const occ = opts.occasion ? (OCC_NAMES?.()[opts.occasion] ?? opts.occasion) : opts.title ?? "";
  const st = { template: "clean", size: "post", ar: occ && S.language !== "en" ? occ : "", en: occ && S.language === "en" ? occ : "", details: "", accent: getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#3b6cf6", ink: "#ffffff" };
  const images = new Map();
  for (const d of designs ?? []) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = d.url;
    images.set(d.path, img);
  }
  const paint = async () => {
    const cv = $("#an-cv", m);
    if (!cv) return;
    await document.fonts.ready;
    await Promise.all([...images.values()].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    await drawAnnouncement(cv, st.template, st.size, { ar: st.ar, en: st.en, details: st.details, school: S.schoolName ?? "", accent: st.accent, ink: st.ink }, designs ?? [], images);
  };
  m.innerHTML = `<h2>${icon("megaphone", 18)} ${L("Announcement", "إعلان")}</h2>
    <div class="ed"><div class="col gap12">
      <b class="small">${L("School templates", "قوالب المدرسة")}</b>
      ${pills(PACK.map((p) => [p, { clean: L("Clean", "بسيط"), bold: L("Bold", "عريض"), split: L("Split", "مقسوم"), notice: L("Notice", "تنبيه"), event: L("Event", "فعالية"), holiday: L("Holiday", "عطلة") }[p]]), st.template, "data-tpl")}
      <b class="small">${L("Our own designs", "تصاميمنا")}</b>
      <div class="row">${(designs ?? []).map((d) => `<button class="dsn ${st.template === `design:${d.path}` ? "on" : ""}" data-dsn="${esc(d.path)}"><img src="${esc(d.url)}" /></button>`).join("")}<button class="btn small" id="an-add">${icon("upload", 14)} ${L("Add a design…", "إضافة تصميم…")}</button></div>
      ${pills([["post", L("Post 4:5", "منشور 4:5")], ["square", L("Square", "مربع")], ["story", L("Story", "قصة")]], st.size, "data-size")}
      <label class="field">${L("Arabic title", "العنوان بالعربية")}<input id="an-ar" dir="rtl" value="${esc(st.ar)}" /></label>
      <label class="field">${L("English title", "العنوان بالإنجليزية")}<input id="an-en" dir="ltr" value="${esc(st.en)}" /></label>
      <label class="field">${L("Details (date, time, place)", "التفاصيل (التاريخ والوقت والمكان)")}<textarea id="an-det" rows="2"></textarea></label>
      <div class="grid2"><label class="field">${L("Colour", "اللون")}<input type="color" id="an-ac" value="${esc(st.accent.startsWith("#") ? st.accent : "#3b6cf6")}" /></label>
        <label class="field">${L("Category", "التصنيف")}<select id="an-cat"><option value="">${L("No category", "بدون تصنيف")}</option>${cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></label></div>
      <label class="field">${L("Day (optional)", "اليوم (اختياري)")}<input type="date" id="an-day" value="${esc(opts.day ?? "")}" /></label>
    </div><div class="col gap12"><canvas id="an-cv" class="ancv"></canvas>
      <div class="row"><span class="grow"></span><button class="btn" id="an-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="an-go">${L("Make the post", "أنشئ المنشور")}</button></div></div></div>`;
  bindPills(m, "data-tpl", (v) => { st.template = v; $$("[data-tpl]", m).forEach((b) => b.classList.toggle("on", b.dataset.tpl === v)); $$(".dsn", m).forEach((b) => b.classList.remove("on")); paint(); });
  bindPills(m, "data-size", (v) => { st.size = v; $$("[data-size]", m).forEach((b) => b.classList.toggle("on", b.dataset.size === v)); paint(); });
  $$("[data-dsn]", m).forEach((b) => (b.onclick = () => { st.template = `design:${b.dataset.dsn}`; $$(".dsn", m).forEach((x) => x.classList.toggle("on", x === b)); $$("[data-tpl]", m).forEach((x) => x.classList.remove("on")); paint(); }));
  const bind = (sel, key) => ($(sel, m).oninput = (e) => { st[key] = e.target.value; paint(); });
  bind("#an-ar", "ar");
  bind("#an-en", "en");
  bind("#an-det", "details");
  bind("#an-ac", "accent");
  $("#an-add", m).onclick = async () => { if (await call("addDesign")) announcementBox(opts); };
  $("#an-no", m).onclick = closeOverlay;
  $("#an-go", m).onclick = async () => {
    if (!st.ar.trim() && !st.en.trim()) return toast(L("Write a title first.", "اكتب عنواناً أولاً."));
    const jpeg = $("#an-cv", m).toDataURL("image/jpeg", 0.9);
    const id = await call("saveAnnouncement", jpeg, { ar: [st.ar, st.details].filter(Boolean).join("\n"), en: [st.en, st.details].filter(Boolean).join("\n"), category: $("#an-cat", m).value || null, day: $("#an-day", m).value || null });
    closeOverlay();
    if (id) openPost(id);
  };
  paint();
}

// ---------- The post editor ----------
// Four steps on the left (Photos, Words, Details, Team), the live preview,
// the pre-send checklist and the next step on the right.
async function openPost(id, startStep) {
  const back = h(`<div class="modalback"><div class="modal wide editor">${skeletonRows(6)}</div></div>`);
  $("#overlay").replaceChildren(back);
  const box = back.querySelector(".modal");
  const me = await postMe();
  let d = await quiet("app", "post", { id });
  let x = await quiet("app", "postMore", { id });
  if (!d || d.error || !x || x.error) {
    box.innerHTML = `<div class="note bad">${L("Couldn't open the post.", "تعذّر فتح المنشور.")}</div><button class="btn" onclick="closeOverlay()">${L("Close", "إغلاق")}</button>`;
    return;
  }
  let who = await quiet("postPeople", d.photos.map((p) => p.id));
  let dirty = false;
  let step = startStep ?? (d.post.status === "idea" ? "words" : "photos");
  let view = "facebook";
  let shape = S.postShape ?? "4:5";
  let frameId = x.extra.frame_id ?? x.categories.find((c) => c.id === d.post.category_id)?.frame_id ?? "";
  let order = d.photos.map((p) => p.id);
  let check = null;
  const undo = { ar: [], en: [], ig: [] };
  const role = me.role;
  const writer = ["admin", "comms_lead", "comms"].includes(role);
  const canApprove = () => {
    const s = d.post.status;
    if (s === "waiting_extra") return ["admin", "principal"].includes(role);
    return ["admin", "comms_lead"].includes(role) && ["draft", "in_review", "rejected"].includes(s);
  };
  App.overlayKeys = (e, typing) => {
    if (e.key === "Escape") closeEditor();
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); act("save"); }
    if (!typing && e.key === "a" && canApprove()) act("approve");
    if (!typing && ["1", "2", "3", "4"].includes(e.key)) { step = ["photos", "words", "details", "team"][Number(e.key) - 1]; draw(); }
  };
  function closeEditor() {
    if (dirty && !confirm(L("Leave without saving?", "الخروج بدون حفظ؟"))) return;
    closeOverlay();
    App.views[App.view]?.load?.();
  }
  const cat = () => x.categories.find((c) => c.id === ($("#e-cat", box)?.value ?? d.post.category_id));
  const langMode = () => cat()?.language_mode ?? (x.languages === "ar" ? "ar" : x.languages === "en" ? "en" : "both");
  const photo = (rid) => x.photos.find((p) => p.id === rid);

  // The fields on screen, kept between steps.
  const v = {
    caption_ar: d.post.caption_ar ?? "", caption_en: d.post.caption_en ?? "", caption_ig: x.extra.caption_ig ?? "", hashtags: d.post.hashtags ?? "", first_comment: d.post.first_comment ?? "",
    category_id: d.post.category_id, platforms: [...d.post.platforms], sensitive: d.post.sensitive, make_story: d.post.make_story, urgent: d.post.urgent,
    scheduled_at: d.post.scheduled_at, location: x.extra.location ?? "", alt_ar: x.extra.alt_text?.ar ?? "", alt_en: x.extra.alt_text?.en ?? "",
    collaborators: x.extra.collaborators ?? [], assigned_to: x.extra.assigned_to ?? "", due_on: x.extra.due_on ?? "", countdown_to: x.extra.countdown_to ?? "", splitIg: !!x.extra.caption_ig,
  };
  const read = () => {
    const get = (sel) => $(sel, box);
    if (get("#e-ar")) v.caption_ar = get("#e-ar").value;
    if (get("#e-en")) v.caption_en = get("#e-en").value;
    if (get("#e-ig")) v.caption_ig = get("#e-ig").value;
    if (get("#e-tags")) v.hashtags = get("#e-tags").value;
    if (get("#e-first")) v.first_comment = get("#e-first").value;
    if (get("#e-cat")) v.category_id = get("#e-cat").value || null;
    if (get("[data-plat]")) v.platforms = $$("[data-plat]", box).filter((el) => el.checked).map((el) => el.dataset.plat);
    if (get("#e-sens")) v.sensitive = get("#e-sens").checked;
    if (get("#e-story")) v.make_story = get("#e-story").checked;
    if (get("#e-urgent")) v.urgent = get("#e-urgent").checked;
    if (get("#e-when")) v.scheduled_at = get("#e-when").value ? new Date(get("#e-when").value).toISOString() : null;
    if (get("#e-loc")) v.location = get("#e-loc").value;
    if (get("#e-alt-ar")) v.alt_ar = get("#e-alt-ar").value;
    if (get("#e-alt-en")) v.alt_en = get("#e-alt-en").value;
    if (get("#e-assign")) v.assigned_to = get("#e-assign").value;
    if (get("#e-due")) v.due_on = get("#e-due").value;
    if (get("#e-count")) v.countdown_to = get("#e-count").value;
    if (get("#e-split")) v.splitIg = get("#e-split").checked;
    if (get("#e-collab")) v.collaborators = get("#e-collab").value.split(/[,\s]+/).map((t) => t.trim().replace(/^@?/, "@")).filter((t) => t.length > 1).slice(0, 3);
  };
  const values = () => {
    read();
    return { caption_ar: v.caption_ar, caption_en: v.caption_en, caption_ig: v.splitIg ? v.caption_ig : "", hashtags: v.hashtags, first_comment: v.first_comment, category_id: v.category_id, platforms: v.platforms, sensitive: v.sensitive, make_story: v.make_story, urgent: v.urgent, scheduled_at: v.scheduled_at, location: v.location, idea: d.post.idea };
  };
  async function saveDetails() {
    read();
    await quiet("app", "setPost", { id, values: { frame_id: frameId || null, assigned_to: v.assigned_to || null, due_on: v.due_on || null, countdown_to: v.countdown_to || null, collaborators: v.collaborators, alt_text: { ar: v.alt_ar, en: v.alt_en } } });
  }
  async function reload() {
    [d, x] = await Promise.all([quiet("app", "post", { id }), quiet("app", "postMore", { id })]);
    order = d.photos.map((p) => p.id);
    who = await quiet("postPeople", order);
  }

  async function act(intent, extra = {}) {
    if (writer) await saveDetails();
    const r = await quiet("app", "intent", { id, intent, values: writer ? values() : {}, order: writer ? order : null, ...extra });
    if (!r || r.error) return toast(r?.message ?? L("Couldn't do that. Try again.", "تعذّر ذلك. حاول مرة أخرى."));
    dirty = false;
    toast({ save: L("Saved", "تم الحفظ"), submit: L("Sent for approval", "أُرسل للاعتماد"), approve: L("Approved", "تم الاعتماد"), schedule: L("Scheduled", "تمت الجدولة"), queue: L("Added to the next free slot", "أُضيف إلى أقرب موعد"), publish: L("Publishing now", "جارٍ النشر"), reject: L("Sent back", "أُعيد"), delete: L("Deleted", "حُذف"), draft: L("Back to draft", "عاد مسودة") }[intent] ?? L("Done", "تم"));
    if (intent === "delete") {
      closeOverlay();
      return App.views[App.view]?.load?.();
    }
    if (intent === "duplicate" && r.id) return openPost(r.id);
    await reload();
    draw();
  }

  // ---- The pre-send checklist ----
  function checklist() {
    read();
    const items = [];
    const add = (ok, text, fix) => items.push({ ok, text, fix });
    const ig = v.platforms.includes("instagram");
    const bad = order.filter((rid) => {
      const p = photo(rid);
      const crop = p?.edit_settings?.crop;
      if (crop && ["4:5", "1:1", "9:16"].includes(crop)) return false;
      const r = p?.width && p?.height ? p.width / p.height : 1;
      return r < 0.8 || r > 1.91;
    });
    if (ig && order.length) add(!bad.length, bad.length ? L(`${bad.length} photos have the wrong shape for Instagram`, `${num(bad.length)} صور بشكل غير مناسب لإنستجرام`) : L("Photo shapes fit Instagram", "أشكال الصور مناسبة لإنستجرام"), bad.length ? "shape" : null);
    const mode = langMode();
    const ar = v.caption_ar.trim(), en = v.caption_en.trim();
    if (mode === "both") add(!!ar && !!en, ar && en ? L("Both languages written", "النص باللغتين") : L(`${ar ? "English" : "Arabic"} caption missing`, `النص ${ar ? "الإنجليزي" : "العربي"} ناقص`), ar && en ? null : "words");
    else if (mode === "separate") add(!!ar || !!en, L("This category posts Arabic and English as separate posts", "هذا التصنيف ينشر العربية والإنجليزية كمنشورين منفصلين"), ar && en ? "split" : null);
    else add(mode === "ar" ? !!ar : !!en, mode === "ar" ? L("Arabic caption", "النص العربي") : L("English caption", "النص الإنجليزي"), "words");
    const blocks = d.checks.filter((c) => c.level === "block");
    const unblurred = (who?.cantAppearPhotos ?? []).filter((c) => order.includes(c.id) && !photo(c.id)?.edit_settings?.blur);
    add(!blocks.length && !unblurred.length, blocks.length ? blocks[0].text : unblurred.length ? plural(unblurred.length, "photo shows someone who can't appear", "photos show someone who can't appear", "صور فيها من لا يمكن ظهوره") : L("Privacy check passed", "اجتاز فحص الخصوصية"), unblurred.length ? "privacy" : null);
    const cf = cat()?.frame_id;
    if (cf && order.length) {
      const framed = order.filter((rid) => photo(rid)?.edit_settings?.frame === cf).length;
      add(framed === order.length, framed === order.length ? L("Category frame on every photo", "إطار التصنيف على كل الصور") : L(`Frame missing on ${order.length - framed} photos`, `الإطار ناقص على ${num(order.length - framed)} صور`), framed === order.length ? null : "shape");
    }
    if (v.scheduled_at) {
      const when = new Date(v.scheduled_at);
      const k = isoDay(when);
      const off = (x.noPostDays?.weekdays ?? []).includes(when.getDay()) || (x.noPostDays?.holidays !== false && (x.holidays ?? []).some((hd) => hd.start && hd.start <= k && (hd.end || hd.start) >= k));
      add(when > new Date() && !off, when <= new Date() ? L("The time is in the past", "الوقت في الماضي") : off ? L("That day is a no-posting day", "هذا اليوم بلا نشر") : L(`Time set: ${fmtWhen(v.scheduled_at)}`, `الوقت: ${fmtWhen(v.scheduled_at)}`), "details");
    } else add(false, L("No time yet (or use the next free slot)", "لا وقت بعد (أو استخدم أقرب موعد)"), "details");
    const lim = x.photoLimit ?? null;
    if (lim && order.length > lim) add(false, L(`Too many photos: ${order.length} of ${lim}`, `صور كثيرة: ${num(order.length)} من ${num(lim)}`), "photos");
    const tags = (v.hashtags.match(/#/g) ?? []).length;
    if (ig && tags > LIMIT.tags) add(false, L(`${tags} hashtags (Instagram allows 30)`, `${num(tags)} وسم (إنستجرام يسمح بـ 30)`), "words");
    const avoid = (x.avoid ?? []).filter((w) => w && `${ar} ${en}`.toLowerCase().includes(w.toLowerCase()));
    if (avoid.length) add(false, L(`Words to avoid: ${avoid.join(", ")}`, `كلمات يجب تجنبها: ${avoid.join("، ")}`), "words");
    return items;
  }

  // ---- The live preview ----
  function preview() {
    read();
    const ig = view === "instagram" || view === "story";
    const cap = ig && v.splitIg && v.caption_ig.trim() ? v.caption_ig : [langMode() !== "en" ? v.caption_ar : "", langMode() !== "ar" ? v.caption_en : ""].map((t) => t.trim()).filter(Boolean).join("\n\n");
    const text = [cap, v.hashtags.trim()].filter(Boolean).join("\n\n");
    const cut = ig ? 125 : 480;
    const short = text.length > cut ? `${esc(text.slice(0, cut))}… <b class="muted">${L("more", "المزيد")}</b>` : esc(text);
    const first = d.photos.find((p) => p.id === order[0]);
    const nm = view === "facebook" ? d.account.page : d.account.ig ?? d.account.page;
    if (view === "story") return `<div class="pv story">${first?.thumb ? `<img src="${esc(first.thumb)}" />` : `<span class="muted">${L("A story needs a photo", "القصة تحتاج صورة")}</span>`}<span class="pvs">${esc(nm)}</span></div>`;
    return `<div class="pv"><div class="pvh"><span class="logo">${esc((S.schoolName ?? "S").slice(0, 2))}</span><b>${esc(nm)}</b>${v.location ? `<span class="muted small">· ${esc(v.location)}</span>` : ""}</div>
      ${view === "facebook" && text ? `<p class="pvt">${short}</p>` : ""}
      ${first?.thumb ? `<div class="pvi ${view}"><img src="${esc(first.thumb)}" />${order.length > 1 ? `<span class="pvn">1/${num(order.length)}</span>` : ""}</div>` : ig ? `<div class="pvi instagram empty">${L("Instagram needs a photo", "إنستجرام يحتاج صورة")}</div>` : ""}
      ${ig ? `<p class="pvt"><b>${esc(nm)}</b> ${short}</p>` : ""}
      ${v.first_comment.trim() ? `<p class="pvt muted small">${icon("message-circle", 12)} ${esc(v.first_comment)}</p>` : ""}
      <div class="pvf">♡ ${L("Like", "إعجاب")} · ${L("Comment", "تعليق")} · ${L("Share", "مشاركة")}</div></div>`;
  }

  // ---- Step 1: photos ----
  function photosStep(ro) {
    const thumbs = order.map((rid) => d.photos.find((p) => p.id === rid)).filter(Boolean);
    const cant = new Map((who?.cantAppearPhotos ?? []).map((c) => [c.id, c.n]));
    const fr = x.frames.filter((f) => f.kind === "frame");
    return `<div class="col gap12">
      <div class="row"><b class="grow">${L("Photos", "الصور")} <span class="muted small">${num(order.length)}${x.photoLimit ? ` / ${num(x.photoLimit)}` : ""}</span></b>
        ${ro ? "" : `<button class="btn small" id="e-add">${icon("plus", 14)} ${L("Add photos", "إضافة صور")}</button><button class="btn small" id="e-collage">${icon("layout-grid", 14)} ${L("Collage", "مجمّعة")}</button>`}</div>
      <div class="edstrip" id="e-strip">${thumbs.map((p, i) => `<div class="eph ${i === 0 ? "cover" : ""}" draggable="${!ro}" data-rid="${p.id}"><img src="${esc(p.thumb ?? "")}" />
        ${i === 0 ? `<span class="badge">${L("Cover", "الغلاف")}</span>` : ""}${p.waiting ? `<span class="badge warn">${L("Mac check", "فحص الماك")}</span>` : ""}${cant.has(p.id) ? `<span class="badge bad" title="${L("Someone who can't appear", "شخص لا يمكن ظهوره")}">${icon("eye-off", 11)}</span>` : ""}
        ${photo(p.id)?.edit_settings?.kind === "mac" ? `<span class="badge good">${esc(photo(p.id).edit_settings.crop)}</span>` : ""}</div>`).join("") || `<span class="muted small">${L("No photos (Facebook only).", "لا صور (فيسبوك فقط).")}</span>`}</div>
      ${ro ? "" : `<p class="muted small">${L("Drag to change the order. The first photo is the cover. Right-click a photo for more.", "اسحب لتغيير الترتيب. الصورة الأولى هي الغلاف. انقر بالزر الأيمن لخيارات أكثر.")}</p>`}
      ${ro || !order.length ? "" : `<div class="card tight col gap8"><b class="small">${L("Shape and frame (made from the originals on this Mac)", "الشكل والإطار (من الأصول على هذا الماك)")}</b>
        ${pills(SHAPES(), shape, "data-shape")}
        <div class="row"><span class="small">${L("Frame", "الإطار")}</span><div class="row frames"><button class="frm ${!frameId ? "on" : ""}" data-frame="">${L("None", "بدون")}</button>${fr.map((f) => `<button class="frm ${frameId === f.id ? "on" : ""}" data-frame="${f.id}" title="${esc(f.name)}">${f.url ? `<img src="${esc(f.url)}" />` : esc(f.name)}</button>`).join("")}</div></div>
        <div class="row"><span class="muted small grow">${L("Faces are kept inside the crop. Click a photo to move its crop by hand.", "تبقى الوجوه داخل القص. انقر صورة لتحريك القص يدوياً.")}</span><button class="btn small primary" id="e-prep">${icon("crop", 14)} ${L("Make the post pictures", "جهّز صور المنشور")}</button></div></div>`}
      ${cant.size ? `<div class="note warn col gap8"><b>${icon("eye-off", 14)} ${plural(cant.size, "photo shows someone who can't appear", "photos show someone who can't appear", "صور فيها من لا يمكن ظهوره")}</b>
        <div class="row">${[...cant.keys()].filter((rid) => order.includes(rid)).map((rid) => `<div class="cantph"><img src="${esc(d.photos.find((p) => p.id === rid)?.thumb ?? "")}" />${photo(rid)?.edit_settings?.blur ? `<span class="tag good">${L("Blurred", "مموّه")}</span>` : ro ? "" : `<button class="btn small" data-blur="${rid}">${L("Blur", "تمويه")}</button><button class="btn small ghost" data-drop="${rid}">${L("Remove", "إزالة")}</button>`}</div>`).join("")}</div></div>` : ""}
      <div class="card tight"><div class="row"><b class="small grow">${icon("users", 14)} ${L("Who's in this post", "من في هذا المنشور")}</b><span class="muted small">${L("Names are shown only on this Mac", "الأسماء تظهر على هذا الماك فقط")}</span></div>
        ${who?.people?.length ? `<div class="whos">${who.people.map((p) => `<span class="who" title="${esc(p.class_name ?? "")}">${esc(name(p))}<span class="muted"> ${esc(p.class_name ?? KINDS()[p.kind] ?? "")}</span>${p.posted <= 1 ? `<span class="tag good" title="${L("First time in a post", "أول مرة في منشور")}">${L("new", "جديد")}</span>` : p.posted > 6 ? `<span class="tag warn" title="${L("Posted often", "يُنشر كثيراً")}">${num(p.posted)}×</span>` : ""}</span>`).join("")}</div>` : `<p class="muted small">${L("Nobody named yet in these photos.", "لا أسماء بعد في هذه الصور.")}</p>`}
        ${who?.unnamed ? `<p class="muted small">${L(`${who.unnamed} faces not named`, `${num(who.unnamed)} وجه بلا اسم`)} · <button class="link" id="e-name">${L("Name them in Faces", "سمّها في الوجوه")}</button></p>` : ""}
        ${who?.notOnMac ? `<p class="muted small">${L(`${who.notOnMac} photos came from phones or the website`, `${num(who.notOnMac)} صور من الهواتف أو الموقع`)}</p>` : ""}</div>
    </div>`;
  }

  // ---- Step 2: words ----
  function wordsStep(ro) {
    const mode = langMode();
    const field = (lang, label) => {
      const val = lang === "ar" ? v.caption_ar : v.caption_en;
      const lim = v.platforms.includes("instagram") ? LIMIT.instagram : LIMIT.facebook;
      return `<div class="field"><div class="row"><span class="grow">${label}</span>${ro ? "" : `<button class="link small" data-tr="${lang}">${lang === "ar" ? L("From English", "من الإنجليزية") : L("From Arabic", "من العربية")}</button><button class="link small" data-rw="${lang}">${icon("wand-sparkles", 12)} ${L("Rewrite", "إعادة صياغة")}</button>${undo[lang].length ? `<button class="link small" data-un="${lang}">${icon("undo-2", 12)} ${L("Undo", "تراجع")}</button>` : ""}`}</div>
        <textarea id="e-${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}" rows="7" ${ro ? "disabled" : ""}>${esc(val)}</textarea><span class="muted small end" data-cnt="${lang}">${num(val.length)} / ${num(lim)}</span></div>`;
    };
    return `<div class="col gap12">
      ${mode === "separate" ? `<div class="note">${L("This category posts Arabic and English as two separate posts. Write both here; “Make the English post” copies it out.", "هذا التصنيف ينشر العربية والإنجليزية كمنشورين. اكتب الاثنين هنا؛ «أنشئ المنشور الإنجليزي» ينسخه.")} ${ro ? "" : `<button class="btn small" id="e-sep">${L("Make the English post", "أنشئ المنشور الإنجليزي")}</button>`}</div>` : ""}
      <div class="grid2">${mode !== "en" ? field("ar", L("Arabic caption", "النص بالعربية")) : ""}${mode !== "ar" ? field("en", L("English caption", "النص بالإنجليزية")) : ""}</div>
      ${ro ? "" : `<div class="srow"><span class="grow">${L("Keep both languages matched", "أبقِ اللغتين متطابقتين")}<span class="muted small block">${L("After you change one, “Update the other” translates it.", "بعد تغيير أحدهما، «حدّث الآخر» يترجمه.")}</span></span>${sw('id="e-link"', S.linkLangs)}${S.linkLangs && mode === "both" ? `<button class="btn small" id="e-sync">${L("Update the other", "حدّث الآخر")}</button>` : ""}</div>`}
      ${ro ? "" : `<div class="card tight col gap8"><b class="small">${icon("sparkles", 14)} ${L("Write with AI", "اكتب بالذكاء الاصطناعي")}</b>
        <div class="row">${pillMenu("tpl", L("Ready-made prompt", "طلب جاهز"), PROMPTS().map(([k, l]) => [k, l]), App.postTpl)}${pillMenu("tone", L("Tone", "النبرة"), TONES().slice(1), App.postTone)}
          <span class="small">${L("Words", "كلمات")}</span><input type="range" id="e-words" min="0" max="250" step="10" value="${App.postWords ?? 0}" style="width: 110px" /><span class="small muted" id="e-wn">${App.postWords ? num(App.postWords) : L("auto", "تلقائي")}</span></div>
        <div class="row"><span class="small">${L("Options", "خيارات")}</span>${pills([1, 2, 3, 4, 5].map((n) => [n, num(n)]), App.postCount ?? 3, "data-cnt-ai")}
          <label class="check">${sw('id="e-emoji"', App.postEmoji !== false)} ${L("Emoji", "رموز")}</label><label class="check">${sw('id="e-htag"', App.postTags !== false)} ${L("Hashtags", "وسوم")}</label></div>
        <div class="row"><input id="e-prompt" class="grow" placeholder="${L("Anything for the AI to mention?", "شيء تريد أن يذكره الذكاء الاصطناعي؟")}" value="${esc(App.postPrompt ?? "")}" /><button class="btn primary" id="e-gen">${icon("sparkles", 14)} ${v.caption_ar || v.caption_en ? L("Write new versions", "اكتب نسخاً جديدة") : L("Write captions", "اكتب النص")}</button></div></div>`}
      ${(d.post.variations ?? []).length > 1 ? `<div class="col gap4"><b class="small">${L("Other versions (click to use)", "نسخ أخرى (انقر للاستخدام)")}</b>${d.post.variations.map((vv, i) => `<button class="vers" data-v="${i}">${esc((S.language === "en" ? vv.en || vv.ar : vv.ar || vv.en) ?? "")}</button>`).join("")}</div>` : ""}
      <div class="field"><div class="row"><span class="grow">${L("Hashtags", "الوسوم")}</span>${ro ? "" : x.snippets.filter((s) => s.kind === "hashtags").map((s) => `<button class="link small" data-snip="${s.id}">+ ${esc(s.title)}</button>`).join("")}</div><input id="e-tags" value="${esc(v.hashtags)}" ${ro ? "disabled" : ""} /></div>
      ${ro || !x.snippets.some((s) => s.kind !== "hashtags") ? "" : `<div class="row"><span class="small muted">${L("Insert", "إدراج")}</span>${x.snippets.filter((s) => s.kind !== "hashtags").map((s) => `<button class="pill" data-snip="${s.id}">${esc(s.title)}</button>`).join("")}</div>`}
      <div class="srow"><span class="grow">${L("Different caption on Instagram", "نص مختلف على إنستجرام")}<span class="muted small block">${L("Instagram cuts after 125 letters and links don't work there.", "إنستجرام يقطع بعد 125 حرفاً والروابط لا تعمل.")}</span></span>${sw(`id="e-split" ${ro ? "disabled" : ""}`, v.splitIg)}</div>
      ${v.splitIg ? `<textarea id="e-ig" rows="4" dir="auto" ${ro ? "disabled" : ""}>${esc(v.caption_ig)}</textarea>` : ""}
      <label class="field">${L("First comment", "أول تعليق")}<input id="e-first" value="${esc(v.first_comment)}" placeholder="${L("For example the link, or more hashtags", "مثلاً الرابط أو وسوم إضافية")}" ${ro ? "disabled" : ""} /></label>
      ${ro ? "" : `<div class="card tight col gap8"><div class="row"><b class="small grow">${icon("spell-check", 14)} ${L("Spelling and brand check", "فحص الإملاء والهوية")}</b><button class="btn small" id="e-check">${L("Check now", "افحص الآن")}</button></div>
        ${check ? `<div class="row"><b>${num(check.score)}/100</b><span class="muted small grow">${L("fits the school's voice", "مناسب لصوت المدرسة")}</span></div>${[...(check.spelling ?? []).map((s) => `<div class="small">${icon("spell-check", 12)} ${esc(typeof s === "string" ? s : `${s.wrong} → ${s.right}`)}</div>`), ...(check.notes ?? []).map((n) => `<div class="small muted">• ${esc(n)}</div>`)].join("")}` : `<span class="muted small">${L("Checks spelling in both languages, the school's tone and the words to avoid.", "يفحص الإملاء باللغتين ونبرة المدرسة والكلمات الممنوعة.")}</span>`}</div>`}
    </div>`;
  }

  // ---- Step 3: details ----
  function detailsStep(ro, locked) {
    const local = v.scheduled_at ? new Date(new Date(v.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    return `<div class="col gap12">
      <div class="grid2">
        <label class="field">${L("Category", "التصنيف")}<select id="e-cat" ${ro ? "disabled" : ""}><option value="">${L("No category", "بدون تصنيف")}</option>${x.categories.map((c) => `<option value="${c.id}" ${c.id === v.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field">${L("Date and time", "التاريخ والوقت")}<input type="datetime-local" id="e-when" value="${local}" ${locked ? "disabled" : ""} /></label>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" data-plat="facebook" ${v.platforms.includes("facebook") ? "checked" : ""} ${ro ? "disabled" : ""} /> Facebook</label>
        <label class="check"><input type="checkbox" data-plat="instagram" ${v.platforms.includes("instagram") ? "checked" : ""} ${ro ? "disabled" : ""} /> Instagram</label>
      </div>
      <div class="srow"><span class="grow">${L("Story too", "قصة أيضاً")}<span class="muted small block">${L("The cover becomes a 9:16 story automatically.", "يصبح الغلاف قصة 9:16 تلقائياً.")}</span></span>${sw(`id="e-story" ${ro ? "disabled" : ""}`, v.make_story)}</div>
      <label class="field">${L("Tag other pages (Instagram collaborators)", "إشارة لصفحات أخرى (متعاونون على إنستجرام)")}<input id="e-collab" value="${esc((x.extra.collaborators ?? []).join(", "))}" placeholder="${L("For example: @sciencemuseum, @parentsclub", "مثلاً: @sciencemuseum, @parentsclub")}" ${ro ? "disabled" : ""} /></label>
      <label class="field">${L("Location", "الموقع")}<input id="e-loc" value="${esc(v.location)}" placeholder="${L("For example the school, or the museum you visited", "مثلاً المدرسة أو المتحف الذي زرتموه")}" ${ro ? "disabled" : ""} /></label>
      <div class="srow"><span class="grow">${L("Sensitive", "حساس")}<span class="muted small block">${L("Needs the principal's sign-off too.", "يحتاج موافقة المدير أيضاً.")}</span></span>${sw(`id="e-sens" ${ro ? "disabled" : ""}`, v.sensitive)}</div>
      ${["admin", "comms_lead"].includes(role) ? `<div class="srow"><span class="grow">${L("Urgent", "عاجل")}<span class="muted small block">${L("Skips the queue and tells approvers now.", "يتخطى الطابور ويبلّغ المعتمدين الآن.")}</span></span>${sw(`id="e-urgent" ${ro ? "disabled" : ""}`, v.urgent)}</div>` : ""}
      <label class="field">${L("Countdown to (optional)", "عدّ تنازلي حتى (اختياري)")}<input type="date" id="e-count" value="${esc(v.countdown_to)}" ${ro ? "disabled" : ""} /></label>
      <details ${v.alt_ar || v.alt_en ? "open" : ""}><summary class="small"><b>${L("Alt text (for people who can't see the photo)", "نص بديل (لمن لا يرى الصورة)")}</b></summary>
        <div class="grid2"><textarea id="e-alt-ar" dir="rtl" rows="2" ${ro ? "disabled" : ""}>${esc(v.alt_ar)}</textarea><textarea id="e-alt-en" dir="ltr" rows="2" ${ro ? "disabled" : ""}>${esc(v.alt_en)}</textarea></div></details>
    </div>`;
  }

  // ---- Step 4: team ----
  function teamStep(ro) {
    const hist = [...x.history.map((h) => ({ at: h.at, by: h.by, text: historyText(h) })), ...x.versions.map((vv) => ({ at: vv.at, by: vv.by, text: L("Caption saved", "حُفظ النص"), version: vv }))].sort((a, b) => b.at.localeCompare(a.at));
    return `<div class="col gap12">
      <div class="grid2">
        <label class="field">${L("Given to", "مسند إلى")}<select id="e-assign" ${ro ? "disabled" : ""}><option value="">${L("Nobody", "لا أحد")}</option>${x.team.map((t) => `<option value="${t.id}" ${t.id === v.assigned_to ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        <label class="field">${L("Due", "الموعد")}<input type="date" id="e-due" value="${esc(v.due_on)}" ${ro ? "disabled" : ""} /></label>
      </div>
      <div class="card tight col gap8"><b class="small">${L("Notes", "الملاحظات")}</b>${d.comments.map((c) => `<div class="small"><b>${esc(c.author_name ?? "")}</b> <span class="muted">${esc(fmtWhen(c.created_at))}</span><br/>${esc(c.body)}</div>`).join("") || `<span class="small muted">${L("No notes yet.", "لا ملاحظات بعد.")}</span>`}
        <div class="row nowrap"><input id="e-comment" class="grow" list="e-team" placeholder="${L("Write a note, @name to tell someone", "اكتب ملاحظة، @الاسم لتنبيه شخص")}" /><datalist id="e-team">${x.team.map((t) => `<option value="@${esc(t.name)} ">`).join("")}</datalist><button class="btn small" id="e-send">${L("Add", "أضف")}</button></div></div>
      <div class="card tight col gap8"><b class="small">${L("Approval link (for someone without an account)", "رابط اعتماد (لمن ليس لديه حساب)")}</b>
        ${x.links.map((l) => `<div class="small">${esc(l.label)}: ${l.answer ? `<b>${esc(l.answer === "approve" ? L("approved", "وافق") : L("asked for changes", "طلب تعديلات"))}</b>${l.comment ? ` · ${esc(l.comment)}` : ""}` : l.expired ? L("expired", "انتهى") : L("waiting", "بانتظار الرد")}</div>`).join("")}
        ${ro ? "" : `<div class="row nowrap"><input id="e-link-for" class="grow" placeholder="${L("Who is it for? For example: the owner", "لمن؟ مثلاً: المالك")}" /><button class="btn small" id="e-mklink">${L("Make link", "أنشئ رابطاً")}</button></div>`}</div>
      <div class="card tight col gap4"><b class="small">${icon("history", 14)} ${L("Change history", "سجل التغييرات")}</b>
        ${hist.slice(0, 40).map((h) => `<div class="hrow small"><span class="muted" style="min-width: 120px">${esc(fmtWhen(h.at))}</span><span class="grow">${esc(h.text)}${h.by ? ` · <b>${esc(h.by)}</b>` : ""}${h.version ? `<span class="muted block">${esc((h.version.ar || h.version.en || "").slice(0, 120))}</span>` : ""}</span>${h.version && !ro ? `<button class="link small" data-restore="${h.version.id}">${L("Bring back", "استرجاع")}</button>` : ""}</div>`).join("") || `<span class="muted small">${L("No changes yet.", "لا تغييرات بعد.")}</span>`}</div>
    </div>`;
  }

  function draw() {
    const p = d.post;
    const locked = ["publishing", "published"].includes(p.status);
    const ro = locked || !writer;
    const s = p.status;
    const items = checklist();
    const steps = [["photos", L("Photos", "الصور"), "images"], ["words", L("Words", "النص"), "type"], ["details", L("Details", "التفاصيل"), "sliders-horizontal"], ["team", L("Team", "الفريق"), "users"]];
    box.innerHTML = `
      <div class="row nowrap"><h2 class="grow">${s === "idea" ? L("Idea", "فكرة") : L("Post", "منشور")} <span class="tag ${STATUS_TAG[s] ?? ""}">${esc(statusName(s))}</span>${p.event?.title ? ` <span class="muted small">${esc(p.event.title)}</span>` : ""}</h2>
        ${canApprove() || ["approved", "scheduled"].includes(s) && ["admin", "comms_lead"].includes(role) ? `<label class="check approved">${sw('id="e-approved"', ["approved", "scheduled"].includes(s), canApprove() || s === "approved" ? "" : "disabled")} ${L("Approved", "معتمد")}</label>` : ""}
        <button class="btn small ghost" id="e-web" title="${L("Open on the website", "افتح على الموقع")}">${icon("globe", 14)}</button><button class="btn small ghost" id="e-close">${icon("x", 14)}</button></div>
      ${p.idea ? `<div class="note">${esc(p.idea)}</div>` : ""}
      ${s === "rejected" && p.review_note ? `<div class="note warn">${L("Changes asked", "طُلبت تعديلات")}: ${esc(p.review_note)}</div>` : ""}
      ${s === "failed" && p.publish_error ? `<div class="note bad">${esc(p.publish_error)}</div>` : ""}
      <div class="ed">
        <div class="col gap12 edmain">
          <div class="edsteps">${steps.map(([k, l, ic], i) => `<button class="step ${step === k ? "on" : ""}" data-step="${k}"><span class="n">${i + 1}</span>${icon(ic, 14)} ${l}</button>`).join("")}</div>
          <div id="e-step">${step === "photos" ? photosStep(ro) : step === "words" ? wordsStep(ro) : step === "details" ? detailsStep(ro, locked) : teamStep(ro)}</div>
        </div>
        <div class="col gap12 edside">
          ${pills([["facebook", "Facebook"], ["instagram", "Instagram"], ["story", L("Story", "قصة")]], view, "data-view")}
          <div id="e-prev">${preview()}</div>
          <div class="card tight col gap4" id="e-list"><b class="small">${L("Before sending", "قبل الإرسال")}</b>${items.map((it) => `<div class="chk ${it.ok ? "ok" : ""}">${icon(it.ok ? "circle-check" : "circle-alert", 14)}<span class="grow">${esc(it.text)}</span>${!it.ok && it.fix && !ro ? `<button class="link small" data-fix="${it.fix}">${L("Fix", "أصلح")}</button>` : ""}</div>`).join("")}
            ${d.checks.filter((c) => c.level !== "block").map((c) => `<div class="chk">${icon("info", 14)}<span class="grow muted">${esc(c.text)}</span></div>`).join("")}</div>
          <div class="col gap4" id="e-actions"></div>
        </div>
      </div>`;

    const acts = [];
    const btn = (intent, label, cls = "") => acts.push(`<button class="btn ${cls}" data-act="${intent}">${label}</button>`);
    if (!locked) {
      if (writer) btn("save", `${L("Save", "حفظ")} <span class="k">⌘S</span>`);
      if (s === "idea" && writer) btn("start", L("Start writing this post", "ابدأ كتابة هذا المنشور"));
      if (writer && ["idea", "draft", "rejected"].includes(s) && !canApprove()) btn("submit", L("Send for approval", "أرسل للاعتماد"), "primary");
      if (canApprove()) btn("approve", `${icon("check", 14)} ${L("Approve", "اعتماد")} <span class="k">A</span>`, "primary");
      if ((canApprove() || ["approved", "failed"].includes(s)) && ["admin", "comms_lead", "principal"].includes(role) && s !== "idea") {
        btn("schedule", L("Schedule", "جدولة"));
        btn("queue", L("Add to the next free slot", "أضف إلى أقرب موعد متاح"));
      }
      if (["admin", "comms_lead"].includes(role) && ["approved", "scheduled", "failed"].includes(s)) btn("publish", s === "failed" ? L("Try publishing again", "حاول النشر مجدداً") : L("Publish now", "انشر الآن"));
      if (s === "scheduled") btn("unschedule", L("Unschedule", "إلغاء الجدولة"));
      if (canApprove() && ["in_review", "waiting_extra"].includes(s)) btn("reject", L("Ask for changes", "اطلب تعديلات"), "ghost");
    }
    $("#e-actions", box).innerHTML = `${acts.join("")}<div class="row">${writer ? `<button class="btn small ghost grow" data-act="duplicate">${icon("copy", 13)} ${L("Duplicate", "نسخ")}</button>` : ""}${writer && !locked ? `<button class="btn small danger" data-act="delete">${icon("trash-2", 13)} ${L("Delete", "حذف")}</button>` : ""}</div>`;

    $("#e-close", box).onclick = closeEditor;
    $("#e-web", box).onclick = () => call("openWeb", `/posts/${id}`);
    $("#e-approved", box)?.addEventListener("change", (e) => act(e.target.checked ? "approve" : "draft"));
    bindPills(box, "data-step", (k) => { read(); step = k; draw(); });
    $$("[data-step]", box).forEach((b) => (b.onclick = () => { read(); step = b.dataset.step; draw(); }));
    bindPills(box, "data-view", (k) => { view = k; $$("[data-view]", box).forEach((b) => b.classList.toggle("on", b.dataset.view === k)); $("#e-prev", box).innerHTML = preview(); });
    $$("[data-fix]", box).forEach((b) => (b.onclick = () => { read(); step = { shape: "photos", privacy: "photos", photos: "photos", words: "words", details: "details", split: "words" }[b.dataset.fix]; draw(); }));
    $$("[data-act]", box).forEach((b) =>
      (b.onclick = async () => {
        const intent = b.dataset.act;
        if (intent === "delete" && !(await confirmBox(L("Delete this post?", "حذف هذا المنشور؟"), L("Delete", "حذف")))) return;
        if (intent === "reject") {
          const note = prompt(L("What should change?", "ما الذي يجب تغييره؟"));
          if (note === null) return;
          return act("reject", { reviewNote: note });
        }
        if (["submit", "approve", "schedule", "queue", "publish"].includes(intent)) {
          const bad = checklist().filter((it) => !it.ok && it.fix !== "details" && it.fix !== "split");
          if (bad.length && !(await confirmBox(L(`${bad.length} things in the list aren't ready:\n${bad.map((b) => `• ${b.text}`).join("\n")}\n\nSend anyway?`, `${num(bad.length)} أمور غير جاهزة:\n${bad.map((b) => `• ${b.text}`).join("\n")}\n\nإرسال على أي حال؟`), L("Send anyway", "إرسال على أي حال")))) return;
        }
        act(intent);
      }),
    );
    $("#e-step", box).addEventListener("input", (e) => {
      dirty = true;
      const lang = e.target.id === "e-ar" ? "ar" : e.target.id === "e-en" ? "en" : null;
      if (lang) $(`[data-cnt="${lang}"]`, box).textContent = `${num(e.target.value.length)} / ${num(v.platforms.includes("instagram") ? LIMIT.instagram : LIMIT.facebook)}`;
      $("#e-prev", box).innerHTML = preview();
    });
    $("#e-step", box).addEventListener("change", (e) => {
      if (["e-cat", "e-split"].includes(e.target.id) || e.target.dataset.plat) { read(); if (e.target.id === "e-cat") frameId = cat()?.frame_id ?? frameId; draw(); }
    });
    if (step === "photos") bindPhotos(ro);
    if (step === "words") bindWords();
    if (step === "team") bindTeam();
  }

  function bindPhotos(ro) {
    const strip = $("#e-strip", box);
    if (!ro && strip) {
      let dragging = null;
      $$(".eph", strip).forEach((el) => {
        el.ondragstart = () => (dragging = el.dataset.rid);
        el.ondragover = (e) => e.preventDefault();
        el.ondrop = (e) => {
          e.preventDefault();
          const to = order.indexOf(el.dataset.rid);
          order = order.filter((r) => r !== dragging);
          order.splice(to, 0, dragging);
          dirty = true;
          draw();
        };
        el.onclick = () => cropBox(el.dataset.rid);
      });
      onContext(strip, ".eph", (el) => [
        { label: L("Make it the cover", "اجعلها الغلاف"), run: () => { order = [el.dataset.rid, ...order.filter((r) => r !== el.dataset.rid)]; dirty = true; draw(); } },
        { label: L("Move the crop…", "حرّك القص…"), run: () => cropBox(el.dataset.rid) },
        { label: L("Show in the library", "اعرض في المكتبة"), run: async () => { const l = await quiet("postLocal", [el.dataset.rid]); if (l?.[0]) { closeOverlay(); openViewer([l[0].id], 0); } } },
        "-",
        { label: L("Remove from the post", "أزل من المنشور"), danger: true, run: () => { order = order.filter((r) => r !== el.dataset.rid); dirty = true; draw(); } },
      ]);
    }
    bindPills(box, "data-shape", (k) => { shape = k; S.postShape = k; $$("[data-shape]", box).forEach((b) => b.classList.toggle("on", b.dataset.shape === k)); });
    $$("[data-frame]", box).forEach((b) => (b.onclick = () => { frameId = b.dataset.frame; $$("[data-frame]", box).forEach((x2) => x2.classList.toggle("on", x2 === b)); }));
    $("#e-prep", box)?.addEventListener("click", () => prepare(order));
    $$("[data-blur]", box).forEach((b) => (b.onclick = () => prepare([b.dataset.blur], true)));
    $$("[data-drop]", box).forEach((b) => (b.onclick = () => { order = order.filter((r) => r !== b.dataset.drop); dirty = true; act("save"); }));
    $("#e-add", box)?.addEventListener("click", addPhotosBox);
    $("#e-collage", box)?.addEventListener("click", collageBox);
    $("#e-name", box)?.addEventListener("click", async () => { const l = await quiet("postLocal", order); closeOverlay(); go("faces", l?.[0]?.event_key ? { event: l[0].event_key } : { tab: "unknown" }); });
  }

  async function prepare(rids, onlyBlur = false) {
    const f = x.frames.find((fr) => fr.id === frameId);
    if (dirty) await act("save");
    const b = $("#e-prep", box);
    if (b) { b.disabled = true; b.textContent = L("Making…", "جارٍ التجهيز…"); }
    toast(L("Making the pictures from the originals…", "تجهيز الصور من الأصول…"));
    const positions = {};
    for (const rid of rids) if (photo(rid)?.edit_settings?.position != null) positions[rid] = photo(rid).edit_settings.position;
    const r = await call("preparePost", rids, { shape: onlyBlur ? photo(rids[0])?.edit_settings?.crop ?? shape : shape, frameId: onlyBlur ? photo(rids[0])?.edit_settings?.frame ?? null : frameId || null, frameUrl: f?.url ?? null, blur: true, positions });
    if (frameId !== (x.extra.frame_id ?? "")) await quiet("app", "setPost", { id, values: { frame_id: frameId || null } });
    if (r.failed.length) toast(r.failed.some((y) => y.why === "not-on-mac") ? L(`${r.failed.length} photos aren't on this Mac (from phones); they keep their web copy.`, `${num(r.failed.length)} صور ليست على هذا الماك (من الهواتف) وتبقى كما هي.`) : L(`${r.failed.length} photos couldn't be made (original missing?)`, `تعذّر تجهيز ${num(r.failed.length)} صور (الأصل مفقود؟)`));
    else toast(L(`${r.done.length} pictures ready`, `${num(r.done.length)} صور جاهزة`));
    await reload();
    draw();
  }

  // Move one photo's crop by hand, seen from the original.
  async function cropBox(rid) {
    const f = x.frames.find((fr) => fr.id === frameId);
    let pos = photo(rid)?.edit_settings?.position ?? 0.5;
    const m = h(`<div class="modalback"><div class="modal"><h2>${L("Move the crop", "حرّك القص")}</h2><div class="cropv"><img id="cv-img" /></div>
      <input type="range" id="cv-pos" min="0" max="1" step="0.02" value="${pos}" />
      <div class="row"><button class="btn ghost" id="cv-auto">${L("Back to automatic (faces)", "عودة للتلقائي (الوجوه)")}</button><span class="grow"></span><button class="btn" id="cv-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="cv-ok">${L("Use this crop", "استخدم هذا القص")}</button></div></div></div>`);
    document.body.append(m);
    const close = () => m.remove();
    const show = async (p) => {
      const url = await quiet("previewCrop", rid, { shape: shape === "fb" ? "4:5" : shape, frameId: frameId || null, frameUrl: f?.url ?? null, blur: true, position: p });
      if (url) $("#cv-img", m).src = url;
      else $(".cropv", m).innerHTML = `<p class="muted">${L("This photo isn't on this Mac.", "هذه الصورة ليست على هذا الماك.")}</p>`;
    };
    show(photo(rid)?.edit_settings?.position ?? null);
    let t;
    $("#cv-pos", m).oninput = (e) => { pos = Number(e.target.value); clearTimeout(t); t = setTimeout(() => show(pos), 120); };
    $("#cv-no", m).onclick = close;
    $("#cv-auto", m).onclick = async () => { close(); const fr = f; await call("preparePost", [rid], { shape, frameId: frameId || null, frameUrl: fr?.url ?? null, blur: true, positions: {} }); await reload(); draw(); };
    $("#cv-ok", m).onclick = async () => { close(); await call("preparePost", [rid], { shape: shape === "fb" ? "4:5" : shape, frameId: frameId || null, frameUrl: f?.url ?? null, blur: true, positions: { [rid]: pos } }); await reload(); draw(); };
  }

  async function addPhotosBox() {
    const more = await quiet("morePhotos", order, 80);
    const chosen = new Set();
    const m = h(`<div class="modalback"><div class="modal wide"><h2>${L("Add photos", "إضافة صور")}</h2><p class="muted small">${L("From the same event first. Click to choose.", "من الفعالية نفسها أولاً. انقر للاختيار.")}</p>
      <div class="cgrid" style="max-height: 60vh; overflow-y: auto; padding: 0">${(more ?? []).map((p) => `<div class="ctile" data-pid="${p.id}"><img loading="lazy" src="hub://thumb/${p.id}" /><span class="tick">${icon("check", 11)}</span>${p.posts ? `<span class="badge">${L("posted", "نُشرت")}</span>` : ""}</div>`).join("") || emptyState("image", L("No more photos", "لا صور أخرى"))}</div>
      <div class="row"><span class="grow"></span><button class="btn" id="ap-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="ap-ok">${L("Add", "أضف")}</button></div></div></div>`);
    document.body.append(m);
    $$("[data-pid]", m).forEach((el) => (el.onclick = () => { const k = Number(el.dataset.pid); chosen.has(k) ? chosen.delete(k) : chosen.add(k); el.classList.toggle("on", chosen.has(k)); }));
    $("#ap-no", m).onclick = () => m.remove();
    $("#ap-ok", m).onclick = async () => {
      if (!chosen.size) return m.remove();
      $("#ap-ok", m).disabled = true;
      $("#ap-ok", m).textContent = L("Sending…", "جارٍ الإرسال…");
      const rids = await call("sendPhotos", [...chosen]);
      m.remove();
      order = [...order, ...rids.filter((r) => !order.includes(r))];
      await quiet("app", "postPhotos", { id, order });
      await reload();
      draw();
    };
  }

  async function collageBox() {
    if (order.length < 2) return toast(L("Add at least two photos first.", "أضف صورتين على الأقل أولاً."));
    let layout = String(Math.min(4, order.length));
    let cshape = "4:5";
    const m = h(`<div class="modalback"><div class="modal"><h2>${L("Collage", "صورة مجمّعة")}</h2><p class="muted small">${L("Made from the originals, faces kept in each part. It becomes the cover; the photos stay in the post after it.", "من الأصول مع إبقاء الوجوه. تصبح الغلاف وتبقى الصور بعدها.")}</p>
      <div id="cl-opts"></div><div class="cropv"><img id="cl-img" /></div>
      <div class="row"><span class="grow"></span><button class="btn" id="cl-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="cl-ok">${L("Use as cover", "استخدم كغلاف")}</button></div></div></div>`);
    document.body.append(m);
    const opts = () => {
      $("#cl-opts", m).innerHTML = `${pills(["2", "3", "4", "6"].filter((n) => Number(n) <= order.length).map((n) => [n, L(`${n} photos`, `${n} صور`)]), layout, "data-lay")} ${pills([["4:5", "4:5"], ["1:1", L("Square", "مربع")]], cshape, "data-cs")}`;
      bindPills(m, "data-lay", (k) => { layout = k; opts(); });
      bindPills(m, "data-cs", (k) => { cshape = k; opts(); });
    };
    opts();
    $("#cl-no", m).onclick = () => m.remove();
    $("#cl-ok", m).onclick = async () => {
      $("#cl-ok", m).disabled = true;
      $("#cl-ok", m).textContent = L("Making…", "جارٍ الإنشاء…");
      const r = await call("makeCollage", [], { layout, shape: cshape, postId: id, remote: order });
      m.remove();
      if (r?.id) toast(L("Collage made", "أُنشئت الصورة المجمّعة"));
      await reload();
      draw();
    };
  }

  function bindWords() {
    const ai = async (lang, payload, el) => {
      if (!payload.text?.trim()) return;
      if (el) el.disabled = true;
      const r = await quiet("app", "rewrite", payload);
      if (el) el.disabled = false;
      if (!r?.text) return toast(L("The AI couldn't answer just now.", "لم يستجب الذكاء الاصطناعي الآن."));
      read();
      undo[lang].push(lang === "ar" ? v.caption_ar : v.caption_en);
      if (lang === "ar") v.caption_ar = r.text;
      else v.caption_en = r.text;
      dirty = true;
      draw();
    };
    $$("[data-tr]", box).forEach((b) => (b.onclick = () => { read(); const lang = b.dataset.tr; ai(lang, { text: lang === "ar" ? v.caption_en : v.caption_ar, to: lang }, b); }));
    $$("[data-rw]", box).forEach((b) =>
      (b.onclick = () => menu(REWRITES().map(([k, l, instr]) => ({ label: l, run: () => { read(); const lang = b.dataset.rw; ai(lang, { text: lang === "ar" ? v.caption_ar : v.caption_en, language: lang, instruction: instr }, b); } })))),
    );
    $$("[data-un]", box).forEach((b) => (b.onclick = () => { read(); const lang = b.dataset.un; const prev = undo[lang].pop(); if (lang === "ar") v.caption_ar = prev; else v.caption_en = prev; draw(); }));
    $("#e-link", box)?.addEventListener("change", (e) => { S.linkLangs = e.target.checked; setSetting("linkLangs", e.target.checked); read(); draw(); });
    $("#e-sync", box)?.addEventListener("click", (e) => { read(); const fromAr = document.activeElement?.id !== "e-en" && v.caption_ar.length >= v.caption_en.length; ai(fromAr ? "en" : "ar", { text: fromAr ? v.caption_ar : v.caption_en, to: fromAr ? "en" : "ar" }, e.target); });
    bindPillMenu(box, "tpl", PROMPTS().map(([k, l]) => [k, l]), App.postTpl, (k) => { App.postTpl = k; read(); draw(); });
    bindPillMenu(box, "tone", TONES().slice(1), App.postTone, (k) => { App.postTone = k; read(); draw(); });
    bindPills(box, "data-cnt-ai", (n) => { App.postCount = Number(n); $$("[data-cnt-ai]", box).forEach((b) => b.classList.toggle("on", b.dataset.cntAi === n)); });
    $("#e-words", box)?.addEventListener("input", (e) => { App.postWords = Number(e.target.value); $("#e-wn", box).textContent = App.postWords ? num(App.postWords) : L("auto", "تلقائي"); });
    $("#e-emoji", box)?.addEventListener("change", (e) => (App.postEmoji = e.target.checked));
    $("#e-htag", box)?.addEventListener("change", (e) => (App.postTags = e.target.checked));
    $("#e-gen", box)?.addEventListener("click", async (e) => {
      read();
      App.postPrompt = $("#e-prompt", box).value;
      e.target.disabled = true;
      e.target.textContent = L("Writing…", "جارٍ الكتابة…");
      if (dirty) await quiet("app", "intent", { id, intent: "save", values: values(), order });
      const tpl = PROMPTS().find(([k]) => k === App.postTpl)?.[2];
      undo.ar.push(v.caption_ar);
      undo.en.push(v.caption_en);
      const r = await quiet("app", "generate", { id, options: { count: App.postCount ?? 3, prompt: [tpl, App.postPrompt].filter(Boolean).join(" ") || null, tone: App.postTone || null, words: App.postWords || null, emoji: App.postEmoji !== false, hashtags: App.postTags !== false, splitInstagram: v.splitIg } });
      if (!r || r.error) toast(r?.error === "limit" ? L("The free AI limit was reached. Wait a minute.", "وصل الحد المجاني. انتظر دقيقة.") : L("The AI couldn't answer just now.", "لم يستجب الذكاء الاصطناعي الآن."));
      else if (r.demo) toast(L("Sample captions: add the AI key on the website for real ones.", "نصوص تجريبية: أضف مفتاح الذكاء الاصطناعي على الموقع."));
      await reload();
      Object.assign(v, { caption_ar: d.post.caption_ar ?? "", caption_en: d.post.caption_en ?? "", hashtags: d.post.hashtags ?? "", caption_ig: d.post.caption_ig ?? v.caption_ig });
      dirty = false;
      draw();
    });
    $$("[data-v]", box).forEach((b) =>
      (b.onclick = () => {
        read();
        undo.ar.push(v.caption_ar);
        undo.en.push(v.caption_en);
        const vv = d.post.variations[Number(b.dataset.v)];
        Object.assign(v, { caption_ar: vv.ar ?? "", caption_en: vv.en ?? "", hashtags: vv.hashtags ?? v.hashtags });
        dirty = true;
        draw();
      }),
    );
    $$("[data-snip]", box).forEach((b) =>
      (b.onclick = () => {
        read();
        const sn = x.snippets.find((s) => s.id === b.dataset.snip);
        if (!sn) return;
        if (sn.kind === "hashtags") v.hashtags = [v.hashtags, sn.body].filter(Boolean).join(" ");
        else if (/[؀-ۿ]/.test(sn.body)) v.caption_ar = [v.caption_ar, sn.body].filter(Boolean).join("\n\n");
        else v.caption_en = [v.caption_en, sn.body].filter(Boolean).join("\n\n");
        dirty = true;
        draw();
      }),
    );
    $("#e-check", box)?.addEventListener("click", async (e) => {
      read();
      e.target.disabled = true;
      check = await quiet("app", "spell", { text: [v.caption_ar, v.caption_en].filter(Boolean).join("\n\n") });
      draw();
    });
    $("#e-sep", box)?.addEventListener("click", async () => {
      read();
      const r = await quiet("app", "intent", { id, intent: "duplicate" });
      if (!r?.id) return;
      await quiet("app", "intent", { id: r.id, intent: "save", values: { caption_ar: "", caption_en: v.caption_en } });
      await quiet("app", "intent", { id, intent: "save", values: { caption_en: "" } });
      toast(L("The English post was made", "أُنشئ المنشور الإنجليزي"));
      await reload();
      v.caption_en = "";
      draw();
    });
  }

  function bindTeam() {
    $("#e-send", box).onclick = async () => {
      const body = $("#e-comment", box).value.trim();
      if (!body) return;
      await quiet("app", "comment", { id, body });
      await reload();
      draw();
    };
    $("#e-mklink", box)?.addEventListener("click", async () => {
      const label = $("#e-link-for", box).value.trim();
      const r = await quiet("app", "reviewLink", { id, label });
      if (!r?.token) return toast(L("Write who the link is for.", "اكتب لمن الرابط."));
      const url = `${S.server ?? "https://schools-social.vercel.app"}/review/${r.token}`;
      navigator.clipboard?.writeText(url);
      toast(L("Link copied. Send it by WhatsApp or email.", "نُسخ الرابط. أرسله بالواتساب أو البريد."));
      await reload();
      draw();
    });
    $$("[data-restore]", box).forEach((b) => (b.onclick = async () => { await quiet("app", "restoreVersion", { id, version: Number(b.dataset.restore) }); await reload(); Object.assign(v, { caption_ar: d.post.caption_ar ?? "", caption_en: d.post.caption_en ?? "" }); toast(L("Brought back", "تم الاسترجاع")); draw(); }));
  }

  draw();
}

function historyText(h) {
  const a = String(h.action ?? "").replace(/^post\./, "");
  return (
    {
      created: L("Made", "أُنشئ"), idea: L("Saved as an idea", "حُفظ كفكرة"), save: L("Saved", "حُفظ"), start: L("Started writing", "بدأ الكتابة"), submit: L("Sent for approval", "أُرسل للاعتماد"),
      approve: L("Approved", "اعتُمد"), reject: L("Asked for changes", "طُلبت تعديلات"), schedule: L("Scheduled", "جُدول"), queue: L("Put in the next free slot", "وُضع في أقرب موعد"), publish: L("Published", "نُشر"),
      unschedule: L("Unscheduled", "أُلغيت الجدولة"), draft: L("Back to draft", "أُعيد مسودة"), moved: L("Moved", "نُقل"), duplicated: L("Copied from another post", "نُسخ من منشور"), photos: L("Photos changed", "تغيّرت الصور"),
      details: L("Details changed", "تغيّرت التفاصيل"), review_link: L("Approval link made", "أُنشئ رابط اعتماد"), version_restored: L("Older caption brought back", "استُرجع نص سابق"), generated: L("AI wrote captions", "كتب الذكاء الاصطناعي النص"),
    }[a] ?? a
  );
}
