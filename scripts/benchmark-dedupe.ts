import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { findCrossSourceCanonicalMatch } from "@/lib/ingestion/dedupe";
import { parseSourceConnectorJobFromRawPayload } from "@/lib/ingestion/normalized-records";
import { deriveSourceIdentitySnapshot } from "@/lib/ingestion/source-quality";
import type { NormalizedJobInput } from "@/lib/ingestion/types";
import { Prisma } from "@/generated/prisma/client";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type CliArgs = {
  days: number;
  sampleSize: number;
  family: string | null;
  explainLimit: number;
  out: string;
};

type BenchmarkSample = {
  id: string;
  sourceName: string;
  sourceId: string;
  rawPayload: Prisma.JsonValue;
  title: string;
  company: string;
  companyKey: string;
  titleKey: string;
  titleCoreKey: string;
  descriptionFingerprint: string;
  location: string;
  locationKey: string;
  region: NormalizedJobInput["region"];
  workMode: NormalizedJobInput["workMode"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  employmentType: NormalizedJobInput["employmentType"];
  experienceLevel: NormalizedJobInput["experienceLevel"] | null;
  description: string;
  shortSummary: string;
  industry: NormalizedJobInput["industry"];
  roleFamily: string;
  applyUrl: string;
  applyUrlKey: string | null;
  postedAt: Date;
  deadline: Date | null;
  duplicateClusterId: string;
};

type ExplainPlanResult = {
  label: string;
  queryPlan: Prisma.JsonValue | null;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    days: 14,
    sampleSize: 100,
    family: null,
    explainLimit: 3,
    out: "data/ops/dedupe-benchmark.json",
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (!key || !value) continue;

    if (key === "days") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric > 0) parsed.days = numeric;
      continue;
    }

    if (key === "sample-size") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric > 0) parsed.sampleSize = numeric;
      continue;
    }

    if (key === "family") {
      parsed.family = value;
      continue;
    }

    if (key === "explain-limit") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric >= 0) parsed.explainLimit = numeric;
      continue;
    }

    if (key === "out") {
      parsed.out = value;
    }
  }

  return parsed;
}

function percentile(sortedValues: number[], percentileRank: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index] ?? 0;
}

function buildNormalizedJob(sample: BenchmarkSample): NormalizedJobInput {
  return {
    title: sample.title,
    company: sample.company,
    companyKey: sample.companyKey,
    titleKey: sample.titleKey,
    titleCoreKey: sample.titleCoreKey,
    descriptionFingerprint: sample.descriptionFingerprint,
    location: sample.location,
    locationKey: sample.locationKey,
    region: sample.region,
    workMode: sample.workMode,
    salaryMin: sample.salaryMin,
    salaryMax: sample.salaryMax,
    salaryCurrency: sample.salaryCurrency,
    employmentType: sample.employmentType,
    experienceLevel: sample.experienceLevel ?? "UNKNOWN",
    description: sample.description,
    shortSummary: sample.shortSummary,
    industry: sample.industry,
    roleFamily: sample.roleFamily,
    applyUrl: sample.applyUrl,
    applyUrlKey: sample.applyUrlKey,
    postedAt: sample.postedAt,
    deadline: sample.deadline,
    duplicateClusterId: sample.duplicateClusterId,
  };
}

async function explainQueryPlan(query: Prisma.Sql): Promise<Prisma.JsonValue | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, Prisma.JsonValue>>>(
    Prisma.sql`EXPLAIN (FORMAT JSON) ${query}`
  );
  return rows[0]?.["QUERY PLAN"] ?? null;
}

