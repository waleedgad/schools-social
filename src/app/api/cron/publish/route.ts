import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "@/lib/publish";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// Called every 5 minutes by a Supabase scheduled job (pg_cron), because the
// free Vercel plan only runs its own cron once a day. Calling it early or
// often is harmless: it only posts what is due, and each post only once.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run(request: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 500 });
  const published = await publishDue(createAdminClient());
  return NextResponse.json({ published });
}

export const GET = run;
export const POST = run;
