import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { PhotoUploader } from "@/components/photo-uploader";
import { Card } from "@/components/ui";
import { Link } from "@/i18n/navigation";
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
  const { user, membership } = await requireMembership(locale);
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
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody narrow>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("upload.title")}</h1>
          <Link href="/dashboard" className="text-sm text-accent hover:underline">
            {t("staff.back")}
          </Link>
        </div>
        <Card>
          <PhotoUploader schoolId={membership.school.id} userId={user.id} events={events ?? []} defaultEventId={event} />
        </Card>
        <p className="text-center text-sm text-muted">{t("upload.yourCount", { count: count ?? 0 })}</p>
      </PageBody>
    </>
  );
}
