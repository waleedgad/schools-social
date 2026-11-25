import assert from "node:assert/strict";
import { test } from "node:test";
import { nameMatches } from "./names";

test("names match across spellings", () => {
  assert.ok(nameMatches("Mohamed", "Muhammad Ali"));
  assert.ok(nameMatches("mohammed", "Mohamed Salah"));
  assert.ok(nameMatches("Youssef", "Yusuf Hassan"));
  assert.ok(nameMatches("Ahmad", "Ahmed Fathy"));
  assert.ok(nameMatches("احمد", "أحمد علي"));
  assert.ok(nameMatches("فاطمه", "فاطمة"));
  assert.ok(!nameMatches("Sara", "Omar"));
  // L-26 (random-input tests): the "Abd" names in every common spelling.
  for (const a of ["Abdel Rahman", "Abdulrahman", "Abd El Rahman", "Abd-el-Rahman", "Abdul Rahman", "Abd Al Rahman"])
    for (const b of ["Abdel Rahman Hassan", "Abdulrahman Hassan", "Abd El Rahman Hassan"]) assert.ok(nameMatches(a, b), `${a} / ${b}`);
  assert.ok(nameMatches("Abdullah", "Abd Allah Omar"));
  assert.ok(!nameMatches("Abdel Rahman", "Abdel Aziz"));
});
