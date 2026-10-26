import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Card } from "@/components/ui";

export default async function CheckEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { email = "" } = await searchParams;
  const t = await getTranslations("signup");

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        <Card className="space-y-2">
          <h1 className="text-xl font-bold">{t("checkEmail")}</h1>
          <p className="text-muted">{t("checkEmailBody", { email })}</p>
        </Card>
      </PageBody>
    </>
  );
}
