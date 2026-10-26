import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { LocalDateTime, LocalTime } from "@/components/local-datetime";
import { Button, Card, Notice } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { movePostPhoto, postAction, removePostPhoto, writeCaptions } from "@/lib/actions/posts";
import { loadPost } from "@/lib/posts";
import { thumbPath } from "@/lib/images";
import { STATUS_STYLE } from "@/lib/post-status";
import { checkPost } from "@/lib/privacy";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const textarea = "w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; ai?: string; saved?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts")) redirect({ href: "/dashboard", locale });

  const { error, ai, saved } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const loaded = await loadPost(supabase, id);
  if (!loaded) redirect({ href: "/posts", locale });
  const { post, photos } = loaded!;

  const checks = await checkPost(supabase, post, photos, post.event?.class_name ?? null);
  const blocked = checks.some((c) => c.level === "block");
  const { data: meta } = await supabase.rpc("meta_status", { p_school: membership.school.id });
  const connected = !!(meta as { page_id: string | null }[] | null)?.[0]?.page_id;

  const paths = photos.map((p) => thumbPath(p.edited_path ?? p.storage_path));
  const { data: signed } = paths.length ? await supabase.storage.from("photos").createSignedUrls(paths, 3600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));

  const status: string = post.status;
  const locked = status === "publishing" || status === "published";
  const approver = can(membership.role, "approvePosts");
  const needsSignoff = post.sensitive && !can(membership.role, "signOffSensitive");
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={post.id} />
    </>
  );

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody wide>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{t("posts.editTitle")}</h1>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{t(`posts.status.${status}`)}</span>
          </div>
          <Link href="/posts" className="text-sm text-accent hover:underline">
            {t("posts.back")}
          </Link>
        </div>

        {post.event && (
          <p className="text-sm text-muted">
            {post.event.title} · {post.event.event_date}
            {post.event.class_name ? ` · ${post.event.class_name}` : ""}
          </p>
        )}
        {error && <Notice>{t(`posts.errors.${error}`)}</Notice>}
        {saved && <Notice tone="info">{t("posts.saved")}</Notice>}
        {ai === "done" && <Notice tone="info">{t("posts.aiDone")}</Notice>}
        {ai === "demo" && <Notice tone="info">{t("posts.aiDemo")}</Notice>}
        {ai === "limit" && <Notice>{t("library.aiLimit", { count: 0 })}</Notice>}
        {ai === "error" && <Notice>{t("library.aiError")}</Notice>}
        {status === "rejected" && post.review_note && <Notice>{t("posts.changesAsked", { note: post.review_note })}</Notice>}
        {status === "failed" && post.publish_error && <Notice>{t("posts.failedBecause", { error: post.publish_error })}</Notice>}
        {status === "published" && (
          <Notice tone="info">
            {t("posts.publishedAt")} <LocalTime iso={post.published_at} />
            {post.fb_post_id && (
              <>
                {" · "}
                <a className="text-accent hover:underline" href={`https://www.facebook.com/${post.fb_post_id}`} target="_blank" rel="noreferrer">
                  Facebook
                </a>
              </>
            )}
            {post.ig_media_id && " · Instagram ✓"}
          </Notice>
        )}

        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <section className="space-y-4">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p, i) => (
                <li key={p.id} className="overflow-hidden rounded-lg border border-border bg-surface text-xs">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                  <img src={url.get(thumbPath(p.edited_path ?? p.storage_path))} alt="" className="aspect-square w-full object-cover" />
                  {!locked && (
                    <div className="flex justify-between p-1">
                      {i > 0 ? (
                        <form action={movePostPhoto}>
                          {hidden}
                          <input type="hidden" name="photo" value={p.id} />
                          <button className="text-accent">{t("posts.moveFirst")}</button>
                        </form>
                      ) : (
                        <span className="text-muted">{t("posts.cover")}</span>
                      )}
                      <Link href={`/library/${p.id}`} className="text-accent">
                        {t("library.edit")}
                      </Link>
                      <form action={removePostPhoto}>
                        {hidden}
                        <input type="hidden" name="photo" value={p.id} />
                        <button className="text-danger">✕</button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <form id="post" action={postAction} className="space-y-4">
              {hidden}
              <label className="block space-y-1">
                <span className="text-sm font-semibold">{t("posts.captionAr")}</span>
                <textarea name="captionAr" dir="rtl" rows={5} maxLength={2200} defaultValue={post.caption_ar ?? ""} disabled={locked} className={textarea} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-semibold">{t("posts.captionEn")}</span>
                <textarea name="captionEn" dir="ltr" rows={4} maxLength={2200} defaultValue={post.caption_en ?? ""} disabled={locked} className={textarea} />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-semibold">{t("posts.hashtags")}</span>
                <input name="hashtags" maxLength={300} defaultValue={post.hashtags ?? ""} disabled={locked} className={textarea} />
              </label>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 font-semibold">{t("posts.where")}</legend>
                {["facebook", "instagram"].map((p) => (
                  <label key={p} className="flex items-center gap-2">
                    <input type="checkbox" name="platform" value={p} defaultChecked={post.platforms.includes(p)} disabled={locked} />
                    {p === "facebook" ? "Facebook" : "Instagram"}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="sensitive" defaultChecked={post.sensitive} disabled={locked} className="mt-1" />
                <span>{t("posts.sensitive")}</span>
              </label>
              <LocalDateTime name="scheduledAt" label={t("posts.when")} value={post.scheduled_at} disabled={locked} />
            </form>
            {!locked && (
              <form action={writeCaptions}>
                {hidden}
                <Button variant="quiet">{post.caption_ar || post.caption_en ? t("posts.rewrite") : t("posts.write")}</Button>
              </form>
            )}
          </section>

          <aside className="space-y-4">
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t("posts.checks")}</h2>
              {!checks.length && <p className="text-sm text-muted">{t("posts.allClear")}</p>}
              <ul className="space-y-2 text-sm">
                {checks.map((c) => (
                  <li key={c.key} className={c.level === "block" ? "text-danger" : "text-muted"}>
                    {c.level === "block" ? "⛔ " : "⚠️ "}
                    {t(`posts.check.${c.key}`, c.values ?? {})}
                  </li>
                ))}
              </ul>
            </Card>

            {!locked && (
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">{t("posts.next")}</h2>
                {!connected && <p className="text-xs text-muted">{t("posts.notConnected")}</p>}
                {needsSignoff && ["in_review", "draft", "rejected"].includes(status) && (
                  <p className="text-xs text-muted">{t("posts.needsSignoff")}</p>
                )}
                <div className="flex flex-col gap-2" role="group">
                  <Button form="post" name="intent" value="save" variant="quiet">
                    {t("common.save")}
                  </Button>
                  {["draft", "rejected"].includes(status) && (
                    <Button form="post" name="intent" value="submit" disabled={blocked}>
                      {t("posts.submit")}
                    </Button>
                  )}
                  {approver && ["draft", "in_review", "rejected"].includes(status) && !needsSignoff && (
                    <Button form="post" name="intent" value="approve" variant={status === "in_review" ? "primary" : "quiet"} disabled={blocked}>
                      {t("posts.approve")}
                    </Button>
                  )}
                  {approver && ["approved", "in_review", "failed"].includes(status) && !needsSignoff && (
                    <Button form="post" name="intent" value="schedule" variant={status === "approved" ? "primary" : "quiet"} disabled={blocked || !connected}>
                      {t("posts.schedule")}
                    </Button>
                  )}
                  {approver && ["approved", "scheduled", "failed"].includes(status) && !needsSignoff && (
                    <Button form="post" name="intent" value="publish" variant="quiet" disabled={blocked || !connected}>
                      {status === "failed" ? t("posts.retry") : t("posts.publishNow")}
                    </Button>
                  )}
                  {status === "scheduled" && (
                    <Button form="post" name="intent" value="unschedule" variant="quiet">
                      {t("posts.unschedule")}
                    </Button>
                  )}
                  {["approved", "in_review", "failed"].includes(status) && (
                    <Button form="post" name="intent" value="draft" variant="quiet">
                      {t("posts.toDraft")}
                    </Button>
                  )}
                </div>
                {approver && status === "in_review" && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <textarea form="post" name="reviewNote" rows={2} maxLength={500} placeholder={t("posts.notePlaceholder")} className={textarea} />
                    <Button form="post" name="intent" value="reject" variant="quiet" className="w-full">
                      {t("posts.reject")}
                    </Button>
                  </div>
                )}
                <div className="border-t border-border pt-3">
                  <Button form="post" name="intent" value="delete" variant="danger">
                    {t("posts.delete")}
                  </Button>
                </div>
              </Card>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
