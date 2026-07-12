import assert from "node:assert/strict";
import test from "node:test";

import {
  getSourceCandidateValidationMissStatus,
  getSourceCandidateValidationSkipReason,
} from "@/lib/ingestion/source-candidate-validation-guard";

const NOW = new Date("2026-06-26T12:00:00.000Z");

function candidate(overrides: {
  status?: "NEW" | "VALIDATED" | "PROMOTED" | "REJECTED" | "STALE";
  failureCount?: number;
  lastValidatedAt?: Date | null;
} = {}) {
  return {
    status: overrides.status ?? "NEW",
    failureCount: overrides.failureCount ?? 0,
    lastValidatedAt: overrides.lastValidatedAt ?? null,
  };
}

test("source validation skips recently failed stale candidates", () => {
  const reason = getSourceCandidateValidationSkipReason(
    candidate({
      status: "STALE",
      lastValidatedAt: new Date("2026-06-26T00:30:00.000Z"),
    }),
    NOW
  );

  assert.match(reason ?? "", /recently failed source candidate/);
});

test("source validation allows stale candidates after retry window", () => {
  const reason = getSourceCandidateValidationSkipReason(
    candidate({
      status: "STALE",
      lastValidatedAt: new Date("2026-06-24T00:00:00.000Z"),
    }),
    NOW
  );

  assert.equal(reason, null);
});

test("source validation skips exhausted and terminal candidates", () => {
  assert.match(
    getSourceCandidateValidationSkipReason(
      candidate({ status: "NEW", failureCount: 5 }),
      NOW
    ) ?? "",
    /exhausted/
  );
  assert.match(
    getSourceCandidateValidationSkipReason(candidate({ status: "PROMOTED" }), NOW) ??
      "",
    /promoted/
  );
  assert.match(
    getSourceCandidateValidationSkipReason(candidate({ status: "REJECTED" }), NOW) ??
      "",
    /rejected/
  );
});

test("source validation permits an explicit promoted-source repair", () => {
  assert.equal(
    getSourceCandidateValidationSkipReason(
      {
        ...candidate({ status: "PROMOTED" }),
        allowPromotedRepair: true,
      },
      NOW
    ),
    null
  );
});

test("source validation rejects hard missing candidate pages", () => {
  assert.equal(
    getSourceCandidateValidationMissStatus(
      "PREVIEW_ERROR: Preview failed: Company site fetch failed: 404 Not Found"
    ),
    "REJECTED"
  );
  assert.equal(
    getSourceCandidateValidationMissStatus("PREVIEW_ERROR: 410 Gone"),
    "REJECTED"
  );
});

test("source validation keeps transient and no-yield misses retryable", () => {
  assert.equal(
    getSourceCandidateValidationMissStatus("PREVIEW_ERROR: fetch failed"),
    "STALE"
  );
  assert.equal(
    getSourceCandidateValidationMissStatus("NO_YIELD: Preview returned no jobs"),
    "STALE"
  );
  assert.equal(
    getSourceCandidateValidationMissStatus("PREVIEW_ERROR: 429 Too Many Requests"),
    "STALE"
  );
});
