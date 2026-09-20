import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { getAutofillPlan, rememberAutofillAnswer } from "../../src/lib/queries/extension-autofill";
import { getDefaultExtensionResume } from "../../src/lib/queries/extension-resume";
import { hashSecret } from "../../src/lib/queries/application-assistant";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Local database required");
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "", "Private DB override must be cleared");
  const suffix = randomBytes(8).toString("hex"), clientId = "a".repeat(32);
  const root = `data/uploads/autofill-test-${suffix}`;
  process.env.APPLICATION_EXTENSION_IDS = clientId;
  const user = await prisma.user.create({ data: { name: "Autofill Test", email: `autofill-${suffix}@example.test`,
    profile: { create: { name: "Autofill Test", email: `autofill-${suffix}@example.test`, phone: "4165550100",
      experiencesJson: [{ title: "Analyst", company: "Fixture", location: "Toronto", description: "Testing", dates: { start: "2020", current: true } }],
    } } }, include: { profile: true } });
  const url = "https://job-boards.greenhouse.io/fixture/jobs/123";
  const request = { url, questions: ["Relevant project"], history: true };
  try {
    let plan = await getAutofillPlan(user.id, request);
    assert.equal(plan.contact.fullName, "Autofill Test");
    assert.equal(plan.contact.email, user.email);
    assert.equal(plan.contact.phone, "4165550100");
    assert.equal(plan.contact.givenName || "", "", "Never invent a legal name split");
    assert.equal(plan.history.length, 1);
    assert.equal((await getAutofillPlan(user.id, { ...request, history: false })).history.length, 0);
    assert.equal(plan.includeResume, false);
    const answer = { url, label: "First name", profileKey: "givenName", answer: "Jordan", revision: plan.revision };
    await rememberAutofillAnswer(user.id, answer);
    await assert.rejects(() => rememberAutofillAnswer(user.id, answer), /profile changed/);
    plan = await getAutofillPlan(user.id, request);
    assert.equal(plan.contact.givenName, "Jordan");
    assert.equal(plan.contact.phone, "4165550100", "Saving one field preserves legacy profile columns");
    await rememberAutofillAnswer(user.id, { url, label: "Relevant project", answer: "Built the fixture", revision: plan.revision });
    plan = await getAutofillPlan(user.id, request);
    assert.equal(plan.answers.length, 1);
    assert.equal((await getAutofillPlan(user.id, { ...request, url: url.replace("/fixture/", "/other/") })).answers.length, 0);
    await prisma.userProfile.update({ where: { id: user.profile!.id }, data: { headline: "Changed profile" } });
    assert.equal((await getAutofillPlan(user.id, request)).answers.length, 0);

    const session = await prisma.session.create({ data: { userId: user.id, token: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
    const connection = await prisma.extensionConnection.create({ data: { userId: user.id, sessionId: session.id, clientId, challenge: "b".repeat(43), tokenHash: hashSecret(randomBytes(32).toString("base64url")), connectedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    const identity = { userId: user.id, connectionId: connection.id };
    await assert.rejects(() => getDefaultExtensionResume(identity, { url }), /Enable default/);
    await prisma.userProfile.update({ where: { id: user.profile!.id }, data: { contactJson: { autofillResume: true } } });
    await assert.rejects(() => getDefaultExtensionResume(identity, { url }), /Choose one default/);
    await mkdir(root, { recursive: true });
    const bytes = Buffer.from("%PDF-1.4\nSynthetic test resume only\n%%EOF");
    await writeFile(`${root}/resume.pdf`, bytes);
    const document = await prisma.document.create({ data: { userId: user.profile!.id, type: "RESUME", isPrimary: true, title: "Fixture", originalFileName: "Fixture.pdf", filename: "resume.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, storageKey: `autofill-test-${suffix}/resume.pdf` } });
    const file = await getDefaultExtensionResume(identity, { url });
    assert.equal(file.base64, bytes.toString("base64"));
    await prisma.document.update({ where: { id: document.id }, data: { isPrimary: false } });
    await assert.rejects(() => getDefaultExtensionResume(identity, { url }), /Choose one default/);
    await prisma.document.update({ where: { id: document.id }, data: { isPrimary: true } });
    await prisma.extensionConnection.delete({ where: { id: connection.id } });
    await assert.rejects(() => getDefaultExtensionResume(identity, { url }), /access changed/);
    console.log("PASS real database: profile fallback, saved facts, stale revisions, employer-scoped answers, history, explicit default resume opt-in and revocation");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await rm(root, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
