import { getTranslations, setRequestLocale } from "next-intl/server";
import { FrameUploader } from "@/components/frame-uploader";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Notice, Pills, Select, TextArea, Toggle } from "@/components/ui";
import { redirect } from "@/i18n/navigation";
import { addSlot, deleteCategory, deleteFrame, deleteSlot, deleteSnippet, draftProfile, saveCategory, saveProfile, saveSnippet, suggestSlots } from "@/lib/actions/brand";
import type { SchoolProfile } from "@/lib/ai/types";
import { categoryName } from "@/lib/posting";
import { signedThumbs } from "@/lib/posts";
import { can } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const TABS = ["categories", "slots", "frames", "snippets", "brand"] as const;
type Tab = (typeof TABS)[number];

// Categories, weekly posting slots, frames, saved text and the brand voice:
// everything that makes posts look and sound like the school.
export default async function CategoriesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; saved?: string; error?: string; edit?: string; drafted?: string; ai?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  const perms = membership.school.permissions;
  if (!can(membership.role, "writePosts", perms)) redirect({ href: "/today", locale });
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "categories";
  const lead = can(membership.role, "manageCategories", perms);
  const t = await getTranslations();
  const supabase = await createClient();
  const schoolId = membership.school.id;

  const [{ data: categories }, { data: slots }, { data: frames }, { data: snippets }, { data: school }, { data: counts }] = await Promise.all([
    supabase.from("categories").select("*").eq("school_id", schoolId).order("position"),
    supabase.from("time_slots").select("id, weekday, at_time, category_id, platforms").eq("school_id", schoolId).order("weekday").order("at_time"),
    supabase.from("frames").select("id, name, kind, storage_path, shape").eq("school_id", schoolId).order("created_at"),
    supabase.from("snippets").select("id, kind, title, body").eq("school_id", schoolId).order("kind").order("title"),
    supabase.from("schools").select("profile").eq("id", schoolId).single(),
    supabase.from("posts").select("category_id").eq("school_id", schoolId).gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
  ]);
  const frameUrls = await signedThumbs(supabase, (frames ?? []).map((f) => f.storage_path as string));
  const profile = (school?.profile ?? {}) as SchoolProfile;
  const perCategory = new Map<string, number>();
  for (const r of counts ?? []) if (r.category_id) perCategory.set(r.category_id as string, (perCategory.get(r.category_id as string) ?? 0) + 1);
  const total = (counts ?? []).length || 1;
  const editing = (categories ?? []).find((c) => c.id === sp.edit);
  const day = (n: number) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + n)));
  const hidden = <input type="hidden" name="locale" value={locale} />;

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="categories" title={t("brandPage.title")} subtitle={t("brandPage.subtitle")}>
      <Pills items={TABS.map((k) => ({ label: t(`brandPage.tabs.${k}`), href: { pathname: "/categories", query: { tab: k } }, on: k === tab }))} />
      {sp.saved && <Notice tone="good">{t("settings.saved")}</Notice>}
      {sp.drafted && <Notice tone="good">{t("brandPage.drafted")}</Notice>}
      {sp.error && <Notice>{t(`brandPage.errors.${sp.error}`)}</Notice>}
      {sp.ai && <Notice>{t(sp.ai === "limit" ? "composer.aiLimit" : "composer.aiFailed")}</Notice>}

      {tab === "categories" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card title={t("brandPage.categories")}>
            <p className="mb-3 text-sm text-muted">{t("brandPage.categoriesHint")}</p>
            <ul className="divide-y divide-border">
              {(categories ?? []).map((c) => {
                const share = Math.round(((perCategory.get(c.id) ?? 0) / total) * 100);
                return (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                    <div className="min-w-0 grow">
                      <b className="text-sm">{categoryName(c, locale)}</b>
                      {c.description && <p className="truncate text-xs text-muted">{c.description}</p>}
                    </div>
                    <div className="hidden w-28 sm:block" title={t("brandPage.share", { share })}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-grey-bg">
                        <div className="h-full" style={{ width: `${share}%`, background: c.color }} />
                      </div>
                      <span className="text-[10px] text-muted">{t("brandPage.share", { share })}</span>
                    </div>
                    {c.needs_extra_approval && <span className="text-[11px] text-warn">{t("brandPage.extra")}</span>}
                    {lead && (
                      <a href={`?tab=categories&edit=${c.id}`} className="text-xs text-accent">
                        {t("brandPage.edit")}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          {lead && (
            <Card title={editing ? t("brandPage.editCategory") : t("brandPage.newCategory")}>
              <form action={saveCategory} className="space-y-3" key={editing?.id ?? "new"}>
                {hidden}
                {editing && <input type="hidden" name="id" value={editing.id} />}
                <Field label={t("brandPage.nameAr")} name="nameAr" dir="rtl" defaultValue={editing?.name_ar} maxLength={60} />
                <Field label={t("brandPage.nameEn")} name="nameEn" dir="ltr" defaultValue={editing?.name_en} maxLength={60} />
                <Field label={t("brandPage.description")} name="description" defaultValue={editing?.description ?? ""} maxLength={300} />
                <div className="grid grid-cols-[4rem_1fr] gap-2">
                  <Field label={t("brandPage.color")} name="color" type="color" defaultValue={editing?.color ?? "#3b6cf6"} className="h-10 !p-1" />
                  <Field label={t("posts.hashtags")} name="hashtags" defaultValue={editing?.hashtags ?? ""} maxLength={300} />
                </div>
                <Select label={t("composer.frame")} name="frame" defaultValue={editing?.frame_id ?? ""}>
                  <option value="">{t("composer.noFrame")}</option>
                  {(frames ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                <Toggle name="extra" defaultChecked={editing?.needs_extra_approval} label={t("brandPage.needsExtra")} hint={t("brandPage.needsExtraHint")} />
                <Button className="w-full">{t("common.save")}</Button>
              </form>
              {editing && (
                <form action={deleteCategory} className="mt-2">
                  {hidden}
                  <input type="hidden" name="id" value={editing.id} />
                  <Button variant="danger" icon="trash" className="w-full">
                    {t("brandPage.delete")}
                  </Button>
                </form>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === "slots" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card title={t("brandPage.slots")}>
            <p className="mb-3 text-sm text-muted">{t("brandPage.slotsHint")}</p>
            {!slots?.length && lead && (
              <form action={suggestSlots} className="mb-3">
                {hidden}
                <Button variant="quiet" icon="sparkle">{t("brandPage.suggestSlots")}</Button>
              </form>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[6, 0, 1, 2, 3, 4, 5].map((d) => {
                const list = (slots ?? []).filter((s) => s.weekday === d);
                return (
                  <div key={d} className="rounded-lg border border-border p-2">
                    <b className="text-xs">{day(d)}</b>
                    {!list.length && <p className="text-[11px] text-faint">—</p>}
                    <ul className="mt-1 space-y-1">
                      {list.map((s) => {
                        const c = (categories ?? []).find((x) => x.id === s.category_id);
                        return (
                          <li key={s.id} className="flex items-center gap-1.5 text-xs">
                            <span className="ltr font-semibold">{String(s.at_time).slice(0, 5)}</span>
                            {c && <span className="size-2 rounded-full" style={{ background: c.color }} />}
                            <span className="grow truncate text-muted">{c ? categoryName(c, locale) : t("brandPage.anyCategory")}</span>
                            {lead && (
                              <form action={deleteSlot}>
                                {hidden}
                                <input type="hidden" name="id" value={s.id} />
                                <button className="text-faint hover:text-danger" aria-label={t("brandPage.delete")}>
                                  ✕
                                </button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
          {lead && (
            <Card title={t("brandPage.addSlot")}>
              <form action={addSlot} className="space-y-3">
                {hidden}
                <div className="flex flex-wrap gap-2">
                  {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                    <label key={d} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name="weekday" value={d} defaultChecked={d < 5} /> {day(d)}
                    </label>
                  ))}
                </div>
                <Field label={t("brandPage.time")} name="time" type="time" defaultValue="18:00" required />
                <Select label={t("composer.category")} name="category" defaultValue="">
                  <option value="">{t("brandPage.anyCategory")}</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryName(c, locale)}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-3 text-sm">
                  <label className="flex items-center gap-1"><input type="checkbox" name="platform" value="facebook" defaultChecked /> Facebook</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="platform" value="instagram" defaultChecked /> Instagram</label>
                </div>
                <Button className="w-full">{t("brandPage.addSlot")}</Button>
              </form>
            </Card>
          )}
        </div>
      )}

      {tab === "frames" && (
        <Card title={t("brandPage.frames")}>
          <p className="mb-3 text-sm text-muted">{t("brandPage.framesHint")}</p>
          <FrameUploader locale={locale} schoolId={schoolId} />
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(frames ?? []).map((f) => (
              <li key={f.id} className="overflow-hidden rounded-lg border border-border">
                <div className="bg-[repeating-conic-gradient(var(--color-grey-bg)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                  <img src={frameUrls.get(f.storage_path)} alt="" className="aspect-[4/5] w-full object-contain" />
                </div>
                <div className="flex items-center justify-between p-2 text-xs">
                  <span className="truncate">{f.name} · {f.shape}</span>
                  <form action={deleteFrame}>
                    {hidden}
                    <input type="hidden" name="id" value={f.id} />
                    <button className="text-danger">✕</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "snippets" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card title={t("brandPage.snippets")}>
            <p className="mb-3 text-sm text-muted">{t("brandPage.snippetsHint")}</p>
            <ul className="divide-y divide-border">
              {(snippets ?? []).map((s) => (
                <li key={s.id} className="flex items-start gap-3 py-2">
                  <span className="mt-0.5 shrink-0 rounded bg-grey-bg px-1.5 text-[10px] font-semibold uppercase">{t(`brandPage.kinds.${s.kind}`)}</span>
                  <div className="min-w-0 grow">
                    <b className="text-sm">{s.title}</b>
                    <p className="line-clamp-2 text-xs text-muted" dir="auto">{s.body}</p>
                  </div>
                  <form action={deleteSnippet}>
                    {hidden}
                    <input type="hidden" name="id" value={s.id} />
                    <button className="text-faint hover:text-danger">✕</button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("brandPage.newSnippet")}>
            <form action={saveSnippet} className="space-y-3">
              {hidden}
              <Select label={t("brandPage.kind")} name="kind" defaultValue="hashtags">
                {["hashtags", "text", "signoff", "avoid"].map((k) => (
                  <option key={k} value={k}>
                    {t(`brandPage.kinds.${k}`)}
                  </option>
                ))}
              </Select>
              <Field label={t("brandPage.snippetTitle")} name="title" required maxLength={60} />
              <TextArea label={t("brandPage.snippetBody")} name="body" rows={3} required maxLength={1000} dir="auto" />
              <Button className="w-full">{t("common.save")}</Button>
            </form>
          </Card>
        </div>
      )}

      {tab === "brand" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card title={t("brandPage.voice")}>
            <form action={saveProfile} className="grid gap-3 sm:grid-cols-2">
              {hidden}
              <Field label={t("brandPage.motto")} name="motto" defaultValue={profile.motto} maxLength={200} disabled={!lead} />
              <Field label={t("brandPage.stages")} name="stages" defaultValue={profile.stages} maxLength={200} disabled={!lead} />
              <Field label={t("brandPage.curriculum")} name="curriculum" defaultValue={profile.curriculum} maxLength={200} disabled={!lead} />
              <Field label={t("brandPage.audience")} name="audience" defaultValue={profile.audience} maxLength={300} disabled={!lead} />
              <Field label={t("brandPage.tone")} name="tone" defaultValue={profile.tone} maxLength={200} disabled={!lead} />
              <Select label={t("brandPage.dialect")} name="dialect" defaultValue={profile.dialect ?? "msa"} disabled={!lead}>
                <option value="msa">{t("brandPage.msa")}</option>
                <option value="egyptian">{t("brandPage.egyptian")}</option>
              </Select>
              <Select label={t("brandPage.emoji")} name="emoji" defaultValue={profile.emoji ?? "few"} disabled={!lead}>
                <option value="none">{t("brandPage.emojiNone")}</option>
                <option value="few">{t("brandPage.emojiFew")}</option>
                <option value="many">{t("brandPage.emojiMany")}</option>
              </Select>
              <Field label={t("brandPage.signoff")} name="signoff" defaultValue={profile.signoff} maxLength={200} disabled={!lead} />
              <Field label={t("brandPage.useWords")} name="useWords" defaultValue={profile.useWords} maxLength={400} disabled={!lead} />
              <Field label={t("brandPage.avoidWords")} name="avoidWords" defaultValue={profile.avoidWords} maxLength={400} disabled={!lead} />
              {lead && <Button className="sm:col-span-2">{t("common.save")}</Button>}
            </form>
          </Card>
          <div className="space-y-4">
            {lead && (
              <Card title={t("brandPage.draftTitle")}>
                <form action={draftProfile} className="space-y-2">
                  {hidden}
                  <TextArea label={t("brandPage.source")} name="source" rows={6} maxLength={6000} required hint={t("brandPage.sourceHint")} />
                  <Button icon="sparkle" className="w-full">{t("brandPage.draft")}</Button>
                </form>
              </Card>
            )}
            <Card title={t("brandPage.learnt")}>
              <p className="mb-2 text-xs text-muted">{t("brandPage.learntHint", { count: profile.examples?.length ?? 0 })}</p>
              <ul className="space-y-1.5">
                {(profile.examples ?? []).slice(0, 4).map((e, i) => (
                  <li key={i} className="line-clamp-2 rounded bg-surface-2 p-1.5 text-[11px]" dir="auto">
                    {e}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}
