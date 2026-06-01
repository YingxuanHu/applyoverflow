import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

import { prisma } from "@/lib/db";
import {
  assessJobDataQuality,
  type JobDataQualityIssue,
} from "@/lib/ingestion/job-data-quality";

type CliArgs = {
  apply: boolean;
  batchSize: number;
  limit: number;
  retireIssues: Set<JobDataQualityIssue>;
  sampleLimit: number;
};

type Sample = {
  id: string;
  title: string;
  company: string;
  source: string;
  applyUrl: string;
  issues: JobDataQualityIssue[];
  detail: string | null;
};

const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  let cursor: string | undefined;
  let scanned = 0;
  let rejectCount = 0;
  let reviewCount = 0;
  let retiredCount = 0;
  const byIssue: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const samples: Sample[] = [];
  let pendingRetireIds: string[] = [];

  while (scanned < args.limit) {
    const rows = await prisma.jobCanonical.findMany({
      where: {
        status: { in: [...VISIBLE_STATUSES] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: Math.min(args.batchSize, args.limit - scanned),
      select: {
        id: true,
        title: true,
        company: true,
        description: true,
        shortSummary: true,
        applyUrl: true,
        sourceMappings: {
          where: { removedAt: null },
          orderBy: [{ sourceQualityRank: "desc" }, { lastSeenAt: "desc" }],
          take: 1,
          select: { sourceName: true },
        },
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      cursor = row.id;
      const source = row.sourceMappings[0]?.sourceName ?? "NO_SOURCE";
      const assessment = assessJobDataQuality({
        title: row.title,
        company: row.company,
        description: row.description || row.shortSummary,
        applyUrl: row.applyUrl,
      });

      if (assessment.severity === "accept") continue;

      if (assessment.severity === "review") {
        reviewCount += 1;
      } else {
        rejectCount += 1;
        if (shouldRetire(assessment.issues, args.retireIssues)) {
          pendingRetireIds.push(row.id);
        }
      }

      for (const issue of assessment.issues) {
        byIssue[issue] = (byIssue[issue] ?? 0) + 1;
      }
      bySource[source] = (bySource[source] ?? 0) + 1;
      if (samples.length < args.sampleLimit) {
        samples.push({
          id: row.id,
          title: row.title,
          company: row.company,
          source,
          applyUrl: row.applyUrl,
          issues: assessment.issues,
          detail: assessment.detail,
        });
      }

      if (args.apply && pendingRetireIds.length >= 200) {
        retiredCount += await retireIds(pendingRetireIds, now);
        pendingRetireIds = [];
      }
    }
  }

  if (args.apply && pendingRetireIds.length > 0) {
    retiredCount += await retireIds(pendingRetireIds, now);
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        scanned,
        rejectCount,
        reviewCount,
        retiredCount,
        retireIssues:
          args.retireIssues.size > 0 ? [...args.retireIssues].sort() : "all reject issues",
        byIssue: sortRecord(byIssue),
        bySource: sortRecord(bySource).slice(0, 30),
        samples,
      },
      null,
      2
    )
  );
}

async function retireIds(ids: string[], now: Date) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return 0;

  await prisma.$transaction(
    async (tx) => {
      await tx.jobCanonical.updateMany({
        where: {
          id: { in: uniqueIds },
          status: { in: [...VISIBLE_STATUSES] },
        },
        data: {
          status: "REMOVED",
          availabilityScore: 0,
          qualityScore: 0,
          deadSignalAt: now,
          deadSignalReason: "Rejected by job data quality audit.",
          removedAt: now,
          staleAt: null,
          expiredAt: null,
        },
      });
      await tx.jobSourceMapping.updateMany({
        where: {
          canonicalJobId: { in: uniqueIds },
          removedAt: null,
        },
        data: {
          removedAt: now,
          isPrimary: false,
        },
      });
      await tx.jobFeedIndex.updateMany({
        where: {
          canonicalJobId: { in: uniqueIds },
        },
        data: {
          status: "REMOVED",
          qualityScore: 0,
          trustScore: 0,
          freshnessScore: 0,
          rankingScore: 0,
        },
      });
    },
    { maxWait: 30_000, timeout: 120_000 }
  );

  return uniqueIds.length;
}

function sortRecord(record: Record<string, number>) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function parseArgs(argv: string[]): CliArgs {
  const retireIssuesArg = readStringArg(argv, "--retire-issues", "");
  return {
    apply: argv.includes("--apply"),
    batchSize: readNumberArg(argv, "--batch-size", 1000),
    limit: readNumberArg(argv, "--limit", 25_000),
    retireIssues: new Set(
      retireIssuesArg
        .split(",")
        .map((issue) => issue.trim())
        .filter(Boolean) as JobDataQualityIssue[]
    ),
    sampleLimit: readNumberArg(argv, "--sample-limit", 25),
  };
}

function shouldRetire(
  issues: JobDataQualityIssue[],
  retireIssues: Set<JobDataQualityIssue>
) {
  if (retireIssues.size === 0) return true;
  return issues.some((issue) => retireIssues.has(issue));
}

function readNumberArg(argv: string[], key: string, fallback: number) {
  const raw = readStringArg(argv, key, "");
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStringArg(argv: string[], key: string, fallback: string) {
  const prefix = `${key}=`;
  const indexed = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const keyIndex = argv.findIndex((arg) => arg === key);
  return indexed ?? (keyIndex >= 0 ? argv[keyIndex + 1] : undefined) ?? fallback;
}

main()
  .catch((error) => {
    console.error("Failed to audit job data quality:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
