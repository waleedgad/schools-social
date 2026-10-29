// Posts and Calendar, built into the app. They use the website's posting
// rules (approvals, privacy checks) through the signed-in person's account,
// so the Mac, the website and phones always see the same posts.

const BOARD_COLS = [
  { key: "idea", statuses: ["idea"], en: "Ideas", ar: "أفكار" },
  { key: "draft", statuses: ["draft", "rejected"], en: "Drafts", ar: "مسودات" },
  { key: "waiting", statuses: ["in_review", "waiting_extra"], en: "Waiting for approval", ar: "بانتظار الاعتماد" },
  { key: "scheduled", statuses: ["approved", "scheduled", "publishing"], en: "Approved and scheduled", ar: "معتمد ومجدول" },
  { key: "posted", statuses: ["published", "failed"], en: "Posted", ar: "منشور" },
];
const DROP_TO = { idea: "idea", draft: "draft", waiting: "in_review" };
const STATUS_TAG = { idea: "violet", draft: "", rejected: "bad", in_review: "warn", waiting_extra: "warn", approved: "info", scheduled: "info", publishing: "info", published: "good", failed: "bad" };

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

function needSignIn(main, title) {
  main.innerHTML = topbar(title) + `<div class="content"><div class="empty"><span class="big">✎</span><b>${L("Sign in first", "سجّل الدخول أولًا")}</b><span>${L("Posts are shared with your School Social Hub website. Sign in from Settings.", "المنشورات مشتركة مع موقع School Social Hub. سجّل الدخول من الإعدادات.")}</span><button class="btn primary" id="w-set">${L("Open Settings", "فتح الإعدادات")}</button></div></div>`;
  $("#w-set", main).onclick = () => go("settings");
}

