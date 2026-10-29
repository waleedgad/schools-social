// Help: a short guide for every screen in Arabic and English, guides for
// each role, short videos, a tour of the app, what's new, whether
// everything is working, problem reports and WhatsApp support. The "?" at
// the top of every screen opens that screen's guide.

const HELP_VIDEOS = () => [
  ["tour", L("A two-minute tour", "جولة في دقيقتين")],
  ["import", L("Importing a memory card", "استيراد بطاقة ذاكرة")],
  ["faces", L("Naming faces", "تسمية الوجوه")],
  ["post", L("Making a post from an event", "إنشاء منشور من فعالية")],
  ["calendar", L("Planning the week", "تخطيط الأسبوع")],
  ["book", L("Making a yearbook", "إنشاء كتاب سنوي")],
];

const GUIDES = () => [
  {
    id: "start", group: "basics", icon: "rocket", title: L("Getting started", "البداية"),
    body: L(
      `<ol><li>Sign in with your website account (Settings → Account).</li><li>Choose the photo library folder or drive (Settings → Library). The app reads it in place.</li><li>Import the class lists (Students → Import class list). Excel files from PowerSchool, Classera and Edunation work as they are.</li><li>Name a few students in <b>Faces → Who is this?</b>. The Mac then finds them in the other photos and asks you to confirm.</li><li>Pick your best photos with <span class="k">P</span>, then <b>Make posts</b>.</li></ol><p>Today shows a set-up list until every step is done, on the Mac and on the website.</p>`,
      `<ol><li>سجّل الدخول بحساب الموقع (الإعدادات ← الحساب).</li><li>اختر مجلد أو قرص مكتبة الصور (الإعدادات ← المكتبة). يقرؤه التطبيق في مكانه.</li><li>استورد قوائم الفصول (الطلاب ← استيراد قائمة الفصول). ملفات Excel من PowerSchool وClassera وEdunation تعمل كما هي.</li><li>سمِّ بعض الطلاب في <b>الوجوه ← من هذا؟</b>. سيجدهم الماك في باقي الصور ويطلب تأكيدك.</li><li>اختر أفضل الصور بـ <span class="k">P</span> ثم <b>إنشاء منشورات</b>.</li></ol><p>تعرض صفحة اليوم قائمة الإعداد حتى تكتمل كل الخطوات على الماك والموقع.</p>`,
    ),
  },
  {
    id: "today", group: "screens", icon: "house", title: L("Today", "اليوم"),
    body: L(
      `<p>Your morning page: what needs you now. Cards show the week's posting plan, posts waiting for someone (with <b>Remind</b>), events without photos, recent imports, picks not yet posted, students not seen for three weeks, occasions coming up and this day last year.</p><p><b>Customise</b> moves, hides and adds cards. The layout follows you to other computers and starts from your role.</p>`,
      `<p>صفحتك الصباحية: ما يحتاجك الآن. البطاقات تعرض خطة النشر للأسبوع، والمنشورات المنتظرة عند أحد (مع <b>تذكير</b>)، والفعاليات بلا صور، وآخر الاستيرادات، والمختارة غير المنشورة، والطلاب الذين لم يظهروا منذ ثلاثة أسابيع، والمناسبات القادمة، وهذا اليوم العام الماضي.</p><p><b>تخصيص</b> ينقل البطاقات ويخفيها ويضيفها. يتبعك الترتيب إلى الأجهزة الأخرى ويبدأ حسب دورك.</p>`,
    ),
  },
  {
    id: "library", group: "screens", icon: "images", title: L("Library", "المكتبة"),
    body: L(
      `<p>Each event is a folder: <span class="ltr">2026-2027 / Term 1 / 2026-10-20 Science fair / 4B</span>. The last folder (the class) is optional.</p><ul><li>Smart albums, colour labels, people and occasions are in the sidebar. Right-click anything for more.</li><li><b>Cull</b> mode: <span class="k">P</span> pick, <span class="k">X</span> reject, the next photo comes by itself.</li><li>Copies of the same photo go to the Bin, never deleted outright. RAW and JPEG of one shot count as one.</li><li>A photo whose original is missing shows its small copy and “Original missing”, with <b>Find missing</b> to reconnect a moved folder.</li></ul>`,
      `<p>كل فعالية مجلد: <span class="ltr">2026-2027 / Term 1 / 2026-10-20 Science fair / 4B</span>. المجلد الأخير (الفصل) اختياري.</p><ul><li>الألبومات الذكية والألوان والأشخاص والمناسبات في الشريط الجانبي. انقر بالزر الأيمن على أي شيء لخيارات أكثر.</li><li>وضع <b>الفرز</b>: <span class="k">P</span> اختيار و<span class="k">X</span> رفض، وتأتي الصورة التالية تلقائياً.</li><li>نسخ الصورة نفسها تذهب إلى السلة ولا تُحذف نهائياً. RAW وJPEG للقطة واحدة تُحسب صورة واحدة.</li><li>الصورة التي فُقد أصلها تظهر بنسختها الصغيرة مع «الأصل مفقود» وزر <b>ابحث عن المفقود</b> لإعادة ربط مجلد نُقل.</li></ul>`,
    ),
  },
  {
    id: "import", group: "screens", icon: "download", title: L("Import", "الاستيراد"),
    body: L(
      `<ol><li>Plug in a card or iPhone, or choose folders (several at once is fine). Drive and OneDrive links work too.</li><li>The preview shows every photo, already ticked. Untick what you don't want; blurry and screenshot-like files are left out for you.</li><li>Photos are grouped into events by time gaps and named from the school calendar. Fix a name or a camera clock before you start.</li><li>Copies are checked before anything is removed from the card. You can keep working while it runs; it carries on after a restart.</li></ol><p>History → Imports undoes a whole import.</p>`,
      `<ol><li>وصّل بطاقة أو آيفون، أو اختر مجلدات (عدة مجلدات معاً لا مشكلة). روابط Drive وOneDrive تعمل أيضاً.</li><li>المعاينة تعرض كل الصور محددة مسبقاً. ألغِ ما لا تريده؛ الصور المهزوزة ولقطات الشاشة مستبعدة تلقائياً.</li><li>تُجمع الصور في فعاليات حسب فترات الوقت وتُسمّى من تقويم المدرسة. صحّح الاسم أو ساعة الكاميرا قبل البدء.</li><li>تُفحص النسخ قبل حذف أي شيء من البطاقة. يمكنك مواصلة العمل أثناء الاستيراد، ويُكمل بعد إعادة التشغيل.</li></ol><p>السجل ← الاستيرادات يتراجع عن استيراد كامل.</p>`,
    ),
  },
  {
    id: "faces", group: "screens", icon: "scan-face", title: L("Faces", "الوجوه"),
    body: L(
      `<ul><li>Faces are found and matched on this Mac. Face data never goes to the website or to any AI.</li><li><b>Confirm</b> shows the face big with the whole photo beside it: <span class="k">Y</span> yes, <span class="k">N</span> no.</li><li><b>Who is this?</b> groups look-alike faces so one name covers many photos. Each yes makes the Mac look again at the rest.</li><li>Teachers, staff, parents and visitors can be named too. Hands, blurred and background faces go to “Not a face”.</li><li>Class photo mode names a whole row in order. Unsure ones can go to the class teacher's phone.</li></ul>`,
      `<ul><li>تُكتشف الوجوه وتُطابق على هذا الماك. لا تذهب بيانات الوجوه إلى الموقع أو أي ذكاء اصطناعي أبداً.</li><li><b>تأكيد</b> يعرض الوجه كبيراً مع الصورة كاملة بجانبه: <span class="k">Y</span> نعم و<span class="k">N</span> لا.</li><li><b>من هذا؟</b> يجمع الوجوه المتشابهة فيغطي اسم واحد صوراً كثيرة. كل «نعم» تجعل الماك يعيد البحث في الباقي.</li><li>يمكن تسمية المعلمين والموظفين وأولياء الأمور والزوار أيضاً. الأيدي والوجوه المهزوزة والخلفية تذهب إلى «ليس وجهاً».</li><li>وضع صورة الفصل يسمّي صفاً كاملاً بالترتيب. غير المؤكد يمكن إرساله لهاتف معلم الفصل.</li></ul>`,
    ),
  },
  {
    id: "students", group: "screens", icon: "users", title: L("Students and people", "الطلاب والأشخاص"),
    body: L(
      `<ul><li>Stage → Grade → Class in the sidebar, plus teachers, staff, parents, clubs and teams.</li><li>Each person's page shows their years at school, events, parents and siblings, clubs and achievements.</li><li>Importing a new class list shows what changed first (new, moved, left) before anything is saved.</li><li><b>New school year</b> moves every class up and marks graduates, with undo.</li><li>Students who can't appear in posts are marked; their faces are blurred on the website.</li></ul>`,
      `<ul><li>المرحلة ← الصف ← الفصل في الشريط الجانبي، مع المعلمين والموظفين وأولياء الأمور والأندية والفرق.</li><li>صفحة كل شخص تعرض سنواته في المدرسة وفعالياته وأولياء أمره وإخوته وأنديته وإنجازاته.</li><li>استيراد قائمة فصول جديدة يعرض التغييرات أولاً (جديد، منقول، غادر) قبل الحفظ.</li><li><b>عام دراسي جديد</b> ينقل كل الفصول للأعلى ويحدد الخريجين، مع إمكانية التراجع.</li><li>الطلاب الذين لا يظهرون في المنشورات محددون، وتُموّه وجوههم على الموقع.</li></ul>`,
    ),
  },
  {
    id: "coverage", group: "screens", icon: "chart-pie", title: L("Coverage", "التغطية"),
    body: L(
      `<p>Is every student in good photos and in posts? Only clear photos count (face big enough, in focus).</p><ul><li><b>Fair share</b> shows who is posted too often or not at all.</li><li><b>Fill the gap</b> picks photos of students not yet in a post and makes one.</li><li>A <b>shot list</b> for the photographer can go to their phone during the event.</li></ul>`,
      `<p>هل كل طالب في صور جيدة وفي منشورات؟ تُحسب الصور الواضحة فقط (وجه كبير بما يكفي وواضح).</p><ul><li><b>التوزيع العادل</b> يعرض من يُنشر كثيراً أو لا يُنشر أبداً.</li><li><b>سدّ الفجوة</b> يختار صور الطلاب الذين لم يظهروا في منشور وينشئ منشوراً.</li><li><b>قائمة لقطات</b> للمصوّر يمكن إرسالها لهاتفه أثناء الفعالية.</li></ul>`,
    ),
  },
  {
    id: "cleanup", group: "screens", icon: "sparkles", title: L("Clean up", "التنظيف"),
    body: L(
      `<p>Frees space safely. Posted photos, picks, 4–5 stars, named faces and yearbook photos are always protected.</p><ul><li>In each group the best one is in green; untick or right-click “Keep this one instead”.</li><li>Everything goes to the Bin for 30 days first. A monthly reminder tells you when there is a lot to free.</li></ul>`,
      `<p>يوفّر المساحة بأمان. الصور المنشورة والمختارة وذات 4–5 نجوم والوجوه المسماة وصور الكتب السنوية محمية دائماً.</p><ul><li>في كل مجموعة تظهر الأفضل بالأخضر؛ ألغِ التحديد أو انقر بالأيمن «احتفظ بهذه بدلاً منها».</li><li>كل شيء يذهب إلى السلة 30 يوماً أولاً. تذكير شهري يخبرك عندما يمكن توفير مساحة كبيرة.</li></ul>`,
    ),
  },
  {
    id: "books", group: "screens", icon: "book-open", title: L("Yearbooks", "الكتب السنوية"),
    body: L(
      `<ol><li><b>New yearbook</b>: a grade, a class, one student or a graduation (KG2 and Grade 12).</li><li>The Mac drafts the pages and spreads photos fairly. Lock a page (<span class="k">L</span>) to keep it when you redraft.</li><li>Checks show who is missing, low-resolution photos and anyone who can't appear.</li><li>Send it for review: class teachers check names on their phone and send texts for the class page.</li><li>Save a 300 dpi PDF with bleed and crop marks for the printer, or a flipbook for parents.</li></ol>`,
      `<ol><li><b>كتاب سنوي جديد</b>: لصف أو فصل أو طالب واحد أو للتخرج (KG2 والصف 12).</li><li>يرسم الماك الصفحات ويوزّع الصور بعدل. اقفل صفحة (<span class="k">L</span>) لتبقى عند إعادة الرسم.</li><li>الفحوص تعرض الغائبين والصور منخفضة الدقة ومن لا يمكن ظهوره.</li><li>أرسله للمراجعة: يراجع معلمو الفصول الأسماء على الهاتف ويرسلون نصوص صفحة الفصل.</li><li>احفظ ملف PDF بدقة 300 مع هوامش القص للمطبعة، أو كتاباً تقلّب صفحاته لأولياء الأمور.</li></ol>`,
    ),
  },
  {
    id: "posts", group: "screens", icon: "pen-line", title: L("Posts", "المنشورات"),
    body: L(
      `<ol><li><b>Make posts</b> from an event, a class, your picks or a student: one post, one per class or one per day. The AI can write the captions straight away.</li><li>The editor has four steps: <b>Photos</b> (order, cover, shape and frame made from the originals, collage, who's in it), <b>Words</b> (both languages, ready-made prompts, rewrite, spelling and brand check), <b>Details</b> (time, platforms, story, location) and <b>Team</b> (given to, notes, approval link, change history).</li><li><b>Before sending</b> lists what isn't ready yet, with a Fix button.</li></ol><p>Board, List and Instagram grid views; drag a card to move it.</p>`,
      `<ol><li><b>إنشاء منشورات</b> من فعالية أو فصل أو المختارة أو طالب: منشور واحد أو لكل فصل أو لكل يوم. ويمكن للذكاء الاصطناعي كتابة النصوص فوراً.</li><li>المحرر أربع خطوات: <b>الصور</b> (الترتيب والغلاف والشكل والإطار من الأصول والصورة المجمّعة ومن فيها)، <b>النص</b> (اللغتان والطلبات الجاهزة وإعادة الصياغة وفحص الإملاء والهوية)، <b>التفاصيل</b> (الوقت والمنصات والقصة والموقع) و<b>الفريق</b> (مسند إلى والملاحظات ورابط الاعتماد وسجل التغييرات).</li><li><b>قبل الإرسال</b> يعرض ما ليس جاهزاً بعد مع زر إصلاح.</li></ol><p>عرض اللوحة والقائمة وشبكة إنستجرام؛ اسحب البطاقة لنقلها.</p>`,
    ),
  },
  {
    id: "calendar", group: "screens", icon: "calendar", title: L("Calendar", "التقويم"),
    body: L(
      `<ul><li>Day, Week, Month, List and the whole Year. Hijri dates and term weeks on every day.</li><li>Dashed slots are your weekly posting times with no post yet: click to add one. Drag posts between days, or picks from the strip onto a day.</li><li>School events, occasions, no-posting days and holidays are shown. Events can expect photos (you get a reminder if none come) and repeat every year.</li><li>Warnings: days with nothing planned, a week that is mostly one category, countdowns to big events. “Last year” shows what you posted this week a year ago.</li><li><b>New → Import the term calendar</b> reads Excel, CSV or a calendar file.</li></ul>`,
      `<ul><li>يوم وأسبوع وشهر وقائمة والسنة كاملة. التاريخ الهجري وأسابيع الفصل على كل يوم.</li><li>المربعات المنقطة مواعيد النشر الأسبوعية بلا منشور بعد: انقر لإضافته. اسحب المنشورات بين الأيام، أو المختارة من الشريط إلى يوم.</li><li>فعاليات المدرسة والمناسبات وأيام بلا نشر والعطل ظاهرة. يمكن للفعالية انتظار صور (تصلك تذكرة إن لم تصل) والتكرار كل عام.</li><li>تنبيهات: أيام بلا خطة، أسبوع أغلبه تصنيف واحد، عدّ تنازلي للفعاليات الكبيرة. «العام الماضي» يعرض ما نشرتموه هذا الأسبوع قبل عام.</li><li><b>جديد ← استيراد تقويم الفصل</b> يقرأ Excel أو CSV أو ملف تقويم.</li></ul>`,
    ),
  },
  {
    id: "history", group: "screens", icon: "history", title: L("History", "السجل"),
    body: L(
      `<p>Everything changed on this computer, with who did it. <span class="k">⌘Z</span> undoes the last change. A whole import can be undone from its line. A post's own changes are in the post (Team → Change history).</p>`,
      `<p>كل ما تغيّر على هذا الجهاز ومن فعله. <span class="k">⌘Z</span> يتراجع عن آخر تغيير. يمكن التراجع عن استيراد كامل من سطره. تغييرات المنشور نفسه داخل المنشور (الفريق ← سجل التغييرات).</p>`,
    ),
  },
  {
    id: "settings", group: "screens", icon: "settings", title: L("Settings", "الإعدادات"),
    body: L(
      `<p>Pages on the left, search at the top; each setting is in one place only and saves straight away (with undo). General, Account, Library, Storage &amp; backup, Import, Faces &amp; privacy, Posting, School calendar, Alerts and Updates. Categories, accounts, team and brand are set on the website for the whole school.</p>`,
      `<p>الصفحات على اليسار والبحث في الأعلى؛ كل إعداد في مكان واحد فقط ويُحفظ فوراً (مع التراجع). عام، الحساب، المكتبة، التخزين والنسخ الاحتياطي، الاستيراد، الوجوه والخصوصية، النشر، تقويم المدرسة، التنبيهات والتحديثات. التصنيفات والحسابات والفريق والهوية تُضبط على الموقع للمدرسة كلها.</p>`,
    ),
  },
  {
    id: "keys", group: "basics", icon: "keyboard", title: L("Keyboard keys", "مفاتيح لوحة المفاتيح"),
    body: `<table class="list"><tbody>
      <tr><td><span class="k">P</span> / <span class="k">X</span> / <span class="k">U</span></td><td>${L("Pick, reject, clear", "اختيار، رفض، إلغاء")}</td></tr>
      <tr><td><span class="k">1</span>–<span class="k">5</span></td><td>${L("Stars (0 clears)", "النجوم (0 يمسح)")}</td></tr>
      <tr><td><span class="k">T</span></td><td>${L("Tag a person", "وسم شخص")}</td></tr>
      <tr><td><span class="k">Y</span> / <span class="k">N</span></td><td>${L("Yes or no to a suggested name", "نعم أو لا لاسم مقترح")}</td></tr>
      <tr><td><span class="k">B</span> / <span class="k">C</span> / <span class="k">F</span></td><td>${L("Before and after, compare, face boxes", "قبل وبعد، مقارنة، مربعات الوجوه")}</td></tr>
      <tr><td><span class="k">N</span></td><td>${L("New post (in Posts)", "منشور جديد (في المنشورات)")}</td></tr>
      <tr><td><span class="k">1</span>–<span class="k">4</span>, <span class="k">A</span>, <span class="k">⌘S</span></td><td>${L("In a post: steps, approve, save", "في المنشور: الخطوات، اعتماد، حفظ")}</td></tr>
      <tr><td><span class="k">D</span> / <span class="k">W</span> / <span class="k">M</span>, <span class="k">←</span> <span class="k">→</span></td><td>${L("Calendar: day, week, month, back and forward", "التقويم: يوم، أسبوع، شهر، سابق وتالٍ")}</td></tr>
      <tr><td><span class="k">⌘K</span></td><td>${L("Search anything", "البحث عن أي شيء")}</td></tr>
      <tr><td><span class="k">⌘Z</span></td><td>${L("Undo", "تراجع")}</td></tr></tbody></table>`,
  },
  {
    id: "privacy", group: "basics", icon: "shield-check", title: L("Privacy", "الخصوصية"),
    body: L(
      `<ul><li>Original photos stay on the school's computer. Only small web copies of chosen photos go to the website, without location data.</li><li>Faces and names are worked out on this Mac only. The AI sees at most four small copies of a post's photos to write captions, never names or face data.</li><li>Someone who can't appear is blurred on the website copy, and a post with them is blocked until they are blurred or removed.</li></ul>`,
      `<ul><li>الصور الأصلية تبقى على جهاز المدرسة. تذهب نسخ ويب صغيرة من الصور المختارة فقط إلى الموقع، بلا بيانات الموقع الجغرافي.</li><li>الوجوه والأسماء تُعالج على هذا الماك فقط. يرى الذكاء الاصطناعي أربع نسخ صغيرة على الأكثر من صور المنشور لكتابة النص، ولا يرى أسماء أو بيانات وجوه أبداً.</li><li>من لا يمكن ظهوره يُموّه في نسخة الموقع، ويُمنع المنشور الذي يظهر فيه حتى يُموّه أو يُزال.</li></ul>`,
    ),
  },
  ...ROLE_GUIDES(),
];

