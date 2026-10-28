import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Notice } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user } = await getSession();
  if (user) redirect({ href: "/today", locale });

  const t = await getTranslations();

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        <div className="space-y-4 pt-8 text-center">
          <h1 className="text-3xl font-bold">{t("app.name")}</h1>
          <p className="text-lg text-muted">{t("app.tagline")}</p>
        </div>
        {!isSupabaseConfigured && <Notice tone="info">{t("common.notConfigured")}</Notice>}
        <div className="flex flex-col gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-accent px-4 py-3 text-center font-semibold text-accent-foreground"
          >
            {t("home.getStarted")}
          </Link>
          <p className="text-center text-sm text-muted">
            {t("home.haveAccount")}{" "}
            <Link href="/login" className="font-semibold text-accent">
              {t("common.signIn")}
            </Link>
          </p>
        </div>
      </PageBody>
    </>
  );
}
