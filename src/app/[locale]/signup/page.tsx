import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { signUp } from "@/lib/actions/auth";
import { safeNext } from "@/lib/session";

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string; email?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error, next, email } = await searchParams;
  const t = await getTranslations();
  const nextPath = safeNext(next, "/onboarding");

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        <Card>
          <form action={signUp} className="space-y-4">
            <h1 className="text-xl font-bold">{t("signup.title")}</h1>
            {error && <Notice>{t("signup.error")}</Notice>}
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={nextPath} />
            <Field label={t("common.email")} name="email" type="email" autoComplete="email" dir="ltr" defaultValue={email} required />
            <Field
              label={t("common.password")}
              hint={t("signup.passwordHint")}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              dir="ltr"
              required
            />
            <Button className="w-full">{t("common.signUp")}</Button>
          </form>
        </Card>
        <p className="text-center text-sm text-muted">
          {t("signup.haveAccount")}{" "}
          <Link href={{ pathname: "/login", query: { next: nextPath } }} className="font-semibold text-accent">
            {t("common.signIn")}
          </Link>
        </p>
      </PageBody>
    </>
  );
}
