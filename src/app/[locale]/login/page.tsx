import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { signIn } from "@/lib/actions/auth";
import { safeNext } from "@/lib/session";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error, next } = await searchParams;
  const t = await getTranslations();
  const nextPath = safeNext(next, "/dashboard");

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        <Card>
          <form action={signIn} className="space-y-4">
            <h1 className="text-xl font-bold">{t("login.title")}</h1>
            {error === "1" && <Notice>{t("login.error")}</Notice>}
            {error === "link" && <Notice>{t("login.linkError")}</Notice>}
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={nextPath} />
            <Field label={t("common.email")} name="email" type="email" autoComplete="email" dir="ltr" required />
            <Field label={t("common.password")} name="password" type="password" autoComplete="current-password" dir="ltr" required />
            <Button className="w-full">{t("common.signIn")}</Button>
          </form>
        </Card>
        <p className="text-center text-sm text-muted">
          {t("login.noAccount")}{" "}
          <Link href={{ pathname: "/signup", query: { next: nextPath } }} className="font-semibold text-accent">
            {t("common.signUp")}
          </Link>
        </p>
      </PageBody>
    </>
  );
}
