CREATE TABLE "ResourceBudget" (
  "key" TEXT PRIMARY KEY,
  "used" INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ResourceBudget_resetAt_idx" ON "ResourceBudget"("resetAt");
CREATE TABLE "ResourceLease" (
  "id" TEXT PRIMARY KEY,
  "resource" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ResourceLease_resource_expiresAt_idx" ON "ResourceLease"("resource", "expiresAt");
CREATE TABLE "StorageDeletionTask" (
  "storageKey" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StorageDeletionTask_nextAttemptAt_idx" ON "StorageDeletionTask"("nextAttemptAt");
ALTER TABLE "UserProfile" ADD COLUMN "feedStateVersion" INTEGER NOT NULL DEFAULT 0;
