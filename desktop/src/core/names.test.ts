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
});
