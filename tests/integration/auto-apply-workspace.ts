import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { queueAutoApplyJob, removeAutoApplyJob, createAutoApplyHandoff, resolveAutoApplyTarget } from "../../src/lib/queries/auto-apply";
import { REQUIREMENTS_KEY } from "../../src/lib/top-picks/requirements";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Local test database only");
  const tag = randomUUID();
  const owner = await prisma.user.create({ data: { email: `${tag}@example.test`, name: "Workspace fixture", profile: { create: { name: "Workspace fixture", email: `${tag}@example.test`, location: "Toronto, Ontario, Canada" } } }, include: { profile: true } });
  const other = await prisma.user.create({ data: { email: `other-${tag}@example.test`, name: "Other" } });
  const job = await prisma.jobCanonical.create({ data: { title: "Software Engineer", company: "Workspace fixture", location: "Toronto, Canada", workMode: "ONSITE", employmentType: "FULL_TIME", description: "Synthetic", shortSummary: "Synthetic", roleFamily: "TECH", applyUrl: `https://careers.example.test/jobs/${tag}/apply`, postedAt: new Date(), lastConfirmedAliveAt: new Date(), status: "LIVE", availabilityScore: 100 } });
  await prisma.jobCanonical.update({ where: { id: job.id }, data: { workModeConfidence: 1, workModeStatus: "accepted" } });
  try {
    const first = await queueAutoApplyJob(owner.id, job.id);
    assert.equal((await queueAutoApplyJob(owner.id, job.id)).id, first.id, "idempotent queue");
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
    console.log('PASS workspace database: idempotent queue, ownership, account-bound handoff, changed URL, fresh requirements, removal, duplicate and expired-posting gates; no submissions');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await prisma.jobCanonical.delete({ where: { id: job.id } });
    await prisma.$disconnect();
  }
}
void main();
