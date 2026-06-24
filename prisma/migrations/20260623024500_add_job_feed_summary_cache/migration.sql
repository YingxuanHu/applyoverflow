CREATE TABLE "JobFeedSummaryCache" (
  "id" TEXT NOT NULL,
  "liveJobCount" INTEGER NOT NULL,
  "addedTodayCount" INTEGER NOT NULL,
  "expiredTodayCount" INTEGER NOT NULL,
  "removedTodayCount" INTEGER NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobFeedSummaryCache_pkey" PRIMARY KEY ("id")
);

