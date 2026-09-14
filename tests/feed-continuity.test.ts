import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feedPositionKey,
  jobIdFromHash,
  parseFeedPosition,
} from "../src/lib/jobs/feed-continuity";

test("feed memory is isolated by user, filters, page, and surface", () => {
  assert.equal(
    feedPositionKey("a", "/jobs?page=2&titleSearch=test"),
    feedPositionKey("a", "/jobs?titleSearch=test&page=2#job-a"),
  );
  assert.notEqual(feedPositionKey("a", "/jobs"), feedPositionKey("b", "/jobs"));
  assert.notEqual(
    feedPositionKey("a", "/jobs?page=2"),
    feedPositionKey("a", "/jobs?page=3"),
  );
  assert.notEqual(
    feedPositionKey("a", "/jobs"),
    feedPositionKey("a", "/jobs/top-picks"),
  );
});
test("feed memory rejects malformed, expired, and invalid scroll positions", () => {
  const position = { jobId: "id", listTop: 150, detailTop: 200, savedAt: 1000 };
  assert.deepEqual(parseFeedPosition(JSON.stringify(position), 2000), position);
  for (const value of [
    "broken",
    "null",
    "{}",
    JSON.stringify({ ...position, listTop: -1 }),
    JSON.stringify({ ...position, savedAt: 3000 }),
  ])
    assert.equal(parseFeedPosition(value, 2000), null);
  assert.equal(parseFeedPosition(JSON.stringify(position), 86_402_000), null);
  assert.equal(jobIdFromHash("#job-test_123"), "test_123");
  assert.equal(jobIdFromHash("#job-<script>"), null);
});
