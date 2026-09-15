import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { prisma } from "../../src/lib/db";
import { Prisma } from "../../src/generated/prisma/client";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { buildHealthySourceCoverageSql, buildSourceCoverageRepairQuery } from "../../src/lib/ingestion/source-coverage-queries";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const prefix = `coverage-${randomUUID()}-`;
  const now = new Date();
  const old = new Date(now.getTime() - 8 * 86_400_000);
  const future = new Date(now.getTime() + 3_600_000);
  const id = (name: string) => prefix + name;

  async function company(name: string) {
    await prisma.company.create({ data: { id: id(name), companyKey: id(name), name: id(name), domain: `${name}.example.test` } });
  }
  async function source(name: string, data: Partial<Prisma.CompanySourceUncheckedCreateInput> = {}) {
    await prisma.companySource.create({ data: {
      id: id(`${name}-source`), companyId: id(name), sourceName: id(name), connectorName: "greenhouse",
      token: id(name), boardUrl: "https://example.test/jobs", status: "ACTIVE", validationState: "VALIDATED",
      pollState: "READY", createdAt: old, lastSuccessfulPollAt: old, ...data,
    } });
  }

  try {
    const cases: Array<[string, Partial<Prisma.CompanySourceUncheckedCreateInput>, boolean]> = [
      ["stale-active", {}, true],
      ["never-success", { lastSuccessfulPollAt: null }, true],
      ["broken", { status: "REDISCOVER_REQUIRED", validationState: "INVALID", pollState: "QUARANTINED" }, true],
      ["fresh", { lastSuccessfulPollAt: now }, false],
      ["fresh-backoff", { status: "DEGRADED", pollState: "BACKOFF", lastSuccessfulPollAt: now }, false],
      ["disabled", { status: "DISABLED", pollState: "DISABLED" }, false],
      ["disabled-poll", { pollState: "DISABLED" }, false],
      ["poll-running", { pollState: "ACTIVE" }, false],
      ["cooldown", { cooldownUntil: future }, false],
      ["new-provision", { status: "PROVISIONED", lastSuccessfulPollAt: null, lastProvisionedAt: now }, false],
      ["new-created", { status: "PROVISIONED", lastSuccessfulPollAt: null, createdAt: now }, false],
      ["healthy-alternative", {}, false],
      ["fresh-lead", {}, false],
      ["old-promoted-lead", {}, true],
    ];
    for (const [name, data] of cases) { await company(name); await source(name, data); }
    await source("alternative", { companyId: id("healthy-alternative"), lastSuccessfulPollAt: now });
    for (const name of ["fresh-lead", "old-promoted-lead"]) {
      await prisma.sourceCandidate.create({ data: {
        companyId: id(name), candidateType: "ATS_BOARD", status: name === "fresh-lead" ? "NEW" : "PROMOTED",
        candidateUrl: "https://boards.greenhouse.io/example", normalizedUrlKey: id(name), atsPlatform: "GREENHOUSE",
        lastSeenAt: name === "fresh-lead" ? now : old,
      } });
    }
    const repair = await prisma.$queryRaw<Array<{ id: string }>>(buildSourceCoverageRepairQuery(1_000, now));
    for (const [name, , expected] of cases) assert.equal(repair.some((row) => row.id === id(name)), expected, name);
    const healthy = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT cs.id FROM "CompanySource" cs WHERE cs.id LIKE ${`${prefix}%`} AND ${buildHealthySourceCoverageSql(now)}
    `);
    assert.deepEqual(healthy.map((row) => row.id).sort(), [id("fresh-source"), id("fresh-backoff-source"), id("alternative-source")].sort());

    // Exercise the real report, including multiple mappings on a single job.
    for (const name of ["gap-stale", "gap-never", "direct-secondary", "removed-direct", "duplicate-aggregator"]) {
      await company(name);
      await source(name, { lastSuccessfulPollAt: name === "gap-never" ? null : old });
      const jobCount = name === "duplicate-aggregator" ? 1 : 3;
      for (let n = 0; n < jobCount; n++) {
        const job = `${name}-${n}`;
        const fields = { title: "Software Engineer", company: id(name), location: "Toronto, ON", region: "CA" as const,
          workMode: "REMOTE" as const, employmentType: "FULL_TIME" as const, roleFamily: "Software Engineering",
          status: "LIVE" as const, applyUrl: `https://example.test/jobs/${id(job)}`, postedAt: now };
        await prisma.jobCanonical.create({ data: { id: id(job), companyKey: id(name), ...fields, description: "Fixture description", shortSummary: "Fixture" } });
        await prisma.jobFeedIndex.create({ data: { canonicalJobId: id(job), ...fields, searchText: "Fixture" } });
        const families = name === "duplicate-aggregator" ? ["Adzuna", "Jooble", "JSearch"] : name.includes("direct") ? ["Adzuna", "Greenhouse"] : ["Adzuna"];
        for (const [index, family] of families.entries()) {
          const rawId = id(`${job}-${index}`);
          await prisma.jobRaw.create({ data: { id: rawId, sourceId: rawId, sourceName: `${family}:${prefix}`, sourceTier: "TIER_2", rawPayload: {}, fetchedAt: now } });
          await prisma.jobSourceMapping.create({ data: { canonicalJobId: id(job), rawJobId: rawId, sourceName: `${family}:${prefix}`, isPrimary: index === 0, removedAt: name === "removed-direct" && index === 1 ? now : null } });
        }
      }
    }
    const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/report-coverage-gaps.ts", "--json", "--limit=1000"], { encoding: "utf8", timeout: 35_000 });
    const jsonStart = output.search(/^\{/m);
    assert.ok(jsonStart >= 0, "report emitted JSON");
    const report = JSON.parse(output.slice(jsonStart));
    assert.equal(report.countsAreNonPublic, true);
    assert.equal(report.healthySourceMaxAgeDays, 7);
    const keys = report.rows.map((row: { companyKey: string }) => row.companyKey);
    for (const name of ["gap-stale", "gap-never", "removed-direct"]) assert.ok(keys.includes(id(name)), name);
    for (const name of ["direct-secondary", "duplicate-aggregator"]) assert.ok(!keys.includes(id(name)), name);
    console.log("PASS: source health, stale/never-successful repair, cooldown/grace/disabled safeguards, and coverage report mapping semantics");
  } finally {
    await prisma.jobCanonical.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.jobRaw.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.sourceCandidate.deleteMany({ where: { normalizedUrlKey: { startsWith: prefix } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
