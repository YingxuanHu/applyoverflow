import assert from "node:assert/strict";
import test from "node:test";
import { buildUrlHealthDueWhere, URL_HEALTH_CHECK_ORDER } from "../src/lib/ingestion/url-health-cadence";

test("URL checks include unseen jobs but do not recheck recent results every cycle", () => {
  assert.deepEqual(buildUrlHealthDueWhere(new Date("2026-10-21T18:00:00Z")), {
    OR: [
      { lastApplyCheckAt: null },
      { lastApplyCheckAt: { lte: new Date("2026-10-21T12:00:00Z") } },
    ],
  });
});

test("unverified jobs cannot be starved by PostgreSQL's default nulls-last ordering", () => {
  assert.deepEqual(URL_HEALTH_CHECK_ORDER, { lastApplyCheckAt: { sort: "asc", nulls: "first" } });
});
