import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { seesPlan, type PlanStatus } from "@/lib/plan";
import { Icon } from "./icons";
import { SignOutButton } from "./sign-out-button";

// The bar at the top of every page: "ending soon" (Admin and Comms lead
// only, 14 days before "paid until") and "read-only" (everyone).
export async function PlanBar({ status, role }: { status: PlanStatus | null; role: string }) {
  if (!status) return null;
  const t = await getTranslations("plan");
  if (status.state === "read_only") {
    return (
      <div role="status" data-testid="plan-bar" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger-bg px-4 py-2 text-center text-sm font-semibold text-danger print:hidden">
        <span>{status.forced ? t("bar.readOnlyForced") : t("bar.readOnly", { days: status.read_only_left })}</span>
        {seesPlan(role) && (
          <Link href="/plan" className="underline">
            {t("bar.seePlan")}
          </Link>
        )}
      </div>
    );
  }
  if (status.state === "active" && !status.forced && status.days_left <= 14 && status.days_left >= 0 && seesPlan(role)) {
    return (
      <div role="status" data-testid="plan-bar" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warn-bg px-4 py-2 text-center text-sm font-semibold text-warn print:hidden">
        <span>{status.trial ? t("bar.trialEnding", { days: status.days_left }) : t("bar.endingSoon", { days: status.days_left, date: status.paid_until })}</span>
        <Link href="/plan" className="underline">
          {t("bar.seePlan")}
        </Link>
      </div>
    );
  }
  return null;
}

// Blocked school: one page with the renew contact. Sign out is the only button.
export async function BlockedScreen({ status, schoolName, locale }: { status: PlanStatus; schoolName: string; locale: string }) {
  const t = await getTranslations();
  return (
    <main data-testid="blocked" className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 card p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-danger-bg text-danger">
          <Icon name="warning" />
        </span>
        <h1 className="text-xl font-bold">{t("plan.blocked.title")}</h1>
        <p className="text-sm text-muted">{t("plan.blocked.body", { school: schoolName })}</p>
        {status.contact ? (
          <p className="whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold" dir="auto">
            {status.contact}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("plan.blocked.noContact")}</p>
        )}
        <p className="text-xs text-muted">{t("plan.blocked.safe")}</p>
        <SignOutButton locale={locale} label={t("common.signOut")} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-background" />
      </div>
    </main>
  );
}
