import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "@/components/icons";
import { ReplyBox } from "@/components/reply-box";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Chip, Empty, Field, Notice, Pills, TextArea } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { addSavedReply, removeSavedReply, toggleHidden } from "@/lib/actions/inbox";
import { listComments, listConversations, type InboxComment, type InboxMessage } from "@/lib/meta";
import { can, isComms } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Questions spotted in comments, so they get answered first.
const QUESTION = /[?؟]|\b(how|when|where|price|fees|admission)\b|(كم|متى|أين|فين|ازاي|إزاي|مصاريف|تقديم|القبول)/i;

// Comments on the school's last posts, newest first, with AI reply ideas.
export default async function InboxPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ show?: string; sent?: string; view?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "writePosts", membership.school.permissions)) redirect({ href: "/today", locale });
  const sp = await searchParams;
  const show = sp.show === "all" || sp.show === "questions" ? sp.show : "open";
  // Comments on posts, or private messages (Messenger and Instagram).
  const view = sp.view === "messages" ? "messages" : "comments";
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const { data: posts } = await supabase
    .from("posts")
    .select("id, caption_ar, caption_en, fb_post_id, ig_media_id, published_at")
    .eq("school_id", schoolId)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 21 * 86400_000).toISOString())
    .order("published_at", { ascending: false })
    .limit(12);

  let token: string | null = null;
  let pageId = "";
  let igId = "";
  if (isAdminConfigured) {
    const { data } = await createAdminClient().from("meta_connections").select("page_token, page_id, ig_user_id").eq("school_id", schoolId).maybeSingle();
    token = (data?.page_token as string | undefined) ?? null;
    pageId = (data?.page_id as string | null) ?? "";
    igId = (data?.ig_user_id as string | null) ?? "";
  }
  const { data: savedRows } = await supabase.from("snippets").select("id, title, body").eq("school_id", schoolId).eq("kind", "reply").order("created_at");
  const saved = (savedRows ?? []).map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string }));
  const comms = isComms(membership.role);

  // Private messages: the Page's Messenger and Instagram conversations.
  const convos: InboxMessage[] = [];
  if (token && pageId && view === "messages") {
    const [fbm, igm] = await Promise.all([listConversations(pageId, [igId].filter(Boolean), token, "facebook"), igId ? listConversations(pageId, [igId], token, "instagram") : Promise.resolve([])]);
    convos.push(...fbm, ...igm);
    convos.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  const convosShown = convos.filter((c) => (show === "all" ? true : show === "questions" ? QUESTION.test(c.text) && !c.fromPage : !c.fromPage));

  const all: (InboxComment & { postId: string; postText: string })[] = [];
  if (token && view === "comments") {
    const lists = await Promise.all(
      (posts ?? []).flatMap((p) => [
        p.fb_post_id ? listComments("facebook", p.fb_post_id as string, token!).then((l) => l.map((c) => ({ ...c, postId: p.id as string, postText: (p.caption_ar || p.caption_en || "") as string }))) : Promise.resolve([]),
        p.ig_media_id ? listComments("instagram", p.ig_media_id as string, token!).then((l) => l.map((c) => ({ ...c, postId: p.id as string, postText: (p.caption_ar || p.caption_en || "") as string }))) : Promise.resolve([]),
      ]),
    );
    all.push(...lists.flat());
  }
  all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shown = all.filter((c) => (show === "all" ? true : show === "questions" ? QUESTION.test(c.text) : !c.replied && !c.hidden));
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: membership.school.timezone });

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="inbox" title={t("inbox.title")} subtitle={t("inbox.subtitle")}>
      {sp.sent === "1" && <Notice tone="good">{t("inbox.sent")}</Notice>}
      {sp.sent === "0" && <Notice>{t("inbox.failed")}</Notice>}
      {!token ? (
        <Empty icon="inbox" title={t("inbox.notConnected")} body={t("inbox.notConnectedHint")} action={<ButtonLink href="/accounts" variant="primary">{t("nav.accounts")}</ButtonLink>} />
      ) : (
        <>
          <Pills
            items={(["comments", "messages"] as const).map((k) => ({ label: t(`inbox.views.${k}`), href: { pathname: "/inbox", query: { view: k } }, on: view === k }))}
          />
          <details className="card p-3" data-testid="saved-replies">
            <summary className="cursor-pointer text-sm font-semibold">{t("inbox.saved.title")} ({saved.length})</summary>
            <p className="mt-1 text-xs text-muted">{t("inbox.saved.hint")}</p>
            <ul className="mt-2 space-y-1.5">
              {saved.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-sm">
                  <div className="min-w-0 grow">
                    <b>{r.title}</b>
                    <p className="whitespace-pre-wrap text-xs text-muted" dir="auto">{r.body}</p>
                  </div>
                  {comms && (
                    <form action={removeSavedReply}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="reply" value={r.id} />
                      <button className="text-[11px] text-muted hover:text-danger">{t("inbox.saved.remove")}</button>
                    </form>
                  )}
                </li>
              ))}
              {!saved.length && <li className="text-xs text-muted">{t("inbox.saved.none")}</li>}
            </ul>
            {comms && (
              <form action={addSavedReply} className="mt-3 space-y-2">
                <input type="hidden" name="locale" value={locale} />
                <Field label={t("inbox.saved.name")} name="title" maxLength={60} required placeholder={t("inbox.saved.namePlaceholder")} />
                <TextArea label={t("inbox.saved.body")} name="body" rows={2} maxLength={1000} required />
                <Button variant="quiet" icon="plus">{t("inbox.saved.add")}</Button>
              </form>
            )}
          </details>
          {view === "messages" ? (
            <>
              <Pills
                items={(["open", "questions", "all"] as const).map((k) => ({
                  label: `${t(`inbox.filters.${k}`)} ${k === "open" ? convos.filter((c) => !c.fromPage).length : k === "questions" ? convos.filter((c) => QUESTION.test(c.text) && !c.fromPage).length : convos.length}`,
                  href: { pathname: "/inbox", query: { view: "messages", show: k } },
                  on: show === k,
                }))}
              />
              <p className="text-xs text-muted">{t("inbox.messagesHint")}</p>
              {!convosShown.length ? (
                <Empty icon="check" title={t("inbox.clear")} />
              ) : (
                <ul className="space-y-2">
                  {convosShown.map((c) => (
                    <li key={c.id}>
                      <Card className="!p-3">
                        <div className="flex items-start gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-bg text-accent-ink">
                            <Icon name={c.platform} />
                          </span>
                          <div className="min-w-0 grow space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <b>{c.withName || t("inbox.someone")}</b>
                              <span className="text-faint">{fmt(c.at)}</span>
                              <Chip tone="info">{t("inbox.private")}</Chip>
                              {QUESTION.test(c.text) && !c.fromPage && <Chip tone="info">{t("inbox.question")}</Chip>}
                              {c.fromPage && <Chip tone="good">{t("inbox.replied")}</Chip>}
                            </div>
                            <p className="text-sm" dir="auto">
                              {c.fromPage ? `${t("inbox.you")}: ` : ""}
                              {c.text}
                            </p>
                            <ReplyBox locale={locale} platform={c.platform} comment={c.withId} text={c.text} postText="" kind="message" saved={saved} />
                          </div>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
          <Pills
            items={(["open", "questions", "all"] as const).map((k) => ({
              label: `${t(`inbox.filters.${k}`)} ${k === "open" ? all.filter((c) => !c.replied && !c.hidden).length : k === "questions" ? all.filter((c) => QUESTION.test(c.text)).length : all.length}`,
              href: { pathname: "/inbox", query: { show: k } },
              on: show === k,
            }))}
          />
          {!shown.length ? (
            <Empty icon="check" title={t("inbox.clear")} />
          ) : (
            <ul className="space-y-2">
              {shown.map((c) => (
                <li key={c.id}>
                  <Card className="!p-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-bg text-accent-ink">
                        <Icon name={c.platform} />
                      </span>
                      <div className="min-w-0 grow space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <b>{c.author || t("inbox.someone")}</b>
                          <span className="text-faint">{fmt(c.at)}</span>
                          {QUESTION.test(c.text) && <Chip tone="info">{t("inbox.question")}</Chip>}
                          {c.replied && <Chip tone="good">{t("inbox.replied")}</Chip>}
                          {c.hidden && <Chip tone="warn">{t("inbox.hidden")}</Chip>}
                        </div>
                        <p className="text-sm" dir="auto">
                          {c.text}
                        </p>
                        <Link href={`/posts/${c.postId}`} className="block truncate text-[11px] text-muted hover:text-accent-ink">
                          ↳ {c.postText}
                        </Link>
                        <ReplyBox locale={locale} platform={c.platform} comment={c.id} text={c.text} postText={c.postText} saved={saved} />
                      </div>
                      <form action={toggleHidden}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="platform" value={c.platform} />
                        <input type="hidden" name="comment" value={c.id} />
                        <input type="hidden" name="hide" value={c.hidden ? "0" : "1"} />
                        <button className="text-[11px] text-muted hover:text-danger">{c.hidden ? t("inbox.unhide") : t("inbox.hide")}</button>
                      </form>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
