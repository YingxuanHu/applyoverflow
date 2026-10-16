import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { createSetupChallenge, answerSetupChallenge, readSetupChallenge, extensionSetupCapabilities } from "../../src/lib/queries/extension-setup";
import { hashSecret } from "../../src/lib/queries/application-assistant";
import { recordOnboardingEvent } from "../../src/lib/queries/onboarding-events";
import { INITIAL_ONBOARDING, ONBOARDING_KEY } from "../../src/lib/profile-setup";

async function main() {
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Disposable local accounts only");
const clientId = "a".repeat(32);
process.env.APPLICATION_EXTENSION_IDS = clientId;
const users: string[] = [];
const challenges: string[] = [];
try {
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { email: `setup-${randomUUID()}@example.invalid`, name: "Setup Fixture", emailVerified: true } });
    users.push(user.id);
  }
  const sessions = await Promise.all(users.map(userId => prisma.session.create({ data: { userId, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })));
  const connections = await Promise.all(users.map((userId, i) => prisma.extensionConnection.create({ data: {
    userId, sessionId: sessions[i].id, clientId, challenge: "fixture", connectedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
  } })));
  const web = { authUserId: users[0], sessionId: sessions[0].id };
  const issue = async () => { const result = await createSetupChallenge(web, clientId); challenges.push(hashSecret(result.challenge)); return result.challenge; };
  const identity = { userId: users[0], connectionId: connections[0].id };
  const pending = await issue();
  assert.equal((await readSetupChallenge(web, pending)).state, "disconnected");
  await assert.rejects(readSetupChallenge({ ...web, sessionId: sessions[1].id }, pending));
  await assert.rejects(readSetupChallenge({ ...web, authUserId: users[1] }, pending));
  const attempts = await Promise.allSettled([answerSetupChallenge(identity, { challenge: pending }), answerSetupChallenge(identity, { challenge: pending })]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1, "challenge consumed exactly once");
  assert.deepEqual(await readSetupChallenge(web, pending), { state: "verified" });
  const mismatch = await issue();
  assert.deepEqual(await answerSetupChallenge({ userId: users[1], connectionId: connections[1].id }, { challenge: mismatch }), { checked: true, matched: false });
  assert.deepEqual(await readSetupChallenge(web, mismatch), { state: "mismatch" });
  const wrongOwner = await issue();
  await assert.rejects(answerSetupChallenge({ userId: users[1], connectionId: connections[0].id }, { challenge: wrongOwner }));
  await prisma.session.update({ where: { id: sessions[0].id }, data: { expiresAt: new Date(0) } });
  assert.deepEqual(await readSetupChallenge(web, pending), { state: "disconnected" }, "revoked session invalidates proof");
  await prisma.verification.update({ where: { id: hashSecret(mismatch) }, data: { expiresAt: new Date(0) } });
  await assert.rejects(readSetupChallenge(web, mismatch));
  assert.deepEqual(await extensionSetupCapabilities(users[0]), { contact: false, pendingReview: false, resume: "none" });
  const profile = await prisma.userProfile.create({ data: { authUserId: users[0], name: "Saved Profile", email: `saved-${randomUUID()}@example.invalid`,
    preferences: { create: { key: ONBOARDING_KEY, value: JSON.stringify(INITIAL_ONBOARDING) } } } });
  assert.equal((await extensionSetupCapabilities(users[0])).contact, false, "account defaults alone are not reviewed details");
  await prisma.userProfile.update({ where: { id: profile.id }, data: { contactJson: { fullName: "Saved Profile", email: "contact@example.invalid" } } });
  assert.equal((await extensionSetupCapabilities(users[0])).contact, true, "a profile saved outside onboarding stays usable without another wizard");
  const journey = randomUUID();
  process.env.ONBOARDING_METRICS_ENABLED = "1";
  await recordOnboardingEvent({ event: "setup_opened", entry: "extension", journey }, users[0]);
  await recordOnboardingEvent({ event: "setup_opened", entry: "extension", journey }, users[0]);
  assert.equal(await prisma.onboardingEvent.count({ where: { userId: users[0] } }), 1, "deduplicated first-party event");
  const run = randomUUID();
  for (const value of [run, run, randomUUID()])
    await recordOnboardingEvent({ event: "autofill_attempted", entry: "extension", journey, run: value }, users[0]);
  assert.equal(await prisma.onboardingEvent.count({ where: { userId: users[0], event: "autofill_attempted" } }), 2, "distinct runs count, retried delivery does not");
  for (let i = 0; i < 2; i++)
    await recordOnboardingEvent({ event: "first_real_autofill_succeeded", entry: "extension", journey, run: randomUUID(), filled: 1 }, users[0]);
  assert.equal(await prisma.onboardingEvent.count({ where: { userId: users[0], event: "first_real_autofill_succeeded" } }), 1);
  process.env.ONBOARDING_METRICS_ENABLED = "0";
  await recordOnboardingEvent({ event: "profile_details_confirmed", entry: "extension", journey }, users[0]);
  assert.equal(await prisma.onboardingEvent.count({ where: { userId: users[0] } }), 4, "disabled measurement stores nothing");
  console.log("PASS: real database account/session binding, single-use concurrency, mismatch, expiry, revocation, independent capabilities and opt-in event deduplication");
} finally {
  await prisma.verification.deleteMany({ where: { id: { in: challenges } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
