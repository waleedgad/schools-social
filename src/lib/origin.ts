import { headers } from "next/headers";

// The address people reach the app on, for links they copy and share.
export async function appOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}
