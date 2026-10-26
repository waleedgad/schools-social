"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { clearEdit, saveEdit } from "@/lib/actions/library";
import { thumbPath } from "@/lib/images";
import { autoSettings, CROPS, NO_EDIT, render, type Crop, type EditSettings } from "@/lib/photo-edit";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui";

const SLIDERS = [
  { key: "exposure", min: -1, max: 1 },
  { key: "contrast", min: -1, max: 1 },
  { key: "saturation", min: -1, max: 1 },
  { key: "warmth", min: -1, max: 1 },
] as const;

function toBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
}

export function PhotoEditor({
  locale,
  photoId,
  schoolId,
  imageUrl,
  initial,
  hasEdit,
}: {
  locale: string;
  photoId: string;
  schoolId: string;
  imageUrl: string;
  initial: EditSettings | null;
  hasEdit: boolean;
}) {
  const t = useTranslations("editor");
  const router = useRouter();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [settings, setSettings] = useState<EditSettings>(initial ?? NO_EDIT);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved" | "error">("loading");
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(imageUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (cancelled) return;
        setBitmap(bmp);
        setState("ready");
      })
      .catch(() => setState("error"));
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!bitmap || !preview.current) return;
    const frame = requestAnimationFrame(() => {
      const canvas = render(bitmap, settings, 900);
      canvas.className = "mx-auto max-h-[70vh] w-auto max-w-full rounded-lg";
      preview.current?.replaceChildren(canvas);
    });
    return () => cancelAnimationFrame(frame);
  }, [bitmap, settings]);

  const set = <K extends keyof EditSettings>(key: K, value: EditSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  async function save() {
    if (!bitmap) return;
    setState("saving");
    try {
      const supabase = createClient();
      const path = `${schoolId}/${photoId}_e${Date.now()}.jpg`;
      const full = await toBlob(render(bitmap, settings, 2048), 0.88);
      const thumb = await toBlob(render(bitmap, settings, 480), 0.75);
      const options = { contentType: "image/jpeg", upsert: false };
      const [a, b] = await Promise.all([
        supabase.storage.from("photos").upload(path, full, options),
        supabase.storage.from("photos").upload(thumbPath(path), thumb, options),
      ]);
      if (a.error || b.error) throw a.error ?? b.error;
      await saveEdit(locale, photoId, path, settings);
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  async function reset() {
    setSettings(NO_EDIT);
    if (hasEdit) {
      await clearEdit(locale, photoId);
      router.refresh();
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
      <div ref={preview} className="min-h-64 rounded-xl border border-border bg-surface p-2">
        {state === "loading" && <p className="p-6 text-center text-muted">{t("loading")}</p>}
      </div>
      <div className="space-y-4">
        <Button variant="quiet" className="w-full" disabled={!bitmap} onClick={() => bitmap && setSettings(autoSettings(bitmap))}>
          {t("auto")}
        </Button>
        {SLIDERS.map((s) => (
          <label key={s.key} className="block space-y-1 text-sm">
            <span className="flex justify-between font-semibold">
              {t(s.key)} <span className="text-muted">{Math.round(settings[s.key] * 100)}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={0.01}
              value={settings[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="w-full"
            />
          </label>
        ))}
        <div className="space-y-1 text-sm">
          <span className="font-semibold">{t("crop")}</span>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CROPS) as Crop[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("crop", c)}
                className={`rounded-lg border px-2 py-1 ${settings.crop === c ? "border-accent font-semibold" : "border-border"}`}
              >
                {t(`crops.${c}`)}
              </button>
            ))}
          </div>
        </div>
        {settings.crop !== "original" && (
          <label className="block space-y-1 text-sm">
            <span className="font-semibold">{t("position")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.position}
              onChange={(e) => set("position", Number(e.target.value))}
              className="w-full"
            />
          </label>
        )}
        <Button className="w-full" disabled={!bitmap || state === "saving"} onClick={save}>
          {state === "saving" ? t("saving") : t("save")}
        </Button>
        <Button variant="quiet" className="w-full" onClick={reset}>
          {t("reset")}
        </Button>
        {state === "saved" && <p className="text-sm text-muted">{t("saved")}</p>}
        {state === "error" && <p className="text-sm text-danger">{t("error")}</p>}
        <p className="text-xs text-muted">{t("originalKept")}</p>
      </div>
    </div>
  );
}
