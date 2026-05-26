-- Adds a flag + back-reference so the app can persist AI-generated resumes
-- and cover letters into the user's profile storage, separating them from
-- user-uploaded files in the Documents UI.
ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceApplicationId" TEXT;

CREATE INDEX IF NOT EXISTS "Document_userId_type_isAiGenerated_createdAt_idx"
  ON "Document"("userId", "type", "isAiGenerated", "createdAt" DESC);
