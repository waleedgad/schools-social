"use server";

import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { safeNext } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function read(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  // Without the Supabase settings the home page explains what's missing.
  if (!isSupabaseConfigured) redirect({ href: "/", locale });
  return {
    locale,
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signIn(formData: FormData) {
  const { locale, email, password } = read(formData);
  const next = safeNext(formData.get("next"), "/dashboard");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect({ href: { pathname: "/login", query: { error: "1", next } }, locale });

  redirect({ href: next, locale });
}

export async function signUp(formData: FormData) {
  const { locale, email, password } = read(formData);
  const next = safeNext(formData.get("next"), "/onboarding");
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}${next}` },
  });
  if (error) redirect({ href: { pathname: "/signup", query: { error: "1", next } }, locale });

  // With email confirmation off (handy while testing) the user is signed in already.
  if (data.session) redirect({ href: next, locale });
  redirect({ href: { pathname: "/check-email", query: { email } }, locale });
}

export async function signOut(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/login", locale });
}
