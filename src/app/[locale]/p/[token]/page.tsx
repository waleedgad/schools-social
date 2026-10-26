import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { PortalUploader } from "@/components/portal-uploader";
import { Card, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type LinkInfo = { school_name: string; event_title: string; event_date: string; label: string; usable: boolean };

// The page a photographer or agency opens from the school's link. No account.
export default async function PortalPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_upload_link", { p_token: token });
  const info = (data as LinkInfo[] | null)?.[0];

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        {!info || !info.usable ? (
          <Notice>{t("invalid")}</Notice>
        ) : (
          <Card className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold">{t("title", { school: info.school_name })}</h1>
              <p className="text-muted">
                {info.event_title} · {info.event_date}
              </p>
              <p className="text-sm text-muted">{t("for", { label: info.label })}</p>
            </div>
            <PortalUploader token={token} />
            <p className="text-xs text-muted">{t("privacy")}</p>
          </Card>
        )}
      </PageBody>
    </>
  );
}
