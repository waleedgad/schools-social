import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { requestPasswordReset } from "@/lib/actions/auth";

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error, sent, email = "" } = await searchParams;
  const t = await getTranslations();

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        <Card>
          {sent ? (
            <div className="space-y-3">
              <h1 className="text-xl font-bold">{t("password.title")}</h1>
              <Notice tone="info">{t("password.sent", { email })}</Notice>
            </div>
          ) : (
            <form action={requestPasswordReset} className="space-y-4">
              <h1 className="text-xl font-bold">{t("password.title")}</h1>
              <p className="text-sm text-muted">{t("password.intro")}</p>
              {error && <Notice>{t("password.error")}</Notice>}
              <input type="hidden" name="locale" value={locale} />
              <Field label={t("common.email")} name="email" type="email" autoComplete="email" dir="ltr" defaultValue={email} required />
              <Button className="w-full">{t("password.send")}</Button>
            </form>
          )}
        </Card>
        <p className="text-center text-sm">
          <Link href="/login" className="font-semibold text-accent-ink">
            {t("common.signIn")}
          </Link>
        </p>
      </PageBody>
    </>
  );
}
