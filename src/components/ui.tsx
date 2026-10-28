import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Icon, type IconName } from "./icons";

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Field({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <input {...input} className={`${inputClass} ${input.className ?? ""}`} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, hint, ...area }: { label: string; hint?: ReactNode } & ComponentProps<"textarea">) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <textarea {...area} className={`${inputClass} ${area.className ?? ""}`} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, hint, ...select }: { label: string; hint?: string } & ComponentProps<"select">) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <select {...select} className={`${inputClass} ${select.className ?? ""}`}>
        {children}
      </select>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, hint, ...input }: { label: ReactNode; hint?: ReactNode } & ComponentProps<"input">) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" {...input} className="peer sr-only" />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-grey-bg transition peer-checked:bg-accent after:absolute after:start-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

const BUTTON = {
  primary: "bg-accent text-accent-foreground shadow-sm hover:opacity-90",
  quiet: "border border-border bg-surface hover:bg-background",
  ghost: "hover:bg-background",
  danger: "text-danger hover:bg-danger-bg",
  good: "bg-good text-white hover:opacity-90",
};

export function Button({
  variant = "primary",
  className = "",
  icon,
  children,
  ...button
}: { variant?: keyof typeof BUTTON; icon?: IconName } & ComponentProps<"button">) {
  return (
    <button
      {...button}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "quiet",
  icon,
  children,
  className = "",
}: {
  href: ComponentProps<typeof Link>["href"];
  variant?: keyof typeof BUTTON;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${BUTTON[variant]} ${className}`}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

const TONES = {
  danger: "border-danger/30 bg-danger-bg text-danger",
  info: "border-border bg-surface-2 text-muted",
  good: "border-good/30 bg-good-bg text-good",
  warn: "border-warn/30 bg-warn-bg text-warn",
};

export function Notice({ children, tone = "danger" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <div className={`rounded-lg border px-3 py-2 text-sm ${TONES[tone]}`}>{children}</div>;
}

const CHIP = {
  grey: "bg-grey-bg text-foreground/80",
  accent: "bg-accent-bg text-accent-ink",
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  violet: "bg-violet-bg text-violet",
  info: "bg-info-bg text-info",
};
export type ChipTone = keyof typeof CHIP;

export function Chip({ children, tone = "grey", className = "" }: { children: ReactNode; tone?: ChipTone; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[tone]} ${className}`}>{children}</span>;
}

export function Empty({ icon = "sparkle", title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-accent-bg text-accent-ink">
        <Icon name={icon} size={20} />
      </span>
      <b>{title}</b>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, change, hint }: { label: string; value: ReactNode; change?: number | null; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {typeof change === "number" && (
        <div className={`mt-1 text-xs font-semibold ${change >= 0 ? "text-good" : "text-danger"}`}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(change))}%{hint ? ` ${hint}` : ""}
        </div>
      )}
    </div>
  );
}

// Pill filters instead of dropdowns.
export function Pills({ items }: { items: { label: ReactNode; href: ComponentProps<typeof Link>["href"]; on: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i, n) => (
        <Link
          key={n}
          href={i.href}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            i.on ? "border-accent bg-accent-bg text-accent-ink" : "border-border bg-surface hover:bg-background"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
