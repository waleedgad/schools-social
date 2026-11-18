import { getTranslations, setRequestLocale } from "next-intl/server";
import { OwnerShell } from "@/components/owner-shell";
import { Button, Card, Field, Notice, Select, Toggle } from "@/components/ui";
import { ownerCreateSchool } from "@/lib/actions/owner";
import { requireOwner, type Plan } from "@/lib/owner";

// New school: name, plan, first "paid until" or a 14-day trial, and the
// Admin's email for the invite.
export default async function OwnerNewSchoolPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase } = await requireOwner(locale);
  const t = await getTranslations();
  const { error } = await searchParams;
  const { data } = await supabase.from("plans").select("id, name_en, name_ar, manager_limit, computer_limit").eq("active", true).order("sort");
  const plans = (data ?? []) as Plan[];
  const inYear = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);

  return (
    <OwnerShell locale={locale} active="new" title={t("owner.new.title")}>
      <Card className="max-w-xl">
        <form action={ownerCreateSchool} className="space-y-4">
          {error && <Notice>{t("owner.new.error")}</Notice>}
          <input type="hidden" name="locale" value={locale} />
          <Field label={t("owner.new.name")} name="name" minLength={2} maxLength={120} required />
          <Select label={t("owner.new.plan")} name="plan" defaultValue="standard">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {t("owner.planOption", { name: locale === "ar" ? p.name_ar : p.name_en, managers: p.manager_limit, computers: p.computer_limit })}
              </option>
            ))}
          </Select>
          <Toggle name="trial" value="1" defaultChecked label={t("owner.new.trial")} hint={t("owner.new.trialHint")} />
          <Field label={t("owner.new.paidUntil")} name="paidUntil" type="date" defaultValue={inYear} hint={t("owner.new.paidUntilHint")} />
          <Field label={t("owner.new.email")} name="email" type="email" dir="ltr" required hint={t("owner.new.emailHint")} />
          <Select label={t("owner.new.language")} name="schoolLocale" defaultValue={locale}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
          <Button>{t("owner.new.create")}</Button>
        </form>
      </Card>
    </OwnerShell>
  );
}
