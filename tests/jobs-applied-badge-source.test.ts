import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("job cards expose and render applied state from tracked applications", () => {
  const jobsTypeSource = readRepoFile("src/types/jobs.ts");
  const serializerSource = readRepoFile("src/lib/job-serialization.ts");
  const jobsQuerySource = readRepoFile("src/lib/queries/jobs.ts");
  const jobsPageSource = readRepoFile("src/app/jobs/page.tsx");
  const cardSource = readRepoFile("src/components/jobs/job-summary-card.tsx");

  assert.match(jobsTypeSource, /hasApplied: boolean/);
  assert.match(serializerSource, /hasApplied: Boolean\(job\.hasApplied\)/);
  assert.match(jobsQuerySource, /trackedApplications:/);
  assert.match(jobsQuerySource, /TRACKED_APPLICATION_NOT_APPLIED_STATUSES/);
  assert.match(jobsQuerySource, /hasApplied: trackedApplications\.length > 0/);
  assert.match(jobsPageSource, /authUserId/);
  assert.match(jobsPageSource, /hasApplied: job\.hasApplied/);
  assert.match(cardSource, /job\.hasApplied/);
  assert.match(cardSource, />\s*Applied\s*</);
});
