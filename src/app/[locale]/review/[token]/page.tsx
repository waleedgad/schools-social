import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Notice } from "@/components/ui";
import { answerReview } from "@/lib/actions/posts";
import { thumbPath } from "@/lib/images";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Info = { school_name: string; label: string; caption_ar: string | null; caption_en: string | null; status: string; usable: boolean; photo_paths: string[] };

// Approve a post from a link, without an account (for example the owner or
// a parent council member). The answer goes to the post's comments.
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ answered?: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const { answered } = await searchParams;
  const t = await getTranslations("review");
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_review_link", { p_token: token });
  const info = (data as Info[] | null)?.[0];

  // Photos are private, so the server signs short links for this page.
  let urls: string[] = [];
  if (info?.photo_paths?.length && isAdminConfigured) {
    const { data: signed } = await createAdminClient().storage.from("photos").createSignedUrls(info.photo_paths.map(thumbPath), 3600);
    urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];
  }

  return (
    <>
      <AppHeader locale={locale} signedIn={false} />
      <PageBody narrow>
        {answered && <Notice tone={answered === "error" ? "danger" : "good"}>{t(`answered.${answered}`)}</Notice>}
        {!info ? (
          <Notice>{t("invalid")}</Notice>
        ) : (
          <Card className="space-y-4">
            <div>
              <h1 className="text-xl font-bold">{t("title", { school: info.school_name })}</h1>
              <p className="text-sm text-muted">{t("for", { label: info.label })}</p>
            </div>
            {urls.length > 0 && (
              <div className="flex snap-x gap-2 overflow-x-auto">
                {urls.map((u) => (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                  <img key={u} src={u} alt="" className="aspect-[4/5] w-48 shrink-0 snap-start rounded-lg object-cover" />
                ))}
              </div>
            )}
            {info.caption_ar && <p className="whitespace-pre-wrap" dir="rtl">{info.caption_ar}</p>}
            {info.caption_en && <p className="whitespace-pre-wrap" dir="ltr">{info.caption_en}</p>}
            {info.usable && !answered ? (
              <form action={answerReview} className="space-y-3 border-t border-border pt-4">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="token" value={token} />
                <textarea name="comment" rows={3} maxLength={1000} placeholder={t("comment")} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <Button name="answer" value="changes" variant="quiet">{t("changes")}</Button>
                  <Button name="answer" value="approved" variant="good" icon="check">{t("approve")}</Button>
                </div>
              </form>
            ) : (
              !answered && <Notice tone="info">{t("used")}</Notice>
            )}
          </Card>
        )}
      </PageBody>
    </>
  );
}
