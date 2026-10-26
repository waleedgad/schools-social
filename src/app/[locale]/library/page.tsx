import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader, PageBody } from "@/components/app-header";
import { Button, Card, Field, Notice } from "@/components/ui";
import { Link, redirect } from "@/i18n/navigation";
import { createEvent, deletePhoto, setOptedOut } from "@/lib/actions/library";
import { thumbPath } from "@/lib/images";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type EventRow = { id: string; title: string; event_date: string; class_name: string | null };
type PhotoRow = { id: string; storage_path: string; note: string | null; contains_opted_out: boolean; source: string };

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership } = await requireMembership(locale);
  if (!can(membership.role, "viewLibrary")) redirect({ href: "/upload", locale });

  const { event, error } = await searchParams;
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
  let query = supabase
    .from("photos")
    .select("id, storage_path, note, contains_opted_out, source")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(200);
  query = selected === "none" ? query.is("event_id", null) : query.eq("event_id", selected);
  const { data: photos } = await query.returns<PhotoRow[]>();

  const paths = (photos ?? []).flatMap((p) => [thumbPath(p.storage_path), p.storage_path]);
  const { data: signed } = paths.length
    ? await supabase.storage.from("photos").createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? undefined]));
  const current = events?.find((e) => e.id === selected);

  return (
    <>
      <AppHeader locale={locale} signedIn />
      <PageBody>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("library.title")}</h1>
          <Link href="/dashboard" className="text-sm text-accent hover:underline">
            {t("staff.back")}
          </Link>
        </div>

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
          </aside>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{current?.title ?? t("upload.noEvent")}</h2>
              <Link
                href={{ pathname: "/upload", query: current ? { event: current.id } : {} }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
              >
                {t("dashboard.sections.upload")}
              </Link>
            </div>
            {!photos?.length && <p className="text-muted">{t("library.empty")}</p>}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(photos ?? []).map((p) => (
                <li key={p.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                  <a href={url.get(p.storage_path)} target="_blank" rel="noreferrer" className="relative block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                    <img src={url.get(thumbPath(p.storage_path))} alt={p.note ?? ""} className="aspect-square w-full object-cover" loading="lazy" />
                    {p.contains_opted_out && (
                      <span className="absolute start-2 top-2 rounded bg-danger px-2 py-0.5 text-xs font-semibold text-white">
                        {t("library.notForPosting")}
                      </span>
                    )}
                  </a>
                  <div className="space-y-2 p-2 text-xs">
                    {p.note && <p className="line-clamp-2">{p.note}</p>}
                    <div className="flex items-center justify-between gap-2">
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
      </PageBody>
    </>
  );
}
