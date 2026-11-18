import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { SignOutButton } from "./sign-out-button";

type Tab = "schools" | "new" | "plans" | "log";
const TABS: { key: Tab; href: string }[] = [
  { key: "schools", href: "/owner" },
  { key: "new", href: "/owner/new" },
  { key: "plans", href: "/owner/plans" },
  { key: "log", href: "/owner/log" },
];

// The owner's own pages: a plain frame, not a school's menu (the owner may
// belong to no school at all).
export async function OwnerShell({ locale, active, title, children }: { locale: string; active: Tab; title: string; children: ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <b className="text-sm">{t("owner.brand")}</b>
          <nav className="flex grow flex-wrap gap-1" aria-label={t("owner.brand")}>
            {TABS.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={active === tab.key ? "page" : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-sm ${active === tab.key ? "bg-accent-bg font-semibold text-accent-ink" : "hover:bg-background"}`}
              >
                {t(`owner.tabs.${tab.key}`)}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher />
          <SignOutButton locale={locale} label={t("common.signOut")} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-background" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
