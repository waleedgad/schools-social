// Today: what needs doing, the set-up checklist, and the week ahead.
App.views.today = {
  render(main) {
    const hour = new Date().getHours();
    const hello = hour < 12 ? L("Good morning", "صباح الخير") : L("Good afternoon", "مساء الخير");
    main.innerHTML =
      topbar(hello, new Date().toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "long", day: "numeric", month: "long" }),
        `<button class="btn" id="imp">⤓ ${L("Import photos", "استيراد صور")}</button><button class="btn primary" id="post">✎ ${L("New post", "منشور جديد")}</button>`) +
      `<div class="content"><div class="col gap16" id="today"></div></div>`;
    $("#imp", main).onclick = () => go("import");
    $("#post", main).onclick = () => go("library", { album: "picks" });
    this.fill();
  },
  onState(changed) {
    if (changed.some((c) => c === "photos" || c === "faces" || c === "students" || c === "all")) this.fill();
  },
  async fill() {
    const box = $("#today");
    if (!box) return;
    const c = S.counts;
    const server = S.signedIn ? await quiet("serverSummary") : null;
    if (!$("#today")) return;
    const steps = [
      { done: S.signedIn, en: "Sign in to your school", ar: "سجّل الدخول إلى مدرستك", go: "settings" },
      { done: !!S.library, en: "Choose the photo library folder", ar: "اختر مجلد مكتبة الصور", go: "settings" },
      { done: c.students > 0, en: "Import the class lists", ar: "استورد قوائم الفصول", go: "students", params: { import: true } },
      { done: c.photos > 0, en: "Import or add photos", ar: "استورد أو أضف صورًا", go: "import" },
      { done: c.tagged >= 10, en: "Name 10 faces so the app learns the students", ar: "سمِّ 10 وجوه ليتعرف التطبيق على الطلاب", go: "faces" },
      { done: !!server?.facebook || !!server?.instagram, en: "Connect Facebook and Instagram (website settings)", ar: "اربط فيسبوك وإنستجرام (إعدادات الموقع)", web: "/settings" },
      { done: c.picks > 0, en: "Pick your best photos (press P)", ar: "اختر أفضل الصور (اضغط P)", go: "library" },
    ];
    const left = steps.filter((s) => !s.done).length;
    const todo = [];
    if (c.suggested) todo.push(`<div class="row nowrap"><span class="tag warn">☺ ${num(c.suggested)}</span><span class="grow">${L("faces the app thinks it knows: confirm them", "وجوه يعتقد التطبيق أنه يعرفها: أكّدها")}</span><button class="btn small" data-go="faces">${L("Review", "مراجعة")}</button></div>`);
    if (c.unknown) todo.push(`<div class="row nowrap"><span class="tag">? ${num(c.unknown)}</span><span class="grow">${L("faces without a name yet", "وجوه بلا اسم بعد")}</span><button class="btn small" data-go="faces" data-tab="unknown">${L("Name them", "سمّها")}</button></div>`);
    if (c.duplicates) todo.push(`<div class="row nowrap"><span class="tag">⧉ ${num(c.duplicates)}</span><span class="grow">${L("duplicate copies taking space", "نسخ مكررة تشغل مساحة")}</span><button class="btn small" data-go="cleanup">${L("Clean up", "تنظيف")}</button></div>`);
    if (server?.review) todo.push(`<div class="row nowrap"><span class="tag warn">${num(server.review)}</span><span class="grow">${L("posts waiting for approval", "منشورات تنتظر الموافقة")}</span><button class="btn small" data-go="posts">${L("Open", "فتح")}</button></div>`);
    if (server?.failed) todo.push(`<div class="row nowrap"><span class="tag bad">${num(server.failed)}</span><span class="grow">${L("posts failed to publish", "منشورات فشل نشرها")}</span><button class="btn small" data-go="posts">${L("Fix", "إصلاح")}</button></div>`);
    if (S.queue.failed) todo.push(`<div class="row nowrap"><span class="tag bad">${num(S.queue.failed)}</span><span class="grow">${L("photos couldn't be sent to the website", "صور تعذّر إرسالها إلى الموقع")}</span><button class="btn small" id="retry">${L("Try again", "إعادة المحاولة")}</button></div>`);
    const disk = S.disk;
    const lowDisk = disk && disk.free / disk.total < 0.1;

    box.innerHTML = `
      ${left ? `<div class="card"><div class="row"><h2 class="grow">${L("Set up", "الإعداد")}</h2><span class="muted small">${L(`${steps.length - left} of ${steps.length} done`, `تم ${num(steps.length - left)} من ${num(steps.length)}`)}</span></div>
        <div class="bar"><i style="width: ${((steps.length - left) / steps.length) * 100}%"></i></div>
        <div class="steps">${steps.map((s, i) => `<div class="s ${s.done ? "done" : ""}"><span class="ck">${s.done ? "✓" : i + 1}</span><span class="lab grow">${L(s.en, s.ar)}</span>${s.done ? "" : `<button class="btn small" data-step="${i}">${L("Start", "ابدأ")}</button>`}</div>`).join("")}</div></div>` : ""}
      <div class="grid4">
        <div class="card stat"><b>${num(c.photos)}</b><span>${L("photos in the library", "صورة في المكتبة")}</span></div>
        <div class="card stat"><b>${num(c.newPhotos)}</b><span>${L("added this week", "أضيفت هذا الأسبوع")}</span></div>
        <div class="card stat"><b>${num(c.students)}</b><span>${L("students", "طالب")}</span></div>
        <div class="card stat"><b>${num(c.picks)}</b><span>${L("picks ready for posts", "صورة مختارة للمنشورات")}</span></div>
      </div>
      <div class="grid2">
        <div class="card"><h2>${L("Needs you", "يحتاجك")}</h2>${todo.length ? todo.join("") : `<p class="muted">${L("Nothing waiting. Nice.", "لا شيء ينتظر. رائع.")}</p>`}</div>
        <div class="card"><h2>${L("Posts", "المنشورات")}</h2>
          ${server ? `<div class="row"><span class="tag">${L("Drafts", "مسودات")} ${num(server.drafts)}</span><span class="tag warn">${L("In review", "قيد المراجعة")} ${num(server.review)}</span><span class="tag info">${L("Scheduled", "مجدولة")} ${num(server.scheduled)}</span></div>
            ${server.upcoming.map((p) => `<div class="row nowrap small"><span class="tag ${p.status === "scheduled" ? "info" : p.status === "approved" ? "good" : "warn"}">${esc(statusName(p.status))}</span><span class="grow" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${esc((S.language === "en" ? p.caption_en || p.caption_ar : p.caption_ar || p.caption_en) || L("No caption yet", "بلا تعليق بعد"))}</span><span class="muted">${p.scheduled_at ? fmtDate(p.scheduled_at) : ""}</span></div>`).join("")}`
            : `<p class="muted">${L("Sign in to see your posts here.", "سجّل الدخول لترى منشوراتك هنا.")}</p>`}
          <div class="row"><button class="btn small" data-go="posts">${L("Open posts", "فتح المنشورات")}</button><button class="btn small" data-go="calendar">${L("Calendar", "التقويم")}</button></div>
        </div>
      </div>
      <div class="card"><h2>${L("This Mac", "هذا الماك")}</h2>
        <div class="row small">${S.library ? `<span>${L("Library", "المكتبة")}: <span class="ltr">${esc(S.library)}</span></span>` : `<span class="tag bad">${L("No library folder chosen", "لم يُختر مجلد المكتبة")}</span>`}</div>
        ${disk ? `<div class="row small"><span class="grow">${L("Space left on the library drive", "المساحة المتبقية على قرص المكتبة")}: <b>${fmtBytes(disk.free)}</b> ${L("of", "من")} ${fmtBytes(disk.total)}</span>${lowDisk ? `<span class="tag bad">${L("Almost full", "شبه ممتلئ")}</span>` : `<span class="tag good">${L("OK", "جيد")}</span>`}</div><div class="bar"><i style="width: ${(1 - disk.free / disk.total) * 100}%; ${lowDisk ? "background: var(--bad)" : ""}"></i></div>` : ""}
        <div class="row small">${S.backup ? `<span class="tag good">${L("Backup on", "النسخ الاحتياطي يعمل")}</span><span class="muted">${S.lastBackup ? L("last copy", "آخر نسخة") + " " + fmtDate(new Date(S.lastBackup).toISOString()) : ""}</span>` : `<span class="tag warn">${L("No backup drive", "لا يوجد قرص نسخ احتياطي")}</span><button class="link small" data-go="settings">${L("Set one up", "اضبطه")}</button>`}</div>
      </div>`;
    $$("[data-go]", box).forEach((b) => (b.onclick = () => go(b.dataset.go, b.dataset.tab ? { tab: b.dataset.tab } : {})));
    $$("[data-step]", box).forEach((b) => {
      const s = steps[Number(b.dataset.step)];
      b.onclick = () => (s.web ? call("openWeb", s.web) : go(s.go, s.params ?? {}));
    });
    $("#retry", box)?.addEventListener("click", () => call("retryFailed"));
  },
};

