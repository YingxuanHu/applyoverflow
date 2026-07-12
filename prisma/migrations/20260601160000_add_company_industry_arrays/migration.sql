ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "normalizedIndustries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "normalizedIndustries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "NormalizedJobRecord"
  ADD COLUMN IF NOT EXISTS "normalizedIndustries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "JobFeedIndex"
  ADD COLUMN IF NOT EXISTS "normalizedIndustries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Company"
SET "normalizedIndustries" = ARRAY["normalizedIndustry"]::TEXT[]
WHERE "normalizedIndustry" IS NOT NULL
  AND "normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
  AND cardinality("normalizedIndustries") = 0;

UPDATE "JobCanonical"
SET "normalizedIndustries" = ARRAY["normalizedIndustry"]::TEXT[]
WHERE "normalizedIndustry" IS NOT NULL
  AND "normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
  AND cardinality("normalizedIndustries") = 0;

UPDATE "NormalizedJobRecord"
SET "normalizedIndustries" = ARRAY["normalizedIndustry"]::TEXT[]
WHERE "normalizedIndustry" IS NOT NULL
  AND "normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
  AND cardinality("normalizedIndustries") = 0;

UPDATE "JobFeedIndex"
SET "normalizedIndustries" = ARRAY["normalizedIndustry"]::TEXT[]
WHERE "normalizedIndustry" IS NOT NULL
  AND "normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
  AND cardinality("normalizedIndustries") = 0;

CREATE INDEX IF NOT EXISTS "Company_normalizedIndustries_gin_idx"
  ON "Company" USING GIN ("normalizedIndustries");

CREATE INDEX IF NOT EXISTS "JobCanonical_status_normalizedIndustries_gin_idx"
  ON "JobCanonical" USING GIN ("normalizedIndustries");

CREATE INDEX IF NOT EXISTS "JobFeedIndex_status_normalizedIndustries_gin_idx"
  ON "JobFeedIndex" USING GIN ("normalizedIndustries");
