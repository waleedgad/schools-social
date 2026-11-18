import "server-only";
import { redirect } from "@/i18n/navigation";
import { getSession } from "./session";
import { createClient } from "./supabase/server";

// The owner page (/owner) opens only for accounts on the owner list. The
// database checks again in every owner function.
export async function requireOwner(locale: string) {
  const { user } = await getSession();
  if (!user) redirect({ href: "/login", locale });
  const supabase = await createClient();
  const { data: owner } = await supabase.rpc("is_owner");
  if (!owner) redirect({ href: "/today", locale });
  return { user: user!, supabase };
}

export async function isOwner() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_owner");
  return data === true;
}

export type OwnerSchool = {
  id: string;
  name: string;
  plan_id: string;
  plan_en: string;
  plan_ar: string;
  state: "active" | "read_only" | "blocked";
  paid_until: string;
  days_left: number;
  trial: boolean;
  managers: number;
  manager_limit: number;
  computers: number;
  computer_limit: number;
  price_year: number | null;
  last_activity: string | null;
  created_at: string;
};

export type Plan = { id: string; name_en: string; name_ar: string; manager_limit: number; computer_limit: number; price_year: number | null; active: boolean; sort: number };

export type OwnerSettings = { currency: string; extra_manager_price: number | null; extra_computer_price: number | null; contact: string; self_signup: boolean };

// Owner log actions as words (messages: owner.log.actions.*).
export const LOG_ACTIONS = ["school.created", "admin.invited", "plan.changed", "payment.recorded", "paid_until.changed", "state.forced", "computer.removed", "plan.saved", "settings.saved"] as const;
