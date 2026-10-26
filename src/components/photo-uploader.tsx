"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { prepareImage, thumbPath } from "@/lib/images";
import { createClient } from "@/lib/supabase/client";

type EventOption = { id: string; title: string; event_date: string };
type Status = "waiting" | "uploading" | "done" | "error";
type Item = { name: string; status: Status };

const PARALLEL_UPLOADS = 3;

export function PhotoUploader({
  schoolId,
  userId,
  events,
  defaultEventId,
}: {
  schoolId: string;
  userId: string;
  events: EventOption[];
  defaultEventId?: string;
}) {
  const t = useTranslations("upload");
  const router = useRouter();
  const [eventId, setEventId] = useState(defaultEventId ?? events[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [optedOut, setOptedOut] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const busy = items.some((i) => i.status === "waiting" || i.status === "uploading");

  const setStatus = (index: number, status: Status) =>
    setItems((all) => all.map((item, i) => (i === index ? { ...item, status } : item)));

  async function uploadOne(file: File, index: number) {
    const supabase = createClient();
    setStatus(index, "uploading");
    try {
      const { full, thumb } = await prepareImage(file);
      const id = crypto.randomUUID();
      const path = `${schoolId}/${id}.jpg`;

      const options = { contentType: "image/jpeg", upsert: false };
      const [a, b] = await Promise.all([
        supabase.storage.from("photos").upload(path, full.blob, options),
        supabase.storage.from("photos").upload(thumbPath(path), thumb.blob, options),
      ]);
      if (a.error || b.error) throw a.error ?? b.error;

      const { error } = await supabase.from("photos").insert({
        id,
        school_id: schoolId,
        event_id: eventId || null,
        uploaded_by: userId,
        source: "staff",
        storage_path: path,
        width: full.width,
        height: full.height,
        size_bytes: full.blob.size,
        note: note.trim() || null,
        contains_opted_out: optedOut,
      });
      if (error) throw error;
      setStatus(index, "done");
    } catch {
      setStatus(index, "error");
    }
  }

  async function start(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const offset = items.length;
    setItems((all) => [...all, ...list.map((f) => ({ name: f.name, status: "waiting" as Status }))]);

    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        await uploadOne(list[i], offset + i);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
    router.refresh();
  }

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("event")}</span>
        <select
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          disabled={busy}
          className="w-full rounded-lg border border-border bg-background px-3 py-2"
        >
          <option value="">{t("noEvent")}</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {e.event_date}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold">{t("note")}</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          placeholder={t("notePlaceholder")}
          disabled={busy}
          className="w-full rounded-lg border border-border bg-background px-3 py-2"
        />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={optedOut}
          onChange={(e) => setOptedOut(e.target.checked)}
          disabled={busy}
          className="mt-1"
        />
        <span>{t("optedOut")}</span>
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
          disabled={busy}
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
    </div>
  );
}
