import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { databaseSourceHostGate } from "../../src/lib/ingestion/host-rate-limit";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  const host = `fixture-${randomUUID()}.invalid`;
  const key = `ingestion-host:${host}`;
  try {
    const first = await databaseSourceHostGate.reserve(host);
    assert.equal(first.waitMs, 0);
    assert.ok((await databaseSourceHostGate.reserve(host)).waitMs > 0);
    await databaseSourceHostGate.defer(host, 120000);
    const long = await databaseSourceHostGate.reserve(host);
    assert.ok(long.retryAt);
    await databaseSourceHostGate.defer(host, 30000);
    assert.equal((await databaseSourceHostGate.reserve(host)).retryAt?.getTime(), long.retryAt.getTime(), "shorter responses cannot erase shared cooldowns");
    await prisma.resourceBudget.update({ where: { key }, data: { resetAt: new Date(0) } });
    assert.equal((await databaseSourceHostGate.reserve(host)).waitMs, 0);
    console.log("PASS: database-backed shared pacing, cooldown preservation and expiry");
  } finally {
    await prisma.resourceBudget.deleteMany({ where: { key } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
