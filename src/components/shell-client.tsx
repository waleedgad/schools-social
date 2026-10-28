"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { switchSchool } from "@/lib/actions/workspace";
import { Icon } from "./icons";

type Command = { label: string; href: string; group: string };

function typingInField(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

// Cmd/Ctrl+K: jump to any screen or action by typing.
export function CommandPalette({ commands, placeholder, label }: { commands: Command[]; placeholder: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typingInField(e)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
  }, [q, commands]);

  const go = (c?: Command) => {
    if (!c) return;
    setOpen(false);
    router.push(c.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-0.5 mb-1.5 flex items-center gap-2 rounded-lg bg-background px-2 py-1.5 text-start text-xs text-muted"
      >
        <Icon name="search" size={14} />
        <span className="grow">{label}</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/30 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="fade-in mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Icon name="search" className="text-faint" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setAt(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setAt((a) => Math.min(a + 1, shown.length - 1));
                  if (e.key === "ArrowUp") setAt((a) => Math.max(a - 1, 0));
                  if (e.key === "Enter") go(shown[at]);
                }}
                placeholder={placeholder}
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
              <kbd>esc</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {shown.map((c, i) => (
                <li key={c.href + c.label}>
                  <button
                    type="button"
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(c)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm ${i === at ? "bg-accent-bg text-accent-ink" : ""}`}
                  >
                    <span>{c.label}</span>
                    <span className="text-xs text-faint">{c.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

// Single-key shortcuts. "G" then a letter jumps to a screen, "?" shows them all.
export function Shortcuts({ canPost, title, items }: { canPost: boolean; title: string; items: [string, string][] }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let g = 0;
    const jumps: Record<string, string> = { t: "/today", p: "/posts", c: "/calendar", l: "/library", a: "/analytics", s: "/students", i: "/inbox" };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      const k = e.key.toLowerCase();
      if (Date.now() - g < 1200 && jumps[k]) {
        g = 0;
        router.push(jumps[k]);
        return;
      }
      if (k === "g") g = Date.now();
      else if (k === "n" && canPost) router.push("/posts/new");
      else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, canPost]);
  if (!help) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={() => setHelp(false)}>
      <div className="fade-in w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 flex items-center gap-2 font-bold">
          <Icon name="keyboard" />
          {title}
        </h2>
        <ul className="space-y-1.5 text-sm">
          {items.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between gap-3">
              <span>{label}</span>
              <span className="flex gap-1">
                {k.split(" ").map((p) => (
                  <kbd key={p}>{p}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Light, dark, or follow the device. Saved on this device only.
export function ThemeToggle({ labels }: { labels: { light: string; dark: string; auto: string } }) {
  const [mode, setMode] = useState<"auto" | "light" | "dark">("auto");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") setMode(saved);
    } catch {
      // private mode: stay on auto
    }
  }, []);
  const next = () => {
    const m = mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto";
    setMode(m);
    try {
      if (m === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", m);
    } catch {
      // ignore
    }
    if (m === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", m);
  };
  return (
    <button type="button" onClick={next} title={labels[mode]} className="rounded-md p-1.5 text-muted hover:bg-background">
      <Icon name={mode === "dark" ? "moon" : mode === "light" ? "sun" : "today"} />
    </button>
  );
}

export function MobileNavToggle({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1.5 hover:bg-background md:hidden"
      onClick={() => {
        const side = document.getElementById("side");
        if (!side) return;
        const open = side.dataset.open === "true";
        side.dataset.open = open ? "false" : "true";
        if (!open) {
          const close = (e: MouseEvent) => {
            if (!side.contains(e.target as Node)) {
              side.dataset.open = "false";
              document.removeEventListener("click", close, true);
            }
          };
          setTimeout(() => document.addEventListener("click", close, true), 0);
        }
      }}
    >
      <Icon name="menu" size={18} />
    </button>
  );
}

export function WorkspaceSwitcher({ current, workspaces, label }: { current: string; workspaces: { id: string; name: string }[]; label: string }) {
  return (
    <form action={switchSchool} className="mx-0.5 mb-1.5">
      <label className="sr-only" htmlFor="ws">{label}</label>
      <select
        id="ws"
        name="school"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </form>
  );
}
