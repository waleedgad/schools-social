// The school's licence (0.13): before signing in, or when the school's
// access is paused, only the sign-in form or the renew notice shows. In
// read-only mode a bar on every screen says what still works.

const licenceState = () => (S?.licence?.on ? S.licence.state : "active");
const gateNeeded = () => ["none", "blocked"].includes(licenceState());

function contactLine(lic) {
  return lic.contact ? `<p class="muted ltr-auto">${esc(lic.contact)}</p>` : "";
}

function renderGate(main) {
  const lic = S.licence;
  const signedIn = S.signedIn && licenceState() === "blocked";
  const form = `
    <label class="gfield">${L("Email", "البريد الإلكتروني")}<input type="email" id="gem" class="ltr" value="${esc(S.email ?? "")}" autocomplete="username" /></label>
    <label class="gfield">${L("Password", "كلمة المرور")}<input type="password" id="gpw" autocomplete="current-password" /></label>
    <button class="btn primary" id="gin">${L("Sign in", "دخول")}</button>`;
  const connectForm = `
    <label class="gfield">${L("Website address", "عنوان الموقع")}<input id="gsrv" class="ltr" value="${esc(S.server ?? "")}" /></label>
    <button class="btn primary" id="gconn">${L("Connect", "اتصال")}</button>`;
  const body = signedIn
    ? lic.wrongLibrary
      ? `<h1>${L("This library belongs to another school", "هذه المكتبة تخص مدرسة أخرى")}</h1>
         <p>${L("The library on this computer can't be opened with this school's account. Sign in with the school it belongs to.", "لا يمكن فتح المكتبة على هذا الجهاز بحساب هذه المدرسة. سجّل الدخول بالمدرسة التي تخصها.")}</p>`
      : `<h1>${L("Your school's access is paused", "دخول مدرستكم متوقف")}</h1>
         <p>${L("The school's plan has ended. Your photos stay safe on this computer and on the library drive. Renew the plan to open the library again.", "انتهت خطة المدرسة. صوركم آمنة على هذا الجهاز وعلى قرص المكتبة. جدّدوا الخطة لفتح المكتبة مرة أخرى.")}</p>
         ${contactLine(lic)}`
    : `<h1>${L("Sign in to your school", "سجّل الدخول إلى مدرستك")}</h1>
       <p>${L("The library opens once this computer is signed in to your school's account.", "تُفتح المكتبة عندما يُسجَّل هذا الجهاز في حساب مدرستك.")}</p>
       ${S.connected ? form : connectForm}`;
  main.innerHTML = `<div class="gate" data-testid="licence-gate"><div class="gatecard">${body}
    ${signedIn ? `<div class="gaterow"><button class="btn" id="gcheck">${L("Check again", "تحقّق مرة أخرى")}</button><button class="btn" id="gout">${L("Sign out", "خروج")}</button></div>` : ""}
    ${lic.error === "computer-limit" ? `<p class="gerr">${L("Your plan's library computers are all in use. Remove one on the website, or ask for a bigger plan.", "كل أجهزة المكتبة في خطتكم مستخدمة. احذفوا جهازًا من الموقع أو اطلبوا خطة أكبر.")}</p>` : ""}
    ${lic.error === "school-read-only" ? `<p class="gerr">${L("A new computer can't be added while the school is read-only.", "لا يمكن إضافة جهاز جديد والمدرسة في وضع القراءة فقط.")}</p>` : ""}
  </div></div>`;
  const go = async (fn) => {
    try {
      await fn();
    } catch {
      // the message is shown by call()
    }
  };
  $("#gin", main)?.addEventListener("click", () => go(async () => {
    await call("signIn", $("#gem", main).value.trim(), $("#gpw", main).value);
    S = await call("state");
    rerender();
  }));
  $("#gpw", main)?.addEventListener("keydown", (e) => e.key === "Enter" && $("#gin", main).click());
  $("#gconn", main)?.addEventListener("click", () => go(async () => {
    await call("connect", $("#gsrv", main).value.trim());
    S = await call("state");
    rerender();
  }));
  $("#gcheck", main)?.addEventListener("click", () => go(async () => {
    await call("checkLicence");
    S = await call("state");
    rerender();
  }));
  $("#gout", main)?.addEventListener("click", () => go(() => call("signOut")));
}

function readOnlyBar() {
  const lic = S.licence;
  const text = lic.offline
    ? L("This computer hasn't reached the school's account for 10 days, so the library is read-only. Connect to the internet to carry on.", "لم يتصل هذا الجهاز بحساب المدرسة منذ 10 أيام، لذلك المكتبة للقراءة فقط. اتصل بالإنترنت للمتابعة.")
    : L(`Read-only mode for ${num(lic.readOnlyLeft)} more days: you can look at photos, tags and faces, but not import, tag or make posts. Renew the plan to carry on.`, `وضع القراءة فقط لمدة ${num(lic.readOnlyLeft)} يومًا أخرى: يمكنكم مشاهدة الصور والوسوم والوجوه، دون استيراد أو وسم أو إنشاء منشورات. جدّدوا الخطة للمتابعة.`);
  return h(`<div class="robar" data-testid="read-only-bar"><span class="grow">${esc(text)}</span><button class="btn">${L("Check again", "تحقّق مرة أخرى")}</button></div>`);
}

function licenceFrame(main) {
  const shell = $("#shell");
  shell.classList.toggle("gated", gateNeeded());
  if (gateNeeded()) {
    main.replaceChildren();
    renderGate(main);
    return true;
  }
  return false;
}

function licenceBar(main) {
  if (licenceState() !== "read_only") return;
  const bar = readOnlyBar();
  bar.querySelector("button").addEventListener("click", async () => {
    await call("checkLicence").catch(() => {});
    S = await call("state");
    rerender();
  });
  main.prepend(bar);
}