function ROLE_GUIDES() {
  const r = (id, ic, title, en, ar) => ({ id: `role-${id}`, group: "roles", icon: ic, title, body: L(en, ar) });
  return [
    r("admin", "crown", L("School admin", "مدير النظام"),
      `<ul><li>Everything: settings, team, plan and library computers.</li><li>Invite the team on the website (Team), choose who approves and the extra approver for some categories.</li><li>Connect Facebook and Instagram once (Accounts).</li></ul>`,
      `<ul><li>كل شيء: الإعدادات والفريق والخطة وأجهزة المكتبة.</li><li>ادعُ الفريق من الموقع (الفريق) واختر من يعتمد والمعتمد الإضافي لبعض التصنيفات.</li><li>اربط فيسبوك وإنستجرام مرة واحدة (الحسابات).</li></ul>`),
    r("lead", "badge-check", L("Communications lead", "مسؤول التواصل"),
      `<ul><li>Approve posts (<span class="k">A</span>) and schedule them, or put them in the next free slot.</li><li>Plan the week in the Calendar; “Make a week of posts” fills the gaps.</li><li>Watch Coverage so every student gets a fair share.</li></ul>`,
      `<ul><li>اعتمد المنشورات (<span class="k">A</span>) وجدولها أو ضعها في أقرب موعد.</li><li>خطط للأسبوع في التقويم؛ «أنشئ منشورات أسبوع» يملأ الفراغات.</li><li>تابع التغطية ليأخذ كل طالب نصيباً عادلاً.</li></ul>`),
    r("comms", "pen-line", L("Communications team", "فريق التواصل"),
      `<ul><li>Import, cull and name faces on the Mac.</li><li>Make posts and send them for approval; the checklist tells you what's missing.</li><li>Use notes with @name to ask a colleague.</li></ul>`,
      `<ul><li>استورد وافرز وسمِّ الوجوه على الماك.</li><li>أنشئ المنشورات وأرسلها للاعتماد؛ القائمة تخبرك بما ينقص.</li><li>استخدم الملاحظات مع @الاسم لسؤال زميل.</li></ul>`),
    r("principal", "graduation-cap", L("Principal or extra approver", "المدير أو المعتمد الإضافي"),
      `<ul><li>Approve from your phone: open the alert, look at the preview, tap Approve or Ask for changes.</li><li>A weekly summary arrives every Sunday.</li></ul>`,
      `<ul><li>اعتمد من هاتفك: افتح التنبيه وشاهد المعاينة واضغط اعتماد أو اطلب تعديلات.</li><li>يصلك ملخص أسبوعي كل أحد.</li></ul>`),
    r("teacher", "presentation", L("Teacher", "المعلم"),
      `<ul><li>Upload photos from your phone; they go to the Mac for the privacy check first.</li><li>Answer “Is this …?” for your class, check names in the yearbook and write your class page message.</li><li>See your class's coverage.</li></ul>`,
      `<ul><li>ارفع الصور من هاتفك؛ تذهب إلى الماك لفحص الخصوصية أولاً.</li><li>أجب على «هل هذا …؟» لفصلك وراجع الأسماء في الكتاب السنوي واكتب رسالة صفحة فصلك.</li><li>شاهد تغطية فصلك.</li></ul>`),
    r("photographer", "camera", L("Photographer", "المصوّر"),
      `<ul><li>Upload with the link the school sends you; no account needed.</li><li>During an event, the shot list on your phone shows who and what is still needed.</li></ul>`,
      `<ul><li>ارفع الصور بالرابط الذي ترسله المدرسة؛ بلا حساب.</li><li>أثناء الفعالية تعرض قائمة اللقطات على هاتفك من وما زال مطلوباً.</li></ul>`),
  ];
}

