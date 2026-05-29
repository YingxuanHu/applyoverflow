import "dotenv/config";

import { prisma } from "../src/lib/db";
import { classifyNonJobPosting } from "../src/lib/job-integrity";

type CandidateRow = {
  id: string;
  title: string;
  description: string;
  applyUrl: string;
};

type CliArgs = {
  apply: boolean;
  limit: number;
};

const DEFAULT_LIMIT = 10_000;
const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    select id, title, description, "applyUrl"
    from "JobCanonical"
    where status in ('LIVE', 'AGING', 'STALE')
      and (
        title ~* '^(remote|hybrid|onsite|on-site|canada|united states|usa|toronto|montreal|montréal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|waterloo|new york|san francisco|seattle|boston|chicago|austin|dallas|los angeles|washington)( office| area| region| centre| center| city)?$'
        or title ~* '^(careers?|jobs?)( at .+)?$'
        or title ~* '^(open positions?|current opportunities|benefits and perks|work (at|with|for) .+|join (us|our team|the team|.+)|come work with us|build your career|grow your career|help us)'
        or title ~* '(not an active opening|building (a )?talent pipeline|\\[(pipeline|talent pool)\\]|talent pool|talent community|general application|open application|expression of interest|submit your (resume|cv)|future opportunities|evergreen)'
        or description ~* '(not an active opening|building (a )?talent pipeline|\\[(pipeline|talent pool)\\]|talent pool|talent community|general application|open application|expression of interest|submit your (resume|cv)|future opportunities|evergreen (role|opportunity|opening))'
        or "applyUrl" ~* '/(blog|guide|guides|docs|support|resources|resource|case-studies|insights|news|videos|faq|faqs|thank-you|download|webinar|lesson-center|people-ops)/'
        or lower(regexp_replace("applyUrl", '/+$', '')) ~ '/(careers?|jobs?|open-positions?|job-openings?)$'
      )
    order by "lastSeenAt" desc
    limit ${args.limit}
  `;

  const rejected = candidates
    .map((candidate) => ({
      ...candidate,
      classification: classifyNonJobPosting({
        title: candidate.title,
        description: candidate.description,
        applyUrl: candidate.applyUrl,
      }),
    }))
    .filter((candidate) => candidate.classification.detected);

  const countsByReason = rejected.reduce<Record<string, number>>((acc, candidate) => {
    const reason = candidate.classification.reason ?? "unknown";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          scanned: candidates.length,
          retireCount: rejected.length,
          countsByReason,
          samples: rejected.slice(0, 20).map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            applyUrl: candidate.applyUrl,
            reason: candidate.classification.reason,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  for (const batch of chunks(rejected, 500)) {
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
            deadSignalReason: "Rejected by job integrity cleanup.",
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
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        scanned: candidates.length,
        retired: rejected.length,
        countsByReason,
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

  return {
    apply: argv.includes("--apply"),
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT,
  };
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
    console.error("Failed to retire non-job canonical rows:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
