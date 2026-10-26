import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { createSchool } from "@/lib/actions/school";
import { getSession } from "@/lib/session";

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
  if (membership) redirect({ href: "/dashboard", locale });

  const { error } = await searchParams;
  const t = await getTranslations();

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody narrow>
        <Card>
          <form action={createSchool} className="space-y-4">
            <h1 className="text-xl font-bold">{t("onboarding.title")}</h1>
            <p className="text-sm text-muted">{t("onboarding.intro")}</p>
            {error && <Notice>{t("onboarding.error")}</Notice>}
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
