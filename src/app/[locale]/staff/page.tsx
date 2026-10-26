import { headers } from "next/headers";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, Field, Notice, Select } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { changeRole, createInvite, removeMember, revokeInvite } from "@/lib/actions/staff";
import { ROLES, type Role } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Member = { user_id: string; full_name: string; role: Role };
type Invite = { id: string; email: string; role: Role; token: string; expires_at: string };

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership } = await requireMembership(locale);
  if (membership.role !== "admin") redirect({ href: "/dashboard", locale });

  const { error } = await searchParams;
  const t = await getTranslations();
  const format = await getFormatter();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("memberships")
      .select("user_id, full_name, role")
      .eq("school_id", schoolId)
      .order("created_at")
      .returns<Member[]>(),
    supabase
      .from("invites")
      .select("id, email, role, token, expires_at")
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
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("staff.title")}</h1>
          <Link href="/dashboard" className="text-sm text-accent hover:underline">
            {t("staff.back")}
          </Link>
        </div>

        <Card className="space-y-4">
          <h2 className="font-semibold">{t("staff.members")}</h2>
          <ul className="divide-y divide-border">
            {(members ?? []).map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  {m.full_name}
                  {m.user_id === user.id && <span className="text-muted"> ({t("staff.you")})</span>}
                </span>
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

        <Card className="space-y-4">
          <h2 className="font-semibold">{t("staff.pending")}</h2>
          {!invites?.length && <p className="text-sm text-muted">{t("staff.noPending")}</p>}
          <ul className="divide-y divide-border">
            {(invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p dir="ltr" className="text-start">{i.email}</p>
                  <p className="text-sm text-muted">
                    {t(`roles.${i.role}`)} ·{" "}
                    {t("staff.expires", { date: format.dateTime(new Date(i.expires_at), { dateStyle: "medium" }) })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
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
      </PageBody>
    </>
  );
}
