"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession, WORKSPACE_COOKIE } from "@/lib/session";

// Switch between schools (groups, campuses, or the owner's view).
export async function switchSchool(formData: FormData) {
  const id = String(formData.get("school") ?? "");
  const { workspaces } = await getSession();
  if (!workspaces.some((w) => w.id === id)) return;
  (await cookies()).set(WORKSPACE_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}
