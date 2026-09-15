ALTER TABLE "SavedJob" ADD COLUMN "factsSnapshotJson" JSONB,
  ADD COLUMN "factsCheckedAt" TIMESTAMP(3);
CREATE INDEX "SavedJob_status_factsCheckedAt_idx" ON "SavedJob"("status", "factsCheckedAt");

CREATE TABLE "JobDataReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "canonicalJobId" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('DESCRIPTION', 'LOCATION', 'SALARY', 'COMPANY', 'CLOSED', 'OTHER')),
  "details" VARCHAR(500) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "JobDataReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobDataReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JobDataReport_canonicalJobId_fkey" FOREIGN KEY ("canonicalJobId") REFERENCES "JobCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobDataReport_userId_canonicalJobId_category_key" ON "JobDataReport"("userId", "canonicalJobId", "category");
CREATE INDEX "JobDataReport_status_createdAt_idx" ON "JobDataReport"("status", "createdAt");
CREATE INDEX "JobDataReport_canonicalJobId_idx" ON "JobDataReport"("canonicalJobId");
