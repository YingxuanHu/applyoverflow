ALTER TABLE "JobCanonical"
  ADD COLUMN "workModeConfidence" DOUBLE PRECISION,
  ADD COLUMN "workModeStatus" TEXT,
  ADD COLUMN "workModeSource" TEXT,
  ADD COLUMN "workModeCandidatesJson" JSONB,
  ADD COLUMN "employmentTypeGroup" TEXT,
  ADD COLUMN "employmentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN "employmentTypeStatus" TEXT,
  ADD COLUMN "employmentTypeSource" TEXT,
  ADD COLUMN "employmentTypeCandidatesJson" JSONB,
  ADD COLUMN "datePostedConfidence" DOUBLE PRECISION,
  ADD COLUMN "datePostedStatus" TEXT,
  ADD COLUMN "datePostedSource" TEXT,
  ADD COLUMN "datePostedRawText" TEXT,
  ADD COLUMN "applicationDeadlineConfidence" DOUBLE PRECISION,
  ADD COLUMN "applicationDeadlineStatus" TEXT,
  ADD COLUMN "applicationDeadlineSource" TEXT,
  ADD COLUMN "applicationDeadlineRawText" TEXT,
  ADD COLUMN "metadataExtractionWarnings" JSONB;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN "workModeConfidence" DOUBLE PRECISION,
  ADD COLUMN "workModeStatus" TEXT,
  ADD COLUMN "workModeSource" TEXT,
  ADD COLUMN "workModeCandidatesJson" JSONB,
  ADD COLUMN "employmentTypeGroup" TEXT,
  ADD COLUMN "employmentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN "employmentTypeStatus" TEXT,
  ADD COLUMN "employmentTypeSource" TEXT,
  ADD COLUMN "employmentTypeCandidatesJson" JSONB,
  ADD COLUMN "datePostedConfidence" DOUBLE PRECISION,
  ADD COLUMN "datePostedStatus" TEXT,
  ADD COLUMN "datePostedSource" TEXT,
  ADD COLUMN "datePostedRawText" TEXT,
  ADD COLUMN "applicationDeadlineConfidence" DOUBLE PRECISION,
  ADD COLUMN "applicationDeadlineStatus" TEXT,
  ADD COLUMN "applicationDeadlineSource" TEXT,
  ADD COLUMN "applicationDeadlineRawText" TEXT,
  ADD COLUMN "metadataExtractionWarnings" JSONB;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN "workModeConfidence" DOUBLE PRECISION,
  ADD COLUMN "workModeStatus" TEXT,
  ADD COLUMN "workModeSource" TEXT,
  ADD COLUMN "employmentTypeGroup" TEXT,
  ADD COLUMN "employmentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN "employmentTypeStatus" TEXT,
  ADD COLUMN "employmentTypeSource" TEXT,
  ADD COLUMN "datePostedConfidence" DOUBLE PRECISION,
  ADD COLUMN "datePostedStatus" TEXT,
  ADD COLUMN "datePostedSource" TEXT,
  ADD COLUMN "datePostedRawText" TEXT,
  ADD COLUMN "applicationDeadlineConfidence" DOUBLE PRECISION,
  ADD COLUMN "applicationDeadlineStatus" TEXT,
  ADD COLUMN "applicationDeadlineSource" TEXT,
  ADD COLUMN "applicationDeadlineRawText" TEXT,
  ADD COLUMN "metadataExtractionWarnings" JSONB;

CREATE INDEX IF NOT EXISTS "JobCanonical_status_employmentTypeGroup_postedAt_idx"
  ON "JobCanonical"("status", "employmentTypeGroup", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_employmentTypeGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("employmentTypeGroup", "rankingScore" DESC, "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobFeedIndex_status_employmentTypeGroup_rankingScore_postedAt_idx"
  ON "JobFeedIndex"("status", "employmentTypeGroup", "rankingScore" DESC, "postedAt" DESC);
