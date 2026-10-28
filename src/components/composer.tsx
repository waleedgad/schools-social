"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { aiCheck, aiRewrite, aiTranslate, addComment, createReviewLink, generateCaptions, postAction, restoreVersion, pickVariation } from "@/lib/actions/posts";
import { saveEdit } from "@/lib/actions/library";
import type { CaptionCheck, Captions } from "@/lib/ai/types";
import { thumbPath } from "@/lib/images";
import { CROPS, NO_EDIT, render, type EditSettings } from "@/lib/photo-edit";
import { LIMITS, MORE_AFTER, type PostStatus } from "@/lib/posting";
import { createClient } from "@/lib/supabase/client";
import { LocalDateTime } from "./local-datetime";
import { Icon } from "./icons";
import { Button, Card, Chip, Toggle } from "./ui";

type Photo = { id: string; thumb: string; full: string; storagePath: string; width: number | null; height: number | null; crop: string; waiting: boolean; issues: string[]; settings: EditSettings | null };

export type ComposerData = {
  locale: string;
  schoolName: string;
  pageName: string;
  igName: string;
  connected: boolean;
  accountsPaused: { facebook: boolean; instagram: boolean };
  schoolPaused: boolean;
  post: {
    id: string;
    status: PostStatus;
    idea: string | null;
    caption_ar: string;
    caption_en: string;
    caption_ig: string;
    hashtags: string;
    first_comment: string;
    location: string;
    platforms: string[];
    sensitive: boolean;
    make_story: boolean;
    urgent: boolean;
    category_id: string | null;
    frame_id: string | null;
    scheduled_at: string | null;
    review_note: string | null;
    publish_error: string | null;
    published_at: string | null;
    fb_post_id: string | null;
    ig_media_id: string | null;
    alt_ar: string;
    alt_en: string;
    variations: Captions[];
  };
  photos: Photo[];
  more: { id: string; thumb: string; score: number | null }[];
  checks: { level: "block" | "warn"; text: string }[];
  categories: { id: string; name: string; color: string; hashtags: string; frame_id: string | null }[];
  frames: { id: string; name: string; kind: string; url: string; shape: string }[];
  snippets: { id: string; kind: string; title: string; body: string }[];
  comments: { id: string; author: string; kind: string; body: string; at: string; mine: boolean }[];
  versions: { id: number; text: string; at: string }[];
  links: { token: string; label: string; answer: string | null; comment: string | null; expired: boolean }[];
  people: { name: string; role: string }[];
  photoLimit: number;
  languages: "ar" | "en" | "ar_en";
  can: { write: boolean; approve: boolean; approveAny: boolean; extra: boolean; urgent: boolean; publish: boolean };
  openGenerator: boolean;
  tab: string | null;
  newLink: string | null;
};

const area = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";
const REWRITES = ["shorter", "longer", "warmer", "formal", "emoji", "fixSpelling"] as const;

function ratioOf(p: Photo) {
  const c = CROPS[p.crop as keyof typeof CROPS];
  if (c) return c;
  return p.width && p.height ? p.width / p.height : 1;
}

