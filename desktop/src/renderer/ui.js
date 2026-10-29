// Shared pieces of the modern look: icons, native right-click menus, pill
// filters, switches, loading placeholders, friendly empty screens and the
// keyboard shortcut sheet. Plain functions that return HTML or bind events.

function icon(nameOf, size = 16, cls = "") {
  const inner = ICONS[nameOf] ?? ICONS.circle;
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// ---------- Right-click menus ----------
// items: [{ label, icon?, key?, run, enabled?, checked?, danger?, sub? } | "-"]
// The menu itself is the Mac's (or Windows') own menu, drawn by the system.
async function menu(items, at) {
  const handlers = new Map();
  let n = 0;
  const spec = (list) =>
    list
      .filter((it) => it && it !== false)
      .map((it) => {
        if (it === "-") return { type: "separator" };
        const id = `m${n++}`;
        if (it.run) handlers.set(id, it.run);
        return { id, label: it.label, key: it.key ?? null, enabled: it.enabled !== false, checked: it.checked, sub: it.sub ? spec(it.sub) : undefined };
      });
  // Leading, trailing and doubled separators are dropped.
  const clean = (list) => list.filter((it, i, a) => it.type !== "separator" || (i > 0 && i < a.length - 1 && a[i - 1].type !== "separator"));
  const tidy = (list) => clean(list).map((it) => (it.sub ? { ...it, sub: tidy(it.sub) } : it));
  const chosen = await quiet("contextMenu", tidy(spec(items)), at ?? null);
  if (chosen && handlers.has(chosen)) handlers.get(chosen)();
}

// Right-click (and Ctrl-click) on anything matching sel inside root.
function onContext(root, sel, build) {
  root.addEventListener("contextmenu", (e) => {
    const el = sel ? e.target.closest(sel) : root;
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const items = build(el, e);
    if (items?.length) menu(items);
  });
}

// ---------- Pills ----------
// A row of choices: pills([["all", "All"], ["picks", "Picks"]], value, "data-x")
function pills(choices, value, attr = "data-pill") {
  return `<div class="pills">${choices.map(([v, label, ic]) => `<button class="pill ${String(v) === String(value) ? "on" : ""}" ${attr}="${esc(v)}">${ic ? icon(ic, 13) : ""}${esc(label)}</button>`).join("")}</div>`;
}
function bindPills(root, attr, fn) {
  $$(`[${attr}]`, root).forEach((b) => (b.onclick = () => fn(b.getAttribute(attr), b)));
}

// A filter pill that opens a menu of choices: the modern replacement for a
// dropdown. choices: [[value, label]]. The pill shows the chosen label.
function pillMenu(id, label, choices, value) {
  const on = value !== undefined && value !== null && value !== "";
  const cur = choices.find(([v]) => String(v) === String(value));
  return `<button class="pill menu ${on ? "on" : ""}" data-pm="${esc(id)}">${esc(on && cur ? cur[1] : label)}${icon("chevron-down", 12)}</button>`;
}
function bindPillMenu(root, id, choices, value, fn, opts = {}) {
  const b = $(`[data-pm="${id}"]`, root);
  if (!b) return;
  b.onclick = () =>
    menu([
      ...(opts.any !== false ? [{ label: opts.anyLabel ?? L("Any", "الكل"), checked: value === undefined || value === null || value === "", run: () => fn(undefined) }, "-"] : []),
      ...choices.map(([v, l]) => ({ label: l, checked: String(v) === String(value), run: () => fn(v) })),
    ]);
}

// ---------- Switches and settings rows ----------
const sw = (attr, on, extra = "") => `<label class="switch"><input type="checkbox" ${attr} ${on ? "checked" : ""} ${extra}/><i></i></label>`;

// ---------- Loading and empty screens ----------
const skeletonTiles = (n = 24) => Array.from({ length: n }, () => `<div class="tile skel"></div>`).join("");
const skeletonRows = (n = 5) => `<div class="col gap8">${Array.from({ length: n }, () => `<div class="skel line"></div>`).join("")}</div>`;
function emptyState(ic, title, text = "", actions = "") {
  return `<div class="empty"><div class="eic">${icon(ic, 30)}</div><h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ""}${actions ? `<div class="row" style="justify-content:center">${actions}</div>` : ""}</div>`;
}

// ---------- Undo toast after a setting changes ----------
async function setSetting(key, value, label) {
  const before = S[key];
  await call("set", key, value);
  S[key] = value;
  if (label !== false)
    toastAction(label ?? L("Saved", "تم الحفظ"), L("Undo", "تراجع"), async () => {
      await call("set", key, before);
      S[key] = before;
      rerender();
    });
}
function toastAction(msg, action, fn, ms = 5000) {
  const t = h(`<div class="t"><span class="grow">${esc(msg)}</span><button>${esc(action)}</button></div>`);
  t.querySelector("button").onclick = () => {
    t.remove();
    fn();
  };
  $("#toast").append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- Keyboard shortcuts ----------
// Global: ⌘K search, ? this sheet, G then a letter jumps to a tab.
const JUMPS = { t: "today", l: "library", i: "import", f: "faces", s: "students", c: "coverage", u: "cleanup", y: "books", p: "posts", d: "calendar", h: "history", e: "settings" };
let gPressed = 0;
function globalKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "?") {
    shortcutSheet();
    return true;
  }
  const k = e.key.toLowerCase();
  if (k === "g" && !gPressed) {
    gPressed = Date.now();
    return true;
  }
  if (gPressed && Date.now() - gPressed < 1200 && JUMPS[k]) {
    gPressed = 0;
    go(JUMPS[k]);
    return true;
  }
  gPressed = 0;
  return false;
}

