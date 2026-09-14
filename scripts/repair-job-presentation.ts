import "dotenv/config";
import { prisma } from "@/lib/db";
import { normalizeLocationKey } from "@/lib/ingestion/dedupe";
import { parseSourceConnectorJobFromRawPayload } from "@/lib/ingestion/normalized-records";
import { planJobPresentationRepair } from "@/lib/ingestion/presentation-repair";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

// An explicit, reviewed batch is required. This script is not a database sweep.
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--ids="))) throw new Error("Unknown argument");
  const ids = [...new Set((args.find((arg) => arg.startsWith("--ids="))?.slice(6) ?? "").split(",").filter(Boolean))];
  if (!ids.length || ids.length > 100) throw new Error("Use --ids=id1,id2 (1-100 reviewed IDs). Default is dry-run; --apply writes changes.");
  const apply = args.includes("--apply");
  let changed = 0;
  let conflicts = 0;
  for (const id of ids) {
    const job = await prisma.jobCanonical.findUnique({ where: { id }, include: {
      sourceMappings: { where: { removedAt: null }, orderBy: [{ isPrimary: "desc" }, { sourceQualityRank: "desc" }, { lastSeenAt: "desc" }], take: 1, include: { rawJob: true } },
    } });
    if (!job) { console.log(JSON.stringify({ id, skipped: "not_found" })); continue; }
    const raw = job.sourceMappings[0]?.rawJob;
    const source = raw ? parseSourceConnectorJobFromRawPayload({ sourceName: raw.sourceName, sourceId: raw.sourceId, rawPayload: raw.rawPayload }) : null;
    const plan = planJobPresentationRepair(job, source);
    console.log(JSON.stringify({ id, mode: apply ? "apply" : "dry-run", ...plan }));
    if (!apply || !plan.reasons.length) continue;
    const result = await prisma.jobCanonical.updateMany({
      where: { id, updatedAt: job.updatedAt },
      data: { ...plan.patch, ...(plan.patch.location ? { locationKey: normalizeLocationKey(plan.patch.location) } : {}), updatedAt: new Date() },
    });
    if (!result.count) { conflicts += 1; continue; }
    // This updates the read model's visibility, not canonical lifecycle state.
    // Saved jobs, source mappings, applications, packages and descriptions stay intact.
    await upsertJobFeedIndex(id);
    changed += 1;
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", inspected: ids.length, changed, conflicts, next: apply && changed ? "Run jobs:refresh-feed-summary after reviewing this batch." : null }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
