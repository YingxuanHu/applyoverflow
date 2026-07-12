ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "normalizedIndustry" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedIndustryConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "normalizedIndustrySource" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedIndustryUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Company_normalizedIndustry_normalizedIndustryConfidence_idx"
  ON "Company"("normalizedIndustry", "normalizedIndustryConfidence");
