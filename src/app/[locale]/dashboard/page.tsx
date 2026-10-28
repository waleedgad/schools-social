import { redirect } from "@/i18n/navigation";

// The old home for signed-in staff; Today replaced it.
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/today", locale });
}
