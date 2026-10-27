// Posts and Calendar are the website's own screens, shown inside the app,
// so phone approvals and the Mac always see the same posts.
function webScreen(main, title, sub, path) {
  if (!S.signedIn) {
    main.innerHTML = topbar(title, sub) + `<div class="content"><div class="empty"><span class="big">✎</span><b>${L("Sign in first", "سجّل الدخول أولًا")}</b><span>${L("Posts live on your School Social Hub website. Sign in from Settings.", "المنشورات على موقع School Social Hub. سجّل الدخول من الإعدادات.")}</span><button class="btn primary" id="w-set">${L("Open Settings", "فتح الإعدادات")}</button></div></div>`;
    $("#w-set", main).onclick = () => go("settings");
    return;
  }
  main.innerHTML = topbar(title, sub,
    `<button class="btn" id="w-back">←</button><button class="btn" id="w-reload">↻</button><button class="btn" id="w-pick">✓ ${L("Make a post from picks", "منشور من المختارة")}</button><button class="btn" id="w-out">${L("Open in browser", "فتح في المتصفح")}</button>`) +
    `<div class="content flush" style="flex-direction: column"><div class="note" id="w-tip" style="border-radius: 0">${L("First time here? Sign in to the website once below; the app remembers it.", "أول مرة؟ سجّل الدخول إلى الموقع مرة واحدة بالأسفل، وسيتذكره التطبيق.")}</div><webview id="web" partition="persist:web" allowpopups="false"></webview></div>`;
  call("webBase").then((base) => {
    const wv = $("#web", main);
    if (!wv) return;
    wv.src = base + path;
    wv.addEventListener("did-navigate", (e) => $("#w-tip", main)?.classList.toggle("hide", !/\/login/.test(e.url)));
    $("#w-back", main).onclick = () => wv.canGoBack() && wv.goBack();
    $("#w-reload", main).onclick = () => wv.reload();
    $("#w-out", main).onclick = () => call("openWeb", path);
  });
  $("#w-pick", main).onclick = () => go("library", { album: "picks" });
}

App.views.posts = {
  render(main, params) {
    webScreen(main, L("Posts", "المنشورات"), L("Write, check and send for approval", "اكتب وراجع وأرسل للموافقة"), params.post ? `/posts/${params.post}` : "/posts");
  },
};
App.views.calendar = {
  render(main) {
    webScreen(main, L("Calendar", "التقويم"), L("What goes out, and when", "ما يُنشر ومتى"), "/calendar");
  },
};
