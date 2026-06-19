import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("top picks refresh more often and hide applied jobs", () => {
  const configSource = readRepoFile("src/lib/top-picks/config.ts");
  const querySource = readRepoFile("src/lib/queries/top-picks.ts");
  const serviceSource = readRepoFile("src/lib/top-picks/service.ts");
  const invalidationSource = readRepoFile("src/lib/top-picks/invalidation.ts");
  const trackerSource = readRepoFile("src/lib/queries/tracker.ts");
  const markAppliedSource = readRepoFile("src/app/api/jobs/[id]/mark-applied/route.ts");
  const topPicksComponentSource = readRepoFile("src/components/jobs/top-picks.tsx");

  assert.match(configSource, /TOP_PICKS_REFRESH_MAX_AGE_MINUTES[\s\S]*\?\? 60/);
  assert.match(querySource, /trackedApplications:\s*\{\s*none:/);
  assert.match(querySource, /status:\s*\{\s*notIn:\s*\["WISHLIST", "PREPARING"\]/);
  assert.match(serviceSource, /const visibleTopPickWhere/);
  assert.match(invalidationSource, /export async function invalidateTopPickForUserJob/);
  assert.match(invalidationSource, /reason: input\.reason \?\? "top_pick_no_longer_eligible"/);
  assert.match(trackerSource, /invalidateAppliedTopPick/);
  assert.match(trackerSource, /reason: "application_status_changed"/);
  assert.match(markAppliedSource, /"\/jobs\/top-picks"/);
  assert.match(topPicksComponentSource, /TOP_PICKS_AUTO_REFRESH_RETRY_MS = 15 \* 60_000/);
});
