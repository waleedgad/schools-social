import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/actions/auth";
import { can, type Permission } from "@/lib/roles";
import type { Membership, Workspace } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Icon, type IconName } from "./icons";
import { LanguageSwitcher } from "./language-switcher";
import { CommandPalette, MobileNavToggle, Shortcuts, ThemeToggle, WorkspaceSwitcher } from "./shell-client";

export type NavKey =
  | "today" | "posts" | "calendar" | "analytics" | "library" | "upload" | "students"
  | "categories" | "accounts" | "people" | "settings" | "activity" | "help" | "inbox";

type Item = { key: NavKey; href: string; icon: IconName; permission: Permission; section: "main" | "posting" | "photos" | "school" };

const ITEMS: Item[] = [
  { key: "today", href: "/today", icon: "today", permission: "upload", section: "main" },
  { key: "posts", href: "/posts", icon: "board", permission: "viewPosts", section: "posting" },
  { key: "calendar", href: "/calendar", icon: "calendar", permission: "viewPosts", section: "posting" },
  { key: "inbox", href: "/inbox", icon: "inbox", permission: "writePosts", section: "posting" },
  { key: "analytics", href: "/analytics", icon: "analytics", permission: "viewAnalytics", section: "posting" },
  { key: "library", href: "/library", icon: "library", permission: "viewLibrary", section: "photos" },
  { key: "upload", href: "/upload", icon: "upload", permission: "upload", section: "photos" },
  { key: "students", href: "/students", icon: "students", permission: "manageConsent", section: "photos" },
  { key: "categories", href: "/categories", icon: "categories", permission: "manageCategories", section: "school" },
  { key: "accounts", href: "/accounts", icon: "accounts", permission: "pauseAccounts", section: "school" },
  { key: "people", href: "/staff", icon: "people", permission: "manageStaff", section: "school" },
  { key: "settings", href: "/settings", icon: "settings", permission: "manageSettings", section: "school" },
  { key: "activity", href: "/activity", icon: "activity", permission: "viewActivity", section: "school" },
];

async function counts(schoolId: string, membership: Membership) {
  const supabase = await createClient();
  const out: Partial<Record<NavKey, number>> = {};
  const p = membership.school.permissions;
  if (can(membership.role, "approvePosts", p) || can(membership.role, "extraApprove", p)) {
    const statuses = [
      ...(can(membership.role, "approvePosts", p) ? ["in_review"] : []),
      ...(can(membership.role, "extraApprove", p) ? ["waiting_extra"] : []),
    ];
    const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("school_id", schoolId).in("status", statuses);
    if (count) out.posts = count;
  }
  if (can(membership.role, "viewLibrary", p)) {
    const { count } = await supabase.from("photos").select("id", { count: "exact", head: true }).eq("school_id", schoolId).eq("check_status", "waiting");
    if (count) out.library = count;
  }
  return out;
}

