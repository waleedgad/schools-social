import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "./supabase/server";

// A school's plan and access state, as the database works them out
// (migration 0019: school_status). Active = everything works; Read-only =
// look but don't change (14 days after "paid until"); Blocked = only the
// renew notice.
export type SchoolState = "active" | "read_only" | "blocked";

export type PlanStatus = {
  state: SchoolState;
  forced: boolean;
  paid_until: string;
  today: string;
  days_left: number;
  read_only_left: number;
  trial: boolean;
  plan: { id: string; name_en: string; name_ar: string };
  managers: number;
  manager_limit: number;
  computers: number;
  computer_limit: number;
  contact: string;
};

// Asked once per page, however many parts of the page need it.
export const getPlanStatus = cache(async (schoolId: string): Promise<PlanStatus | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("school_status", { p_school: schoolId });
  return (data as PlanStatus | null) ?? null;
});

// For server code that runs with the service key (photographer links,
// WhatsApp photos, Facebook connection, publishing): the database lets the
// service key through, so these check the state themselves.
export async function stateWithServiceKey(admin: SupabaseClient, schoolId: string): Promise<SchoolState> {
  const { data } = await admin.rpc("school_state", { p_school: schoolId });
  return (data as SchoolState | null) ?? "blocked";
}

// The database's reason for refusing a change, as a short key for the words
// on screen (messages: plan.errors.*).
export type PlanError = "read_only" | "blocked" | "manager_limit" | "computer_limit" | "signup_closed";

export function planError(error: { message?: string } | null | undefined): PlanError | null {
  const m = error?.message ?? "";
  if (m.includes("school-read-only")) return "read_only";
  if (m.includes("school-blocked")) return "blocked";
  if (m.includes("manager-limit")) return "manager_limit";
  if (m.includes("computer-limit")) return "computer_limit";
  if (m.includes("signup-closed")) return "signup_closed";
  return null;
}

export function isPlanError(v: unknown): v is PlanError {
  return typeof v === "string" && ["read_only", "blocked", "manager_limit", "computer_limit", "signup_closed"].includes(v);
}

// Who sees the plan page and the "ending soon" bar.
export const PLAN_ROLES = ["admin", "comms_lead"] as const;
export function seesPlan(role: string) {
  return (PLAN_ROLES as readonly string[]).includes(role);
}

// Changes that the database can't stop by itself (asking the AI, replying
// on Facebook, posting a story straight away) check the state first.
export async function isActive(supabase: SupabaseClient, schoolId: string) {
  const { data } = await supabase.rpc("school_state", { p_school: schoolId });
  return data === "active";
}
