// Clean up: one page of cards, each saying how much space it frees. Every
// photo goes to the app's Bin first (30 days, then the computer's Trash), and
// its web copy with it. RAW and JPEG pairs are always kept, and photos that
// are posted, picked, in a yearbook or have someone named in them are never
// offered. Groups of copies show the best one to keep and a tick on the rest.

const CLEAN_KINDS = () => [
  { id: "exact", icon: "copy", title: L("Exact copies", "نسخ مطابقة"), body: L("The same file twice. The first copy stays with all its names and picks.", "الملف نفسه مرتين. تبقى النسخة الأولى بكل أسمائها واختياراتها."), safe: true },
  { id: "sizes", icon: "scaling", title: L("Same photo, other sizes", "الصورة نفسها بأحجام أخرى"), body: L("Resized, exported or WhatsApp copies. The original, biggest one is kept. Edited versions stay.", "نسخ مصغّرة أو مُصدّرة أو من واتساب. يبقى الأصل الأكبر. تبقى النسخ المعدّلة.") },
  { id: "bursts", icon: "layers", title: L("Near-identical shots", "لقطات شبه متطابقة"), body: L("Shots seconds apart that look the same. The sharpest is recommended.", "لقطات بفارق ثوانٍ تبدو متشابهة. يُقترح إبقاء الأوضح.") },
  { id: "bad", icon: "image-off", title: L("Bad photos", "صور ضعيفة"), body: L("Blurry, too dark or too bright.", "مهزوزة أو مظلمة جدًا أو ساطعة جدًا.") },
  { id: "rejected", icon: "thumbs-down", title: L("Old rejected photos", "صور مرفوضة قديمة"), body: "" },
];

const REASONS = () => ({ blurry: L("Blurry", "مهزوزة"), dark: L("Too dark", "مظلمة"), bright: L("Too bright", "ساطعة") });
const CL = {};

