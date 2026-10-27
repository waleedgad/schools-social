// The big view: one photo with its faces, culling keys, before/after and compare.
const V = { ids: [], i: 0, opts: {}, photo: null, showFaces: true, before: false };

function openViewer(ids, index, opts = {}) {
  V.ids = ids;
  V.i = Math.max(0, Math.min(ids.length - 1, index));
  V.opts = opts;
  V.before = false;
  App.overlayKeys = viewerKeys;
  drawViewer();
}

function closeViewer() {
  closeOverlay();
  App.views[App.view]?.onState?.(["photos"]);
}

async function drawViewer() {
  const id = V.ids[V.i];
  const p = await call("photo", id);
  V.photo = p;
  const overlay = $("#overlay");
  const shown = V.before && p.original ? p.original.id : id;
  const faces = V.showFaces && !V.before ? p.faces : [];
  const keys = [
    ["← →", L("next", "التالي")], ["P", L("pick", "اختيار")], ["X", L("reject", "رفض")], ["1-5", L("stars", "نجوم")],
    ["T", L("tag", "وسم")], ["Y / N", L("yes / no to suggestions", "نعم / لا للاقتراحات")], ["B", L("before / after", "قبل / بعد")],
    ["C", L("compare", "مقارنة")], ["F", L("faces", "الوجوه")], ["Esc", L("close", "إغلاق")],
  ];
  overlay.innerHTML = `<div class="viewer">
    <div class="vtop"><b>${esc(p.name)}</b><span class="muted small">${num(V.i + 1)} / ${num(V.ids.length)}</span>
      ${V.opts.cull ? `<span class="tag info">${L("Culling: P / X moves on", "الفرز: P / X ينتقل للتالي")}</span>` : ""}
      <span class="grow"></span>
      <button class="btn small ${p.flag === 1 ? "on" : ""}" id="v-pick">✓ ${L("Pick", "اختيار")}</button>
      <button class="btn small ${p.flag === -1 ? "on" : ""}" id="v-rej">✕ ${L("Reject", "رفض")}</button>
      <span id="v-stars">${[1, 2, 3, 4, 5].map((n) => `<button class="btn small ghost" data-star="${n}" style="color: ${n <= p.rating ? "#ffd257" : "#59606d"}; padding: 4px 3px">★</button>`).join("")}</span>
      <button class="btn small" id="v-close">✕ ${L("Close", "إغلاق")}</button></div>
    <div class="vbody"><div class="stage"><div class="imgbox"><img id="v-img" src="hub://preview/${shown}" />
      ${faces.map((f) => (f.w ? `<div class="facebox ${f.status} ${f.status !== "suggested" && f.can_post === 0 ? "nopost" : ""}" data-face="${f.id}" style="left: ${f.x * 100}%; top: ${f.y * 100}%; width: ${f.w * 100}%; height: ${f.h * 100}%"><span class="nm">${esc(faceLabel(f))}</span></div>` : "")).join("")}
      ${V.before ? `<span class="tag" style="position: absolute; top: 8px; left: 8px">${L("Original", "الأصل")}</span>` : ""}</div></div>
      <aside class="vside" id="v-side"></aside></div>
    <div class="keys">${keys.map(([k, t]) => `<span><span class="k">${k}</span> ${t}</span>`).join("")}</div>
    <div class="strip" id="v-strip"></div></div>`;
  drawSide(p);
  drawStrip();
  $("#v-close").onclick = closeViewer;
  $("#v-pick").onclick = () => flagHere(p.flag === 1 ? 0 : 1);
  $("#v-rej").onclick = () => flagHere(p.flag === -1 ? 0 : -1);
  $$("[data-star]").forEach((b) => (b.onclick = () => rateHere(Number(b.dataset.star) === p.rating ? 0 : Number(b.dataset.star))));
  $$("[data-face]").forEach((b) => (b.onclick = () => faceMenu(p.faces.find((f) => f.id === Number(b.dataset.face)))));
}

function faceLabel(f) {
  if (f.status === "suggested") return `${S.language === "en" ? f.suggest_en || f.suggest_ar : f.suggest_ar || f.suggest_en}?`;
  if (f.student_id) return name(f);
  return "?";
}

function drawSide(p) {
  const side = $("#v-side");
  const named = p.faces.filter((f) => f.student_id && f.status !== "suggested");
  const sug = p.faces.filter((f) => f.status === "suggested");
  const unknown = p.faces.filter((f) => f.status === "unknown" && f.w);
  side.innerHTML = `
    <div class="col gap4"><b>${esc(p.event_title ?? L("Not in an event", "خارج الفعاليات"))}</b>
      <span class="muted">${[p.taken_at && fmtDate(p.taken_at), p.class_name, p.term, p.year].filter(Boolean).map(esc).join(" · ")}</span>
      <span class="muted">${p.width ?? "?"}×${p.height ?? "?"} · ${fmtBytes(p.size)}${p.quality ? ` · ${L("quality", "الجودة")} ${p.quality}/10` : ""}</span>
      <div class="row">${p.remote_id ? `<span class="tag info">☁ ${L("On the website", "على الموقع")}</span>` : ""}${p.is_raw || p.raw.length ? `<span class="tag">RAW</span>` : ""}${p.edits.length ? `<span class="tag violet">✎ ${L("Edited", "معدّلة")}</span>` : ""}</div></div>
    <div class="col gap4"><b>${L("People", "الأشخاص")}</b>
      ${named.map((f) => `<div class="who">${avatar({ ...f, id: f.student_id, portrait: null })}<div class="grow"><div>${esc(name(f))}</div><div class="muted tiny">${esc(f.class_name ?? "")}</div></div>${f.can_post === 0 ? `<span class="tag bad" title="${L("Can't appear in posts", "لا يظهر في المنشورات")}">⛔</span>` : ""}<button class="btn small ghost" data-untag="${f.id}" title="${L("Remove", "إزالة")}">✕</button></div>`).join("")}
      ${sug.map((f) => `<div class="who"><img src="hub://face/${f.id}" /><div class="grow"><div>${esc(S.language === "en" ? f.suggest_en || f.suggest_ar : f.suggest_ar || f.suggest_en)}?</div><div class="muted tiny">${L("match", "تطابق")} ${Math.round((f.suggest_score ?? 0) * 100)}%</div></div><button class="btn small" data-yes="${f.id}" title="Y">✓</button><button class="btn small" data-no="${f.id}" title="N">✕</button></div>`).join("")}
      ${unknown.map((f) => `<div class="who"><img src="hub://face/${f.id}" /><div class="grow muted">${L("Who is this?", "من هذا؟")}</div><button class="btn small" data-name="${f.id}">${L("Name", "تسمية")}</button></div>`).join("")}
      ${!p.faces.length ? `<span class="muted">${p.faces_scanned === 1 ? L("No faces found.", "لم يتم العثور على وجوه.") : L("Looking for faces…", "جارٍ البحث عن وجوه…")}</span>` : ""}
      <button class="btn small" id="v-tag">+ ${L("Tag someone (T)", "وسم شخص (T)")}</button></div>
    ${p.edits.length || p.original ? `<div class="col gap4"><b>${L("Versions", "النسخ")}</b>
      ${p.original ? `<span class="muted">${L("This is an edited copy of", "هذه نسخة معدّلة من")} ${esc(p.original.name)}</span>` : ""}
      ${p.edits.map((e) => `<span>✎ ${esc(e.name)}</span>`).join("")}
      ${p.original ? `<button class="btn small" id="v-before">${L("Hold B to see the original", "اضغط B لرؤية الأصل")}</button>` : ""}</div>` : ""}
    <div class="col gap4"><b>${L("File", "الملف")}</b>
      <button class="btn small" id="v-finder">${L("Show in Finder", "إظهار في Finder")}</button>
      <button class="btn small" id="v-editor">${L("Open in editing app", "فتح في تطبيق التعديل")}</button>
      <button class="btn small primary" id="v-post">✎ ${L("New post with this photo", "منشور جديد بهذه الصورة")}</button></div>`;
  $$("[data-untag]", side).forEach((b) => (b.onclick = () => faceAction("rejectFaces", [Number(b.dataset.untag)])));
  $$("[data-yes]", side).forEach((b) => (b.onclick = () => confirmSuggestion(p.faces.find((f) => f.id === Number(b.dataset.yes)))));
  $$("[data-no]", side).forEach((b) => (b.onclick = () => faceAction("rejectFaces", [Number(b.dataset.no)])));
  $$("[data-name]", side).forEach((b) => (b.onclick = () => faceMenu(p.faces.find((f) => f.id === Number(b.dataset.name)))));
  $("#v-tag", side).onclick = tagHere;
  $("#v-finder", side).onclick = () => call("reveal", p.id);
  $("#v-editor", side).onclick = () => call("openEditor", [p.id]);
  $("#v-post", side).onclick = async () => {
    closeOverlay();
    lib.sel = new Set([p.id]);
    if (App.view === "library") newPostFromSelection();
  };
}

function drawStrip() {
  const strip = $("#v-strip");
  const from = Math.max(0, V.i - 12);
  const ids = V.ids.slice(from, from + 25);
  strip.innerHTML = ids.map((id, k) => `<img src="hub://thumb/${id}" class="${from + k === V.i ? "on" : ""}" data-k="${from + k}" loading="lazy" />`).join("");
  $$("img", strip).forEach((im) => (im.onclick = () => { V.i = Number(im.dataset.k); drawViewer(); }));
}

async function faceAction(fn, ...args) {
  await call(fn, ...args);
  drawViewer();
}

async function confirmSuggestion(f) {
  if (!f) return;
  await call("confirmFaces", [f.id], f.suggest_id);
  drawViewer();
}

function faceMenu(f) {
  if (!f) return;
  if (f.status === "suggested") return confirmSuggestion(f);
  pickStudent(L("Who is this?", "من هذا؟"), async (s) => {
    App.overlayKeys = viewerKeys;
    await call("confirmFaces", [f.id], s.id);
    drawViewer();
  }, { className: V.photo?.class_name });
  const modalEl = $(".modal");
  if (modalEl && f.w) {
    modalEl.prepend(h(`<div class="row"><img src="hub://face/${f.id}" style="width: 72px; height: 72px; border-radius: 10px" /><span class="grow"></span><button class="btn small" id="notface">${L("Not a face", "ليس وجهًا")}</button></div>`));
    $("#notface", modalEl).onclick = async () => {
      await call("hideFaces", [f.id]);
      App.overlayKeys = viewerKeys;
      drawViewer();
    };
  }
  const close = App.overlayKeys;
  App.overlayKeys = (e) => {
    if (e.key === "Escape") {
      App.overlayKeys = viewerKeys;
      return drawViewer();
    }
    close?.(e);
  };
}

function tagHere() {
  pickStudent(L("Who else is in this photo?", "من أيضًا في هذه الصورة؟"), async (s) => {
    App.overlayKeys = viewerKeys;
    await call("tagPhotos", [V.photo.id], s.id);
    drawViewer();
  }, { className: V.photo?.class_name });
  App.overlayKeys = (e) => {
    if (e.key === "Escape") {
      App.overlayKeys = viewerKeys;
      drawViewer();
    }
  };
}

async function flagHere(n) {
  await call("flag", [V.photo.id], n);
  if (V.opts.cull && n !== 0 && V.i < V.ids.length - 1) V.i++;
  drawViewer();
}
async function rateHere(n) {
  await call("rate", [V.photo.id], n);
  drawViewer();
}

function viewerKeys(e) {
  if ($(".modalback")) return;
  const k = e.key.toLowerCase();
  const rtl = document.documentElement.dir === "rtl";
  if (k === "escape") return closeViewer();
  if (k === "arrowright" || k === "arrowleft") {
    const step = (k === "arrowright") !== rtl ? 1 : -1;
    V.i = Math.max(0, Math.min(V.ids.length - 1, V.i + step));
    return drawViewer();
  }
  if (k === "p") return flagHere(V.photo.flag === 1 ? 0 : 1);
  if (k === "x") return flagHere(V.photo.flag === -1 ? 0 : -1);
  if (k === "u") return flagHere(0);
  if (/^[0-5]$/.test(k)) return rateHere(Number(k));
  if (k === "t") return tagHere();
  if (k === "f") {
    V.showFaces = !V.showFaces;
    return drawViewer();
  }
  if (k === "y") {
    const sug = V.photo.faces.filter((f) => f.status === "suggested");
    return Promise.all(sug.map((f) => call("confirmFaces", [f.id], f.suggest_id))).then(drawViewer);
  }
  if (k === "n") {
    const sug = V.photo.faces.filter((f) => f.status === "suggested").map((f) => f.id);
    return sug.length && faceAction("rejectFaces", sug);
  }
  if (k === "b" && V.photo.original && !e.repeat) {
    V.before = !V.before;
    return drawViewer();
  }
  if (k === "c") return openCompare(V.ids.slice(V.i, V.i + 2), true);
}

// Two to four shots side by side; keep the best, reject the rest.
const CMP = { ids: [], on: 0, back: false };
async function openCompare(ids, back = false) {
  if (ids.length < 2) return;
  CMP.ids = ids;
  CMP.on = 0;
  CMP.back = back;
  App.overlayKeys = compareKeys;
  drawCompare();
}
async function drawCompare() {
  const rows = await call("photos", { ids: CMP.ids, sort: "time" });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cols = CMP.ids.length <= 2 ? 2 : 2;
  $("#overlay").innerHTML = `<div class="viewer"><div class="vtop"><b>◫ ${L("Compare", "مقارنة")}</b><span class="muted small">${L("Click a photo, then P to keep it or K to keep it and reject the others", "اختر صورة، ثم P للإبقاء عليها أو K للإبقاء عليها ورفض الباقي")}</span><span class="grow"></span>
    <button class="btn small primary" id="c-keep">${L("Keep selected, reject others (K)", "الإبقاء على المحددة ورفض الباقي (K)")}</button><button class="btn small" id="c-close">✕ ${L("Close", "إغلاق")}</button></div>
    <div class="compare" style="grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${Math.ceil(CMP.ids.length / cols)}, minmax(0, 1fr))">
    ${CMP.ids.map((id, i) => { const r = byId.get(id) ?? {}; return `<div class="cell ${i === CMP.on ? "on" : ""}" data-i="${i}"><img src="hub://preview/${id}" /><span class="lab row">${r.flag === 1 ? `<span class="tag good">✓</span>` : r.flag === -1 ? `<span class="tag bad">✕</span>` : ""}${r.quality ? `<span class="tag">${L("quality", "الجودة")} ${r.quality}</span>` : ""}${r.rating ? `<span class="tag warn">${"★".repeat(r.rating)}</span>` : ""}</span></div>`; }).join("")}
    </div></div>`;
  $$(".cell").forEach((c) => (c.onclick = () => { CMP.on = Number(c.dataset.i); drawCompare(); }));
  $("#c-close").onclick = () => (CMP.back ? openViewer(V.ids, V.i, V.opts) : closeViewer());
  $("#c-keep").onclick = keepOne;
}
async function keepOne() {
  const keep = CMP.ids[CMP.on];
  await call("flag", [keep], 1);
  await call("flag", CMP.ids.filter((id) => id !== keep), -1);
  toast(L("Kept one, rejected the others", "تم الإبقاء على واحدة ورفض الباقي"), { undo: true });
  CMP.back ? openViewer(V.ids, V.i, V.opts) : closeViewer();
}
function compareKeys(e) {
  const k = e.key.toLowerCase();
  if (k === "escape") return CMP.back ? openViewer(V.ids, V.i, V.opts) : closeViewer();
  if (k === "arrowright" || k === "arrowleft") {
    CMP.on = (CMP.on + ((k === "arrowright") !== (document.documentElement.dir === "rtl") ? 1 : -1) + CMP.ids.length) % CMP.ids.length;
    return drawCompare();
  }
  if (k === "p") return call("flag", [CMP.ids[CMP.on]], 1).then(drawCompare);
  if (k === "x") return call("flag", [CMP.ids[CMP.on]], -1).then(drawCompare);
  if (k === "k") return keepOne();
}