const WHATS_NEW = () => [
  ["0.4.0", L("A new look everywhere, with right-click menus, Settings like System Settings, and a Today page you can arrange.", "شكل جديد في كل مكان مع قوائم الزر الأيمن، وإعدادات مثل إعدادات النظام، وصفحة اليوم قابلة للترتيب.")],
  ["0.4.0", L("Import: preview with untick, events named from the school calendar, camera clock fix, checked copies, iPhone and cards.", "الاستيراد: معاينة مع إلغاء التحديد، فعاليات مسماة من تقويم المدرسة، تصحيح ساعة الكاميرا، نسخ مفحوصة، آيفون وبطاقات.")],
  ["0.4.0", L("Faces: a better engine, big confirm view, look-alike groups, teachers, staff, parents and visitors, class photo mode and checks on the teacher's phone.", "الوجوه: محرك أفضل، عرض تأكيد كبير، مجموعات متشابهة، المعلمون والموظفون وأولياء الأمور والزوار، وضع صورة الفصل وأسئلة على هاتف المعلم.")],
  ["0.4.0", L("Students: person pages, years at school, parents and siblings, clubs, achievements and the new school year.", "الطلاب: صفحات الأشخاص، سنوات المدرسة، أولياء الأمور والإخوة، الأندية، الإنجازات والعام الدراسي الجديد.")],
  ["0.4.0", L("Coverage, Clean up and Yearbooks rebuilt.", "إعادة بناء التغطية والتنظيف والكتب السنوية.")],
  ["0.4.0", L("Posts and Calendar made in the app: crops and frames from the originals, collages, who's in the post, the checklist before sending, Make a week, announcements, countdowns and the whole-year view.", "المنشورات والتقويم داخل التطبيق: القص والإطارات من الأصول، الصور المجمّعة، من في المنشور، قائمة ما قبل الإرسال، أسبوع من المنشورات، الإعلانات، العد التنازلي وعرض السنة.")],
];

