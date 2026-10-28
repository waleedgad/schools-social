import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { PhotoUploader } from "@/components/photo-uploader";
import { Card } from "@/components/ui";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export default async function UploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const { event } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();

  const [{ data: events }, { count }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, event_date")
      .eq("school_id", membership.school.id)
      .order("event_date", { ascending: false })
      .limit(50),
    supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("school_id", membership.school.id)
      .eq("uploaded_by", user.id),
  ]);

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="upload" title={t("upload.title")}>
        <Card>
          <PhotoUploader schoolId={membership.school.id} userId={user.id} events={events ?? []} defaultEventId={event} />
        </Card>
        <p className="text-center text-sm text-muted">{t("upload.yourCount", { count: count ?? 0 })}</p>
    </AppShell>
  );
}
