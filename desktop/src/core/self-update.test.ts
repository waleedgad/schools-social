import assert from "node:assert/strict";
import { test } from "node:test";
import { canSelfUpdate } from "./self-update";

test("self-update: Windows always, Mac only when signed with Developer ID", () => {
  const signed = () => "Authority=Developer ID Application: School Social Hub (ABCDE12345)\nAuthority=Developer ID Certification Authority";
  assert.equal(canSelfUpdate("win32", true, () => null), true);
  assert.equal(canSelfUpdate("darwin", true, signed), true);
  // Unsigned or only signed locally ("ad-hoc"): keeps the Versions folder steps.
  assert.equal(canSelfUpdate("darwin", true, () => "Signature=adhoc"), false);
  assert.equal(canSelfUpdate("darwin", true, () => null), false);
  // Not a built app (robot tests, development): never.
  assert.equal(canSelfUpdate("win32", false, () => null), false);
  assert.equal(canSelfUpdate("linux", true, () => null), false);
});
