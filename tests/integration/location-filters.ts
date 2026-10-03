import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildLocationSearchPredicate } from "../../src/lib/location-search";
import { buildFeedLocationSql } from "../../src/lib/queries/job-location-sql";
import { getJobs } from "../../src/lib/queries/jobs";
import { parseJobFilters } from "../../src/lib/jobs/search-params";
import { upsertJobFeedIndex } from "../../src/lib/ingestion/search-index";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE, "no remote database override");
  const company = `LocationAudit ${randomUUID()}`;
  const source = `OfficialCompany:${company}`;
  const ids: string[] = [];
  const rawIds: string[] = [];
  const cases = [
    ["Iqaluit, NU", "CA", "ONSITE"],
    ["Toronto, Ontario, Canada", "CA", "HYBRID"],
    ["Remote", "CA", "REMOTE"],
    ["Remote - Canada", null, "REMOTE"],
    ["US & Canada", "US", "REMOTE"],
    ["Remote - North America", null, "REMOTE"],
    ["Worldwide", null, "REMOTE"],
    ["Seattle, WA", "US", "ONSITE"],
    ["Remote - United States", "US", "REMOTE"],
    ["Remote", null, "REMOTE"],
    ["London, UK", null, "REMOTE"],
    ["North America - US only", null, "REMOTE"],
  ] as const;
  try {
    for (const [location, region, workMode] of cases) {
      const job = await prisma.jobCanonical.create({ data: {
        title: "Software Engineer", company, location, region, workMode,
        workModeConfidence: 1, employmentType: "FULL_TIME", roleFamily: "Software Engineering",
        description: "Local location search fixture for testing geographical filtering across read models.",
        shortSummary: "Local geography test", applyUrl: `https://example.test/${randomUUID()}`,
        postedAt: new Date(), status: "LIVE", lastSourceSeenAt: new Date(), availabilityScore: 100,
      } });
      ids.push(job.id);
      const raw = await prisma.jobRaw.create({ data: { sourceId: job.id, sourceName: source, sourceTier: "TIER_1", rawPayload: {}, fetchedAt: new Date() } });
      rawIds.push(raw.id);
      await prisma.jobSourceMapping.create({ data: {
        canonicalJobId: job.id, rawJobId: raw.id, sourceName: source, sourceUrl: job.applyUrl,
        isPrimary: true, sourceQualityKind: "DIRECT_COMPANY", sourceQualityRank: 100, sourceType: "COMPANY_SITE", sourceReliability: 1,
      } });
      await upsertJobFeedIndex(job.id);
    }
    const queries = [
      ["Canada", [0, 1, 2, 3, 4, 5, 6]],
      ["United States", [4, 5, 6, 7, 8]],
      ["Toronto, ON;Seattle, WA", [1, 7]],
      ["Canada;Seattle, WA", [0, 1, 2, 3, 4, 5, 6, 7]],
      ["Canada;United States", [0, 1, 2, 3, 4, 5, 6, 7, 8]],
      ["Toronto, ON, Canada", [1]],
      ["Toronto%", []],
      ["Toronto' OR TRUE --", []],
    ] as const;
    let checks = 0;
    for (const [location, indices] of queries) {
      const expected = new Set(indices.map((index) => ids[index]));
      const where = buildLocationSearchPredicate(location)!;
      const canonical = await prisma.jobCanonical.findMany({ where: { id: { in: ids }, ...where }, select: { id: true } });
      assert.deepEqual(new Set(canonical.map((row) => row.id)), expected, `canonical: ${location}`);
      const index = await prisma.jobFeedIndex.findMany({ where: { canonicalJobId: { in: ids }, ...where }, select: { canonicalJobId: true } });
      assert.deepEqual(new Set(index.map((row) => row.canonicalJobId)), expected, `index: ${location}`);
      const sql = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT jfi."canonicalJobId" AS id FROM "JobFeedIndex" jfi WHERE jfi."canonicalJobId" IN (${Prisma.join(ids)}) AND ${buildFeedLocationSql(location)}`);
      assert.deepEqual(new Set(sql.map((row) => row.id)), expected, `SQL: ${location}`);
      for (const canonicalPath of [false, true]) {
        const result = await getJobs(parseJobFilters({ companySearch: company, locationSearch: location, ...(canonicalPath ? { source } : {}) }), { viewerProfileId: null, authUserId: null });
        assert.deepEqual(new Set(result.data.map((row) => row.id)), expected, `feed ${canonicalPath ? "canonical" : "index"}: ${location}`);
        assert.equal(result.total, expected.size);
      }
      checks += 5;
    }
    const remote = await getJobs(parseJobFilters({ companySearch: company, locationSearch: "Canada", workMode: "REMOTE" }), { viewerProfileId: null, authUserId: null });
    assert.deepEqual(new Set(remote.data.map((row) => row.id)), new Set([2, 3, 4, 5, 6].map((index) => ids[index])));
    console.log(`PASS: ${checks + 1} location checks across canonical, index, SQL, feed totals and remote work-mode intersection`);
  } finally {
    await prisma.jobCanonical.deleteMany({ where: { id: { in: ids } } });
    await prisma.jobRaw.deleteMany({ where: { id: { in: rawIds } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
