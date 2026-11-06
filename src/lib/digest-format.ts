// The principal's weekly digest, the parts that don't need the database
// (the robot tests check them directly).
export type Digest = {
  from: string; // first day (school time, yyyy-mm-dd)
  to: string; // last day
  posted: number; // went out in these 7 days
  failed: number; // tried and didn't go out
  waitingComms: number; // waiting for the comms lead now
  waitingExtra: number; // waiting for the principal (extra approver) now
  scheduled: number; // going out in the next 7 days
  students: number; // students on the class lists
  notSeen: number; // students in no photo yet
  notSeenByClass: { className: string; count: number }[];
};


// The email, in Arabic and English (one message, both languages).
export function digestText(d: Digest, schoolName: string) {
  // Arabic digits in the Arabic part, like the rest of the app.
  const n = (x: number) => x.toLocaleString("ar-EG");
  const day = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("ar-EG", { day: "numeric", month: "long", timeZone: "UTC" });
  const ar = [
    `ملخص الأسبوع لمدرسة ${schoolName} (${day(d.from)} إلى ${day(d.to)})`,
    `نُشر: ${n(d.posted)}`,
    `لم يُنشر: ${n(d.failed)}`,
    `بانتظار فريق التواصل: ${n(d.waitingComms)}`,
    `بانتظار موافقتك: ${n(d.waitingExtra)}`,
    `مجدول للأسبوع القادم: ${n(d.scheduled)}`,
    `طلاب لم يظهروا في أي صورة بعد: ${n(d.notSeen)} من ${n(d.students)}`,
    ...d.notSeenByClass.filter((c) => c.className).map((c) => `  ${c.className}: ${n(c.count)}`),
  ];
  const en = [
    `Weekly digest for ${schoolName} (${d.from} to ${d.to})`,
    `Posted: ${d.posted}`,
    `Didn't go out: ${d.failed}`,
    `Waiting for the comms team: ${d.waitingComms}`,
    `Waiting for your approval: ${d.waitingExtra}`,
    `Scheduled for next week: ${d.scheduled}`,
    `Students not in any photo yet: ${d.notSeen} of ${d.students}`,
    ...d.notSeenByClass.filter((c) => c.className).map((c) => `  ${c.className}: ${c.count}`),
  ];
  return `${ar.join("\n")}\n\n${en.join("\n")}`;
}

// Is it time for this school's weekly email? Sunday (the first school day
// in Egypt) from 8 am, school time. Returns the week's key, or null.
export function digestDue(now: Date, timeZone: string): string | null {
  // Robot tests: any day and hour.
  if (process.env.DIGEST_ANY_DAY === "1") return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== "Sun" || Number(parts.hour) < 8) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}
