// Settings, in the style of the Mac's System Settings: a list of pages on
// one side, the page on the other, and search across every setting. Each
// setting lives in one place only. Changes save at once, with Undo.

const SETTING_PAGES = () => [
  { id: "general", icon: "settings", title: L("General", "عام") },
  { id: "account", icon: "user-round", title: L("Account", "الحساب") },
  { id: "library", icon: "images", title: L("Library", "المكتبة") },
  { id: "storage", icon: "hard-drive", title: L("Storage & backup", "التخزين والنسخ الاحتياطي") },
  { id: "import", icon: "download", title: L("Import", "الاستيراد") },
  { id: "faces", icon: "scan-face", title: L("Faces & privacy", "الوجوه والخصوصية") },
  { id: "posting", icon: "send", title: L("Posting", "النشر") },
  { id: "calendar", icon: "calendar-days", title: L("School calendar", "تقويم المدرسة") },
  { id: "alerts", icon: "bell", title: L("Alerts", "التنبيهات") },
  { id: "updates", icon: "refresh-cw", title: L("Updates", "التحديثات") },
];

// One row: a plain sentence on the left, its control on the right.
const srow = (title, sub, control, words = "") => ({ title, sub, control, words });
const choose = (key, value, options, type = "") =>
  `<select data-set="${key}" ${type ? `data-type="${type}"` : ""}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const toggle = (key, on, disabled = false) => sw(`data-set="${key}"`, on, disabled ? "disabled" : "");
const actBtn = (name, label, cls = "", extra = "") => `<button class="btn small ${cls}" data-act="${name}" ${extra}>${label}</button>`;
const pathText = (p) => (p ? `<span class="ltr small muted pathtxt" title="${esc(p)}">${esc(p.split(/[\\/]/).slice(-2).join("/"))}</span>` : "");

function settingGroups(page, extra) {
  const onMac = S.platform === "darwin";
  const fm = S.faceModel;
  const school = extra.school;
  switch (page) {
    case "general":
      return [
        {
          rows: [
            srow(L("Language", "اللغة"), "", choose("language", S.language, [["ar", "العربية"], ["en", "English"]]), "language arabic english لغة"),
            srow(L("Appearance", "المظهر"), "", choose("theme", S.theme, [["system", L("Like the computer", "مثل الجهاز")], ["light", L("Light", "فاتح")], ["dark", L("Dark", "داكن")]]), "theme dark light mode مظهر داكن"),
            srow(L("Text size", "حجم النص"), "", choose("textSize", S.textSize, [["small", L("Small", "صغير")], ["normal", L("Normal", "عادي")], ["large", L("Large", "كبير")]]), "text size font حجم"),
            srow(L("School colour", "لون المدرسة"), L("Used for buttons and highlights.", "يُستخدم للأزرار والتمييز."), `<input type="color" data-set="accent" value="${esc(S.accent)}" /><button class="link small" data-act="accent0">${L("Reset", "إعادة")}</button>`, "colour color accent لون"),
            srow(L("Less movement", "حركة أقل"), L("Turns off the zoom and slide animations.", "يوقف حركات التكبير والانزلاق."), toggle("motion", S.motion === "less"), "animation motion حركة"),
          ],
        },
        {
          rows: [
            srow(L("Editing app", "تطبيق التعديل"), L("Photos open here with “Open in editing app”. Edits saved next to the original with “-edit” in the name are linked to it.", "تُفتح الصور فيه عند «فتح في تطبيق التعديل». التعديلات المحفوظة بجانب الأصل مع «-edit» في الاسم تُربط به."),
              `${S.editor ? pathText(S.editor) : `<span class="small muted">${L("The computer's default", "الافتراضي")}</span>`}${actBtn("chooseEditor", L("Choose…", "اختيار…"))}${S.editor ? actBtn("clearEditor", L("Default", "الافتراضي"), "ghost") : ""}`, "editor lightroom photoshop تعديل"),
            srow(onMac ? L("Start with the Mac", "التشغيل مع الماك") : L("Start with Windows", "التشغيل مع ويندوز"), L("Keeps the library up to date from the menu bar.", "يُبقي المكتبة محدّثة من شريط القوائم."), toggle("openAtLogin", S.openAtLogin), "login startup start تشغيل"),
          ],
        },
      ];
    case "account": {
      const rows = !S.connected
        ? [srow(L("Website address", "عنوان الموقع"), L("Connect to your School Social Hub website.", "اتصل بموقع School Social Hub."), `<input id="srv" value="${esc(S.server)}" class="ltr" style="width: 260px" />${actBtn("connect", L("Connect", "اتصال"), "primary")}`, "server website address")]
        : !S.signedIn
          ? [
              srow(L("Email", "البريد الإلكتروني"), "", `<input type="email" id="em" value="${esc(S.email ?? "")}" class="ltr" style="width: 240px" />`, "email sign in"),
              srow(L("Password", "كلمة المرور"), L("The account you use on the website.", "الحساب الذي تستخدمه على الموقع."), `<input type="password" id="pw" style="width: 240px" />${actBtn("signIn", L("Sign in", "دخول"), "primary")}`, "password sign in"),
            ]
          : [
              srow(L("Signed in", "مسجّل الدخول"), `<span class="ltr">${esc(S.email)}</span>`, `${actBtn("openWeb", L("Open website", "فتح الموقع"))}${actBtn("signOut", L("Sign out", "خروج"), "danger")}`, "account sign out email"),
              srow(L("School", "المدرسة"), esc(S.schoolName ?? ""), `<span class="tag">${esc(S.role ?? "")}</span>`, "school role"),
            ];
      const acc = extra.account;
      if (S.signedIn && acc)
        rows.push(
          srow(L("Plan", "الخطة"), acc.plan ? esc(acc.plan) : L("Free while testing", "مجاني أثناء التجربة"), actBtn("openWebPlan", L("See plan", "عرض الخطة")), "plan billing price"),
          srow(L("Computers", "الأجهزة"), L(`${num(acc.computers ?? 1)} of ${num(acc.computerLimit ?? 1)} library computers in use`, `${num(acc.computers ?? 1)} من ${num(acc.computerLimit ?? 1)} أجهزة مكتبة مستخدمة`), "", "computers mac windows devices"),
        );
      return [{ rows }, { rows: [srow(L("Use without signing in", "الاستخدام دون تسجيل الدخول"), L("The library, faces and yearbooks work without the website. Posts need it.", "المكتبة والوجوه والكتب السنوية تعمل دون الموقع. المنشورات تحتاجه."), "", "offline")] }];
    }
    case "library": {
      const folders = [
        ...S.watched.map((w) => ({ path: w.path, type: "watched" })),
        ...(S.folders ?? []).map((f) => ({ path: f.path, type: f.skip ? "skip" : "archive" })),
      ];
      return [
        {
          rows: [
            srow(L("Library folder", "مجلد المكتبة"), L("Where the school keeps its photos. Originals always stay here.", "حيث تحفظ المدرسة صورها. تبقى الأصول هنا دائمًا."),
              `${S.library ? pathText(S.library) : `<span class="tag bad">${L("Not chosen", "لم يُختر")}</span>`}${actBtn("chooseLibrary", S.library ? L("Change…", "تغيير…") : L("Choose…", "اختيار…"), S.library ? "" : "primary")}${S.library ? actBtn("rescan", L("Look again", "إعادة الفحص"), "ghost") : ""}`, "library folder drive مكتبة"),
            srow(L("File my folder in place", "رتّب مجلدي في مكانه"), L("Photos that land outside Year / Term / Event folders are moved into place. Photos you put in an event folder yourself are never moved; “_” folders are left alone.", "تُنقل الصور التي تصل خارج مجلدات السنة / الفصل الدراسي / الفعالية إلى مكانها. لا تُنقل الصور التي تضعها بنفسك في مجلد فعالية، وتُترك مجلدات «_»."),
              choose("fileMode", S.selfFiling ? (S.fileAsk ? "ask" : "auto") : "off", [["off", L("Off", "متوقف")], ["ask", L("Ask me first", "اسألني أولًا")], ["auto", L("Automatically", "تلقائيًا")]]) + actBtn("tidy", L("Tidy now…", "رتّب الآن…"), "", S.library ? "" : "disabled"), "self filing tidy organise ترتيب"),
          ],
        },
        {
          title: L("Folders", "المجلدات"),
          sub: L("Watched: new photos there are copied in (Google Drive, OneDrive, Lightroom exports). Skipped: never read or sent. Mac only: kept here, never sent.", "مراقَب: تُنسخ صوره الجديدة (Google Drive وOneDrive وصادرات Lightroom). متجاهَل: لا يُقرأ ولا يُرسل. على الجهاز فقط: يبقى هنا ولا يُرسل."),
          rows: [
            ...folders.map((f) =>
              srow(`<span class="ltr">${esc(f.path.split(/[\\/]/).pop())}</span>`, `<span class="ltr">${esc(f.path)}</span>`,
                `<select data-folder="${esc(f.path)}" data-was="${f.type}">${[["watched", L("Watched", "مراقَب")], ["skip", L("Skipped", "متجاهَل")], ["archive", L("Mac only", "على الجهاز فقط")]].map(([v, l]) => `<option value="${v}" ${v === f.type ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn small ghost" data-unfolder="${esc(f.path)}" data-type="${f.type}" title="${L("Remove", "إزالة")}">${icon("x", 14)}</button>`, "folders watched skip"),
            ),
            srow(folders.length ? "" : `<span class="muted">${L("No folders yet", "لا توجد مجلدات بعد")}</span>`, "", actBtn("addFolder", `${icon("plus", 13)} ${L("Add a folder…", "إضافة مجلد…")}`), "add folder watched skip mac only"),
          ],
        },
        {
          title: L("Files on disk", "الملفات على القرص"),
          adv: true,
          rows: [
            srow(L("RAW and edits in their own folders", "ملفات RAW والتعديلات في مجلدات خاصة"), L("RAW files go in a “RAW” folder and edits in “Edited”, inside each event.", "تذهب ملفات RAW إلى مجلد «RAW» والتعديلات إلى «Edited» داخل كل فعالية."), toggle("rawFolders", S.rawFolders), "raw edited"),
            srow(L("Green Finder tag on picks", "وسم أخضر في Finder للمختارة"), L("No names or faces are written on files.", "لا تُكتب أسماء أو وجوه على الملفات."), toggle("finderTags", S.finderTags, !onMac), "finder tag green pick"),
            srow(L("Lock originals", "قفل الأصول"), L("Originals can't be changed by accident. Edits are always saved as new copies.", "لا يمكن تغيير الأصول بالخطأ. تُحفظ التعديلات دائمًا كنسخ جديدة."), toggle("lockOriginals", S.lockOriginals), "lock original"),
            srow(L("Fix event folder names", "تصحيح أسماء مجلدات الفعاليات"), L("Renames event folders to “YYYY-MM-DD Name”.", "يعيد تسمية مجلدات الفعاليات إلى «YYYY-MM-DD الاسم»."), actBtn("fixNames", L("Fix now…", "صحّح الآن…")), "rename folders names"),
          ],
        },
      ];
    }
    case "storage": {
      const d = S.disk;
      return [
        {
          rows: [
            srow(L("Library drive", "قرص المكتبة"), d ? L(`${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`, `${fmtBytes(d.free)} متاح من ${fmtBytes(d.total)}`) : L("Not connected", "غير موصول"), d ? `<div class="bar" style="width: 140px"><i style="width:${Math.round((1 - d.free / d.total) * 100)}%"></i></div>` : "", "space disk free"),
            srow(L("Backup drive", "قرص النسخ الاحتياطي"), L("A second copy of every new original on another drive.", "نسخة ثانية من كل أصل جديد على قرص آخر."),
              `${S.backup ? pathText(S.backup) + (S.backupDisk ? "" : ` <span class="tag bad">${L("Not connected", "غير موصول")}</span>`) : ""}${actBtn("chooseBackup", S.backup ? L("Change…", "تغيير…") : L("Choose…", "اختيار…"))}${S.backup ? actBtn("clearBackup", L("Turn off", "إيقاف"), "ghost") : ""}`, "backup drive نسخ"),
            srow(L("Archive drive for old years", "قرص الأرشيف للسنوات القديمة"), L("Old school years move there; the app still shows them from small copies.", "تنتقل السنوات القديمة إليه، ويبقى التطبيق يعرضها من نسخ صغيرة."),
              `${S.archive ? pathText(S.archive) : ""}${actBtn("chooseArchive", S.archive ? L("Change…", "تغيير…") : L("Choose…", "اختيار…"))}${S.archive ? actBtn("moveOldYears", L("Move old years…", "نقل السنوات القديمة…")) : ""}`, "archive old years أرشيف"),
          ],
        },
        {
          title: L("Clean up", "التنظيف"),
          rows: [
            srow(L("Bin empties itself after 30 days", "السلة تُفرَّغ تلقائيًا بعد 30 يومًا"), L("Until then everything in the Bin can be put back.", "حتى ذلك الحين يمكن استعادة كل ما في السلة."), `${toggle("binAuto", S.binAuto)}${actBtn("openBinView", L("Open Bin", "فتح السلة"), "ghost")}`, "bin trash 30 days سلة"),
            srow(L("Monthly clean-up reminder", "تذكير شهري بالتنظيف"), L("Shown on Today once a month when there is space to free.", "يظهر في اليوم مرة شهريًا عند وجود مساحة يمكن تحريرها."), toggle("cleanReminder", S.cleanReminder), "reminder monthly"),
            srow(L("How strict for bad photos", "مدى الصرامة مع الصور السيئة"), "", choose("cleanStrict", S.cleanStrict, [["gentle", L("Gentle", "لطيف")], ["normal", L("Normal", "عادي")], ["strict", L("Strict", "صارم")]]), "bad photos blurry strict"),
            srow(L("Offer rejected photos older than", "اقترح الصور المرفوضة الأقدم من"), "", choose("rejectMonths", S.rejectMonths, [[3, L("3 months", "3 أشهر")], [6, L("6 months", "6 أشهر")], [12, L("1 year", "سنة")]], "num"), "rejected old"),
            srow(L("Preview cache", "ذاكرة المعاينات"), L("Big previews are made again when needed.", "تُصنع المعاينات الكبيرة من جديد عند الحاجة."), actBtn("clearPreviews", L("Clear", "مسح")), "cache previews"),
          ],
        },
      ];
    }
    case "import":
      return [
        {
          rows: [
            srow(L("Default photographer", "المصوّر الافتراضي"), L("Written on every import unless you change it there.", "يُكتب على كل استيراد ما لم تغيّره هناك."), `<input data-set="importPhotographer" data-type="text" value="${esc(S.importPhotographer ?? "")}" placeholder="${L("Name", "الاسم")}" style="width: 200px" />`, "photographer credit"),
            srow(L("Default category", "التصنيف الافتراضي"), "", choose("importCategory", S.importCategory ?? "", [["", L("None", "بلا")], ...(extra.categories ?? []).map((c) => [c.id, c.name])]), "category"),
            srow(L("Leave out junk shots", "استبعاد اللقطات العشوائية"), L("Blank, pocket and very blurry shots are not imported. They are listed in the import report.", "لا تُستورد اللقطات الفارغة أو من الجيب أو شديدة الضبابية. تظهر في تقرير الاستيراد."), toggle("importJunk", S.importJunk), "junk blank pocket blurry"),
            srow(L("Leave out photos already in the library", "استبعاد الصور الموجودة في المكتبة"), L("Photos whose original went missing are always copied again and linked back.", "الصور التي فُقد أصلها تُنسخ دائمًا من جديد وتُربط بسجلها."), toggle("importSkipDup", S.importSkipDup), "duplicates already"),
            srow(L("Split a card into events by time gaps", "تقسيم البطاقة إلى فعاليات حسب فجوات الوقت"), "", choose("splitGap", S.splitGap, [[0, L("Don't split", "بلا تقسيم")], [1, L("1 hour gap", "فجوة ساعة")], [2, L("2 hour gap", "فجوة ساعتين")], [4, L("4 hour gap", "فجوة 4 ساعات")]], "num"), "split events gap"),
          ],
        },
        {
          title: L("Cards and phones", "البطاقات والهواتف"),
          rows: [
            srow(L("Open Import when a card or phone is plugged in", "فتح الاستيراد عند توصيل بطاقة أو هاتف"), "", toggle("importAutoOpen", S.importAutoOpen), "card plug auto open iphone"),
            srow(L("Eject the card when the import is checked", "إخراج البطاقة بعد التحقق من الاستيراد"), L("Every photo is checked against the copy first.", "تُطابق كل صورة مع نسختها أولًا."), toggle("importEject", S.importEject), "eject card safe"),
            srow(L("Offer to erase the card afterwards", "اقتراح مسح البطاقة بعد ذلك"), L("Only after every photo is safely copied and checked.", "فقط بعد نسخ كل الصور والتحقق منها."), toggle("importErase", S.importErase), "erase card"),
          ],
        },
      ];
    case "faces":
      return [
        {
          rows: [
            srow(L("Find faces and suggest names", "البحث عن الوجوه واقتراح الأسماء"), L("On this computer only. Face data is never sent to the website or to AI.", "على هذا الجهاز فقط. لا تُرسل بيانات الوجوه إلى الموقع أو إلى الذكاء الاصطناعي."), toggle("faces", S.faces), "faces recognition وجوه"),
            srow(L("Name very sure matches by themselves", "تسمية التطابقات المؤكدة تلقائيًا"), L("Marked “auto” so you can check them. Twins and look-alikes always ask you.", "تُعلَّم «تلقائي» لتراجعها. التوائم والمتشابهون يُسألون دائمًا."), toggle("autoName", S.autoName), "auto confirm sure"),
            ...(onMac ? [srow(L("Second look with Apple Vision", "نظرة ثانية بـ Apple Vision"), L("The Mac's own face finder checks each face, which leaves out hands and blurred faces.", "يتحقق كاشف الوجوه في الماك من كل وجه، فيستبعد الأيدي والوجوه الضبابية."), toggle("faceVision", S.faceVision), "apple vision mac")] : []),
            srow(L("Face engine", "محرك الوجوه"),
              fm?.state === "ready" ? L("AuraFace (works the same on Mac and Windows)", "AuraFace (يعمل بالطريقة نفسها على ماك وويندوز)")
              : fm?.state === "downloading" ? L(`Downloading the better engine… ${fm.total ? Math.round((fm.done / fm.total) * 100) : 0}%`, `جارٍ تنزيل المحرك الأفضل… ${fm.total ? Math.round((fm.done / fm.total) * 100) : 0}٪`)
              : fm?.state === "failed" ? L("The better engine couldn't download. The older one keeps working.", "تعذّر تنزيل المحرك الأفضل. يستمر المحرك الأقدم بالعمل.")
              : L("Getting ready", "جارٍ التجهيز"),
              fm?.state === "failed" ? actBtn("retryAura", L("Try again", "إعادة المحاولة")) : fm?.state === "ready" ? `<span class="tag good">${icon("check", 12)} ${L("Ready", "جاهز")}</span>` : "", "engine auraface model"),
          ],
        },
        {
          title: L("Privacy", "الخصوصية"),
          rows: [
            srow(L("Blur students who can't appear", "تمويه الطلاب الذين لا يظهرون"), L("Their faces are blurred in a post instead of the photo being left out.", "تُموَّه وجوههم في المنشور بدل استبعاد الصورة."), toggle("blurNoPost", S.blurNoPost), "blur can't appear privacy"),
            srow(L("What goes to the website", "ما يُرسل إلى الموقع"), L("Only small web copies, without location. Never faces or names from the Mac.", "نسخ ويب صغيرة فقط بلا موقع جغرافي. لا وجوه ولا أسماء من الماك."), choose("sendMode", S.sendMode, [["picked", L("Picks and post photos", "المختارة وصور المنشورات")], ["all", L("Every new photo", "كل صورة جديدة")]]), "send website upload"),
            srow(L("Look again at photos that failed", "إعادة فحص الصور التي فشلت"), "", actBtn("rescanFaces", L("Look again", "إعادة الفحص")), "rescan faces"),
            srow(L("“Not a face” bin", "سلة «ليس وجهًا»"), L("Posters, screens and statues you marked. Put any back.", "الملصقات والشاشات والتماثيل التي علّمتها. يمكن إعادة أي منها."), actBtn("notFaces", L("Open", "فتح")), "not a face hidden"),
          ],
        },
      ];
    case "posting":
      return [
        {
          rows: [
            srow(L("Sending to the website", "الإرسال إلى الموقع"), S.queue.pending ? L(`${num(S.queue.pending)} waiting to send`, `${num(S.queue.pending)} في انتظار الإرسال`) : L("Up to date", "محدّث"), S.queue.failed ? actBtn("retryFailed", L(`Retry ${num(S.queue.failed)} failed`, `إعادة ${num(S.queue.failed)} فشلت`)) : "", "send queue upload"),
            srow(L("Photo limit per post", "حد الصور لكل منشور"), L("Each platform's own limit unless you set one (Instagram 20).", "حد كل منصة ما لم تحدد حدًا (إنستغرام 20)."), `<input type="number" min="1" max="80" data-school="photo_limit" value="${esc(school?.photo_limit ?? "")}" placeholder="${L("Platform limit", "حد المنصة")}" style="width: 120px" />`, "photo limit carousel"),
          ],
        },
        {
          title: L("No-posting days", "أيام بلا نشر"),
          sub: L("Posts aren't suggested or scheduled on these days. Holidays come from the school calendar.", "لا تُقترح المنشورات ولا تُجدول في هذه الأيام. العطل تأتي من تقويم المدرسة."),
          rows: [
            srow(L("Weekdays", "أيام الأسبوع"), "", `<div class="pills">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button class="pill ${(school?.no_post_days?.weekdays ?? []).includes(d) ? "on" : ""}" data-npd="${d}">${new Date(2024, 0, 7 + d).toLocaleDateString(S.language === "en" ? "en-GB" : "ar-EG", { weekday: "short" })}</button>`).join("")}</div>`, "weekend friday saturday days"),
            srow(L("School holidays", "العطل المدرسية"), "", toggle("noPostHolidays", school?.no_post_days?.holidays ?? true), "holidays"),
          ],
        },
        {
          title: L("One post or two per language", "منشور واحد أم منشوران لكل لغة"),
          sub: L("Per category: one post with Arabic and English together, or separate Arabic and English posts.", "لكل تصنيف: منشور واحد بالعربية والإنجليزية معًا، أو منشوران منفصلان."),
          rows: (extra.categories ?? []).length
            ? extra.categories.map((c) => srow(`<span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}`, "", `<select data-catlang="${esc(c.id)}">${[["both", L("One bilingual post", "منشور ثنائي اللغة")], ["separate", L("Separate AR and EN posts", "منشوران عربي وإنجليزي")], ["ar", L("Arabic only", "العربية فقط")], ["en", L("English only", "الإنجليزية فقط")]].map(([v, l]) => `<option value="${v}" ${v === (c.language_mode ?? "both") ? "selected" : ""}>${l}</option>`).join("")}</select>`, "bilingual separate arabic english category"))
            : [srow(`<span class="muted">${S.signedIn ? L("No categories yet. Add them on the website.", "لا توجد تصنيفات بعد. أضفها على الموقع.") : L("Sign in to see the school's categories.", "سجّل الدخول لرؤية تصنيفات المدرسة.")}</span>`, "", "")],
        },
        {
          rows: [srow(L("Categories, accounts, team and brand", "التصنيفات والحسابات والفريق والهوية"), L("These are set on the website, for the whole school.", "تُضبط على الموقع للمدرسة كلها."), actBtn("openWebSettings", L("Open on the website", "فتح على الموقع")), "categories accounts team brand")],
        },
      ];
    case "calendar": {
      const terms = school?.term_dates ?? S.terms ?? [];
      return [
        {
          title: L("Terms", "الفصول الدراسية"),
          sub: L("Photos are filed into the right term by these dates (not fixed months). Shared with the website.", "تُرتب الصور في الفصل الصحيح حسب هذه التواريخ (لا أشهر ثابتة). مشتركة مع الموقع."),
          rows: [
            ...terms.map((t, i) =>
              srow(`<input data-term="${i}" data-f="name" value="${esc(t.name)}" style="width: 140px" />`, "", `<input type="date" data-term="${i}" data-f="start" value="${esc(t.start)}" /> → <input type="date" data-term="${i}" data-f="end" value="${esc(t.end)}" /><button class="btn small ghost" data-delterm="${i}">${icon("x", 14)}</button>`, "term dates"),
            ),
            srow("", "", actBtn("addTerm", `${icon("plus", 13)} ${L("Add a term", "إضافة فصل")}`), "add term"),
          ],
        },
        {
          title: L("Holidays", "العطل"),
          rows: [
            ...(school?.holidays ?? []).map((t, i) => srow(`<input data-hol="${i}" data-f="name" value="${esc(t.name)}" style="width: 160px" />`, "", `<input type="date" data-hol="${i}" data-f="start" value="${esc(t.start)}" /> → <input type="date" data-hol="${i}" data-f="end" value="${esc(t.end)}" /><button class="btn small ghost" data-delhol="${i}">${icon("x", 14)}</button>`, "holiday")),
            srow("", "", actBtn("addHoliday", `${icon("plus", 13)} ${L("Add a holiday", "إضافة عطلة")}`), "add holiday"),
          ],
        },
        { rows: [srow(L("Import the term calendar", "استيراد تقويم الفصول"), L("From an Excel or calendar file the school already has.", "من ملف Excel أو تقويم لدى المدرسة."), actBtn("importCalendar", L("Choose file…", "اختيار ملف…")), "import calendar ics excel")] },
      ];
    }
    case "alerts":
      return [
        {
          rows: [
            srow(L("Notifications", "الإشعارات"), L("Imports finished, new photos from watched folders, posts approved.", "انتهاء الاستيراد، صور جديدة من المجلدات المراقَبة، اعتماد المنشورات."), toggle("alerts", S.alerts), "notifications alerts"),
            srow(L("Quiet hours", "ساعات الهدوء"), L("No notifications between these times.", "لا إشعارات بين هذين الوقتين."), `<input type="time" data-set="quietFrom" data-type="text" value="${esc(S.quietFrom)}" /> → <input type="time" data-set="quietTo" data-type="text" value="${esc(S.quietTo)}" />`, "quiet hours night"),
            srow(L("Tell the team when an import finishes", "إبلاغ الفريق عند انتهاء الاستيراد"), L("The comms lead gets a message with how many photos came in.", "يصل لمسؤول الإعلام إشعار بعدد الصور الواردة."), toggle("teamImportAlert", S.teamImportAlert), "team alert import comms lead"),
          ],
        },
      ];
    case "updates": {
      const backups = extra.backups ?? [];
      return [
        {
          rows: [
            srow(L("Version", "الإصدار"), `<span class="ltr">${esc(S.version)}</span>`, actBtn("checkUpdates", L("Check for updates", "التحقق من التحديثات")), "version update"),
            srow(L("Safe updates", "تحديثات آمنة"), L("Before a new version opens the library, the library, faces and settings are copied aside. The last five copies are kept.", "قبل أن يفتح إصدار جديد المكتبة، تُنسخ المكتبة والوجوه والإعدادات جانبًا. تُحفظ آخر خمس نسخ."), `<span class="tag good">${icon("shield-check", 12)} ${L("On", "يعمل")}</span>`, "safe backup update"),
          ],
        },
        {
          title: L("Go back", "الرجوع"),
          sub: L("Puts the library back as it was before an update. The app restarts.", "يعيد المكتبة كما كانت قبل التحديث. يُعاد تشغيل التطبيق."),
          rows: backups.length
            ? backups.map((b) => srow(esc(b.name.slice(0, 16).replace(/-(\d\d)-(\d\d)$/, " $1:$2")), b.version ? L(`Before updating from ${b.version}`, `قبل التحديث من ${b.version}`) : "", `<button class="btn small" data-restore="${esc(b.name)}">${L("Go back to this", "الرجوع إلى هذه")}</button>`, "go back restore"))
            : [srow(`<span class="muted">${L("No copies yet. One is made before the next update.", "لا نسخ بعد. تُصنع نسخة قبل التحديث القادم.")}</span>`, "", "")],
        },
      ];
    }
  }
  return [];
}

App.views.settings = {
  page: "general",
  q: "",
  extra: {},
  render(main, params) {
    if (params.page) this.page = params.page;
    main.innerHTML = `<div class="content flush settings"><nav class="setnav"><input type="search" id="sq" placeholder="${L("Search settings", "ابحث في الإعدادات")}" value="${esc(this.q)}" /><div id="snav"></div></nav><section class="setpage" id="spage"></section></div>`;
    $("#sq", main).addEventListener("input", (e) => {
      this.q = e.target.value;
      this.fill();
    });
    this.fill();
    this.load();
  },
  async load() {
    const [backups, school, account] = await Promise.all([quiet("updateBackups"), S.signedIn ? quiet("app", "school") : null, S.signedIn ? quiet("app", "account") : null]);
    this.extra = { backups: backups ?? [], school: school && !school.error ? school : null, categories: school?.categories ?? [], account: account && !account.error ? account : null };
    this.fill();
  },
  onState() {
    if (!$(".modalback") && !document.activeElement?.matches("input, select")) this.fill();
  },
  fill() {
    const nav = $("#snav");
    const page = $("#spage");
    if (!nav || !page) return;
    const pages = SETTING_PAGES();
    nav.innerHTML = pages.map((p) => `<button class="nav ${p.id === this.page && !this.q ? "on" : ""}" data-sp="${p.id}"><span class="sic">${icon(p.icon, 14)}</span>${esc(p.title)}</button>`).join("");
    $$("[data-sp]", nav).forEach((b) => (b.onclick = () => {
      this.page = b.dataset.sp;
      this.q = "";
      $("#sq").value = "";
      this.fill();
    }));
    const group = (g) => {
      const rows = g.rows.map((r) => `<div class="srow"><div class="grow"><div class="st">${r.title}</div>${r.sub ? `<div class="ss">${r.sub}</div>` : ""}</div><div class="sc">${r.control}</div></div>`).join("");
      const body = `${g.title ? `<h3 class="sgt">${esc(g.title)}</h3>` : ""}${g.sub ? `<p class="sgs">${esc(g.sub)}</p>` : ""}<div class="sgroup">${rows}</div>`;
      return g.adv ? `<details class="adv"><summary>${g.title ? esc(g.title) : L("Advanced", "متقدم")}</summary>${body.replace(`<h3 class="sgt">${esc(g.title)}</h3>`, "")}</details>` : body;
    };
    if (this.q.trim()) {
      const q = this.q.trim().toLowerCase();
      const found = pages.flatMap((p) =>
        settingGroups(p.id, this.extra)
          .flatMap((g) => g.rows)
          .filter((r) => `${r.title} ${r.sub} ${r.words}`.toLowerCase().includes(q))
          .map((r) => ({ ...r, sub: `${p.title}${r.sub ? ` · ${r.sub}` : ""}` })),
      );
      page.innerHTML = `<h1>${L("Search results", "نتائج البحث")}</h1>${found.length ? group({ rows: found }) : emptyState("search", L("No setting matches", "لا يوجد إعداد مطابق"))}`;
    } else {
      const p = pages.find((x) => x.id === this.page) ?? pages[0];
      page.innerHTML = `<h1>${esc(p.title)}</h1>${settingGroups(p.id, this.extra).map(group).join("")}`;
    }
    this.bind(page);
  },
  bind(page) {
    $$("[data-set]", page).forEach((el) => {
      const key = el.dataset.set;
      const ev = el.type === "text" || el.type === "time" || el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "color" ? "change" : "change";
      el.addEventListener(ev, async () => {
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (el.dataset.type === "num") v = Number(v);
        if (key === "motion") v = el.checked ? "less" : "full";
        if (key === "fileMode") {
          await call("set", "selfFiling", v !== "off");
          await setSetting("fileAsk", v === "ask");
          return;
        }
        if (key === "noPostHolidays") return this.saveSchool({ no_post_days: { ...(this.extra.school?.no_post_days ?? {}), holidays: el.checked } });
        await setSetting(key, v);
      });
    });
    $$("[data-act]", page).forEach((b) => (b.onclick = () => this.act(b.dataset.act, b)));
    $$("[data-folder]", page).forEach((sel) => (sel.onchange = async () => {
      const p = sel.dataset.folder;
      await call("setFolderType", p, sel.dataset.was, sel.value);
      toast(L("Saved", "تم الحفظ"));
    }));
    $$("[data-unfolder]", page).forEach((b) => (b.onclick = () => call("setFolderType", b.dataset.unfolder, b.dataset.type, null)));
    $$("[data-restore]", page).forEach((b) => (b.onclick = () => {
      const m = modal(`<h2>${L("Go back to this copy?", "الرجوع إلى هذه النسخة؟")}</h2><p>${L("The library, faces and settings go back to how they were. Changes made since then are lost. Photos on disk are not touched.", "تعود المكتبة والوجوه والإعدادات كما كانت. تضيع التغييرات منذ ذلك الحين. لا تُمس الصور على القرص.")}</p>
        <div class="row"><span class="grow"></span><button class="btn" data-x>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-go>${L("Go back and restart", "الرجوع وإعادة التشغيل")}</button></div>`);
      $("[data-x]", m).onclick = closeOverlay;
      $("[data-go]", m).onclick = () => call("restoreBackup", b.dataset.restore);
    }));
    $$("[data-school]", page).forEach((el) => (el.onchange = () => this.saveSchool({ [el.dataset.school]: el.value ? Number(el.value) : null })));
    $$("[data-npd]", page).forEach((b) => (b.onclick = () => {
      const cur = new Set(this.extra.school?.no_post_days?.weekdays ?? []);
      const d = Number(b.dataset.npd);
      cur.has(d) ? cur.delete(d) : cur.add(d);
      this.saveSchool({ no_post_days: { ...(this.extra.school?.no_post_days ?? {}), weekdays: [...cur].sort() } });
    }));
    $$("[data-catlang]", page).forEach((el) => (el.onchange = async () => {
      await call("app", "setCategory", { id: el.dataset.catlang, language_mode: el.value });
      toast(L("Saved", "تم الحفظ"));
    }));
    const termList = (kind) => [...((kind === "term" ? this.extra.school?.term_dates ?? S.terms : this.extra.school?.holidays) ?? [])].map((t) => ({ ...t }));
    $$("[data-term], [data-hol]", page).forEach((el) => (el.onchange = () => {
      const kind = el.dataset.term !== undefined ? "term" : "hol";
      const list = termList(kind);
      list[Number(el.dataset.term ?? el.dataset.hol)][el.dataset.f] = el.value;
      this.saveTerms(kind, list);
    }));
    $$("[data-delterm], [data-delhol]", page).forEach((b) => (b.onclick = () => {
      const kind = b.dataset.delterm !== undefined ? "term" : "hol";
      const list = termList(kind);
      list.splice(Number(b.dataset.delterm ?? b.dataset.delhol), 1);
      this.saveTerms(kind, list);
    }));
    $("#pw", page)?.addEventListener("keydown", (e) => e.key === "Enter" && this.act("signIn"));
  },
  async saveSchool(patch) {
    const before = this.extra.school ? { ...this.extra.school } : null;
    const r = await call("app", "setSchool", patch);
    if (r?.error) return toast(L("Only the school's admin can change this.", "فقط مسؤول المدرسة يمكنه تغيير هذا."));
    this.extra.school = { ...(this.extra.school ?? {}), ...patch };
    this.fill();
    if (before) toastAction(L("Saved", "تم الحفظ"), L("Undo", "تراجع"), async () => {
      await call("app", "setSchool", Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])));
      this.extra.school = before;
      this.fill();
    });
  },
  async saveTerms(kind, list) {
    const clean = list.filter((t) => t.name || t.start || t.end);
    if (kind === "term") {
      await call("setTerms", clean);
      if (S.signedIn) await this.saveSchool({ term_dates: clean });
      else this.fill();
    } else {
      // Kept on this computer too: imports name events from the school calendar.
      await call("set", "calendar", clean);
      if (S.signedIn) await this.saveSchool({ holidays: clean });
      else this.fill();
    }
  },
  async act(name, b) {
    const page = $("#spage");
    switch (name) {
      case "accent0": return setSetting("accent", "#2f6fdf");
      case "connect": return call("connect", $("#srv", page).value).then(() => toast(L("Connected", "تم الاتصال")));
      case "signIn": return call("signIn", $("#em", page).value.trim(), $("#pw", page).value).then(() => { toast(L("Signed in", "تم تسجيل الدخول")); this.load(); });
      case "signOut": return call("signOut");
      case "openWeb": return call("openWeb", "");
      case "openWebPlan": return call("openWeb", "/settings?tab=plan");
      case "openWebSettings": return call("openWeb", "/settings");
      case "tidy": return tidyPlan();
      case "addFolder":
        return menu([
          { label: L("Watch a folder (copy new photos in)…", "مراقبة مجلد (نسخ الصور الجديدة)…"), run: () => call("addWatched") },
          { label: L("Skip a folder (never read)…", "تجاهل مجلد (لا يُقرأ)…"), run: async () => { const d = await call("chooseFolderToFlag"); if (d) call("folderFlag", d, "skip", true); } },
          { label: L("Keep a folder on this computer only…", "إبقاء مجلد على هذا الجهاز فقط…"), run: async () => { const d = await call("chooseFolderToFlag"); if (d) call("folderFlag", d, "archive", true); } },
        ]);
      case "fixNames": {
        const plan = await call("fixFolderNames", true);
        if (!plan.length) return toast(L("All event folder names are already right.", "كل أسماء مجلدات الفعاليات صحيحة."));
        const m = modal(`<h2>${L("Fix event folder names", "تصحيح أسماء المجلدات")}</h2><div class="col gap4" style="max-height: 50vh; overflow-y: auto">${plan.map((p) => `<div class="small ltr"><span class="muted">${esc(p.from)}</span> → <b>${esc(p.to)}</b></div>`).join("")}</div><div class="row"><span class="grow"></span><button class="btn" data-x>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-go>${L(`Rename ${plan.length}`, `إعادة تسمية ${num(plan.length)}`)}</button></div>`);
        $("[data-x]", m).onclick = closeOverlay;
        $("[data-go]", m).onclick = async () => { await call("fixFolderNames", false); closeOverlay(); toast(L("Renamed. ⌘Z undoes it.", "تمت إعادة التسمية. ⌘Z للتراجع."), { undo: true }); };
        return;
      }
      case "chooseArchive": return call("chooseArchive");
      case "moveOldYears": return moveOldYears();
      case "openBinView": return go("cleanup", { bin: true });
      case "notFaces": return go("faces", { tab: "hidden" });
      case "addTerm": return this.saveTerms("term", [...((this.extra.school?.term_dates ?? S.terms) ?? []), { name: L(`Term ${((this.extra.school?.term_dates ?? S.terms) ?? []).length + 1}`, `الفصل ${((this.extra.school?.term_dates ?? S.terms) ?? []).length + 1}`), start: "", end: "" }]);
      case "addHoliday": return this.saveTerms("hol", [...(this.extra.school?.holidays ?? []), { name: L("Holiday", "عطلة"), start: "", end: "" }]);
      case "importCalendar": {
        const r = await call("importCalendarFile");
        if (!r) return;
        if (r.terms.length) await this.saveTerms("term", r.terms);
        if (r.holidays.length) await this.saveTerms("hol", [...(this.extra.school?.holidays ?? []), ...r.holidays]);
        toast(L(`${r.terms.length} terms and ${r.holidays.length} holidays read`, `قُرئ ${num(r.terms.length)} فصل و${num(r.holidays.length)} عطلة`));
        return;
      }
      case "checkUpdates": return call("checkUpdates").then((v) => toast(v ? L(`Version ${v} is downloading`, `يجري تنزيل الإصدار ${v}`) : L("You have the latest version", "لديك أحدث إصدار")));
      case "rescan": return call("rescan").then(() => toast(L("Looking through the library again", "جارٍ إعادة فحص المكتبة")));
      case "rescanFaces": return call("rescanFaces").then(() => toast(L("Looking again", "جارٍ إعادة الفحص")));
      default: return call(name);
    }
  },
};

// Moves whole old school years to the archive drive. The app keeps their
// small copies, so they still show; full views ask for the drive.
async function moveOldYears() {
  const years = await call("archiveYears");
  const m = modal(`<h2>${L("Move old years to the archive drive", "نقل السنوات القديمة إلى قرص الأرشيف")}</h2>
    <p class="muted small">${L("Photos are copied, checked, then removed from the library drive. Names, faces and picks stay.", "تُنسخ الصور وتُطابق ثم تُحذف من قرص المكتبة. تبقى الأسماء والوجوه والمختارة.")}</p>
    <div class="col gap4">${years.map((y) => `<label class="check"><input type="checkbox" value="${esc(y.year)}" ${y.old ? "checked" : ""} /> <b>${esc(y.year)}</b> <span class="muted small">${plural(y.n, "photo", "photos", "صورة")} · ${fmtBytes(y.size)}</span></label>`).join("")}</div>
    <div class="row"><span class="grow"></span><button class="btn" data-x>${L("Cancel", "إلغاء")}</button><button class="btn primary" data-go>${L("Move", "نقل")}</button></div>`);
  $("[data-x]", m).onclick = closeOverlay;
  $("[data-go]", m).onclick = async () => {
    const picked = $$("input:checked", m).map((i) => i.value);
    closeOverlay();
    const r = await call("archiveMove", picked);
    toast(L(`${r.moved} photos moved to the archive drive`, `نُقلت ${num(r.moved)} صورة إلى قرص الأرشيف`));
  };
}

function reportProblem() {
  const m = modal(`<h2>${L("Report a problem", "الإبلاغ عن مشكلة")}</h2><p class="muted small">${L("Say what you were doing and what went wrong. A screenshot of the app and the app's log are attached for the team.", "اكتب ما كنت تفعله وما الخطأ. تُرفق لقطة شاشة للتطبيق وسجله للفريق.")}</p><textarea rows="5" id="rp"></textarea>
    <label class="check"><input type="checkbox" id="rp-shot" checked /> ${L("Attach a screenshot of the app", "إرفاق لقطة شاشة للتطبيق")}</label>
    <div class="row"><span class="grow"></span><button class="btn" id="rp-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="rp-yes">${L("Send", "إرسال")}</button></div>`);
  $("#rp-no", m).onclick = closeOverlay;
  $("#rp-yes", m).onclick = async () => {
    const text = `${$("#rp", m).value}\n\nLast message: ${S.message ?? ""}\nScreen: ${App.view}`;
    const shot = $("#rp-shot", m).checked;
    closeOverlay();
    const r = await call("reportProblem", text, shot);
    toast(r?.sent ? L("Sent. You can follow it in Help → My reports.", "تم الإرسال. تابعه في المساعدة ← بلاغاتي.") : L("Your email app opened with the details.", "فُتح تطبيق البريد بالتفاصيل."));
  };
}

