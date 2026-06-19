import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";
import type { Prisma, UserAction } from "@/generated/prisma/client";

const USER_ACTION_DEDUP_WINDOW_MS = 10_000;

export async function recordAction(
  canonicalJobId: string,
  action: UserAction,
  metadata?: Prisma.InputJsonValue
) {
  const userId = await requireCurrentProfileId();
  const recentDuplicate = await prisma.userBehaviorSignal.findFirst({
    where: {
      userId,
      canonicalJobId,
      action,
      createdAt: {
        gte: new Date(Date.now() - USER_ACTION_DEDUP_WINDOW_MS),
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentDuplicate) {
    return recentDuplicate;
  }

  return prisma.userBehaviorSignal.create({
    data: {
      userId,
      canonicalJobId,
      action,
      metadata: metadata ?? undefined,
    },
  });
}