App.views.cleanup = {
  async render(main, params = {}) {
    if (params.bin) return this.bin(main);
    main.innerHTML = topbar(L("Clean up", "تنظيف"), L("Looking for space to free…", "جارٍ البحث عن مساحة يمكن تحريرها…")) + `<div class="content">${skeletonRows(6)}</div>`;
    const [r, bin] = await Promise.all([quiet("cleanup"), quiet("binList")]);
    if (!r || App.view !== "cleanup") return;
    const total = r.exact.size + r.sizes.size + r.bursts.size + r.bad.size + r.rejected.size + r.cache;
    const safe = r.exact.size + r.cache;
    main.innerHTML =
      topbar(L("Clean up", "تنظيف"), L(`Up to ${fmtBytes(total)} can be freed`, `يمكن تحرير حتى ${fmtBytes(total)}`),
        `<button class="btn" id="cl-bin">${icon("trash-2", 14)} ${L("Bin", "السلة")}${bin?.length ? ` · ${num(bin.length)}` : ""}</button><button class="btn primary" id="cl-safe" ${safe || r.empty ? "" : "disabled"}>${icon("sparkles", 14)} ${L("Clean everything safe", "نظّف كل ما هو آمن")} · ${fmtBytes(safe)}</button>`) +
      `<div class="content col gap16">
        <div class="note small row nowrap">${icon("shield-check", 16)}<span>${L("Never offered here: photos that are posted, picked (flag or 4-5 stars), in a yearbook, or have someone named in them. “Clean everything safe” only moves exact copies to the Bin, removes empty folders and clears the preview cache. The Bin keeps photos for 30 days.", "لا يُعرض هنا أبدًا: الصور المنشورة أو المختارة (علامة أو 4-5 نجوم) أو الموجودة في كتاب سنوي أو فيها شخص مسمّى. «نظّف كل ما هو آمن» ينقل النسخ المطابقة فقط إلى السلة، ويحذف المجلدات الفارغة، ويمسح ذاكرة المعاينة. تحتفظ السلة بالصور 30 يومًا.")}</span></div>
        <div class="grid3">
          ${CLEAN_KINDS().map((k) => {
            const x = r[k.id];
            const body = k.id === "rejected" ? L(`Photos you rejected more than ${r.rejected.months} months ago.`, `صور رفضتها قبل أكثر من ${num(r.rejected.months)} أشهر.`) : k.body;
            return `<div class="card clc"><div class="row nowrap"><span class="sic">${icon(k.icon, 16)}</span><h3 class="grow">${k.title}</h3>${k.safe ? `<span class="tag good">${L("Safe", "آمن")}</span>` : ""}</div>
              <p class="small muted">${body}</p>
              <div class="row nowrap"><b style="font-size: 20px">${num(x.count)}</b><span class="muted small grow">${L("photos", "صورة")} · ${fmtBytes(x.size)}</span>
              ${x.count ? `<button class="btn small" data-review="${k.id}">${L("Review", "مراجعة")}</button>` : `<span class="tag good">${icon("check", 11)}</span>`}</div></div>`;
          }).join("")}
          <div class="card clc"><div class="row nowrap"><span class="sic">${icon("folder-x", 16)}</span><h3 class="grow">${L("Empty folders", "مجلدات فارغة")}</h3><span class="tag good">${L("Safe", "آمن")}</span></div>
            <p class="small muted">${L("Folders left with nothing in them after moving photos.", "مجلدات أصبحت فارغة بعد نقل الصور.")}</p>
            <div class="row nowrap"><b style="font-size: 20px">${num(r.empty)}</b><span class="grow"></span>${r.empty ? `<button class="btn small" id="cl-empty">${L("Remove", "حذف")}</button>` : `<span class="tag good">${icon("check", 11)}</span>`}</div></div>
          <div class="card clc"><div class="row nowrap"><span class="sic">${icon("hard-drive", 16)}</span><h3 class="grow">${L("Preview cache", "ذاكرة المعاينة")}</h3><span class="tag good">${L("Safe", "آمن")}</span></div>
            <p class="small muted">${L("Big previews the app made. They are made again when needed.", "معاينات كبيرة صنعها التطبيق، وتُصنع مجددًا عند الحاجة.")}</p>
            <div class="row nowrap"><b style="font-size: 20px">${fmtBytes(r.cache)}</b><span class="grow"></span>${r.cache ? `<button class="btn small" id="cl-cache">${L("Clear", "مسح")}</button>` : `<span class="tag good">${icon("check", 11)}</span>`}</div></div>
          <div class="card clc"><div class="row nowrap"><span class="sic">${icon("sliders-horizontal", 16)}</span><h3 class="grow">${L("How strict", "درجة الصرامة")}</h3></div>
            <div class="row"><span class="small grow">${L("Bad photos", "الصور الضعيفة")}</span>${pillMenu("cl-strict", "", [["gentle", L("Gentle", "لطيف")], ["normal", L("Normal", "عادي")], ["strict", L("Strict", "صارم")]], r.strict)}</div>
            <div class="row"><span class="small grow">${L("Rejected photos older than", "صور مرفوضة أقدم من")}</span>${pillMenu("cl-months", "", [3, 6, 12, 24].map((m) => [m, L(`${m} months`, `${num(m)} أشهر`)]), r.rejected.months)}</div>
            <label class="row small"><span class="grow">${L("Remind me once a month", "ذكّرني مرة كل شهر")}</span>${sw('id="cl-remind"', S.cleanReminder)}</label></div>
        </div></div>`;
    $("#cl-bin", main).onclick = () => go("cleanup", { bin: true });
    $("#cl-safe", main).onclick = async () => {
      const x = await call("cleanSafe");
      toastAction(L(`Moved ${x.copies} copies to the Bin, removed ${x.folders} empty folders. Freed about ${fmtBytes(x.freed)}.`, `نُقلت ${num(x.copies)} نسخة إلى السلة، وحُذف ${num(x.folders)} مجلد فارغ. تحرّر نحو ${fmtBytes(x.freed)}.`), L("Undo", "تراجع"), () => doUndo(), 8000);
      go("cleanup");
    };
    $("#cl-empty", main)?.addEventListener("click", async () => {
      const n = await call("removeEmptyFolders");
      toast(L(`Removed ${n} empty folders`, `حُذف ${num(n)} مجلد فارغ`));
      go("cleanup");
    });
    $("#cl-cache", main)?.addEventListener("click", async () => {
      await call("clearPreviews");
      go("cleanup");
    });
    bindPillMenu(main, "cl-strict", [["gentle", L("Gentle: only the worst", "لطيف: الأسوأ فقط")], ["normal", L("Normal", "عادي")], ["strict", L("Strict: catch more", "صارم: يلتقط أكثر")]], r.strict, async (v) => { await setSetting("cleanStrict", v ?? "normal"); go("cleanup"); }, { any: false });
    bindPillMenu(main, "cl-months", [3, 6, 12, 24].map((m) => [m, L(`${m} months`, `${num(m)} أشهر`)]), r.rejected.months, async (v) => { await setSetting("rejectMonths", Number(v)); go("cleanup"); }, { any: false });
    $("#cl-remind", main).onchange = (e) => setSetting("cleanReminder", e.target.checked);
    $$("[data-review]", main).forEach((b) => (b.onclick = () => cleanReview(b.dataset.review)));
  },

  // The Bin: what's in it, how many days each has left, put back or empty.
  async bin(main) {
    const rows = (await quiet("binList")) ?? [];
    const sel = new Set();
    const draw = () => {
      main.innerHTML = topbar(L("Bin", "السلة"), L("Photos stay here for 30 days, then go to the computer's Trash.", "تبقى الصور هنا 30 يومًا، ثم تذهب إلى سلة المهملات في الجهاز."),
        `<button class="btn" id="bn-back">${icon("chevron-left", 14)} ${L("Clean up", "تنظيف")}</button>${rows.length ? `<button class="btn" id="bn-empty">${icon("trash-2", 14)} ${L("Empty the Bin now", "إفراغ السلة الآن")}</button>` : ""}`) +
        `<div class="content flush"><div class="gridwrap">${rows.length ? `<div class="cgrid">${rows.map((p) => `<div class="ctile ${sel.has(p.id) ? "on" : ""}" data-b="${p.id}"><img loading="lazy" src="hub://thumb/${p.id}" /><span class="tick">${icon("check", 11)}</span>
            <span class="tag tiny best">${L(`${p.daysLeft} days`, `${num(p.daysLeft)} يوم`)}</span></div>`).join("")}</div>`
          : emptyState("trash-2", L("The Bin is empty", "السلة فارغة"))}
          ${sel.size ? `<div class="selbar"><b>${L(`${sel.size} selected`, `${num(sel.size)} محدد`)}</b><button class="btn ghost small" id="bn-put">${icon("undo-2", 14)} ${L("Put back", "إعادة")}</button><button class="btn ghost small" id="bn-x">${icon("x", 14)}</button></div>` : ""}</div></div>`;
      $("#bn-back", main).onclick = () => go("cleanup");
      $("#bn-empty", main)?.addEventListener("click", async () => {
        if (!(await confirmBox(L(`Move all ${rows.length} photos in the Bin to the computer's Trash now?`, `نقل كل ${num(rows.length)} صورة في السلة إلى سلة المهملات الآن؟`), L("Empty", "إفراغ")))) return;
        await call("emptyBinNow");
        go("cleanup", { bin: true });
      });
      $$("[data-b]", main).forEach((t) => (t.onclick = (e) => {
        const id = Number(t.dataset.b);
        if (e.detail === 2) return openViewer(rows.map((r) => r.id), rows.findIndex((r) => r.id === id), {});
        sel.has(id) ? sel.delete(id) : sel.add(id);
        draw();
      }));
      onContext(main, "[data-b]", (t) => [{ label: L("Put back", "إعادة"), run: () => putBack([Number(t.dataset.b)]) }]);
      $("#bn-put", main)?.addEventListener("click", () => putBack([...sel]));
      $("#bn-x", main)?.addEventListener("click", () => { sel.clear(); draw(); });
    };
    const putBack = async (ids) => {
      await call("restoreBin", ids);
      toast(L(`${ids.length} photos put back where they were`, `أُعيدت ${num(ids.length)} صورة إلى مكانها`));
      go("cleanup", { bin: true });
    };
    draw();
  },
};
App.views.duplicates = App.views.cleanup;

