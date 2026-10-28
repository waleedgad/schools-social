import { getTranslations, setRequestLocale } from "next-intl/server";
import { AnnouncementMaker } from "@/components/announcement-maker";
import { AppShell } from "@/components/shell";
import { redirect } from "@/i18n/navigation";
import { categoryName } from "@/lib/posting";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Announcements: a design from the school's own pack or uploaded designs,
// with the text in Arabic and English, made into a post image.
export default async function AnnouncementPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ day?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "writePosts", membership.school.permissions)) redirect({ href: "/posts", locale });
  const { day } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const { data: categories } = await supabase.from("categories").select("id, name_ar, name_en").eq("school_id", membership.school.id).order("position");
  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="posts" title={t("announce.title")} subtitle={t("announce.subtitle")}>
      <AnnouncementMaker
        locale={locale}
        schoolId={membership.school.id}
        userId={user.id}
        schoolName={membership.school.name}
        day={day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null}
        categories={(categories ?? []).map((c) => ({ id: c.id as string, name: categoryName(c as { name_ar: string; name_en: string }, locale) }))}
      />
    </AppShell>
  );
}
