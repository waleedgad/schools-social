import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostBoard, type BoardPost } from "@/components/post-board";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Notice, Pills } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { makeWeek } from "@/lib/actions/posts";
import { thumbPath } from "@/lib/images";
import { BOARD, categoryName } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  status: string;
  idea: string | null;
  caption_ar: string | null;
  caption_en: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  due_on: string | null;
  urgent: boolean;
  sensitive: boolean;
  category_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  updated_at: string;
  post_photos: { position: number; photo: { storage_path: string; edited_path: string | null } | null }[];
};

export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ view?: string; category?: string; mine?: string; planned?: string; ai?: string; error?: string; new?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const perms = membership.school.permissions;
  if (!can(membership.role, "viewPosts", perms)) redirect({ href: "/today", locale });
  const sp = await searchParams;
  const view = sp.view === "grid" || sp.view === "list" ? sp.view : "board";
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  let query = supabase
    .from("posts")
    .select("id, status, idea, caption_ar, caption_en, scheduled_at, published_at, due_on, urgent, sensitive, category_id, assigned_to, created_by, updated_at, post_photos(position, photo:photos(storage_path, edited_path))")
    .eq("school_id", schoolId)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.mine === "1") query = query.or(`created_by.eq.${user.id},assigned_to.eq.${user.id}`);
  // Published posts older than 30 days drop off the board (they stay in the grid and analytics).
  const [{ data: posts }, { data: categories }] = await Promise.all([
    query.returns<Row[]>(),
    supabase.from("categories").select("id, name_ar, name_en, color").eq("school_id", schoolId).order("position"),
  ]);

  const cover = (p: Row) => {
    const first = [...p.post_photos].sort((a, b) => a.position - b.position)[0]?.photo;
    return first ? thumbPath(first.edited_path ?? first.storage_path) : null;
  };
  const urls = await signedThumbs(supabase, (posts ?? []).map(cover).filter(Boolean) as string[]);
  const cats = new Map((categories ?? []).map((c) => [c.id as string, c]));
  const monthAgo = Date.now() - 30 * 86400_000;

  const items: BoardPost[] = (posts ?? [])
    .filter((p) => p.status !== "published" || Date.parse(p.published_at ?? p.updated_at) > monthAgo || view === "grid")
    .map((p) => {
      const c = p.category_id ? cats.get(p.category_id) : null;
      const cv = cover(p);
      return {
        id: p.id,
        status: p.status,
        text: p.status === "idea" ? p.idea || p.caption_ar || p.caption_en || "" : p.caption_ar || p.caption_en || p.idea || "",
        when: p.status === "published" ? p.published_at : p.scheduled_at,
        due: p.due_on,
        cover: cv ? urls.get(cv) ?? null : null,
        photos: p.post_photos.length,
        urgent: p.urgent,
        sensitive: p.sensitive,
        category: c ? { name: categoryName(c as { name_ar: string; name_en: string }, locale), color: c.color as string } : null,
        mine: p.created_by === user.id || p.assigned_to === user.id,
      };
    });

  const canWrite = can(membership.role, "writePosts", perms);
  const labels = {
    columns: Object.fromEntries(BOARD.map((b) => [b.key, t(`board.columns.${b.key}`)])),
    status: Object.fromEntries(["idea", "draft", "in_review", "waiting_extra", "rejected", "approved", "scheduled", "publishing", "published", "failed"].map((s) => [s, t(`posts.status.${s}`)])),
    noCaption: t("posts.noCaption"),
    urgent: t("board.urgent"),
    sensitive: t("posts.sensitiveShort"),
    due: t("board.due"),
    empty: t("board.emptyColumn"),
    addIdea: t("board.addIdea"),
    ideaPlaceholder: t("board.ideaPlaceholder"),
    save: t("common.save"),
    spread: t("board.spread"),
    selected: t("board.selected"),
    photos: t("board.photos"),
    gridHint: t("board.gridHint"),
    moved: t("board.moved"),
    moveFailed: t("board.moveFailed"),
  };

  const filters = [
    { label: t("board.all"), href: { pathname: "/posts", query: { view } }, on: !sp.category && sp.mine !== "1" },
    { label: t("board.mine"), href: { pathname: "/posts", query: { view, mine: "1" } }, on: sp.mine === "1" },
    ...(categories ?? []).map((c) => ({
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: c.color as string }} />
          {categoryName(c as { name_ar: string; name_en: string }, locale)}
        </span>
      ),
      href: { pathname: "/posts", query: { view, category: c.id as string } },
      on: sp.category === c.id,
    })),
  ];

  return (
    <AppShell
      locale={locale}
      membership={membership}
      workspaces={workspaces}
      active="posts"
      title={t("board.title")}
      subtitle={t("board.subtitle")}
      actions={
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {(["board", "list", "grid"] as const).map((v) => (
            <ButtonLink key={v} href={{ pathname: "/posts", query: { ...(sp.category ? { category: sp.category } : {}), view: v } }} variant={view === v ? "primary" : "ghost"} icon={v === "board" ? "board" : v === "list" ? "list" : "grid"} className="!px-2.5 !py-1.5">
              <span className="hidden lg:inline">{t(`board.views.${v}`)}</span>
            </ButtonLink>
          ))}
        </div>
      }
    >
      {sp.planned && <Notice tone="good">{t("board.planned", { count: Number(sp.planned) })}</Notice>}
      {sp.ai === "limit" && <Notice>{t("library.aiLimit", { count: 0 })}</Notice>}
      {sp.ai === "error" && <Notice>{t("library.aiError")}</Notice>}
      {sp.error === "post" && <Notice>{t("posts.createError")}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills items={filters} />
        {canWrite && (
          <form action={makeWeek} className="flex items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="days" value="7" />
            <Button variant="quiet" icon="sparkle">{t("board.makeWeek")}</Button>
          </form>
        )}
      </div>
      <PostBoard locale={locale} view={view} posts={items} labels={labels} canWrite={canWrite} startIdea={sp.new === "idea"} />
    </AppShell>
  );
}
