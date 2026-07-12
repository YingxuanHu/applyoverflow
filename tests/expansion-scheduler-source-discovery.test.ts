import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceDiscoveryCandidateUpdate } from "@/lib/ingestion/source-candidate-discovery";

test("source discovery records sighting without marking candidate validated", () => {
  const now = new Date("2026-06-26T19:45:00.000Z");
  const update = buildSourceDiscoveryCandidateUpdate(now);

  assert.equal(update.lastSeenAt, now);
  assert.equal(update.lastError, null);
  assert.equal("status" in update, false);
  assert.equal("lastValidatedAt" in update, false);
});
