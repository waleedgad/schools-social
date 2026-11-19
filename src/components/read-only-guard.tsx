"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Read-only school: every button and field that would change something is
// greyed out with the reason. Forms that only look things up (method="get",
// or marked data-read-ok) keep working. The database refuses the change
// anyway; this only saves people from pressing buttons that can't work.
export function ReadOnlyGuard({ reason, children }: { reason: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const lock = () => {
      const controls = root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "form button, form input, form select, form textarea, input[type=file], [data-write]",
      );
      for (const el of controls) {
        const form = el.closest("form");
        if (el.closest("[data-read-ok]")) continue;
        if (form && (form.getAttribute("method") ?? "").toLowerCase() === "get") continue;
        if (el instanceof HTMLInputElement && el.type === "hidden") continue;
        if (el.disabled && el.dataset.readOnly !== "1") continue;
        el.disabled = true;
        el.dataset.readOnly = "1";
        el.title = reason;
      }
    };
    lock();
    const watch = new MutationObserver(lock);
    watch.observe(root, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [reason]);
  return (
    <div ref={box} data-read-only="true">
      {children}
    </div>
  );
}
