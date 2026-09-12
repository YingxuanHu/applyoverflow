import { prisma } from "../src/lib/db";
import { claimPipelineTasks, finishPipelineTask, readPipelinePayload } from "../src/lib/ingestion/pipeline-queue";
import { recoverJobDescription } from "../src/lib/jobs/description-recovery";
import { needsDescriptionRepair } from "../src/lib/jobs/description-quality";
import { extractAndScoreDescription } from "../src/lib/ingestion/extraction/description-extractor";
import { normalizeDescriptionFingerprint } from "../src/lib/ingestion/dedupe";
import { buildSearchText } from "../src/lib/ingestion/quality";

async function main() {
  const tasks = await claimPipelineTasks("DESCRIPTION_REPAIR", 5);
  let repaired = 0;
  let unavailable = 0;
  let skipped = 0;
  for (const task of tasks) {
    try {
      const id = readPipelinePayload(task).canonicalJobId;
      const job = typeof id === "string" ? await prisma.jobCanonical.findUnique({
        where: { id },
        select: {
          id: true, status: true, title: true, company: true, location: true,
          roleFamily: true, shortSummary: true, description: true, applyUrl: true, updatedAt: true,
          sourceMappings: {
            where: { removedAt: null }, take: 6,
            orderBy: [{ sourceQualityRank: "desc" }, { isPrimary: "desc" }, { lastSeenAt: "desc" }],
            select: { sourceName: true, sourceUrl: true, rawJob: { select: { rawPayload: true, fetchedAt: true } } },
          },
        },
      }) : null;
      if (!job || job.status !== "LIVE" || !needsDescriptionRepair(job)) {
        await finishPipelineTask(task.id, "SKIPPED");
        skipped += 1;
        continue;
      }
      const recovered = await recoverJobDescription(job);
      if (!recovered) {
        unavailable += 1;
        throw new Error("No matching complete source description");
      }
      const facts = extractAndScoreDescription({ description: recovered.description }, job);
      const description = facts.text ?? recovered.description;
      const quality = { descriptionStatus: facts.status, descriptionConfidence: facts.confidence, descriptionWordCount: facts.wordCount };
      const count = await prisma.$transaction(async (tx) => {
        // A source poll may have changed any job metadata while the fetch ran.
        const updated = await tx.jobCanonical.updateMany({
          where: { id: job.id, status: "LIVE", updatedAt: job.updatedAt },
          data: { description, ...quality, descriptionFingerprint: normalizeDescriptionFingerprint(description) },
        });
        if (!updated.count) return 0;
        // Update only description-dependent search fields; do not change visibility,
        // lifecycle, saved jobs, applications, or package records.
        await tx.jobFeedIndex.updateMany({
          where: { canonicalJobId: job.id },
          data: { ...quality, searchText: buildSearchText({ ...job, description }) },
        });
        await tx.pipelineTask.update({ where: { id: task.id }, data: {
          payloadJson: { canonicalJobId: job.id, sourceUrl: recovered.sourceUrl, method: recovered.method, observedAt: recovered.observedAt.toISOString() },
        } });
        return updated.count;
      });
      repaired += count;
      if (!count) skipped += 1;
      await finishPipelineTask(task.id, count ? "SUCCESS" : "SKIPPED");
    } catch {
      await finishPipelineTask(task.id, "FAILED", {
        lastError: "Description repair failed",
        retryAt: task.attemptCount < task.maxAttempts ? new Date(Date.now() + 15 * 60_000) : null,
      });
    }
  }
  console.log(JSON.stringify({ attempted: tasks.length, repaired, unavailable, skipped }));
}
main().catch(() => { console.error("Description repair worker failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
