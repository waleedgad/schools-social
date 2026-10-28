"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addFrame } from "@/lib/actions/brand";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui";

// Frames and logo corners are PNGs with a see-through middle, laid over
// the photo when it is shaped for posting.
export function FrameUploader({ locale, schoolId }: { locale: string; schoolId: string }) {
  const t = useTranslations("brandPage");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const file = f.get("file") as File | null;
        if (!file || !file.size || file.type !== "image/png") return setState("error");
        setState("busy");
        const path = `${schoolId}/frames/${crypto.randomUUID()}.png`;
        const { error } = await createClient().storage.from("photos").upload(path, file, { contentType: "image/png" });
        const r = error ? { ok: false } : await addFrame(locale, String(f.get("name") ?? file.name), path, f.get("kind") === "logo" ? "logo" : "frame", String(f.get("shape")));
        setState(r.ok ? "idle" : "error");
        if (r.ok) {
          (e.target as HTMLFormElement).reset();
          router.refresh();
        }
      }}
    >
      <input name="file" type="file" accept="image/png" required className="text-sm" />
      <input name="name" placeholder={t("frameName")} maxLength={60} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
      <select name="shape" className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm">
        <option value="4:5">4:5</option>
        <option value="1:1">1:1</option>
        <option value="9:16">9:16</option>
      </select>
      <Button disabled={state === "busy"}>{state === "busy" ? t("uploading") : t("addFrame")}</Button>
      <input type="hidden" name="kind" value="frame" />
      {state === "error" && <p className="text-xs text-danger sm:col-span-4">{t("frameError")}</p>}
    </form>
  );
}
