import assert from "node:assert/strict";
import test from "node:test";

import { formatPostedAge } from "../src/lib/job-display";

test("posted age is always phrased as a past posting time", () => {
  const now = "2026-05-31T12:00:00.000Z";

  assert.equal(formatPostedAge("2026-05-31T11:00:00.000Z", now), "1 hour ago");
  assert.equal(formatPostedAge("2026-05-31T12:00:00.000Z", now), "just now");
  assert.equal(formatPostedAge("2026-08-31T12:00:00.000Z", now), "just now");
  assert.doesNotMatch(
    formatPostedAge("2026-08-31T12:00:00.000Z", now),
    /^in /
  );
});