export async function AppShell({
  locale,
  membership,
  workspaces = [],
  active,
  title,
  subtitle,
  actions,
  children,
  flush = false,
}: {
  locale: string;
  membership: Membership;
  workspaces?: Workspace[];
  active: NavKey;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  const t = await getTranslations();
  const p = membership.school.permissions;
  const visible = ITEMS.filter((i) => can(membership.role, i.permission, p));
  const badge = await counts(membership.school.id, membership).catch(() => ({}) as Partial<Record<NavKey, number>>);
  const initials = membership.school.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sections = ["main", "posting", "photos", "school"] as const;
  const canPost = can(membership.role, "writePosts", p);

  const commands = [
    ...visible.map((i) => ({ label: t(`nav.${i.key}`), href: i.href, group: t("nav.goTo") })),
    ...(canPost
      ? [
          { label: t("shell.newPost"), href: "/posts/new", group: t("shell.actions") },
          { label: t("shell.newIdea"), href: "/posts?new=idea", group: t("shell.actions") },
          { label: t("shell.makeWeek"), href: "/posts", group: t("shell.actions") },
        ]
      : []),
    { label: t("nav.help"), href: "/help", group: t("nav.goTo") },
  ];

  return (
    <div className="flex min-h-dvh">
      <aside
        id="side"
        className="fixed inset-y-0 z-40 hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-e border-border bg-surface/95 px-2.5 pb-3 pt-4 backdrop-blur-xl data-[open=true]:flex md:sticky md:top-0 md:flex md:h-dvh"
      >
        <div className="flex items-center gap-2.5 px-1.5 pb-3">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">{initials}</span>
          <div className="min-w-0 leading-tight">
            <b className="block truncate text-sm">{membership.school.name}</b>
            <span className="text-xs text-muted">{t(`roles.${membership.role}`)}</span>
          </div>
        </div>
        {workspaces.length > 1 && <WorkspaceSwitcher current={membership.school.id} workspaces={workspaces} label={t("shell.switchSchool")} />}
        <CommandPalette commands={commands} placeholder={t("shell.searchPlaceholder")} label={t("shell.search")} />
        {sections.map((s) => {
          const items = visible.filter((i) => i.section === s);
          if (!items.length) return null;
          return (
            <nav key={s} className="flex flex-col gap-0.5">
              {s !== "main" && <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-faint">{t(`nav.sections.${s}`)}</div>}
              {items.map((i) => (
                <Link
                  key={i.key}
                  href={i.href}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition ${
                    active === i.key ? "bg-accent-bg font-semibold text-accent-ink" : "hover:bg-background"
                  }`}
                >
                  <Icon name={i.icon} className={active === i.key ? "text-accent-ink" : "text-faint"} />
                  <span className="grow">{t(`nav.${i.key}`)}</span>
                  {badge[i.key] ? (
                    <span className="rounded-full bg-warn-bg px-1.5 text-[11px] font-semibold text-warn">{badge[i.key]}</span>
                  ) : null}
                </Link>
              ))}
            </nav>
          );
        })}
        <div className="mt-auto flex flex-col gap-0.5 pt-4">
          <Link href="/help" className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-background ${active === "help" ? "bg-accent-bg text-accent-ink" : ""}`}>
            <Icon name="help" className="text-faint" />
            {t("nav.help")}
          </Link>
          <div className="flex items-center gap-1 px-1 pt-2">
            <ThemeToggle labels={{ light: t("shell.light"), dark: t("shell.dark"), auto: t("shell.auto") }} />
            <LanguageSwitcher />
            <form action={signOut} className="ms-auto">
              <input type="hidden" name="locale" value={locale} />
              <button className="rounded-md px-2 py-1 text-xs text-muted hover:bg-background">{t("common.signOut")}</button>
            </form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 grow flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-surface/85 px-4 py-2 backdrop-blur-xl md:px-6">
          <MobileNavToggle label={t("shell.menu")} />
          <div className="min-w-0 grow leading-tight">
            <h1 className="truncate text-base font-bold md:text-lg">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            {canPost && (
              <Link
                href="/posts/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground shadow-sm hover:opacity-90"
                title={`${t("shell.newPost")} (N)`}
              >
                <Icon name="plus" />
                <span className="hidden sm:inline">{t("shell.createPost")}</span>
              </Link>
            )}
          </div>
        </header>
        <main className={`fade-in grow ${flush ? "" : "mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6"}`}>{children}</main>
      </div>
      <Shortcuts
        canPost={canPost}
        title={t("shortcuts.title")}
        items={[
          ["⌘ K", t("shortcuts.search")],
          ["N", t("shortcuts.newPost")],
          ["G T", t("shortcuts.goToday")],
          ["G P", t("shortcuts.goPosts")],
          ["G C", t("shortcuts.goCalendar")],
          ["G L", t("shortcuts.goLibrary")],
          ["G A", t("shortcuts.goAnalytics")],
          ["A", t("shortcuts.approve")],
          ["⌘ S", t("shortcuts.save")],
          ["?", t("shortcuts.help")],
        ]}
      />
    </div>
  );
}
