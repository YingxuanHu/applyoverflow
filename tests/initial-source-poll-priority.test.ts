import assert from "node:assert/strict";
import test from "node:test";

import { getValidatedSourceFastTrackPollPriority } from "../src/lib/ingestion/source-bootstrap-poll-priority";

test("a newly validated source outranks routine refresh work for its first poll", () => {
  assert.equal(
    getValidatedSourceFastTrackPollPriority({
      priorityScore: 0.95,
      pollAttemptCount: 0,
      pollSuccessCount: 0,
      lastSuccessfulPollAt: null,
    }),
    225_000
  );
});

test("an established source keeps its normal refresh priority", () => {
  assert.equal(
    getValidatedSourceFastTrackPollPriority({
      priorityScore: 0.95,
      pollAttemptCount: 1,
      pollSuccessCount: 1,
      lastSuccessfulPollAt: new Date("2026-07-14T00:00:00.000Z"),
    }),
    95
  );
});
