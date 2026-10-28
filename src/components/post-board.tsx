"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link } from "@/i18n/navigation";
import { createPost, movePost, spreadPosts } from "@/lib/actions/posts";
import { BOARD, STATUS_TONE, type PostStatus } from "@/lib/posting";
import { Icon } from "./icons";
import { Button, Chip } from "./ui";

export type BoardPost = {
  id: string;
  status: string;
  text: string;
  when: string | null;
  due: string | null;
  cover: string | null;
  photos: number;
  urgent: boolean;
  sensitive: boolean;
  category: { name: string; color: string } | null;
  mine: boolean;
};

type Labels = {
  columns: Record<string, string>;
  status: Record<string, string>;
} & Record<"noCaption" | "urgent" | "sensitive" | "due" | "empty" | "addIdea" | "ideaPlaceholder" | "save" | "spread" | "selected" | "photos" | "gridHint" | "moved" | "moveFailed", string>;

// Only these columns accept a dropped card; approval and posting happen
// through the post itself, so the approval rules always apply.
const DROPPABLE = new Set(["idea", "draft", "waiting"]);
const DROP_STATUS: Record<string, string> = { idea: "idea", draft: "draft", waiting: "in_review" };

function when(iso: string | null, locale: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function Card({ p, locale, labels, picked, onPick }: { p: BoardPost; locale: string; labels: Labels; picked: boolean; onPick?: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/post", p.id)}
      className="group relative rounded-lg border border-border bg-surface p-2.5 shadow-sm transition hover:border-accent"
    >
      {onPick && (
        <input
          type="checkbox"
          checked={picked}
          onChange={onPick}
          className="absolute end-2 top-2 z-10 opacity-0 group-hover:opacity-100 checked:opacity-100"
          aria-label={labels.selected}
        />
      )}
      <Link href={`/posts/${p.id}`} className="block space-y-2">
        {p.cover && (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
          <img src={p.cover} alt="" className="aspect-[4/3] w-full rounded-md object-cover" />
        )}
        <p className="line-clamp-3 text-sm">{p.text || <span className="text-muted">{labels.noCaption}</span>}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {p.category && (
            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold" style={{ background: `${p.category.color}22`, color: p.category.color }}>
              {p.category.name}
            </span>
          )}
          {p.status !== "idea" && <Chip tone={STATUS_TONE[p.status as PostStatus] ?? "grey"}>{labels.status[p.status]}</Chip>}
          {p.urgent && <Chip tone="danger">{labels.urgent}</Chip>}
          {p.sensitive && <Chip tone="warn">{labels.sensitive}</Chip>}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            {p.when ? (
              <>
                <Icon name="clock" size={12} />
                {when(p.when, locale)}
              </>
            ) : p.due ? (
              `${labels.due} ${p.due}`
            ) : null}
          </span>
          {p.photos > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="library" size={12} />
              {p.photos}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}

export function PostBoard({ locale, view, posts, labels, canWrite, startIdea }: { locale: string; view: "board" | "list" | "grid"; posts: BoardPost[]; labels: Labels; canWrite: boolean; startIdea?: boolean }) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(!!startIdea);
  const [, start] = useTransition();
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const drop = (column: string, id: string) => {
    if (!DROPPABLE.has(column)) return;
    start(async () => {
      const r = await movePost(locale, id, { status: DROP_STATUS[column] });
      setNote(r.ok ? labels.moved : labels.moveFailed);
      router.refresh();
    });
  };

  const spreadBar = picked.size > 0 && (
    <form action={spreadPosts} className="sticky bottom-3 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 shadow-lg">
      <input type="hidden" name="locale" value={locale} />
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="post" value={id} />
      ))}
      <span className="text-sm font-semibold">
        {picked.size} {labels.selected}
      </span>
      <Button icon="calendar">{labels.spread}</Button>
    </form>
  );

  if (view === "grid") {
    // Instagram profile preview: newest first, scheduled ones on top.
    const grid = posts
      .filter((p) => ["approved", "scheduled", "publishing", "published"].includes(p.status) && p.cover)
      .sort((a, b) => Date.parse(b.when ?? "") - Date.parse(a.when ?? ""));
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{labels.gridHint}</p>
        <div className="mx-auto grid max-w-md grid-cols-3 gap-0.5 overflow-hidden rounded-xl border border-border bg-border">
          {grid.map((p) => (
            <Link key={p.id} href={`/posts/${p.id}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
              <img src={p.cover!} alt="" className={`aspect-[4/5] w-full object-cover ${p.status === "published" ? "" : "opacity-80"}`} />
              {p.status !== "published" && <span className="absolute start-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{when(p.when, locale)}</span>}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="space-y-2">
        {note && <p className="text-xs text-muted">{note}</p>}
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {posts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-2.5">
              {canWrite && <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={labels.selected} />}
              {p.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly
                <img src={p.cover} alt="" className="size-12 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-md bg-background text-faint">
                  <Icon name={p.status === "idea" ? "ideas" : "posts"} />
                </span>
              )}
              <Link href={`/posts/${p.id}`} className="min-w-0 grow">
                <p className="truncate text-sm">{p.text || labels.noCaption}</p>
                <p className="text-xs text-muted">{when(p.when, locale) ?? (p.due ? `${labels.due} ${p.due}` : "")}</p>
              </Link>
              {p.category && <span className="hidden size-2 rounded-full sm:block" style={{ background: p.category.color }} title={p.category.name} />}
              <Chip tone={STATUS_TONE[p.status as PostStatus] ?? "grey"}>{labels.status[p.status]}</Chip>
            </li>
          ))}
        </ul>
        {spreadBar}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {note && <p className="text-xs text-muted">{note}</p>}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {BOARD.map((col) => {
          const cards = posts.filter((p) => (col.statuses as string[]).includes(p.status));
          return (
            <section
              key={col.key}
              onDragOver={(e) => {
                if (DROPPABLE.has(col.key)) {
                  e.preventDefault();
                  setOver(col.key);
                }
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                drop(col.key, e.dataTransfer.getData("text/post"));
              }}
              className={`flex w-64 shrink-0 snap-start flex-col gap-2 rounded-xl border p-2 md:w-auto ${over === col.key ? "border-accent bg-accent-bg/40" : "border-transparent bg-surface-2"}`}
            >
              <header className="flex items-center justify-between px-1 pt-1 text-xs font-bold uppercase tracking-wide text-muted">
                {labels.columns[col.key]}
                <span className="rounded-full bg-background px-1.5">{cards.length}</span>
              </header>
              {col.key === "idea" && canWrite && (
                adding ? (
                  <form action={createPost} className="space-y-1.5 rounded-lg border border-border bg-surface p-2">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="kind" value="idea" />
                    <textarea name="idea" rows={3} required autoFocus maxLength={1000} placeholder={labels.ideaPlaceholder} className="w-full rounded-md border border-border bg-surface-2 p-2 text-sm outline-none focus:border-accent" />
                    <input type="date" name="day" className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs" />
                    <Button className="w-full !py-1.5">{labels.save}</Button>
                  </form>
                ) : (
                  <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs text-muted hover:border-accent hover:text-accent">
                    <Icon name="plus" size={14} /> {labels.addIdea}
                  </button>
                )
              )}
              {cards.map((p) => (
                <Card key={p.id} p={p} locale={locale} labels={labels} picked={picked.has(p.id)} onPick={canWrite && col.key !== "posted" ? () => toggle(p.id) : undefined} />
              ))}
              {!cards.length && <p className="px-1 py-4 text-center text-xs text-faint">{labels.empty}</p>}
            </section>
          );
        })}
      </div>
      {spreadBar}
    </div>
  );
}
