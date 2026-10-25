import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { queueAutoApplyJob, removeAutoApplyJob, createAutoApplyHandoff, resolveAutoApplyTarget, getAutoApplyWorkspace } from "../../src/lib/queries/auto-apply";
import { REQUIREMENTS_KEY } from "../../src/lib/top-picks/requirements";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Local test database only");
  const tag = randomUUID();
  const owner = await prisma.user.create({ data: { email: `${tag}@example.test`, name: "Workspace fixture", profile: { create: { name: "Workspace fixture", email: `${tag}@example.test`, location: "Toronto, Ontario, Canada" } } }, include: { profile: true } });
  const other = await prisma.user.create({ data: { email: `other-${tag}@example.test`, name: "Other" } });
  const job = await prisma.jobCanonical.create({ data: { title: "Software Engineer", company: "Workspace fixture", location: "Toronto, Canada", workMode: "ONSITE", employmentType: "FULL_TIME", description: "Synthetic", shortSummary: "Synthetic", roleFamily: "TECH", applyUrl: `https://careers.example.test/jobs/${tag}/apply`, postedAt: new Date(), lastConfirmedAliveAt: new Date(), status: "LIVE", availabilityScore: 100 } });
  const fixtures: string[] = [];
  await prisma.jobCanonical.update({ where: { id: job.id }, data: { workModeConfidence: 1, workModeStatus: "accepted" } });
  try {
    const first = await queueAutoApplyJob(owner.id, job.id);
    assert.equal((await queueAutoApplyJob(owner.id, job.id)).id, first.id, "idempotent queue");
    await getAutoApplyWorkspace(owner.id);
    const profile = await prisma.userMatchProfile.findUniqueOrThrow({ where: { userId: owner.profile!.id } });
    await prisma.userPreference.create({ data: { userId: owner.profile!.id, key: REQUIREMENTS_KEY, value: JSON.stringify({ country: "CA" }) } });
    for (let index = 0; index < 65; index++) {
      const candidate = await prisma.jobCanonical.create({ data: {
        title: job.title, company: job.company, workMode: "ONSITE", workModeConfidence: 1, workModeStatus: "accepted", employmentType: "FULL_TIME",
        description: "Synthetic", shortSummary: "Synthetic", roleFamily: "TECH", postedAt: new Date(), lastConfirmedAliveAt: new Date(), status: "LIVE", availabilityScore: 100,
        location: index < 30 ? "Seattle, Washington, United States" : "Toronto, Canada", applyUrl: `https://careers.example.test/jobs/${tag}-${index}/apply` } });
      fixtures.push(candidate.id);
      await prisma.userTopPick.create({ data: { userId: owner.profile!.id, jobId: candidate.id, score: 90, rank: index + 1,
        scoreBreakdown: {}, matchReasons: [], concerns: [], profileVersion: profile.profileVersion, expiresAt: new Date(Date.now() + 3600000) } });
    }
    const firstPage = await getAutoApplyWorkspace(owner.id);
    assert.equal(firstPage.matches.length, 30, "requirements are applied before pagination; no empty first page");
    assert.equal(firstPage.totalMatches, 35);
    assert.equal(firstPage.excludedByRequirements, 30);
    assert.equal(firstPage.hasNextPage, true);
    const secondPage = await getAutoApplyWorkspace(owner.id, 2);
    assert.equal(secondPage.matches.length, 5);
    assert.equal(secondPage.hasNextPage, false);
    assert.equal((await getAutoApplyWorkspace(owner.id, 100)).page, 2, "out-of-range pages clamp after filtering");
    const firstQueuedCandidate = await queueAutoApplyJob(owner.id, fixtures[30]);
    const afterQueue = await getAutoApplyWorkspace(owner.id);
    assert.equal(afterQueue.matches.length, 30, "queueing backfills the page");
    assert.equal(afterQueue.totalMatches, 34);
    await prisma.jobCanonical.update({ where: { id: fixtures[30] }, data: { status: "REMOVED" } });
    assert.match((await getAutoApplyWorkspace(owner.id)).queued.find(row => row.id === firstQueuedCandidate.id)!.blockedReason!, /no longer available/);
    await prisma.userPreference.update({ where: { userId_key: { userId: owner.profile!.id, key: REQUIREMENTS_KEY } }, data: { value: JSON.stringify({ country: "US" }) } });
    assert.match((await getAutoApplyWorkspace(owner.id)).queued.find(row => row.id === first.id)!.blockedReason!, /Country eligibility/);
    await prisma.userPreference.deleteMany({ where: { userId: owner.profile!.id, key: REQUIREMENTS_KEY } });
    const handoff = await createAutoApplyHandoff(owner.id, first.id);
    assert.equal((await resolveAutoApplyTarget(owner.id, { token: handoff.token })).id, first.id);
    await assert.rejects(resolveAutoApplyTarget(other.id, { token: handoff.token }), /another account/);
    await assert.rejects(createAutoApplyHandoff(other.id, first.id));
    await assert.rejects(removeAutoApplyJob(other.id, first.id));
    await prisma.jobCanonical.update({ where: { id: job.id }, data: { applyUrl: job.applyUrl + '?changed=1' } });
    await assert.rejects(resolveAutoApplyTarget(owner.id, { token: handoff.token }), /link changed/);
    await prisma.jobCanonical.update({ where: { id: job.id }, data: { applyUrl: job.applyUrl } });
    await prisma.userPreference.create({ data: { userId: owner.profile!.id, key: REQUIREMENTS_KEY, value: JSON.stringify({ workModes: ['REMOTE'] }) } });
    await assert.rejects(createAutoApplyHandoff(owner.id, first.id), /requirements/);
    await prisma.userPreference.deleteMany({ where: { userId: owner.profile!.id, key: REQUIREMENTS_KEY } });
    await removeAutoApplyJob(owner.id, first.id);
    assert.equal((await prisma.trackedApplication.findUniqueOrThrow({ where: { id: first.id } })).status, 'WISHLIST');
    await assert.rejects(resolveAutoApplyTarget(owner.id, { token: handoff.token }), /no longer/);
    assert.equal((await queueAutoApplyJob(owner.id, job.id)).id, first.id, 'wishlist promoted without duplicate');
    await prisma.trackedApplication.update({ where: { id: first.id }, data: { status: 'APPLIED' } });
    await assert.rejects(queueAutoApplyJob(owner.id, job.id), /already/);
    await assert.rejects(createAutoApplyHandoff(owner.id, first.id));
    await prisma.jobCanonical.update({ where: { id: job.id }, data: { status: 'REMOVED' } });
    await assert.rejects(queueAutoApplyJob(owner.id, job.id), /unavailable/);
    assert.equal(await prisma.applicationSubmission.count({ where: { user: { authUserId: owner.id } } }), 0);
    console.log('PASS workspace database: 65-candidate pagination, filtered pages, queue backfill, stale queue blockers, idempotency, ownership, handoff, fresh requirements and duplicate gates; no submissions');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await prisma.jobCanonical.deleteMany({ where: { id: { in: [job.id, ...fixtures] } } });
    await prisma.$disconnect();
  }
}
void main();
