import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  JOB_BOARD_MIN_AVAILABILITY_SCORE,
  buildApplyableVisibilityWhere,
  buildDefaultCanonicalVisibilityWhere,
} from "../src/lib/jobs/visibility";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("default job-board visibility requires live, recent, applyable jobs", () => {
  const where = JSON.stringify(buildDefaultCanonicalVisibilityWhere(new Date("2026-06-19")));

  assert.equal(JOB_BOARD_MIN_AVAILABILITY_SCORE, 60);
  assert.match(where, /"status":"LIVE"/);
  assert.match(where, /"availabilityScore"/);
  assert.match(where, /"deadSignalAt":null/);
  assert.match(where, /"applyUrlValidationStatus"/);
  assert.match(where, /"deadline"/);
  assert.match(where, /"lastConfirmedAliveAt"/);
  assert.match(where, /"lastSourceSeenAt"/);
});

test("applyable visibility hides known bad links without hiding unvalidated jobs", () => {
  const where = JSON.stringify(buildApplyableVisibilityWhere());

  assert.match(where, /"applyUrlValidationStatus":null/);
  assert.match(where, /"notIn"/);
  assert.match(where, /"BROKEN_APPLY_LINK"/);
  assert.match(where, /"GENERIC_APPLY_PAGE"/);
});

test("feed, detail, top picks, and summary use strict canonical visibility", () => {
  const jobsQuerySource = readRepoFile("src/lib/queries/jobs.ts");
  const applicationQuerySource = readRepoFile("src/lib/queries/applications.ts");
  const topPicksQuerySource = readRepoFile("src/lib/queries/top-picks.ts");
  const topPicksServiceSource = readRepoFile("src/lib/top-picks/service.ts");
  const topPicksGatesSource = readRepoFile("src/lib/top-picks/gates.ts");
  const summarySource = readRepoFile("scripts/refresh-job-feed-summary.ts");

  assert.match(jobsQuerySource, /buildDefaultJobBoardVisibilityWhere\(now, DEFAULT_MIN_AVAILABILITY_SCORE\)/);
  assert.match(jobsQuerySource, /canonicalRelationWhere/);
  assert.match(jobsQuerySource, /prisma\.jobCanonical\.findFirst/);
  assert.match(jobsQuerySource, /AND: \[buildDefaultJobBoardVisibilityWhere\(now, DEFAULT_MIN_AVAILABILITY_SCORE\)\]/);
  assert.match(applicationQuerySource, /JOB_BOARD_MIN_AVAILABILITY_SCORE/);
  assert.match(applicationQuerySource, /hasRecentLiveEvidence/);
  assert.match(topPicksQuerySource, /buildDefaultCanonicalVisibilityWhere/);
  assert.match(topPicksServiceSource, /canonicalJob:\s*\{\s*is: buildDefaultCanonicalVisibilityWhere\(\)/);
  assert.match(topPicksGatesSource, /SOURCE_STALE/);
  assert.match(topPicksGatesSource, /HIDDEN_LOW_QUALITY/);
  assert.match(topPicksGatesSource, /job\.availabilityScore \?\? 100\) < 60/);
  assert.match(summarySource, /visibleCanonicalWhere/);
});