function shortcutSheet() {
  const view = App.views[App.view];
  const here = view?.keys?.() ?? [];
  const nav = Object.entries(JUMPS).map(([k, v]) => [`G ${k.toUpperCase()}`, NAV.flatMap((s) => s.items).find((n) => n.id === v)?.label() ?? v]);
  const block = (title, rows) =>
    rows.length ? `<h3>${esc(title)}</h3><div class="keysheet">${rows.map(([k, t]) => `<div><span>${esc(t)}</span><span class="ltr">${k.split(" ").map((x) => `<span class="k">${esc(x)}</span>`).join(" ")}</span></div>`).join("")}</div>` : "";
  modal(
    `<div class="row"><h2 class="grow">${L("Keyboard shortcuts", "اختصارات لوحة المفاتيح")}</h2><button class="btn ghost" data-x>${icon("x")}</button></div>
    ${block(L("On this screen", "في هذه الشاشة"), here)}
    ${block(L("Everywhere", "في كل مكان"), [
      ["⌘ K", L("Search and commands", "البحث والأوامر")],
      ["⌘ N", L("New post", "منشور جديد")],
      ["⌘ I", L("Import photos", "استيراد صور")],
      ["⌘ Z", L("Undo", "تراجع")],
      ["⌘ ,", L("Settings", "الإعدادات")],
      ["?", L("This list", "هذه القائمة")],
    ])}
    ${block(L("Go to", "انتقال إلى"), nav)}`,
    { wide: true },
  ).querySelector("[data-x]").onclick = closeOverlay;
}

// ---------- Small helpers used across screens ----------
// Readable event names: "20 Oct 2020 · Sports Day", never "20201020".
function eventName(title, date) {
  const t = String(title ?? "").replace(/^\d{8}\s*/, "").replace(/^\d{4}-\d{2}-\d{2}\s*/, "").trim();
  const d = date ? fmtDate(date) : "";
  return [d, t || L("Event", "فعالية")].filter(Boolean).join(" · ");
}

// Hijri date next to the normal one.
function hijri(d) {
  try {
    return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(S.language === "en" ? "en-u-ca-islamic-umalqura" : "ar-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

// Arabic and English spelling variations: Mohamed / Muhammad / Mohammed,
// Ahmed / Ahmad, Youssef / Yusuf, and Arabic letters that are often
// written either way (أ إ آ ا, ة ه, ى ي).
function nameKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ou|oo|u/g, "o")
    .replace(/ee|i/g, "e")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeo]/g, "")
    .replace(/[^a-z؀-ۿ0-9 ]/g, "")
    .trim();
}

// Students, staff, parents and visitors share one people list.
const KINDS = () => ({
  student: L("Student", "طالب"),
  teacher: L("Teacher", "معلم"),
  staff: L("Staff", "موظف"),
  parent: L("Parent", "ولي أمر"),
  visitor: L("Visitor", "زائر"),
});
