/**
 * Enqueue CONNECTOR_POLL tasks for all ACTIVE Workday sources
 * that don't already have a PENDING or RUNNING task.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { enqueueUniqueSourceTask } from "../src/lib/ingestion/task-queue";

async function main() {
  const sources = await prisma.companySource.findMany({
    where: {
      connectorName: "workday",
      status: "ACTIVE",
      validationState: "VALIDATED",
    },
    select: { id: true, companyId: true, sourceName: true, token: true },
  });

  console.log(`[enqueue-workday-polls] Found ${sources.length} active validated Workday sources`);

  let enqueued = 0;
  let skipped = 0;

  for (const source of sources) {
    try {
      const existing = await prisma.sourceTask.findFirst({
        where: {
          companySourceId: source.id,
          kind: "CONNECTOR_POLL",
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true, status: true },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await enqueueUniqueSourceTask({
        kind: "CONNECTOR_POLL",
        companyId: source.companyId,
        companySourceId: source.id,
        priorityScore: 90,
        notBeforeAt: new Date(),
      });
      enqueued++;
      console.log(`  + ${source.sourceName}`);
    } catch (err) {
      console.error(`  ERROR for ${source.id}:`, err);
    }
  }

  console.log(`\n[enqueue-workday-polls] Done: enqueued=${enqueued} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error("[enqueue-workday-polls] Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
