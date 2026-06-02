ALTER TABLE "JobCanonical"
  ADD COLUMN IF NOT EXISTS "applyUrlValidatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "applyUrlValidationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "applyUrlValidationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "finalResolvedApplyUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "applyUrlRedirectDepth" INTEGER;

CREATE INDEX IF NOT EXISTS "JobCanonical_status_applyUrlValidationStatus_postedAt_idx"
  ON "JobCanonical"("status", "applyUrlValidationStatus", "postedAt" DESC);

CREATE INDEX IF NOT EXISTS "JobCanonical_applyUrlValidatedAt_idx"
  ON "JobCanonical"("applyUrlValidatedAt");