App.views.help = {
  render(main, params) {
    const guides = GUIDES();
    const page = params.id ?? "start";
    const cur = guides.find((g) => g.id === page);
    const groups = [["basics", L("Basics", "الأساسيات")], ["screens", L("Screens", "الشاشات")], ["roles", L("For each role", "لكل دور")]];
    const extra = [["videos", "circle-play", L("Short videos", "فيديوهات قصيرة")], ["new", "gift", L("What's new", "ما الجديد")], ["status", "activity", L("Is everything working?", "هل كل شيء يعمل؟")], ["reports", "message-square-warning", L("My reports", "بلاغاتي")]];
    main.innerHTML = topbar(L("Help", "المساعدة"), L("Short guides for every screen, in Arabic and English", "أدلة قصيرة لكل شاشة بالعربية والإنجليزية"),
      `<button class="btn" id="hp-tour">${icon("route", 14)} ${L("Show me around", "جولة في التطبيق")}</button><button class="btn" id="hp-wa">${icon("message-circle", 14)} ${L("WhatsApp support", "الدعم عبر واتساب")}</button><button class="btn primary" id="hp-report">${L("Report a problem", "الإبلاغ عن مشكلة")}</button>`) +
      `<div class="content flush"><div class="lib"><nav class="tree"><input type="search" id="hp-q" placeholder="${L("Search help…", "ابحث في المساعدة…")}" style="margin: 4px 8px 8px; width: calc(100% - 16px)" />
        ${groups.map(([g, t]) => `<div class="tsec">${esc(t)}</div>${guides.filter((x) => x.group === g).map((x) => `<div class="t ${x.id === page ? "on" : ""}" data-id="${x.id}" data-q="${esc(`${x.title} ${x.body}`.replace(/<[^>]+>/g, " ").toLowerCase())}">${icon(x.icon, 14)}<span class="name">${esc(x.title)}</span></div>`).join("")}`).join("")}
        <div class="tsec">${L("More", "المزيد")}</div>${extra.map(([id, ic, t]) => `<div class="t ${id === page ? "on" : ""}" data-id="${id}">${icon(ic, 14)}<span class="name">${esc(t)}</span></div>`).join("")}</nav>
      <div class="gridwrap"><div class="content help" id="hp-body">${cur ? `<div class="card" style="max-width: 760px"><h1>${icon(cur.icon, 20)} ${esc(cur.title)}</h1>${cur.body}${TOURS()[cur.id] ? `<button class="btn" data-tourof="${cur.id}">${icon("route", 14)} ${L("Show me on the screen", "أرني على الشاشة")}</button>` : ""}</div>` : skeletonRows(4)}</div></div></div></div>`;
    $$("[data-id]", main).forEach((el) => (el.onclick = () => go("help", { id: el.dataset.id })));
    $("#hp-q", main).oninput = (e) => { const q = e.target.value.toLowerCase(); $$("[data-q]", main).forEach((el) => (el.style.display = !q || el.dataset.q.includes(q) ? "" : "none")); };
    $("#hp-report", main).onclick = reportProblem;
    $("#hp-tour", main).onclick = () => startTour("app");
    $("#hp-wa", main).onclick = () => whatsappSupport();
    $$("[data-tourof]", main).forEach((b) => (b.onclick = () => { go(b.dataset.tourof); setTimeout(() => startTour(b.dataset.tourof), 600); }));
    if (!cur) this.extra(page);
  },
  async extra(page) {
    const box = $("#hp-body");
    if (page === "new") {
      box.innerHTML = `<div class="card" style="max-width: 760px"><h1>${icon("gift", 20)} ${L("What's new", "ما الجديد")}</h1><ul>${WHATS_NEW().map(([v, t]) => `<li><span class="tag">${esc(v)}</span> ${esc(t)}</li>`).join("")}</ul><p class="muted small">${L(`This Mac: version ${S.version ?? ""}`, `هذا الماك: الإصدار ${S.version ?? ""}`)}</p></div>`;
    } else if (page === "videos") {
      const base = `${S.server ?? "https://schools-social.vercel.app"}/help/videos`;
      box.innerHTML = `<div class="card" style="max-width: 900px"><h1>${icon("circle-play", 20)} ${L("Short videos", "فيديوهات قصيرة")}</h1><p class="muted">${L("Each is under two minutes, with no sound needed.", "كل فيديو أقل من دقيقتين ولا يحتاج صوتاً.")}</p>
        <div class="vids">${HELP_VIDEOS().map(([id, t]) => `<figure class="vid"><video src="${esc(base)}/${id}.webm" controls preload="metadata"></video><figcaption>${esc(t)}</figcaption></figure>`).join("")}</div></div>`;
      $$("video", box).forEach((v) => (v.onerror = () => v.closest("figure").classList.add("off")));
    } else if (page === "status") {
      box.innerHTML = skeletonRows(4);
      const st = S.signedIn ? await quiet("app", "status") : null;
      const row = (ok, t, d) => `<div class="chk ${ok === true ? "ok" : ""}">${icon(ok === true ? "circle-check" : ok === "warn" ? "circle-alert" : "circle-x", 15)}<span class="grow"><b>${t}</b> <span class="muted small">${d ?? ""}</span></span></div>`;
      const e = S.engine ?? {};
      box.innerHTML = `<div class="card col gap8" style="max-width: 760px"><h1>${icon("activity", 20)} ${L("Is everything working?", "هل كل شيء يعمل؟")}</h1>
        ${row(!!S.library && !S.libraryMissing, L("Photo library", "مكتبة الصور"), S.libraryMissing ? L("The drive isn't connected", "القرص غير موصول") : S.library ? esc(S.library) : L("Not chosen yet", "لم يُختر بعد"))}
        ${row(S.paused ? "warn" : true, L("This Mac", "هذا الماك"), S.paused ? L("Paused", "متوقف مؤقتاً") : e.scanning ? L("Reading the library", "يقرأ المكتبة") : L("Working", "يعمل"))}
        ${row(S.signedIn ? (st ? true : false) : false, L("Website", "الموقع"), S.signedIn ? (st ? L("Connected", "متصل") : L("Can't reach it. Check the internet.", "تعذّر الوصول. تحقق من الإنترنت.")) : L("Not signed in", "غير مسجّل الدخول"))}
        ${st ? row(st.ai === "on" ? true : "warn", L("AI captions", "نصوص الذكاء الاصطناعي"), st.ai === "on" ? L("On", "يعمل") : L("Sample captions only: the AI key isn't set on the website yet", "نصوص تجريبية فقط: مفتاح الذكاء الاصطناعي غير مضبوط على الموقع")) : ""}
        ${st ? row(st.facebook === "on" ? true : "warn", "Facebook", { on: L("Connected", "متصل"), paused: L("Paused", "متوقف"), off: L("Not connected", "غير مربوط") }[st.facebook]) : ""}
        ${st ? row(st.instagram === "on" ? true : "warn", "Instagram", { on: L("Connected", "متصل"), paused: L("Paused", "متوقف"), off: L("Not connected", "غير مربوط") }[st.instagram]) : ""}
        ${st ? row(st.failed ? false : true, L("Publishing", "النشر"), st.paused ? L(`Paused until ${fmtWhen(st.paused.until)}`, `متوقف حتى ${fmtWhen(st.paused.until)}`) : st.failed ? `${plural(st.failed, "post failed", "posts failed", "منشورات فشلت")} ${L("in the last 2 days", "في آخر يومين")}` : L("No problems", "لا مشاكل")) : ""}
      </div>`;
    } else if (page === "reports") {
      box.innerHTML = skeletonRows(3);
      const r = S.signedIn ? await quiet("app", "myReports") : null;
      const name = { open: L("Sent", "أُرسل"), seen: L("Being looked at", "قيد المراجعة"), fixed: L("Fixed", "تم الإصلاح") };
      box.innerHTML = `<div class="card col gap8" style="max-width: 760px"><h1>${icon("message-square-warning", 20)} ${L("My reports", "بلاغاتي")}</h1>
        ${(r?.reports ?? []).map((x) => `<div class="hrow"><span class="muted small" style="min-width: 120px">${esc(fmtWhen(x.created_at))}</span><span class="grow small">${esc(x.body.split("\n")[0])}</span><span class="tag ${x.status === "fixed" ? "good" : x.status === "seen" ? "info" : ""}">${esc(name[x.status] ?? x.status)}</span></div>`).join("") || `<p class="muted">${S.signedIn ? L("No reports yet.", "لا بلاغات بعد.") : L("Sign in to see your reports.", "سجّل الدخول لرؤية بلاغاتك.")}</p>`}
        <button class="btn" id="hp-rep2" style="align-self: flex-start">${L("Report a problem", "الإبلاغ عن مشكلة")}</button></div>`;
      $("#hp-rep2", box).onclick = reportProblem;
    }
  },
};

