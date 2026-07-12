-- CreateTable
CREATE TABLE "TopPickRefreshTask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT,
  "candidateLimit" INTEGER,
  "storeLimit" INTEGER,
  "notBeforeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TopPickRefreshTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopPickRefreshTask_userId_key" ON "TopPickRefreshTask"("userId");

-- CreateIndex
CREATE INDEX "TopPickRefreshTask_status_notBeforeAt_priorityScore_idx"
ON "TopPickRefreshTask"("status", "notBeforeAt", "priorityScore" DESC);

-- CreateIndex
CREATE INDEX "TopPickRefreshTask_status_leaseExpiresAt_idx"
ON "TopPickRefreshTask"("status", "leaseExpiresAt" ASC);

-- AddForeignKey
ALTER TABLE "TopPickRefreshTask"
ADD CONSTRAINT "TopPickRefreshTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
