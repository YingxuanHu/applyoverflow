/**
 * Recompute and persist JobFeedSummaryCache.
 *
 * The /jobs page header counts ("X live jobs · Y added today · Z closed
 * today") used to run 8 live COUNT(*) queries on JobCanonical at every
 * request. That blocked page loads for tens of seconds when ingestion
 * workers were competing for I/O.
 *
 * This script runs on a 5-minute systemd timer and writes a single
 * singleton row that the page reads instantly.
 */
import "dotenv/config";

import process from "node:process";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const SINGLETON_ID = "singleton";

// The visibility statuses that count as "live on the board." Kept in sync
// with VISIBLE_JOB_STATUSES used elsewhere in the query layer.
const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const visibleWhere: Prisma.JobCanonicalWhereInput = {
    AND: [
      { status: { in: [...VISIBLE_STATUSES] } },
      {
        OR: [{ deadline: null }, { deadline: { gte: now } }],
      },
    ],
  };

  const [
    liveJobCount,
    addedTodayCount,
    expiredTodayCount,
    removedTodayCount,
  ] = await Promise.all([
    prisma.jobCanonical.count({ where: visibleWhere }),
    prisma.jobCanonical.count({
      where: {
        AND: [visibleWhere, { firstSeenAt: { gte: startOfToday } }],
      },
    }),
    prisma.jobCanonical.count({
      where: {
        status: "EXPIRED",
        expiredAt: { gte: startOfToday },
      },
    }),
    prisma.jobCanonical.count({
      where: {
        status: "REMOVED",
        removedAt: { gte: startOfToday },
      },
    }),
  ]);

  await prisma.jobFeedSummaryCache.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      liveJobCount,
      addedTodayCount,
      expiredTodayCount,
      removedTodayCount,
    },
    update: {
      liveJobCount,
      addedTodayCount,
      expiredTodayCount,
      removedTodayCount,
    },
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[refresh-job-feed-summary] live=${liveJobCount} added=${addedTodayCount} expired=${expiredTodayCount} removed=${removedTodayCount} elapsed=${elapsedMs}ms`
  );
}

main()
  .catch((error) => {
    console.error("[refresh-job-feed-summary] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
