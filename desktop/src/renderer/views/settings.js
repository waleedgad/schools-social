// Settings, Duplicates and History.
App.views.settings = {
  render(main) {
    main.innerHTML = topbar(L("Settings", "الإعدادات"), L(`Version ${S.version}`, `الإصدار ${S.version}`)) + `<div class="content"><div class="col gap16" style="max-width: 860px" id="set"></div></div>`;
    this.fill();
  },
  onState(changed) {
    if (!$(".modalback") && !document.activeElement?.matches("input, select")) this.fill();
  },
  fill() {
    const box = $("#set");
    if (!box) return;
    const account = !S.connected
      ? `<p class="muted">${L("Connect to your School Social Hub website.", "اتصل بموقع School Social Hub.")}</p><div class="row"><input id="srv" value="${esc(S.server)}" class="grow ltr" /><button class="btn primary" id="connect">${L("Connect", "اتصال")}</button></div>`
      : !S.signedIn
        ? `<p class="muted">${L("Sign in with the account you use on the website.", "سجّل الدخول بالحساب الذي تستخدمه على الموقع.")}</p>
          <div class="grid2"><label class="field">${L("Email", "البريد الإلكتروني")}<input type="email" id="em" value="${esc(S.email ?? "")}" class="ltr" /></label><label class="field">${L("Password", "كلمة المرور")}<input type="password" id="pw" /></label></div>
          <div class="row"><button class="btn primary" id="signin">${L("Sign in", "دخول")}</button><span class="muted small ltr">${esc(S.server)}</span></div>
          <p class="muted small">${L("You can also use the library without signing in. Posts need the website.", "يمكنك استخدام المكتبة دون تسجيل الدخول. المنشورات تحتاج الموقع.")}</p>`
        : `<div class="row"><span class="grow">${L("Signed in as", "مسجّل باسم")} <b class="ltr">${esc(S.email)}</b> · ${esc(S.schoolName)} <span class="tag">${esc(S.role)}</span></span><button class="btn small" id="web">${L("Open website", "فتح الموقع")}</button><button class="btn small" id="signout">${L("Sign out", "خروج")}</button></div>`;
    const folders = S.folders ?? [];
    box.innerHTML = `
      <div class="card"><h2>${L("Account", "الحساب")}</h2>${account}</div>
      <div class="card"><h2>${L("Photo library", "مكتبة الصور")}</h2>
        <p class="muted small">${L("The folder or drive where the school keeps its photos. Originals always stay here. Layout: Year / Term / Date Event / Class.", "المجلد أو القرص الذي تحفظ فيه المدرسة صورها. تبقى الأصول هنا دائمًا. الترتيب: السنة / الفصل الدراسي / التاريخ الفعالية / الفصل.")}</p>
        <div class="row">${S.library ? `<span class="grow ltr">${esc(S.library)}</span>` : `<span class="grow tag bad">${L("Not chosen yet", "لم يُختر بعد")}</span>`}<button class="btn ${S.library ? "" : "primary"}" id="lib">${S.library ? L("Change", "تغيير") : L("Choose folder", "اختيار مجلد")}</button>${S.library ? `<button class="btn" id="rescan">↻ ${L("Look again", "إعادة الفحص")}</button>` : ""}</div>
        ${S.libraryMissing ? `<div class="note warn">${L("The library drive isn't connected.", "قرص المكتبة غير موصول.")}</div>` : ""}
        <label class="check"><input type="checkbox" id="paused" ${S.paused ? "checked" : ""} /> ${L("Pause (stop reading photos, finding faces and sending)", "إيقاف مؤقت (إيقاف قراءة الصور والبحث عن الوجوه والإرسال)")}</label>
        <h3>${L("Sending to the website", "الإرسال إلى الموقع")}</h3>
        <label class="check"><input type="radio" name="send" value="picked" ${S.sendMode === "picked" ? "checked" : ""} /> ${L("Only photos I pick (P) or put in a post. Saves website space.", "فقط الصور التي أختارها (P) أو أضعها في منشور. يوفر مساحة الموقع.")}</label>
        <label class="check"><input type="radio" name="send" value="all" ${S.sendMode === "all" ? "checked" : ""} /> ${L("Every new photo (teachers and the principal see everything on the website)", "كل صورة جديدة (يرى المعلمون والمدير كل شيء على الموقع)")}</label>
        <p class="muted small">${L("Only small web copies are sent. Location data is removed.", "تُرسل نسخ ويب صغيرة فقط، ويُحذف الموقع الجغرافي.")} ${S.queue.pending ? L(`${num(S.queue.pending)} waiting to send.`, `${num(S.queue.pending)} في انتظار الإرسال.`) : ""} ${S.queue.failed ? `<button class="link" id="retry">${L(`Retry ${S.queue.failed} failed`, `إعادة محاولة ${num(S.queue.failed)} فشلت`)}</button>` : ""}</p>
        <h3>${L("Folders", "المجلدات")}</h3>
        ${folders.length ? folders.map((f) => `<div class="row small"><span class="grow ltr">${esc(f.path)}</span>${f.skip ? `<span class="tag">${L("Skipped", "متجاهَل")}</span>` : ""}${f.archive ? `<span class="tag info">${L("Mac only", "على الماك فقط")}</span>` : ""}<button class="btn small" data-unflag="${esc(f.path)}">${L("Remove", "إزالة")}</button></div>`).join("") : `<p class="muted small">${L("Skip folders the app should ignore (for example staff photos), or mark old archives as Mac only.", "تجاهل مجلدات (مثل صور الموظفين)، أو اجعل الأرشيف القديم على الماك فقط.")}</p>`}
        <div class="row"><button class="btn small" id="skip">+ ${L("Skip a folder", "تجاهل مجلد")}</button><button class="btn small" id="arch">+ ${L("Mark a folder as Mac only", "مجلد على الماك فقط")}</button></div>
      </div>
      <div class="card"><h2>${L("Watched folders", "المجلدات المراقَبة")}</h2>
        <p class="muted small">${L("New photos that appear in these folders (Google Drive, OneDrive, Dropbox, Lightroom exports, AirDrop) are copied into the library by themselves.", "الصور الجديدة في هذه المجلدات (Google Drive وOneDrive وDropbox وصادرات Lightroom وAirDrop) تُنسخ إلى المكتبة تلقائيًا.")}</p>
        ${S.watched.map((w) => `<div class="row small"><span class="grow ltr">${esc(w.path)}</span><button class="btn small" data-unwatch="${esc(w.path)}">${L("Stop", "إيقاف")}</button></div>`).join("")}
        <button class="btn small" id="watch" style="align-self: flex-start">+ ${L("Add a watched folder", "إضافة مجلد مراقَب")}</button></div>
      <div class="card"><h2>${L("Backup", "النسخ الاحتياطي")}</h2>
        <p class="muted small">${L("A second copy of every new original on another drive.", "نسخة ثانية من كل صورة أصلية جديدة على قرص آخر.")}</p>
        <div class="row">${S.backup ? `<span class="grow ltr">${esc(S.backup)}</span>${S.backupDisk ? `<span class="small muted">${fmtBytes(S.backupDisk.free)} ${L("free", "متاح")}</span>` : `<span class="tag bad">${L("Drive not connected", "القرص غير موصول")}</span>`}<button class="btn small" id="bk">${L("Change", "تغيير")}</button><button class="btn small" id="bkoff">${L("Turn off", "إيقاف")}</button>` : `<span class="grow muted">${L("Off", "متوقف")}</span><button class="btn small" id="bk">${L("Choose backup drive", "اختيار قرص النسخ")}</button>`}</div></div>
      <div class="card"><h2>${L("Faces", "الوجوه")}</h2>
        <label class="check"><input type="checkbox" id="faces" ${S.faces ? "checked" : ""} /> ${L("Find faces and suggest names (on this Mac only, nothing is sent)", "البحث عن الوجوه واقتراح الأسماء (على هذا الماك فقط، لا يُرسل شيء)")}</label>
        <button class="btn small" id="refaces" style="align-self: flex-start">↻ ${L("Look again at photos that failed", "إعادة فحص الصور التي فشلت")}</button></div>
      <div class="card"><h2>${L("Editing app", "تطبيق التعديل")}</h2>
        <p class="muted small">${L("Photos open here when you choose “Edit in app”. Save the edit next to the original with “-edit” in the name and the app links the two.", "تُفتح الصور فيه عند «تعديل في تطبيق». احفظ التعديل بجانب الأصل مع «-edit» في الاسم وسيربطهما التطبيق.")}</p>
        <div class="row">${S.editor ? `<span class="grow ltr">${esc(S.editor.split("/").pop())}</span><button class="btn small" id="noeditor">${L("Use the Mac's default", "استخدام الافتراضي")}</button>` : `<span class="grow muted">${L("The Mac's default app (Preview or Photos)", "التطبيق الافتراضي (Preview أو Photos)")}</span>`}<button class="btn small" id="editor">${L("Choose app", "اختيار تطبيق")}</button></div></div>
      <div class="card"><h2>${L("Look and comfort", "الشكل والراحة")}</h2>
        <div class="grid3">
          <label class="field">${L("Language", "اللغة")}<select id="lang"><option value="ar" ${S.language === "ar" ? "selected" : ""}>العربية</option><option value="en" ${S.language === "en" ? "selected" : ""}>English</option></select></label>
          <label class="field">${L("Text size", "حجم النص")}<select id="size"><option value="normal">${L("Normal", "عادي")}</option><option value="large" ${S.textSize === "large" ? "selected" : ""}>${L("Large", "كبير")}</option></select></label>
          <label class="field">${L("Theme", "المظهر")}<select id="theme"><option value="system">${L("Like the Mac", "مثل الماك")}</option><option value="light" ${S.theme === "light" ? "selected" : ""}>${L("Light", "فاتح")}</option><option value="dark" ${S.theme === "dark" ? "selected" : ""}>${L("Dark", "داكن")}</option></select></label>
        </div>
        <div class="row"><span>${L("School colour", "لون المدرسة")}</span><input type="color" id="accent" value="${esc(S.accent)}" /><button class="link small" id="accent0">${L("Reset", "إعادة")}</button></div></div>
      <div class="card"><h2>${L("Alerts", "التنبيهات")}</h2>
        <label class="check"><input type="checkbox" id="alerts" ${S.alerts ? "checked" : ""} /> ${L("Show Mac notifications (new photos from watched folders, imports finished)", "إظهار إشعارات الماك (صور جديدة من المجلدات المراقَبة، انتهاء الاستيراد)")}</label>
        <div class="row">${L("Quiet hours", "ساعات الهدوء")} <input type="time" id="qf" value="${esc(S.quietFrom)}" /> → <input type="time" id="qt" value="${esc(S.quietTo)}" /></div></div>
      <div class="card"><h2>${L("This Mac", "هذا الماك")}</h2>
        <label class="check"><input type="checkbox" id="login" ${S.openAtLogin ? "checked" : ""} /> ${L("Start with the Mac (keeps the library up to date from the menu bar)", "التشغيل مع الماك (يحدّث المكتبة من شريط القوائم)")}</label>
        <div class="row"><button class="btn small" id="report">${L("Report a problem", "الإبلاغ عن مشكلة")}</button><span class="muted small">${L(`Version ${S.version}`, `الإصدار ${S.version}`)}</span></div></div>`;
    const on = (id, ev, fn) => $(id, box)?.addEventListener(ev, fn);
    on("#connect", "click", () => call("connect", $("#srv", box).value).then(() => toast(L("Connected", "تم الاتصال"))));
    on("#signin", "click", () => call("signIn", $("#em", box).value.trim(), $("#pw", box).value).then(() => toast(L("Signed in", "تم تسجيل الدخول"))));
    on("#pw", "keydown", (e) => e.key === "Enter" && $("#signin", box).click());
    on("#signout", "click", () => call("signOut"));
    on("#web", "click", () => call("openWeb", ""));
    on("#lib", "click", () => call("chooseLibrary"));
    on("#rescan", "click", () => call("rescan").then(() => toast(L("Looking through the library again", "جارٍ إعادة فحص المكتبة"))));
    on("#paused", "change", (e) => call("set", "paused", e.target.checked));
    $$("[name=send]", box).forEach((r) => r.addEventListener("change", (e) => call("set", "sendMode", e.target.value)));
    on("#retry", "click", () => call("retryFailed"));
    on("#skip", "click", async () => { const d = await call("chooseFolderToFlag"); if (d) call("folderFlag", d, "skip", true); });
    on("#arch", "click", async () => { const d = await call("chooseFolderToFlag"); if (d) call("folderFlag", d, "archive", true); });
    $$("[data-unflag]", box).forEach((b) => (b.onclick = async () => { await call("folderFlag", b.dataset.unflag, "skip", false); await call("folderFlag", b.dataset.unflag, "archive", false); }));
    on("#watch", "click", () => call("addWatched"));
    $$("[data-unwatch]", box).forEach((b) => (b.onclick = () => call("removeWatched", b.dataset.unwatch)));
    on("#bk", "click", () => call("chooseBackup"));
    on("#bkoff", "click", () => call("clearBackup"));
    on("#faces", "change", (e) => call("set", "faces", e.target.checked));
    on("#refaces", "click", () => call("rescanFaces").then(() => toast(L("Looking again", "جارٍ إعادة الفحص"))));
    on("#editor", "click", () => call("chooseEditor"));
    on("#noeditor", "click", () => call("clearEditor"));
    on("#lang", "change", (e) => call("set", "language", e.target.value));
    on("#size", "change", (e) => call("set", "textSize", e.target.value));
    on("#theme", "change", (e) => call("set", "theme", e.target.value));
    on("#accent", "change", (e) => call("set", "accent", e.target.value));
    on("#accent0", "click", () => call("set", "accent", "#2f6fdf"));
    on("#alerts", "change", (e) => call("set", "alerts", e.target.checked));
    on("#qf", "change", (e) => call("set", "quietFrom", e.target.value));
    on("#qt", "change", (e) => call("set", "quietTo", e.target.value));
    on("#login", "change", (e) => call("set", "openAtLogin", e.target.checked));
    on("#report", "click", reportProblem);
  },
};

