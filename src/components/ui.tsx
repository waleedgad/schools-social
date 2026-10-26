import type { ComponentProps, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-6 ${className}`}>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <input
        {...input}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent"
      />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  ...select
}: { label: string } & ComponentProps<"select">) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <select
        {...select}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent"
      >
        {children}
      </select>
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...button
}: { variant?: "primary" | "quiet" | "danger" } & ComponentProps<"button">) {
  const styles = {
    primary: "bg-accent text-accent-foreground hover:opacity-90",
    quiet: "border border-border hover:bg-background",
    danger: "text-danger hover:underline",
  }[variant];
  return (
    <button
      {...button}
      className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Notice({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "info" }) {
  const styles = tone === "danger" ? "border-danger text-danger" : "border-border text-muted";
  return <p className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</p>;
}
