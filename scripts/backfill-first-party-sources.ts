import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  ingestConnector,
  recoverStaleRunningIngestionRuns,
} from "../src/lib/ingestion/pipeline";
import {
  resolveConnectors,
} from "../src/lib/ingestion/registry";
import {
  runOperationalQueues,
  scheduleOperationalQueues,
} from "../src/lib/ingestion/network-orchestrator";
import type { IngestionSummary, SourceConnector } from "../src/lib/ingestion/types";

type Args = {
  officialSources: string[];
  cycles: number;
  limit: number;
  maxRuntimeMs: number;
  includeCompanySourceQueues: boolean;
  queueLimit: number;
};

const DEFAULT_OFFICIAL_SOURCES = [
  "amazon:global",
  "google:global",
  "apple:global",
  "microsoft:global",
  "nvidia:global",
];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    officialSources: DEFAULT_OFFICIAL_SOURCES,
    cycles: 1,
    limit: 100,
    maxRuntimeMs: 10 * 60 * 1000,
    includeCompanySourceQueues: false,
    queueLimit: 250,
  };

  for (const rawArg of argv) {
    const arg = rawArg.replace(/^--/, "");
    if (arg === "include-company-source-queues") {
      args.includeCompanySourceQueues = true;
      continue;
    }

    const [key, value] = arg.split("=");
    if (value === undefined) continue;

    if (key === "official-sources") {
      args.officialSources = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else if (key === "cycles") {
      args.cycles = readPositiveInteger(value, key);
    } else if (key === "limit") {
      args.limit = readPositiveInteger(value, key);
    } else if (key === "max-runtime-ms") {
      args.maxRuntimeMs = readPositiveInteger(value, key);
    } else if (key === "queue-limit") {
      args.queueLimit = readPositiveInteger(value, key);
    }
  }

  return args;
}

function readPositiveInteger(value: string, key: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value "${value}"`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectors = resolveConnectors("official-company", {
    sources: args.officialSources.join(","),
  });
  const activeConnectors = new Map(
    connectors.map((connector) => [connector.key, connector])
  );
  const summaries: IngestionSummary[] = [];

  for (let cycle = 1; cycle <= args.cycles; cycle += 1) {
    const cycleConnectors = [...activeConnectors.values()];
    if (cycleConnectors.length === 0) {
      console.log("[first-party-backfill] all official sources exhausted; stopping early");
      break;
    }

    console.log(
      `[first-party-backfill] cycle=${cycle}/${args.cycles} officialSources=${cycleConnectors.length} limit=${args.limit}`
    );

    await recoverStaleRunningIngestionRuns({
      connectorKeys: cycleConnectors.map((connector) => connector.key),
    });

    for (const connector of cycleConnectors) {
      const summary = await runOfficialConnectorBatch(connector, args);
      summaries.push(summary);
      console.log(
        [
          `[first-party-backfill] ${connector.key}`,
          `accepted=${summary.acceptedCount}`,
          `created=${summary.canonicalCreatedCount}`,
          `updated=${summary.canonicalUpdatedCount}`,
          `removed=${summary.sourceMappingsRemovedCount}`,
          `checkpointExhausted=${summary.checkpointExhausted ?? false}`,
        ].join(" ")
      );
      if (summary.checkpointExhausted) {
        activeConnectors.delete(connector.key);
      }
    }

    if (args.includeCompanySourceQueues) {
      await runCompanySourceQueuePass(args);
    }
  }

  console.log(
    JSON.stringify(
      {
        officialSources: args.officialSources,
        cycles: args.cycles,
        includeCompanySourceQueues: args.includeCompanySourceQueues,
        summaries: summaries.map((summary) => ({
          connectorKey: summary.connectorKey,
          sourceName: summary.sourceName,
          status: summary.status,
          fetchedCount: summary.fetchedCount,
          acceptedCount: summary.acceptedCount,
          canonicalCreatedCount: summary.canonicalCreatedCount,
          canonicalUpdatedCount: summary.canonicalUpdatedCount,
          sourceMappingsRemovedCount: summary.sourceMappingsRemovedCount,
          checkpointExhausted: summary.checkpointExhausted ?? false,
          checkpoint: summary.checkpoint ?? null,
        })),
      },
      null,
      2
    )
  );
}

async function runOfficialConnectorBatch(connector: SourceConnector, args: Args) {
  return ingestConnector(connector, {
    runMode: "MANUAL",
    allowOverlappingRuns: false,
    limit: args.limit,
    maxRuntimeMs: args.maxRuntimeMs,
    triggerLabel: "script.first-party.backfill",
    runMetadata: {
      origin: "first_party_backfill",
      continuousMonitoring: true,
      removalPolicy:
        "FULL_SNAPSHOT sources only remove missing mappings after a checkpoint-exhausted complete pass.",
    },
  });
}

async function runCompanySourceQueuePass(args: Args) {
  const now = new Date();
  const scheduled = await scheduleOperationalQueues({
    now,
    discoveryLimit: args.queueLimit,
    validationLimit: args.queueLimit,
    sourcePollLimit: args.queueLimit,
    rediscoveryLimit: Math.max(25, Math.floor(args.queueLimit / 4)),
    urlHealthLimit: 0,
  });
  const processed = await runOperationalQueues({
    now,
    discoveryLimit: args.queueLimit,
    validationLimit: args.queueLimit,
    sourcePollLimit: args.queueLimit,
    rediscoveryLimit: Math.max(25, Math.floor(args.queueLimit / 4)),
    urlHealthLimit: 0,
  });

  console.log(
    JSON.stringify(
      {
        companySourceQueues: {
          scheduled: {
            discovery: scheduled.discovery.enqueuedCount,
            validation: scheduled.validation.enqueuedCount,
            sourcePoll: scheduled.sourcePoll.enqueuedCount,
            rediscovery: scheduled.rediscovery.enqueuedCount,
          },
          processed: {
            discovery: processed.discovery.processedCount,
            validation: processed.validation.processedCount,
            sourcePoll: processed.sourcePoll.processedCount,
            rediscovery: processed.rediscovery.processedCount,
          },
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("First-party backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
