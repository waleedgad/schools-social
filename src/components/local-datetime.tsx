"use client";

import { useLocale } from "next-intl";
import { useEffect, useState } from "react";

// datetime-local has no time zone, so send the moment as ISO from the
// person's own device clock.
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LocalDateTime({ name, label, value, disabled }: { name: string; label: string; value: string | null; disabled?: boolean }) {
  const [local, setLocal] = useState(toLocalInput(value));
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type="datetime-local"
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
      />
      <input type="hidden" name={name} value={local ? new Date(local).toISOString() : ""} />
    </label>
  );
}

// A moment in the reader's own time zone and language. The server doesn't
// know the reader's time zone, so it draws the date in UTC and the browser
// redraws it after the page is ready (the same text on both sides first,
// or the page is thrown away and drawn again).
export function LocalTime({ iso, options, lang }: { iso: string; options?: Intl.DateTimeFormatOptions; lang?: string }) {
  const current = useLocale();
  const locale = lang ?? current;
  const fmt = (timeZone?: string) => new Date(iso).toLocaleString(locale, { ...(options ?? { dateStyle: "medium", timeStyle: "short" }), timeZone });
  const [text, setText] = useState(() => fmt("UTC"));
  useEffect(() => setText(fmt()), [iso, locale, JSON.stringify(options)]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso}>{text}</time>;
}
