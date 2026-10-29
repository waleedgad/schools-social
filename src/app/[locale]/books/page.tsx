import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell";
import { Card, Chip, Empty } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { classScope, signPaths } from "@/lib/team";

type Page = { n: number; image: string; students?: string[] };

// Yearbooks sent from the Mac for review.
export default async function BooksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user, membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const scope = await classScope(supabase, membership.school.id, user.id, membership.role);
  const { data } = await supabase.from("books").select("id, title, kind, grade, class_name, version, status, pages, updated_at").eq("school_id", membership.school.id).order("updated_at", { ascending: false }).limit(60);
  // Teachers see the books with their classes in them; comms see all.
  const books = (data ?? []).filter((b) => scope.all || !b.class_name || scope.classes.includes(b.class_name as string) || b.kind === "grade" || b.kind === "graduation");
  const covers = await signPaths(supabase, books.map((b) => ((b.pages as Page[])[0]?.image ?? "")));
  const { data: checks } = books.length ? await supabase.from("book_checks").select("book_id").in("book_id", books.map((b) => b.id as string)) : { data: [] };
  const checked = new Map<string, number>();
  for (const c of checks ?? []) checked.set(c.book_id as string, (checked.get(c.book_id as string) ?? 0) + 1);

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="books" title={t("books.title")} subtitle={t("books.subtitle")}>
      {!books.length ? (
        <Empty icon="book" title={t("books.none")} body={t("books.noneHint")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((b) => {
            const pages = b.pages as Page[];
            const cover = covers.get(pages[0]?.image ?? "");
            return (
              <li key={b.id as string}>
                <Link href={`/books/${b.id}`} className="block hover:opacity-90">
                  <Card className="space-y-2 !p-3">
                    <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-background">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                        <img src={cover} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <Icon name="book" size={32} className="text-faint" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <b className="grow truncate">{b.title as string}</b>
                      <Chip tone={b.status === "approved" ? "good" : b.status === "printing" ? "info" : "warn"}>{t(`books.status.${b.status}`)}</Chip>
                    </div>
                    <p className="text-xs text-muted">
                      {t(`books.kind.${b.kind}`)} · {t("books.pages", { count: pages.length })} · {t("books.version", { v: b.version as number })}
                      {checked.get(b.id as string) ? ` · ${t("books.checked", { count: checked.get(b.id as string)! })}` : ""}
                    </p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
