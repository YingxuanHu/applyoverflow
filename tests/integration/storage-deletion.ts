import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { runDurableStorageDeletion } from "../../src/lib/storage";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  const key = `test-deletion-${randomUUID()}`;
  try {
    await assert.rejects(runDurableStorageDeletion(key, async () => { throw new Error("storage unavailable"); }), /storage unavailable/);
    const retained = await prisma.storageDeletionTask.findUniqueOrThrow({ where: { storageKey: key } });
    assert.equal(retained.attempts, 1);
    assert.ok(retained.nextAttemptAt.getTime() > Date.now());
    await runDurableStorageDeletion(key, async () => {});
    assert.equal(await prisma.storageDeletionTask.findUnique({ where: { storageKey: key } }), null);
    console.log("PASS: deletion intent retained after failure and cleared after confirmed retry (no storage requests)");
  } finally {
    await prisma.storageDeletionTask.deleteMany({ where: { storageKey: key } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
