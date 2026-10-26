import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { acceptInvite } from "@/lib/actions/staff";
import type { Role } from "@/lib/roles";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type InviteInfo = { school_name: string; role: Role; email: string; expired: boolean; accepted: boolean };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const { error } = await searchParams;
  const t = await getTranslations();
  const { user } = await getSession();

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invite", { p_token: token });
  const invite = (data as InviteInfo[] | null)?.[0];
  const here = `/invite/${token}`;

  const problem = !invite
    ? t("invite.invalid")
    : invite.accepted
      ? t("invite.used")
      : invite.expired
        ? t("invite.expired")
        : user && user.email?.toLowerCase() !== invite.email.toLowerCase()
          ? t("invite.wrongEmail", { email: user.email ?? "" })
          : null;

  return (
    <>
      <AppHeader locale={locale} signedIn={Boolean(user)} />
      <PageBody narrow>
        <Card className="space-y-4">
          <h1 className="text-xl font-bold">{t("invite.title")}</h1>
          {invite && (
            <p>
              {t("invite.body", { school: invite.school_name, email: invite.email, role: t(`roles.${invite.role}`) })}
            </p>
          )}
          {problem && <Notice>{problem}</Notice>}
          {error && <Notice>{t("invite.error")}</Notice>}

          {invite && !problem && !user && (
            <>
              <p className="text-sm text-muted">{t("invite.signInFirst", { email: invite.email })}</p>
              <div className="flex gap-3">
                <Link
                  href={{ pathname: "/signup", query: { next: here, email: invite.email } }}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
                >
                  {t("common.signUp")}
                </Link>
                <Link
                  href={{ pathname: "/login", query: { next: here } }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                >
                  {t("common.signIn")}
                </Link>
              </div>
            </>
          )}

          {invite && !problem && user && (
            <form action={acceptInvite} className="space-y-4">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <Field label={t("common.fullName")} name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
              <Button className="w-full">{t("invite.accept")}</Button>
            </form>
          )}
        </Card>
      </PageBody>
    </>
  );
}
