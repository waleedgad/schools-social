import type { Instrumentation } from "next";

// Server errors (a page or action that fails on Vercel) are reported the same
// way as errors in the browser: one short row in error_reports.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { createAdminClient, isAdminConfigured } = await import("@/lib/supabase/admin");
    if (!isAdminConfigured) return;
    const e = err as Error & { digest?: string };
    await createAdminClient().rpc("report_error", {
      p_source: "web-server",
      p_version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7),
      p_message: (e?.message || String(err)).slice(0, 1000),
      p_stack: `${e?.digest ? `digest ${e.digest}\n` : ""}${e?.stack ?? ""}`.slice(0, 4000),
      p_place: `${request.method} ${request.path} (${context.routeType} ${context.routePath})`.slice(0, 300),
    });
  } catch {
    // reporting must never add a second failure
  }
};
