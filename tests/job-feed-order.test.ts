import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalFeedOrderBy,
  buildJobFeedIndexOrderBy,
} from "../src/lib/queries/job-feed-order";
import type { JobSortBy } from "../src/lib/queries/jobs";

const SORTS: Array<JobSortBy | undefined> = [
  undefined,
  "relevance",
  "newest",
  "deadline",
  "company",
];

test("every feed-index ordering ends with a unique canonicalJobId tiebreaker", () => {
  for (const sortBy of SORTS) {
    const orderBy = buildJobFeedIndexOrderBy(sortBy);
    assert.ok(Array.isArray(orderBy) && orderBy.length >= 1);
    assert.deepEqual(orderBy.at(-1), { canonicalJobId: "desc" });
    // The tiebreaker must appear exactly once and only as the final key.
    const tiebreakerCount = orderBy.filter(
      (clause) => "canonicalJobId" in clause
    ).length;
    assert.equal(tiebreakerCount, 1);
  }
});

test("every canonical feed ordering ends with a unique id tiebreaker", () => {
  for (const sortBy of SORTS) {
    const orderBy = buildCanonicalFeedOrderBy(sortBy);
    assert.ok(Array.isArray(orderBy) && orderBy.length >= 1);
    assert.deepEqual(orderBy.at(-1), { id: "desc" });
    const tiebreakerCount = orderBy.filter((clause) => "id" in clause).length;
    assert.equal(tiebreakerCount, 1);
  }
});

test("primary sort keys are preserved ahead of the tiebreaker", () => {
  assert.deepEqual(buildJobFeedIndexOrderBy("newest"), [
    { postedAt: "desc" },
    { canonicalJobId: "desc" },
  ]);
  assert.deepEqual(buildCanonicalFeedOrderBy("company"), [
    { company: "asc" },
    { postedAt: "desc" },
    { id: "desc" },
  ]);
  // Default (relevance/undefined) canonical feed falls back to newest-first.
  assert.deepEqual(buildCanonicalFeedOrderBy(undefined), [
    { postedAt: "desc" },
    { id: "desc" },
  ]);
});
