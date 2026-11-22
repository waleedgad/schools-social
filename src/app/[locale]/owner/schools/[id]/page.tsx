import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { OwnerShell } from "@/components/owner-shell";
import { Button, Card, Chip, Field, Notice, Select, TextArea } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import {
  ownerForceState,
  ownerInviteAdmin,
  ownerRecordPayment,
  ownerRemoveComputer,
  ownerSaveNotes,
  ownerSetPaidUntil,
  ownerSetPlan,
} from "@/lib/actions/owner";
import { appOrigin } from "@/lib/origin";
import { requireOwner, type Plan } from "@/lib/owner";
import type { PlanStatus } from "@/lib/plan";

type School = { id: string; name: string; plan_id: string; extra_managers: number; extra_computers: number; plan_managers: number; plan_computers: number; paid_until: string; trial: boolean; forced_state: string | null; forced_reason: string | null; created_at: string };
type Person = { user_id: string; full_name: string; role: string; active: boolean; email: string | null; last_seen_at: string | null };
type Computer = { id: string; name: string | null; platform: string | null; last_seen_at: string };
type Payment = { id: string; amount: number; currency: string; paid_on: string; method: string; covers_until: string; note: string | null };
type LogRow = { id: number; action: string; reason: string | null; at: string };

const MANAGING = ["admin", "comms_lead", "comms"];

