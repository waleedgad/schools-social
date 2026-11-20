import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { goneWebCopies } from "./web";

// 0.13: the website removes web copies older than 6 months that were never
// used. Before photos go into a post, the app asks which of its website ids
// are gone, forgets them and sends those photos again.

function fakeSite(there: string[], fail = false) {
  const asked: string[][] = [];
  const sb = {
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => {
          asked.push(ids);
          return fail ? { data: null, error: { message: "offline" } } : { data: ids.filter((id) => there.includes(id)).map((id) => ({ id })), error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { sb, asked };
}

test("ids the website no longer has are reported as gone", async () => {
  const { sb } = fakeSite(["a", "c"]);
  assert.deepEqual(await goneWebCopies(sb, ["a", "b", "c", "d"]), ["b", "d"]);
});

test("when the website can't be reached, nothing counts as gone", async () => {
  const { sb } = fakeSite([], true);
  assert.deepEqual(await goneWebCopies(sb, ["a", "b"]), []);
});

test("many ids are asked in parts of 200", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
  const { sb, asked } = fakeSite(ids.slice(0, 449));
  assert.deepEqual(await goneWebCopies(sb, ids), ["p449"]);
  assert.deepEqual(asked.map((a) => a.length), [200, 200, 50]);
});
