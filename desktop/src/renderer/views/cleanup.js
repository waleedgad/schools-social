// Clean up: one page of cards, each saying how much space it frees. Every
// photo goes to the Bin (the Mac's Trash) first, and its web copy with it.
// RAW and JPEG pairs are always kept.

const CLEAN_KINDS = () => [
  { id: "exact", icon: "⧉", title: L("Exact copies", "نسخ مطابقة"), body: L("The same file twice. The first copy stays with all its names and picks.", "الملف نفسه مرتين. تبقى النسخة الأولى بكل أسمائها واختياراتها."), safe: true },
  { id: "sizes", icon: "⇲", title: L("Same photo, other sizes", "الصورة نفسها بأحجام أخرى"), body: L("Resized, exported or WhatsApp copies. The original, biggest one is kept. Edited versions stay.", "نسخ مصغّرة أو مُصدّرة أو من واتساب. يبقى الأصل الأكبر. تبقى النسخ المعدّلة.") },
  { id: "bursts", icon: "≋", title: L("Near-identical shots", "لقطات شبه متطابقة"), body: L("Shots seconds apart that look the same. The sharpest is kept.", "لقطات بفارق ثوانٍ تبدو متشابهة. تبقى الأوضح.") },
  { id: "bad", icon: "◌", title: L("Bad photos", "صور ضعيفة"), body: L("Blurry, too dark or too bright. Picked photos are never shown here.", "مهزوزة أو مظلمة جدًا أو ساطعة جدًا. لا تظهر هنا الصور المختارة.") },
  { id: "rejected", icon: "✕", title: L("Old rejected photos", "صور مرفوضة قديمة"), body: "" },
];

const REASONS = () => ({ blurry: L("Blurry", "مهزوزة"), dark: L("Too dark", "مظلمة"), bright: L("Too bright", "ساطعة") });