async function collectExplainPlans(sample: BenchmarkSample) {
  const sourceJob = parseSourceConnectorJobFromRawPayload({
    sourceName: sample.sourceName,
    sourceId: sample.sourceId,
    rawPayload: sample.rawPayload,
  });
  const identity = deriveSourceIdentitySnapshot({
    sourceName: sample.sourceName,
    sourceId: sample.sourceId,
    sourceUrl: sourceJob.sourceUrl,
    applyUrl: sourceJob.applyUrl,
    metadata: sourceJob.metadata,
  });
  const normalizedJob = buildNormalizedJob(sample);
  const plans: ExplainPlanResult[] = [];

  if (identity.applyUrlKey) {
    plans.push({
      label: "mapping-applyUrlKey",
      queryPlan: await explainQueryPlan(Prisma.sql`
        SELECT "canonicalJobId"
        FROM "JobSourceMapping"
        WHERE "applyUrlKey" = ${identity.applyUrlKey}
        ORDER BY "removedAt" ASC, "isPrimary" DESC, "sourceQualityRank" DESC, "lastSeenAt" DESC
        LIMIT 1
      `),
    });
    plans.push({
      label: "canonical-applyUrlKey",
      queryPlan: await explainQueryPlan(Prisma.sql`
        SELECT id
        FROM "JobCanonical"
        WHERE "applyUrlKey" = ${identity.applyUrlKey}
        LIMIT 1
      `),
    });
  }

  if (identity.sourceUrlKey) {
    plans.push({
      label: "mapping-sourceUrlKey",
      queryPlan: await explainQueryPlan(Prisma.sql`
        SELECT "canonicalJobId"
        FROM "JobSourceMapping"
        WHERE "sourceUrlKey" = ${identity.sourceUrlKey}
        ORDER BY "removedAt" ASC, "isPrimary" DESC, "sourceQualityRank" DESC, "lastSeenAt" DESC
        LIMIT 1
      `),
    });
  }

  if (identity.postingIdKey) {
    plans.push({
      label: "mapping-postingIdKey",
      queryPlan: await explainQueryPlan(Prisma.sql`
        SELECT "canonicalJobId"
        FROM "JobSourceMapping"
        WHERE "postingIdKey" = ${identity.postingIdKey}
        ORDER BY "removedAt" ASC, "isPrimary" DESC, "sourceQualityRank" DESC, "lastSeenAt" DESC
        LIMIT 1
      `),
    });
  }

  plans.push({
    label: "canonical-duplicateClusterId",
    queryPlan: await explainQueryPlan(Prisma.sql`
      SELECT id
      FROM "JobCanonical"
      WHERE "duplicateClusterId" = ${normalizedJob.duplicateClusterId}
      LIMIT 1
    `),
  });

  const descriptionClause = normalizedJob.descriptionFingerprint
    ? Prisma.sql`OR "descriptionFingerprint" = ${normalizedJob.descriptionFingerprint}`
    : Prisma.empty;
  const locationClause = normalizedJob.locationKey
    ? Prisma.sql`OR "locationKey" = ${normalizedJob.locationKey}`
    : Prisma.empty;
  const regionClause = normalizedJob.region
    ? Prisma.sql`AND ("region" = ${normalizedJob.region} OR "region" IS NULL)`
    : Prisma.empty;

  plans.push({
    label: "canonical-similarity-candidates",
    queryPlan: await explainQueryPlan(Prisma.sql`
      SELECT id
      FROM "JobCanonical"
      WHERE "companyKey" = ${normalizedJob.companyKey}
        AND (
          "titleCoreKey" = ${normalizedJob.titleCoreKey}
          ${descriptionClause}
          ${locationClause}
        )
        ${regionClause}
      LIMIT 50
    `),
  });

  return {
    sourceName: sample.sourceName,
    title: sample.title,
    company: sample.company,
    applyUrl: sample.applyUrl,
    plans,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const samples = await prisma.normalizedJobRecord.findMany({
    where: {
      status: "VALIDATED",
      rawJob: {
        fetchedAt: { gte: cutoff },
        ...(args.family
          ? {
              sourceName: {
                startsWith: `${args.family}:`,
                mode: "insensitive",
              },
            }
          : {}),
      },
    },
    orderBy: {
      rawJob: {
        fetchedAt: "desc",
      },
    },
    take: args.sampleSize,
    select: {
      id: true,
      title: true,
      company: true,
      companyKey: true,
      titleKey: true,
      titleCoreKey: true,
      descriptionFingerprint: true,
      location: true,
      locationKey: true,
      region: true,
      workMode: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      employmentType: true,
      experienceLevel: true,
      description: true,
      shortSummary: true,
      industry: true,
      roleFamily: true,
      applyUrl: true,
      applyUrlKey: true,
      postedAt: true,
      deadline: true,
      duplicateClusterId: true,
      rawJob: {
        select: {
          sourceName: true,
          sourceId: true,
          rawPayload: true,
        },
      },
    },
  });

  const benchmarkRows: Array<{
    id: string;
    sourceName: string;
    matchedBy: string | null;
    durationMs: number;
  }> = [];

  for (const sample of samples) {
    const sourceJob = parseSourceConnectorJobFromRawPayload({
      sourceName: sample.rawJob.sourceName,
      sourceId: sample.rawJob.sourceId,
      rawPayload: sample.rawJob.rawPayload,
    });
    const sourceIdentity = deriveSourceIdentitySnapshot({
      sourceName: sample.rawJob.sourceName,
      sourceId: sample.rawJob.sourceId,
      sourceUrl: sourceJob.sourceUrl,
      applyUrl: sourceJob.applyUrl,
      metadata: sourceJob.metadata,
    });
    const normalizedJob = buildNormalizedJob({
      ...sample,
      sourceName: sample.rawJob.sourceName,
      sourceId: sample.rawJob.sourceId,
      rawPayload: sample.rawJob.rawPayload,
    });
    const startedAt = process.hrtime.bigint();
    const match = await findCrossSourceCanonicalMatch(normalizedJob, sourceIdentity);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    benchmarkRows.push({
      id: sample.id,
      sourceName: sample.rawJob.sourceName,
      matchedBy: match?.matchedBy ?? null,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  }

  const sortedDurations = benchmarkRows
    .map((row) => row.durationMs)
    .sort((left, right) => left - right);
  const explainSamples = [...benchmarkRows]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, args.explainLimit)
    .map((row) => row.id);
  const explainTargets = samples.filter((sample) => explainSamples.includes(sample.id));
  const explainPlans = [];
  for (const sample of explainTargets) {
    explainPlans.push(
      await collectExplainPlans({
        ...sample,
        sourceName: sample.rawJob.sourceName,
        sourceId: sample.rawJob.sourceId,
        rawPayload: sample.rawJob.rawPayload,
      })
    );
  }

  const [canonicalCount, sourceMappingCount, visibleCount] = await Promise.all([
    prisma.jobCanonical.count(),
    prisma.jobSourceMapping.count(),
    prisma.jobCanonical.count({
      where: { status: { in: ["LIVE", "AGING", "STALE"] } },
    }),
  ]);

  const output = {
    generatedAt: new Date().toISOString(),
    windowDays: args.days,
    sampleSize: benchmarkRows.length,
    family: args.family,
    tableSizes: {
      canonicalCount,
      sourceMappingCount,
      visibleCount,
    },
    latencyMs: {
      p50: percentile(sortedDurations, 50),
      p95: percentile(sortedDurations, 95),
      p99: percentile(sortedDurations, 99),
      max: sortedDurations[sortedDurations.length - 1] ?? 0,
      average:
        benchmarkRows.length > 0
          ? Math.round(
              (benchmarkRows.reduce((sum, row) => sum + row.durationMs, 0) /
                benchmarkRows.length) *
                1000
            ) / 1000
          : 0,
    },
    matchStrategyCounts: benchmarkRows.reduce<Record<string, number>>((counts, row) => {
      const key = row.matchedBy ?? "no_match";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    slowestSamples: [...benchmarkRows]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 10),
    explainPlans,
  };

  const outputPath = path.resolve(args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "[dedupe:benchmark] failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
