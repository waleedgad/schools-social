import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { sendCode, signIn, signInWithProvider, verifyCode } from "@/lib/actions/auth";
import { safeNext } from "@/lib/session";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; next?: string; sent?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { error, next, sent, to } = await searchParams;
  // Which extra ways to sign in this school's set-up has switched on.
  const providers = [process.env.AUTH_GOOGLE === "on" && "google", process.env.AUTH_MICROSOFT === "on" && "azure"].filter(Boolean) as string[];
  const phoneCodes = process.env.AUTH_PHONE === "on";
  const t = await getTranslations();
  const nextPath = safeNext(next, "/today");

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
        <Card className="space-y-3">
          {providers.map((p) => (
            <form key={p} action={signInWithProvider}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={nextPath} />
              <input type="hidden" name="provider" value={p} />
              <Button variant="quiet" className="w-full">{t(`more.login.${p}`)}</Button>
            </form>
          ))}
          {error === "provider" && <Notice>{t("more.login.providerError")}</Notice>}
          {sent && to ? (
            <form action={verifyCode} className="space-y-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={nextPath} />
              <input type="hidden" name="to" value={to} />
              <p className="text-sm text-muted">{t(sent === "phone" ? "more.login.sentPhone" : "more.login.sentEmail", { to })}</p>
              {error === "badcode" && <Notice>{t("more.login.badCode")}</Notice>}
              <Field label={t("more.login.code")} name="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={10} required />
              <Button className="w-full">{t("more.login.verify")}</Button>
            </form>
          ) : (
            <form action={sendCode} className="space-y-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={nextPath} />
              <p className="text-sm font-semibold">{t("more.login.noPassword")}</p>
              {error === "code" && <Notice>{t("more.login.codeError")}</Notice>}
              <Field label={t("common.email")} name="email" type="email" autoComplete="email" dir="ltr" />
              {phoneCodes && <Field label={t("more.login.phone")} name="phone" type="tel" autoComplete="tel" dir="ltr" />}
              <Button variant="quiet" className="w-full">{t("more.login.sendCode")}</Button>
            </form>
          )}
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
