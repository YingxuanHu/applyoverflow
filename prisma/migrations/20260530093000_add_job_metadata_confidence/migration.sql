ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStageConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedIndustryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "classificationStatus" TEXT;

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStageConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedIndustryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "classificationStatus" TEXT;

ALTER TABLE "JobFeedIndex"
  ADD COLUMN IF NOT EXISTS "normalizedEmploymentTypeConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedCareerStageConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedIndustryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedRoleCategoryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "classificationStatus" TEXT;
