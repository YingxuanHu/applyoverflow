import assert from "node:assert/strict";
import test from "node:test";

import { getBulkRecoverySleepMs } from "../src/lib/ingestion/bulk-recovery-schedule";

test("uses the short catch-up delay after active recovery work", () => {
  assert.equal(
    getBulkRecoverySleepMs({
      results: [{ skipped: "not due", nextDueInMs: 60_000 }, {}],
      catchupSeconds: 30,
      fallbackIntervalMinutes: 90,
    }),
    30_000
  );
});

test("wakes an all-skipped loop when the earliest connector is due", () => {
  assert.equal(
    getBulkRecoverySleepMs({
      results: [
        { skipped: "not due", nextDueInMs: 22 * 60_000 },
        { skipped: "not due", nextDueInMs: 64 * 60_000 },
      ],
      catchupSeconds: 30,
      fallbackIntervalMinutes: 90,
    }),
    22 * 60_000
  );
});

test("bounds idle sleeps and avoids a zero-delay retry loop", () => {
  assert.equal(
    getBulkRecoverySleepMs({
      results: [{ skipped: "not due", nextDueInMs: 0 }],
      catchupSeconds: 30,
      fallbackIntervalMinutes: 90,
    }),
    1_000
  );

  assert.equal(
    getBulkRecoverySleepMs({
      results: [{ skipped: "not due", nextDueInMs: 3 * 60 * 60_000 }],
      catchupSeconds: 30,
      fallbackIntervalMinutes: 90,
    }),
    90 * 60_000
  );
});
