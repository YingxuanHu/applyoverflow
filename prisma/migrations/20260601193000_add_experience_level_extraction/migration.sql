ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "experienceLevelGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelSource" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelEvidenceJson" JSONB,
  ADD COLUMN IF NOT EXISTS "experienceLevelWarningsJson" JSONB;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN IF NOT EXISTS "experienceLevelGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelSource" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelEvidenceJson" JSONB,
  ADD COLUMN IF NOT EXISTS "experienceLevelWarningsJson" JSONB;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN IF NOT EXISTS "experienceLevelGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelSource" TEXT,
  ADD COLUMN IF NOT EXISTS "experienceLevelEvidenceJson" JSONB,
  ADD COLUMN IF NOT EXISTS "experienceLevelWarningsJson" JSONB;

CREATE INDEX IF NOT EXISTS "JobCanonical_status_experienceLevelGroup_postedAt_idx"
  ON "JobCanonical"("status", "experienceLevelGroup", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "NormalizedJobRecord_experienceLevelGroup_idx"
  ON "NormalizedJobRecord"("experienceLevelGroup");

CREATE INDEX IF NOT EXISTS "JobFeedIndex_experienceLevelGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("experienceLevelGroup", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_status_experienceLevelGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("status", "experienceLevelGroup", "rankingScore" DESC, "postedAt" DESC);
