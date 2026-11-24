import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Security review 21 Nov 2026 (S-21N-03 to 06, migration 0023), tried the
// way an attacker would: straight through the database with a real sign-in.
test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "no test database");
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "runs once, not per screen size"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const password = "Test-password-123";
const admin = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function member(schoolId: string, role: string) {
  const email = `sec21-${role}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const { data } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  await admin().from("memberships").insert({ school_id: schoolId, user_id: data.user!.id, role, full_name: role });
  const { data: s } = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  return Object.assign(createClient(url, anon, { global: { headers: { Authorization: `Bearer ${s.session!.access_token}` } }, auth: { persistSession: false } }), { uid: data.user!.id });
}

async function school(name: string) {
  const { data } = await admin().from("schools").insert({ name: `${name} ${Date.now()}` }).select("id").single();
  return data!.id as string;
}

test("S-21N-03: a photo row can't point at another school's file, even through a sneaky path", async () => {
  const a = await school("Sec A");
  const b = await school("Sec B");
  const lead = await member(a, "comms_lead");
  const foreign = await lead.from("photos").insert({ school_id: a, uploaded_by: lead.uid, storage_path: `${b}/secret.jpg` }).select("id");
  expect(foreign.error?.message).toContain("photos_own_folder");
  const sneaky = await lead.from("photos").insert({ school_id: a, uploaded_by: lead.uid, storage_path: `${a}/../${b}/secret.jpg` }).select("id");
  expect(sneaky.error?.message).toContain("photos_own_folder");
  const own = await lead.from("photos").insert({ school_id: a, uploaded_by: lead.uid, storage_path: `${a}/mine.jpg` }).select("id").single();
  expect(own.error).toBeNull();
  const edit = await lead.from("photos").update({ edited_path: `${b}/secret.jpg` }).eq("id", own.data!.id).select("id");
  expect(edit.error?.message).toContain("photos_own_folder");
});

test("S-21N-04: a teacher can't fetch the library key; a comms lead can", async () => {
  const a = await school("Sec key");
  const teacher = await member(a, "teacher");
  const lead = await member(a, "comms_lead");
  const reg = await lead.rpc("register_computer", { p_school: a, p_device: "dev-sec21", p_name: "Mac", p_platform: "darwin" });
  expect(reg.error).toBeNull();
  const t = await teacher.rpc("licence", { p_school: a, p_device: "dev-sec21" });
  expect(t.data).toEqual({ error: "role" });
  const l = await lead.rpc("licence", { p_school: a, p_device: "dev-sec21" });
  expect((l.data as { key: string }).key).toBeTruthy();
});

test("S-21N-05: a read-only school can't send new team alerts", async () => {
  const a = await school("Sec alerts");
  const lead = await member(a, "comms_lead");
  const ok = await lead.from("team_alerts").insert({ school_id: a, kind: "remind", created_by: lead.uid, body: { text: "hi" } });
  expect(ok.error).toBeNull();
  await admin().from("schools").update({ paid_until: "2020-01-01", read_only_days: 60 }).eq("id", a);
  const blocked = await lead.from("team_alerts").insert({ school_id: a, kind: "remind", created_by: lead.uid, body: { text: "hi" } });
  expect(blocked.error?.message).toMatch(/school-(read-only|blocked)/);
});

test("S-21N-06: posts, photos and links can't use another school's event, category or frame", async () => {
  const a = await school("Sec link A");
  const b = await school("Sec link B");
  const { data: ev } = await admin().from("events").insert({ school_id: b, title: "B's event", event_date: "2026-11-01" }).select("id").single();
  const { data: cat } = await admin().from("categories").insert({ school_id: b, name_en: "B category", name_ar: "تصنيف" }).select("id").single();
  const lead = await member(a, "comms_lead");
  const post = await lead.from("posts").insert({ school_id: a, event_id: ev!.id }).select("id");
  expect(post.error?.message).toContain("other-school-link");
  const post2 = await lead.from("posts").insert({ school_id: a, category_id: cat!.id }).select("id");
  expect(post2.error?.message).toContain("other-school-link");
  const photo = await lead.from("photos").insert({ school_id: a, uploaded_by: lead.uid, storage_path: `${a}/x.jpg`, event_id: ev!.id }).select("id");
  expect(photo.error?.message).toContain("other-school-link");
  const { data: mine } = await admin().from("events").insert({ school_id: a, title: "A's event", event_date: "2026-11-01" }).select("id").single();
  const good = await lead.from("posts").insert({ school_id: a, event_id: mine!.id }).select("id");
  expect(good.error).toBeNull();
});
