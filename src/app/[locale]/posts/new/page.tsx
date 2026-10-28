import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, ButtonLink, Card, Select, TextArea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { redirect } from "@/i18n/navigation";
import { createPost } from "@/lib/actions/posts";
import { categoryName } from "@/lib/posting";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

// Every way to start a post: from an event's best photos, from photos
// picked in the library, text only, or a quick idea for later.
export default async function NewPostPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ day?: string; event?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  if (!can(membership.role, "writePosts", membership.school.permissions)) redirect({ href: "/posts", locale });
  const { day, event } = await searchParams;
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const [{ data: events }, { data: categories }] = await Promise.all([
    supabase.from("events").select("id, title, event_date, class_name").eq("school_id", schoolId).order("event_date", { ascending: false }).limit(40),
    supabase.from("categories").select("id, name_ar, name_en").eq("school_id", schoolId).order("position"),
  ]);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value="/posts/new" />
      {day && <input type="hidden" name="day" value={day} />}
    </>
  );
  const categorySelect = (
    <Select label={t("composer.category")} name="category" defaultValue="">
      <option value="">{t("composer.noCategory")}</option>
      {(categories ?? []).map((c) => (
        <option key={c.id} value={c.id}>
          {categoryName(c as { name_ar: string; name_en: string }, locale)}
        </option>
      ))}
    </Select>
  );

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="posts" title={t("newPost.title")} subtitle={day ? t("newPost.forDay", { day }) : t("newPost.subtitle")}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><Icon name="sparkle" className="text-accent" />{t("newPost.fromEvent")}</span>}>
          <form action={createPost} className="space-y-3">
            {hidden}
            <input type="hidden" name="best" value="1" />
            <input type="hidden" name="generate" value="1" />
            <p className="text-sm text-muted">{t("newPost.fromEventHint")}</p>
            <Select label={t("newPost.event")} name="event" required defaultValue={event ?? ""}>
              <option value="" disabled>
                {t("newPost.pickEvent")}
              </option>
              {(events ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {e.event_date}
                  {e.class_name ? ` · ${e.class_name}` : ""}
                </option>
              ))}
            </Select>
            {categorySelect}
            <Button icon="sparkle" className="w-full">{t("newPost.makeIt")}</Button>
          </form>
        </Card>

        <Card title={<span className="inline-flex items-center gap-2"><Icon name="library" className="text-accent" />{t("newPost.fromPhotos")}</span>}>
          <p className="mb-3 text-sm text-muted">{t("newPost.fromPhotosHint")}</p>
          <ButtonLink href="/library" icon="library" variant="primary" className="w-full">
            {t("newPost.openLibrary")}
          </ButtonLink>
        </Card>

        <Card title={<span className="inline-flex items-center gap-2"><Icon name="posts" className="text-accent" />{t("newPost.textOnly")}</span>}>
          <form action={createPost} className="space-y-3">
            {hidden}
            <p className="text-sm text-muted">{t("newPost.textOnlyHint")}</p>
            {categorySelect}
            <TextArea label={t("newPost.about")} name="idea" rows={2} maxLength={1000} placeholder={t("newPost.aboutPlaceholder")} />
            <input type="hidden" name="generate" value="1" />
            <Button variant="quiet" className="w-full">{t("newPost.startWriting")}</Button>
          </form>
        </Card>

        <Card title={<span className="inline-flex items-center gap-2"><Icon name="ideas" className="text-accent" />{t("newPost.idea")}</span>}>
          <form action={createPost} className="space-y-3">
            {hidden}
            <input type="hidden" name="kind" value="idea" />
            <TextArea label={t("newPost.ideaLabel")} name="idea" rows={2} required maxLength={1000} placeholder={t("board.ideaPlaceholder")} />
            {categorySelect}
            <Button variant="quiet" className="w-full">{t("newPost.saveIdea")}</Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
