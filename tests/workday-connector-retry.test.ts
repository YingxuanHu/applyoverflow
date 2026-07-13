import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryWorkdayFetchError } from "../src/lib/ingestion/connectors/workday";

test("does not retry a Workday rate limit before source backoff can run", () => {
  assert.equal(
    shouldRetryWorkdayFetchError(
      new Error("Fetch failed: 429 Too Many Requests | [workday api]")
    ),
    false
  );
});

test("keeps retrying transient Workday transport failures", () => {
  assert.equal(
    shouldRetryWorkdayFetchError(new Error("fetch failed: socket hang up")),
    true
  );
  assert.equal(
    shouldRetryWorkdayFetchError(new Error("request timed out")),
    true
  );
});

test("does not retry deterministic Workday source failures", () => {
  assert.equal(
    shouldRetryWorkdayFetchError(new Error("Fetch failed: 410 Gone")),
    false
  );
});
