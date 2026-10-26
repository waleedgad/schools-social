"use client";

import { useState } from "react";

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

export function LocalTime({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>;
}
