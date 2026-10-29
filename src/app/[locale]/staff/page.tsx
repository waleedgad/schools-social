import { headers } from "next/headers";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { CopyButton } from "@/components/copy-button";
import { StaffImport } from "@/components/staff-import";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { changeRole, createInvite, emailInvite, removeMember, revokeInvite, setActive, setClasses } from "@/lib/actions/staff";
import { viewAs } from "@/lib/actions/workspace";
import { isEmailConfigured } from "@/lib/alerts";
import { PAID_ROLES, ROLES, type Role } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Member = { user_id: string; full_name: string; role: Role; active: boolean; last_seen_at: string | null; classes: string[] };
type Invite = { id: string; email: string | null; phone: string | null; full_name: string | null; role: Role; token: string; expires_at: string };

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; emailed?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  if (membership.role !== "admin") redirect({ href: "/today", locale });

  const { error, emailed } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, full_name, role, active, last_seen_at, classes")
      .eq("school_id", schoolId)
      .order("created_at")
      .returns<Member[]>(),
    supabase
      .from("invites")
      .select("id, email, phone, full_name, role, token, expires_at")
      .eq("school_id", schoolId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .returns<Invite[]>(),
  ]);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const roleOptions = ROLES.map((r) => (
    <option key={r} value={r}>
      {t(`roles.${r}`)}
    </option>
  ));

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="people" title={t("staff.title")}>

        <Card>
          <form action={viewAs} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="locale" value={locale} />
            <span className="font-semibold">{t("more.viewAs.title")}</span>
            <select name="role" defaultValue="teacher" className="rounded-lg border border-border bg-background px-2 py-1 text-sm">
              {ROLES.filter((r) => r !== "admin").map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </select>
            <Button variant="quiet" className="!px-3 !py-1">{t("more.viewAs.go")}</Button>
            <span className="text-xs text-muted">{t("more.viewAs.hint")}</span>
          </form>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">{t("staff.members")}</h2>
          <ul className="divide-y divide-border">
            {(members ?? []).map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className={m.active ? "" : "opacity-60"}>
                  <span className="font-semibold">{m.full_name}</span>
                  {m.user_id === user.id && <span className="text-muted"> ({t("staff.you")})</span>}
                  <span className={`ms-2 rounded-full px-1.5 text-[10px] font-semibold ${PAID_ROLES.includes(m.role) ? "bg-accent-bg text-accent-ink" : "bg-grey-bg text-muted"}`}>
                    {PAID_ROLES.includes(m.role) ? t("staff.paid") : t("staff.free")}
                  </span>
                  {!m.active && <span className="ms-2 text-xs text-warn">{t("staff.inactive")}</span>}
                  <p className="text-xs text-muted">
                    {m.last_seen_at ? t("staff.lastSeen", { date: format.relativeTime(new Date(m.last_seen_at)) }) : t("staff.neverSeen")}
                    {m.classes.length > 0 && ` · ${m.classes.join("، ")}`}
                  </p>
                  {m.role === "teacher" && m.user_id !== user.id && (
                    <form action={setClasses} className="mt-1 flex gap-1">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <input name="classes" defaultValue={m.classes.join(", ")} placeholder={t("staff.classesHint")} className="w-48 rounded border border-border bg-surface-2 px-2 py-0.5 text-xs" />
                      <button className="text-xs text-accent">{t("common.save")}</button>
                    </form>
                  )}
                </div>
                {m.user_id === user.id ? (
                  <span className="text-sm text-muted">{t(`roles.${m.role}`)}</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <form action={changeRole} className="flex items-center gap-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        aria-label={t("staff.role")}
                        className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
                      >
                        {roleOptions}
                      </select>
                      <Button variant="quiet" className="px-3 py-1">
                        {t("common.save")}
                      </Button>
                    </form>
                    <form action={setActive}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <input type="hidden" name="active" value={m.active ? "0" : "1"} />
                      <Button variant="quiet" className="px-2 py-1">
                        {m.active ? t("staff.deactivate") : t("staff.activate")}
                      </Button>
                    </form>
                    <form action={removeMember}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <Button variant="danger" className="px-2 py-1">
                        {t("staff.remove")}
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <form action={createInvite} className="space-y-4">
            <h2 className="font-semibold">{t("staff.invite")}</h2>
            <p className="text-sm text-muted">{t("staff.inviteHint")}</p>
            {error && <Notice>{t("staff.inviteError")}</Notice>}
            <input type="hidden" name="locale" value={locale} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("common.email")} name="email" type="email" dir="ltr" required />
              <Select label={t("staff.role")} name="role" defaultValue="teacher">
                {roleOptions}
              </Select>
            </div>
            <Button>{t("staff.createLink")}</Button>
          </form>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">{t("more.staffImport.title")}</h2>
          <StaffImport locale={locale} />
        </Card>

        <Card className="space-y-4">
          <h2 className="font-semibold">{t("staff.pending")}</h2>
          {emailed && <Notice tone={emailed === "1" ? "good" : "danger"}>{t(emailed === "1" ? "more.staffImport.emailed" : "more.staffImport.emailFailed")}</Notice>}
          {!invites?.length && <p className="text-sm text-muted">{t("staff.noPending")}</p>}
          <ul className="divide-y divide-border">
            {(invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  {i.full_name && <p className="font-semibold">{i.full_name}</p>}
                  <p dir="ltr" className="text-start">{i.email ?? i.phone}</p>
                  <p className="text-sm text-muted">
                    {t(`roles.${i.role}`)} ·{" "}
                    {t("staff.expires", { date: format.dateTime(new Date(i.expires_at), { dateStyle: "medium" }) })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {i.phone && (
                    <a
                      href={`https://wa.me/${i.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`${t("more.staffImport.waText", { school: membership.school.name })} ${origin}/${locale}/invite/${i.token}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-good"
                    >
                      WhatsApp
                    </a>
                  )}
                  {i.email && isEmailConfigured() && (
                    <form action={emailInvite}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="link" value={`${origin}/${locale}/invite/${i.token}`} />
                      <button className="text-sm font-semibold text-accent">{t("more.staffImport.email")}</button>
                    </form>
                  )}
                  <CopyButton
                    value={`${origin}/${locale}/invite/${i.token}`}
                    label={t("staff.copy")}
                    copiedLabel={t("staff.copied")}
                  />
                  <form action={revokeInvite}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={i.id} />
                    <Button variant="danger" className="px-2 py-1">
                      {t("staff.revoke")}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
    </AppShell>
  );
}
