import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// The readable text of a school's public web page, for the set-up wizard.
// Only public http(s) addresses; never this server's own network.
// A public address only: no local names, no IP addresses typed in, and the
// name must not lead to a private or local network address (B-107).
function privateIp(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export async function publicUrl(url: URL) {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || !host.includes(".")) return false;
  try {
    const found = await lookup(host, { all: true });
    return found.length > 0 && !found.some((f) => privateIp(f.address));
  } catch {
    return false;
  }
}

export async function siteText(address: string, max = 6000) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  } catch {
    return null;
  }
  try {
    // Redirects are followed by hand so every hop is checked the same way.
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (!(await publicUrl(url))) return null;
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "SchoolSocialHub/1.0 (school profile set-up)" } });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      url = new URL(next, url);
      res = null;
    }
    if (!res) return null;
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
