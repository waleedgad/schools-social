import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Button, Card, Chip, Field, Notice, Select } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { setAccountPaused, setPause } from "@/lib/actions/brand";
import { choosePage, disconnectMeta } from "@/lib/actions/settings";
import { isPaused } from "@/lib/posting";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type MetaStatus = {
  page_id: string | null;
  page_name: string | null;
  ig_username: string | null;
  connected_at: string;
  last_error: string | null;
  pages: { id: string; name: string; ig: string | null }[];
  fb_paused: boolean;
  ig_paused: boolean;
  token_expires_at: string | null;
};

// Accounts home: which Page and Instagram the school posts to, their health,
// and the pause buttons (all posting, or one account).
export default async function AccountsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ meta?: string; saved?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  const perms = membership.school.permissions;
  if (!can(membership.role, "pauseAccounts", perms)) redirect({ href: "/today", locale });
  const sp = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const isAdmin = can(membership.role, "manageSettings", perms);

  const [{ data: metaRows }, { data: school }, { count: queued }] = await Promise.all([
    supabase.rpc("meta_status", { p_school: schoolId }),
    supabase.from("schools").select("posting_paused_until, pause_reason").eq("id", schoolId).single(),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("status", "scheduled"),
  ]);
  const meta = (metaRows as MetaStatus[] | null)?.[0];
  const paused = school ? isPaused(school) : false;
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const until = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: membership.school.timezone });

  const accounts = meta?.page_id
    ? [
        { platform: "facebook" as const, name: meta.page_name ?? "", paused: meta.fb_paused, ok: true },
        { platform: "instagram" as const, name: meta.ig_username ? `@${meta.ig_username}` : t("settings.noInstagram"), paused: meta.ig_paused, ok: !!meta.ig_username },
      ]
    : [];

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="accounts" title={t("accounts.title")} subtitle={t("accounts.subtitle")}>
      {sp.meta && <Notice tone={sp.meta === "connected" ? "good" : "danger"}>{t(`settings.metaResult.${sp.meta}`)}</Notice>}
      {sp.saved && <Notice tone="good">{t("settings.saved")}</Notice>}

      <Card title={t("accounts.pauseAll")}>
        {paused ? (
          <div className="space-y-3">
            <Notice tone="warn">
              {t("accounts.pausedUntil", { until: until(school!.posting_paused_until as string), count: queued ?? 0 })} {school?.pause_reason}
            </Notice>
            <form action={setPause}>
              {hidden}
              <input type="hidden" name="days" value="0" />
              <Button icon="play" variant="good">{t("accounts.resume")}</Button>
            </form>
          </div>
        ) : (
          <form action={setPause} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            {hidden}
            <Select label={t("accounts.for")} name="days" defaultValue="1">
              {[1, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {t("accounts.days", { count: d })}
                </option>
              ))}
            </Select>
            <Field label={t("accounts.reason")} name="reason" maxLength={200} placeholder={t("accounts.reasonHint")} />
            <Button icon="pause" variant="quiet">{t("accounts.pause")}</Button>
          </form>
        )}
        <p className="mt-2 text-xs text-muted">{t("accounts.pauseHint")}</p>
      </Card>

      <Card title={t("accounts.connected")}>
        {!meta?.page_id ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t("settings.connectHint")}</p>
            {isAdmin ? (
              <a href={`/api/meta/connect?locale=${locale}`} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
                <Icon name="facebook" /> {t("settings.connect")}
              </a>
            ) : (
              <p className="text-sm">{t("accounts.askAdmin")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="grid gap-3 sm:grid-cols-2">
              {accounts.map((a) => (
                <li key={a.platform} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <span className="grid size-10 place-items-center rounded-full bg-accent-bg text-accent-ink">
                    <Icon name={a.platform} size={18} />
                  </span>
                  <div className="min-w-0 grow">
                    <b className="block truncate text-sm">{a.name}</b>
                    <Chip tone={!a.ok ? "danger" : a.paused ? "warn" : "good"}>{!a.ok ? t("accounts.notLinked") : a.paused ? t("accounts.paused") : t("accounts.healthy")}</Chip>
                  </div>
                  {a.ok && (
                    <form action={setAccountPaused}>
                      {hidden}
                      <input type="hidden" name="platform" value={a.platform} />
                      <input type="hidden" name="paused" value={a.paused ? "0" : "1"} />
                      <Button variant="quiet" icon={a.paused ? "play" : "pause"} className="!px-2.5 !py-1 text-xs">
                        {a.paused ? t("accounts.resume") : t("accounts.pause")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {meta.last_error && <Notice>{t("settings.lastError", { error: meta.last_error })}</Notice>}
            {meta.token_expires_at && Date.parse(meta.token_expires_at) - Date.now() < 14 * 86400_000 && <Notice tone="warn">{t("accounts.expiresSoon", { date: until(meta.token_expires_at) })}</Notice>}
            {isAdmin && meta.pages.length > 1 && (
              <form action={choosePage} className="flex flex-wrap items-end gap-2">
                {hidden}
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
            {isAdmin && (
              <div className="flex gap-4">
                <a href={`/api/meta/connect?locale=${locale}`} className="text-sm font-semibold text-accent hover:underline">
                  {t("settings.reconnect")}
                </a>
                <form action={disconnectMeta}>
                  {hidden}
                  <button className="text-sm text-danger hover:underline">{t("settings.disconnect")}</button>
                </form>
              </div>
            )}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
