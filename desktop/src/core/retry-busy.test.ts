import assert from "node:assert/strict";
import { test } from "node:test";
import { retryBusy } from "./retry-busy";

const err = (code: string) => Object.assign(new Error(code), { code });

test("a busy file is tried again; other errors are not", async () => {
  let n = 0;
  assert.equal(await retryBusy(async () => (++n < 3 ? Promise.reject(err("EBUSY")) : "moved")), "moved");
  assert.equal(n, 3);
  let m = 0;
  await assert.rejects(retryBusy(async () => (m++, Promise.reject(err("ENOENT")))), /ENOENT/);
  assert.equal(m, 1);
  let k = 0;
  await assert.rejects(retryBusy(async () => (k++, Promise.reject(err("EPERM"))), 3), /EPERM/);
  assert.equal(k, 3);
});
