import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("high-risk API routes guard large request bodies before parsing", () => {
  const apiUtils = readRepoFile("src/lib/api-utils.ts");
  const applicationCreateRoute = readRepoFile("src/app/api/applications/route.ts");
  const resumeUploadRoute = readRepoFile("src/app/api/profile/resumes/route.ts");
  const autoApplyRoute = readRepoFile("src/app/api/jobs/[id]/auto-apply/route.ts");
  const notesRoute = readRepoFile("src/app/api/jobs/[id]/notes/route.ts");

  assert.match(apiUtils, /API_BODY_LIMITS/);
  assert.match(apiUtils, /requestSizeLimitResponse/);
  assert.match(applicationCreateRoute, /requestSizeLimitResponse/);
  assert.match(resumeUploadRoute, /requestSizeLimitResponse/);
  assert.match(autoApplyRoute, /requestSizeLimitResponse/);
  assert.match(notesRoute, /requestSizeLimitResponse/);
});

test("auth and expensive refresh routes are throttled outside business logic", () => {
  const authRoute = readRepoFile("src/app/api/auth/[...all]/route.ts");
  const topPicksRefreshRoute = readRepoFile("src/app/api/jobs/top-picks/refresh/route.ts");

  assert.match(authRoute, /rateLimitAuthPost/);
  assert.match(authRoute, /consumeAuthRateLimit/);
  assert.match(topPicksRefreshRoute, /shouldKickTopPicksRefreshInline/);
  assert.match(topPicksRefreshRoute, /NODE_ENV !== "production"/);
});

test("repeat user actions are idempotent or deduped", () => {
  const savedJobsQueries = readRepoFile("src/lib/queries/saved-jobs.ts");
  const behaviorQueries = readRepoFile("src/lib/queries/behavior.ts");

  assert.match(savedJobsQueries, /savedJob\.deleteMany/);
  assert.doesNotMatch(savedJobsQueries, /savedJob\.delete\(/);
  assert.match(behaviorQueries, /USER_ACTION_DEDUP_WINDOW_MS/);
  assert.match(behaviorQueries, /userBehaviorSignal\.findFirst/);
});

test("jobs API has pagination bounds and slow-request diagnostics", () => {
  const jobsRoute = readRepoFile("src/app/api/jobs/route.ts");
  const apiUtils = readRepoFile("src/lib/api-utils.ts");

  assert.match(apiUtils, /parseBoundedIntParam/);
  assert.match(jobsRoute, /max:\s*1000/);
  assert.match(jobsRoute, /logSlowJobsRequest/);
  assert.match(jobsRoute, /\[api\.jobs\] slow request/);
});