function reportProblem() {
  const m = modal(`<h2>${L("Report a problem", "الإبلاغ عن مشكلة")}</h2><p class="muted small">${L("Say what you were doing and what went wrong. Your email app opens with the details filled in.", "اكتب ما كنت تفعله وما الخطأ. سيفتح تطبيق البريد بالتفاصيل.")}</p><textarea rows="5" id="rp"></textarea>
    <div class="row"><span class="grow"></span><button class="btn" id="rp-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="rp-yes">${L("Continue in Mail", "المتابعة في البريد")}</button></div>`);
  $("#rp-no", m).onclick = closeOverlay;
  $("#rp-yes", m).onclick = () => {
    call("reportProblem", `${$("#rp", m).value}\n\nLast message: ${S.message ?? ""}`);
    closeOverlay();
  };
}

// Notifications, outside quiet hours.
let lastNotice = "";
function quietNow() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = (S.quietFrom || "21:00").split(":").map(Number);
  const [th, tm] = (S.quietTo || "07:00").split(":").map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  return from < to ? m >= from && m < to : m >= from || m < to;
}
window.hub.onState((s) => {
  if (!s.alerts || s.message === lastNotice) return;
  const w = /^watched:(.+)$/.exec(s.message ?? "");
  lastNotice = s.message;
  if (w && !quietNow()) new Notification("School Social Hub", { body: L(`New photos from ${w[1]} are in the library`, `صور جديدة من ${w[1]} في المكتبة`) });
});

