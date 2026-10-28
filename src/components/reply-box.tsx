"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { sendReply, suggestReplies } from "@/lib/actions/inbox";
import { Button } from "./ui";

// AI suggests three replies; the person picks or edits one and sends it.
export function ReplyBox({ locale, platform, comment, text, postText }: { locale: string; platform: string; comment: string; text: string; postText: string }) {
  const t = useTranslations("inbox");
  const [value, setValue] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form action={sendReply} className="space-y-1.5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="comment" value={comment} />
      {ideas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ideas.map((r, i) => (
            <button type="button" key={i} onClick={() => setValue(r)} className="rounded-full bg-accent-bg px-2 py-0.5 text-start text-[11px] text-accent-ink" dir="auto">
              {r}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input name="message" value={value} onChange={(e) => setValue(e.target.value)} required maxLength={1000} placeholder={t("replyPlaceholder")} dir="auto" className="min-w-0 grow rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm" />
        <Button
          type="button"
          variant="quiet"
          icon="sparkle"
          disabled={busy}
          className="!px-2"
          title={t("suggest")}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const r = await suggestReplies(locale, text, postText);
            setBusy(false);
            if (r.replies) setIdeas(r.replies);
            else setErr(t("aiError"));
          }}
        />
        <Button className="!px-3">{t("send")}</Button>
      </div>
      {err && <p className="text-[11px] text-danger">{err}</p>}
    </form>
  );
}
