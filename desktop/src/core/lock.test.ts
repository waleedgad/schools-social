import { test } from "node:test";
import assert from "node:assert/strict";
import { exclusive } from "./lock";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("exclusive: one job at a time, in order", async () => {
  const log: string[] = [];
  let live = 0, most = 0;
  const job = (name: string) => () => (async () => {
    live++; most = Math.max(most, live);
    await wait(5);
    log.push(name);
    live--;
  })();
  await Promise.all([exclusive(job("a")), exclusive(job("b")), exclusive(job("c"))]);
  assert.deepEqual(log, ["a", "b", "c"]);
  assert.equal(most, 1);
});

test("exclusive: a failing job doesn't stop the line", async () => {
  const bad = exclusive(async () => { throw new Error("boom"); });
  const good = exclusive(async () => 7);
  await assert.rejects(bad, /boom/);
  assert.equal(await good, 7);
});

test("B-96: a picture someone is waiting for goes ahead of waiting background jobs", async () => {
  const log: string[] = [];
  const job = (name: string, ms = 5) => async () => { await wait(ms); log.push(name); };
  const running = exclusive(job("running", 30));
  const bg = [exclusive(job("bg1")), exclusive(job("bg2")), exclusive(job("bg3"))];
  const face = exclusive(job("face"), { urgent: true });
  const face2 = exclusive(job("face2"), { urgent: true });
  await Promise.all([running, ...bg, face, face2]);
  // The running job isn't interrupted; the urgent ones go next, in order.
  assert.deepEqual(log, ["running", "face", "face2", "bg1", "bg2", "bg3"]);
});
