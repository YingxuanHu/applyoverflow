-- CreateEnum
CREATE TYPE "UserJobPreferenceFeedbackType" AS ENUM (
  'NOT_INTERESTED',
  'WRONG_ROLE',
  'TOO_SENIOR',
  'TOO_JUNIOR',
  'WRONG_LOCATION',
  'WRONG_WORK_MODE',
  'WRONG_EMPLOYMENT_TYPE',
  'LOW_QUALITY',
  'ALREADY_SEEN'
);

-- CreateTable
CREATE TABLE "UserMatchProfile" (
  "userId" TEXT NOT NULL,
  "profileVersion" INTEGER NOT NULL DEFAULT 1,
  "profileHash" TEXT NOT NULL,
  "normalizedSkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetRoleCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetCareerStage" TEXT,
  "preferredLocationCity" TEXT,
  "preferredLocationRegion" TEXT,
  "preferredLocationCountry" TEXT,
  "preferredWorkModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetSalaryMin" INTEGER,
  "targetSalaryMax" INTEGER,
  "targetSalaryCurrency" TEXT,
  "experienceSummary" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserMatchProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserTopPick" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "rank" INTEGER NOT NULL,
  "scoreBreakdown" JSONB NOT NULL,
  "matchReasons" JSONB NOT NULL,
  "concerns" JSONB NOT NULL,
  "profileVersion" INTEGER NOT NULL,
  "jobVersion" TIMESTAMP(3),
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isValid" BOOLEAN NOT NULL DEFAULT true,
  "invalidatedAt" TIMESTAMP(3),

  CONSTRAINT "UserTopPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserJobPreferenceFeedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "feedbackType" "UserJobPreferenceFeedbackType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserJobPreferenceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMatchProfile_profileHash_idx" ON "UserMatchProfile"("profileHash");

-- CreateIndex
CREATE INDEX "UserMatchProfile_updatedAt_idx" ON "UserMatchProfile"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserTopPick_userId_jobId_key" ON "UserTopPick"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserTopPick_userId_isValid_score_idx" ON "UserTopPick"("userId", "isValid", "score" DESC);

-- CreateIndex
CREATE INDEX "UserTopPick_jobId_idx" ON "UserTopPick"("jobId");

-- CreateIndex
CREATE INDEX "UserTopPick_userId_computedAt_idx" ON "UserTopPick"("userId", "computedAt");

-- CreateIndex
CREATE INDEX "UserTopPick_userId_rank_idx" ON "UserTopPick"("userId", "rank");

-- CreateIndex
CREATE INDEX "UserJobPreferenceFeedback_userId_feedbackType_idx" ON "UserJobPreferenceFeedback"("userId", "feedbackType");

-- CreateIndex
CREATE INDEX "UserJobPreferenceFeedback_userId_jobId_idx" ON "UserJobPreferenceFeedback"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserJobPreferenceFeedback_jobId_idx" ON "UserJobPreferenceFeedback"("jobId");

-- AddForeignKey
ALTER TABLE "UserMatchProfile"
ADD CONSTRAINT "UserMatchProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTopPick"
ADD CONSTRAINT "UserTopPick_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTopPick"
ADD CONSTRAINT "UserTopPick_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "JobCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobPreferenceFeedback"
ADD CONSTRAINT "UserJobPreferenceFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobPreferenceFeedback"
ADD CONSTRAINT "UserJobPreferenceFeedback_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "JobCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE;
