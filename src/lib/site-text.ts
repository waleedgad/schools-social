import "server-only";

// The readable text of a school's public web page, for the set-up wizard.
// Only public http(s) addresses; never this server's own network.
export async function siteText(address: string, max = 6000) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "SchoolSocialHub/1.0 (school profile set-up)" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 600_000);
    const meta = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|og:title)["'][^>]*content=["']([^"']+)["']/gi)].map((m) => m[1]);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
    const body = html
      .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [title, ...meta, body].filter(Boolean).join("\n").slice(0, max);
  } catch {
    return null;
  }
}
