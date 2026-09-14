import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildJobFeedIndexRepairQuery } from "../../src/lib/ingestion/search-index";
import { Prisma } from "../../src/generated/prisma/client";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const token = `repairtest-${randomUUID()}`;
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 2 * 86_400_000);
  const ids = ["recent", "old", "changed", "missing"].map((suffix) => `${token}-${suffix}`);
  try {
    for (const [index, id] of ids.entries()) {
      await prisma.jobCanonical.create({ data: {
        id, title: "Production Operator", company: "Fixture Company", location: "Toronto, ON, Canada", region: "CA",
        workMode: "ONSITE", employmentType: "FULL_TIME", roleFamily: "Fixture", description: "Fixture only", shortSummary: "Fixture only",
        applyUrl: `https://example.test/jobs/${id}`, postedAt: now, lastSourceSeenAt: now, availabilityScore: 100, status: "LIVE",
        updatedAt: index === 2 ? now : dayAgo,
        sourceMappings: { create: { sourceName: token, sourceUrl: `https://example.test/jobs/${id}`, rawJob: { create: { id, sourceName: token, sourceTier: "TIER_2", sourceId: id, rawPayload: {}, fetchedAt: now } } } },
      } });
      if (index !== 3) await prisma.jobFeedIndex.create({ data: {
        canonicalJobId: id, title: "Production Operator", company: "Fixture Company", location: "Toronto", region: "CA", workMode: "ONSITE",
        roleFamily: "Fixture", employmentType: "FULL_TIME", applyUrl: `https://example.test/jobs/${id}`, postedAt: now, searchText: "Fixture", status: "REMOVED",
        indexedAt: index === 0 ? now : dayAgo,
      } });
    }
    // Restrict the actual production selector to our own fixture rows after it
    // has evaluated visibility/staleness. The local fixture database is small.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM (${buildJobFeedIndexRepairQuery("all", 100_000)}) candidates WHERE id = ANY(${ids})
    `);
    assert.deepEqual(rows.map((row) => row.id).sort(), ids.slice(1).sort());
    console.log("PASS: recent deliberate exclusions are not rewritten; old hidden, changed and missing rows still repair");
  } finally {
    await prisma.jobCanonical.deleteMany({ where: { id: { in: ids } } });
    await prisma.jobRaw.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
