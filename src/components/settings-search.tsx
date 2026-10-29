"use client";

import { useState } from "react";

// Search across every setting: hides the list entries that don't match
// (each entry carries its own words, in both languages).
export function SettingsSearch({ placeholder, empty }: { placeholder: string; empty: string }) {
  const [q, setQ] = useState("");
  const [none, setNone] = useState(false);
  return (
    <>
      <input
        type="search"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          const words = v.toLowerCase().trim();
          let shown = 0;
          document.querySelectorAll<HTMLElement>("[data-set]").forEach((el) => {
            const ok = !words || (el.dataset.set ?? "").includes(words);
            el.style.display = ok ? "" : "none";
            if (ok) shown++;
          });
          setNone(shown === 0);
        }}
        className="mb-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm"
      />
      {none && <p className="px-2 py-1 text-xs text-muted">{empty}</p>}
    </>
  );
}
