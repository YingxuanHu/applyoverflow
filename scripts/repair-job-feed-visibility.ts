import { prisma } from "@/lib/db";
import { isClearlyNonJobPosting } from "@/lib/job-integrity";

function readIntArg(name: string, fallback: number) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!exact) return fallback;
  const parsed = Number.parseInt(exact.slice(name.length + 1), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const batchSize = readIntArg("--batch-size", 2000);
  const maxBatches = readIntArg("--max-batches", Number.MAX_SAFE_INTEGER);
  const dryRun = process.argv.includes("--dry-run");
  let cursor: string | undefined;
  const summary = {
    batchSize,
    maxBatches,
    dryRun,
    scanned: 0,
    removed: 0,
    samples: [] as Array<{ id: string; title: string; company: string }>,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await prisma.jobFeedIndex.findMany({
      where: {
        status: "LIVE",
        ...(cursor ? { canonicalJobId: { gt: cursor } } : {}),
      },
      orderBy: { canonicalJobId: "asc" },
      take: batchSize,
      select: {
        canonicalJobId: true,
        canonicalJob: {
          select: {
            title: true,
            company: true,
            description: true,
            shortSummary: true,
            applyUrl: true,
          },
        },
      },
    });

    if (rows.length === 0) break;

    const removeIds: string[] = [];
    for (const row of rows) {
      const job = row.canonicalJob;
      if (
        isClearlyNonJobPosting({
          title: job.title,
          description: job.description || job.shortSummary,
          applyUrl: job.applyUrl,
        })
      ) {
        removeIds.push(row.canonicalJobId);
        if (summary.samples.length < 20) {
          summary.samples.push({
            id: row.canonicalJobId,
            title: job.title,
            company: job.company,
          });
        }
      }
    }

    if (removeIds.length > 0 && !dryRun) {
      await prisma.jobFeedIndex.updateMany({
        where: { canonicalJobId: { in: removeIds } },
        data: {
          status: "REMOVED",
          indexedAt: new Date(),
        },
      });
    }

    summary.scanned += rows.length;
    summary.removed += removeIds.length;
    cursor = rows.at(-1)?.canonicalJobId;

    console.log(
      JSON.stringify(
        {
          batch: batch + 1,
          scanned: summary.scanned,
          removed: summary.removed,
          lastId: cursor,
        },
        null,
        2
      )
    );
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
