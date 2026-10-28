import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Notice, Pills, Select, TextArea, Toggle } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { saveApprovals, savePermissions, saveTermDates, setSelfFiling } from "@/lib/actions/brand";
import { saveSettings } from "@/lib/actions/settings";
import { isAiConfigured } from "@/lib/ai";
import { isMetaConfigured } from "@/lib/meta";
import { can, defaultCan, PERMISSION_KEYS, ROLES } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const TIME_ZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Amman", "Europe/London"];
const TABS = ["school", "approvals", "roles", "library", "setup"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; error?: string; tab?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "manageSettings", membership.school.permissions)) redirect({ href: "/today", locale });

  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "school";
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const [{ data: school }, { data: people }] = await Promise.all([
    supabase
      .from("schools")
      .select("name, default_locale, timezone, brand_voice, hashtags, caption_languages, approve_by, lead_self_publish, extra_approval, extra_approvers, extra_timeout_hours, extra_timeout_action, photo_limit, permissions, self_filing, term_dates")
      .eq("id", schoolId)
      .single(),
    supabase.from("memberships").select("user_id, full_name, role").eq("school_id", schoolId).eq("active", true).in("role", ["admin", "principal", "comms_lead"]),
  ]);
  const terms = ((school?.term_dates ?? []) as { name: string; start: string; end: string }[]);
  const overrides = (school?.permissions ?? {}) as Record<string, Record<string, boolean>>;
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="settings" title={t("settings.title")}>
      <Pills items={TABS.map((k) => ({ label: t(`settings.tabs.${k}`), href: { pathname: "/settings", query: { tab: k } }, on: k === tab }))} />
      {sp.saved && <Notice tone="good">{t("settings.saved")}</Notice>}
      {sp.error && <Notice>{t("settings.error")}</Notice>}

      {tab === "school" && (
        <>
          <Card>
            <form action={saveSettings} className="space-y-4">
              {hidden}
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
              <Select label={t("settings.captionLanguages")} name="captionLanguages" defaultValue={school?.caption_languages}>
                <option value="ar_en">{t("settings.languages.ar_en")}</option>
                <option value="ar">{t("settings.languages.ar")}</option>
                <option value="en">{t("settings.languages.en")}</option>
              </Select>
              <TextArea label={t("settings.brandVoice")} name="brandVoice" rows={3} maxLength={500} defaultValue={school?.brand_voice ?? ""} placeholder={t("settings.brandVoiceHint")} hint={t("settings.moreOnBrand")} />
              <Field label={t("settings.hashtags")} name="hashtags" maxLength={300} defaultValue={school?.hashtags ?? ""} placeholder="#MySchool #ProudOfOurStudents" />
              <Button>{t("common.save")}</Button>
            </form>
          </Card>
          <Card title={t("settings.terms")}>
            <form action={saveTermDates} className="space-y-2">
              {hidden}
              <p className="text-sm text-muted">{t("settings.termsHint")}</p>
              {[...terms, { name: "", start: "", end: "" }, { name: "", start: "", end: "" }].slice(0, Math.max(3, terms.length + 1)).map((tm, i) => (
                <div key={i} className="grid grid-cols-[1fr_9rem_9rem] gap-2">
                  <input name="termName" defaultValue={tm.name} placeholder={t("settings.termName")} maxLength={40} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                  <input name="termStart" type="date" defaultValue={tm.start} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                  <input name="termEnd" type="date" defaultValue={tm.end} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                </div>
              ))}
              <Button variant="quiet">{t("common.save")}</Button>
            </form>
          </Card>
        </>
      )}

      {tab === "approvals" && (
        <Card>
          <form action={saveApprovals} className="space-y-5">
            {hidden}
            <fieldset className="space-y-2">
              <legend className="font-semibold">{t("settings.approveBy")}</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="approveBy" value="lead" defaultChecked={school?.approve_by !== "any_other"} className="mt-1" />
                <span>{t("settings.approveLead")}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="approveBy" value="any_other" defaultChecked={school?.approve_by === "any_other"} className="mt-1" />
                <span>{t("settings.approveAnyOther")}</span>
              </label>
              <Toggle name="leadSelf" defaultChecked={school?.lead_self_publish ?? true} label={t("settings.leadSelf")} hint={t("settings.leadSelfHint")} />
            </fieldset>

            <fieldset className="space-y-2 border-t border-border pt-4">
              <legend className="font-semibold">{t("settings.extra")}</legend>
              <p className="text-sm text-muted">{t("settings.extraHint")}</p>
              {(["off", "flagged", "categories", "all"] as const).map((v) => (
                <label key={v} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="extraApproval" value={v} defaultChecked={(school?.extra_approval ?? "off") === v} className="mt-1" />
                  <span>{t(`settings.extraModes.${v}`)}</span>
                </label>
              ))}
              <div className="space-y-1 pt-2">
                <span className="text-sm font-semibold">{t("settings.extraWho")}</span>
                {(people ?? []).filter((p) => p.role !== "comms_lead").map((p) => (
                  <label key={p.user_id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="extraApprover" value={p.user_id} defaultChecked={(school?.extra_approvers ?? []).includes(p.user_id)} />
                    {p.full_name} <span className="text-muted">· {t(`roles.${p.role}`)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted">{t("settings.extraWhoHint")}</p>
              </div>
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <Field label={t("settings.timeout")} name="timeoutHours" type="number" min={1} max={168} defaultValue={school?.extra_timeout_hours ?? ""} hint={t("settings.timeoutHint")} />
                <Select label={t("settings.timeoutAction")} name="timeoutAction" defaultValue={school?.extra_timeout_action ?? "hold"}>
                  <option value="hold">{t("settings.timeoutHold")}</option>
                  <option value="go">{t("settings.timeoutGo")}</option>
                </Select>
              </div>
            </fieldset>

            <fieldset className="border-t border-border pt-4">
              <Field label={t("settings.photoLimit")} name="photoLimit" type="number" min={1} max={80} defaultValue={school?.photo_limit ?? ""} hint={t("settings.photoLimitHint")} />
            </fieldset>
            <Button>{t("common.save")}</Button>
          </form>
        </Card>
      )}

      {tab === "roles" && (
        <Card title={t("settings.rolesTitle")}>
          <p className="mb-3 text-sm text-muted">{t("settings.rolesHint")}</p>
          <form action={savePermissions} className="space-y-3">
            {hidden}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="p-1.5 text-start font-semibold">{t("settings.ability")}</th>
                    {ROLES.map((r) => (
                      <th key={r} className="p-1.5 font-semibold">
                        {t(`roles.${r}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {PERMISSION_KEYS.map((p) => (
                    <tr key={p}>
                      <td className="p-1.5">{t(`permissions.${p}`)}</td>
                      {ROLES.map((r) => (
                        <td key={r} className="p-1.5 text-center">
                          {r === "admin" ? (
                            <span className="text-good">✓</span>
                          ) : (
                            <>
                              <input type="hidden" name={`${r}.${p}`} value="off" />
                              <input type="checkbox" name={`${r}.${p}`} defaultChecked={overrides[r]?.[p] ?? defaultCan(r, p)} aria-label={`${r} ${p}`} />
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{t("settings.rolesNote")}</p>
            <Button>{t("common.save")}</Button>
          </form>
        </Card>
      )}

      {tab === "library" && (
        <Card title={t("settings.selfFiling")}>
          <p className="mb-3 text-sm text-muted">{t("settings.selfFilingHint")}</p>
          <form action={setSelfFiling} className="flex items-center gap-3">
            {hidden}
            <input type="hidden" name="on" value={school?.self_filing ? "0" : "1"} />
            <span className={`text-sm font-semibold ${school?.self_filing ? "text-good" : "text-muted"}`}>{school?.self_filing ? t("settings.on") : t("settings.off")}</span>
            <Button variant={school?.self_filing ? "quiet" : "primary"}>{school?.self_filing ? t("settings.turnOff") : t("settings.turnOn")}</Button>
          </form>
        </Card>
      )}

      {tab === "setup" && (
        <Card title={t("settings.setup")}>
          <ul className="space-y-1 text-sm">
            {[
              { key: "database", ok: isAdminConfigured },
              { key: "ai", ok: isAiConfigured() },
              { key: "meta", ok: isMetaConfigured() },
            ].map((s) => (
              <li key={s.key} className={s.ok ? "text-good" : "text-danger"}>
                {s.ok ? "✓ " : "✕ "}
                {t(`settings.setupItems.${s.key}`)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
