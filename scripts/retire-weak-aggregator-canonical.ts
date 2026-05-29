import "dotenv/config";

import { prisma } from "../src/lib/db";

type CandidateRow = {
  id: string;
  title: string;
  company: string;
  applyUrl: string;
  primarySourceName: string | null;
  activeSourceCount: bigint | number;
  weakSourceCount: bigint | number;
  lastSourceSeenAt: Date | null;
};

type CliArgs = {
  apply: boolean;
  limit: number;
  families: string[];
};

const DEFAULT_LIMIT = 50_000;
const DEFAULT_FAMILIES = ["jooble"];
const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    with active_mapping_summary as (
      select
        m."canonicalJobId",
        count(*) as "activeSourceCount",
        count(*) filter (
          where lower(split_part(m."sourceName", ':', 1)) = any(${args.families})
        ) as "weakSourceCount",
        max(m."lastSeenAt") as "lastSourceSeenAt",
        (array_agg(m."sourceName" order by m."isPrimary" desc, m."sourceQualityRank" desc, m."lastSeenAt" desc))[1] as "primarySourceName"
      from "JobSourceMapping" m
      where m."removedAt" is null
      group by m."canonicalJobId"
    )
    select
      j.id,
      j.title,
      j.company,
      j."applyUrl",
      s."primarySourceName",
      s."activeSourceCount",
      s."weakSourceCount",
      s."lastSourceSeenAt"
    from "JobCanonical" j
    join active_mapping_summary s on s."canonicalJobId" = j.id
    where j.status in ('LIVE', 'AGING', 'STALE')
      and s."activeSourceCount" = s."weakSourceCount"
      and s."weakSourceCount" > 0
      and lower(split_part(s."primarySourceName", ':', 1)) = any(${args.families})
    order by s."lastSourceSeenAt" asc nulls first, j."lastSeenAt" asc
    limit ${args.limit}
  `;

  const countsByPrimarySource = candidates.reduce<Record<string, number>>((acc, candidate) => {
    const key = candidate.primarySourceName ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          families: args.families,
          scanned: candidates.length,
          retireCount: candidates.length,
          countsByPrimarySource,
          samples: candidates.slice(0, 20).map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            company: candidate.company,
            applyUrl: candidate.applyUrl,
            primarySourceName: candidate.primarySourceName,
            activeSourceCount: Number(candidate.activeSourceCount),
            lastSourceSeenAt: candidate.lastSourceSeenAt,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  let retired = 0;
  for (const batch of chunks(candidates, 500)) {
    const ids = batch.map((candidate) => candidate.id);
    await prisma.$transaction(
      async (tx) => {
        await tx.jobCanonical.updateMany({
          where: {
            id: { in: ids },
            status: { in: [...VISIBLE_STATUSES] },
          },
          data: {
            status: "REMOVED",
            availabilityScore: 0,
            deadSignalAt: now,
            deadSignalReason: `Removed from board: weak aggregator-only source (${args.families.join(", ")}).`,
            removedAt: now,
            staleAt: null,
            expiredAt: null,
          },
        });
        await tx.jobSourceMapping.updateMany({
          where: {
            canonicalJobId: { in: ids },
            removedAt: null,
          },
          data: {
            removedAt: now,
            isPrimary: false,
          },
        });
        await tx.jobFeedIndex.updateMany({
          where: {
            canonicalJobId: { in: ids },
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
      { maxWait: 30_000, timeout: 60_000 }
    );
    retired += ids.length;
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        families: args.families,
        scanned: candidates.length,
        retired,
        countsByPrimarySource,
      },
      null,
      2
    )
  );
}

function parseArgs(argv: string[]): CliArgs {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const parsedLimit =
    limitIndex >= 0 && argv[limitIndex + 1]
      ? Number.parseInt(argv[limitIndex + 1] ?? "", 10)
      : DEFAULT_LIMIT;

  const familyIndex = argv.findIndex((arg) => arg === "--families");
  const families =
    familyIndex >= 0 && argv[familyIndex + 1]
      ? parseFamilies(argv[familyIndex + 1] ?? "")
      : DEFAULT_FAMILIES;

  return {
    apply: argv.includes("--apply"),
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT,
    families,
  };
}

function parseFamilies(input: string) {
  const families = input
    .split(",")
    .map((family) => family.trim().toLowerCase())
    .filter(Boolean);
  return families.length > 0 ? families : DEFAULT_FAMILIES;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

main()
  .catch((error) => {
    console.error("Failed to retire weak aggregator canonical rows:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
