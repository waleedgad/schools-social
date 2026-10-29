import "server-only";

// Class lists straight from Google Classroom or Microsoft Teams (School
// Data Sync): the person signs in with their school account once, we read
// their classes and the students in each, and keep nothing but names,
// classes and the provider's student id. Each provider needs its own free
// app (client id and secret) set in Vercel.

export type Provider = "google" | "microsoft";
export type RosterStudent = { code: string; name: string; className: string };

const env = (k: string) => (process.env[k] ?? "").trim();
const cfg = {
  google: {
    id: () => env("GOOGLE_CLIENT_ID"),
    secret: () => env("GOOGLE_CLIENT_SECRET"),
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly",
  },
  microsoft: {
    id: () => env("MICROSOFT_CLIENT_ID"),
    secret: () => env("MICROSOFT_CLIENT_SECRET"),
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "https://graph.microsoft.com/EduRoster.ReadBasic",
  },
} as const;

export const classListProviders = () => (["google", "microsoft"] as const).map((key) => ({ key, ready: !!cfg[key].id() && !!cfg[key].secret() }));
export const isProvider = (v: unknown): v is Provider => v === "google" || v === "microsoft";

export function authUrl(provider: Provider, redirectUri: string, state: string) {
  const c = cfg[provider];
  const q = new URLSearchParams({ client_id: c.id(), redirect_uri: redirectUri, response_type: "code", scope: c.scope, state, prompt: "select_account" });
  return `${c.auth}?${q}`;
}

export async function tokenFor(provider: Provider, code: string, redirectUri: string) {
  const c = cfg[provider];
  const res = await fetch(c.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id(), client_secret: c.secret(), code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(json.error_description || json.error || "token failed");
  return json.access_token as string;
}

async function get<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`roster request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function readRosters(provider: Provider, token: string, max = 4000): Promise<RosterStudent[]> {
  const out: RosterStudent[] = [];
  if (provider === "google") {
    type Course = { id: string; name: string; section?: string };
    let page = "";
    const courses: Course[] = [];
    do {
      const r = await get<{ courses?: Course[]; nextPageToken?: string }>(`https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=100${page ? `&pageToken=${page}` : ""}`, token);
      courses.push(...(r.courses ?? []));
      page = r.nextPageToken ?? "";
    } while (page && courses.length < 500);
    for (const c of courses) {
      let p = "";
      do {
        const r = await get<{ students?: { userId: string; profile: { name: { fullName: string } } }[]; nextPageToken?: string }>(`https://classroom.googleapis.com/v1/courses/${c.id}/students?pageSize=100${p ? `&pageToken=${p}` : ""}`, token);
        for (const s of r.students ?? []) out.push({ code: `gc:${s.userId}`, name: s.profile.name.fullName, className: (c.section || c.name).slice(0, 60) });
        p = r.nextPageToken ?? "";
      } while (p && out.length < max);
      if (out.length >= max) break;
    }
  } else {
    type Page<T> = { value: T[]; "@odata.nextLink"?: string };
    let url: string | undefined = "https://graph.microsoft.com/v1.0/education/me/classes?$select=id,displayName,mailNickname";
    const classes: { id: string; displayName: string }[] = [];
    while (url && classes.length < 500) {
      const r: Page<{ id: string; displayName: string }> = await get(url, token);
      classes.push(...r.value);
      url = r["@odata.nextLink"];
    }
    for (const c of classes) {
      let m: string | undefined = `https://graph.microsoft.com/v1.0/education/classes/${c.id}/members?$select=id,displayName,primaryRole`;
      while (m && out.length < max) {
        const r: Page<{ id: string; displayName: string; primaryRole?: string }> = await get(m, token);
        for (const u of r.value) if (u.primaryRole !== "teacher") out.push({ code: `ms:${u.id}`, name: u.displayName, className: c.displayName.slice(0, 60) });
        m = r["@odata.nextLink"];
      }
    }
  }
  // One row per student and class.
  const seen = new Set<string>();
  return out.filter((s) => s.name?.trim() && !seen.has(`${s.code}|${s.className}`) && seen.add(`${s.code}|${s.className}`)).slice(0, max);
}
