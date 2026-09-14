import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

if (
  process.env.NODE_ENV === "production" ||
  !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)
) {
  throw new Error("Search fixtures require a local database.");
}

async function main() {
  process.env.JOB_FILTER_ASSERTIONS = "1";
  const { prisma } = await import("../../src/lib/db");
  const { getJobs } = await import("../../src/lib/queries/jobs");
  const { parseJobFilters } = await import("../../src/lib/jobs/search-params");
  const { upsertJobFeedIndex } = await import(
    "../../src/lib/ingestion/search-index"
  );
  const { serializeJobCardData } = await import(
    "../../src/lib/job-serialization"
  );
  const company = `SearchAudit ${randomUUID()}`;
  const source = `OfficialCompany:${company}`;
  const ids: string[] = [];
  const rawIds: string[] = [];
  const now = new Date();
  const timings: number[] = [];
  let queryCases = 0;
  try {
    const cases = [
      {
        title: "C++ Developer 50%",
        location: "Toronto, ON, Canada",
        region: "CA" as const,
        workMode: "REMOTE" as const,
        workModeConfidence: 1,
        salaryMin: 90000,
        salaryMax: 100000,
        salaryCurrency: "USD",
      },
      {
        title: "C# Developer 50x",
        location: "Ottawa, ON, Canada",
        region: "CA" as const,
        workMode: "HYBRID" as const,
        workModeConfidence: 1,
        salaryMin: 120000,
        salaryMax: 140000,
        salaryCurrency: "CAD",
      },
      {
        title: "Cloud Developer",
        location: "Toronto, ON, Canada",
        region: "CA" as const,
        workMode: "REMOTE" as const,
        workModeConfidence: 0.2,
        salaryMin: 90000,
        salaryMax: 100000,
        salaryCurrency: null,
      },
      {
        title: "Data Analyst",
        location: "Vancouver, WA, US",
        region: "US" as const,
        workMode: "ONSITE" as const,
        workModeConfidence: 1,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
      },
    ];
    for (const row of cases) {
      const job = await prisma.jobCanonical.create({
        data: {
          ...row,
          company,
          employmentType: "FULL_TIME",
          employmentTypeGroup: "FULL_TIME",
          employmentTypeConfidence: 1,
          description:
            "Fictional search contract fixture. Salary information is intentionally controlled by the test.",
          shortSummary: "Search test fixture",
          roleFamily: "Software",
          applyUrl: `https://example.test/${randomUUID()}`,
          postedAt: now,
          firstSeenAt: now,
          status: "LIVE",
          availabilityScore: 95,
          qualityScore: 95,
          trustScore: 95,
          freshnessScore: 95,
          lastSourceSeenAt: now,
          lastConfirmedAliveAt: now,
          normalizedRoleCategory: "SOFTWARE_ENGINEERING",
          normalizedRoleCategoryConfidence: 1,
          classificationStatus: "CONFIDENT",
          experienceLevelGroup: "SENIOR_LEAD_STAFF",
          normalizedCareerStageConfidence: 1,
        },
      });
      ids.push(job.id);
      const raw = await prisma.jobRaw.create({
        data: {
          sourceId: job.id,
          sourceName: source,
          sourceTier: "TIER_1",
          rawPayload: {},
          fetchedAt: now,
        },
      });
      rawIds.push(raw.id);
      await prisma.jobSourceMapping.create({
        data: {
          canonicalJobId: job.id,
          rawJobId: raw.id,
          sourceName: source,
          sourceUrl: job.applyUrl,
          isPrimary: true,
          sourceQualityKind: "DIRECT_COMPANY",
          sourceQualityRank: 100,
          sourceType: "COMPANY_SITE",
          sourceReliability: 1,
        },
      });
      await upsertJobFeedIndex(job.id);
    }
    const query = async (search: string, canonical: boolean) => {
      const params = new URLSearchParams(search);
      params.set("companySearch", company);
      if (canonical) params.set("source", source);
      const started = performance.now();
      const result = await getJobs(parseJobFilters(params, "USD"), {
        viewerProfileId: null,
        authUserId: null,
        userTimeZone: "UTC",
      });
      timings.push(performance.now() - started);
      assert.ok(result.data.every((row) => row.company === company));
      return result;
    };
    for (const canonical of [false, true]) {
      for (const [search, expected] of [
        ["locationSearch=Toronto%2C+ON", [0, 2]],
        ["locationSearch=British+Columbia", []],
        ["locationSearch=ca", []],
        ["workMode=REMOTE&workMode=HYBRID", [0, 1]],
        ["titleSearch=50%25", [0]],
        ["titleSearch=C%2B%2B", [0]],
        ["salaryMin=80000&salaryMax=110000&salaryCurrency=USD", [0, 1]],
        [
          "salaryMin=80000&salaryMax=110000&salaryCurrency=USD&includeUnknownSalary=1",
          [0, 1, 2, 3],
        ],
        ["posted=1d&posted=7d&careerStage=SENIOR", [0, 1, 2, 3]],
      ] as const) {
        const result = await query(search, canonical);
        assert.deepEqual(
          new Set(result.data.map((row) => row.id)),
          new Set(expected.map((index) => ids[index])),
          `${canonical ? "canonical" : "index"}: ${search}`,
        );
        assert.equal(result.total, expected.length);
        queryCases++;
      }
    }
    const unknown = (await query("titleSearch=Cloud", false)).data[0]!;
    const card = serializeJobCardData(unknown);
    assert.equal(card.workMode, "UNKNOWN");
    assert.equal(card.salaryCurrency, null);
    for (let i = 0; i < 5; i++)
      await query("locationSearch=Toronto%2C+ON", false);
    console.log(
      JSON.stringify({
        queryCases,
        serializationChecks: 2,
        coldQueryMs: Math.round(timings[0]),
        warmQueryMs: timings.slice(-5).map(Math.round),
        fixtureCleanup: "finally",
      }),
    );
  } finally {
    await prisma.jobCanonical.deleteMany({ where: { id: { in: ids } } });
    await prisma.jobRaw.deleteMany({ where: { id: { in: rawIds } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
