import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { createSchool } from "@/lib/actions/school";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership } = await getSession();
  if (!user) redirect({ href: "/login", locale });
  if (membership) redirect({ href: "/today", locale });

  const { error } = await searchParams;
  const t = await getTranslations();
  // New schools are made by the owner (0.13); this page only offers to make
  // one while the owner allows people to sign up by themselves.
  const supabase = await createClient();
  const [{ data: open }, { data: owner }] = await Promise.all([supabase.rpc("signup_open"), supabase.rpc("is_owner")]);
  if (owner) redirect({ href: "/owner", locale });
  if (!open) {
    return (
      <>
        <AppHeader locale={locale} signedIn />
        <PageBody narrow>
          <Card>
            <div data-testid="signup-closed" className="space-y-3">
              <h1 className="text-xl font-bold">{t("plan.closed.title")}</h1>
              <p className="text-sm text-muted">{t("plan.closed.body")}</p>
              <p className="text-sm text-muted">{t("plan.closed.invite")}</p>
            </div>
          </Card>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody narrow>
        <Card>
          <form action={createSchool} className="space-y-4">
            <h1 className="text-xl font-bold">{t("onboarding.title")}</h1>
            <p className="text-sm text-muted">{t("onboarding.intro")}</p>
            {error && <Notice>{error === "signup_closed" ? t("plan.closed.body") : t("onboarding.error")}</Notice>}
            <input type="hidden" name="locale" value={locale} />
            <Field label={t("onboarding.schoolName")} name="schoolName" minLength={2} maxLength={120} required />
            <Field label={t("common.fullName")} name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
            <Select label={t("onboarding.defaultLanguage")} name="defaultLocale" defaultValue={locale}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
            <Button className="w-full">{t("onboarding.create")}</Button>
          </form>
        </Card>
      </PageBody>
    </>
  );
}
