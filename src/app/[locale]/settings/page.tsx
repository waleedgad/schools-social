import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { choosePage, disconnectMeta, saveSettings } from "@/lib/actions/settings";
import { isAiConfigured } from "@/lib/ai";
import { isMetaConfigured } from "@/lib/meta";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type MetaStatus = {
  page_id: string | null;
  page_name: string | null;
  ig_username: string | null;
  connected_at: string;
  last_error: string | null;
  pages: { id: string; name: string; ig: string | null }[];
};

const TIME_ZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Amman", "Europe/London"];
const textarea = "w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string; meta?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "manageSettings")) redirect({ href: "/dashboard", locale });

  const { saved, error, meta: metaResult } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const { data: school } = await supabase
    .from("schools")
    .select("name, default_locale, timezone, brand_voice, hashtags, caption_languages, require_signoff")
    .eq("id", membership.school.id)
    .single();
  const { data: metaRows } = await supabase.rpc("meta_status", { p_school: membership.school.id });
  const meta = (metaRows as MetaStatus[] | null)?.[0];

  const setup = [
    { key: "database", ok: isAdminConfigured },
    { key: "ai", ok: isAiConfigured() },
    { key: "meta", ok: isMetaConfigured() },
  ];

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <Link href="/dashboard" className="text-sm text-accent hover:underline">
            {t("staff.back")}
          </Link>
        </div>
        {saved && <Notice tone="info">{t("settings.saved")}</Notice>}
        {error && <Notice>{t("settings.error")}</Notice>}

        <Card>
          <form action={saveSettings} className="space-y-4">
            <input type="hidden" name="locale" value={locale} />
            <h2 className="font-semibold">{t("settings.school")}</h2>
            <Field label={t("onboarding.schoolName")} name="name" defaultValue={school?.name} minLength={2} maxLength={120} required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label={t("onboarding.defaultLanguage")} name="defaultLocale" defaultValue={school?.default_locale}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </Select>
              <Select label={t("settings.timezone")} name="timezone" defaultValue={school?.timezone}>
                {TIME_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </div>
            <h2 className="pt-2 font-semibold">{t("settings.voice")}</h2>
            <Select label={t("settings.captionLanguages")} name="captionLanguages" defaultValue={school?.caption_languages}>
              <option value="ar_en">{t("settings.languages.ar_en")}</option>
              <option value="ar">{t("settings.languages.ar")}</option>
              <option value="en">{t("settings.languages.en")}</option>
            </Select>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("settings.brandVoice")}</span>
              <textarea name="brandVoice" rows={3} maxLength={500} defaultValue={school?.brand_voice ?? ""} placeholder={t("settings.brandVoiceHint")} className={textarea} />
            </label>
            <Field label={t("settings.hashtags")} name="hashtags" maxLength={300} defaultValue={school?.hashtags ?? ""} placeholder="#MySchool #ProudOfOurStudents" />
            <h2 className="pt-2 font-semibold">{t("settings.approvals")}</h2>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="requireSignoff" defaultChecked={school?.require_signoff} className="mt-1" />
              <span>{t("settings.requireSignoff")}</span>
            </label>
            <Button>{t("common.save")}</Button>
          </form>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">{t("settings.social")}</h2>
          {metaResult && <Notice tone={metaResult === "connected" ? "info" : "danger"}>{t(`settings.metaResult.${metaResult}`)}</Notice>}
          {meta?.page_id ? (
            <>
              <p className="text-sm">
                {t("settings.connectedTo", { page: meta.page_name ?? "" })}
                {meta.ig_username ? ` · Instagram @${meta.ig_username}` : ` · ${t("settings.noInstagram")}`}
              </p>
              {meta.last_error && <Notice>{t("settings.lastError", { error: meta.last_error })}</Notice>}
              {meta.pages.length > 1 && (
                <form action={choosePage} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <div className="min-w-48 flex-1">
                    <Select label={t("settings.choosePage")} name="page" defaultValue={meta.page_id}>
                      {meta.pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.ig ? ` · @${p.ig}` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button variant="quiet">{t("common.save")}</Button>
                </form>
              )}
              <div className="flex gap-4">
                <a href={`/api/meta/connect?locale=${locale}`} className="text-sm font-semibold text-accent hover:underline">
                  {t("settings.reconnect")}
                </a>
                <form action={disconnectMeta}>
                  <input type="hidden" name="locale" value={locale} />
                  <button className="text-sm text-danger hover:underline">{t("settings.disconnect")}</button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">{t("settings.connectHint")}</p>
              <a href={`/api/meta/connect?locale=${locale}`} className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
                {t("settings.connect")}
              </a>
            </>
          )}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-semibold">{t("settings.setup")}</h2>
          <ul className="space-y-1 text-sm">
            {setup.map((s) => (
              <li key={s.key} className={s.ok ? "" : "text-danger"}>
                {s.ok ? "✓ " : "✕ "}
                {t(`settings.setupItems.${s.key}`)}
              </li>
            ))}
          </ul>
        </Card>
      </PageBody>
    </>
  );
}