// School details: plan and extras, payments, a forced state with a reason,
// its managing users and computers, private notes, and its owner log.
export default async function OwnerSchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; invite?: string; created?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase } = await requireOwner(locale);
  const t = await getTranslations();
  const format = await getFormatter();
  const sp = await searchParams;

  const [{ data: school }, { data: status }, { data: people }, { data: computers }, { data: payments }, { data: notes }, { data: log }, { data: plans }, { data: settings }, { data: invites }] =
    await Promise.all([
      supabase.from("schools").select("id, name, plan_id, extra_managers, extra_computers, plan_managers, plan_computers, paid_until, trial, forced_state, forced_reason, created_at").eq("id", id).maybeSingle<School>(),
      supabase.rpc("school_status", { p_school: id }),
      supabase.rpc("owner_school_people", { p_school: id }),
      supabase.from("computers").select("id, name, platform, last_seen_at").eq("school_id", id).order("last_seen_at", { ascending: false }),
      supabase.from("payments").select("id, amount, currency, paid_on, method, covers_until, note").eq("school_id", id).order("paid_on", { ascending: false }).limit(50),
      supabase.from("owner_notes").select("notes").eq("school_id", id).maybeSingle(),
      supabase.from("owner_log").select("id, action, reason, at").eq("school_id", id).order("at", { ascending: false }).limit(30),
      supabase.from("plans").select("id, name_en, name_ar, manager_limit, computer_limit, price_year, active, sort").order("sort"),
      supabase.from("owner_settings").select("currency").maybeSingle(),
      supabase.from("invites").select("token, email, expires_at, accepted_at").eq("school_id", id).eq("role", "admin").is("accepted_at", null).order("created_at", { ascending: false }).limit(1),
    ]);
  if (!school) notFound();
  const st = status as PlanStatus | null;
  const origin = await appOrigin();
  const currency = (settings?.currency as string | undefined) ?? "EGP";
  const date = (d: string) => format.dateTime(new Date(`${d}T12:00:00`), { dateStyle: "medium" });
  const tone = { active: "good", read_only: "warn", blocked: "danger" } as const;
  const inviteToken = sp.invite ?? (invites?.[0]?.token as string | undefined);
  const inviteLink = inviteToken ? `${origin}/${locale}/invite/${inviteToken}` : null;
  const managing = ((people ?? []) as Person[]).filter((p) => MANAGING.includes(p.role) && p.active);
  const others = ((people ?? []) as Person[]).filter((p) => !(MANAGING.includes(p.role) && p.active));
  const nextYear = (() => {
    const base = new Date(`${school.paid_until}T12:00:00Z`);
    const from = base > new Date() ? base : new Date();
    return new Date(from.getTime() + 365 * 86400_000).toISOString().slice(0, 10);
  })();

  return (
    <OwnerShell locale={locale} active="schools" title={school.name}>
      <p className="text-sm">
        <Link href="/owner" className="text-accent-ink hover:underline">
          {t("owner.school.back")}
        </Link>
      </p>
      {sp.saved && <Notice tone="good">{t("owner.school.saved")}</Notice>}
      {sp.error && <Notice>{t.has(`owner.school.errors.${sp.error}`) ? t(`owner.school.errors.${sp.error}`) : t("owner.school.errors.save")}</Notice>}
      {sp.created && <Notice tone="good">{t("owner.school.created")}</Notice>}

      {st && (
        <div className="flex flex-wrap items-center gap-3 card p-4" data-testid="owner-school-state">
          <Chip tone={tone[st.state]}>{t(`plan.states.${st.state}`)}</Chip>
          {st.forced && <Chip tone="violet">{t("owner.school.forced")}</Chip>}
          <span className="text-sm">{t("owner.school.paidUntil", { date: date(st.paid_until) })}</span>
          <span className="text-sm text-muted">{t("owner.school.managersUsed", { used: st.managers, limit: st.manager_limit })}</span>
          <span className="text-sm text-muted">{t("owner.school.computersUsed", { used: st.computers, limit: st.computer_limit })}</span>
          {school.trial && <Chip>{t("owner.trial")}</Chip>}
          {school.forced_reason && <span className="text-xs text-muted">“{school.forced_reason}”</span>}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Card title={t("owner.school.planTitle")}>
          <form action={ownerSetPlan} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <Select label={t("owner.school.plan")} name="plan" defaultValue={school.plan_id}>
              {((plans ?? []) as Plan[]).map((p) => (
                <option key={p.id} value={p.id}>
                  {t("owner.planOption", { name: locale === "ar" ? p.name_ar : p.name_en, managers: p.manager_limit, computers: p.computer_limit })}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("owner.school.extraManagers")} name="extraManagers" type="number" min={0} max={500} defaultValue={school.extra_managers} />
              <Field label={t("owner.school.extraComputers")} name="extraComputers" type="number" min={0} max={50} defaultValue={school.extra_computers} />
            </div>
            <Field label={t("owner.reason")} name="reason" maxLength={300} />
            <p className="text-xs text-muted">{t("owner.school.planHint")}</p>
            <Button>{t("owner.school.savePlan")}</Button>
          </form>
        </Card>

        <Card title={t("owner.school.paymentTitle")}>
          <form action={ownerRecordPayment} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label={t("owner.school.amount")} name="amount" inputMode="decimal" required />
              </div>
              <Field label={t("owner.school.currency")} name="currency" defaultValue={currency} maxLength={3} dir="ltr" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("owner.school.paidOn")} name="paidOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              <Field label={t("owner.school.coversUntil")} name="coversUntil" type="date" defaultValue={nextYear} required />
            </div>
            <Select label={t("owner.school.method")} name="method" defaultValue="transfer">
              {["transfer", "cash", "cheque", "card", "other"].map((m) => (
                <option key={m} value={m}>
                  {t(`owner.methods.${m}`)}
                </option>
              ))}
            </Select>
            <Field label={t("owner.school.note")} name="note" maxLength={300} />
            <Button>{t("owner.school.record")}</Button>
          </form>
        </Card>

        <Card title={t("owner.school.stateTitle")}>
          <form action={ownerForceState} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <Select label={t("owner.school.state")} name="state" defaultValue={school.forced_state ?? ""}>
              <option value="">{t("owner.school.fromDates")}</option>
              <option value="active">{t("plan.states.active")}</option>
              <option value="read_only">{t("plan.states.read_only")}</option>
              <option value="blocked">{t("plan.states.blocked")}</option>
            </Select>
            <Field label={t("owner.reasonNeeded")} name="reason" maxLength={300} required />
            <Button variant="quiet">{t("owner.school.setState")}</Button>
          </form>
          <form action={ownerSetPaidUntil} className="mt-5 space-y-3 border-t border-border pt-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <Field label={t("owner.school.paidUntilByHand")} name="paidUntil" type="date" defaultValue={school.paid_until} required />
            <Field label={t("owner.reasonNeeded")} name="reason" maxLength={300} required />
            <Button variant="quiet">{t("owner.school.saveDate")}</Button>
          </form>
        </Card>

        <Card title={t("owner.school.adminTitle")}>
          {inviteLink ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">{t("owner.school.inviteHint")}</p>
              <p className="break-all rounded-lg bg-surface-2 px-3 py-2 text-xs" dir="ltr" data-testid="admin-invite-link">
                {inviteLink}
              </p>
              <CopyButton value={inviteLink} label={t("staff.copy")} copiedLabel={t("staff.copied")} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t("owner.school.noInvite")}</p>
          )}
          <form action={ownerInviteAdmin} className="mt-4 flex items-end gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <div className="grow">
              <Field label={t("owner.school.newInvite")} name="email" type="email" dir="ltr" required />
            </div>
            <Button variant="quiet">{t("owner.school.invite")}</Button>
          </form>
        </Card>

        <Card title={t("owner.school.peopleTitle", { count: managing.length })}>
          <ul className="space-y-1.5 text-sm">
            {managing.map((p) => (
              <li key={p.user_id} className="flex flex-wrap justify-between gap-2">
                <span>
                  <b>{p.full_name}</b> <span className="text-muted">· {t(`roles.${p.role}`)}</span>
                </span>
                <span className="text-xs text-muted" dir="ltr">
                  {p.email}
                </span>
              </li>
            ))}
          </ul>
          {others.length > 0 && <p className="mt-3 text-xs text-muted">{t("owner.school.freePeople", { count: others.length })}</p>}
        </Card>

        <Card title={t("owner.school.computersTitle", { count: (computers ?? []).length })}>
          {!(computers ?? []).length && <p className="text-sm text-muted">{t("owner.school.noComputers")}</p>}
          <ul className="space-y-3 text-sm">
            {((computers ?? []) as Computer[]).map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <b>{c.name ?? c.platform ?? "?"}</b>
                  <span className="text-xs text-muted">{t("owner.school.lastSeen", { when: format.relativeTime(new Date(c.last_seen_at)) })}</span>
                </div>
                <form action={ownerRemoveComputer} className="flex items-end gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="school" value={school.id} />
                  <input type="hidden" name="computer" value={c.id} />
                  <input name="reason" placeholder={t("owner.reason")} aria-label={t("owner.reason")} maxLength={300} className="w-full rounded-control border border-border bg-surface-2 px-2 py-1 text-xs" />
                  <Button variant="danger" className="shrink-0 py-1 text-xs">
                    {t("owner.school.removeComputer")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("owner.school.notesTitle")}>
          <form action={ownerSaveNotes} className="space-y-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="school" value={school.id} />
            <TextArea label={t("owner.school.notes")} name="notes" rows={5} maxLength={4000} defaultValue={(notes?.notes as string | undefined) ?? ""} hint={t("owner.school.notesHint")} />
            <Button variant="quiet">{t("owner.school.saveNotes")}</Button>
          </form>
        </Card>

        <Card title={t("owner.school.paymentsTitle")}>
          {!(payments ?? []).length ? (
            <p className="text-sm text-muted">{t("owner.school.noPayments")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {((payments ?? []) as Payment[]).map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    <b>{format.number(Number(p.amount), { style: "currency", currency: p.currency, maximumFractionDigits: 2 })}</b> · {date(p.paid_on)} · {t(`owner.methods.${p.method}`)}
                  </span>
                  <span className="text-xs text-muted">{t("owner.school.covers", { date: date(p.covers_until) })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("owner.school.logTitle")} className="md:col-span-2">
          <ul className="space-y-1 text-sm">
            {((log ?? []) as LogRow[]).map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted">{format.dateTime(new Date(l.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                <b>{t.has(`owner.log.actions.${l.action.replace(/\./g, "_")}`) ? t(`owner.log.actions.${l.action.replace(/\./g, "_")}`) : l.action}</b>
                {l.reason && <span className="text-muted">“{l.reason}”</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </OwnerShell>
  );
}