App.views.posts = {
  render(main, params) {
    if (!S.signedIn) return needSignIn(main, L("Posts", "المنشورات"));
    this.filter = this.filter ?? "all";
    main.innerHTML =
      topbar(L("Posts", "المنشورات"), L("Ideas, drafts, approvals and what's scheduled", "الأفكار والمسودات والاعتمادات والمجدول"),
        `<button class="btn" id="p-idea">✦ ${L("New idea", "فكرة جديدة")}</button><button class="btn" id="p-web">${L("Open on the website", "افتح على الموقع")}</button><button class="btn primary" id="p-new">✎ ${L("New post", "منشور جديد")}</button>`) +
      `<div class="content col gap12"><div class="row" id="p-filters"></div><div class="board" id="board"><div class="muted">${L("Loading…", "جارٍ التحميل…")}</div></div></div>`;
    $("#p-new", main).onclick = () => newPostMenu();
    $("#p-idea", main).onclick = () => newIdea();
    $("#p-web", main).onclick = () => call("openWeb", "/posts");
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
    this.draw();
  },
  draw() {
    const box = $("#board");
    const f = $("#p-filters");
    if (!box || !this.data) return;
    const { posts, categories } = this.data;
    f.innerHTML = [
      `<button class="pill ${this.filter === "all" ? "on" : ""}" data-f="all">${L("All", "الكل")}</button>`,
      `<button class="pill ${this.filter === "mine" ? "on" : ""}" data-f="mine">${L("Mine", "منشوراتي")}</button>`,
      ...categories.map((c) => `<button class="pill ${this.filter === c.id ? "on" : ""}" data-f="${c.id}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</button>`),
    ].join("");
    $$("[data-f]", f).forEach((b) => (b.onclick = () => { this.filter = b.dataset.f; this.draw(); }));
    const cat = new Map(categories.map((c) => [c.id, c]));
    const shown = posts.filter((p) => this.filter === "all" || (this.filter === "mine" ? p.mine : p.category_id === this.filter));
    box.innerHTML = BOARD_COLS.map((col) => {
      const cards = shown.filter((p) => col.statuses.includes(p.status));
      return `<section class="bcol" data-col="${col.key}"><header><span>${L(col.en, col.ar)}</span><span class="n">${num(cards.length)}</span></header>
        ${cards.map((p) => {
          const c = cat.get(p.category_id);
          return `<div class="bcard" draggable="true" data-id="${p.id}">
            ${p.cover ? `<img src="${esc(p.cover)}" />` : ""}
            <p>${esc(postText(p)) || `<span class="muted">${L("No caption yet", "بلا نص بعد")}</span>`}</p>
            <div class="row small">${c ? `<span class="tag" style="background:${esc(c.color)}22;color:${esc(c.color)}">${esc(c.name)}</span>` : ""}${p.status !== "idea" ? `<span class="tag ${STATUS_TAG[p.status] ?? ""}">${esc(statusName(p.status))}</span>` : ""}${p.urgent ? `<span class="tag bad">${L("Urgent", "عاجل")}</span>` : ""}</div>
            <div class="row small muted"><span class="grow">${p.scheduled_at || p.published_at ? "◷ " + fmtWhen(p.published_at ?? p.scheduled_at) : p.due_on ? L("Due ", "موعده ") + fmtDate(p.due_on) : ""}</span>${p.photos ? `▦ ${num(p.photos)}` : ""}</div>
          </div>`;
        }).join("") || `<p class="muted small center">${L("Nothing here", "لا شيء هنا")}</p>`}</section>`;
    }).join("");
    $$(".bcard", box).forEach((el) => {
      el.onclick = () => openPost(el.dataset.id);
      el.ondragstart = (e) => e.dataTransfer.setData("text/post", el.dataset.id);
    });
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
  const m = modal(`<h2>${L("New post", "منشور جديد")}</h2>
    <div class="col gap8">
      <button class="btn" id="n-picks">✓ ${L("From my picks in the library", "من الصور المختارة في المكتبة")}</button>
      <button class="btn" id="n-event">▦ ${L("From an event (the app picks the best)", "من فعالية (يختار التطبيق الأفضل)")}</button>
      <button class="btn" id="n-text">✎ ${L("Text only (Facebook)", "نص فقط (فيسبوك)")}</button>
      <button class="btn" id="n-idea">✦ ${L("Just an idea for later", "مجرد فكرة لوقت لاحق")}</button>
    </div>`);
  $("#n-picks", m).onclick = () => go("library", { album: "picks" });
  $("#n-event", m).onclick = () => eventPicker();
  $("#n-idea", m).onclick = () => newIdea(day);
  $("#n-text", m).onclick = async () => {
    const r = await call("app", "create", { day });
    closeOverlay();
    openPost(r.id);
  };
}

// Pick an event; the Mac chooses its best photos and makes the post.
async function eventPicker() {
  const { rows } = await call("tree");
  const events = rows.filter((r) => r.event_key).slice(0, 60);
  const m = modal(`<h2>▦ ${L("From an event", "من فعالية")}</h2>
    ${events.length ? `<div class="col gap4" style="max-height: 340px; overflow-y: auto">${events.map((e, i) => `<button class="btn" data-i="${i}" style="justify-content: space-between"><span>${esc(e.event_title || e.event_key)}</span><span class="muted small">${esc(e.event_date ?? "")} · ${num(e.n)}</span></button>`).join("")}</div>` : `<p class="muted">${L("No events in the library yet.", "لا توجد فعاليات في المكتبة بعد.")}</p>`}
    <label class="field">${L("How many photos", "عدد الصور")}<select id="ep-n">${[4, 6, 8, 10].map((n) => `<option ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="row"><span class="grow"></span><button class="btn" id="ep-no">${L("Cancel", "إلغاء")}</button></div>`);
  $("#ep-no", m).onclick = closeOverlay;
  m.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = async () => {
      const e = events[Number(b.dataset.i)];
      const n = Number($("#ep-n", m).value);
      const list = await call("photos", { event: e.event_key });
      const ids = await call("best", list.map((p) => p.id), n);
      if (!ids.length) return toast(L("No usable photos in this event.", "لا توجد صور صالحة في هذه الفعالية."));
      modal(`<h2>✎ ${L("Making the post…", "جارٍ إنشاء المنشور…")}</h2><p class="muted">${L("Sending web copies of the photos. Originals stay on this Mac.", "تُرسل نسخ ويب من الصور، وتبقى الأصول على هذا الماك.")}</p>`, { sticky: true });
      try {
        const id = await call("newPost", ids);
        closeOverlay();
        openPost(id);
      } catch {
        closeOverlay();
      }
    };
  });
}

// The post editor: photos, both captions side by side with AI help, the
// live preview, checks and the next step.
async function openPost(id) {
  const back = h(`<div class="modalback"><div class="modal wide editor"><div class="muted">${L("Loading…", "جارٍ التحميل…")}</div></div></div>`);
  $("#overlay").replaceChildren(back);
  const box = back.querySelector(".modal");
  App.overlayKeys = (e, typing) => {
    if (e.key === "Escape") closeEditor();
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); act("save"); }
    if (!typing && e.key === "a" && canApprove()) act("approve");
  };
  const me = (App.me ??= await quiet("app", "me")) ?? {};
  let d = await quiet("app", "post", { id });
  if (!d || d.error) {
    box.innerHTML = `<div class="note bad">${L("Couldn't open the post.", "تعذّر فتح المنشور.")}</div>`;
    return;
  }
  let dirty = false;
  let view = "facebook";
  const role = me.role;
  const writer = ["admin", "comms_lead", "comms"].includes(role);
  const canApprove = () => {
    const s = d.post.status;
    if (s === "waiting_extra") return ["admin", "principal"].includes(role);
    return ["admin", "comms_lead"].includes(role) && ["draft", "in_review", "rejected"].includes(s);
  };
  function closeEditor() {
    if (dirty && !confirm(L("Leave without saving?", "الخروج بدون حفظ؟"))) return;
    closeOverlay();
    App.views[App.view]?.load?.();
  }

  function values() {
    return {
      caption_ar: $("#e-ar", box)?.value ?? d.post.caption_ar,
      caption_en: $("#e-en", box)?.value ?? d.post.caption_en,
      hashtags: $("#e-tags", box).value,
      first_comment: $("#e-first", box).value,
      category_id: $("#e-cat", box).value || null,
      platforms: $$("[data-plat]", box).filter((x) => x.checked).map((x) => x.dataset.plat),
      sensitive: $("#e-sens", box).checked,
      make_story: $("#e-story", box).checked,
      urgent: $("#e-urgent", box)?.checked ?? d.post.urgent,
      scheduled_at: $("#e-when", box).value ? new Date($("#e-when", box).value).toISOString() : null,
      idea: d.post.idea,
    };
  }

  async function act(intent, extra = {}) {
    const r = await quiet("app", "intent", { id, intent, values: writer ? values() : {}, ...extra });
    if (!r || r.error) return toast(r?.message ?? L("Couldn't do that. Try again.", "تعذّر ذلك. حاول مرة أخرى."));
    dirty = false;
    toast({ save: L("Saved", "تم الحفظ"), submit: L("Sent for approval", "أُرسل للاعتماد"), approve: L("Approved", "تم الاعتماد"), schedule: L("Scheduled", "تمت الجدولة"), queue: L("Added to the next free slot", "أُضيف إلى أقرب موعد"), publish: L("Publishing now", "جارٍ النشر"), reject: L("Sent back", "أُعيد"), delete: L("Deleted", "حُذف") }[intent] ?? L("Done", "تم"));
    if (intent === "delete") {
      closeOverlay();
      return App.views[App.view]?.load?.();
    }
    if (intent === "duplicate" && r.id) return openPost(r.id);
    d = await quiet("app", "post", { id });
    draw();
  }

  function preview() {
    const v = values();
    const text = [v.caption_ar, v.caption_en, v.hashtags].map((x) => (x ?? "").trim()).filter(Boolean).join("\n\n");
    const cut = view === "instagram" ? 125 : 480;
    const short = text.length > cut ? `${esc(text.slice(0, cut))}… <b class="muted">${L("more", "المزيد")}</b>` : esc(text);
    const cover = d.photos[0];
    const name = view === "facebook" ? d.account.page : d.account.ig ?? d.account.page;
    return `<div class="pv"><div class="pvh"><span class="logo">${esc((S.schoolName ?? "S").slice(0, 2))}</span><b>${esc(name)}</b></div>
      ${view === "facebook" && text ? `<p class="pvt">${short}</p>` : ""}
      ${cover?.thumb ? `<div class="pvi ${view}"><img src="${esc(cover.thumb)}" />${d.photos.length > 1 ? `<span class="pvn">1/${num(d.photos.length)}</span>` : ""}</div>` : view === "instagram" ? `<div class="pvi instagram empty">${L("Instagram needs a photo", "إنستجرام يحتاج صورة")}</div>` : ""}
      ${view === "instagram" ? `<p class="pvt"><b>${esc(name)}</b> ${short}</p>` : ""}
      <div class="pvf">♡ ${L("Like", "إعجاب")} · 💬 ${L("Comment", "تعليق")} · ↗ ${L("Share", "مشاركة")}</div></div>`;
  }

  function draw() {
    const p = d.post;
    const locked = ["publishing", "published"].includes(p.status);
    const ro = locked || !writer;
    const s = p.status;
    const local = p.scheduled_at ? new Date(new Date(p.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    box.innerHTML = `
      <div class="row nowrap"><h2 class="grow">${s === "idea" ? L("Idea", "فكرة") : L("Post", "منشور")} <span class="tag ${STATUS_TAG[s] ?? ""}">${esc(statusName(s))}</span></h2>
        <button class="btn small" id="e-web">${L("Open on the website", "افتح على الموقع")}</button><button class="btn small" id="e-close">✕</button></div>
      ${p.idea ? `<div class="note">${esc(p.idea)}</div>` : ""}
      ${s === "rejected" && p.review_note ? `<div class="note warn">${L("Changes asked", "طُلبت تعديلات")}: ${esc(p.review_note)}</div>` : ""}
      ${s === "failed" && p.publish_error ? `<div class="note bad">${esc(p.publish_error)}</div>` : ""}
      <div class="ed">
        <div class="col gap12">
          <div class="strip">${d.photos.map((x) => `<img src="${esc(x.thumb ?? "")}" title="${x.waiting ? L("Waiting for the Mac check", "بانتظار فحص الماك") : ""}" style="${x.waiting ? "outline: 2px solid var(--warn)" : ""}" />`).join("") || `<span class="muted small">${L("No photos (Facebook only).", "لا صور (فيسبوك فقط).")}</span>`}</div>
          <div class="grid2">
            <label class="field">${L("Arabic caption", "النص بالعربية")}<textarea id="e-ar" dir="rtl" rows="7" ${ro ? "disabled" : ""}>${esc(p.caption_ar ?? "")}</textarea>
              ${ro ? "" : `<span class="row small"><button class="link" data-ai="ar:translate">${L("Translate from English", "ترجم من الإنجليزية")}</button><button class="link" data-ai="ar:shorter">${L("Shorter", "أقصر")}</button><button class="link" data-ai="ar:warmer">${L("Warmer", "أدفأ")}</button></span>`}</label>
            <label class="field">${L("English caption", "النص بالإنجليزية")}<textarea id="e-en" dir="ltr" rows="7" ${ro ? "disabled" : ""}>${esc(p.caption_en ?? "")}</textarea>
              ${ro ? "" : `<span class="row small"><button class="link" data-ai="en:translate">${L("Translate from Arabic", "ترجم من العربية")}</button><button class="link" data-ai="en:shorter">${L("Shorter", "أقصر")}</button><button class="link" data-ai="en:warmer">${L("Warmer", "أدفأ")}</button></span>`}</label>
          </div>
          ${ro ? "" : `<div class="row"><input id="e-prompt" class="grow" placeholder="${L("Anything for the AI to mention?", "شيء تريد أن يذكره الذكاء الاصطناعي؟")}" /><button class="btn primary" id="e-gen">✦ ${p.caption_ar || p.caption_en ? L("Write new versions", "اكتب نسخاً جديدة") : L("Write captions", "اكتب النص")}</button></div>`}
          ${(p.variations ?? []).length > 1 ? `<div class="col gap4"><b class="small">${L("Other versions", "نسخ أخرى")}</b>${p.variations.map((v, i) => `<button class="vers" data-v="${i}">${esc((S.language === "en" ? v.en || v.ar : v.ar || v.en) ?? "")}</button>`).join("")}</div>` : ""}
          <label class="field">${L("Hashtags", "الوسوم")}<input id="e-tags" value="${esc(p.hashtags ?? "")}" ${ro ? "disabled" : ""} /></label>
          <label class="field">${L("First comment", "أول تعليق")}<input id="e-first" value="${esc(p.first_comment ?? "")}" ${ro ? "disabled" : ""} /></label>
          <div class="grid2">
            <label class="field">${L("Category", "التصنيف")}<select id="e-cat" ${ro ? "disabled" : ""}><option value="">${L("No category", "بدون تصنيف")}</option>${d.categories.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
            <label class="field">${L("Date and time", "التاريخ والوقت")}<input type="datetime-local" id="e-when" value="${local}" ${locked ? "disabled" : ""} /></label>
          </div>
          <div class="row">
            <label class="check"><input type="checkbox" data-plat="facebook" ${p.platforms.includes("facebook") ? "checked" : ""} ${ro ? "disabled" : ""} /> Facebook</label>
            <label class="check"><input type="checkbox" data-plat="instagram" ${p.platforms.includes("instagram") ? "checked" : ""} ${ro ? "disabled" : ""} /> Instagram</label>
            <label class="check"><input type="checkbox" id="e-story" ${p.make_story ? "checked" : ""} ${ro ? "disabled" : ""} /> ${L("Story too", "قصة أيضاً")}</label>
            <label class="check"><input type="checkbox" id="e-sens" ${p.sensitive ? "checked" : ""} ${ro ? "disabled" : ""} /> ${L("Sensitive", "حساس")}</label>
            ${["admin", "comms_lead"].includes(role) ? `<label class="check"><input type="checkbox" id="e-urgent" ${p.urgent ? "checked" : ""} ${ro ? "disabled" : ""} /> ${L("Urgent", "عاجل")}</label>` : ""}
          </div>
        </div>
        <div class="col gap12">
          <div class="row"><button class="pill ${view === "facebook" ? "on" : ""}" data-view="facebook">Facebook</button><button class="pill ${view === "instagram" ? "on" : ""}" data-view="instagram">Instagram</button></div>
          <div id="e-prev">${preview()}</div>
          <div class="card tight"><b class="small">${L("Checks", "الفحوص")}</b>${d.checks.length ? d.checks.map((c) => `<div class="small" style="color: var(--${c.level === "block" ? "bad" : "warn"})">⚠ ${esc(c.text)}</div>`).join("") : `<div class="small" style="color: var(--good)">✓ ${L("Everything looks fine.", "كل شيء يبدو جيداً.")}</div>`}</div>
          <div class="col gap4" id="e-actions"></div>
          <div class="card tight"><b class="small">${L("Comments", "التعليقات")}</b>${d.comments.map((c) => `<div class="small"><b>${esc(c.author_name ?? "")}</b> ${esc(c.body)}</div>`).join("") || `<span class="small muted">${L("No comments yet.", "لا تعليقات بعد.")}</span>`}
            <div class="row nowrap"><input id="e-comment" class="grow" placeholder="${L("Write a note, @name to tell someone", "اكتب ملاحظة، @الاسم لتنبيه شخص")}" /><button class="btn small" id="e-send">${L("Add", "أضف")}</button></div></div>
        </div>
      </div>`;

    const acts = [];
    const btn = (intent, label, cls = "") => acts.push(`<button class="btn ${cls}" data-act="${intent}">${label}</button>`);
    if (!locked) {
      if (writer) btn("save", `${L("Save", "حفظ")} <span class="k">⌘S</span>`);
      if (s === "idea" && writer) btn("start", L("Start writing this post", "ابدأ كتابة هذا المنشور"));
      if (writer && ["idea", "draft", "rejected"].includes(s)) btn("submit", L("Send for approval", "أرسل للاعتماد"), "primary");
      if (canApprove()) btn("approve", `✓ ${L("Approve", "اعتماد")} <span class="k">A</span>`, "primary");
      if ((canApprove() || ["approved", "failed"].includes(s)) && ["admin", "comms_lead", "principal"].includes(role) && !["idea"].includes(s)) {
        btn("schedule", L("Schedule", "جدولة"));
        btn("queue", L("Add to the next free slot", "أضف إلى أقرب موعد متاح"));
      }
      if (["admin", "comms_lead"].includes(role) && ["approved", "scheduled", "failed"].includes(s)) btn("publish", s === "failed" ? L("Try publishing again", "حاول النشر مجدداً") : L("Publish now", "انشر الآن"));
      if (s === "scheduled") btn("unschedule", L("Unschedule", "إلغاء الجدولة"));
      if (canApprove() && ["in_review", "waiting_extra"].includes(s)) btn("reject", L("Ask for changes", "اطلب تعديلات"), "ghost");
      if (writer) btn("delete", L("Delete", "حذف"), "danger");
    }
    if (writer) btn("duplicate", L("Duplicate", "نسخ"), "ghost");
    $("#e-actions", box).innerHTML = acts.join("");

    $("#e-close", box).onclick = closeEditor;
    $("#e-web", box).onclick = () => call("openWeb", `/posts/${id}`);
    $$("[data-act]", box).forEach((b) =>
      (b.onclick = async () => {
        const intent = b.dataset.act;
        if (intent === "delete" && !confirm(L("Delete this post?", "حذف هذا المنشور؟"))) return;
        if (intent === "reject") {
          const note = prompt(L("What should change?", "ما الذي يجب تغييره؟"));
          if (note === null) return;
          return act("reject", { reviewNote: note });
        }
        act(intent);
      }),
    );
    $$("[data-view]", box).forEach((b) => (b.onclick = () => { view = b.dataset.view; draw(); }));
    $$("textarea, input, select", box).forEach((el) =>
      el.addEventListener("input", () => {
        dirty = true;
        const pv = $("#e-prev", box);
        if (pv) pv.innerHTML = preview();
      }),
    );
    $$("[data-ai]", box).forEach((b) =>
      (b.onclick = async (e) => {
        e.preventDefault();
        const [lang, what] = b.dataset.ai.split(":");
        const field = $(lang === "ar" ? "#e-ar" : "#e-en", box);
        const other = $(lang === "ar" ? "#e-en" : "#e-ar", box);
        const payload = what === "translate" ? { text: other.value, to: lang } : { text: field.value, language: lang, instruction: what === "shorter" ? "make it shorter, about half the length" : "make it warmer and more personal for parents" };
        if (!payload.text.trim()) return;
        b.disabled = true;
        const r = await quiet("app", "rewrite", payload);
        b.disabled = false;
        if (r?.text) {
          field.value = r.text;
          dirty = true;
          $("#e-prev", box).innerHTML = preview();
        } else toast(L("The AI couldn't answer just now.", "لم يستجب الذكاء الاصطناعي الآن."));
      }),
    );
    $("#e-gen", box)?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = L("Writing…", "جارٍ الكتابة…");
      if (dirty) await quiet("app", "intent", { id, intent: "save", values: values() });
      const r = await quiet("app", "generate", { id, options: { count: 3, prompt: $("#e-prompt", box).value || null } });
      if (!r || r.error) toast(r?.error === "limit" ? L("The free AI limit was reached. Wait a minute.", "وصل الحد المجاني. انتظر دقيقة.") : L("The AI couldn't answer just now.", "لم يستجب الذكاء الاصطناعي الآن."));
      else if (r.demo) toast(L("Sample captions: add the AI key on the website for real ones.", "نصوص تجريبية: أضف مفتاح الذكاء الاصطناعي على الموقع."));
      d = await quiet("app", "post", { id });
      dirty = false;
      draw();
    });
    $$("[data-v]", box).forEach((b) =>
      (b.onclick = () => {
        const v = d.post.variations[Number(b.dataset.v)];
        if ($("#e-ar", box)) $("#e-ar", box).value = v.ar ?? "";
        if ($("#e-en", box)) $("#e-en", box).value = v.en ?? "";
        $("#e-tags", box).value = v.hashtags ?? "";
        dirty = true;
        $("#e-prev", box).innerHTML = preview();
      }),
    );
    $("#e-send", box).onclick = async () => {
      const body = $("#e-comment", box).value.trim();
      if (!body) return;
      await quiet("app", "comment", { id, body });
      d = await quiet("app", "post", { id });
      draw();
    };
  }
  draw();
}

// ---------- Calendar ----------
App.views.calendar = {
  render(main, params) {
    if (!S.signedIn) return needSignIn(main, L("Calendar", "التقويم"));
    this.view = params.view ?? this.view ?? "month";
    const today = new Date();
    this.anchor = this.anchor ?? new Date(today.getFullYear(), today.getMonth(), today.getDate());
    main.innerHTML =
      topbar(L("Calendar", "التقويم"), "",
        `<button class="btn" id="c-prev">‹</button><button class="btn" id="c-today">${L("Today", "اليوم")}</button><button class="btn" id="c-next">›</button>
         <button class="pill ${this.view === "month" ? "on" : ""}" data-cv="month">${L("Month", "شهر")}</button><button class="pill ${this.view === "week" ? "on" : ""}" data-cv="week">${L("Week", "أسبوع")}</button>`) +
      `<div class="content"><div id="cal" class="cal"><div class="muted">${L("Loading…", "جارٍ التحميل…")}</div></div></div>`;
    const shift = (n) => {
      const a = this.anchor;
      this.anchor = this.view === "week" ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1);
      this.load();
    };
    $("#c-prev", main).onclick = () => shift(-1);
    $("#c-next", main).onclick = () => shift(1);
    $("#c-today", main).onclick = () => { this.anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate()); this.load(); };
    $$("[data-cv]", main).forEach((b) => (b.onclick = () => go("calendar", { view: b.dataset.cv })));
    this.load();
  },
  range() {
    const a = this.anchor;
    const satStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 1) % 7));
    if (this.view === "week") {
      const s = satStart(a);
      return { start: s, days: 7 };
    }
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const s = satStart(first);
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: s, days: Math.ceil(((last - s) / 86400000 + 1) / 7) * 7 };
  },
  async load() {
    const { start, days } = this.range();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
    const sub = $(".topbar .title span") ?? null;
    const title = this.view === "week" ? `${fmtDate(key(start))} – ${fmtDate(key(end))}` : this.anchor.toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { month: "long", year: "numeric" });
    const tb = $(".topbar .title");
    if (tb) tb.innerHTML = `<b>${L("Calendar", "التقويم")}</b><span>${esc(title)}</span>`;
    void sub;
    const r = await quiet("app", "calendar", { from: key(start), to: key(end) });
    const box = $("#cal");
    if (!box) return;
    if (!r || r.error) {
      box.innerHTML = `<div class="note bad">${L("Couldn't load the calendar.", "تعذّر تحميل التقويم.")}</div>`;
      return;
    }
    const cat = new Map(r.categories.map((c) => [c.id, c]));
    const dayOf = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: r.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const timeOf = (iso) => new Intl.DateTimeFormat(S.language === "en" ? "en-GB" : "ar-EG", { timeZone: r.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    const todayKey = key(new Date());
    const heads = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 3 + i).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "short" }));
    const cells = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = key(d);
      const posts = r.posts.filter((p) => (p.published_at ?? p.scheduled_at ? dayOf(p.published_at ?? p.scheduled_at) === k : p.due_on === k));
      const used = new Set(posts.filter((p) => p.scheduled_at).map((p) => new Intl.DateTimeFormat("en-GB", { timeZone: r.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(p.scheduled_at))));
      const slots = r.slots.filter((s) => s.weekday === d.getDay() && !used.has(s.at_time.slice(0, 5)));
      const events = r.events.filter((e) => e.event_date === k || (e.ends_on && e.event_date <= k && e.ends_on >= k));
      const out = this.view === "month" && d.getMonth() !== this.anchor.getMonth();
      cells.push(`<div class="cday ${out ? "out" : ""} ${k === todayKey ? "today" : ""} ${this.view === "week" ? "tall" : ""}" data-day="${k}">
        <div class="row nowrap"><span class="dn">${d.getDate()}</span><span class="grow"></span>${k >= todayKey ? `<button class="link small" data-new="${k}">+</button>` : ""}</div>
        ${events.map((e) => `<div class="cev">${esc(e.title)}</div>`).join("")}
        ${posts.map((p) => {
          const c = cat.get(p.category_id);
          return `<div class="cpost" draggable="${!["published", "publishing"].includes(p.status)}" data-id="${p.id}" style="${c ? `border-inline-start: 3px solid ${esc(c.color)}` : ""}">
            ${p.cover ? `<img src="${esc(p.cover)}" />` : ""}<span class="sd ${STATUS_TAG[p.status] ?? ""}"></span><span class="grow">${p.scheduled_at || p.published_at ? `<b>${esc(timeOf(p.published_at ?? p.scheduled_at))}</b> ` : ""}${esc(postText(p) || statusName(p.status))}</span></div>`;
        }).join("")}
        ${k >= todayKey ? slots.map((s) => `<div class="cslot" data-new="${k}">${esc(s.at_time.slice(0, 5))} ${esc(cat.get(s.category_id)?.name ?? L("free slot", "موعد متاح"))}</div>`).join("") : ""}
      </div>`);
    }
    box.innerHTML = `<div class="chead">${heads.map((w) => `<div>${esc(w)}</div>`).join("")}</div><div class="cgrid">${cells.join("")}</div>`;
    $$(".cpost", box).forEach((el) => {
      el.onclick = () => openPost(el.dataset.id);
      el.ondragstart = (e) => e.dataTransfer.setData("text/post", el.dataset.id);
    });
    $$("[data-new]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); newPostMenu(el.dataset.new); }));
    $$(".cday", box).forEach((cell) => {
      cell.ondragover = (e) => { if (cell.dataset.day >= todayKey) { e.preventDefault(); cell.classList.add("over"); } };
      cell.ondragleave = () => cell.classList.remove("over");
      cell.ondrop = async (e) => {
        cell.classList.remove("over");
        const id = e.dataTransfer.getData("text/post");
        if (!id) return;
        await quiet("app", "move", { id, day: cell.dataset.day });
        this.load();
      };
    });
  },
};