// Notifications, outside quiet hours.
let lastNotice = "";
function quietNow() {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = (S.quietFrom || "21:00").split(":").map(Number);
  const [th, tm] = (S.quietTo || "07:00").split(":").map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  return from < to ? m >= from && m < to : m >= from || m < to;
}
window.hub.onState((s) => {
  if (!s.alerts || s.message === lastNotice) return;
  lastNotice = s.message;
  if (quietNow()) return;
  const w = /^watched:(.+)$/.exec(s.message ?? "");
  const im = /^imported:(\d+):(.+)$/.exec(s.message ?? "");
  if (w) new Notification("School Social Hub", { body: L(`New photos from ${w[1]} are in the library`, `صور جديدة من ${w[1]} في المكتبة`) });
  if (im) new Notification("School Social Hub", { body: L(`Import finished: ${im[1]} photos in ${im[2]}`, `انتهى الاستيراد: ${im[1]} صورة في ${im[2]}`) });
});

const ACTIONS = () => ({
  rating: L("Rated", "تقييم"), flag: L("Picked / rejected", "اختيار / رفض"), label: L("Label", "تصنيف"), tag: L("Named faces", "تسمية وجوه"), untag: L("Removed names", "إزالة أسماء"),
  hide: L("Not faces", "ليست وجوهًا"), move: L("Moved photos", "نقل صور"), import: L("Imported", "استيراد"), bin: L("Moved to Bin", "نقل إلى السلة"), post: L("New post", "منشور جديد"), canPost: L("In posts changed", "تغيير الظهور في المنشورات"),
  confirm: L("Named faces", "تسمية وجوه"), rename: L("Renamed folders", "إعادة تسمية مجلدات"), restore: L("Put back from Bin", "استعادة من السلة"), student: L("Student changed", "تغيير طالب"), promote: L("New school year", "عام دراسي جديد"), merge: L("Merged students", "دمج طلاب"),
});
App.views.history = {
  async render(main) {
    main.innerHTML = topbar(L("History", "السجل"), L("Everything changed on this computer. ⌘Z undoes the last one.", "كل ما تغيّر على هذا الجهاز. ⌘Z يتراجع عن الأخير."), `<button class="btn" id="h-undo">${icon("undo-2", 14)} ${L("Undo last", "تراجع عن الأخير")}</button>`) + `<div class="content" id="hc">${skeletonRows(8)}</div>`;
    $("#h-undo", main).onclick = async () => { await doUndo(); go("history"); };
    const rows = (await quiet("history")) ?? [];
    const imports = (await quiet("importHistory")) ?? [];
    $("#hc", main).innerHTML = `${imports.length ? `<h2 style="margin-bottom: 8px">${L("Imports", "عمليات الاستيراد")}</h2><div class="card" style="margin-bottom: 18px"><table class="list"><tbody>${imports.map((r) => `<tr><td class="muted small" style="width: 170px">${new Date(r.at).toLocaleString(S.language === "en" ? "en-GB" : "ar-EG")}</td><td><b>${esc(r.source ?? "")}</b><div class="small muted">${esc([r.who, r.photographer, ...JSON.parse(r.folders || "[]").slice(0, 2).map((f) => f.split(/[\\/]/).slice(-2).join(" / "))].filter(Boolean).join(" · "))}</div></td><td class="small">${plural(r.copied, "photo", "photos", "صورة")}${r.skipped ? ` · ${L(`${r.skipped} left out`, `${num(r.skipped)} مستبعدة`)}` : ""}</td><td><button class="btn small ghost" data-impsum="${r.id}">${L("Summary", "الملخص")}</button></td><td>${r.undone ? `<span class="tag">${L("Undone", "تم التراجع")}</span>` : `<button class="btn small" data-undoimp="${r.id}">${L("Undo import", "تراجع عن الاستيراد")}</button>`}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <h2 style="margin-bottom: 8px">${L("Changes", "التغييرات")}</h2>
      ${rows.length ? `<div class="card"><table class="list"><tbody>${rows.map((r) => `<tr><td class="muted small" style="width: 170px">${new Date(r.at).toLocaleString(S.language === "en" ? "en-GB" : "ar-EG")}</td><td><b>${esc(ACTIONS()[r.action] ?? r.action)}</b>${r.who ? `<div class="small muted">${esc(r.who)}</div>` : ""}</td><td class="muted small">${esc(r.detail)}</td><td>${r.can_undo ? `<span class="tag">${L("can undo", "يمكن التراجع")}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : emptyState("history", L("Nothing yet", "لا شيء بعد"))}`;
    $$("[data-impsum]", main).forEach((b) => (b.onclick = () => go("import", { summary: Number(b.dataset.impsum) })));
    $$("[data-undoimp]", main).forEach((b) => (b.onclick = async () => {
      const r = await call("undoImport", Number(b.dataset.undoimp));
      toast(L(`${r.binned} photos moved to the Bin`, `نُقلت ${num(r.binned)} صورة إلى السلة`));
      go("history");
    }));
  },
};

// Shows the plan first (where photos will go, what the app isn't sure of),
// then moves everything in place. One undo for the whole tidy-up.
async function tidyPlan() {
  const plan = await call("filingPlan");
  if (!plan) return;
  const m = modal(`<h2>${L("Tidy my folder", "ترتيب مجلدي")}</h2>
    ${plan.count ? `<p>${L(`${num(plan.count)} photos will move into ${num(plan.groups.length)} event folders:`, `ستنتقل ${num(plan.count)} صورة إلى ${num(plan.groups.length)} مجلد فعالية:`)}</p>
      <div class="col gap4" style="max-height: 300px; overflow-y: auto">${plan.groups.map((g) => `<div class="row small nowrap"><span class="ltr muted">${esc(g.date)}</span><b class="grow">${esc(g.title)}${g.className ? ` / ${esc(g.className)}` : ""}</b><span class="muted">${num(g.n)}</span></div>`).join("")}</div>`
      : `<p class="muted">${L("Everything is already filed.", "كل شيء مرتب بالفعل.")}</p>`}
    ${plan.unsure ? `<div class="note warn">${L(`${num(plan.unsure)} photos have no date anywhere. They stay where they are and show in “Needs sorting”.`, `${num(plan.unsure)} صورة بلا تاريخ. تبقى مكانها وتظهر في «تحتاج ترتيبًا».`)}</div>` : ""}
    <p class="muted small">${L("Tip: make a backup first (Settings → Storage & backup).", "نصيحة: اعمل نسخة احتياطية أولًا (الإعدادات ← التخزين والنسخ الاحتياطي).")}</p>
    <div class="row"><span class="grow"></span><button class="btn" id="t-no">${L("Cancel", "إلغاء")}</button><button class="btn primary" id="t-go" ${plan.count ? "" : "disabled"}>${L("Move them now", "انقلها الآن")}</button></div>`);
  $("#t-no", m).onclick = closeOverlay;
  $("#t-go", m).onclick = async () => {
    $("#t-go", m).disabled = true;
    const r = await call("applyFiling");
    closeOverlay();
    toast(L(`${r.moved} photos filed. ⌘Z undoes it.`, `رُتبت ${num(r.moved)} صورة. ⌘Z للتراجع.`), { ms: 7000 });
  };
}
