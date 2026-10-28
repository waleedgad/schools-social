import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { PhotoEditor } from "@/components/photo-editor";
import { Notice } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import type { EditSettings } from "@/lib/photo-edit";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Photo = {
  id: string;
  event_id: string | null;
  storage_path: string;
  edited_path: string | null;
  edit_settings: EditSettings | null;
  note: string | null;
  ai_score: number | null;
  ai_reason: string | null;
  ai_issues: string[];
  contains_opted_out: boolean;
};

export default async function PhotoPage({ params }: { params: Promise<{ locale: string; photoId: string }> }) {
  const { locale, photoId } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "viewLibrary")) redirect({ href: "/upload", locale });

  const t = await getTranslations();
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("photos")
    .select("id, event_id, storage_path, edited_path, edit_settings, note, ai_score, ai_reason, ai_issues, contains_opted_out")
    .eq("id", photoId)
    .maybeSingle<Photo>();
  if (!photo) redirect({ href: "/library", locale });

  const { data: signed } = await supabase.storage.from("photos").createSignedUrl(photo!.storage_path, 60 * 60);
  const back = { pathname: "/library", query: photo!.event_id ? { event: photo!.event_id } : { event: "none" } };

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="library" title={t("editor.title")} actions={<Link href={back} className="text-sm text-accent hover:underline">{t("editor.back")}</Link>}>
        {photo!.contains_opted_out && <Notice>{t("library.notForPosting")}</Notice>}
        {photo!.ai_score && (
          <Notice tone="info">
            {t("library.aiScore", { score: photo!.ai_score })} · {photo!.ai_reason}
            {photo!.ai_issues.length > 0 && ` · ${photo!.ai_issues.map((i) => t(`library.issues.${i}`)).join("، ")}`}
          </Notice>
        )}
        {signed?.signedUrl ? (
          <PhotoEditor
            locale={locale}
            photoId={photo!.id}
            schoolId={membership.school.id}
            imageUrl={signed.signedUrl}
            initial={photo!.edit_settings}
            hasEdit={!!photo!.edited_path}
          />
        ) : (
          <Notice>{t("editor.error")}</Notice>
        )}
    </AppShell>
  );
}
