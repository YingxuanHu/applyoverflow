import { prisma } from "@/lib/db";
import { hasBadApplyLinkValidationStatus } from "@/lib/ingestion/apply-link-quality";
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
  const fastSql = process.argv.includes("--fast-sql");
  let cursor: string | undefined;
  const summary = {
    batchSize,
    maxBatches,
    dryRun,
    fastSql,
    scanned: 0,
    removed: 0,
    samples: [] as Array<{ id: string; title: string; company: string }>,
  };

  if (fastSql) {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await prisma.$queryRaw<Array<{ canonicalJobId: string }>>`
        WITH candidates AS (
          SELECT jfi."canonicalJobId"
          FROM "JobFeedIndex" jfi
          JOIN "JobCanonical" jc
            ON jc.id = jfi."canonicalJobId"
          WHERE jfi.status = 'LIVE'::"JobStatus"
            AND (
              jfi."sourceCount" <= 0
              OR jc.status != 'LIVE'::"JobStatus"
              OR jc."availabilityScore" < 60
              OR jc."deadSignalAt" IS NOT NULL
              OR jc.title ~* '^search jobs?$'
              OR jc.title ~* '^(careers?|jobs?)( at .+)?$'
              OR jc.title ~* '^(open positions?|current opportunities|benefits and perks|work (at|with|for) .+|join (us|our team|the team|.+)|come work with us|build your career|grow your career|help us)'
              OR jc."applyUrl" ~* '/(ai-guidelines|blog|guides?|docs?|events|support|resources?|case-studies|collections|datasets?|insights|media/videos?|models?|news(room)?|partners?|papers?|press(-release)?|protect-yourself|products?|posts|spaces|videos|faqs?|thank-you|download|webinars?|whitepapers?|lesson-center|people-ops)(/|$)'
              OR COALESCE(jc."applyUrlValidationStatus", 'ACTIVE') IN (
                'EXPIRED',
                'BROKEN_APPLY_LINK',
                'GENERIC_APPLY_PAGE',
                'SOURCE_STALE',
                'HIDDEN_LOW_QUALITY'
              )
              OR (jc.deadline IS NOT NULL AND jc.deadline < NOW())
              OR jc."applyUrl" !~* '^https?://'
            )
          ORDER BY jfi."canonicalJobId"
          LIMIT ${batchSize}
        )
        UPDATE "JobFeedIndex" jfi
        SET
          status = 'REMOVED'::"JobStatus",
          "indexedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidates
        WHERE jfi."canonicalJobId" = candidates."canonicalJobId"
        RETURNING jfi."canonicalJobId"
      `;

      summary.scanned += rows.length;
      summary.removed += rows.length;
      console.log(
        JSON.stringify(
          {
            batch: batch + 1,
            removed: rows.length,
            totalRemoved: summary.removed,
          },
          null,
          2
        )
      );
      if (rows.length === 0) break;
    }

    console.log(JSON.stringify(summary, null, 2));
    return;
  }

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
        sourceCount: true,
        canonicalJob: {
          select: {
            title: true,
            company: true,
            description: true,
            shortSummary: true,
            applyUrl: true,
            status: true,
            availabilityScore: true,
            deadline: true,
            deadSignalAt: true,
            applyUrlValidationStatus: true,
          },
        },
      },
    });

    if (rows.length === 0) break;

    const removeIds: string[] = [];
    for (const row of rows) {
      const job = row.canonicalJob;
      if (
        row.sourceCount <= 0 ||
        job.status !== "LIVE" ||
        job.availabilityScore < 60 ||
        job.deadSignalAt !== null ||
        (job.deadline !== null && job.deadline.getTime() < Date.now()) ||
        hasBadApplyLinkValidationStatus(job.applyUrlValidationStatus) ||
        !/^https?:\/\//i.test(job.applyUrl) ||
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
