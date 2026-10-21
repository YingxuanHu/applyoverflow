import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "@/lib/db";
import { shouldExcludeFromFeedIndex } from "@/lib/ingestion/search-index";
import { buildFeedVisibilityRepair } from "@/lib/ingestion/feed-visibility-repair";

function integerArg(name: string, fallback: number, maximum: number) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

async function main() {
  if (process.argv.includes("--fast-sql")) throw new Error("--fast-sql is retired; repair must use the shared publication policy.");
  if (process.argv.includes("--apply") && process.argv.includes("--dry-run")) throw new Error("Choose either --apply or --dry-run.");
  const dryRun = !process.argv.includes("--apply");
  const batchSize = integerArg("--batch-size", 500, 2000);
  const maxBatches = integerArg("--max-batches", 10_000, 100_000);
  let cursor = process.argv.find((arg) => arg.startsWith("--after="))?.slice(8);
  const summary = { dryRun, scanned: 0, excluded: 0, hidden: 0, concurrentChangesSkipped: 0, complete: false, lastId: cursor, samples: [] as Array<{ id: string; title: string; company: string }> };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await prisma.jobFeedIndex.findMany({
      where: { status: "LIVE", ...(cursor ? { canonicalJobId: { gt: cursor } } : {}) },
      orderBy: { canonicalJobId: "asc" }, take: batchSize,
      select: {
        canonicalJobId: true, sourceCount: true, updatedAt: true,
        canonicalJob: { select: {
          title: true, company: true, description: true, descriptionStatus: true,
          shortSummary: true, location: true, region: true, workMode: true,
          applyUrl: true, status: true, availabilityScore: true,
          titleConfidence: true, titleStatus: true, deadline: true, deadSignalAt: true,
          applyUrlValidationStatus: true, lastSourceSeenAt: true,
          lastConfirmedAliveAt: true, updatedAt: true,
        } },
      },
    });
    if (!rows.length) { summary.complete = true; break; }
    const now = new Date();
    const excluded = rows.filter((row) => shouldExcludeFromFeedIndex({ ...row.canonicalJob, sourceCount: row.sourceCount, now }));
    if (excluded.length && !dryRun) {
      const hidden = await prisma.$executeRaw(buildFeedVisibilityRepair(excluded.map((row) => ({
        id: row.canonicalJobId, canonicalUpdatedAt: row.canonicalJob.updatedAt, indexUpdatedAt: row.updatedAt,
      }))));
      summary.hidden += hidden;
      summary.concurrentChangesSkipped += excluded.length - hidden;
    }
    for (const row of excluded.slice(0, Math.max(0, 20 - summary.samples.length))) summary.samples.push({ id: row.canonicalJobId, title: row.canonicalJob.title, company: row.canonicalJob.company });
    summary.scanned += rows.length;
    summary.excluded += excluded.length;
    cursor = rows.at(-1)!.canonicalJobId;
    summary.lastId = cursor;
    console.log(JSON.stringify({ ...summary, samples: undefined, batch: batch + 1 }));
    await delay(50);
  }
  console.log(JSON.stringify(summary));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
