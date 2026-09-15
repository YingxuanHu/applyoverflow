import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";
import { buildDecisionFacts, decisionFactSelect } from "@/lib/jobs/decision-facts";

export async function saveJob(
  canonicalJobId: string,
  status: "ACTIVE" | "APPLIED" | "EXPIRED" | "DISMISSED" = "ACTIVE"
) {
  const userId = await requireCurrentProfileId();
  const checkedAt = new Date();
  const job = await prisma.jobCanonical.findUniqueOrThrow({ where: { id: canonicalJobId }, select: decisionFactSelect });
  const [saved] = await prisma.$transaction([prisma.savedJob.upsert({
    where: {
      userId_canonicalJobId: {
        userId,
        canonicalJobId,
      },
    },
    create: {
      userId,
      canonicalJobId,
      status,
      factsSnapshotJson: buildDecisionFacts(job),
      factsCheckedAt: checkedAt,
    },
    update: {
      status,
    },
  }), prisma.userProfile.update({ where: { id: userId }, data: { feedStateVersion: { increment: 1 } } })]);
  return saved;
}

export async function unsaveJob(canonicalJobId: string) {
  const userId = await requireCurrentProfileId();
  const [deleted] = await prisma.$transaction([prisma.savedJob.deleteMany({
    where: {
      userId,
      canonicalJobId,
    },
  }), prisma.userProfile.update({ where: { id: userId }, data: { feedStateVersion: { increment: 1 } } })]);
  return deleted;
}
