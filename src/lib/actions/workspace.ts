"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import { isRole } from "@/lib/roles";
import { getSession, VIEW_AS_COOKIE, WORKSPACE_COOKIE } from "@/lib/session";

// Switch between schools (groups, campuses, or the owner's view).
export async function switchSchool(formData: FormData) {
  const id = String(formData.get("school") ?? "");
  const { workspaces } = await getSession();
  if (!workspaces.some((w) => w.id === id)) return;
  (await cookies()).set(WORKSPACE_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

// "View as": an admin sees the app exactly as a teacher, principal and so on
// would. Empty role goes back to the admin's own view.
export async function viewAs(formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const locale = String(formData.get("locale") ?? "ar");
  const jar = await cookies();
  if (!role) jar.delete(VIEW_AS_COOKIE);
  else {
    const { membership } = await getSession();
    if (membership?.role !== "admin" || !isRole(role) || role === "admin") return;
    jar.set(VIEW_AS_COOKIE, role, { path: "/", maxAge: 60 * 60 * 4, sameSite: "lax", httpOnly: true });
  }
  revalidatePath("/", "layout");
  redirect({ href: "/today", locale });
}
