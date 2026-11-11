// Shared pieces of the modern look: icons, native right-click menus, pill
// filters, switches, loading placeholders, friendly empty screens and the
// keyboard shortcut sheet. Plain functions that return HTML or bind events.

function icon(nameOf, size = 16, cls = "") {
  const inner = ICONS[nameOf] ?? ICONS.circle;
  return `<svg class="i ${cls}" data-icon="${nameOf}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// Buttons that show only an icon get a spoken name (and a tooltip) from
// what the icon means, so screen readers never say just "button".
const ICON_NAMES = () => ({
  x: L("Close", "إغلاق"), ellipsis: L("More", "المزيد"), plus: L("Add", "إضافة"), check: L("Done", "تم"),
  "chevron-left": L("Previous", "السابق"), "chevron-right": L("Next", "التالي"), "undo-2": L("Undo", "تراجع"),
  merge: L("Join", "دمج"), "trash-2": L("Delete", "حذف"), pencil: L("Edit", "تعديل"), search: L("Search", "بحث"),
  "refresh-cw": L("Refresh", "تحديث"), settings: L("Settings", "الإعدادات"), info: L("Details", "التفاصيل"),
  "layout-grid": L("Grid", "شبكة"), list: L("List", "قائمة"), pin: L("Pin", "تثبيت"), "pin-off": L("Unpin", "إلغاء التثبيت"),
  "circle-check": L("Ticked", "محدد"), circle: L("Not ticked", "غير محدد"),
});
function nameIconButtons(root = document.body) {
  $$("button:not([aria-label])", root).forEach((b) => {
    if (b.textContent.trim()) return;
    const name = ICON_NAMES()[b.querySelector("svg[data-icon]")?.dataset.icon] ?? b.title;
    if (!name) return;
    b.setAttribute("aria-label", name);
    if (!b.title) b.title = name;
  });
}
new MutationObserver(() => nameIconButtons()).observe(document.documentElement, { childList: true, subtree: true });

// ---------- Drawing again without flicker ----------
// A box drawn again (new counts, a photo arrived) keeps the parts that
// didn't change: they don't replay their "appear" animation and their
// pictures don't blink while they load again. Only what changed is touched.
// Children are matched by data-key (or id), else by position and tag.
// Event handlers set with el.onclick = … are simply set again afterwards.
function morph(el, html) {
  const next = document.createElement(el.tagName === "TBODY" ? "tbody" : "div");
  next.innerHTML = html;
  morphChildren(el, next);
  nameIconButtons(el);
}
const morphKey = (n) => (n.nodeType === 1 ? n.getAttribute("data-key") ?? (n.id || null) : null);
function morphChildren(from, to) {
  const keyed = new Map();
  for (const c of from.childNodes) {
    const k = morphKey(c);
    if (k != null) keyed.set(k, c);
  }
  const wanted = new Set([...to.childNodes].map(morphKey).filter((k) => k != null));
  let at = from.firstChild;
  // Ones that are gone are taken out first, so the ones that stay don't
  // have to be moved.
  const skipGone = () => {
    while (at && morphKey(at) != null && !wanted.has(morphKey(at))) {
      const n = at.nextSibling;
      keyed.delete(morphKey(at));
      at.remove();
      at = n;
    }
  };
  for (const want of [...to.childNodes]) {
    skipGone();
    const k = morphKey(want);
    let have = null;
    if (k != null) {
      have = keyed.get(k) ?? null;
      keyed.delete(k);
    } else if (at && morphKey(at) == null && at.nodeName === want.nodeName) have = at;
    if (have && have.nodeName === want.nodeName) {
      if (have !== at) from.insertBefore(have, at);
      morphNode(have, want);
      at = have.nextSibling;
    } else {
      if (have && k != null) {
        if (have === at) at = at.nextSibling;
        have.remove();
      }
      from.insertBefore(want, at);
    }
  }
  while (at) {
    const n = at.nextSibling;
    at.remove();
    at = n;
  }
  for (const left of keyed.values()) if (left.isConnected && left.parentNode === from) left.remove();
}
function morphNode(from, to) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  // A tick box the person clicked keeps its own state; set it to what's drawn.
  if (from.tagName === "INPUT" && /^(checkbox|radio)$/.test(from.type)) from.checked = to.hasAttribute("checked");
  if (from.isEqualNode(to)) return;
  for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  // aria-label and title are added by nameIconButtons; keep them.
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name) && a.name !== "aria-label" && a.name !== "title") from.removeAttribute(a.name);
  // A box marked data-own fills itself (its own morph); leave what's in it.
  if (from.tagName === "TEXTAREA" || to.hasAttribute("data-own")) return;
  morphChildren(from, to);
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
// Calling it again on the same box (drawn again in place) replaces the menu
// for that selector instead of adding a second one.
function onContext(root, sel, build) {
  if (!root._ctx) {
    root._ctx = new Map();
    root.addEventListener("contextmenu", (e) => {
      for (const [s, b] of root._ctx) {
        const el = s ? e.target.closest(s) : root;
        if (!el || !root.contains(el)) continue;
        e.preventDefault();
        e.stopPropagation();
        const items = b(el, e);
        if (items?.length) menu(items);
        return;
      }
    });
  }
  root._ctx.set(sel ?? "", build);
}

// ---------- Pills ----------
// A row of choices: pills([["all", "All"], ["picks", "Picks"]], value, "data-x")
// [value, label, icon, name]: the name is read out by screen readers when a pill shows only an icon.
function pills(choices, value, attr = "data-pill") {
  return `<div class="pills">${choices.map(([v, label, ic, name]) => `<button class="pill ${String(v) === String(value) ? "on" : ""}" ${attr}="${esc(v)}" ${name ? `aria-label="${esc(name)}" title="${esc(name)}"` : ""}>${ic ? icon(ic, 13) : ""}${esc(label)}</button>`).join("")}</div>`;
}
// Settings-style rows: each switch, box and list is named after its row's
// title, so screen readers say what it is.
function nameControls(root) {
  $$(".srow", root).forEach((row) => {
    const title = $(".st", row)?.textContent.trim();
    if (!title) return;
    $$(".sc input, .sc select, .sc textarea", row).forEach((el) => {
      if (!el.getAttribute("aria-label") && el.type !== "hidden") el.setAttribute("aria-label", title);
    });
  });
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

// ---------- How likely a face suggestion is ----------
// Words, not a %: a face score says how alike two faces are, not a chance.
// "Very likely" and "Likely" are only given where the face test found them
// right at least 9 times in 10; everything else is a plain guess.
const likelyText = (label) => (label === "very" ? L("Very likely", "مرجّح جدًا") : label === "likely" ? L("Likely", "مرجّح") : L("A guess", "تخمين"));
const likelyTag = (label) => `<span class="tag ${label === "very" ? "good" : ""}">${likelyText(label)}</span>`;

// ---------- Undo toast after a setting changes ----------
async function setSetting(key, value, label) {
  const before = S[key];
  await call("set", key, value);
  S[key] = value;
  if (label !== false)
    toastAction(label ?? L("Saved", "تم الحفظ"), L("Undo", "تراجع"), async () => {
      await call("set", key, before);
      S[key] = before;
      rerender(true);
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
  // Opened over the photo view: its keys, and closing goes back to the photo.
  const inViewer = App.overlayKeys === viewerKeys && V.open;
  const here = inViewer ? viewerKeyList() : view?.keys?.() ?? [];
  const nav = Object.entries(JUMPS).map(([k, v]) => [`G ${k.toUpperCase()}`, NAV.flatMap((s) => s.items).find((n) => n.id === v)?.label() ?? v]);
  // A row is one action; its key can be a list of keys that do the same
  // thing (shown as "I or ⌘I").
  const keysOf = (k) => (Array.isArray(k) ? k : [k]);
  const chips = (k) => forPc(k).split(" ").map((x) => `<span class="k">${esc(x)}</span>`).join(" ");
  const block = (title, rows) =>
    rows.length ? `<h3>${esc(title)}</h3><div class="keysheet">${rows.map(([k, t]) => `<div><span>${esc(t)}</span><span class="ltr">${keysOf(k).map(chips).join(` <span class="muted small">${L("or", "أو")}</span> `)}</span></div>`).join("")}</div>` : "";
  // "Everywhere" leaves out the keys this screen already lists.
  const shown = new Set(here.flatMap(([k]) => keysOf(k)));
  const notShown = (rows) => rows.filter(([k]) => !keysOf(k).some((x) => shown.has(x)));
  modal(
    `<div class="row"><h2 class="grow">${L("Keyboard shortcuts", "اختصارات لوحة المفاتيح")}</h2><button class="btn ghost" data-x>${icon("x")}</button></div>
    ${block(L("On this screen", "في هذه الشاشة"), here)}
    ${block(L("Everywhere", "في كل مكان"), notShown([
      [["⌘ K", "⌘ F"], L("Search and commands", "البحث والأوامر")],
      ["⌘ N", L("New post", "منشور جديد")],
      ["⇧ ⌘ I", L("Import photos", "استيراد صور")],
      ["⌘ Z", L("Undo", "تراجع")],
      ["⌘ A", L("Select all", "تحديد الكل")],
      ["⌘ D", L("Select none", "إلغاء التحديد")],
      ["⌘ ,", L("Settings", "الإعدادات")],
      [isMac() ? "⌘ [ ⌘ ]" : "Alt+← Alt+→", L("Back, forward", "رجوع، تقدّم")],
      ["Esc", L("Close what is on top", "إغلاق ما في الأعلى")],
      [["⌘ /", "?"], L("This list", "هذه القائمة")],
    ]))}
    ${block(L("Tabs", "التبويبات"), Object.entries(TAB_KEYS).map(([n, id]) => [`⌘ ${n}`, NAV.flatMap((s) => s.items).find((x) => x.id === id)?.label() ?? id]))}
    ${block(L("Go to", "انتقال إلى"), nav)}`,
    { wide: true },
  );
  const close = () => (inViewer ? openViewer(V.ids, V.i, V.opts) : closeOverlay());
  $("#overlay [data-x]").onclick = close;
  App.overlayKeys = (e) => {
    if (e.key === "Escape" || (modKey(e) && (e.key === "/" || e.key === "?"))) return e.preventDefault(), close();
  };
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
    return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString(S.language === "en" ? "en-u-ca-islamic-umalqura" : "ar-EG-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" });
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

// A yes/no question in the app's own style. Resolves true for yes.
function confirmBox(text, yes = L("Continue", "متابعة"), no = L("Cancel", "إلغاء")) {
  return new Promise((resolve) => {
    const m = modal(`<p style="margin: 0 0 16px">${esc(text)}</p><div class="row"><span class="grow"></span><button class="btn" data-no>${esc(no)}</button><button class="btn primary" data-yes>${esc(yes)}</button></div>`);
    const done = (v) => { closeOverlay(); resolve(v); };
    m.querySelector("[data-yes]").onclick = () => done(true);
    m.querySelector("[data-no]").onclick = () => done(false);
    App.overlayKeys = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    setTimeout(() => m.querySelector("[data-yes]").focus(), 30);
  });
}
function infoBox(title, text) {
  const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row"><span class="grow"></span><button class="btn primary">${L("OK", "حسنًا")}</button></div>`);
  m.querySelector("button").onclick = closeOverlay;
}