// One kind of clean-up, photo by photo. Groups show the best one to keep
// (green) and tick the rest; any tick can be changed, and a photo can be
// made the one kept. Right-click for more.
async function cleanReview(kind) {
  const k = CLEAN_KINDS().find((x) => x.id === kind);
  const r = await call("cleanupList", kind);
  const binned = new Set();
  const ticked = new Set();
  const groups = r.groups ? r.groups.slice(0, 300).map((g) => ({ ...g, all: [g.keep, ...g.extra] })) : null;
  if (groups) groups.forEach((g) => g.extra.forEach((id) => ticked.add(id)));
  else r.photos.forEach((p) => ticked.add(p.id));
  const tile = (id, opts = {}) => `<div class="ctile ${ticked.has(id) ? "on" : ""} ${opts.keep ? "keep" : ""}" data-t="${id}"><img loading="lazy" src="hub://thumb/${id}" />
    <span class="tick">${icon("check", 11)}</span>${opts.keep ? `<span class="tag good tiny best">${L("Best: keep", "الأفضل: يبقى")}</span>` : opts.locked ? `<span class="tag tiny best">${icon("lock", 10)} ${L("Kept", "يبقى")}</span>` : opts.reason ? `<span class="tag warn tiny best">${esc(REASONS()[opts.reason] ?? opts.reason)}</span>` : ""}</div>`;
  const body = () =>
    groups
      ? groups.filter((g) => !g.done).map((g, i) => `<div class="cgroup" data-g="${groups.indexOf(g)}"><div class="row" style="gap: 8px">${g.all.map((id) => tile(id, { keep: id === g.keep })).join("")}${(g.kept ?? []).map((id) => tile(id, { locked: true })).join("")}</div>
          <button class="btn small" data-bin-g="${groups.indexOf(g)}">${L("Bin the ticked", "المحدد إلى السلة")}</button></div>`).join("")
      : `<div class="row" style="gap: 8px">${r.photos.filter((p) => !binned.has(p.id)).map((p) => tile(p.id, { reason: p.reason })).join("")}</div>`;
  const count = () => [...ticked].filter((id) => !binned.has(id)).length;
  const m = modal(`<div class="row nowrap"><span class="sic">${icon(k.icon, 16)}</span><h2 class="grow">${k.title}</h2><button class="btn primary" id="cr-all"></button><button class="btn ghost" id="cr-close">${icon("x")}</button></div>
    <p class="muted small">${groups ? L("The green one is recommended to keep; the ticked ones go to the Bin. Click to change a tick, double-click to look closer, right-click to keep a different one.", "الأخضر مقترح للإبقاء، والمحدد يذهب إلى السلة. اضغط لتغيير التحديد، وانقر مرتين للنظر عن قرب، وانقر بالزر الأيمن لإبقاء صورة أخرى.") : L("Ticked photos go to the Bin. Click to untick any you want to keep.", "الصور المحددة تذهب إلى السلة. اضغط لإلغاء تحديد ما تريد إبقاءه.")}</p>
    <div id="cr-body" style="max-height: 62vh; overflow-y: auto"></div>`, { wide: true });
  const draw = () => {
    $("#cr-body", m).innerHTML = body() || emptyState("circle-check", L("All done", "انتهى"));
    $("#cr-all", m).textContent = L(`Bin ${count()} ticked`, `${num(count())} محدد إلى السلة`);
    $("#cr-all", m).disabled = !count();
    $$("[data-t]", m).forEach((t) => (t.onclick = (e) => {
      const id = Number(t.dataset.t);
      if (e.detail === 2) return openViewer([id], 0, {});
      const g = groups?.find((x) => x.all.includes(id));
      if (!g && groups) return;
      ticked.has(id) ? ticked.delete(id) : ticked.add(id);
      // Never every photo of a group.
      if (g && g.all.every((x) => ticked.has(x))) ticked.delete(g.keep === id ? g.all.find((x) => x !== id) : g.keep);
      draw();
    }));
    $$("[data-bin-g]", m).forEach((b) => (b.onclick = async () => {
      const g = groups[Number(b.dataset.binG)];
      const ids = g.all.filter((id) => ticked.has(id));
      if (!ids.length) return;
      await call("bin", ids);
      ids.forEach((id) => binned.add(id));
      g.done = true;
      toastAction(L(`${ids.length} moved to the Bin`, `نُقلت ${num(ids.length)} إلى السلة`), L("Undo", "تراجع"), () => doUndo());
      draw();
    }));
  };
  onContext(m, "[data-t]", (t) => {
    const id = Number(t.dataset.t);
    const g = groups?.find((x) => x.all.includes(id));
    return [
      { label: L("Look closer", "نظرة أقرب"), run: () => openViewer([id], 0, {}) },
      { label: L("Show in Finder", "عرض في Finder"), run: () => call("reveal", id) },
      "-",
      g && { label: L("Keep this one instead", "إبقاء هذه بدلًا منها"), run: () => { g.keep = id; g.all.forEach((x) => (x === id ? ticked.delete(x) : ticked.add(x))); draw(); } },
      { label: ticked.has(id) ? L("Keep", "إبقاء") : L("Bin", "إلى السلة"), run: () => { ticked.has(id) ? ticked.delete(id) : ticked.add(id); draw(); } },
    ];
  });
  $("#cr-close", m).onclick = () => { closeOverlay(); if (binned.size) go("cleanup"); };
  $("#cr-all", m).onclick = async () => {
    const ids = [...ticked].filter((id) => !binned.has(id));
    if (!ids.length) return;
    const n = await call("bin", ids);
    closeOverlay();
    toastAction(L(`${n} photos moved to the Bin`, `نُقلت ${num(n)} صورة إلى السلة`), L("Undo", "تراجع"), () => doUndo(), 8000);
    go("cleanup");
  };
  draw();
}
