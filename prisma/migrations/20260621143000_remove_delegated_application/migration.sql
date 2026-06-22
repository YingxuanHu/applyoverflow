-- Remove old delegated-application vocabulary while preserving existing
-- application-readiness history.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'SubmissionCategory'
      AND enum_value.enumlabel = 'AUTO_SUBMIT_READY'
  ) THEN
    ALTER TYPE "SubmissionCategory" RENAME VALUE 'AUTO_SUBMIT_READY' TO 'READY_TO_APPLY';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'SubmissionCategory'
      AND enum_value.enumlabel = 'AUTO_FILL_REVIEW'
  ) THEN
    ALTER TYPE "SubmissionCategory" RENAME VALUE 'AUTO_FILL_REVIEW' TO 'REVIEW_REQUIRED';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'JobEligibility'
      AND column_name = 'formAutomationConfidence'
  ) THEN
    ALTER TABLE "JobEligibility"
      RENAME COLUMN "formAutomationConfidence" TO "applicationFlowConfidence";
  END IF;
END $$;

ALTER TABLE "UserProfile"
  DROP COLUMN IF EXISTS "automationMode";

DROP TYPE IF EXISTS "AutomationMode";
