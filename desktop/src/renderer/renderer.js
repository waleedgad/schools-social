// Plain script: the window talks to the app only through window.hub.
const T = {
  en: {
    app: "School Social Hub · Library", lang: "العربية",
    connectTitle: "Connect to your School Social Hub", server: "App address", serverHint: "For example schools-social.vercel.app",
    connect: "Connect", notHub: "Couldn't reach a School Social Hub app at that address. Check it and your internet.",
    signInTitle: "Sign in", email: "Email", password: "Password", signIn: "Sign in",
    badLogin: "Email or password is incorrect.", noSchool: "This account isn't part of a school yet. Set the school up on the website first.",
    signedInAs: "Signed in as {email} at {school}", signOut: "Sign out", openWeb: "Open the website",
    libraryTitle: "Photo library folder", libraryHint: "Choose the folder (or drive) where the school keeps its photos. Originals stay here; only small web copies are sent.",
    choose: "Choose folder", change: "Change", noLibrary: "No folder chosen yet.",
    rules: "Each event is a folder, like 2026-2027 / Term 1 / 2026-10-20 Science fair. New photos in any folder are sent automatically.",
    statusTitle: "Sending", waiting: "waiting", sent: "sent", failed: "need attention", retry: "Try them again", now: "Now sending: {files}",
    offline: "Last problem: {error}. It will try again by itself.", noInternet: "no internet connection",
    importTitle: "Import photos", importHint: "Copy photos from a memory card or a photographer's folder into the library, filed by year, term and event.",
    eventName: "Event name", date: "Date", importBtn: "Choose photos and import", imported: "{n} photos copied into the library.",
    backupTitle: "Backup", backupHint: "Keep a second copy of every original on another drive.", backupOff: "Backup is off.", backupOn: "Backing up to:", stop: "Turn off",
    startup: "Start with the computer", version: "Version {v}",
    error: "Something went wrong. Try again.", noLibraryFirst: "Choose the library folder first.",
  },
  ar: {
    app: "School Social Hub · المكتبة", lang: "English",
    connectTitle: "اتصل بتطبيق School Social Hub", server: "عنوان التطبيق", serverHint: "مثال: schools-social.vercel.app",
    connect: "اتصال", notHub: "تعذّر الوصول إلى تطبيق School Social Hub على هذا العنوان. تحقق منه ومن الإنترنت.",
    signInTitle: "تسجيل الدخول", email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "دخول",
    badLogin: "البريد الإلكتروني أو كلمة المرور غير صحيحة.", noSchool: "هذا الحساب غير مرتبط بمدرسة بعد. أنشئ المدرسة على الموقع أولًا.",
    signedInAs: "مسجل باسم {email} في {school}", signOut: "تسجيل الخروج", openWeb: "فتح الموقع",
    libraryTitle: "مجلد مكتبة الصور", libraryHint: "اختر المجلد (أو القرص) الذي تحفظ فيه المدرسة صورها. تبقى الأصول هنا، وتُرسل نسخ صغيرة للويب فقط.",
    choose: "اختيار مجلد", change: "تغيير", noLibrary: "لم يُختر مجلد بعد.",
    rules: "كل فعالية مجلد، مثل 2026-2027 / Term 1 / 2026-10-20 معرض العلوم. أي صور جديدة في أي مجلد تُرسل تلقائيًا.",
    statusTitle: "الإرسال", waiting: "في الانتظار", sent: "تم إرسالها", failed: "تحتاج مراجعة", retry: "إعادة المحاولة", now: "يُرسل الآن: {files}",
    offline: "آخر مشكلة: {error}. ستتم إعادة المحاولة تلقائيًا.", noInternet: "لا يوجد اتصال بالإنترنت",
    importTitle: "استيراد صور", importHint: "انسخ الصور من كارت الذاكرة أو مجلد المصوّر إلى المكتبة، مرتبة حسب السنة والفصل الدراسي والفعالية.",
    eventName: "اسم الفعالية", date: "التاريخ", importBtn: "اختر الصور واستوردها", imported: "تم نسخ {n} صورة إلى المكتبة.",
    backupTitle: "النسخ الاحتياطي", backupHint: "احتفظ بنسخة ثانية من كل صورة أصلية على قرص آخر.", backupOff: "النسخ الاحتياطي متوقف.", backupOn: "يتم النسخ إلى:", stop: "إيقاف",
    startup: "التشغيل مع بدء الكمبيوتر", version: "الإصدار {v}",
    error: "حدث خطأ. حاول مرة أخرى.", noLibraryFirst: "اختر مجلد المكتبة أولًا.",
  },
};
const ERRORS = { "not-hub": "notHub", "bad-login": "badLogin", "no-school": "noSchool", "no-library": "noLibraryFirst" };

