import type { Prisma } from "@/generated/prisma/client";

export const URL_HEALTH_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Inconclusive HTTP checks need time to recover. Re-enqueuing the same shell
// every cycle consumes the verification budget without improving coverage.
export function buildUrlHealthDueWhere(now: Date): Prisma.JobCanonicalWhereInput {
  return {
    OR: [
      { lastApplyCheckAt: null },
      { lastApplyCheckAt: { lte: new Date(now.getTime() - URL_HEALTH_RECHECK_INTERVAL_MS) } },
    ],
  };
}

export const URL_HEALTH_CHECK_ORDER = {
  lastApplyCheckAt: { sort: "asc", nulls: "first" },
} satisfies Prisma.JobCanonicalOrderByWithRelationInput;
