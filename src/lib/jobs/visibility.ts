import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { APPLY_LINK_VALIDATION_STATUS } from "@/lib/ingestion/apply-link-quality";

export const JOB_BOARD_MIN_AVAILABILITY_SCORE = 60;
export const RECENT_SOURCE_EVIDENCE_MAX_AGE_MS = 14 * 86_400_000;
export const RECENT_ALIVE_EVIDENCE_MAX_AGE_MS = 30 * 86_400_000;

const BAD_APPLY_LINK_VALIDATION_STATUSES = [
  APPLY_LINK_VALIDATION_STATUS.EXPIRED,
  APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK,
  APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE,
  APPLY_LINK_VALIDATION_STATUS.SOURCE_STALE,
  APPLY_LINK_VALIDATION_STATUS.HIDDEN_LOW_QUALITY,
] as const;

export function buildAvailabilityVisibilityWhere(
  minScore: number = JOB_BOARD_MIN_AVAILABILITY_SCORE
): PrismaTypes.JobCanonicalWhereInput {
  return {
    availabilityScore: { gte: minScore },
  };
}

export function buildApplyableVisibilityWhere(): PrismaTypes.JobCanonicalWhereInput {
  return {
    deadSignalAt: null,
    OR: [
      { applyUrl: { startsWith: "http://" } },
      { applyUrl: { startsWith: "https://" } },
    ],
    applyUrlValidationStatus: {
      notIn: [...BAD_APPLY_LINK_VALIDATION_STATUSES],
    },
  };
}

export function buildVisibleDeadlineWhere(
  now: Date = new Date()
): PrismaTypes.JobCanonicalWhereInput {
  return {
    OR: [{ deadline: null }, { deadline: { gte: now } }],
  };
}

export function buildRecentApplyEvidenceWhere(
  now: Date = new Date()
): PrismaTypes.JobCanonicalWhereInput {
  return {
    OR: [
      {
        lastConfirmedAliveAt: {
          gte: new Date(now.getTime() - RECENT_ALIVE_EVIDENCE_MAX_AGE_MS),
        },
      },
      {
        lastSourceSeenAt: {
          gte: new Date(now.getTime() - RECENT_SOURCE_EVIDENCE_MAX_AGE_MS),
        },
      },
    ],
  };
}

export function buildDefaultCanonicalVisibilityWhere(
  now: Date = new Date(),
  minAvailabilityScore: number = JOB_BOARD_MIN_AVAILABILITY_SCORE
): PrismaTypes.JobCanonicalWhereInput {
  return {
    AND: [
      { status: "LIVE" },
      buildAvailabilityVisibilityWhere(minAvailabilityScore),
      buildApplyableVisibilityWhere(),
      buildVisibleDeadlineWhere(now),
      buildRecentApplyEvidenceWhere(now),
    ],
  };
}
