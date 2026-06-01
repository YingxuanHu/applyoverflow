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
  batchSize: number;
  scanAll: boolean;
  startAfter: string | null;
  ids: string[];
};

const DEFAULT_LIMIT = 10_000;
const RETIRE_BATCH_SIZE = 100;
const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  if (args.scanAll) {
    await runScanAll(args, now);
    return;
  }

  const candidates =
    args.ids.length > 0
      ? await prisma.jobCanonical.findMany({
          where: {
            id: { in: args.ids },
            status: { in: [...VISIBLE_STATUSES] },
          },
          select: {
            id: true,
            title: true,
            description: true,
            applyUrl: true,
          },
        })
      : await prisma.$queryRaw<CandidateRow[]>`
    select id, title, description, "applyUrl"
    from "JobCanonical"
    where status in ('LIVE', 'AGING', 'STALE')
      and (
        title ~* '^(remote|hybrid|onsite|on-site|canada|united states|usa|toronto|montreal|montréal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|waterloo|new york|san francisco|seattle|boston|chicago|austin|dallas|los angeles|washington)( office| area| region| centre| center| city)?$'
        or title ~* '^(careers?|jobs?)( at .+)?$'
        or title ~* '^search jobs?$'
        or title ~* '^(open positions?|current opportunities|benefits and perks|work (at|with|for) .+|join (us|our team|the team|the .+ team|.+ team)|come work with us|build your career|grow your career|help us)'
        or title ~* '(not an active opening|building (a )?talent pipeline|\\[(pipeline|talent pool)\\]|talent pool|talent community|general application|open application|expression of interest|submit your (resume|cv)|future opportunities|evergreen)'
        or description ~* '(not an active opening|building (a )?talent pipeline|\\[(pipeline|talent pool)\\]|talent pool|talent community|general application|open application|expression of interest|submit your (resume|cv)|future opportunities|evergreen (role|opportunity|opening)|explore open roles|widget title goes here|meta text goes here)'
        or "applyUrl" ~* '/(ai-guidelines|blog|guides?|docs?|events|support|resources?|case-studies|collections|datasets?|insights|media/videos?|models?|news(room)?|partners?|papers?|press(-release)?|protect-yourself|products?|posts|spaces|videos|faqs?|thank-you|download|webinars?|whitepapers?|lesson-center|people-ops)(/|$)'
        or lower(regexp_replace("applyUrl", '/+$', '')) ~ '/(careers?|jobs?|open-positions?|job-openings?)$'
        or "applyUrl" ~* 'https?://jobs\\.lever\\.co/[^/?]+/?(\\?|$)'
        or "applyUrl" ~* 'https?://jobs\\.ashbyhq\\.com/[^/?]+/?(\\?|$)'
        or "applyUrl" ~* 'https?://apply\\.workable\\.com/[^/?]+/?(\\?|$)'
        or "applyUrl" ~* 'https?://(boards|job-boards)\\.greenhouse\\.io/[^/?]+/?(\\?|$)'
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

  for (const batch of chunks(rejected, RETIRE_BATCH_SIZE)) {
    await retireIds(batch.map((candidate) => candidate.id), now);
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

async function runScanAll(args: CliArgs, now: Date) {
  let cursor: string | undefined = args.startAfter ?? undefined;
  let scanned = 0;
  let retired = 0;
  const countsByReason: Record<string, number> = {};
  const samples: Array<{ id: string; title: string; applyUrl: string; reason: string | null }> = [];

  while (scanned < args.limit) {
    const take = Math.min(args.batchSize, args.limit - scanned);
    if (take <= 0) break;

    const rows = await prisma.jobCanonical.findMany({
      where: {
        status: { in: [...VISIBLE_STATUSES] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        title: true,
        description: true,
        applyUrl: true,
      },
    });

    if (rows.length === 0) break;

    const rejected = rows
      .map((candidate) => ({
        ...candidate,
        classification: classifyNonJobPosting({
          title: candidate.title,
          description: candidate.description,
          applyUrl: candidate.applyUrl,
        }),
      }))
      .filter((candidate) => candidate.classification.detected);

    for (const candidate of rejected) {
      const reason = candidate.classification.reason ?? "unknown";
      countsByReason[reason] = (countsByReason[reason] ?? 0) + 1;
      if (samples.length < 25) {
        samples.push({
          id: candidate.id,
          title: candidate.title,
          applyUrl: candidate.applyUrl,
          reason: candidate.classification.reason,
        });
      }
    }

    if (args.apply) {
      for (const batch of chunks(rejected, RETIRE_BATCH_SIZE)) {
        await retireIds(batch.map((candidate) => candidate.id), now);
      }
    }

    scanned += rows.length;
    retired += rejected.length;
    cursor = rows.at(-1)?.id;
    console.log(
      JSON.stringify({
        batchScanned: rows.length,
        scanned,
        retired,
        lastId: cursor,
      })
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "scan-all-apply" : "scan-all-dry-run",
        scanned,
        retired,
        countsByReason,
        samples,
      },
      null,
      2
    )
  );
}

async function retireIds(ids: string[], now: Date) {
  if (ids.length === 0) return;
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
    { maxWait: 30_000, timeout: 120_000 }
  );
}

function parseArgs(argv: string[]): CliArgs {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const batchSizeIndex = argv.findIndex((arg) => arg === "--batch-size");
  const startAfterIndex = argv.findIndex((arg) => arg === "--start-after");
  const parsedLimit =
    limitIndex >= 0 && argv[limitIndex + 1]
      ? Number.parseInt(argv[limitIndex + 1] ?? "", 10)
      : DEFAULT_LIMIT;
  const parsedBatchSize =
    batchSizeIndex >= 0 && argv[batchSizeIndex + 1]
      ? Number.parseInt(argv[batchSizeIndex + 1] ?? "", 10)
      : 2_000;

  return {
    apply: argv.includes("--apply"),
    scanAll: argv.includes("--scan-all"),
    ids: readStringListArg(argv, "--ids"),
    startAfter:
      startAfterIndex >= 0 && argv[startAfterIndex + 1] ? argv[startAfterIndex + 1] ?? null : null,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT,
    batchSize:
      Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : 2_000,
  };
}

function readStringListArg(argv: string[], key: string) {
  const prefix = `${key}=`;
  const indexed = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const keyIndex = argv.findIndex((arg) => arg === key);
  const raw = indexed ?? (keyIndex >= 0 ? argv[keyIndex + 1] : undefined);
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
