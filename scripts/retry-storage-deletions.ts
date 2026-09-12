import { prisma } from "../src/lib/db";
import { deleteFile } from "../src/lib/storage";

async function main() {
  const tasks = await prisma.storageDeletionTask.findMany({
    where: { nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: 50,
  });
  let completed = 0;
  for (const task of tasks) {
    try { await deleteFile(task.storageKey); completed += 1; }
    catch { /* Intent is retained by deleteFile for the next bounded retry. */ }
  }
  await prisma.resourceBudget.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 86_400_000) } } });
  await prisma.resourceLease.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.log(JSON.stringify({ attempted: tasks.length, completed, pending: await prisma.storageDeletionTask.count() }));
}

main().catch(() => { console.error("Storage deletion retry failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