async function whatsappSupport() {
  const st = S.signedIn ? await quiet("app", "status") : null;
  const n = st?.support?.whatsapp;
  if (!n) return toast(L("WhatsApp support isn't set up yet. Use Report a problem.", "الدعم عبر واتساب غير مُعد بعد. استخدم الإبلاغ عن مشكلة."));
  const text = L(`Hello, I need help with School Social Hub (${S.schoolName ?? ""}, Mac ${S.version ?? ""}).`, `مرحباً، أحتاج مساعدة في School Social Hub (${S.schoolName ?? ""}، ماك ${S.version ?? ""}).`);
  call("openUrl", `https://wa.me/${n}?text=${encodeURIComponent(text)}`);
}

// The "?" at the top of every screen: that screen's guide in a box.
const HELP_FOR = { student: "students", viewer: "library" };
function screenHelp() {
  const id = HELP_FOR[App.view] ?? App.view;
  const g = GUIDES().find((x) => x.id === id) ?? GUIDES()[0];
  const m = modal(`<h2>${icon(g.icon, 18)} ${esc(g.title)}</h2><div class="help">${g.body}</div>
    <div class="row">${TOURS()[id] ? `<button class="btn" id="sh-tour">${icon("route", 14)} ${L("Show me on the screen", "أرني على الشاشة")}</button>` : ""}<span class="grow"></span><button class="btn" id="sh-all">${L("All help", "كل المساعدة")}</button><button class="btn primary" id="sh-ok">${L("Got it", "فهمت")}</button></div>`, { wide: true });
  $("#sh-ok", m).onclick = closeOverlay;
  $("#sh-all", m).onclick = () => { closeOverlay(); go("help", { id }); };
  $("#sh-tour", m)?.addEventListener("click", () => { closeOverlay(); startTour(id); });
}
document.addEventListener("click", (e) => {
  if (e.target.closest?.("[data-screenhelp]")) screenHelp();
});

