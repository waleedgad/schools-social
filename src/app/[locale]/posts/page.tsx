import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { LocalTime } from "@/components/local-datetime";
import { Card } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { thumbPath } from "@/lib/images";
import { STATUS_STYLE } from "@/lib/post-status";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  status: string;
  caption_ar: string | null;
  caption_en: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  sensitive: boolean;
  updated_at: string;
  post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[];
};

const TABS = {
  todo: ["draft", "in_review", "rejected", "failed"],
  ready: ["approved", "scheduled", "publishing"],
  done: ["published"],
} as const;
type Tab = keyof typeof TABS;


export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "writePosts")) redirect({ href: "/dashboard", locale });

  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "ready" || rawTab === "done" ? rawTab : "todo";
  const t = await getTranslations();
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from("posts")
    .select("id, status, caption_ar, caption_en, scheduled_at, published_at, sensitive, updated_at, post_photos(position, photo:photos(storage_path, edited_path))")
    .eq("school_id", membership.school.id)
    .in("status", [...TABS[tab]])
    .order(tab === "done" ? "published_at" : tab === "ready" ? "scheduled_at" : "updated_at", { ascending: tab === "ready", nullsFirst: false })
    .limit(100)
    .returns<Row[]>();

  const cover = (p: Row) => {
    const first = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return first ? thumbPath(first.edited_path ?? first.storage_path) : null;
  };
  const covers = (posts ?? []).map(cover).filter(Boolean) as string[];
  const { data: signed } = covers.length
    ? await supabase.storage.from("photos").createSignedUrls(covers, 60 * 60)
    : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("posts.title")}</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/calendar" className="text-accent hover:underline">
              {t("dashboard.sections.calendar")}
            </Link>
            <Link href="/dashboard" className="text-accent hover:underline">
              {t("staff.back")}
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted">{t("posts.howTo")}</p>
        <nav className="flex gap-2">
          {(Object.keys(TABS) as Tab[]).map((k) => (
            <Link
              key={k}
              href={{ pathname: "/posts", query: { tab: k } }}
              className={`rounded-full border px-3 py-1 text-sm ${k === tab ? "border-accent font-semibold" : "border-border"}`}
            >
              {t(`posts.tabs.${k}`)}
            </Link>
          ))}
        </nav>
        {!posts?.length && <p className="text-muted">{t("posts.empty")}</p>}
        <ul className="space-y-3">
          {(posts ?? []).map((p) => {
            const c = cover(p);
            return (
              <li key={p.id}>
                <Link href={`/posts/${p.id}`}>
                  <Card className="flex items-center gap-4 p-3 transition hover:border-accent">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                    {c ? <img src={url.get(c)} alt="" className="size-16 shrink-0 rounded-lg object-cover" /> : <div className="size-16 shrink-0 rounded-lg bg-background" />}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm">{p.caption_ar || p.caption_en || t("posts.noCaption")}</p>
                      <p className="text-xs text-muted">
                        {t("posts.photoCount", { count: p.post_photos.length })}
                        {p.scheduled_at && p.status !== "published" && (
                          <>
                            {" · "}
                            <LocalTime iso={p.scheduled_at} />
                          </>
                        )}
                        {p.published_at && (
                          <>
                            {" · "}
                            <LocalTime iso={p.published_at} />
                          </>
                        )}
                        {p.sensitive && ` · ${t("posts.sensitiveShort")}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}>
                      {t(`posts.status.${p.status}`)}
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </PageBody>
    </>
  );
}
