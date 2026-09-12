import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";

export async function saveJob(
  canonicalJobId: string,
  status: "ACTIVE" | "APPLIED" | "EXPIRED" | "DISMISSED" = "ACTIVE"
) {
  const userId = await requireCurrentProfileId();
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
