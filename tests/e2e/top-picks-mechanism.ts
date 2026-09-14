import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

if (process.env.NODE_ENV === "production" || !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)) {
  throw new Error("Queue fixtures require a local development database.");
}

async function main() {
  const { prisma } = await import("../../src/lib/db");
  const { enqueueDurableTopPicksRefresh: enqueue, claimTopPicksRefreshTasks: claim, finishTopPicksRefreshTask: finish } = await import("../../src/lib/top-picks/refresh-queue");
  const { buildAndStoreUserMatchProfile, replaceUserTopPicks, getTopPicksRefreshStatus } = await import("../../src/lib/top-picks/service");
  const { TOP_PICKS_ALGORITHM_VERSION, TOP_PICKS_RESULT_TTL_MS } = await import("../../src/lib/top-picks/config");
  const users = [`ranking-test-${randomUUID()}`, `ranking-test-${randomUUID()}`];
  const priorityScore = 1_000_000;
  const request = (userId: string) => enqueue({ userId, priorityScore, reason: "mechanism_fixture" });
  const claimOne = async () => {
    const tasks = await claim(1);
    assert.equal(tasks.length, 1);
    assert.ok(users.includes(tasks[0].userId), "Fixture must never claim another user's task");
    return tasks[0];
  };
  try {
    assert.equal(await prisma.topPickRefreshTask.count({ where: { OR: [{ status: "RUNNING" }, { priorityScore: { gte: priorityScore } }] } }), 0, "Stop local refresh workers before running the fixture");
    for (const id of users) await prisma.userProfile.create({ data: {
      id, email: `${id}@example.test`, name: "Ranking fixture", headline: "Junior Software Engineer",
      skillsJson: ["TypeScript", "React"], experienceLevel: "ENTRY", location: "Toronto, Canada",
    } });
    const profile = await buildAndStoreUserMatchProfile(users[0]);
    assert.ok(profile);
    const requests = await Promise.all(Array.from({ length: 12 }, () => request(users[0])));
    assert.equal(new Set(requests.map((value) => value.task.id)).size, 1);
    const firstTask = await prisma.topPickRefreshTask.findUniqueOrThrow({ where: { userId: users[0] } });
    assert.equal(firstTask.requestedVersion, 12);
    await request(users[1]);
    const claims = await Promise.all([claimOne(), claimOne()]);
    assert.equal(new Set(claims.map((value) => value.id)).size, 2);
    const old = claims.find((value) => value.userId === users[0])!;
    const other = claims.find((value) => value.userId === users[1])!;
    await Promise.all(Array.from({ length: 8 }, () => request(users[0])));
    await assert.rejects(replaceUserTopPicks({ userId: users[0], profileVersion: profile.profileVersion, picks: [], claim: old }), /superseded/);
    const followUp = await finish(old, "SUCCESS", { lastResult: { storedCount: 1 } });
    assert.equal(followUp?.status, "PENDING");
    assert.equal(followUp?.attemptCount, 0);
    const fresh = await claimOne();
    assert.equal(fresh.claimedVersion, 20);
    assert.equal(await finish(old, "FAILED", { retryAt: new Date() }), null);
    await replaceUserTopPicks({ userId: users[0], profileVersion: profile.profileVersion, picks: [], claim: fresh });
    await finish(fresh, "SUCCESS", { lastResult: {
      profileVersion: profile.profileVersion, storedCount: 0, algorithmVersion: TOP_PICKS_ALGORITHM_VERSION,
    } });
    const zero = await getTopPicksRefreshStatus(users[0]);
    assert.equal(zero.profileReady, true);
    assert.equal(zero.validCount, 0);
    assert.equal(zero.stale, false, "Successful zero matches must not loop forever");
    assert.ok(zero.lastComputedAt);
    await prisma.topPickRefreshTask.update({ where: { id: fresh.id }, data: { finishedAt: new Date(Date.now() - TOP_PICKS_RESULT_TTL_MS - 1) } });
    assert.equal((await getTopPicksRefreshStatus(users[0])).stale, true);

    await prisma.topPickRefreshTask.update({ where: { id: other.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000), attemptCount: other.maxAttempts } });
    await request(users[0]);
    const sentinel = await claimOne();
    assert.equal((await prisma.topPickRefreshTask.findUniqueOrThrow({ where: { id: other.id } })).status, "FAILED", "Exhausted leases must not retry forever");
    assert.equal(await finish(other, "SUCCESS"), null);
    await finish(sentinel, "SUCCESS");

    await request(users[1]);
    const expired = await claimOne();
    await request(users[1]);
    await prisma.topPickRefreshTask.update({ where: { id: expired.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000), attemptCount: expired.maxAttempts } });
    const recovered = await claimOne();
    assert.equal(recovered.attemptCount, 1);
    assert.ok(recovered.claimedVersion > expired.claimedVersion);
    assert.equal(await finish(expired, "SUCCESS"), null);
    const retryAt = new Date(Date.now() + 30_000);
    const retry = await finish(recovered, "FAILED", { retryAt, lastError: "fixture transient error" });
    assert.equal(retry?.status, "PENDING");
    assert.equal(retry?.attemptCount, 1);
    assert.equal(retry?.notBeforeAt.toISOString(), retryAt.toISOString());
    assert.equal(await finish(recovered, "SUCCESS"), null);
    console.log("PASS: concurrent enqueue/claim, coalesced follow-up, publication fencing, stale completion, lease recovery, bounded retries, empty-result TTL");
  } finally {
    await prisma.userProfile.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
