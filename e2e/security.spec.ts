import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Security check: one school can never see or change another school's
// data, and someone not signed in sees nothing. Two schools are made in the
// test database; school B gets a row in every table that holds school data,
// then a staff member of school A tries to read, change, delete and add
// rows for school B, including making themselves a member of it.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));
test.describe.configure({ mode: "serial" });

const admin = () => createClient(url, service, { auth: { persistSession: false } });

async function makeSchool(sb: SupabaseClient, tag: string) {
  const email = `sec-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = "Test-password-123";
  const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { data: s, error: se } = await sb.from("schools").insert({ name: `Security ${tag}` }).select("id").single();
  if (se) throw se;
  const { error: me } = await sb.from("memberships").insert({ school_id: s.id, user_id: u.user!.id, role: "admin", full_name: `Admin ${tag}` });
  if (me) throw me;
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error: le } = await client.auth.signInWithPassword({ email, password });
  if (le) throw le;
  return { id: s.id as string, userId: u.user!.id, client };
}

// One row of school data per table, in an order that respects links.
async function seed(sb: SupabaseClient, school: string, userId: string) {
  const one = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await sb.from(table).insert({ school_id: school, ...row }).select().single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Record<string, unknown>;
  };
  const ev = await one("events", { title: "Sports day" });
  const photo = await one("photos", { storage_path: `${school}/secret.jpg`, event_id: ev.id });
  const post = await one("posts", {});
  const book = await one("books", { title: "Yearbook", mac_id: "1" });
  const album = await one("shared_albums", { name: "Album", mac_id: 1 });
  const rows: Record<string, Record<string, unknown>> = {
    account_metrics: { day: "2026-01-01", platform: "facebook" },
    alert_outbox: { kind: "approval", title: "secret", body: "secret", emails: ["lead@test.local"] },
    approval_cover: { to_user: userId, from_user: userId, starts_on: "2026-01-01", ends_on: "2026-01-02" },
    audit_log: { action: "test" },
    book_checks: { book_id: book.id, student_code: "S1" },
    book_comments: { book_id: book.id, page: 1, body: "secret" },
    book_texts: { book_id: book.id, body: "secret" },
    categories: { name_ar: "سر", name_en: "Secret" },
    error_reports: { hash: `security-${school}`, source: "web", message: "secret" },
    computers: { device_id: "mac-test-0001" },
    face_checks: { student_code: "S1", mac_id: 1, photo_id: photo.id, box: {} },
    frames: { name: "Frame", storage_path: `${school}/frame.png` },
    invites: { role: "teacher", email: "teacher@test.local" },
    meta_connections: {},
    post_comments: { post_id: post.id, body: "secret" },
    post_metrics: { post_id: post.id, platform: "facebook" },
    post_photos: { post_id: post.id, photo_id: photo.id },
    post_versions: { post_id: post.id },
    problem_reports: { body: "secret" },
    review_links: { post_id: post.id, label: "Review" },
    school_integrations: {},
    shared_album_photos: { album_id: album.id, photo_id: photo.id },
    snippets: { title: "Secret", body: "secret" },
    student_coverage: { student_code: "S1" },
    students: { full_name: "Secret Student" },
    team_alerts: { kind: "import" },
    time_slots: { weekday: 1, at_time: "09:00" },
    upload_links: { event_id: ev.id, label: "Photographer" },
    user_prefs: { user_id: userId },
  };
  const made: Record<string, Record<string, unknown>> = { events: ev, photos: photo, posts: post, books: book, shared_albums: album };
  for (const [t, r] of Object.entries(rows)) made[t] = await one(t, r);
  return made;
}

// Only the server reads these (sign-in tokens for Facebook/Instagram; error
// reports for the builder; alerts waiting to be emailed).
const SERVER_ONLY = ["meta_connections", "error_reports", "alert_outbox"];
let A: Awaited<ReturnType<typeof makeSchool>>;
let B: Awaited<ReturnType<typeof makeSchool>>;
let bRows: Record<string, Record<string, unknown>>;
const tables = () => Object.keys(bRows);

test.beforeAll(async () => {
  const sb = admin();
  A = await makeSchool(sb, "a");
  B = await makeSchool(sb, "b");
  bRows = await seed(sb, B.id, B.userId);
  await sb.storage.from("photos").upload(`${B.id}/secret.jpg`, Buffer.from("secret"), { contentType: "image/jpeg" });
});

test("every school table is covered by this check", async () => {
  // A new table with school data must be added to the seed above.
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: service, Authorization: `Bearer ${service}` } });
  const spec = (await res.json()) as { definitions: Record<string, { properties: Record<string, unknown> }> };
  const withSchool = Object.entries(spec.definitions).filter(([, d]) => "school_id" in d.properties).map(([t]) => t).filter((t) => !t.startsWith("v_") && t !== "memberships");
  const views = new Set(["student_coverage_view"]);
  expect(withSchool.filter((t) => !views.has(t) && !tables().includes(t))).toEqual([]);
});

test("school B's own admin sees its data (so the checks below mean something)", async () => {
  const unseen: string[] = [];
  for (const t of tables()) {
    const { data, error } = await B.client.from(t).select("*").eq("school_id", B.id);
    expect(error, t).toBeNull();
    if (!data?.length) unseen.push(t);
  }
  // Only the server reads these (sign-in tokens for Facebook/Instagram etc.).
  expect(unseen.sort()).toEqual([...SERVER_ONLY].sort());
});

test("another school can't read, change or delete it", async () => {
  for (const t of tables()) {
    const read = await A.client.from(t).select("*").eq("school_id", B.id);
    expect(read.data ?? [], `read ${t}`).toEqual([]);
    const moved = await A.client.from(t).update({ school_id: A.id }).eq("school_id", B.id).select();
    expect(moved.data ?? [], `update ${t}`).toEqual([]);
    const gone = await A.client.from(t).delete().eq("school_id", B.id).select();
    expect(gone.data ?? [], `delete ${t}`).toEqual([]);
  }
  // Still all there.
  for (const t of tables()) {
    const { data } = await admin().from(t).select("school_id").eq("school_id", B.id);
    expect(data?.length, `still there: ${t}`).toBeGreaterThan(0);
  }
  const school = await A.client.from("schools").select("*").eq("id", B.id);
  expect(school.data ?? []).toEqual([]);
  const rename = await A.client.from("schools").update({ name: "Hacked" }).eq("id", B.id).select();
  expect(rename.data ?? []).toEqual([]);
});

test("another school can't add rows to it", async () => {
  for (const t of tables()) {
    const row = { ...bRows[t] };
    for (const k of ["id", "created_at", "updated_at"]) delete row[k];
    const { error } = await A.client.from(t).insert(row);
    expect(error, `insert ${t}`).not.toBeNull();
  }
});

test("nobody can make themselves a member of another school", async () => {
  const join = await A.client.from("memberships").insert({ school_id: B.id, user_id: A.userId, role: "admin", full_name: "Intruder" });
  expect(join.error).not.toBeNull();
  const invite = await A.client.from("invites").insert({ school_id: B.id, role: "admin", email: "intruder@test.local" });
  expect(invite.error).not.toBeNull();
  const promote = await A.client.from("memberships").update({ school_id: B.id }).eq("user_id", A.userId).select();
  expect(promote.data ?? []).toEqual([]);
  const members = await admin().from("memberships").select("user_id").eq("school_id", B.id);
  expect(members.data?.map((m) => m.user_id)).toEqual([B.userId]);
});

test("photos in storage: another school can't open or add files", async () => {
  const get = await A.client.storage.from("photos").download(`${B.id}/secret.jpg`);
  expect(get.data).toBeNull();
  const put = await A.client.storage.from("photos").upload(`${B.id}/evil.jpg`, Buffer.from("x"), { contentType: "image/jpeg" });
  expect(put.error).not.toBeNull();
  const list = await A.client.storage.from("photos").list(B.id);
  expect(list.data ?? []).toEqual([]);
  const own = await B.client.storage.from("photos").download(`${B.id}/secret.jpg`);
  expect(own.data).not.toBeNull();
});

test("someone not signed in sees nothing", async () => {
  const nobody = createClient(url, anon, { auth: { persistSession: false } });
  for (const t of [...tables(), "schools", "memberships"]) {
    const { data } = await nobody.from(t).select("*").limit(1);
    expect(data ?? [], t).toEqual([]);
  }
  const get = await nobody.storage.from("photos").download(`${B.id}/secret.jpg`);
  expect(get.data).toBeNull();
});

test("a teacher can't make themselves an admin or add staff", async () => {
  const sb = admin();
  const email = `sec-teacher-${Date.now()}@test.local`;
  const { data: u } = await sb.auth.admin.createUser({ email, password: "Test-password-123", email_confirm: true });
  await sb.from("memberships").insert({ school_id: A.id, user_id: u.user!.id, role: "teacher", full_name: "Teacher A" });
  const t = createClient(url, anon, { auth: { persistSession: false } });
  await t.auth.signInWithPassword({ email, password: "Test-password-123" });
  const up = await t.from("memberships").update({ role: "admin" }).eq("user_id", u.user!.id).select();
  expect(up.data ?? []).toEqual([]);
  const add = await t.from("memberships").insert({ school_id: A.id, user_id: u.user!.id, role: "admin", full_name: "Teacher A" });
  expect(add.error).not.toBeNull();
  const inv = await t.from("invites").insert({ school_id: A.id, role: "admin", email: "friend@test.local" });
  expect(inv.error).not.toBeNull();
  const role = await sb.from("memberships").select("role").eq("user_id", u.user!.id).single();
  expect(role.data?.role).toBe("teacher");
});

test("server functions refuse another school", async () => {
  const calls: [string, Record<string, unknown>][] = [
    ["set_school_profile", { p_school: B.id, p_profile: { tone: "hacked" } }],
    ["set_posting_pause", { p_school: B.id, p_until: new Date(Date.now() + 864e5).toISOString(), p_reason: "x" }],
    ["set_account_paused", { p_school: B.id, p_platform: "facebook", p_paused: true }],
  ];
  for (const [fn, args] of calls) {
    const { error } = await A.client.rpc(fn, args);
    expect(error, fn).not.toBeNull();
  }
  const reg = await A.client.rpc("register_computer", { p_school: B.id, p_device: "intruder-mac-01", p_name: "x", p_platform: "mac" });
  expect(reg.data).toEqual({ error: "role" });
  // This one quietly does nothing for another school.
  await A.client.rpc("learn_caption", { p_school: B.id, p_text: "hacked" });
  const prof = await admin().from("schools").select("profile").eq("id", B.id).single();
  expect(JSON.stringify(prof.data?.profile ?? {})).not.toContain("hacked");
  const meta = await A.client.rpc("meta_status", { p_school: B.id });
  expect(meta.data ?? []).toEqual([]);
  const tick = await A.client.rpc("tick_shot", { p_event: bRows.events.id, p_code: "S1", p_done: true });
  expect(tick.error).not.toBeNull();
  const computers = await admin().from("computers").select("device_id").eq("school_id", B.id);
  expect(computers.data?.map((c) => c.device_id)).toEqual(["mac-test-0001"]);
});

test("pages send the safety headers", async ({ request }) => {
  const res = await request.get("/en/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["content-security-policy"]).toContain("base-uri 'self'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});
