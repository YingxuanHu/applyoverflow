import { Prisma } from "@/generated/prisma/client";

export function buildSourceDiscoveryCandidateUpdate(now = new Date()) {
  return {
    lastSeenAt: now,
    lastError: null,
  } satisfies Prisma.SourceCandidateUpdateInput;
}
