import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildDecisionFacts, changedDecisionFacts, decisionFactSelect } from "@/lib/jobs/decision-facts";

export async function refreshSavedJobChanges(limit = 200, client: PrismaClient = prisma, profileId?: string) {
  const checkedAt = new Date();
  const ids = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id FROM "SavedJob" s JOIN "JobCanonical" j ON j.id = s."canonicalJobId"
    WHERE s.status = 'ACTIVE' AND ${profileId ? Prisma.sql`s."userId" = ${profileId}` : Prisma.sql`TRUE`}
      AND (s."factsCheckedAt" IS NULL OR (
      s."factsCheckedAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 hour' AND j."updatedAt" > s."factsCheckedAt"
    ))
    ORDER BY s."factsCheckedAt" ASC NULLS FIRST, s.id LIMIT ${Math.min(500, Math.max(1, Math.trunc(limit)))}
  `);
  let notifications = 0;
  for (const { id } of ids) {
    const saved = await client.savedJob.findUnique({ where: { id }, include: {
      canonicalJob: { select: { ...decisionFactSelect, title: true, company: true } },
      user: { select: { authUserId: true, authUser: { select: { status: true } } } },
    } });
    if (!saved || saved.status !== "ACTIVE") continue;
    const facts = buildDecisionFacts(saved.canonicalJob);
    const changes = changedDecisionFacts(saved.factsSnapshotJson, facts);
    notifications += await client.$transaction(async (db) => {
      const claim = await db.savedJob.updateMany({
        where: { id, status: "ACTIVE", factsCheckedAt: saved.factsCheckedAt, updatedAt: saved.updatedAt },
        data: { factsSnapshotJson: facts, factsCheckedAt: checkedAt, updatedAt: saved.updatedAt },
      });
      if (!claim.count || !changes.length || !saved.user.authUserId || saved.user.authUser?.status !== "ACTIVE") return 0;
      const application = await db.trackedApplication.findFirst({ where: { userId: saved.user.authUserId, canonicalJobId: saved.canonicalJobId, status: "WISHLIST" }, select: { id: true } });
      if (!application) return 0;
      const message = `${saved.canonicalJob.title} at ${saved.canonicalJob.company}: ${changes.map((change) => `${change.label}: ${change.before ?? "Not confirmed"} -> ${change.after ?? "Not confirmed"}`).join("; ")}`.slice(0, 1500);
      const existing = await db.notification.findFirst({ where: { userId: saved.user.authUserId, trackedApplicationId: application.id, type: "SYSTEM", title: "Saved job details changed", createdAt: { gte: new Date(checkedAt.getTime() - 86_400_000) } }, select: { id: true } });
      if (existing) {
        await db.notification.update({ where: { id: existing.id }, data: { message, readAt: null } });
      } else {
        await db.notification.create({ data: { userId: saved.user.authUserId, trackedApplicationId: application.id, type: "SYSTEM", title: "Saved job details changed", message } });
      }
      return 1;
    });
  }
  return { scanned: ids.length, notifications };
}
