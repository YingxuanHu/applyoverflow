import "dotenv/config";

import { prisma } from "@/lib/db";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type CliArgs = {
  apply: boolean;
  recentSuccessDays: number;
  noMappingDays: number;
  minPollSuccessCount: number;
  demotedCadenceMinutes: number;
  cooldownDays: number;
  connector: string | null;
  limit: number;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    apply: false,
    recentSuccessDays: 7,
    noMappingDays: 14,
    minPollSuccessCount: 2,
    demotedCadenceMinutes: 7 * 24 * 60,
    cooldownDays: 7,
    connector: null,
    limit: 500,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (!key || !value) continue;

    const numeric = Number.parseInt(value, 10);
    if (key === "recent-success-days" && Number.isFinite(numeric) && numeric > 0) {
      parsed.recentSuccessDays = numeric;
      continue;
    }

    if (key === "no-mapping-days" && Number.isFinite(numeric) && numeric > 0) {
      parsed.noMappingDays = numeric;
      continue;
    }

    if (key === "min-poll-success-count" && Number.isFinite(numeric) && numeric >= 0) {
      parsed.minPollSuccessCount = numeric;
      continue;
    }

    if (key === "demoted-cadence-minutes" && Number.isFinite(numeric) && numeric > 0) {
      parsed.demotedCadenceMinutes = numeric;
      continue;
    }

    if (key === "cooldown-days" && Number.isFinite(numeric) && numeric > 0) {
      parsed.cooldownDays = numeric;
      continue;
    }

    if (key === "limit" && Number.isFinite(numeric) && numeric > 0) {
      parsed.limit = numeric;
      continue;
    }

    if (key === "connector") {
      parsed.connector = value;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const recentSuccessCutoff = new Date(
    now.getTime() - args.recentSuccessDays * 24 * 60 * 60 * 1000
  );
  const mappingCutoff = new Date(now.getTime() - args.noMappingDays * 24 * 60 * 60 * 1000);
  const cooldownUntil = new Date(now.getTime() + args.cooldownDays * 24 * 60 * 60 * 1000);

  const sources = await prisma.companySource.findMany({
    where: {
      status: { not: "DISABLED" },
      pollState: { not: "DISABLED" },
      lastSuccessfulPollAt: { gte: recentSuccessCutoff },
      pollSuccessCount: { gte: args.minPollSuccessCount },
      ...(args.connector ? { connectorName: args.connector } : {}),
    },
    orderBy: [
      { priorityScore: "desc" },
      { lastSuccessfulPollAt: "desc" },
    ],
    take: args.limit,
    select: {
      id: true,
      sourceName: true,
      connectorName: true,
      status: true,
      pollState: true,
      validationState: true,
      pollingCadenceMinutes: true,
      priorityScore: true,
      yieldScore: true,
      retainedLiveJobCount: true,
      jobsAcceptedCount: true,
      jobsCreatedCount: true,
      jobsDedupedCount: true,
      lastJobsAcceptedCount: true,
      lastJobsCreatedCount: true,
      lastSuccessfulPollAt: true,
    },
  });

  const sourceNames = sources.map((source) => source.sourceName);
  const mappingCounts = sourceNames.length
    ? await prisma.jobSourceMapping.groupBy({
        by: ["sourceName"],
        where: {
          sourceName: { in: sourceNames },
          createdAt: { gte: mappingCutoff },
        },
        _count: {
          _all: true,
        },
      })
    : [];
  const mappingCountBySource = new Map(
    mappingCounts.map((row) => [row.sourceName, row._count._all])
  );

  const candidates = sources
    .map((source) => {
      const recentMappingCount = mappingCountBySource.get(source.sourceName) ?? 0;
      const noveltyRatio =
        source.jobsAcceptedCount > 0
          ? Math.round((source.jobsCreatedCount / source.jobsAcceptedCount) * 10000) / 10000
          : source.jobsCreatedCount > 0
            ? 1
            : 0;

      return {
        ...source,
        recentMappingCount,
        noveltyRatio,
      };
    })
    .filter((source) => source.recentMappingCount === 0)
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return (right.retainedLiveJobCount ?? 0) - (left.retainedLiveJobCount ?? 0);
    });

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          recentSuccessDays: args.recentSuccessDays,
          noMappingDays: args.noMappingDays,
          candidateCount: candidates.length,
          candidates,
        },
        null,
        2
      )
    );
    return;
  }

  const applied = [];
  for (const source of candidates) {
    await prisma.companySource.update({
      where: { id: source.id },
      data: {
        status: source.status === "ACTIVE" ? "DEGRADED" : source.status,
        pollState: "BACKOFF",
        cooldownUntil,
        pollingCadenceMinutes: Math.max(
          source.pollingCadenceMinutes ?? 0,
          args.demotedCadenceMinutes
        ),
        priorityScore: Math.min(source.priorityScore, 0.3),
        yieldScore: Math.min(source.yieldScore, 0.25),
        validationMessage:
          `[long-tail-demotion] No JobSourceMapping created in ${args.noMappingDays} days ` +
          `despite successful polls in the last ${args.recentSuccessDays} days.`,
      },
    });

    applied.push({
      sourceName: source.sourceName,
      connectorName: source.connectorName,
      recentMappingCount: source.recentMappingCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
      noveltyRatio: source.noveltyRatio,
      cooldownUntil: cooldownUntil.toISOString(),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        recentSuccessDays: args.recentSuccessDays,
        noMappingDays: args.noMappingDays,
        candidateCount: candidates.length,
        applied,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "[source:demote-stale] failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
