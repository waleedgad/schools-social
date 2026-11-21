"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);

// The principal (or the admin, or comms) approves one yearbook page, or takes
// the approval back. The database checks the role, keeps the answer against
// the version the Mac sent, and approves the book when every page is.
export async function approveBookPage(formData: FormData) {
  const locale = str(formData, "locale", 5) || "ar";
  await requireMembership(locale);
  const supabase = await createClient();
  const book = str(formData, "book", 60);
  const page = Number(str(formData, "page", 6)) || 0;
  await supabase.rpc("approve_book_page", { p_book: book, p_page: page, p_approved: str(formData, "approved", 3) !== "0" });
  revalidatePath(`/${locale}/books/${book}`);
  revalidatePath(`/${locale}/books`);
}