// A caption field with its own AI buttons (rewrite, translate) and a
// character count that warns where the platform cuts the text off.
function CaptionField({ label, value, onChange, dir, lang, other, disabled, locale, limit }: { label: string; value: string; onChange: (v: string) => void; dir: "rtl" | "ltr"; lang: "ar" | "en"; other: string; disabled: boolean; locale: string; limit: number }) {
  const t = useTranslations("composer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<{ text?: string; error?: string }>) => {
    setBusy(true);
    setErr(null);
    const r = await f();
    setBusy(false);
    if (r.text) onChange(r.text);
    else setErr(t(r.error === "limit" ? "aiLimit" : "aiFailed"));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        {!disabled && (
          <div className="flex flex-wrap gap-1">
            {other.trim() && (
              <button type="button" disabled={busy} onClick={() => run(() => aiTranslate(locale, other, lang))} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-background">
                {t("translateFrom")}
              </button>
            )}
            {value.trim() && (
              <select
                disabled={busy}
                value=""
                onChange={(e) => e.target.value && run(() => aiRewrite(locale, value, e.target.value, lang))}
                className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                aria-label={t("rewrite")}
              >
                <option value="">✨ {t("rewrite")}</option>
                {REWRITES.map((r) => (
                  <option key={r} value={t(`rewrites.${r}.prompt`)}>
                    {t(`rewrites.${r}.label`)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} dir={dir} rows={6} maxLength={limit} disabled={disabled || busy} className={`${area} ${busy ? "skeleton" : ""}`} />
      <div className="flex justify-between text-[11px] text-muted">
        <span>{err}</span>
        <span className={value.length > limit * 0.95 ? "text-danger" : ""}>
          {value.length}/{limit}
        </span>
      </div>
    </div>
  );
}

function Preview({ data, platform, caption, photos }: { data: ComposerData; platform: "facebook" | "instagram"; caption: string; photos: Photo[] }) {
  const t = useTranslations("composer");
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const cut = MORE_AFTER[platform];
  const shown = open || caption.length <= cut ? caption : caption.slice(0, cut).trimEnd();
  const cover = photos[Math.min(i, photos.length - 1)];
  const name = platform === "facebook" ? data.pageName : data.igName;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <span className="grid size-8 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">{data.schoolName.slice(0, 2)}</span>
        <div className="leading-tight">
          <b className="block text-[13px]">{name}</b>
          <span className="text-[11px] text-muted">{platform === "facebook" ? t("preview.justNow") : t("preview.sponsoredNot")}</span>
        </div>
      </div>
      {platform === "facebook" && caption && (
        <p className="whitespace-pre-wrap px-3 pb-2 text-[13px]" dir="auto">
          {shown}
          {shown !== caption && (
            <button className="font-semibold text-muted" onClick={() => setOpen(true)}>
              … {t("preview.more")}
            </button>
          )}
        </p>
      )}
      {cover ? (
        <div className="relative bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
          <img src={cover.thumb} alt="" className={`w-full ${platform === "instagram" ? "aspect-[4/5] object-cover" : "max-h-96 object-contain"}`} />
          {photos.length > 1 && (
            <>
              <span className="absolute end-2 top-2 rounded-full bg-black/60 px-2 text-[11px] text-white">
                {Math.min(i, photos.length - 1) + 1}/{photos.length}
              </span>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {photos.slice(0, 20).map((p, n) => (
                  <button key={p.id} onClick={() => setI(n)} className={`size-1.5 rounded-full ${n === i ? "bg-white" : "bg-white/50"}`} aria-label={String(n + 1)} />
                ))}
              </div>
            </>
          )}
          {platform === "instagram" && cover && ratioOf(cover) < 0.79 && <span className="absolute start-2 top-2 rounded bg-danger px-1.5 text-[11px] text-white">{t("preview.wrongShape")}</span>}
        </div>
      ) : (
        platform === "instagram" && <div className="grid aspect-[4/5] place-items-center bg-background text-xs text-muted">{t("preview.needsPhoto")}</div>
      )}
      {platform === "instagram" && (
        <p className="whitespace-pre-wrap p-3 text-[13px]" dir="auto">
          <b>{name}</b> {shown}
          {shown !== caption && (
            <button className="text-muted" onClick={() => setOpen(true)}>
              … {t("preview.more")}
            </button>
          )}
        </p>
      )}
      <div className="flex gap-4 border-t border-border px-3 py-2 text-[12px] text-muted">
        <span>♡ {t("preview.like")}</span>
        <span>💬 {t("preview.comment")}</span>
        <span>↗ {t("preview.share")}</span>
      </div>
    </div>
  );
}

export function Composer({ data }: { data: ComposerData }) {
  const t = useTranslations("composer");
  const tp = useTranslations("posts");
  const router = useRouter();
  const p = data.post;
  const locked = p.status === "publishing" || p.status === "published";
  const readOnly = locked || !data.can.write;

  const [ar, setAr] = useState(p.caption_ar);
  const [en, setEn] = useState(p.caption_en);
  const [ig, setIg] = useState(p.caption_ig);
  const [splitIg, setSplitIg] = useState(!!p.caption_ig);
  const [tags, setTags] = useState(p.hashtags);
  const [firstComment, setFirstComment] = useState(p.first_comment);
  const [platforms, setPlatforms] = useState<string[]>(p.platforms);
  const [category, setCategory] = useState(p.category_id ?? "");
  const [frame, setFrame] = useState(p.frame_id ?? "");
  const [photos, setPhotos] = useState<Photo[]>(data.photos);
  const [photosChanged, setPhotosChanged] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<number | null>(null);
  const [view, setView] = useState<"facebook" | "instagram">(p.platforms.includes("instagram") && !p.platforms.includes("facebook") ? "instagram" : "facebook");
  const [panel, setPanel] = useState<string>(data.tab ?? (data.openGenerator || (!p.caption_ar && !p.caption_en && !readOnly) ? "ai" : "preview"));
  const [fixing, setFixing] = useState<string | null>(null);
  const [check, setCheck] = useState<CaptionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => setDirty(true), [ar, en, ig, tags, firstComment, platforms, category, frame, photos]);
  useEffect(() => setDirty(false), []);

  // ⌘S saves, A approves (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        submit("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const submit = (intent: string) => {
    const f = form.current;
    if (!f) return;
    const i = document.createElement("input");
    i.type = "hidden";
    i.name = "intent";
    i.value = intent;
    f.appendChild(i);
    f.requestSubmit();
  };

  const fullCaption = [ar, en, tags].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const igCaption = splitIg && ig.trim() ? ig : fullCaption;
  const tagCount = (igCaption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const badShape = platforms.includes("instagram") ? photos.filter((x) => { const r = ratioOf(x); return r < 0.79 || r > 1.92; }) : [];
  const notPortrait = photos.filter((x) => Math.abs(ratioOf(x) - 0.8) > 0.01);
  const cat = data.categories.find((c) => c.id === category);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= photos.length) return;
    setPhotos((list) => {
      const next = [...list];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
    setPhotosChanged(true);
  };

  // "Fix shape": re-draws photos as 4:5 portraits (and adds the frame), the
  // same way the photo editor saves an edit, so the original stays.
  async function fixShapes() {
    const supabase = createClient();
    const frameUrl = data.frames.find((f) => f.id === frame)?.url;
    const overlay = frameUrl ? await createImageBitmap(await (await fetch(frameUrl)).blob()).catch(() => null) : null;
    for (const ph of (frame ? photos : notPortrait)) {
      if (!ph.full) continue;
      setFixing(ph.id);
      try {
        const bitmap = await createImageBitmap(await (await fetch(ph.full)).blob(), { imageOrientation: "from-image" });
        const settings: EditSettings = { ...(ph.settings ?? NO_EDIT), crop: "portrait", position: 0.4 };
        const draw = (max: number) => {
          const c = render(bitmap, settings, max);
          if (overlay) c.getContext("2d")!.drawImage(overlay, 0, 0, c.width, c.height);
          return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", max > 1000 ? 0.88 : 0.75));
        };
        const path = `${ph.storagePath.split("/")[0]}/${ph.id}_e${Date.now()}.jpg`;
        const [big, small] = [await draw(2048), await draw(480)];
        const opts = { contentType: "image/jpeg", upsert: false };
        const [a, b] = await Promise.all([supabase.storage.from("photos").upload(path, big, opts), supabase.storage.from("photos").upload(thumbPath(path), small, opts)]);
        if (a.error || b.error) throw a.error ?? b.error;
        await saveEdit(data.locale, ph.id, path, settings);
        bitmap.close();
      } catch {
        // Leave this one; the check still shows which photos need fixing.
      }
    }
    setFixing(null);
    router.refresh();
  }

  async function runCheck() {
    setChecking(true);
    const r = await aiCheck(data.locale, [ar, en, ig, tags].join("\n"));
    setChecking(false);
    setCheck(r.check ?? null);
  }

  const blocked = data.checks.some((c) => c.level === "block");
  const s = p.status;
  const canSubmit = data.can.write && ["idea", "draft", "rejected"].includes(s);
  const canApprove = (data.can.approve || data.can.approveAny) && ["draft", "in_review", "rejected"].includes(s);
  const canExtra = data.can.extra && s === "waiting_extra";
  const canSchedule = (data.can.approve || data.can.approveAny || canExtra) && ["approved", "in_review", "failed", "waiting_extra"].includes(s);

  const hidden = (
    <>
      <input type="hidden" name="locale" value={data.locale} />
      <input type="hidden" name="id" value={p.id} />
    </>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <form ref={form} action={postAction} className="min-w-0 space-y-4" onSubmit={() => setDirty(false)}>
        {hidden}
        <input type="hidden" name="editor" value="1" />
        <input type="hidden" name="photosSent" value={photosChanged ? "1" : "0"} />
        {photos.map((x) => (
          <input key={x.id} type="hidden" name="order" value={x.id} />
        ))}
        {[...picks].map((id) => (
          <input key={id} type="hidden" name="order" value={id} />
        ))}

        {p.status === "idea" && (
          <Card>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("idea")}</span>
              <textarea name="idea" defaultValue={p.idea ?? ""} rows={2} maxLength={1000} disabled={readOnly} className={area} />
            </label>
          </Card>
        )}
        {p.status !== "idea" && p.idea && <input type="hidden" name="idea" value={p.idea} />}

        <Card
          title={
            <span className="flex items-center gap-2">
              {t("photos")} <span className="text-xs font-normal text-muted">{photos.length}/{data.photoLimit === Infinity ? "∞" : data.photoLimit}</span>
            </span>
          }
          action={
            !readOnly && (
              <div className="flex gap-1.5">
                {(badShape.length > 0 || (frame && photos.length > 0) || notPortrait.length > 0) && (
                  <Button type="button" variant={badShape.length ? "primary" : "quiet"} icon="frame" disabled={!!fixing || photosChanged} onClick={fixShapes} className="!px-2.5 !py-1 text-xs" title={photosChanged ? t("saveFirst") : ""}>
                    {fixing ? t("fixing") : frame ? t("applyFrame") : t("fixShape")}
                  </Button>
                )}
                <Button type="button" variant="quiet" icon="plus" onClick={() => setAdding((v) => !v)} className="!px-2.5 !py-1 text-xs">
                  {t("addPhotos")}
                </Button>
              </div>
            )
          }
        >
          {!photos.length && <p className="text-sm text-muted">{t("noPhotos")}</p>}
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((x, n) => (
              <li
                key={x.id}
                draggable={!readOnly}
                onDragStart={() => setDrag(n)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, n);
                  setDrag(null);
                }}
                className={`group relative w-24 shrink-0 overflow-hidden rounded-lg border bg-background ${fixing === x.id ? "skeleton" : ""} ${x.waiting ? "border-warn" : "border-border"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                <img src={x.thumb} alt="" className="aspect-[4/5] w-full object-cover" />
                {n === 0 && <span className="absolute start-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{tp("cover")}</span>}
                {x.waiting && <span className="absolute inset-x-0 bottom-0 bg-warn px-1 text-center text-[10px] text-white">{t("waitingMac")}</span>}
                {Math.abs(ratioOf(x) - 0.8) > 0.01 && !x.waiting && <span className="absolute end-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{ratioOf(x) > 1 ? "▭" : ratioOf(x) === 1 ? "□" : "▯"}</span>}
                {!readOnly && (
                  <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-black/60 p-0.5 text-[11px] text-white group-hover:flex">
                    <button type="button" onClick={() => move(n, n - 1)} aria-label={t("earlier")}>
                      ◀
                    </button>
                    <Link href={`/library/${x.id}`}>{t("edit")}</Link>
                    <button
                      type="button"
                      onClick={() => {
                        setPhotos((l) => l.filter((y) => y.id !== x.id));
                        setPhotosChanged(true);
                      }}
                      aria-label={t("remove")}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted">{t("pickMore")}</p>
              <div className="grid max-h-72 grid-cols-5 gap-1.5 overflow-y-auto sm:grid-cols-8">
                {data.more.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => {
                      setPicks((s0) => {
                        const n = new Set(s0);
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
                        return n;
                      });
                      setPhotosChanged(true);
                    }}
                    className={`relative overflow-hidden rounded-md border-2 ${picks.has(m.id) ? "border-accent" : "border-transparent"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs change hourly */}
                    <img src={m.thumb} alt="" className="aspect-square w-full object-cover" />
                    {m.score != null && <span className="absolute bottom-0.5 end-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{m.score}</span>}
                  </button>
                ))}
              </div>
              {picks.size > 0 && <p className="text-xs text-accent">{t("willAdd", { count: picks.size })}</p>}
            </div>
          )}
        </Card>

        <Card>
          <div className={`grid gap-4 ${data.languages === "ar_en" ? "md:grid-cols-2" : ""}`}>
            {data.languages !== "en" && (
              <div>
                <CaptionField label={tp("captionAr")} value={ar} onChange={setAr} dir="rtl" lang="ar" other={en} disabled={readOnly} locale={data.locale} limit={LIMITS.instagram.caption} />
                <input type="hidden" name="captionAr" value={ar} />
              </div>
            )}
            {data.languages !== "ar" && (
              <div>
                <CaptionField label={tp("captionEn")} value={en} onChange={setEn} dir="ltr" lang="en" other={ar} disabled={readOnly} locale={data.locale} limit={LIMITS.instagram.caption} />
                <input type="hidden" name="captionEn" value={en} />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{tp("hashtags")}</span>
              {!readOnly && (
                <div className="flex flex-wrap gap-1">
                  {cat?.hashtags && (
                    <button type="button" onClick={() => setTags((x) => [x, cat.hashtags].filter(Boolean).join(" "))} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-background">
                      + {cat.name}
                    </button>
                  )}
                  {data.snippets.filter((x) => x.kind === "hashtags").map((x) => (
                    <button type="button" key={x.id} onClick={() => setTags((y) => [y, x.body].filter(Boolean).join(" "))} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-background">
                      + {x.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input name="hashtags" value={tags} onChange={(e) => setTags(e.target.value)} maxLength={300} disabled={readOnly} className={area} dir="auto" />
            <p className={`text-[11px] ${tagCount > LIMITS.instagram.hashtags ? "text-danger" : "text-muted"}`}>{t("tagCount", { count: tagCount, max: LIMITS.instagram.hashtags })}</p>
          </div>

          {!readOnly && data.snippets.some((x) => x.kind !== "hashtags") && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">{t("snippets")}</span>
              {data.snippets.filter((x) => x.kind !== "hashtags").map((x) => (
                <button type="button" key={x.id} onClick={() => (/[؀-ۿ]/.test(x.body) ? setAr((y) => `${y}\n${x.body}`.trim()) : setEn((y) => `${y}\n${x.body}`.trim()))} className="rounded-full bg-grey-bg px-2 py-0.5 text-[11px] hover:bg-accent-bg">
                  {x.title}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <Toggle name="splitIg" checked={splitIg} onChange={(e) => setSplitIg(e.target.checked)} disabled={readOnly} label={t("splitIg")} hint={t("splitIgHint")} />
            {splitIg && (
              <textarea name="captionIg" value={ig} onChange={(e) => setIg(e.target.value)} rows={4} maxLength={LIMITS.instagram.caption} disabled={readOnly} className={area} dir="auto" placeholder={fullCaption} />
            )}
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("firstComment")}</span>
              <textarea name="firstComment" value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={2} maxLength={2200} disabled={readOnly} className={area} dir="auto" placeholder={t("firstCommentHint")} />
            </label>
          </div>
        </Card>

        <Card title={t("details")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">{tp("where")}</legend>
              {(["facebook", "instagram"] as const).map((x) => (
                <label key={x} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="platform"
                    value={x}
                    checked={platforms.includes(x)}
                    disabled={readOnly}
                    onChange={(e) => setPlatforms((l) => (e.target.checked ? [...l, x] : l.filter((y) => y !== x)))}
                  />
                  <Icon name={x} />
                  {x === "facebook" ? "Facebook" : "Instagram"}
                  {data.accountsPaused[x] && <Chip tone="warn">{t("paused")}</Chip>}
                </label>
              ))}
            </fieldset>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("category")}</span>
              <select
                name="category"
                value={category}
                disabled={readOnly}
                onChange={(e) => {
                  setCategory(e.target.value);
                  const c = data.categories.find((x) => x.id === e.target.value);
                  if (c?.frame_id && !frame) setFrame(c.frame_id);
                }}
                className={area}
              >
                <option value="">{t("noCategory")}</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("frame")}</span>
              <select name="frame" value={frame} onChange={(e) => setFrame(e.target.value)} disabled={readOnly} className={area}>
                <option value="">{t("noFrame")}</option>
                {data.frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              {!data.frames.length && (
                <Link href="/categories?tab=frames" className="text-xs text-accent">
                  {t("addFrames")}
                </Link>
              )}
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("location")}</span>
              <input name="location" defaultValue={p.location} maxLength={120} disabled={readOnly} className={area} />
            </label>
            <div className="sm:col-span-2">
              <LocalDateTime name="scheduledAt" label={tp("when")} value={p.scheduled_at} disabled={readOnly && !canSchedule} />
            </div>
          </div>
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <Toggle name="story" defaultChecked={p.make_story} disabled={readOnly} label={t("story")} hint={t("storyHint")} />
            <Toggle name="sensitive" defaultChecked={p.sensitive} disabled={readOnly} label={t("sensitive")} hint={t("sensitiveHint")} />
            {data.can.urgent && <Toggle name="urgent" defaultChecked={p.urgent} disabled={readOnly} label={t("urgent")} hint={t("urgentHint")} />}
          </div>
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-semibold">{t("altText")}</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <textarea name="altAr" defaultValue={p.alt_ar} rows={2} maxLength={400} dir="rtl" disabled={readOnly} className={area} />
              <textarea name="altEn" defaultValue={p.alt_en} rows={2} maxLength={400} dir="ltr" disabled={readOnly} className={area} />
            </div>
          </details>
        </Card>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <Card className="!p-3">
          <div className="mb-2 flex flex-wrap gap-1">
            {(["preview", "ai", "comments", "history"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setPanel(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${panel === k ? "bg-accent-bg text-accent-ink" : "text-muted hover:bg-background"}`}
              >
                {t(`panels.${k}`)}
                {k === "comments" && data.comments.length > 0 && ` ${data.comments.length}`}
              </button>
            ))}
          </div>

          {panel === "preview" && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {(["facebook", "instagram"] as const).map((x) => (
                  <button key={x} onClick={() => setView(x)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${view === x ? "border-accent text-accent" : "border-border text-muted"}`}>
                    <Icon name={x} size={12} /> {x === "facebook" ? "Facebook" : "Instagram"}
                  </button>
                ))}
              </div>
              <Preview data={data} platform={view} caption={view === "instagram" ? igCaption : fullCaption} photos={photos} />
              {firstComment.trim() && (
                <p className="rounded-lg bg-surface-2 p-2 text-xs" dir="auto">
                  <b>{view === "facebook" ? data.pageName : data.igName}</b> {firstComment}
                </p>
              )}
            </div>
          )}

          {panel === "ai" && (
            <div className="space-y-3">
              {!readOnly ? (
                <form action={generateCaptions} className="space-y-2.5">
                  {hidden}
                  {splitIg && <input type="hidden" name="splitIg" value="on" />}
                  <p className="text-xs text-muted">{t("ai.hint")}</p>
                  <textarea name="prompt" rows={2} maxLength={500} placeholder={t("ai.prompt")} className={area} />
                  <div className="grid grid-cols-2 gap-2">
                    <select name="tone" className={area} defaultValue="">
                      <option value="">{t("ai.toneAuto")}</option>
                      {["warm", "proud", "formal", "friendly", "fun", "informative"].map((x) => (
                        <option key={x} value={x}>
                          {t(`ai.tones.${x}`)}
                        </option>
                      ))}
                    </select>
                    <select name="words" className={area} defaultValue="0">
                      <option value="0">{t("ai.lengthAuto")}</option>
                      <option value="40">{t("ai.short")}</option>
                      <option value="90">{t("ai.medium")}</option>
                      <option value="180">{t("ai.long")}</option>
                    </select>
                    <select name="emoji" className={area} defaultValue="on">
                      <option value="on">{t("ai.emojiOn")}</option>
                      <option value="off">{t("ai.emojiOff")}</option>
                    </select>
                    <select name="withHashtags" className={area} defaultValue="on">
                      <option value="on">{t("ai.tagsOn")}</option>
                      <option value="off">{t("ai.tagsOff")}</option>
                    </select>
                  </div>
                  <input type="hidden" name="count" value="3" />
                  <Button icon="sparkle" className="w-full">
                    {p.caption_ar || p.caption_en ? t("ai.again") : t("ai.write")}
                  </Button>
                  {dirty && <p className="text-[11px] text-warn">{t("ai.unsaved")}</p>}
                </form>
              ) : (
                <p className="text-xs text-muted">{t("ai.readOnly")}</p>
              )}
              {p.variations.length > 1 && (
                <div className="space-y-2 border-t border-border pt-3">
                  <b className="text-xs">{t("ai.versions")}</b>
                  {p.variations.map((v, n) => (
                    <form key={n} action={pickVariation} className="rounded-lg border border-border p-2 text-xs">
                      {hidden}
                      <input type="hidden" name="index" value={n} />
                      <p className="line-clamp-4 whitespace-pre-wrap" dir="auto">
                        {v.ar || v.en}
                      </p>
                      {!readOnly && (
                        <button className="mt-1 font-semibold text-accent">{t("ai.useThis")}</button>
                      )}
                    </form>
                  ))}
                </div>
              )}
              <div className="space-y-2 border-t border-border pt-3">
                <Button type="button" variant="quiet" icon="check" className="w-full" disabled={checking || !(ar || en)} onClick={runCheck}>
                  {checking ? t("ai.checking") : t("ai.check")}
                </Button>
                {check && (
                  <div className="space-y-1 text-xs">
                    <p>
                      <b>{t("ai.score", { score: check.score })}</b>
                    </p>
                    <ul className="list-disc space-y-0.5 ps-4 text-muted">
                      {check.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                      {check.spelling.map((x, i) => (
                        <li key={`s${i}`}>
                          {x.wrong} → {x.right}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {panel === "comments" && (
            <div className="space-y-2">
              {!data.comments.length && <p className="text-xs text-muted">{t("noComments")}</p>}
              <ul className="space-y-2">
                {data.comments.map((c) => (
                  <li key={c.id} className={`rounded-lg p-2 text-xs ${c.kind === "review" ? "bg-warn-bg" : "bg-surface-2"}`}>
                    <b>{c.author}</b> <span className="text-faint">{new Date(c.at).toLocaleString(data.locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                    <p className="whitespace-pre-wrap" dir="auto">
                      {c.body}
                    </p>
                  </li>
                ))}
              </ul>
              <form action={addComment} className="space-y-1.5">
                {hidden}
                <textarea name="body" rows={2} required maxLength={2000} placeholder={t("commentHint", { name: data.people[0]?.name.split(" ")[0] ?? "Mona" })} className={area} />
                <Button variant="quiet" className="w-full">
                  {t("addComment")}
                </Button>
              </form>
              {data.can.write && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <b className="text-xs">{t("reviewLink")}</b>
                  <p className="text-[11px] text-muted">{t("reviewLinkHint")}</p>
                  {data.newLink && <ReviewLinkBox token={data.newLink} locale={data.locale} />}
                  {data.links.map((l) => (
                    <p key={l.token} className="text-[11px]">
                      {l.label}: {l.answer ? t(`linkAnswer.${l.answer}`) : l.expired ? t("linkExpired") : t("linkWaiting")}
                      {l.comment ? ` · “${l.comment}”` : ""}
                    </p>
                  ))}
                  <form action={createReviewLink} className="flex gap-1.5">
                    {hidden}
                    <input name="label" required minLength={2} maxLength={80} placeholder={t("linkFor")} className={area} />
                    <Button variant="quiet" icon="link" className="shrink-0">
                      {t("makeLink")}
                    </Button>
                  </form>
                </div>
              )}
            </div>
          )}

          {panel === "history" && (
            <ul className="space-y-2">
              {!data.versions.length && <p className="text-xs text-muted">{t("noVersions")}</p>}
              {data.versions.map((v, n) => (
                <li key={v.id} className="rounded-lg border border-border p-2 text-xs">
                  <span className="text-faint">{new Date(v.at).toLocaleString(data.locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                  <p className="line-clamp-3" dir="auto">
                    {v.text}
                  </p>
                  {n > 0 && !readOnly && (
                    <form action={restoreVersion}>
                      {hidden}
                      <input type="hidden" name="version" value={v.id} />
                      <button className="mt-1 font-semibold text-accent">{t("restore")}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="!p-3" title={<span className="text-sm">{tp("checks")}</span>}>
          {!data.checks.length && <p className="text-sm text-good">{tp("allClear")}</p>}
          <ul className="space-y-1.5 text-xs">
            {data.checks.map((c, i) => (
              <li key={i} className={`flex gap-1.5 ${c.level === "block" ? "text-danger" : "text-warn"}`}>
                <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
                {c.text}
              </li>
            ))}
          </ul>
          {dirty && <p className="mt-2 text-[11px] text-muted">{t("checksAfterSave")}</p>}
        </Card>

        {p.status === "published" ? (
          <Card className="!p-3">
            <p className="text-sm">{tp("publishedAt")} {p.published_at && new Date(p.published_at).toLocaleString()}</p>
            <div className="mt-2 flex gap-3 text-sm">
              {p.fb_post_id && (
                <a className="text-accent" href={`https://www.facebook.com/${p.fb_post_id}`} target="_blank" rel="noreferrer">
                  Facebook ↗
                </a>
              )}
              {p.ig_media_id && <span>Instagram ✓</span>}
            </div>
            <form action={postAction} className="mt-3">
              {hidden}
              <Button name="intent" value="duplicate" variant="quiet" icon="plus" className="w-full">
                {t("duplicate")}
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="!p-3" title={<span className="text-sm">{tp("next")}</span>}>
            {!data.connected && <p className="mb-2 text-xs text-muted">{tp("notConnected")}</p>}
            {data.schoolPaused && <p className="mb-2 text-xs text-warn">{t("schoolPaused")}</p>}
            {s === "waiting_extra" && !canExtra && <p className="mb-2 text-xs text-muted">{t("waitingExtra")}</p>}
            {s === "in_review" && !canApprove && <p className="mb-2 text-xs text-muted">{t("waitingLead")}</p>}
            <div className="flex flex-col gap-1.5">
              {!readOnly && (
                <Button type="button" variant="quiet" onClick={() => submit("save")} title="⌘S">
                  {t("save")}
                </Button>
              )}
              {s === "idea" && data.can.write && (
                <Button type="button" variant="quiet" onClick={() => submit("start")}>
                  {t("startDraft")}
                </Button>
              )}
              {canSubmit && (
                <Button type="button" onClick={() => submit("submit")} disabled={blocked && !dirty}>
                  {tp("submit")}
                </Button>
              )}
              {(canApprove || canExtra) && (
                <Button type="button" variant="good" icon="check" onClick={() => submit("approve")} disabled={blocked && !dirty} title="A">
                  {tp("approve")}
                </Button>
              )}
              {canSchedule && (
                <>
                  <Button type="button" variant={s === "approved" ? "primary" : "quiet"} icon="calendar" onClick={() => submit("schedule")} disabled={(blocked && !dirty) || !data.connected}>
                    {tp("schedule")}
                  </Button>
                  <Button type="button" variant="quiet" icon="clock" onClick={() => submit("queue")} disabled={(blocked && !dirty) || !data.connected}>
                    {t("nextSlot")}
                  </Button>
                </>
              )}
              {(data.can.publish || canExtra) && ["approved", "scheduled", "failed"].includes(s) && (
                <Button type="button" variant="quiet" icon="bolt" onClick={() => submit("publish")} disabled={(blocked && !dirty) || !data.connected || data.schoolPaused}>
                  {s === "failed" ? tp("retry") : tp("publishNow")}
                </Button>
              )}
              {s === "scheduled" && (
                <Button type="button" variant="quiet" onClick={() => submit("unschedule")}>
                  {tp("unschedule")}
                </Button>
              )}
              {data.can.write && ["approved", "in_review", "waiting_extra", "failed"].includes(s) && (
                <Button type="button" variant="ghost" onClick={() => submit("draft")}>
                  {tp("toDraft")}
                </Button>
              )}
            </div>
            {(canApprove || canExtra) && ["in_review", "waiting_extra"].includes(s) && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                <textarea form="reject" name="reviewNote" rows={2} maxLength={500} placeholder={tp("notePlaceholder")} className={area} />
                <form id="reject" action={postAction}>
                  {hidden}
                  <Button name="intent" value="reject" variant="quiet" className="w-full">
                    {tp("reject")}
                  </Button>
                </form>
              </div>
            )}
            {data.can.write && (
              <div className="mt-3 flex justify-between border-t border-border pt-3">
                <form action={postAction}>
                  {hidden}
                  <Button name="intent" value="duplicate" variant="ghost" className="!px-2 text-xs">
                    {t("duplicate")}
                  </Button>
                </form>
                <form
                  action={postAction}
                  onSubmit={(e) => {
                    if (!confirm(t("confirmDelete"))) e.preventDefault();
                  }}
                >
                  {hidden}
                  <Button name="intent" value="delete" variant="danger" icon="trash" className="!px-2 text-xs">
                    {tp("delete")}
                  </Button>
                </form>
              </div>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}

function ReviewLinkBox({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations("composer");
  const url = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/${locale}/review/${token}`), [token, locale]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-accent-bg p-2 text-[11px]">
      <span className="ltr min-w-0 grow truncate">{url}</span>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
        className="shrink-0 font-semibold text-accent-ink"
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}
