import { prisma } from "@/lib/db";
import { checkUrlHealth, runJobHealthCheck } from "@/lib/ingestion/health-checker";
import { reconcileCanonicalLifecycleByIds } from "@/lib/ingestion/pipeline";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

function parseArgs(argv: string[]) {
  const jobId =
    argv.find((arg) => arg.startsWith("--job="))?.slice("--job=".length) ??
    argv.find((arg) => !arg.startsWith("--"));
  return {
    jobId,
    fix: argv.includes("--fix"),
  };
}

function printSection(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function printValue(label: string, value: unknown) {
  if (value instanceof Date) {
    console.log(`${label}: ${value.toISOString()}`);
    return;
  }
  console.log(`${label}: ${value ?? "null"}`);
}

async function main() {
  const { jobId, fix } = parseArgs(process.argv.slice(2));
  if (!jobId) {
    throw new Error("Usage: npm run jobs:diagnose-apply-link -- --job=<canonicalJobId> [--fix]");
  }

  const job = await prisma.jobCanonical.findUnique({
    where: { id: jobId },
    include: {
      feedIndex: true,
      sourceMappings: {
        orderBy: [
          { removedAt: "asc" },
          { isPrimary: "desc" },
          { lastSeenAt: "desc" },
        ],
        take: 12,
        include: {
          rawJob: {
            select: {
              sourceName: true,
              sourceId: true,
              fetchedAt: true,
              rawPayload: true,
            },
          },
        },
      },
      urlHealthChecks: {
        orderBy: { checkedAt: "desc" },
        take: 5,
      },
    },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  const activeMappings = job.sourceMappings.filter((mapping) => mapping.removedAt === null);
  const primaryMapping =
    activeMappings.find((mapping) => mapping.isPrimary) ?? activeMappings[0] ?? null;

  printSection("Job");
  printValue("id", job.id);
  printValue("title", job.title);
  printValue("company", job.company);
  printValue("status", job.status);
  printValue("feedStatus", job.feedIndex?.status);
  printValue("feedSourceCount", job.feedIndex?.sourceCount);
  printValue("availabilityScore", job.availabilityScore);
  printValue("applyUrl", job.applyUrl);
  printValue("applyUrlKey", job.applyUrlKey);
  printValue("lastSourceSeenAt", job.lastSourceSeenAt);
  printValue("lastApplyCheckAt", job.lastApplyCheckAt);
  printValue("lastConfirmedAliveAt", job.lastConfirmedAliveAt);
  printValue("deadSignalAt", job.deadSignalAt);
  printValue("deadSignalReason", job.deadSignalReason);
  printValue("applyUrlValidationStatus", job.applyUrlValidationStatus);
  printValue("applyUrlValidationReason", job.applyUrlValidationReason);
  printValue("finalResolvedApplyUrl", job.finalResolvedApplyUrl);
  printValue("applyUrlRedirectDepth", job.applyUrlRedirectDepth);

  printSection("Source Mappings");
  if (job.sourceMappings.length === 0) {
    console.log("none");
  } else {
    for (const mapping of job.sourceMappings) {
      console.log(
        [
          mapping.sourceName,
          `primary=${mapping.isPrimary}`,
          `removedAt=${mapping.removedAt?.toISOString() ?? "null"}`,
          `lastSeenAt=${mapping.lastSeenAt.toISOString()}`,
          `sourceType=${mapping.sourceType ?? "null"}`,
          `qualityKind=${mapping.sourceQualityKind ?? "null"}`,
          `sourceUrl=${mapping.sourceUrl ?? "null"}`,
        ].join(" | ")
      );
    }
  }

  printSection("Recent Health Checks");
  if (job.urlHealthChecks.length === 0) {
    console.log("none");
  } else {
    for (const check of job.urlHealthChecks) {
      console.log(
        [
          check.checkedAt.toISOString(),
          check.urlType,
          check.result,
          `status=${check.statusCode ?? "null"}`,
          `final=${check.finalUrl ?? "null"}`,
          `reason=${check.closureReason ?? "null"}`,
        ].join(" | ")
      );
    }
  }

  printSection("Live Validation");
  const applyHealth = fix
    ? (await runJobHealthCheck(job.id)).applyHealth
    : await checkUrlHealth({
        url: job.applyUrl,
        urlType: "APPLY",
        deadline: job.deadline,
        title: job.title,
        company: job.company,
        description: job.description,
        now: new Date(),
      });

  printValue("result", applyHealth.result);
  printValue("httpStatus", applyHealth.statusCode);
  printValue("finalUrl", applyHealth.finalUrl);
  printValue("redirectDepth", applyHealth.redirectDepth);
  printValue("validationStatus", applyHealth.validationStatus);
  printValue("validationReason", applyHealth.validationReason ?? applyHealth.closureReason);
  console.log("redirectChain:");
  for (const hop of applyHealth.redirectChain) {
    console.log(`  ${hop.statusCode ?? "null"} ${hop.url}${hop.location ? ` -> ${hop.location}` : ""}`);
  }
  console.log("contentMatch:");
  console.log(JSON.stringify(applyHealth.contentMatch, null, 2));

  if (primaryMapping?.sourceUrl && primaryMapping.sourceUrl !== job.applyUrl) {
    printSection("Live Detail Validation");
    const detailHealth = await checkUrlHealth({
      url: primaryMapping.sourceUrl,
      urlType: "DETAIL",
      deadline: job.deadline,
      title: job.title,
      company: job.company,
      description: job.description,
      now: new Date(),
    });
    printValue("result", detailHealth.result);
    printValue("httpStatus", detailHealth.statusCode);
    printValue("finalUrl", detailHealth.finalUrl);
    printValue("validationStatus", detailHealth.validationStatus);
    printValue("validationReason", detailHealth.validationReason ?? detailHealth.closureReason);
  }

  if (fix) {
    await reconcileCanonicalLifecycleByIds([job.id], { now: new Date() });
    await upsertJobFeedIndex(job.id);
    const refreshed = await prisma.jobCanonical.findUnique({
      where: { id: job.id },
      include: { feedIndex: true },
    });
    printSection("After Fix");
    printValue("status", refreshed?.status);
    printValue("feedStatus", refreshed?.feedIndex?.status);
    printValue("deadSignalAt", refreshed?.deadSignalAt);
    printValue("deadSignalReason", refreshed?.deadSignalReason);
    printValue("applyUrlValidationStatus", refreshed?.applyUrlValidationStatus);
    printValue("finalResolvedApplyUrl", refreshed?.finalResolvedApplyUrl);
  }

  const recommendedAction =
    applyHealth.result === "DEAD"
      ? "Hide/expire from normal job feed."
      : applyHealth.result === "SUSPECT"
        ? "Keep out of prominent feed until revalidated by source."
        : "Keep visible if source mapping is still active.";
  printSection("Recommended Action");
  console.log(recommendedAction);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
