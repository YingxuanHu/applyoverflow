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
import {
  getStartOfTodayInTimeZone,
  normalizeUserTimeZone,
} from "@/lib/time-zone";
import type { Prisma } from "@/generated/prisma/client";

const SINGLETON_ID = "singleton";

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  const timeZone = normalizeUserTimeZone(process.env.JOB_FEED_SUMMARY_TIME_ZONE);
  const startOfToday = getStartOfTodayInTimeZone(timeZone, now);

  const visibleWhere: Prisma.JobFeedIndexWhereInput = {
    status: "LIVE",
    canonicalJob: {
      status: "LIVE",
      OR: [{ deadline: null }, { deadline: { gte: now } }],
    },
  };

  const [
    liveJobCount,
    addedTodayCount,
    expiredTodayCount,
    removedTodayCount,
  ] = await Promise.all([
    prisma.jobFeedIndex.count({ where: visibleWhere }),
    prisma.jobFeedIndex.count({
      where: {
        ...visibleWhere,
        canonicalJob: {
          AND: [
            { status: "LIVE" },
            { firstSeenAt: { gte: startOfToday } },
            { OR: [{ deadline: null }, { deadline: { gte: now } }] },
          ],
        },
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
    `[refresh-job-feed-summary] timezone=${timeZone} live=${liveJobCount} added=${addedTodayCount} expired=${expiredTodayCount} removed=${removedTodayCount} elapsed=${elapsedMs}ms`
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
