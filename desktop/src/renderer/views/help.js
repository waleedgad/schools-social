// Help: short guides in Arabic and English.
const GUIDES = () => [
  {
    id: "start", icon: "◎", title: L("Getting started", "البداية"),
    body: L(
      `<ol><li>Sign in with your website account (Settings → Account).</li><li>Choose the photo library folder or drive. The app reads it in place: nothing is moved or changed.</li><li>Import the class lists (Students → Import class list). Excel files from PowerSchool, Classera and Edunation work as they are.</li><li>Name a few children in <b>Faces → Who is this?</b>. The Mac then finds them in the other photos and asks you to confirm.</li><li>Pick your best photos with <span class="k">P</span> and make a post.</li></ol>`,
      `<ol><li>سجّل الدخول بحساب الموقع (الإعدادات ← الحساب).</li><li>اختر مجلد أو قرص مكتبة الصور. يقرؤه التطبيق في مكانه دون نقل أو تغيير أي شيء.</li><li>استورد قوائم الفصول (الطلاب ← استيراد قائمة الفصول). ملفات Excel من PowerSchool وClassera وEdunation تعمل كما هي.</li><li>سمِّ بعض الأطفال في <b>الوجوه ← من هذا؟</b>. سيجدهم الماك في باقي الصور ويطلب تأكيدك.</li><li>اختر أفضل الصور بـ <span class="k">P</span> وأنشئ منشورًا.</li></ol>`,
    ),
  },
  {
    id: "library", icon: "▦", title: L("How the library is organised", "تنظيم المكتبة"),
    body: L(
      `<p>Each event is a folder: <span class="ltr">2026-2027 / Term 1 / 2026-10-20 Science fair / 4B</span>. The last folder (4B) is the class and is optional.</p><ul><li>Rename or move photos in the app (or in Finder): names, picks and ratings stay with them.</li><li>The same photo copied twice appears in <b>Duplicates</b>; extra copies go to the Bin, never deleted outright.</li><li>RAW files are shown from the preview inside them; a RAW and JPEG of the same shot count as one photo.</li><li>Edited copies saved next to the original with <b>-edit</b> in the name are linked to it: press <span class="k">B</span> for before and after.</li></ul>`,
      `<p>كل فعالية مجلد: <span class="ltr">2026-2027 / Term 1 / 2026-10-20 Science fair / 4B</span>. المجلد الأخير (4B) هو الفصل وهو اختياري.</p><ul><li>أعد تسمية الصور أو انقلها من التطبيق (أو من Finder): تبقى الأسماء والاختيارات والتقييمات معها.</li><li>الصورة المنسوخة مرتين تظهر في <b>المكررات</b>، وتذهب النسخ الزائدة إلى السلة ولا تُحذف نهائيًا.</li><li>تُعرض ملفات RAW من المعاينة داخلها، وتُحسب RAW وJPEG للقطة نفسها صورة واحدة.</li><li>النسخ المعدّلة المحفوظة بجانب الأصل مع <b>-edit</b> في الاسم ترتبط به: اضغط <span class="k">B</span> لقبل وبعد.</li></ul>`,
    ),
  },
  {
    id: "cull", icon: "▶", title: L("Culling keys", "مفاتيح الفرز"),
    body: `<table class="list"><tbody>
      <tr><td><span class="k">P</span></td><td>${L("Pick (good for posts)", "اختيار (صالحة للمنشورات)")}</td></tr>
      <tr><td><span class="k">X</span></td><td>${L("Reject", "رفض")}</td></tr>
      <tr><td><span class="k">U</span></td><td>${L("Clear pick or reject", "إلغاء الاختيار أو الرفض")}</td></tr>
      <tr><td><span class="k">1</span>–<span class="k">5</span></td><td>${L("Stars (0 clears)", "النجوم (0 يمسح)")}</td></tr>
      <tr><td><span class="k">T</span></td><td>${L("Tag a child", "وسم طفل")}</td></tr>
      <tr><td><span class="k">Y</span> / <span class="k">N</span></td><td>${L("Yes or no to the names the Mac suggests", "نعم أو لا للأسماء التي يقترحها الماك")}</td></tr>
      <tr><td><span class="k">B</span></td><td>${L("Before and after (edited copies)", "قبل وبعد (النسخ المعدّلة)")}</td></tr>
      <tr><td><span class="k">C</span></td><td>${L("Compare with the next shot", "مقارنة مع اللقطة التالية")}</td></tr>
      <tr><td><span class="k">F</span></td><td>${L("Show or hide face boxes", "إظهار أو إخفاء مربعات الوجوه")}</td></tr>
      <tr><td><span class="k">⌘K</span></td><td>${L("Search anything", "البحث عن أي شيء")}</td></tr>
      <tr><td><span class="k">⌘Z</span></td><td>${L("Undo", "تراجع")}</td></tr></tbody></table>
      <p class="muted">${L("Press “Cull” in the Library: P and X move to the next photo by themselves.", "اضغط «فرز» في المكتبة: ينتقل P وX إلى الصورة التالية تلقائيًا.")}</p>`,
  },
  {
    id: "faces", icon: "☺", title: L("Faces and privacy", "الوجوه والخصوصية"),
    body: L(
      `<ul><li>Faces are found and matched on this Mac. Face data is never sent to the website or to any AI service.</li><li>Portraits named by student ID (S24001.jpg) teach the Mac each child's face from day one.</li><li>Every name the Mac suggests waits for your yes. A wrong suggestion you say no to is never suggested again for that face.</li><li>Children marked “can't appear in posts” are flagged on their photos (⛔). The website blocks a post with one of those photos.</li></ul>`,
      `<ul><li>تُكتشف الوجوه وتُطابق على هذا الماك. لا تُرسل بيانات الوجوه إلى الموقع أو أي خدمة ذكاء اصطناعي أبدًا.</li><li>الصور الشخصية بأسماء أرقام الطلاب (S24001.jpg) تعلّم الماك وجه كل طفل من اليوم الأول.</li><li>كل اسم يقترحه الماك ينتظر موافقتك. الاقتراح الخاطئ الذي ترفضه لا يُقترح مرة أخرى لذلك الوجه.</li><li>الأطفال المحددون «لا يظهرون في المنشورات» تُعلَّم صورهم (⛔)، ويمنع الموقع نشر أي منها.</li></ul>`,
    ),
  },
  {
    id: "lists", icon: "☷", title: L("Class lists", "قوائم الفصول"),
    body: L(
      `<p>Columns can be in any order, in Arabic or English. Recognised as they are: <b>PowerSchool</b> student exports, <b>Classera</b> student lists (Arabic headers), <b>Edunation</b> student lists, and our own template (Student ID, Name (English), Name (Arabic), Gender, Stage, Grade, Class, Portrait file, Can appear in posts).</p><p>Importing again updates students by ID, so you can re-import the list each term.</p>`,
      `<p>يمكن أن تكون الأعمدة بأي ترتيب، بالعربية أو الإنجليزية. يتعرّف التطبيق مباشرة على: صادرات الطلاب من <b>PowerSchool</b>، وقوائم <b>Classera</b> (عناوين عربية)، وقوائم <b>Edunation</b>، وقالبنا (Student ID، Name (English)، Name (Arabic)، Gender، Stage، Grade، Class، Portrait file، Can appear in posts).</p><p>إعادة الاستيراد تحدّث الطلاب حسب الرقم، فيمكنك إعادة استيراد القائمة كل فصل دراسي.</p>`,
    ),
  },
  {
    id: "posts", icon: "✎", title: L("Making posts", "إنشاء المنشورات"),
    body: L(
      `<ol><li>Select photos (or press <b>Best photos</b> to let the Mac choose), then <b>New post</b>.</li><li>Web copies of those photos are sent, and the post opens in the Posts tab, which is your website.</li><li>Write or generate the captions, choose Facebook and Instagram, and send it for approval. The principal can approve from a phone.</li></ol><p class="muted">The first time, sign in to the website inside the Posts tab once.</p>`,
      `<ol><li>حدد الصور (أو اضغط <b>أفضل الصور</b> ليختار الماك)، ثم <b>منشور جديد</b>.</li><li>تُرسل نسخ ويب من الصور، ويُفتح المنشور في تبويب المنشورات، وهو موقعك.</li><li>اكتب التعليقات أو أنشئها، واختر فيسبوك وإنستجرام، وأرسله للموافقة. يمكن للمدير الموافقة من الهاتف.</li></ol><p class="muted">في المرة الأولى، سجّل الدخول إلى الموقع داخل تبويب المنشورات مرة واحدة.</p>`,
    ),
  },
];

App.views.help = {
  render(main, params) {
    const guides = GUIDES();
    const cur = guides.find((g) => g.id === params.id) ?? guides[0];
    main.innerHTML = topbar(L("Help", "المساعدة"), L("Short guides for every screen", "أدلة قصيرة لكل شاشة"), `<button class="btn" id="hp-report">${L("Report a problem", "الإبلاغ عن مشكلة")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree">${guides.map((g) => `<div class="t ${g.id === cur.id ? "on" : ""}" data-id="${g.id}"><span>${g.icon}</span><span class="name">${esc(g.title)}</span></div>`).join("")}</nav>
      <div class="gridwrap"><div class="content help"><div class="card" style="max-width: 760px"><h1>${cur.icon} ${esc(cur.title)}</h1>${cur.body}</div></div></div></div></div>`;
    $$("[data-id]", main).forEach((el) => (el.onclick = () => go("help", { id: el.dataset.id })));
    $("#hp-report", main).onclick = reportProblem;
  },
};