let state = null;
let notice = "";
const $ = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (key, vars = {}) => (T[state?.language ?? "ar"][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => esc(vars[k]));

async function call(channel, ...args) {
  const r = await window.hub.call(channel, ...args);
  notice = r.ok ? "" : t(ERRORS[r.error] ?? "error");
  render(r.state);
  return r;
}

function render(next) {
  state = next;
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.language === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.getElementById("lang").textContent = t("lang");
  const app = document.getElementById("app");
  // Keep what the person is typing when the status updates.
  const typing = document.activeElement && document.activeElement.tagName === "INPUT";
  if (typing && app.dataset.view === view()) return renderStatus();
  app.dataset.view = view();
  app.replaceChildren(...sections());
}

const view = () => (!state.connected ? "connect" : !state.signedIn ? "signin" : "main");

function sections() {
  const out = [];
  if (notice) out.push($(`<p class="danger">${esc(notice)}</p>`));
  if (view() === "connect") {
    const s = $(`<section><h2>${t("connectTitle")}</h2>
      <label>${t("server")}<input id="server" placeholder="${t("serverHint")}" value="${esc(state.server)}" /></label>
      <button id="go">${t("connect")}</button></section>`);
    s.querySelector("#go").onclick = () => call("connect", s.querySelector("#server").value);
    return [...out, s];
  }
  if (view() === "signin") {
    const s = $(`<section><h2>${t("signInTitle")}</h2>
      <label>${t("email")}<input id="email" type="email" value="${esc(state.email)}" /></label>
      <label>${t("password")}<input id="password" type="password" /></label>
      <button id="go">${t("signIn")}</button><p class="muted"><code>${esc(state.server)}</code></p></section>`);
    s.querySelector("#go").onclick = () => call("signIn", s.querySelector("#email").value, s.querySelector("#password").value);
    return [...out, s];
  }

  const account = $(`<section><p>${t("signedInAs", { email: state.email, school: state.schoolName })}</p>
    <div class="row"><button class="quiet" id="web">${t("openWeb")}</button><button class="link" id="out">${t("signOut")}</button></div></section>`);
  account.querySelector("#web").onclick = () => call("openWeb");
  account.querySelector("#out").onclick = () => call("signOut");

  const library = $(`<section><h2>${t("libraryTitle")}</h2><p class="muted">${t("libraryHint")}</p>
    ${state.library ? `<code>${esc(state.library)}</code>` : `<p class="danger">${t("noLibrary")}</p>`}
    <button class="${state.library ? "quiet" : ""}" id="lib">${state.library ? t("change") : t("choose")}</button>
    <p class="muted">${t("rules")}</p></section>`);
  library.querySelector("#lib").onclick = () => call("chooseLibrary");

  const status = $(`<section id="status"></section>`);

  const today = new Date().toISOString().slice(0, 10);
  const imp = $(`<section><h2>${t("importTitle")}</h2><p class="muted">${t("importHint")}</p>
    <label>${t("eventName")}<input id="ev" maxlength="80" /></label>
    <label>${t("date")}<input id="date" type="date" value="${today}" /></label>
    <button class="quiet" id="imp">${t("importBtn")}</button></section>`);
  imp.querySelector("#imp").onclick = () => {
    const name = imp.querySelector("#ev").value.trim();
    if (name.length < 2) return imp.querySelector("#ev").focus();
    call("importFolder", name, imp.querySelector("#date").value || today);
  };

  const backup = $(`<section><h2>${t("backupTitle")}</h2><p class="muted">${t("backupHint")}</p>
    ${state.backup ? `<p>${t("backupOn")} <code>${esc(state.backup)}</code></p>` : `<p class="muted">${t("backupOff")}</p>`}
    <div class="row"><button class="quiet" id="bk">${state.backup ? t("change") : t("choose")}</button>
    ${state.backup ? `<button class="link" id="bkoff">${t("stop")}</button>` : ""}</div></section>`);
  backup.querySelector("#bk").onclick = () => call("chooseBackup");
  backup.querySelector("#bkoff")?.addEventListener("click", () => call("clearBackup"));

  const prefs = $(`<section><label class="row"><input type="checkbox" id="login" ${state.openAtLogin ? "checked" : ""} /> ${t("startup")}</label>
    <p class="muted">${t("version", { v: state.version })}</p></section>`);
  prefs.querySelector("#login").onchange = (e) => call("setOpenAtLogin", e.target.checked);

  setTimeout(renderStatus);
  return [...out, account, library, status, imp, backup, prefs];
}

function renderStatus() {
  const el = document.getElementById("status");
  if (!el) return;
  const q = state.queue;
  const imported = /^import:(\d+)$/.exec(state.message ?? "");
  el.innerHTML = `<h2>${t("statusTitle")}</h2>
    <div class="stats"><div><b>${q.pending}</b>${t("waiting")}</div><div><b>${q.done}</b>${t("sent")}</div><div><b class="${q.failed ? "danger" : ""}">${q.failed}</b>${t("failed")}</div></div>
    ${state.uploading.length ? `<p class="muted">${t("now", { files: state.uploading.join("، ") })}</p>` : ""}
    ${imported ? `<p>${t("imported", { n: imported[1] })}</p>` : ""}
    ${q.lastError && q.pending ? `<p class="muted">${t("offline", { error: /fetch|network|ENOTFOUND|ECONN/i.test(q.lastError) ? t("noInternet") : q.lastError })}</p>` : ""}
    ${q.failed ? `<button class="quiet" id="retry">${t("retry")}</button>` : ""}`;
  el.querySelector("#retry")?.addEventListener("click", () => call("retryFailed"));
}

document.getElementById("lang").onclick = () => call("setLanguage", state.language === "ar" ? "en" : "ar");
window.hub.onState(render);
window.hub.state().then(render);
