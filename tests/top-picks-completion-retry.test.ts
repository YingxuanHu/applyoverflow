import { test } from "node:test";
import assert from "node:assert/strict";
import { retryRefreshCompletion } from "../src/lib/top-picks/completion-retry";

test("refresh completion recovers transient pool pressure with bounded backoff", async () => {
  for (const code of ["P2024", "P2028", "P1001", "P1017"]) {
    let attempts = 0;
    const delays: number[] = [];
    const result = await retryRefreshCompletion(async () => {
      if (++attempts < 3) throw Object.assign(new Error("pool unavailable"), { code });
      return { status: "PENDING" };
    }, async ms => { delays.push(ms); });
    assert.deepEqual(result, { status: "PENDING" });
    assert.deepEqual(delays, [250, 500]);
  }
});

test("refresh completion preserves supersession and stops on persistent or non-transient failure", async () => {
  assert.equal(await retryRefreshCompletion(async () => null), null);
  for (const [code, expected] of [["P2024", 3], ["P2010", 1]] as const) {
    let attempts = 0;
    const error = Object.assign(new Error("database failure"), { code });
    await assert.rejects(retryRefreshCompletion(async () => { attempts++; throw error; }, async () => {}), error);
    assert.equal(attempts, expected);
  }
});
