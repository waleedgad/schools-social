"use server";

import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createSchool(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const defaultLocale = formData.get("defaultLocale") === "en" ? "en" : "ar";
  const supabase = await createClient();

  const { error } = await supabase.rpc("create_school", {
    p_name: String(formData.get("schoolName") ?? ""),
    p_full_name: String(formData.get("fullName") ?? ""),
    p_locale: defaultLocale,
  });
  if (error) redirect({ href: { pathname: "/onboarding", query: { error: "1" } }, locale });

  redirect({ href: "/dashboard", locale });
}
