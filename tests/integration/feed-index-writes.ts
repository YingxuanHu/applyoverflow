import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { upsertJobFeedIndex } from "../../src/lib/ingestion/search-index";
import { buildFeedIndexWrite } from "../../src/lib/ingestion/feed-index-write";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const id = `indexwrite-${randomUUID()}`;
  try {
    const broken = JSON.stringify({ description: ("x".repeat(3999) + "\uD83D\uDCB6").slice(0, 4000) });
    await assert.rejects(() => prisma.$queryRaw`SELECT ${broken}::jsonb`, /invalid input syntax for type json/);
    const job = await prisma.jobCanonical.create({ data: {
      id, title: "Software Engineer", company: "Fixture Labs", location: "Toronto, Ontario, Canada", region: "CA",
      workMode: "REMOTE", employmentType: "FULL_TIME", roleFamily: "Engineering", applyUrl: `https://example.test/jobs/${id}`,
      description: "Build services and write automated tests. Work with product managers to design reliable software. Review code and maintain documentation. ".padEnd(3999, "x") + "\uD83D\uDCB6" + randomBytes(12000).toString("hex"),
      shortSummary: "Build reliable services.", postedAt: new Date(), lastSourceSeenAt: new Date(), status: "LIVE", availabilityScore: 100,
    } });
    await upsertJobFeedIndex(id);
    const projection = await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } });
    assert.equal(projection.searchText.isWellFormed(), true, "truncation must remain valid PostgreSQL JSON");
    assert.equal((await prisma.jobCanonical.findUniqueOrThrow({ where: { id } })).description, job.description, "indexing must not rewrite source text");
    const table = await prisma.$queryRaw<Array<{ name: string }>>`SELECT reltoastrelid::regclass::text AS name FROM pg_class WHERE oid = '"JobFeedIndex"'::regclass`;
    assert.match(table[0].name, /^pg_toast\.pg_toast_[0-9]+$/);
    const toastIds = () => prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT DISTINCT chunk_id::text AS id FROM ${Prisma.raw(table[0].name)} ORDER BY id`);
    const before = await toastIds();
    const at = new Date(projection.indexedAt.getTime() + 1000);
    const data = { ...projection, metadataJson: projection.metadataJson ?? {}, titleExtractionWarnings: projection.titleExtractionWarnings ?? [], experienceLevelEvidenceJson: projection.experienceLevelEvidenceJson ?? [], experienceLevelWarningsJson: projection.experienceLevelWarningsJson ?? [], extractionWarnings: projection.extractionWarnings ?? [], metadataExtractionWarnings: projection.metadataExtractionWarnings ?? [], indexedAt: at, updatedAt: at };
    await prisma.$executeRaw(buildFeedIndexWrite(data, job.updatedAt));
    assert.deepEqual(await toastIds(), before, "an unchanged refresh must reuse existing external values");
    const after = await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } });
    assert.equal(after.indexedAt.getTime(), at.getTime());
    assert.equal(await prisma.$executeRaw(buildFeedIndexWrite({ ...data, metadataJson: {}, indexedAt: projection.indexedAt }, job.updatedAt)), 0, "older worker must not replace newer index");
    const changed = await prisma.jobCanonical.update({ where: { id }, data: { title: "Senior Software Engineer" } });
    assert.equal(await prisma.$executeRaw(buildFeedIndexWrite({ ...data, metadataJson: {}, indexedAt: new Date(at.getTime() + 1000) }, job.updatedAt)), 0, "a changed canonical version invalidates old projection");
    assert.notEqual(changed.updatedAt.getTime(), job.updatedAt.getTime());
    console.log("PASS: feed projection, TOAST reuse, out-of-order writes and canonical-version guard");
  } finally {
    await prisma.jobCanonical.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
