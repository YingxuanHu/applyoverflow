import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { runDurableStorageDeletion } from "../../src/lib/storage";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  const key = `test-deletion-${randomUUID()}`;
  const user = await prisma.user.create({ data: { name: "Deletion fixture", email: `${key}@example.invalid` } });
  const profile = await prisma.userProfile.create({ data: { authUserId: user.id, name: user.name, email: user.email } });
  const createDocument = (storageKey: string) => prisma.document.create({ data: {
    userId: profile.id, type: "RESUME", title: "Fixture", originalFileName: "fixture.pdf",
    filename: "fixture.pdf", mimeType: "application/pdf", sizeBytes: 10, storageKey,
  } });
  try {
    const document = await createDocument(key);
    let removed = false;
    await assert.rejects(runDurableStorageDeletion(key, async () => { removed = true; }), /referenced document/);
    assert.equal(removed, false, "legacy retry must never remove a still-referenced file");
    await prisma.storageDeletionTask.deleteMany({ where: { storageKey: key } });
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: document.id } });
      assert.ok(await tx.storageDeletionTask.findUnique({ where: { storageKey: key } }));
      throw new Error("rollback deletion");
    }), /rollback deletion/);
    assert.ok(await prisma.document.findUnique({ where: { id: document.id } }));
    assert.equal(await prisma.storageDeletionTask.findUnique({ where: { storageKey: key } }), null);
    await prisma.document.delete({ where: { id: document.id } });
    assert.ok(await prisma.storageDeletionTask.findUnique({ where: { storageKey: key } }), "committed deletion queues durable intent");
    await assert.rejects(runDurableStorageDeletion(key, async () => { throw new Error("storage unavailable"); }), /storage unavailable/);
    const retained = await prisma.storageDeletionTask.findUniqueOrThrow({ where: { storageKey: key } });
    assert.equal(retained.attempts, 1);
    assert.ok(retained.nextAttemptAt.getTime() > Date.now());
    await runDurableStorageDeletion(key, async () => {});
    assert.equal(await prisma.storageDeletionTask.findUnique({ where: { storageKey: key } }), null);
    await createDocument(key);
    await prisma.user.delete({ where: { id: user.id } });
    assert.equal(await prisma.document.count({ where: { storageKey: key } }), 0);
    assert.ok(await prisma.storageDeletionTask.findUnique({ where: { storageKey: key } }), "account cascade queues storage removal");
    console.log("PASS: document rollback, live-reference protection, storage failure/retry, and account cascade (no storage requests)");
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.storageDeletionTask.deleteMany({ where: { storageKey: key } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
