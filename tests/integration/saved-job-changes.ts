import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildDecisionFacts } from "../../src/lib/jobs/decision-facts";
import { refreshSavedJobChanges } from "../../src/lib/queries/saved-job-changes";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const token = `savedchanges-${randomUUID()}`;
  const old = new Date(Date.now() - 2 * 3_600_000);
  try {
    await prisma.user.create({ data: { id: token, email: `${token}@example.test`, name: "Change fixture", profile: { create: { id: token, name: "Change fixture", email: `${token}@example.test` } } } });
    const job = await prisma.jobCanonical.create({ data: { id: token, title: "Software Engineer", company: "Change Fixture", location: "Toronto", region: "CA", workMode: "REMOTE", employmentType: "FULL_TIME", roleFamily: "Engineering", description: "Test only", shortSummary: "Test only", applyUrl: "https://example.test/job", postedAt: new Date(), status: "LIVE", workModeStatus: "confident", workModeConfidence: 0.99 } });
    await prisma.trackedApplication.create({ data: { userId: token, canonicalJobId: token, company: job.company, roleTitle: job.title } });
    const saved = await prisma.savedJob.create({ data: { userId: token, canonicalJobId: token } });
    await refreshSavedJobChanges(5, prisma, token);
    assert.equal(await prisma.notification.count({ where: { userId: token } }), 0, "existing wishlist gets a silent baseline");
    await prisma.jobCanonical.update({ where: { id: token }, data: { workMode: "HYBRID" } });
    await prisma.savedJob.update({ where: { id: saved.id }, data: { factsCheckedAt: old, factsSnapshotJson: buildDecisionFacts(job) } });
    await Promise.all([refreshSavedJobChanges(5, prisma, token), refreshSavedJobChanges(5, prisma, token)]);
    const notifications = await prisma.notification.findMany({ where: { userId: token } });
    assert.equal(notifications.length, 1, "concurrent workers claim the baseline only once");
    assert.match(notifications[0].message, /Remote -> Hybrid/);
    await prisma.savedJob.update({ where: { id: saved.id }, data: { factsCheckedAt: old } });
    await refreshSavedJobChanges(5, prisma, token);
    assert.equal(await prisma.notification.count({ where: { userId: token } }), 1, "unchanged fact refresh does not alert");
    await prisma.jobCanonical.update({ where: { id: token }, data: { workMode: "ONSITE" } });
    await prisma.savedJob.update({ where: { id: saved.id }, data: { factsCheckedAt: old } });
    await refreshSavedJobChanges(5, prisma, token);
    assert.equal(await prisma.notification.count({ where: { userId: token } }), 1, "same-day changes coalesce");
    assert.match((await prisma.notification.findFirstOrThrow({ where: { userId: token } })).message, /Hybrid -> Onsite/);
    await prisma.trackedApplication.updateMany({ where: { userId: token }, data: { status: "APPLIED" } });
    await prisma.jobCanonical.update({ where: { id: token }, data: { workMode: "REMOTE" } });
    await prisma.savedJob.update({ where: { id: saved.id }, data: { factsCheckedAt: old } });
    await refreshSavedJobChanges(5, prisma, token);
    assert.match((await prisma.notification.findFirstOrThrow({ where: { userId: token } })).message, /Hybrid -> Onsite/, "applied jobs no longer generate wishlist alerts");
    console.log("PASS: silent baselines, meaningful changes, concurrency, daily coalescing and applied-job exclusion");
  } finally {
    await prisma.user.deleteMany({ where: { id: token } });
    await prisma.jobCanonical.deleteMany({ where: { id: token } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
