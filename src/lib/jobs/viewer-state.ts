import { prisma } from "@/lib/db";

export async function getViewerFeedVersion(userId: string | null) {
  if (!userId) return 0;
  return (await prisma.userProfile.findUnique({ where: { id: userId }, select: { feedStateVersion: true } }))?.feedStateVersion ?? 0;
}

export async function overlayViewerJobState<T extends { id: string; isSaved: boolean; hasApplied: boolean }>(
  jobs: T[], profileId: string | null, authUserId: string | null,
): Promise<T[]> {
  if (!jobs.length) return jobs;
  const ids = jobs.map((job) => job.id);
  const [saved, applied] = await Promise.all([
    profileId ? prisma.savedJob.findMany({ where: { userId: profileId, canonicalJobId: { in: ids }, status: "ACTIVE" }, select: { canonicalJobId: true } }) : [],
    authUserId ? prisma.trackedApplication.findMany({ where: { userId: authUserId, canonicalJobId: { in: ids }, status: { notIn: ["WISHLIST", "PREPARING"] } }, select: { canonicalJobId: true } }) : [],
  ]);
  const savedIds = new Set(saved.map((job) => job.canonicalJobId));
  const appliedIds = new Set(applied.map((job) => job.canonicalJobId));
  return jobs.map((job) => ({ ...job, isSaved: savedIds.has(job.id), hasApplied: appliedIds.has(job.id) }));
}
