"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { portalFinish, portalSlots } from "@/lib/actions/portal";
import { prepareImage } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";

type Status = "waiting" | "uploading" | "done" | "error";

const PARALLEL_UPLOADS = 3;

export function PortalUploader({ token }: { token: string }) {
  const t = useTranslations("portal");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Status[]>([]);
  const [closed, setClosed] = useState(false);
  const busy = items.some((s) => s === "waiting" || s === "uploading");

  const setStatus = (index: number, status: Status) =>
    setItems((all) => all.map((s, i) => (i === index ? status : s)));

  async function start(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 30);
    const offset = items.length;
    setItems((all) => [...all, ...list.map(() => "waiting" as Status)]);

    const slots = await portalSlots(token, list.length).catch(() => null);
    if (!slots) {
      setClosed(true);
      setItems((all) => all.map((s, i) => (i >= offset ? "error" : s)));
      return;
    }

    const bucket = createClient().storage.from("photos");
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const slot = slots[i];
        setStatus(offset + i, "uploading");
        try {
          const { full, thumb } = await prepareImage(list[i]);
          const options = { contentType: "image/jpeg" };
          const [a, b] = await Promise.all([
            bucket.uploadToSignedUrl(slot.path, slot.token, full.blob, options),
            bucket.uploadToSignedUrl(slot.thumb, slot.thumbToken, thumb.blob, options),
          ]);
          if (a.error || b.error) throw a.error ?? b.error;
          const ok = await portalFinish(
            token,
            { id: slot.id, width: full.width, height: full.height, size: full.blob.size, name: list[i].name },
            note,
          );
          setStatus(offset + i, ok ? "done" : "error");
        } catch {
          setStatus(offset + i, "error");
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
  }

  const done = items.filter((s) => s === "done").length;
  const failed = items.filter((s) => s === "error").length;

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("note")}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          disabled={busy}
          className="w-full rounded-lg border border-border bg-background px-3 py-2"
        />
      </label>
      <label
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-10 text-center ${
          busy ? "opacity-50" : "hover:border-accent"
        }`}
      >
        <span className="font-semibold">{t("choose")}</span>
        <span className="text-sm text-muted">{t("chooseHint")}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
          multiple
          disabled={busy || closed}
          className="sr-only"
          onChange={(e) => {
            start(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {items.length > 0 && (
        <p className="text-sm" aria-live="polite">
          {t("progress", { done, total: items.length })}
          {failed > 0 && <span className="text-danger"> · {t("failed", { count: failed })}</span>}
        </p>
      )}
      {closed && <p className="text-sm text-danger">{t("closed")}</p>}
    </div>
  );
}
