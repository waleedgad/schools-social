import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { can, type Permission } from "@/lib/roles";
import { requireMembership } from "@/lib/session";

// Each section appears only for roles that may use it. Most arrive in phase 2.
const SECTIONS: { key: string; permission: Permission; href?: string }[] = [
  { key: "upload", permission: "upload" },
  { key: "library", permission: "viewLibrary" },
  { key: "posts", permission: "writePosts" },
  { key: "calendar", permission: "publish" },
  { key: "students", permission: "manageConsent" },
  { key: "staff", permission: "manageStaff", href: "/staff" },
  { key: "settings", permission: "manageSettings" },
];

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  const t = await getTranslations();

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t("dashboard.welcome", { name: membership.fullName })}</h1>
          <p className="text-muted">
            {t("dashboard.yourRole", { role: t(`roles.${membership.role}`), school: membership.school.name })}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.filter((s) => can(membership.role, s.permission)).map((s) =>
            s.href ? (
              <Link key={s.key} href={s.href}>
                <Card className="h-full transition hover:border-accent">
                  <h2 className="font-semibold">{t(`dashboard.sections.${s.key}`)}</h2>
                </Card>
              </Link>
            ) : (
              <Card key={s.key} className="h-full opacity-70">
                <h2 className="font-semibold">{t(`dashboard.sections.${s.key}`)}</h2>
                <p className="text-sm text-muted">{t("common.comingSoon")}</p>
              </Card>
            ),
          )}
        </div>
      </PageBody>
    </>
  );
}
