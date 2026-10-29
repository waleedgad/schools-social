import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon, type IconName } from "@/components/icons";
import { SettingsSearch } from "@/components/settings-search";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Notice, Select, TextArea, Toggle } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { saveApprovals, saveHolidays, savePermissions, saveTermDates, setSelfFiling } from "@/lib/actions/brand";
import { addCover, removeCover, saveConnections, saveStages, testAlert } from "@/lib/actions/connections";
import { removeComputer } from "@/lib/actions/team";
import { saveSettings } from "@/lib/actions/settings";
import { isAiConfigured } from "@/lib/ai";
import { isEmailConfigured } from "@/lib/alerts";
import { classListProviders } from "@/lib/class-lists";
import { isMetaConfigured } from "@/lib/meta";
import { can, defaultCan, PERMISSION_KEYS, ROLES } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const TIME_ZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Amman", "Europe/London"];
const TABS = ["school", "calendar", "approvals", "roles", "library", "computers", "connections", "setup"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = { school: "settings", calendar: "calendar", approvals: "check", roles: "people", library: "library", computers: "keyboard", connections: "link", setup: "bolt" };
// Pages of their own that sit in the same list, like System Settings.
const PAGES: { key: string; href: string; icon: IconName }[] = [
  { key: "categories", href: "/categories", icon: "categories" },
  { key: "accounts", href: "/accounts", icon: "accounts" },
  { key: "people", href: "/staff", icon: "people" },
  { key: "activity", href: "/activity", icon: "activity" },
  { key: "reports", href: "/reports", icon: "warning" },
  { key: "help", href: "/help", icon: "help" },
];

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ saved?: string; error?: string; tab?: string; tested?: string; classes?: string }> }) {
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
      .select("name, default_locale, timezone, brand_voice, hashtags, caption_languages, approve_by, lead_self_publish, extra_approval, extra_approvers, extra_timeout_hours, extra_timeout_action, photo_limit, permissions, self_filing, term_dates, holidays, no_post_days, computer_limit")
      .eq("id", schoolId)
      .single(),
    supabase.from("memberships").select("user_id, full_name, role").eq("school_id", schoolId).eq("active", true).in("role", ["admin", "principal", "comms_lead"]),
  ]);
  const terms = ((school?.term_dates ?? []) as { name: string; start: string; end: string }[]);
  const holidays = ((school?.holidays ?? []) as { name: string; start: string; end: string }[]);
  const noPost = ((school?.no_post_days ?? {}) as { weekdays?: number[]; holidays?: boolean });
  const [{ data: covers }, { data: everyone }, { data: stageRows }] = tab === "approvals"
    ? await Promise.all([
        supabase.from("approval_cover").select("id, from_user, to_user, starts_on, ends_on").eq("school_id", schoolId).gte("ends_on", new Date().toISOString().slice(0, 10)).order("starts_on"),
        supabase.from("memberships").select("user_id, full_name, role, stages").eq("school_id", schoolId).eq("active", true).order("full_name"),
        supabase.from("students").select("stage").eq("school_id", schoolId).not("stage", "is", null).limit(5000),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const stages = [...new Set((stageRows ?? []).map((r) => r.stage as string))].sort();
  const nameOf = (id: string) => (everyone ?? []).find((m) => m.user_id === id)?.full_name ?? "—";
  const [{ data: links }, { data: recentEvents }] = tab === "connections"
    ? await Promise.all([
        supabase.from("school_integrations").select("slack_webhook, teams_webhook, email_alerts, alert_kinds, whatsapp_phone_id, whatsapp_event").eq("school_id", schoolId).maybeSingle(),
        supabase.from("events").select("id, title, event_date").eq("school_id", schoolId).order("event_date", { ascending: false }).limit(40),
      ])
    : [{ data: null }, { data: [] }];
  const { data: computers } = tab === "computers" ? await supabase.from("computers").select("id, name, platform, last_seen_at, created_at").eq("school_id", schoolId).order("last_seen_at", { ascending: false }) : { data: [] };
  const weekdayName = (d: number) => new Date(Date.UTC(2026, 0, 4 + d)).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" });
  // Words each entry answers to in the search, in both languages.
  const words = (k: string) => `${t(`settings.tabs.${k}`)} ${t(`more.settings.words.${k}`)}`.toLowerCase();
  const overrides = (school?.permissions ?? {}) as Record<string, Record<string, boolean>>;
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="settings" title={t("settings.title")}>
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
      <nav className="md:sticky md:top-20 md:self-start">
        <SettingsSearch placeholder={t("more.settings.search")} empty={t("more.settings.noMatch")} />
        <ul className="flex flex-col gap-0.5">
          {TABS.map((k) => (
            <li key={k} data-set={words(k)}>
              <Link href={{ pathname: "/settings", query: { tab: k } }} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${k === tab ? "bg-accent-bg font-semibold text-accent-ink" : "hover:bg-background"}`}>
                <Icon name={TAB_ICONS[k]} className={k === tab ? "" : "text-faint"} />
                {t(`settings.tabs.${k}`)}
              </Link>
            </li>
          ))}
          <li className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-faint">{t("more.settings.morePages")}</li>
          {PAGES.map((p) => (
            <li key={p.key} data-set={`${t(`more.settings.pages.${p.key}`)} ${t(`more.settings.words.${p.key}`)}`.toLowerCase()}>
              <Link href={p.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-background">
                <Icon name={p.icon} className="text-faint" />
                <span className="grow">{t(`more.settings.pages.${p.key}`)}</span>
                <Icon name="chevron" className="text-faint rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-5">
      <h2 className="text-xl font-bold">{t(`settings.tabs.${tab}`)}</h2>
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
        </>
      )}

      {tab === "calendar" && (
        <>
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
          <Card title={t("more.settings.holidays")}>
            <form action={saveHolidays} className="space-y-3">
              {hidden}
              <p className="text-sm text-muted">{t("more.settings.holidaysHint")}</p>
              {[...holidays, ...Array.from({ length: 3 }, () => ({ name: "", start: "", end: "" }))].slice(0, holidays.length + 3).map((h, i) => (
                <div key={i} className="grid grid-cols-[1fr_9rem_9rem] gap-2">
                  <input name="holName" defaultValue={h.name} placeholder={t("more.settings.holidayName")} maxLength={80} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                  <input name="holStart" type="date" defaultValue={h.start} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                  <input name="holEnd" type="date" defaultValue={h.end} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
                </div>
              ))}
              <fieldset className="space-y-2 border-t border-border pt-3">
                <legend className="text-sm font-semibold">{t("more.settings.noPostDays")}</legend>
                <div className="flex flex-wrap gap-3">
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="noPostDay" value={d} defaultChecked={(noPost.weekdays ?? []).includes(d)} />
                      {weekdayName(d)}
                    </label>
                  ))}
                </div>
                <Toggle name="noPostHolidays" defaultChecked={noPost.holidays ?? true} label={t("more.settings.noPostHolidays")} hint={t("more.settings.noPostHint")} />
              </fieldset>
              <Button variant="quiet">{t("common.save")}</Button>
            </form>
          </Card>
        </>
      )}

      {tab === "computers" && (
        <Card title={t("more.settings.computers", { count: computers?.length ?? 0, limit: (school?.computer_limit as number | undefined) ?? 2 })}>
          <p className="mb-3 text-sm text-muted">{t("more.settings.computersHint")}</p>
          {!computers?.length ? (
            <p className="text-sm text-muted">{t("more.settings.noComputers")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {computers.map((c) => (
                <li key={c.id as string} className="flex items-center gap-3 py-2 text-sm">
                  <Icon name="keyboard" className="text-faint" />
                  <div className="grow">
                    <b>{(c.name as string) || t("more.settings.computer")}</b>
                    <span className="block text-xs text-muted">{c.platform === "darwin" ? "Mac" : c.platform === "win32" ? "Windows" : ((c.platform as string) ?? "")} · {t("more.settings.lastSeen", { when: new Date(c.last_seen_at as string).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: membership.school.timezone }) })}</span>
                  </div>
                  {membership.role === "admin" && (
                    <form action={removeComputer}>
                      {hidden}
                      <input type="hidden" name="id" value={c.id as string} />
                      <Button variant="danger" className="!py-1 text-xs">{t("more.settings.removeComputer")}</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">{t("more.settings.computersMore")}</p>
        </Card>
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

      {tab === "approvals" && (
        <Card title={t("more.cover.title")}>
          <p className="mb-3 text-sm text-muted">{t("more.cover.hint")}</p>
          {(covers ?? []).length > 0 && (
            <ul className="mb-3 divide-y divide-border">
              {(covers ?? []).map((c) => (
                <li key={c.id as string} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{t("more.cover.line", { from: nameOf(c.from_user as string), to: nameOf(c.to_user as string), start: c.starts_on as string, end: c.ends_on as string })}</span>
                  <form action={removeCover}>
                    {hidden}
                    <input type="hidden" name="id" value={c.id as string} />
                    <Button variant="danger" className="!px-2 !py-1 text-xs">{t("staff.remove")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addCover} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            {hidden}
            <Select label={t("more.cover.from")} name="from" defaultValue="">
              {(everyone ?? []).filter((m) => ["admin", "comms_lead", "principal"].includes(m.role as string)).map((m) => <option key={m.user_id as string} value={m.user_id as string}>{m.full_name as string}</option>)}
            </Select>
            <Select label={t("more.cover.to")} name="to" required defaultValue="">
              <option value="" disabled>—</option>
              {(everyone ?? []).map((m) => <option key={m.user_id as string} value={m.user_id as string}>{m.full_name as string} · {t(`roles.${m.role}`)}</option>)}
            </Select>
            <Field label={t("more.cover.starts")} name="starts" type="date" required />
            <Field label={t("more.cover.ends")} name="ends" type="date" required />
            <Button className="sm:col-span-4 sm:justify-self-start">{t("more.cover.add")}</Button>
          </form>
        </Card>
      )}
      {tab === "approvals" && stages.length > 0 && (
        <Card title={t("more.stages.title")}>
          <p className="mb-3 text-sm text-muted">{t("more.stages.hint")}</p>
          <ul className="divide-y divide-border">
            {(everyone ?? []).filter((m) => m.role === "principal").map((m) => (
              <li key={m.user_id as string} className="py-2">
                <form action={saveStages} className="flex flex-wrap items-center gap-3 text-sm">
                  {hidden}
                  <input type="hidden" name="userId" value={m.user_id as string} />
                  <b className="w-40">{m.full_name as string}</b>
                  {stages.map((st) => (
                    <label key={st} className="flex items-center gap-1"><input type="checkbox" name="stage" value={st} defaultChecked={((m.stages ?? []) as string[]).includes(st)} />{st}</label>
                  ))}
                  <Button variant="quiet" className="!px-2 !py-1 text-xs">{t("common.save")}</Button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t("more.stages.none")}</p>
        </Card>
      )}

      {tab === "connections" && (
        <>
          {sp.tested && <Notice tone="good">{t("more.connections.tested")}</Notice>}
          {sp.classes && <Notice tone={Number(sp.classes) > 0 ? "good" : "warn"}>{Number(sp.classes) > 0 ? t("more.connections.classesDone", { count: Number(sp.classes) }) : t(`more.connections.classesError.${sp.classes}`)}</Notice>}
          <Card title={t("more.connections.alerts")}>
            <form action={saveConnections} className="space-y-4">
              {hidden}
              <Toggle name="email" defaultChecked={!!links?.email_alerts} label={t("more.connections.email")} hint={isEmailConfigured() ? t("more.connections.emailHint") : t("more.connections.emailMissing")} />
              <Field label={t("more.connections.slack")} name="slack" dir="ltr" defaultValue={(links?.slack_webhook as string) ?? ""} placeholder="https://hooks.slack.com/services/…" hint={t("more.connections.slackHint")} />
              <Field label={t("more.connections.teams")} name="teams" dir="ltr" defaultValue={(links?.teams_webhook as string) ?? ""} placeholder="https://….webhook.office.com/…" hint={t("more.connections.teamsHint")} />
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="mb-1 font-semibold">{t("more.connections.which")}</legend>
                {["approval", "failed", "import", "remind", "book"].map((k) => (
                  <label key={k} className="flex items-center gap-1"><input type="checkbox" name="kind" value={k} defaultChecked={((links?.alert_kinds as string[] | undefined) ?? ["approval", "failed", "import", "comment"]).includes(k)} />{t(`more.connections.kinds.${k}`)}</label>
                ))}
              </fieldset>
              <fieldset className="space-y-3 border-t border-border pt-4">
                <legend className="font-semibold">{t("more.connections.whatsapp")}</legend>
                <p className="text-sm text-muted">{t(process.env.WHATSAPP_TOKEN ? "more.connections.whatsappHint" : "more.connections.whatsappMissing")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("more.connections.phoneId")} name="whatsappPhoneId" dir="ltr" defaultValue={(links?.whatsapp_phone_id as string) ?? ""} />
                  <Select label={t("more.connections.intoEvent")} name="whatsappEvent" defaultValue={(links?.whatsapp_event as string) ?? ""}>
                    <option value="">{t("more.connections.noEvent")}</option>
                    {(recentEvents ?? []).map((e) => <option key={e.id as string} value={e.id as string}>{e.title as string} · {e.event_date as string}</option>)}
                  </Select>
                </div>
              </fieldset>
              <div className="flex gap-2">
                <Button>{t("common.save")}</Button>
                <Button variant="quiet" formAction={testAlert}>{t("more.connections.test")}</Button>
              </div>
            </form>
          </Card>
          <Card title={t("more.connections.classLists")}>
            <p className="mb-3 text-sm text-muted">{t("more.connections.classListsHint")}</p>
            <div className="flex flex-wrap gap-2">
              {classListProviders().map((p) => (
                <a key={p.key} href={p.ready ? `/api/class-lists/start?provider=${p.key}&locale=${locale}` : undefined} aria-disabled={!p.ready} className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold ${p.ready ? "hover:bg-background" : "pointer-events-none opacity-50"}`}>
                  <Icon name="students" />
                  {t(`more.connections.from.${p.key}`)}
                </a>
              ))}
            </div>
            {!classListProviders().some((p) => p.ready) && <p className="mt-2 text-xs text-muted">{t("more.connections.classListsMissing")}</p>}
            <p className="mt-3 text-xs text-muted">
              {t("more.connections.forMac")}{" "}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
              <a href="/api/class-lists/file" className="font-semibold text-accent underline">{t("more.connections.download")}</a>
            </p>
          </Card>
        </>
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
      </div>
      </div>
    </AppShell>
  );
}
