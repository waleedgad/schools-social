// Run with: npm test (release 0.17, Owner > Keys and switches)
import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYS, keyStatus, pickProviders } from "./integrations.ts";

test("a key is on only when every name it needs is set", () => {
  const off = keyStatus({}, {});
  assert.ok(off.every((k) => !k.on));
  assert.deepEqual(off.find((k) => k.key === "meta")?.missing, ["META_APP_ID", "META_APP_SECRET"]);
  const half = keyStatus({ META_APP_ID: "123", META_APP_SECRET: "  " }, {});
  assert.equal(half.find((k) => k.key === "meta")?.on, false);
  assert.deepEqual(half.find((k) => k.key === "meta")?.missing, ["META_APP_SECRET"]);
  const on = keyStatus({ META_APP_ID: "123", META_APP_SECRET: "s", META_CONFIG_ID: "9", GEMINI_API_KEY: "g" }, {});
  assert.equal(on.find((k) => k.key === "meta")?.on, true);
  assert.deepEqual(on.find((k) => k.key === "meta")?.optionalSet, ["META_CONFIG_ID"]);
  assert.equal(on.find((k) => k.key === "gemini")?.on, true);
  // Either name of a pair is enough (Vercel's Supabase integration uses the new one).
  const db = keyStatus({ NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SECRET_KEY: "s" }, {});
  assert.equal(db.find((k) => k.key === "database")?.on, true);
});

test("every key the website reads is on the Keys page", () => {
  const listed = new Set(KEYS.flatMap((k) => [...k.vars.flatMap((v) => v.split("|")), ...(k.optional ?? [])]));
  for (const name of ["GEMINI_API_KEY", "META_APP_ID", "META_APP_SECRET", "RESEND_API_KEY", "CRON_SECRET", "NEXT_PUBLIC_DROPBOX_APP_KEY", "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY", "NEXT_PUBLIC_MICROSOFT_CLIENT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "WHATSAPP_TOKEN", "NEXT_PUBLIC_SITE_URL"]) {
    assert.ok(listed.has(name), name);
  }
});

test("Google and Microsoft sign-in show when switched on in Supabase", () => {
  assert.deepEqual(pickProviders({}, {}), []);
  assert.deepEqual(pickProviders({ google: true, azure: true }, {}), ["google", "azure"]);
  assert.deepEqual(pickProviders({ google: false }, { google: "on" }), ["google"]);
  assert.deepEqual(pickProviders({ google: true, azure: true }, { microsoft: "off" }), ["google"]);
  assert.equal(keyStatus({}, { azure: true }).find((k) => k.key === "microsoftSignIn")?.on, true);
  assert.equal(keyStatus({}, {}).find((k) => k.key === "googleSignIn")?.on, false);
});
