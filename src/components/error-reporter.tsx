"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Sends a short report of any error in this page to the builder (the
// report_error database function), so problems get fixed without anyone
// having to notice and describe them. Each error once per page visit.
export const VERSION = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);
const sent = new Set<string>();

export function reportError(message: string, stack?: string | null) {
  if (!message || sent.size >= 20 || sent.has(message)) return;
  // Not ours: browser add-ons and pages blocked by the network.
  if (/chrome-extension:|moz-extension:|safari-extension:|ResizeObserver loop/.test(`${message} ${stack ?? ""}`)) return;
  sent.add(message);
  try {
    void createClient()
      .rpc("report_error", { p_source: "web", p_version: VERSION, p_message: message.slice(0, 1000), p_stack: (stack ?? "").slice(0, 4000), p_place: location.pathname.slice(0, 300) })
      .then(() => {}, () => {});
  } catch {
    // never let reporting cause a second error
  }
}

export function ErrorReporter() {
  useEffect(() => {
    // The page's first script collects errors until this is ready.
    const w = window as unknown as { __report?: typeof reportError; __errq?: [string, string | null][] };
    w.__report = reportError;
    for (const [m, st] of w.__errq?.splice(0) ?? []) reportError(m, st);
  }, []);
  return null;
}