// ---------- The tour ----------
// A spotlight on one part of the screen at a time, with a short note.
const TOURS = () => ({
  app: [
    ["#side .nav[data-go=today]", L("Today: what needs you now. Start here every morning.", "اليوم: ما يحتاجك الآن. ابدأ من هنا كل صباح.")],
    ["#side .nav[data-go=library]", L("Library: every photo, by year, term, event and class. Originals never leave this computer.", "المكتبة: كل الصور حسب السنة والفصل والفعالية والصف. الأصول لا تغادر هذا الجهاز.")],
    ["#side .nav[data-go=import]", L("Import from cards, iPhones and folders.", "الاستيراد من البطاقات والآيفون والمجلدات.")],
    ["#side .nav[data-go=faces]", L("Faces: name students once; the Mac finds them everywhere.", "الوجوه: سمِّ الطلاب مرة؛ يجدهم الماك في كل مكان.")],
    ["#side .nav[data-go=coverage]", L("Coverage: is every student in photos and posts?", "التغطية: هل كل طالب في الصور والمنشورات؟")],
    ["#side .nav[data-go=books]", L("Yearbooks for every grade and the graduations.", "الكتب السنوية لكل صف وللتخرج.")],
    ["#side .create", L("Create post: from an event, your picks or an announcement.", "إنشاء منشور: من فعالية أو المختارة أو إعلان.")],
    ["#side .nav[data-go=calendar]", L("Calendar: plan the week, see gaps and school events.", "التقويم: خطط للأسبوع وشاهد الفراغات وفعاليات المدرسة.")],
    ["#sbtn", L("Search anything with ⌘K: a student, an event, a setting.", "ابحث عن أي شيء بـ ⌘K: طالب، فعالية، إعداد.")],
    ["[data-screenhelp]", L("The ? on every screen explains that screen.", "علامة ؟ في كل شاشة تشرح تلك الشاشة.")],
  ],
  posts: [
    ["[data-lay]", L("Board, list or how the Instagram profile will look.", "لوحة أو قائمة أو كيف سيبدو حساب إنستجرام.")],
    ["#p-week", L("Let the app plan the next days from your events and free posting times.", "دع التطبيق يخطط للأيام القادمة من فعالياتك ومواعيدك.")],
    ["#p-new", L("Make a new post. Press N anywhere in Posts.", "أنشئ منشوراً جديداً. اضغط N في أي مكان في المنشورات.")],
    [".bcol[data-col=waiting]", L("Posts waiting for approval. Drag a card to move it.", "منشورات تنتظر الاعتماد. اسحب البطاقة لنقلها.")],
  ],
  calendar: [
    ["[data-cv]", L("Day, week, month, a list, or the whole year.", "يوم أو أسبوع أو شهر أو قائمة أو السنة كاملة.")],
    ["#c-bar", L("Show or hide posting times, school events, occasions and last year's posts.", "أظهر أو أخفِ مواعيد النشر وفعاليات المدرسة والمناسبات ومنشورات العام الماضي.")],
    [".cslot", L("A posting time with nothing in it yet. Click to add a post.", "موعد نشر فارغ. انقر لإضافة منشور.")],
    ["#c-new", L("Add a school event or import the term calendar.", "أضف فعالية مدرسية أو استورد تقويم الفصل.")],
  ],
  library: [
    [".tree", L("Years, terms and events, then smart albums, colours and people.", "السنوات والفصول والفعاليات ثم الألبومات الذكية والألوان والأشخاص.")],
    [".topbar .tools", L("Cull, best photos and make posts from what you chose.", "الفرز وأفضل الصور وإنشاء منشورات مما اخترت.")],
  ],
  faces: [[".topbar", L("Confirm, Who is this?, and Not a face. Y and N answer.", "تأكيد، من هذا؟، وليس وجهاً. Y وN للإجابة.")]],
  books: [[".topbar .tools", L("Start a yearbook for a grade, a class, a student or a graduation.", "ابدأ كتاباً لصف أو فصل أو طالب أو تخرج.")]],
});

