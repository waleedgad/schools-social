import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { checkPhotos } from "@/lib/actions/ai";
import { createEvent, deletePhoto, setOptedOut } from "@/lib/actions/library";
import { createUploadLink, revokeUploadLink } from "@/lib/actions/portal";
import { createPost } from "@/lib/actions/posts";
import { isAiConfigured } from "@/lib/ai";
import { thumbPath } from "@/lib/images";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";

type EventRow = { id: string; title: string; event_date: string; class_name: string | null };
type PhotoRow = {
  id: string;
  storage_path: string;
  edited_path: string | null;
  note: string | null;
  contains_opted_out: boolean;
  source: string;
  ai_score: number | null;
  ai_reason: string | null;
  ai_issues: string[];
};
type LinkRow = { id: string; label: string; token: string; expires_at: string; upload_count: number };

const SOURCE_STYLE: Record<string, string> = {
  staff: "bg-background",
  photographer: "bg-accent text-accent-foreground",
  desktop: "bg-foreground text-background",
};

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string; error?: string; sort?: string; ai?: string; checked?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "viewLibrary")) redirect({ href: "/upload", locale });

  const { event, error, sort, ai, checked } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const { data: events } = await supabase
    .from("events")
    .select("id, title, event_date, class_name")
    .eq("school_id", schoolId)
    .order("event_date", { ascending: false })
    .returns<EventRow[]>();

  const selected = event ?? events?.[0]?.id ?? "none";
  const byAi = sort === "ai";
  let query = supabase
    .from("photos")
    .select("id, storage_path, edited_path, note, contains_opted_out, source, ai_score, ai_reason, ai_issues")
    .eq("school_id", schoolId);
  query = selected === "none" ? query.is("event_id", null) : query.eq("event_id", selected);
  if (byAi) query = query.order("ai_score", { ascending: false, nullsFirst: false });
  const { data: photos } = await query.order("created_at", { ascending: false }).limit(200).returns<PhotoRow[]>();

  const shown = (p: PhotoRow) => p.edited_path ?? p.storage_path;
  const paths = (photos ?? []).flatMap((p) => [thumbPath(shown(p)), shown(p)]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("photos").createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));
  const current = events?.find((e) => e.id === selected);
  const unchecked = (photos ?? []).filter((p) => p.ai_score === null).length;

  const { data: links } = current
    ? await supabase
        .from("upload_links")
        .select("id, label, token, expires_at, upload_count")
        .eq("event_id", current.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at")
        .returns<LinkRow[]>()
    : { data: [] };
  const origin = await appOrigin();

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="library" title={t("library.title")}>

        <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
          <aside className="space-y-4">
            <Card className="space-y-2 p-4">
              <h2 className="text-sm font-semibold">{t("library.events")}</h2>
              <nav className="flex flex-col">
                {(events ?? []).map((e) => (
                  <Link
                    key={e.id}
                    href={{ pathname: "/library", query: { event: e.id } }}
                    className={`rounded-lg px-2 py-1 text-sm ${e.id === selected ? "bg-background font-semibold" : ""}`}
                  >
                    {e.title}
                    <span className="block text-xs text-muted">
                      {e.event_date}
                      {e.class_name ? ` · ${e.class_name}` : ""}
                    </span>
                  </Link>
                ))}
                <Link
                  href={{ pathname: "/library", query: { event: "none" } }}
                  className={`rounded-lg px-2 py-1 text-sm ${selected === "none" ? "bg-background font-semibold" : ""}`}
                >
                  {t("upload.noEvent")}
                </Link>
              </nav>
            </Card>

            <Card className="p-4">
              <form action={createEvent} className="space-y-3">
                <h2 className="text-sm font-semibold">{t("library.newEvent")}</h2>
                {error === "event" && <Notice>{t("library.eventError")}</Notice>}
                <input type="hidden" name="locale" value={locale} />
                <Field label={t("library.eventTitle")} name="title" minLength={2} maxLength={120} required />
                <Field label={t("library.eventDate")} name="eventDate" type="date" required />
                <Field label={t("library.className")} name="className" maxLength={60} />
                <Button className="w-full">{t("library.createEvent")}</Button>
              </form>
            </Card>

            {current && (
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">{t("portal.links")}</h2>
                <p className="text-xs text-muted">{t("portal.linksHint")}</p>
                {(links ?? []).map((l) => (
                  <div key={l.id} className="space-y-1 rounded-lg border border-border p-2 text-xs">
                    <p className="font-semibold">{l.label}</p>
                    <p className="text-muted">
                      {t("portal.linkStats", { count: l.upload_count, date: l.expires_at.slice(0, 10) })}
                    </p>
                    <div className="flex items-center justify-between">
                      <CopyButton value={`${origin}/${locale}/p/${l.token}`} label={t("staff.copy")} copiedLabel={t("staff.copied")} />
                      <form action={revokeUploadLink}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="event" value={current.id} />
                        <button className="text-danger hover:underline">{t("staff.revoke")}</button>
                      </form>
                    </div>
                  </div>
                ))}
                <form action={createUploadLink} className="space-y-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="event" value={current.id} />
                  <Field label={t("portal.label")} name="label" minLength={2} maxLength={80} required />
                  <Button variant="quiet" className="w-full">
                    {t("portal.create")}
                  </Button>
                </form>
              </Card>
            )}
          </aside>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{current?.title ?? t("upload.noEvent")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={{ pathname: "/library", query: { event: selected, ...(byAi ? {} : { sort: "ai" }) } }}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  {byAi ? t("library.sortNewest") : t("library.sortAi")}
                </Link>
                {unchecked > 0 && (
                  <form action={checkPhotos}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="event" value={selected} />
                    <Button variant="quiet">{t("library.checkAi", { count: unchecked })}</Button>
                  </form>
                )}
                <Link
                  href={{ pathname: "/upload", query: current ? { event: current.id } : {} }}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
                >
                  {t("dashboard.sections.upload")}
                </Link>
              </div>
            </div>

            {ai === "done" && <Notice tone="info">{t("library.aiDone", { count: Number(checked ?? 0) })}</Notice>}
            {ai === "demo" && <Notice tone="info">{t("library.aiDemo")}</Notice>}
            {ai === "limit" && <Notice>{t("library.aiLimit", { count: Number(checked ?? 0) })}</Notice>}
            {ai === "error" && <Notice>{t("library.aiError")}</Notice>}
            {error === "post" && <Notice>{t("posts.createError")}</Notice>}
            {!isAiConfigured() && unchecked > 0 && <p className="text-xs text-muted">{t("library.aiNotSet")}</p>}

            {!photos?.length && <p className="text-muted">{t("library.empty")}</p>}

            {!!photos?.length && (
              <form id="new-post" action={createPost} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
                <input type="hidden" name="locale" value={locale} />
                {current && <input type="hidden" name="event" value={current.id} />}
                <span className="text-muted">{t("library.selectHint")}</span>
                <Button>{t("library.makePost")}</Button>
              </form>
            )}

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(photos ?? []).map((p) => (
                <li key={p.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="relative">
                    <a href={url.get(shown(p))} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                      <img src={url.get(thumbPath(shown(p)))} alt={p.note ?? ""} className="aspect-square w-full object-cover" loading="lazy" />
                    </a>
                    {!p.contains_opted_out && (
                      <label className="absolute end-2 top-2 rounded bg-surface/90 p-1">
                        <input type="checkbox" name="photo" value={p.id} form="new-post" aria-label={t("library.select")} />
                      </label>
                    )}
                    {p.contains_opted_out && (
                      <span className="absolute start-2 top-2 rounded bg-danger px-2 py-0.5 text-xs font-semibold text-white">
                        {t("library.notForPosting")}
                      </span>
                    )}
                    {p.ai_score !== null && (
                      <span
                        title={p.ai_reason ?? ""}
                        className={`absolute bottom-2 start-2 rounded px-2 py-0.5 text-xs font-semibold ${
                          p.ai_score >= 8 ? "bg-accent text-accent-foreground" : "bg-surface/90"
                        }`}
                      >
                        {p.ai_score >= 8 ? "★ " : ""}
                        {p.ai_score}/10
                      </span>
                    )}
                    <span className={`absolute bottom-2 end-2 rounded px-1.5 py-0.5 text-[10px] ${SOURCE_STYLE[p.source] ?? ""}`}>
                      {t(`library.sources.${p.source}`)}
                    </span>
                  </div>
                  <div className="space-y-2 p-2 text-xs">
                    {p.note && <p className="line-clamp-2">{p.note}</p>}
                    {p.ai_issues.length > 0 && (
                      <p className="text-danger">{p.ai_issues.map((i) => t(`library.issues.${i}`)).join("، ")}</p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/library/${p.id}`} className="text-accent hover:underline">
                        {p.edited_path ? t("library.edited") : t("library.edit")}
                      </Link>
                      <form action={setOptedOut}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="value" value={String(!p.contains_opted_out)} />
                        <button className="text-accent hover:underline">
                          {p.contains_opted_out ? t("library.unflag") : t("library.flag")}
                        </button>
                      </form>
                      <form action={deletePhoto}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="id" value={p.id} />
                        <button className="text-danger hover:underline">{t("library.delete")}</button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
    </AppShell>
  );
}
