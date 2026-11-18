import { getTranslations, setRequestLocale } from "next-intl/server";
import { OwnerShell } from "@/components/owner-shell";
import { Button, Card, Field, Notice, TextArea, Toggle } from "@/components/ui";
import { ownerSavePlan, ownerSaveSettings } from "@/lib/actions/owner";
import { requireOwner, type OwnerSettings, type Plan } from "@/lib/owner";

// Plans and prices: names, the two limits and the yearly price of each plan,
// prices of extras, the renew contact schools see, and whether people may
// create a school by themselves.
export default async function OwnerPlansPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; error?: string; moved?: string; kept?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { supabase } = await requireOwner(locale);
  const t = await getTranslations();
  const sp = await searchParams;
  const [{ data: plans }, { data: settings }] = await Promise.all([
    supabase.from("plans").select("id, name_en, name_ar, manager_limit, computer_limit, price_year, active, sort").order("sort"),
    supabase.from("owner_settings").select("currency, extra_manager_price, extra_computer_price, contact, self_signup").maybeSingle<OwnerSettings>(),
  ]);

  const planForm = (p: Partial<Plan> & { id?: string }, isNew = false) => (
    <form action={ownerSavePlan} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      {isNew ? (
        <Field label={t("owner.plans.id")} name="id" pattern="[a-z0-9_-]{2,30}" required dir="ltr" hint={t("owner.plans.idHint")} />
      ) : (
        <input type="hidden" name="id" value={p.id} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("owner.plans.nameEn")} name="nameEn" defaultValue={p.name_en} maxLength={40} required dir="ltr" />
        <Field label={t("owner.plans.nameAr")} name="nameAr" defaultValue={p.name_ar} maxLength={40} required dir="rtl" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("owner.plans.managers")} name="managers" type="number" min={1} max={500} defaultValue={p.manager_limit ?? 4} required />
        <Field label={t("owner.plans.computers")} name="computers" type="number" min={1} max={50} defaultValue={p.computer_limit ?? 2} required />
        <Field label={t("owner.plans.price", { currency: settings?.currency ?? "EGP" })} name="price" inputMode="decimal" defaultValue={p.price_year ?? ""} />
      </div>
      <Toggle name="active" value="1" defaultChecked={p.active ?? true} label={t("owner.plans.active")} />
      {!isNew && <Toggle name="applyNow" value="1" label={t("owner.plans.applyNow")} hint={t("owner.plans.applyNowHint")} />}
      <Button variant={isNew ? "primary" : "quiet"}>{isNew ? t("owner.plans.add") : t("owner.plans.save")}</Button>
    </form>
  );

  return (
    <OwnerShell locale={locale} active="plans" title={t("owner.plans.title")}>
      {sp.saved && <Notice tone="good">{sp.saved === "settings" ? t("owner.plans.settingsSaved") : t("owner.plans.saved", { moved: Number(sp.moved ?? 0), kept: Number(sp.kept ?? 0) })}</Notice>}
      {sp.error && <Notice>{t("owner.plans.error")}</Notice>}
      <div className="grid gap-5 md:grid-cols-2">
        {((plans ?? []) as Plan[]).map((p) => (
          <Card key={p.id} title={locale === "ar" ? p.name_ar : p.name_en}>
            {planForm(p)}
          </Card>
        ))}
        <Card title={t("owner.plans.newPlan")}>{planForm({}, true)}</Card>
        <Card title={t("owner.plans.settingsTitle")} className="md:col-span-2">
          <form action={ownerSaveSettings} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("owner.plans.currency")} name="currency" defaultValue={settings?.currency ?? "EGP"} maxLength={3} dir="ltr" />
              <Field label={t("owner.plans.extraManager")} name="extraManagerPrice" inputMode="decimal" defaultValue={settings?.extra_manager_price ?? ""} />
              <Field label={t("owner.plans.extraComputer")} name="extraComputerPrice" inputMode="decimal" defaultValue={settings?.extra_computer_price ?? ""} />
            </div>
            <TextArea label={t("owner.plans.contact")} name="contact" rows={3} maxLength={300} defaultValue={settings?.contact ?? ""} hint={t("owner.plans.contactHint")} />
            <Toggle name="selfSignup" value="1" defaultChecked={settings?.self_signup ?? false} label={t("owner.plans.selfSignup")} hint={t("owner.plans.selfSignupHint")} />
            <Button>{t("owner.plans.saveSettings")}</Button>
          </form>
        </Card>
      </div>
    </OwnerShell>
  );
}