function startTour(id = "app") {
  const steps = (TOURS()[id] ?? TOURS().app).filter(([sel]) => document.querySelector(sel));
  if (!steps.length) return toast(L("Open the screen first.", "افتح الشاشة أولاً."));
  let i = 0;
  const layer = h(`<div class="tour"><div class="spot"></div><div class="tip"><p></p><div class="row"><span class="muted small n"></span><span class="grow"></span><button class="btn small ghost" data-t="end">${L("Skip", "تخطٍّ")}</button><button class="btn small primary" data-t="next"></button></div></div></div>`);
  document.body.append(layer);
  const show = () => {
    const [sel, text] = steps[i];
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const spot = $(".spot", layer), tip = $(".tip", layer);
    Object.assign(spot.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    $("p", tip).textContent = text;
    $(".n", tip).textContent = `${num(i + 1)} / ${num(steps.length)}`;
    $("[data-t=next]", tip).textContent = i === steps.length - 1 ? L("Done", "تم") : L("Next", "التالي");
    const below = r.bottom + 160 < innerHeight;
    Object.assign(tip.style, { top: below ? `${r.bottom + 14}px` : `${Math.max(12, r.top - 150)}px`, left: `${Math.min(innerWidth - 340, Math.max(12, r.left))}px` });
  };
  const end = () => { layer.remove(); setSetting("tourDone", true, false); };
  $("[data-t=end]", layer).onclick = end;
  $("[data-t=next]", layer).onclick = () => (++i >= steps.length ? end() : show());
  show();
}
