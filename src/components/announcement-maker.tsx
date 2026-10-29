"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { createAnnouncement } from "@/lib/actions/announce";
import { drawAnnouncement, PACK, type Design, type Size, type Template, type Text } from "@/lib/announce-draw";
import { thumbPath } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";

type Category = { id: string; name: string };

export function AnnouncementMaker({ locale, schoolId, userId, schoolName, categories, day, title = "" }: { locale: string; schoolId: string; userId: string; schoolName: string; categories: Category[]; day: string | null; title?: string }) {
  const t = useTranslations("announce");
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [template, setTemplate] = useState<Template>("clean");
  const [size, setSize] = useState<Size>("post");
  const [text, setText] = useState<Text>({ ar: /[\u0600-\u06FF]/.test(title) ? title : "", en: /[\u0600-\u06FF]/.test(title) ? "" : title, details: "", school: schoolName, accent: "#2f6fdf", ink: "#1b1d22" });
  const [category, setCategory] = useState("");
  const [designs, setDesigns] = useState<Design[]>([]);
  const [images] = useState(() => new Map<string, HTMLImageElement>());
  const [busy, setBusy] = useState<"" | "upload" | "make">("");
  const [error, setError] = useState("");

  const loadDesigns = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.storage.from("photos").list(`${schoolId}/announce`, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
    const paths = (data ?? []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => `${schoolId}/announce/${f.name}`);
    if (!paths.length) return setDesigns([]);
    const { data: signed } = await supabase.storage.from("photos").createSignedUrls(paths, 3600);
    const list = (signed ?? []).filter((s) => s.signedUrl && s.path).map((s) => ({ path: s.path as string, url: s.signedUrl as string }));
    await Promise.all(
      list.map(
        (d) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              images.set(d.url, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = d.url;
          }),
      ),
    );
    setDesigns(list);
  }, [schoolId, images]);

  useEffect(() => {
    loadDesigns();
  }, [loadDesigns]);

  useEffect(() => {
    if (canvas.current) document.fonts.ready.then(() => canvas.current && drawAnnouncement(canvas.current, template, size, text, designs, images));
  }, [template, size, text, designs, images]);

  async function uploadDesign(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    const ext = file.type === "image/png" ? "png" : "jpg";
    await createClient().storage.from("photos").upload(`${schoolId}/announce/${crypto.randomUUID()}.${ext}`, file, { contentType: file.type });
    await loadDesigns();
    setBusy("");
  }

  async function make() {
    if (!canvas.current || (!text.ar.trim() && !text.en.trim())) return setError(t("needText"));
    setBusy("make");
    setError("");
    try {
      const supabase = createClient();
      const full = await new Promise<Blob>((r) => canvas.current!.toBlob((b) => r(b!), "image/jpeg", 0.92));
      const small = document.createElement("canvas");
      small.width = 480;
      small.height = Math.round((480 * canvas.current.height) / canvas.current.width);
      small.getContext("2d")!.drawImage(canvas.current, 0, 0, small.width, small.height);
      const thumb = await new Promise<Blob>((r) => small.toBlob((b) => r(b!), "image/jpeg", 0.85));
      const id = crypto.randomUUID();
      const path = `${schoolId}/${id}.jpg`;
      const opts = { contentType: "image/jpeg", upsert: false };
      const [a, b] = await Promise.all([supabase.storage.from("photos").upload(path, full, opts), supabase.storage.from("photos").upload(thumbPath(path), thumb, opts)]);
      if (a.error || b.error) throw new Error("upload");
      const { error: e } = await supabase.from("photos").insert({ id, school_id: schoolId, uploaded_by: userId, source: "design", storage_path: path, width: canvas.current.width, height: canvas.current.height, size_bytes: full.size, original_name: "announcement.jpg" });
      if (e) throw e;
      const caption = (s: string) => [s.trim(), text.details.trim()].filter(Boolean).join("\n");
      const r = await createAnnouncement(locale, { photoId: id, captionAr: caption(text.ar), captionEn: caption(text.en), category: category || null, day });
      if (!r.ok) throw new Error(r.error);
      router.push(`/posts/${r.id}`);
    } catch {
      setError(t("failed"));
      setBusy("");
    }
  }

  const field = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";
  const set = (k: keyof Text) => (e: { target: { value: string } }) => setText((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold">{t("pack")}</p>
          <div className="flex flex-wrap gap-2">
            {PACK.map((p) => (
              <button key={p} type="button" onClick={() => setTemplate(p)} className={`rounded-full px-3 py-1.5 text-sm ${template === p ? "bg-text text-surface font-semibold" : "bg-grey-bg"}`}>
                {t(`t.${p}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">{t("mine")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {designs.map((d) => (
              <button key={d.path} type="button" onClick={() => setTemplate(`design:${d.path}`)} className={`size-16 overflow-hidden rounded-lg border-2 ${template === `design:${d.path}` ? "border-accent" : "border-transparent"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                <img src={d.url} alt="" className="size-full object-cover" />
              </button>
            ))}
            <label className="cursor-pointer rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
              {busy === "upload" ? t("uploading") : t("uploadDesign")}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => uploadDesign(e.target.files?.[0])} />
            </label>
          </div>
          <p className="mt-1 text-xs text-muted">{t("mineHint")}</p>
        </div>
        <label className="block text-sm font-semibold">
          {t("headlineAr")}
          <textarea dir="rtl" rows={2} maxLength={120} className={field} value={text.ar} onChange={set("ar")} placeholder={t("headlineArPlaceholder")} />
        </label>
        <label className="block text-sm font-semibold">
          {t("headlineEn")}
          <textarea dir="ltr" rows={2} maxLength={120} className={field} value={text.en} onChange={set("en")} placeholder={t("headlineEnPlaceholder")} />
        </label>
        <label className="block text-sm font-semibold">
          {t("details")}
          <input className={field} maxLength={120} value={text.details} onChange={set("details")} placeholder={t("detailsPlaceholder")} />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block text-sm font-semibold">
            {t("size")}
            <select className={field} value={size} onChange={(e) => setSize(e.target.value as Size)}>
              <option value="post">{t("sizes.post")}</option>
              <option value="square">{t("sizes.square")}</option>
              <option value="story">{t("sizes.story")}</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">
            {t("colour")}
            <input type="color" className="block h-10 w-full rounded-lg" value={text.accent} onChange={set("accent")} />
          </label>
          <label className="block text-sm font-semibold">
            {t("ink")}
            <input type="color" className="block h-10 w-full rounded-lg" value={text.ink} onChange={set("ink")} />
          </label>
          <label className="block text-sm font-semibold">
            {t("category")}
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
        <button type="button" disabled={!!busy} onClick={make} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy === "make" ? t("making") : t("make")}
        </button>
      </div>
      <div>
        <canvas ref={canvas} className="w-full rounded-xl border border-border shadow-sm" />
        <p className="mt-2 text-xs text-muted">{t("previewHint")}</p>
      </div>
    </div>
  );
}

