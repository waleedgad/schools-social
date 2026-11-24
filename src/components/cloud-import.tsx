"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "./ui";

// Photos from Google Drive, OneDrive or Dropbox (final plan, Integrations).
// Pasting shared links works with no set-up; each "choose from my account"
// button shows once that service's free key is set (src/lib/cloud-links.ts).
// Every photo is fetched by our server (only from those services) and then
// uploaded like any other photo.

const DROPBOX_KEY = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY ?? "";
const GOOGLE_CLIENT = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "";
const GOOGLE_APP = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
const MS_CLIENT = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID ?? "";

type W = Window & {
  Dropbox?: { choose: (o: object) => void };
  OneDrive?: { open: (o: object) => void };
  gapi?: { load: (lib: string, cb: () => void) => void };
  google?: {
    accounts: { oauth2: { initTokenClient: (o: object) => { requestAccessToken: () => void } } };
    picker: {
      PickerBuilder: new () => Record<string, (...a: unknown[]) => unknown>;
      ViewId: { DOCS_IMAGES: string };
      Feature: { MULTISELECT_ENABLED: string };
      Action: { PICKED: string };
    };
  };
};

function loadScript(src: string, attrs: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script"));
    document.head.append(s);
  });
}

export function CloudImport({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const t = useTranslations("upload.cloud");
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  // Fetches each item through the server, then hands the photos to the uploader.
  async function fetchAll(items: ({ url: string } | { fileId: string; token: string })[]) {
    if (!items.length) return;
    setBusy(true);
    setMsg(null);
    const files: File[] = [];
    const problems = new Map<string, number>();
    for (const item of items) {
      try {
        const r = await fetch("/api/import-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
        if (!r.ok) {
          const e = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "fetch";
          problems.set(e, (problems.get(e) ?? 0) + 1);
          continue;
        }
        const blob = await r.blob();
        const name = decodeURIComponent(r.headers.get("x-file-name") ?? "photo.jpg");
        files.push(new File([blob], name, { type: blob.type }));
      } catch {
        problems.set("fetch", (problems.get("fetch") ?? 0) + 1);
      }
    }
    setBusy(false);
    if (files.length) onFiles(files);
    const why = [...problems.keys()][0];
    setMsg(problems.size ? { tone: files.length ? "good" : "bad", text: `${files.length ? t("got", { count: files.length }) + " " : ""}${t(`problem.${["link", "private", "notPhoto", "big", "readOnly"].includes(why) ? why : "fetch"}`, { count: [...problems.values()].reduce((a, b) => a + b, 0) })}` } : { tone: "good", text: t("got", { count: files.length }) });
  }

  async function fromLinks() {
    const list = links.split(/\s+/).map((l) => l.trim()).filter((l) => /^https:\/\//i.test(l)).slice(0, 100);
    if (!list.length) return setMsg({ tone: "bad", text: t("problem.link", { count: 1 }) });
    await fetchAll(list.map((url) => ({ url })));
    setLinks("");
  }

  async function dropbox() {
    await loadScript("https://www.dropbox.com/static/api/2/dropins.js", { id: "dropboxjs", "data-app-key": DROPBOX_KEY });
    (window as W).Dropbox?.choose({ linkType: "direct", multiselect: true, extensions: ["images"], success: (files: { link: string }[]) => fetchAll(files.map((f) => ({ url: f.link }))) });
  }

  async function onedrive() {
    await loadScript("https://js.live.net/v7.2/OneDrive.js");
    (window as W).OneDrive?.open({
      clientId: MS_CLIENT,
      action: "download",
      multiSelect: true,
      advanced: { filter: ".jpg,.jpeg,.png,.heic,.heif,.webp", redirectUri: window.location.origin + window.location.pathname },
      success: (r: { value: Record<string, string>[] }) => fetchAll(r.value.map((f) => ({ url: f["@microsoft.graph.downloadUrl"] })).filter((x) => x.url)),
      error: () => setMsg({ tone: "bad", text: t("problem.fetch", { count: 1 }) }),
    });
  }

  async function google() {
    await Promise.all([loadScript("https://apis.google.com/js/api.js"), loadScript("https://accounts.google.com/gsi/client")]);
    const w = window as W;
    await new Promise<void>((resolve) => w.gapi!.load("picker", resolve));
    const client = w.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT,
      // Only the files the person picks: no access to the rest of their Drive.
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (resp: { access_token?: string }) => {
        const token = resp.access_token;
        if (!token) return;
        const g = w.google!.picker;
        const b = new g.PickerBuilder();
        b.addView(g.ViewId.DOCS_IMAGES);
        b.enableFeature(g.Feature.MULTISELECT_ENABLED);
        b.setOAuthToken(token);
        b.setDeveloperKey(GOOGLE_KEY);
        if (GOOGLE_APP) b.setAppId(GOOGLE_APP);
        b.setCallback((data: { action: string; docs?: { id: string }[] }) => {
          if (data.action === g.Action.PICKED) fetchAll((data.docs ?? []).map((d) => ({ fileId: d.id, token })));
        });
        (b.build() as { setVisible: (v: boolean) => void }).setVisible(true);
      },
    });
    client.requestAccessToken();
  }

  const off = disabled || busy;
  return (
    <details className="card p-3" data-testid="cloud-import">
      <summary className="cursor-pointer text-sm font-semibold">{t("title")}</summary>
      <div className="mt-3 space-y-3">
        {(DROPBOX_KEY || (GOOGLE_CLIENT && GOOGLE_KEY) || MS_CLIENT) && (
          <div className="flex flex-wrap gap-2">
            {GOOGLE_CLIENT && GOOGLE_KEY && (
              <Button type="button" variant="quiet" disabled={off} onClick={() => google().catch(() => setMsg({ tone: "bad", text: t("problem.fetch", { count: 1 }) }))}>
                {t("google")}
              </Button>
            )}
            {MS_CLIENT && (
              <Button type="button" variant="quiet" disabled={off} onClick={() => onedrive().catch(() => setMsg({ tone: "bad", text: t("problem.fetch", { count: 1 }) }))}>
                {t("onedrive")}
              </Button>
            )}
            {DROPBOX_KEY && (
              <Button type="button" variant="quiet" disabled={off} onClick={() => dropbox().catch(() => setMsg({ tone: "bad", text: t("problem.fetch", { count: 1 }) }))}>
                {t("dropbox")}
              </Button>
            )}
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-sm">{t("linksLabel")}</span>
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            rows={3}
            dir="ltr"
            disabled={off}
            placeholder="https://drive.google.com/file/d/…  https://www.dropbox.com/s/…  https://1drv.ms/i/…"
            className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <span className="block text-xs text-muted">{t("linksHint")}</span>
        </label>
        <Button type="button" variant="quiet" disabled={off || !links.trim()} onClick={fromLinks}>
          {busy ? t("fetching") : t("add")}
        </Button>
        {msg && (
          <p className={`text-sm ${msg.tone === "bad" ? "text-danger" : "text-good"}`} aria-live="polite">
            {msg.text}
          </p>
        )}
      </div>
    </details>
  );
}