App.views.cleanup = {
  async render(main) {
    main.innerHTML = topbar(L("Clean up", "تنظيف"), L("Looking for space to free…", "جارٍ البحث عن مساحة يمكن تحريرها…")) + `<div class="content"><div class="muted">${L("Loading…", "جارٍ التحميل…")}</div></div>`;
    const r = await quiet("cleanup");
    if (!r) return;
    const total = r.exact.size + r.sizes.size + r.bursts.size + r.bad.size + r.rejected.size + r.cache;
    const safe = r.exact.size + r.cache;
    main.innerHTML =
      topbar(L("Clean up", "تنظيف"), L(`Up to ${fmtBytes(total)} can be freed`, `يمكن تحرير حتى ${fmtBytes(total)}`), `<button class="btn" id="cl-bin">🗑 ${L("Open Bin", "فتح السلة")}</button><button class="btn primary" id="cl-safe" ${safe || r.empty ? "" : "disabled"}>✓ ${L("Clean everything safe", "نظّف كل ما هو آمن")} · ${fmtBytes(safe)}</button>`) +
      `<div class="content col gap16">
        <p class="muted small">${L("“Clean everything safe” only moves exact copies to the Bin, removes empty folders and clears the preview cache. The Bin keeps photos for 30 days. RAW and JPEG pairs are always kept.", "«نظّف كل ما هو آمن» ينقل النسخ المطابقة فقط إلى السلة، ويحذف المجلدات الفارغة، ويمسح ذاكرة المعاينة. تحتفظ السلة بالصور 30 يومًا. تبقى أزواج RAW وJPEG دائمًا.")}</p>
        <div class="grid3">
          ${CLEAN_KINDS().map((k) => {
            const x = r[k.id];
            const body = k.id === "rejected" ? L(`Photos you rejected more than ${r.rejected.months} months ago.`, `صور رفضتها قبل أكثر من ${num(r.rejected.months)} أشهر.`) : k.body;
            return `<div class="card"><div class="row nowrap"><span style="font-size: 20px">${k.icon}</span><h3 class="grow">${k.title}</h3>${k.safe ? `<span class="tag good">${L("Safe", "آمن")}</span>` : ""}</div>
              <p class="small muted">${body}</p>
              <div class="row nowrap"><b style="font-size: 20px">${num(x.count)}</b><span class="muted small grow">${L("photos", "صورة")} · ${fmtBytes(x.size)}</span>
              ${x.count ? `<button class="btn small" data-review="${k.id}">${L("Review", "مراجعة")}</button>` : `<span class="tag good">✓</span>`}</div></div>`;
          }).join("")}
          <div class="card"><div class="row nowrap"><span style="font-size: 20px">▢</span><h3 class="grow">${L("Empty folders", "مجلدات فارغة")}</h3><span class="tag good">${L("Safe", "آمن")}</span></div>
            <p class="small muted">${L("Folders left with nothing in them after moving photos.", "مجلدات أصبحت فارغة بعد نقل الصور.")}</p>
            <div class="row nowrap"><b style="font-size: 20px">${num(r.empty)}</b><span class="grow"></span>${r.empty ? `<button class="btn small" id="cl-empty">${L("Remove", "حذف")}</button>` : `<span class="tag good">✓</span>`}</div></div>
          <div class="card"><div class="row nowrap"><span style="font-size: 20px">◫</span><h3 class="grow">${L("Preview cache", "ذاكرة المعاينة")}</h3><span class="tag good">${L("Safe", "آمن")}</span></div>
            <p class="small muted">${L("Big previews the app made. They are made again when needed.", "معاينات كبيرة صنعها التطبيق، وتُصنع مجددًا عند الحاجة.")}</p>
            <div class="row nowrap"><b style="font-size: 20px">${fmtBytes(r.cache)}</b><span class="grow"></span>${r.cache ? `<button class="btn small" id="cl-cache">${L("Clear", "مسح")}</button>` : `<span class="tag good">✓</span>`}</div></div>
          <div class="card"><div class="row nowrap"><span style="font-size: 20px">⚙</span><h3 class="grow">${L("How strict", "درجة الصرامة")}</h3></div>
            <label class="field">${L("Bad photos", "الصور الضعيفة")}<select id="cl-strict">${[["gentle", L("Gentle: only the worst", "لطيف: الأسوأ فقط")], ["normal", L("Normal", "عادي")], ["strict", L("Strict: catch more", "صارم: يلتقط أكثر")]].map(([v, t]) => `<option value="${v}" ${r.strict === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
            <label class="field">${L("Rejected photos older than", "صور مرفوضة أقدم من")}<select id="cl-months">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${r.rejected.months === m ? "selected" : ""}>${L(`${m} months`, `${num(m)} أشهر`)}</option>`).join("")}</select></label></div>
        </div></div>`;
    $("#cl-bin", main).onclick = () => call("openBin");
    $("#cl-safe", main).onclick = async () => {
      const x = await call("cleanSafe");
      toast(L(`Moved ${x.copies} copies to the Bin, removed ${x.folders} empty folders. Freed about ${fmtBytes(x.freed)}.`, `نُقلت ${num(x.copies)} نسخة إلى السلة، وحُذف ${num(x.folders)} مجلد فارغ. تحرّر نحو ${fmtBytes(x.freed)}.`), { ms: 7000 });
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
    $("#cl-strict", main).onchange = async (e) => { await call("set", "cleanStrict", e.target.value); go("cleanup"); };
    $("#cl-months", main).onchange = async (e) => { await call("set", "rejectMonths", Number(e.target.value)); go("cleanup"); };
    $$("[data-review]", main).forEach((b) => (b.onclick = () => cleanReview(b.dataset.review)));
  },
};
App.views.duplicates = App.views.cleanup;

async function cleanReview(kind) {
  const k = CLEAN_KINDS().find((x) => x.id === kind);
  const r = await call("cleanupList", kind);
  const thumb = (id, extra = "") => `<img src="hub://thumb/${id}" data-open="${id}" style="width: 84px; height: 84px; object-fit: cover; border-radius: 7px; cursor: zoom-in; ${extra}" />`;
  let body;
  let all = [];
  if (r.groups) {
    all = r.groups.flatMap((g) => g.extra);
    body = r.groups
      .slice(0, 200)
      .map((g, i) => `<div class="row nowrap" data-g="${i}" style="padding: 8px 0; border-bottom: 1px solid var(--line)">
        <div style="position: relative">${thumb(g.keep, "outline: 3px solid var(--good)")}<span class="tag good" style="position: absolute; bottom: 4px; inset-inline-start: 4px">${L("Keep", "يبقى")}</span></div>
        <div class="row grow" style="gap: 6px">${g.extra.map((id) => thumb(id, "opacity: .75")).join("")}</div>
        <button class="btn small" data-bin-g="${i}">${L("Keep best, Bin the rest", "أبقِ الأفضل، والباقي للسلة")}</button></div>`)
      .join("");
  } else {
    all = r.photos.map((p) => p.id);
    body = `<div class="row" style="gap: 8px">${r.photos
      .map((p) => `<div style="position: relative" data-p="${p.id}">${thumb(p.id)}${p.reason ? `<span class="tag warn" style="position: absolute; bottom: 4px; inset-inline-start: 4px">${esc(REASONS()[p.reason] ?? p.reason)}</span>` : ""}<button class="btn small" data-keep="${p.id}" title="${L("Keep this one", "أبقِ هذه")}" style="position: absolute; top: 4px; inset-inline-end: 4px; padding: 0 6px">✓</button></div>`)
      .join("")}</div>`;
  }
  const keep = new Set();
  const m = modal(`<div class="row nowrap"><h2 class="grow">${k.icon} ${k.title}</h2><button class="btn primary" id="cr-all">${L(`Bin all ${all.length}`, `الكل إلى السلة (${num(all.length)})`)}</button><button class="btn" id="cr-close">✕</button></div>
    <p class="muted small">${r.groups ? L("Green is kept. Click a photo to look closer.", "الأخضر يبقى. اضغط على صورة لرؤيتها عن قرب.") : L("Press ✓ on any photo you want to keep. The rest go to the Bin.", "اضغط ✓ على أي صورة تريد إبقاءها. الباقي يذهب إلى السلة.")}</p>
    <div style="max-height: 62vh; overflow-y: auto">${body}</div>`, { wide: true });
  $("#cr-close", m).onclick = closeOverlay;
  $$("[data-open]", m).forEach((img) => (img.onclick = () => call("reveal", Number(img.dataset.open))));
  $$("[data-keep]", m).forEach((b) => (b.onclick = () => {
    const id = Number(b.dataset.keep);
    if (keep.has(id)) keep.delete(id);
    else keep.add(id);
    b.classList.toggle("primary", keep.has(id));
    b.closest("[data-p]").style.opacity = keep.has(id) ? "1" : "";
  }));
  $$("[data-bin-g]", m).forEach((b) => (b.onclick = async () => {
    const g = r.groups[Number(b.dataset.binG)];
    await call("bin", g.extra);
    b.closest("[data-g]").remove();
    toast(L(`${g.extra.length} moved to the Bin`, `نُقلت ${num(g.extra.length)} إلى السلة`));
  }));
  $("#cr-all", m).onclick = async () => {
    const ids = all.filter((id) => !keep.has(id));
    if (!ids.length) return;
    const n = await call("bin", ids);
    closeOverlay();
    toast(L(`${n} photos moved to the Bin`, `نُقلت ${num(n)} صورة إلى السلة`));
    go("cleanup");
  };
}
