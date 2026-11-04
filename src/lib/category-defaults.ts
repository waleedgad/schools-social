// The ready-made categories every new school gets (seed_categories in the
// database) have one description, written in English. On Arabic pages the
// untouched ones show in Arabic; a description the school changed shows as written.
const AR: Record<string, string> = {
  "Awards, competitions and results.": "الجوائز والمسابقات والنتائج.",
  "Trips, celebrations, sports days and assemblies.": "الرحلات والاحتفالات والأيام الرياضية والطابور.",
  "Lessons, projects and learning in class.": "الدروس والمشاريع والتعلّم في الفصل.",
  "A normal day at school.": "يوم عادي في المدرسة.",
  "Thanking and introducing teachers.": "شكر المعلمين والتعريف بهم.",
  "Art, writing and projects by students.": "فنون الطلاب وكتاباتهم ومشاريعهم.",
  "Holidays, dates and reminders.": "الإجازات والمواعيد والتذكيرات.",
  "Open days and enrolment.": "الأيام المفتوحة والتسجيل.",
  "National days, Ramadan, Eid and other occasions.": "الأعياد الوطنية ورمضان والعيد وغيرها من المناسبات.",
};

export function categoryDescription(text: string | null | undefined, locale: string) {
  if (!text) return text ?? "";
  return locale === "ar" ? (AR[text.trim()] ?? text) : text;
}
