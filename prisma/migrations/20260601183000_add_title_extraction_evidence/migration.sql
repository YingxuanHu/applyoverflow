ALTER TABLE "JobCanonical"
  ADD COLUMN "displayTitle" TEXT,
  ADD COLUMN "titleRejectedFragmentsJson" JSONB,
  ADD COLUMN "titleExtractionWarnings" JSONB,
  ADD COLUMN "jobPageType" TEXT;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN "displayTitle" TEXT,
  ADD COLUMN "titleRejectedFragmentsJson" JSONB,
  ADD COLUMN "titleExtractionWarnings" JSONB,
  ADD COLUMN "jobPageType" TEXT;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN "displayTitle" TEXT,
  ADD COLUMN "titleExtractionWarnings" JSONB,
  ADD COLUMN "jobPageType" TEXT;
