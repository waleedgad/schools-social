import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { setNewPassword } from "@/lib/actions/auth";
import { getSession } from "@/lib/session";

// Reached from the password email link (which signs the person in) or from
// "Change password" in the menu.
export default async function NewPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user } = await getSession();
  if (!user) redirect({ href: { pathname: "/login", query: { error: "link" } }, locale });
  const { error } = await searchParams;
  const t = await getTranslations();
  const message = { short: "password.tooShort", match: "password.mismatch", save: "password.saveError" }[error ?? ""];

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody narrow>
        <Card>
          <form action={setNewPassword} className="space-y-4">
            <h1 className="text-xl font-bold">{t("password.newTitle")}</h1>
            {message && <Notice>{t(message)}</Notice>}
            <input type="hidden" name="locale" value={locale} />
            <Field label={t("password.newPassword")} name="password" type="password" autoComplete="new-password" dir="ltr" minLength={8} required />
            <Field label={t("password.repeat")} name="repeat" type="password" autoComplete="new-password" dir="ltr" minLength={8} required />
            <Button className="w-full">{t("password.save")}</Button>
          </form>
        </Card>
      </PageBody>
    </>
  );
}
