import assert from "node:assert/strict";
import { test } from "node:test";
import { promoteYears } from "./students";

// Flaws found 11 Nov 2026 in the app's other features (thread "Find flaws
// in faces and app features"). Each test fails on the code before the fix.

// B-87: "New school year" in September recorded last year's classes under
// the new year; done in June, it was offered again in September as not done.
test("B-87: New school year keeps the right year, done in June or in September", () => {
  const june = new Date(2026, 5, 20), sept = new Date(2026, 8, 10), dec = new Date(2026, 11, 1), feb = new Date(2027, 1, 1);
  // First time, in June: 2025-2026 ends, next is 2026-2027
  assert.deepEqual(promoteYears(june, null), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  // First time, in September (new lists): still 2025-2026's classes, next is this year
  assert.deepEqual(promoteYears(sept, null), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  assert.deepEqual(promoteYears(sept, "2024-2025"), { year: "2025-2026", next: "2026-2027", alreadyDone: false });
  // Done in June, opened again in September or December: already done
  assert.deepEqual(promoteYears(sept, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  assert.deepEqual(promoteYears(dec, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  // Done in June 2026, opened in June 2026 again: already done
  assert.deepEqual(promoteYears(june, "2025-2026"), { year: "2025-2026", next: "2026-2027", alreadyDone: true });
  // February: the year that's running ends in the summer
  assert.deepEqual(promoteYears(feb, "2025-2026"), { year: "2026-2027", next: "2027-2028", alreadyDone: false });
});
