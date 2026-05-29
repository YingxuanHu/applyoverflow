ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentType" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStage" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategory" TEXT;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentType" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStage" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategory" TEXT;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentType" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStage" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategory" TEXT;

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedEmploymentType_postedAt_idx"
  ON "JobCanonical"("status", "normalizedEmploymentType", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedCareerStage_postedAt_idx"
  ON "JobCanonical"("status", "normalizedCareerStage", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedIndustry_postedAt_idx"
  ON "JobCanonical"("status", "normalizedIndustry", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedRoleCategory_postedAt_idx"
  ON "JobCanonical"("status", "normalizedRoleCategory", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_normalizedEmploymentType_idx"
  ON "NormalizedJobRecord"("normalizedEmploymentType");

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_normalizedCareerStage_idx"
  ON "NormalizedJobRecord"("normalizedCareerStage");

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_normalizedIndustry_idx"
  ON "NormalizedJobRecord"("normalizedIndustry");

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_normalizedRoleCategory_idx"
  ON "NormalizedJobRecord"("normalizedRoleCategory");

CREATE INDEX IF NOT EXISTS "JobFeedIndex_normalizedEmploymentType_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("normalizedEmploymentType", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_normalizedCareerStage_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("normalizedCareerStage", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_normalizedIndustry_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("normalizedIndustry", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_normalizedRoleCategory_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("normalizedRoleCategory", "rankingScore" DESC, "postedAt" DESC);

