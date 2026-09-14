import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { getJobs, getJobSearchCount } from "../../src/lib/queries/jobs";
import { parseJobFilters } from "../../src/lib/jobs/search-params";
import { buildLocationSearchPredicate } from "../../src/lib/location-search";
import { buildFeedLocationSql } from "../../src/lib/queries/job-location-sql";
import { Prisma } from "../../src/generated/prisma/client";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE, "no remote database override in fixture tests");
  const token = `ranktest${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const old = new Date(now.getTime() - 45 * 86_400_000);
  const jobId = (index: number) => `${token}-${String(index).padStart(5, "0")}`;
  // Exceed the selective-search threshold so this exercises the broad path.
  const size = 8_055;
  try {
    await prisma.userProfile.create({ data: { id: token, name: "Ranked search fixture", email: `${token}@example.test` } });
    for (let offset = 0; offset < size; offset += 200) {
      const rows = Array.from({ length: Math.min(200, size - offset) }, (_, n) => {
        const index = offset + n;
        return {
          id: jobId(index), title: `${token} ${index < 128 ? "Selective " : ""}Software Engineer`, company: token,
          location: `Toronto, Ontario, Canada ${token}`, region: "CA" as const,
          workMode: "REMOTE" as const, employmentType: "FULL_TIME" as const,
          roleFamily: "Software Engineering", applyUrl: `https://example.test/jobs/${jobId(index)}`,
          postedAt: now, status: "LIVE" as const,
        };
      });
      await prisma.jobCanonical.createMany({ data: rows.map((row) => ({
        ...row,
        description: "Build reliable services and maintain automated tests with the engineering team.",
        shortSummary: "Local ranked search fixture", lastSourceSeenAt: now, availabilityScore: 100,
      })) });
      await prisma.jobFeedIndex.createMany({ data: rows.map(({ id, ...row }, n) => ({
        ...row, canonicalJobId: id, searchText: row.title,
        rankingScore: Math.floor((offset + n) / 100), freshnessScore: (offset + n) % 3,
        qualityScore: (offset + n) % 5, trustScore: (offset + n) % 7,
      })) });
    }
    await prisma.jobCanonical.update({ where: { id: jobId(0) }, data: { availabilityScore: 0 } });
    await prisma.jobCanonical.update({ where: { id: jobId(1) }, data: { deadSignalAt: now } });
    await prisma.jobCanonical.update({ where: { id: jobId(2) }, data: { deadline: old } });
    await prisma.jobCanonical.update({ where: { id: jobId(3) }, data: { lastSourceSeenAt: old } });
    await prisma.jobCanonical.update({ where: { id: jobId(4) }, data: { applyUrlValidationStatus: "BROKEN_APPLY_LINK" } });
    await prisma.jobCanonical.update({ where: { id: jobId(5) }, data: { company: "unknown" } });
    await prisma.jobCanonical.update({ where: { id: jobId(6) }, data: { status: "REMOVED" } });
    await prisma.jobFeedIndex.update({ where: { canonicalJobId: jobId(6) }, data: { status: "REMOVED" } });
    await prisma.jobFeedIndex.update({ where: { canonicalJobId: jobId(7) }, data: { company: "unknown" } });
    await prisma.userBehaviorSignal.create({ data: { userId: token, canonicalJobId: jobId(size - 1), action: "PASS" } });

    const deferredFilters = parseJobFilters({ titleSearch: token, region: "CA" });
    const deferred = await getJobs(deferredFilters, { viewerProfileId: token, authUserId: null, deferExactTotal: true });
    assert.equal(deferred.total, null, "uncached totals do not block rows");
    assert.equal(deferred.countPending, true);
    assert.equal(deferred.data.length, 50);
    const exact = await getJobSearchCount(deferredFilters, { viewerProfileId: token, authUserId: token });
    assert.equal(exact, size - 9, "deferred count includes all hard filters and PASS exclusions");
    const next = await getJobs({ ...deferredFilters, page: 2 }, { viewerProfileId: token, authUserId: null, deferExactTotal: true });
    assert.equal(next.total, exact, "later pages reuse the exact count");

    // A selective query must filter invalid candidates before the page boundary
    // and preserve every rank tie-breaker, not just rankingScore + postedAt.
    const eligible = Array.from({ length: 120 }, (_, index) => index + 8)
      .sort((a, b) => Math.floor(b / 100) - Math.floor(a / 100) || b % 3 - a % 3 || b % 5 - a % 5 || b % 7 - a % 7 || b - a);
    for (const page of [1, 2, 3]) {
      const result = await getJobs({ titleSearch: `${token} Selective`, page }, { viewerProfileId: token, authUserId: null });
      assert.equal(result.total, 120);
      assert.deepEqual(result.data.map((job) => job.id), eligible.slice((page - 1) * 50, page * 50).map(jobId));
    }

    // Archived status searches must not be prefiltered to LIVE candidates.
    const archived = await getJobs({ titleSearch: token, status: "REMOVED" }, { viewerProfileId: null, authUserId: null });
    assert.deepEqual(archived.data.map((job) => job.id), [jobId(6)]);

    for (const location of [token, "Toronto, Ontario, Canada", "CA", "Ontario;California", "Canada", "Toronto;Seattle", "Toronto%", "Toronto_", "Toronto\\", "Toronto' OR TRUE --"]) {
      const where = { canonicalJobId: { startsWith: `${token}-` }, ...buildLocationSearchPredicate(location) };
      const expected = await prisma.jobFeedIndex.count({ where });
      const [actual] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) FROM "JobFeedIndex" jfi WHERE jfi."canonicalJobId" LIKE ${`${token}-%`} AND ${buildFeedLocationSql(location)}`);
      assert.equal(Number(actual.count), expected, `location SQL parity: ${location}`);
    }

    for (const search of [{ titleSearch: token }, { companySearch: token }, { locationSearch: token }, { titleSearch: token, companySearch: token }, { titleSearch: token, locationSearch: token }]) {
      for (const viewerProfileId of [null, token]) {
        const seen = new Set<string>();
        for (const page of [1, 2]) {
          const filters = parseJobFilters({ ...search, page: String(page) });
          const options = { viewerProfileId, authUserId: null };
          const fast = await getJobs(filters, options);
          // Without salary bounds this flag changes no matches, but excludes
          // the narrow raw-SQL path and uses a distinct response-cache key.
          const fallback = await getJobs({ ...filters, includeUnknownSalary: true }, options);
          assert.equal(fast.total, size - 8 - (viewerProfileId ? 1 : 0));
          assert.equal(fast.total, fallback.total);
          assert.equal(fast.hasNextPage, fallback.hasNextPage);
          assert.equal(fast.data.length, 50);
          assert.deepEqual(fast.data.map((job) => job.id), fallback.data.map((job) => job.id));
          for (const job of fast.data) {
            assert.equal(seen.has(job.id), false, "stable ordering must not repeat jobs across pages");
            seen.add(job.id);
          }
        }
      }
    }
    console.log("PASS: broad title/company/combined searches match Prisma totals, ordering, pagination, public visibility and per-viewer PASS exclusions");
  } finally {
    await prisma.userProfile.deleteMany({ where: { id: token } });
    await prisma.jobCanonical.deleteMany({ where: { id: { startsWith: `${token}-` } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
