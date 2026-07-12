-- Hot user-facing lookups for Top Picks and applied badges.
-- These are concurrent to avoid long write-blocking locks on the large jobs DB.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserTopPick_userId_isValid_expiresAt_score_idx"
  ON "UserTopPick"("userId", "isValid", "expiresAt", "score" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserJobPreferenceFeedback_userId_jobId_feedbackType_idx"
  ON "UserJobPreferenceFeedback"("userId", "jobId", "feedbackType");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TrackedApplication_userId_canonicalJobId_status_idx"
  ON "TrackedApplication"("userId", "canonicalJobId", "status");
