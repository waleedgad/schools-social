import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Empty, Notice } from "@/components/ui";
import { answerFaceCheck } from "@/lib/actions/team";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { classScope, classStudents, signPaths, staffClient } from "@/lib/team";

type Check = { id: string; photo_id: string; box: number[]; student_code: string; class_name: string | null; answer: boolean | null };

// "Is this …?" on the class teacher's phone: the Mac asks about faces it
// isn't sure of; the answer goes back to the Mac, which names the face there.
export default async function CheckPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const scope = await classScope(supabase, schoolId, user.id, membership.role);

  let q = supabase.from("face_checks").select("id, photo_id, box, student_code, class_name, answer").eq("school_id", schoolId).is("answer", null).order("created_at").limit(30);
  if (!scope.all) q = q.in("class_name", scope.classes.length ? scope.classes : ["-"]);
  const { data } = await q.returns<Check[]>();
  const checks = data ?? [];
  const { count: answered } = await supabase.from("face_checks").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("answered_by", user.id);

  const { data: photos } = checks.length
    ? await staffClient(supabase).from("photos").select("id, storage_path, edited_path").in("id", [...new Set(checks.map((c) => c.photo_id))])
    : { data: [] as { id: string; storage_path: string; edited_path: string | null }[] };
  // The full web copy (not the edited one): the face box is a fraction of it.
  const pathOf = new Map((photos ?? []).map((p) => [p.id as string, (p.storage_path as string) ?? ""]));
  const urls = await signPaths(supabase, [...pathOf.values()]);
  const students = new Map((await classStudents(supabase, schoolId, scope.all ? scope : { all: false, classes: [...new Set(checks.map((c) => c.class_name ?? ""))].filter((c) => scope.classes.includes(c)) }, locale)).map((s) => [s.code, s]));

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="check" title={t("check.title")} subtitle={t("check.subtitle")}>
      {!scope.all && !scope.classes.length && <Notice tone="info">{t("check.noClasses")}</Notice>}
      {!checks.length ? (
        <Empty icon="face" title={t("check.none")} body={answered ? t("check.thanks", { count: answered }) : t("check.noneHint")} />
      ) : (
        <ul className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {checks.map((c) => {
            const url = urls.get(pathOf.get(c.photo_id) ?? "");
            const [x, y, w, h] = c.box;
            const s = students.get(c.student_code);
            return (
              <li key={c.id}>
                <Card className="space-y-3 !p-3">
                  <div className="relative overflow-hidden rounded-lg bg-background">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                      <img src={url} alt="" className="block w-full" />
                    ) : (
                      <div className="grid aspect-[4/3] place-items-center text-sm text-muted">{t("check.noPhoto")}</div>
                    )}
                    {url && (
                      <span
                        className="pointer-events-none absolute rounded-md border-[3px] border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                      />
                    )}
                  </div>
                  <p className="text-center text-base">
                    {t("check.question")} <b>{s?.name ?? c.student_code}</b>?
                    {c.class_name && <span className="block text-xs text-muted">{c.class_name}</span>}
                  </p>
                  <form action={answerFaceCheck} className="grid grid-cols-2 gap-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={c.id} />
                    <Button name="answer" value="no" variant="quiet" icon="x" className="py-3">{t("check.no")}</Button>
                    <Button name="answer" value="yes" variant="good" icon="check" className="py-3">{t("check.yes")}</Button>
                  </form>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-center text-xs text-muted">{t("check.privacy")}</p>
    </AppShell>
  );
}
