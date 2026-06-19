import { prisma } from "@/lib/db";
import { enqueueDurableTopPicksRefresh } from "@/lib/top-picks/refresh-queue";

export async function invalidateTopPickForUserJob(input: {
  userId: string;
  jobId: string;
  reason?: string;
}) {
  const now = new Date();
  await prisma.userTopPick.updateMany({
    where: {
      userId: input.userId,
      jobId: input.jobId,
      isValid: true,
    },
    data: {
      isValid: false,
      invalidatedAt: now,
    },
  });
  await enqueueDurableTopPicksRefresh({
    userId: input.userId,
    reason: input.reason ?? "top_pick_no_longer_eligible",
    priorityScore: 70,
  });
}
