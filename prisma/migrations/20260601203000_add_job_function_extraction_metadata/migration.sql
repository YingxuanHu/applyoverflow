ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategorySource" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryCandidatesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryEvidenceJson" JSONB,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryWarningsJson" JSONB;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategorySource" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryCandidatesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryEvidenceJson" JSONB,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryWarningsJson" JSONB;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategorySource" TEXT;

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedRoleCategoryGroup_postedAt_idx"
  ON "JobCanonical"("status", "normalizedRoleCategoryGroup", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_normalizedRoleCategoryGroup_idx"
  ON "NormalizedJobRecord"("normalizedRoleCategoryGroup");

CREATE INDEX IF NOT EXISTS "JobFeedIndex_normalizedRoleCategoryGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("normalizedRoleCategoryGroup", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_status_normalizedRoleCategoryGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("status", "normalizedRoleCategoryGroup", "rankingScore" DESC, "postedAt" DESC);
