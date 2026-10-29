"use server";

import { headers } from "next/headers";
import { redirect as goTo } from "next/navigation";
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
  const next = safeNext(formData.get("next"), "/today");
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

// Google or Microsoft school accounts. Each provider is switched on in
// Supabase (Authentication > Sign In / Providers) with its own free app.
export async function signInWithProvider(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const provider = formData.get("provider") === "azure" ? "azure" : "google";
  const next = safeNext(formData.get("next"), "/today");
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/confirm?next=/${locale}${next}`, scopes: provider === "azure" ? "email" : undefined },
  });
  if (error || !data.url) redirect({ href: { pathname: "/login", query: { error: "provider", next } }, locale });
  goTo(data.url!);
}

// A one-time code by email (free), or by text message when the school has
// an SMS service switched on in Supabase.
export async function sendCode(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const next = safeNext(formData.get("next"), "/today");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").replace(/[^\d+]/g, "");
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();
  const { error } = phone
    ? await supabase.auth.signInWithOtp({ phone })
    : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/confirm?next=/${locale}${next}` } });
  if (error) redirect({ href: { pathname: "/login", query: { error: "code", next } }, locale });
  redirect({ href: { pathname: "/login", query: { sent: phone ? "phone" : "email", to: phone || email, next } }, locale });
}

export async function verifyCode(formData: FormData) {
  const locale = String(formData.get("locale") ?? "ar");
  const next = safeNext(formData.get("next"), "/today");
  const to = String(formData.get("to") ?? "").trim();
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  const supabase = await createClient();
  const { error } = to.includes("@")
    ? await supabase.auth.verifyOtp({ email: to.toLowerCase(), token, type: "email" })
    : await supabase.auth.verifyOtp({ phone: to, token, type: "sms" });
  if (error) redirect({ href: { pathname: "/login", query: { sent: to.includes("@") ? "email" : "phone", to, next, error: "badcode" } }, locale });
  redirect({ href: next, locale });
}
