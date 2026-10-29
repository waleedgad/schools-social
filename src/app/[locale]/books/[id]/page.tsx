import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Chip, Notice, Pills, Select, TextArea } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { addBookText, checkBookNames, commentOnBook, removeBookText, resolveBookComment, setBookStatus } from "@/lib/actions/team";
import { isComms } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { classScope, classStudents, signPaths } from "@/lib/team";

type Page = { n: number; title?: string; image: string; students?: string[]; type?: string };

// Reviewing a yearbook: page by page with comments, the class teacher's
// name check, and the texts collected for the book.
export default async function BookPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ tab?: string; page?: string; saved?: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { user, membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const schoolId = membership.school.id;
  const comms = isComms(membership.role);
  const { data: book } = await supabase.from("books").select("id, title, kind, grade, class_name, version, status, pages").eq("id", id).eq("school_id", schoolId).maybeSingle();
  if (!book) {
    return (
      <AppShell locale={locale} membership={membership} workspaces={workspaces} active="books" title={t("books.title")}>
        <Notice>{t("books.missing")}</Notice>
      </AppShell>
    );
  }
  const pages = (book.pages as Page[]) ?? [];
  const tab = ["pages", "names", "texts"].includes(sp.tab ?? "") ? sp.tab! : "pages";
  const n = Math.min(Math.max(1, Number(sp.page) || 1), Math.max(1, pages.length));
  const page = pages[n - 1];
  const scope = await classScope(supabase, schoolId, user.id, membership.role);

  const [{ data: comments }, { data: checks }, { data: texts }] = await Promise.all([
    supabase.from("book_comments").select("id, page, body, author_name, done, created_at").eq("book_id", id).order("created_at"),
    supabase.from("book_checks").select("student_code, ok, fixed_name, note").eq("book_id", id),
    supabase.from("book_texts").select("id, kind, class_name, student_code, body, author_name, user_id, created_at").eq("book_id", id).order("created_at"),
  ]);
  const urls = await signPaths(supabase, tab === "pages" ? [page?.image ?? "", pages[n]?.image ?? ""] : []);
  const pageComments = (comments ?? []).filter((c) => c.page === n);
  const openByPage = new Map<number, number>();
  for (const c of comments ?? []) if (!c.done) openByPage.set(c.page as number, (openByPage.get(c.page as number) ?? 0) + 1);

  // Name check: students of the teacher's classes who are in this book.
  const students = tab === "names" ? await classStudents(supabase, schoolId, scope.all && book.class_name ? { all: false, classes: [book.class_name as string] } : scope, locale) : [];
  const onPages = new Map<string, number[]>();
  for (const p of pages) for (const s of p.students ?? []) onPages.set(s, [...(onPages.get(s) ?? []), p.n]);
  const mine = students.filter((s) => onPages.has(s.code) || (book.class_name ? s.className === book.class_name : false));
  const check = new Map((checks ?? []).map((c) => [c.student_code as string, c]));
  const missing = mine.filter((s) => !onPages.has(s.code));

  const tabs = [["pages", t("books.tabs.pages")], ["names", t("books.tabs.names")], ["texts", t("books.tabs.texts")]];
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="book" value={id} />
    </>
  );

  return (
    <AppShell
      locale={locale}
      membership={membership}
      workspaces={workspaces}
      active="books"
      title={book.title as string}
      subtitle={`${t(`books.kind.${book.kind}`)} · ${t("books.version", { v: book.version as number })} · ${t(`books.status.${book.status}`)}`}
      actions={
        comms && (
          <form action={setBookStatus} className="flex gap-2">
            {hidden}
            {book.status !== "approved" && <Button name="status" value="approved" variant="good" icon="check">{t("books.approve")}</Button>}
            {book.status === "approved" && <Button name="status" value="review" variant="quiet">{t("books.reopen")}</Button>}
          </form>
        )
      }
    >
      {sp.saved && <Notice tone="good">{t(`books.saved.${sp.saved}`)}</Notice>}
      <Pills items={tabs.map(([k, l]) => ({ label: l, href: { pathname: `/books/${id}`, query: { tab: k } }, on: tab === k }))} />

      {tab === "pages" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="space-y-3 !p-3">
            <div className="grid place-items-center overflow-hidden rounded-lg bg-background">
              {urls.get(page?.image ?? "") ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                <img src={urls.get(page!.image)} alt="" className="max-h-[70vh] w-auto" />
              ) : (
                <p className="p-10 text-sm text-muted">{t("books.noPicture")}</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <ButtonLink href={{ pathname: `/books/${id}`, query: { page: String(Math.max(1, n - 1)) } }} variant="quiet" className={n <= 1 ? "pointer-events-none opacity-40" : ""}>‹</ButtonLink>
              <span className="text-sm">{t("books.pageOf", { n, total: pages.length })}{page?.title ? ` · ${page.title}` : ""}</span>
              <ButtonLink href={{ pathname: `/books/${id}`, query: { page: String(Math.min(pages.length, n + 1)) } }} variant="quiet" className={n >= pages.length ? "pointer-events-none opacity-40" : ""}>›</ButtonLink>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {pages.map((p) => (
                <Link key={p.n} href={{ pathname: `/books/${id}`, query: { page: String(p.n) } }} className={`relative grid size-9 shrink-0 place-items-center rounded-md border text-xs ${p.n === n ? "border-accent bg-accent-bg font-bold text-accent-ink" : "border-border"}`}>
                  {p.n}
                  {openByPage.get(p.n) ? <span className="absolute -end-1 -top-1 size-2.5 rounded-full bg-warn" /> : null}
                </Link>
              ))}
            </div>
          </Card>
          <Card title={t("books.comments")}>
            <ul className="mb-3 space-y-2">
              {pageComments.map((c) => (
                <li key={c.id as string} className={`rounded-lg border border-border p-2 text-sm ${c.done ? "opacity-50" : ""}`}>
                  <p className="whitespace-pre-wrap">{c.body as string}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="grow">{(c.author_name as string) ?? ""}</span>
                    {c.done ? <Chip tone="good">{t("books.done")}</Chip> : comms && (
                      <form action={resolveBookComment}>
                        {hidden}
                        <input type="hidden" name="id" value={c.id as string} />
                        <button className="font-semibold text-accent-ink">{t("books.markDone")}</button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
              {!pageComments.length && <li className="text-sm text-muted">{t("books.noComments")}</li>}
            </ul>
            <form action={commentOnBook} className="space-y-2">
              {hidden}
              <input type="hidden" name="page" value={n} />
              <TextArea label={t("books.addComment")} name="body" rows={3} maxLength={1000} required />
              <Button icon="comment">{t("books.send")}</Button>
            </form>
          </Card>
        </div>
      )}

      {tab === "names" && (
        <Card title={t("books.namesTitle")}>
          <p className="mb-3 text-sm text-muted">{t("books.namesHint")}</p>
          {!mine.length ? (
            <p className="text-sm text-muted">{scope.all ? t("books.noNames") : t("books.noClassNames")}</p>
          ) : (
            <form action={checkBookNames} className="space-y-3">
              {hidden}
              <ul className="divide-y divide-border">
                {mine.map((s) => {
                  const c = check.get(s.code);
                  return (
                    <li key={s.code} className="grid gap-2 py-2 sm:grid-cols-[1fr_1fr] sm:items-center">
                      <input type="hidden" name="code" value={s.code} />
                      <div>
                        <b className="text-sm">{s.nameAr && locale === "ar" ? s.nameAr : s.nameEn}</b>
                        {s.nameAr && <span className="block text-xs text-muted">{locale === "ar" ? s.nameEn : s.nameAr}</span>}
                        <span className="text-xs text-muted">
                          {onPages.has(s.code) ? t("books.onPages", { pages: onPages.get(s.code)!.join(", ") }) : t("books.notInBook")}
                          {c ? ` · ${c.ok ? t("books.ok") : t("books.fixed")}` : ""}
                        </span>
                      </div>
                      <input name={`fix.${s.code}`} defaultValue={(c?.fixed_name as string) ?? ""} placeholder={t("books.fixPlaceholder")} className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm" />
                    </li>
                  );
                })}
              </ul>
              {missing.length > 0 && <Notice tone="warn">{t("books.missingStudents", { count: missing.length })}</Notice>}
              <Button icon="check">{t("books.saveNames")}</Button>
            </form>
          )}
        </Card>
      )}

      {tab === "texts" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("books.textsTitle")}>
            <ul className="space-y-2">
              {(texts ?? []).map((x) => (
                <li key={x.id as string} className="rounded-lg border border-border p-2 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                    <Chip tone="accent">{t(`books.textKind.${x.kind}`)}</Chip>
                    {x.class_name && <span>{x.class_name as string}</span>}
                    <span className="grow">{(x.author_name as string) ?? ""}</span>
                    {(comms || x.user_id === user.id) && (
                      <form action={removeBookText}>
                        {hidden}
                        <input type="hidden" name="id" value={x.id as string} />
                        <button className="text-danger">{t("books.remove")}</button>
                      </form>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{x.body as string}</p>
                </li>
              ))}
              {!texts?.length && <li className="text-sm text-muted">{t("books.noTexts")}</li>}
            </ul>
          </Card>
          <Card title={t("books.addText")}>
            <form action={addBookText} className="space-y-3">
              {hidden}
              <Select label={t("books.textKindLabel")} name="kind" defaultValue={membership.role === "principal" ? "principal" : membership.role === "teacher" ? "teacher" : "other"}>
                {["teacher", "principal", "quote", "other"].map((k) => <option key={k} value={k}>{t(`books.textKind.${k}`)}</option>)}
              </Select>
              {(scope.classes.length > 0 || book.class_name) && (
                <Select label={t("books.forClass")} name="class" defaultValue={(book.class_name as string) ?? scope.classes[0] ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(book.class_name ? [book.class_name as string] : []), ...scope.classes])].map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
              <TextArea label={t("books.textBody")} name="body" rows={6} maxLength={1500} required hint={t("books.textHint")} />
              <Button icon="plus">{t("books.addTextButton")}</Button>
            </form>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