App.views.duplicates = {
  async render(main) {
    const rows = (await quiet("duplicates")) ?? [];
    const size = rows.reduce((s, r) => s + r.size, 0);
    main.innerHTML = topbar(L("Duplicates", "المكررات"), rows.length ? L(`${rows.length} extra copies · ${fmtBytes(size)}`, `${num(rows.length)} نسخة زائدة · ${fmtBytes(size)}`) : "",
      rows.length ? `<button class="btn primary" id="dp-all">${L("Move all extra copies to the Bin", "نقل كل النسخ الزائدة إلى السلة")}</button>` : "") +
      `<div class="content">${rows.length ? `<p class="muted" style="margin-bottom: 12px">${L("These files are exact copies of a photo that is already in the library. The first copy is kept with all its tags.", "هذه الملفات نسخ مطابقة لصورة موجودة في المكتبة. تُحفظ النسخة الأولى بكل أسمائها.")}</p>
        <table class="list"><thead><tr><th></th><th>${L("Extra copy", "النسخة الزائدة")}</th><th>${L("Kept", "المحفوظة")}</th><th></th></tr></thead><tbody>
        ${rows.slice(0, 500).map((r) => `<tr><td style="width: 60px"><img src="hub://thumb/${r.dup_of}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px" /></td><td class="small ltr">${esc(r.path)}</td><td class="small muted ltr">${esc(r.original)}</td><td><button class="btn small" data-bin="${r.id}">${L("Bin", "السلة")}</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty"><span class="big">✓</span><b>${L("No duplicates", "لا توجد مكررات")}</b><span>${L("The same photo copied twice shows up here.", "تظهر هنا الصورة المنسوخة مرتين.")}</span></div>`}</div>`;
    $("#dp-all", main)?.addEventListener("click", async () => {
      const n = await call("bin", rows.map((r) => r.id));
      toast(L(`${n} copies moved to the Bin`, `نُقلت ${num(n)} نسخة إلى السلة`));
      go("duplicates");
    });
    $$("[data-bin]", main).forEach((b) => (b.onclick = async () => { await call("bin", [Number(b.dataset.bin)]); b.closest("tr").remove(); }));
  },
};

const ACTIONS = () => ({
  rating: L("Rated", "تقييم"), flag: L("Picked / rejected", "اختيار / رفض"), label: L("Label", "تصنيف"), tag: L("Named faces", "تسمية وجوه"), untag: L("Removed names", "إزالة أسماء"),
  hide: L("Not faces", "ليست وجوهًا"), move: L("Moved photos", "نقل صور"), import: L("Imported", "استيراد"), bin: L("Moved to Bin", "نقل إلى السلة"), post: L("New post", "منشور جديد"), canPost: L("In posts changed", "تغيير الظهور في المنشورات"),
});
App.views.history = {
  async render(main) {
    const rows = (await quiet("history")) ?? [];
    main.innerHTML = topbar(L("History", "السجل"), L("Everything changed on this Mac. ⌘Z undoes the last one.", "كل ما تغيّر على هذا الماك. ⌘Z يتراجع عن الأخير."), `<button class="btn" id="h-undo">↺ ${L("Undo last", "تراجع عن الأخير")}</button>`) +
      `<div class="content">${rows.length ? `<table class="list"><tbody>${rows.map((r) => `<tr><td class="muted small" style="width: 170px">${new Date(r.at).toLocaleString(S.language === "en" ? "en-GB" : "ar-EG")}</td><td><b>${esc(ACTIONS()[r.action] ?? r.action)}</b></td><td class="muted small">${esc(r.detail)}</td><td>${r.can_undo ? `<span class="tag">${L("can undo", "يمكن التراجع")}</span>` : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="empty"><span class="big">↺</span><b>${L("Nothing yet", "لا شيء بعد")}</b></div>`}</div>`;
    $("#h-undo", main).onclick = async () => { await doUndo(); go("history"); };
  },
};
