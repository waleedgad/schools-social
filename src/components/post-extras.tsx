"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";

// "Who's working on this": the names of the other people who have this post
// open right now (Supabase Realtime presence; nothing is stored). If live
// updates can't connect, nothing is shown.
export function PostPresence({ schoolId, postId, me, label }: { schoolId: string; postId: string; me: { id: string; name: string }; label: string }) {
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const channel = supabase.channel(`post:${schoolId}:${postId}`, { config: { presence: { key: me.id } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        const names = Object.entries(state)
          .filter(([key]) => key !== me.id)
          .map(([, metas]) => metas[0]?.name)
          .filter((n): n is string => !!n);
        setOthers([...new Set(names)]);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ name: me.name || "?" });
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [schoolId, postId, me.id, me.name]);
  if (!others.length) return null;
  return (
    <div role="status" className="rounded-lg border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn" data-testid="post-presence">
      {label.replace("{names}", others.join("، "))}
    </div>
  );
}

// Phone approval: swipe between the posts waiting for approval, or use the
// arrows. In Arabic the next post is to the left, as pages turn in Arabic.
export function SwipeNav({ prev, next, position, total, labels, rtl }: { prev: string | null; next: string | null; position: number; total: number; labels: { prev: string; next: string; of: string }; rtl: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest("input, textarea, select, [contenteditable], [data-no-swipe]");
    const down = (e: TouchEvent) => {
      start = e.touches.length === 1 && !typing(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const quick = Date.now() - start.t < 700;
      start = null;
      if (!quick || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2) return;
      // A swipe towards the start of the line shows the next post.
      const forward = rtl ? dx > 0 : dx < 0;
      const to = forward ? next : prev;
      if (to) router.push(`/posts/${to}`);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
    };
  }, [prev, next, rtl, router]);
  if (total < 2) return null;
  const arrow = "rounded-md border border-border px-3 py-1.5 text-sm";
  return (
    <nav className="flex items-center justify-between gap-2" aria-label={labels.of.replace("{n}", String(position)).replace("{total}", String(total))} data-testid="swipe-nav">
      {prev ? <Link href={`/posts/${prev}`} className={arrow} rel="prev">{rtl ? "→" : "←"} {labels.prev}</Link> : <span />}
      <span className="text-xs text-muted">{labels.of.replace("{n}", String(position)).replace("{total}", String(total))}</span>
      {next ? <Link href={`/posts/${next}`} className={arrow} rel="next">{labels.next} {rtl ? "←" : "→"}</Link> : <span />}
    </nav>
  );
}
