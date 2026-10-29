"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link } from "@/i18n/navigation";
import { movePost } from "@/lib/actions/posts";
import { STATUS_TONE, type PostStatus } from "@/lib/posting";

export type CalDay = {
  key: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  events: { id: string; title: string; kind: string; photos: boolean; repeat: boolean }[];
  holiday: string | null;
  noPost: boolean;
  lastYear: { id: string; text: string }[];
  term: string | null;
  posts: { id: string; status: string; text: string; time: string | null; cover: string | null; color: string | null; category: string | null; categoryId: string | null; countdown: number | null }[];
  slots: { time: string; category: string | null; color: string | null }[];
};

const DOT: Record<string, string> = {
  grey: "bg-faint",
  accent: "bg-accent",
  good: "bg-good",
  warn: "bg-warn",
  danger: "bg-danger",
  violet: "bg-violet",
  info: "bg-info",
};

// Drag a post onto another day to move it (same time of day). Click an
// empty day or a dashed slot to start a post for that day.
export function CalendarGrid({ locale, days, weekdays, view, canWrite }: { locale: string; days: CalDay[]; weekdays: string[]; view: "month" | "week"; canWrite: boolean }) {
  const t = useTranslations("calendar");
  const ts = useTranslations("posts.status");
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const drop = (day: string, id: string) =>
    start(async () => {
      await movePost(locale, id, { day });
      router.refresh();
    });

  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-border ${pending ? "opacity-70" : ""}`}>
      <div className="hidden grid-cols-7 gap-px md:grid">
        {weekdays.map((w) => (
          <div key={w} className="bg-surface-2 px-2 py-1.5 text-center text-[11px] font-bold uppercase text-muted">
            {w}
          </div>
        ))}
      </div>
      <div className="grid gap-px md:grid-cols-7">
        {days.map((d) => (
          <div
            key={d.key}
            onDragOver={(e) => {
              if (!canWrite || d.past) return;
              e.preventDefault();
              setOver(d.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const id = e.dataTransfer.getData("text/post");
              if (id) drop(d.key, id);
            }}
            className={`group flex flex-col gap-1 p-1.5 ${view === "week" ? "min-h-72" : "min-h-28"} ${d.inMonth ? (d.noPost ? "bg-[repeating-linear-gradient(135deg,var(--surface),var(--surface)_6px,var(--surface-2)_6px,var(--surface-2)_12px)]" : "bg-surface") : "bg-surface-2 text-faint"} ${over === d.key ? "!bg-accent-bg" : ""} ${!d.inMonth && view === "month" ? "hidden md:flex" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${d.today ? "bg-accent text-accent-foreground" : ""}`}>{d.day}</span>
              <span className="text-[11px] text-muted md:hidden">{weekdays[(new Date(`${d.key}T00:00:00Z`).getUTCDay() + 1) % 7]}</span>
              {canWrite && !d.past && (
                <Link href={{ pathname: "/posts/new", query: { day: d.key } }} className="hidden size-5 place-items-center rounded text-faint hover:bg-accent-bg hover:text-accent group-hover:grid" aria-label={t("newOn")}>
                  +
                </Link>
              )}
            </div>
            {d.term && <span className="truncate rounded bg-info-bg px-1 text-[10px] font-semibold text-info">{d.term}</span>}
            {d.holiday && <span className="truncate rounded bg-grey-bg px-1 text-[10px] font-semibold text-muted">🏖 {d.holiday}</span>}
            {d.noPost && !d.holiday && d.inMonth && <span className="truncate text-[10px] text-faint">{t("noPostDay")}</span>}
            {d.events.map((e) => (
              <Link key={e.id} href={{ pathname: "/posts/new", query: { event: e.id } }} className={`truncate rounded px-1 text-[10px] font-semibold ${e.kind === "holiday" ? "bg-grey-bg text-muted" : e.kind === "occasion" ? "bg-violet-bg text-violet" : "bg-warn-bg text-warn"}`} title={t("eventHint")}>
                {e.photos && "📷 "}
                {e.repeat && "↻ "}
                {e.title}
              </Link>
            ))}
            {d.posts.map((p) => (
              <Link
                key={p.id}
                href={`/posts/${p.id}`}
                draggable={canWrite && !["published", "publishing"].includes(p.status)}
                onDragStart={(e) => e.dataTransfer.setData("text/post", p.id)}
                className="flex items-center gap-1 overflow-hidden rounded-md border border-border bg-surface-2 p-1 text-[11px] hover:border-accent"
                style={p.color ? { borderInlineStartColor: p.color, borderInlineStartWidth: 3 } : undefined}
                title={`${ts(p.status)}${p.category ? ` · ${p.category}` : ""}`}
              >
                {p.cover && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                  <img src={p.cover} alt="" className="size-6 shrink-0 rounded object-cover" />
                )}
                <span className={`size-1.5 shrink-0 rounded-full ${DOT[STATUS_TONE[p.status as PostStatus] ?? "grey"]}`} />
                <span className="min-w-0 truncate">
                  {p.time && <b className="me-1">{p.time}</b>}
                  {p.countdown != null && p.countdown > 0 && <span className="me-1 text-violet">⏳{p.countdown}</span>}
                  {p.text || ts(p.status)}
                </span>
              </Link>
            ))}
            {d.lastYear.map((x) => (
              <span key={x.id} className="truncate text-[10px] italic text-faint" title={x.text}>
                {t("lastYear")}: {x.text}
              </span>
            ))}
            {canWrite &&
              !d.past &&
              d.slots.map((s) => (
                <Link key={s.time} href={{ pathname: "/posts/new", query: { day: d.key } }} className="truncate rounded-md border border-dashed border-border px-1 py-0.5 text-[10px] text-faint hover:border-accent hover:text-accent">
                  {s.time} {s.category ?? t("freeSlot")}
                </Link>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
