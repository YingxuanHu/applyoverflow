import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("high-risk API routes guard large request bodies before parsing", () => {
  const apiUtils = readRepoFile("src/lib/api-utils.ts");
  const applicationCreateRoute = readRepoFile("src/app/api/applications/route.ts");
  const resumeUploadRoute = readRepoFile("src/app/api/profile/resumes/route.ts");
  const notesRoute = readRepoFile("src/app/api/jobs/[id]/notes/route.ts");
  const passwordResetRequestRoute = readRepoFile(
    "src/app/api/auth/password-reset/request/route.ts"
  );
  const passwordResetConfirmRoute = readRepoFile(
    "src/app/api/auth/password-reset/confirm/route.ts"
  );
  const resendVerificationRoute = readRepoFile(
    "src/app/api/auth/resend-verification/route.ts"
  );
  const topPicksFeedbackRoute = readRepoFile(
    "src/app/api/jobs/top-picks/feedback/route.ts"
  );

  assert.match(apiUtils, /API_BODY_LIMITS/);
  assert.match(apiUtils, /requestSizeLimitResponse/);
  assert.match(apiUtils, /parseJsonBodyWithLimit/);
  assert.match(apiUtils, /getReader\(\)/);
  assert.match(applicationCreateRoute, /requestSizeLimitResponse/);
  assert.match(resumeUploadRoute, /requestSizeLimitResponse/);
  assert.match(notesRoute, /requestSizeLimitResponse/);
  assert.match(passwordResetRequestRoute, /parseJsonBodyWithLimit/);
  assert.match(passwordResetRequestRoute, /API_BODY_LIMITS\.authJson/);
  assert.match(passwordResetConfirmRoute, /parseJsonBodyWithLimit/);
  assert.match(passwordResetConfirmRoute, /API_BODY_LIMITS\.authJson/);
  assert.match(resendVerificationRoute, /parseJsonBodyWithLimit/);
  assert.match(resendVerificationRoute, /API_BODY_LIMITS\.authJson/);
  assert.match(topPicksFeedbackRoute, /parseJsonBodyWithLimit/);
});

test("removed delegated-application routes and scripts stay deleted", () => {
  const removedPaths = [
    ["src/app/api/jobs/[id]", "auto" + "-apply", "route.ts"].join("/"),
    ["src/app/jobs/[id]", "auto" + "-apply", "page.tsx"].join("/"),
    ["src/app/api/preferences", "jobs-search-state", "route.ts"].join("/"),
    ["src", "lib", "autom" + "ation"].join("/"),
    ["scripts", "auto" + "-apply.ts"].join("/"),
  ];

  for (const path of removedPaths) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} should not exist`
    );
  }
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
  const trackerQueries = readRepoFile("src/lib/queries/tracker.ts");

  assert.match(savedJobsQueries, /savedJob\.deleteMany/);
  assert.doesNotMatch(savedJobsQueries, /savedJob\.delete\(/);
  assert.match(behaviorQueries, /USER_ACTION_DEDUP_WINDOW_MS/);
  assert.match(behaviorQueries, /userBehaviorSignal\.findFirst/);
  assert.match(trackerQueries, /isUniqueConstraintError/);
  assert.match(trackerQueries, /createTrackedApplicationFromJobOrRecoverRace/);
});

test("jobs API has pagination bounds and slow-request diagnostics", () => {
  const jobsRoute = readRepoFile("src/app/api/jobs/route.ts");
  const apiUtils = readRepoFile("src/lib/api-utils.ts");
  const jobsQueries = readRepoFile("src/lib/queries/jobs.ts");

  assert.match(apiUtils, /parseBoundedIntParam/);
  assert.match(jobsRoute, /max:\s*1000/);
  assert.match(jobsRoute, /logSlowJobsRequest/);
  assert.match(jobsRoute, /\[api\.jobs\] slow request/);
  assert.match(jobsQueries, /buildNotPassedCanonicalWhere/);
  assert.match(jobsQueries, /canonicalRelationWhere/);
  assert.match(jobsQueries, /behaviorSignals:\s*{\s*none:/);
});

test("scale-sensitive user lookups have supporting indexes", () => {
  const schema = readRepoFile("prisma/schema.prisma");
  const migration = readRepoFile(
    "prisma/migrations/20260621120000_add_scale_readiness_indexes/migration.sql"
  );

  assert.match(schema, /@@index\(\[userId, isValid, expiresAt, score\(sort: Desc\)\]\)/);
  assert.match(schema, /@@index\(\[userId, jobId, feedbackType\]\)/);
  assert.match(schema, /@@index\(\[userId, canonicalJobId, status\]\)/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(migration, /"UserTopPick_userId_isValid_expiresAt_score_idx"/);
  assert.match(migration, /"TrackedApplication_userId_canonicalJobId_status_idx"/);
});
