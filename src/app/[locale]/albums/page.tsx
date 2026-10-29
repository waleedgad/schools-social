import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Empty, Pills } from "@/components/ui";
import { createPost } from "@/lib/actions/posts";
import { thumbPath } from "@/lib/images";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

type AlbumPhoto = { position: number; photo: { id: string; storage_path: string; edited_path: string | null; contains_opted_out: boolean; check_status: string; event: { title: string } | null } | null };

// Albums shared from the Mac (Ready to post, picks, an event), so the team
// can make a post from the phone.
export default async function AlbumsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ album?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { album } = await searchParams;
  const { membership, workspaces } = await requireMembership(locale);
  const t = await getTranslations("more");
  const supabase = await createClient();
  const { data: albums } = await supabase.from("shared_albums").select("id, name, updated_at").eq("school_id", membership.school.id).order("updated_at", { ascending: false });
  const current = (albums ?? []).find((a) => a.id === album) ?? albums?.[0];
  const { data: rows } = current
    ? await supabase.from("shared_album_photos").select("position, photo:photos(id, storage_path, edited_path, contains_opted_out, check_status, event:events(title))").eq("album_id", current.id).order("position").limit(300).returns<AlbumPhoto[]>()
    : { data: [] as AlbumPhoto[] };
  const photos = (rows ?? []).map((r) => r.photo).filter(Boolean) as NonNullable<AlbumPhoto["photo"]>[];
  const urls = await signedThumbs(supabase, photos.map((p) => thumbPath(p.edited_path ?? p.storage_path)));
  const canPost = can(membership.role, "writePosts", membership.school.permissions);

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="albums" title={t("albums.title")} subtitle={t("albums.subtitle")}>
      {!albums?.length ? (
        <Empty icon="library" title={t("albums.none")} body={t("albums.noneHint")} />
      ) : (
        <>
          <Pills items={albums.map((a) => ({ label: a.name as string, href: { pathname: "/albums", query: { album: a.id as string } }, on: a.id === current?.id }))} />
          <Card>
            <form action={createPost} className="space-y-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="back" value="/albums" />
              <input type="hidden" name="generate" value="1" />
              <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
                {photos.map((p) => {
                  const blocked = p.contains_opted_out || p.check_status === "waiting";
                  return (
                    <li key={p.id}>
                      <label className={`relative block ${blocked ? "opacity-50" : "cursor-pointer"}`}>
                        {canPost && !blocked && <input type="checkbox" name="photo" value={p.id} className="peer absolute start-1.5 top-1.5 z-10 size-4" />}
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                        <img src={urls.get(thumbPath(p.edited_path ?? p.storage_path))} alt="" className="aspect-square w-full rounded-md object-cover peer-checked:ring-4 peer-checked:ring-accent" />
                        {blocked && <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-warn px-1 text-center text-[10px] text-white">{p.contains_opted_out ? t("albums.cantUse") : t("albums.waiting")}</span>}
                        {p.event?.title && <span className="mt-0.5 block truncate text-[10px] text-muted">{p.event.title}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {canPost && <Button icon="plus">{t("albums.makePost")}</Button>}
            </form>
          </Card>
        </>
      )}
    </AppShell>
  );
}
