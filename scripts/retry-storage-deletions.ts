import { createBoundedMaintenanceClient, prisma } from "../src/lib/db";
import { deleteFile } from "../src/lib/storage";
import { retryStorageDeletions } from "./lib/storage-deletion-retry";

async function main() {
  const maintenance = createBoundedMaintenanceClient();
  try {
    const result = await retryStorageDeletions({ database: maintenance, deleteFile });
    console.log(JSON.stringify({ event: "storage-deletion-retry", ...result }));
    if (result.failed || result.deadlineReached) process.exitCode = 1;
  } finally {
    await maintenance.$disconnect();
  }
}

main().catch(() => { console.error("Storage deletion retry failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
