// Zombie-source sweep: applies the source circuit breaker to persistently
// failing company sources so they stop consuming poll/validation capacity.
//
//   REDISCOVER — enqueues a REDISCOVERY task (existing repair machinery) and
//                stamps a cooldown so polls stop retrying in the meantime.
//   DISABLE    — marks the source DISABLED/DISABLED; the company then counts
//                as a coverage gap, which keeps it in the slug-probe lane's
//                target set so a replacement board can still be discovered.
//
// Usage:
//   npm run source:sweep-zombies                      (dry run)
//   npm run source:sweep-zombies -- --limit=500 --apply

import "dotenv/config";

import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { decideSourceCircuitAction } from "../src/lib/ingestion/source-circuit-breaker";
import { enqueueUniqueSourceTask } from "../src/lib/ingestion/task-queue";

type CliArgs = { limit: number; apply: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 500, apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(raw.slice("--limit=".length), 10) || 500);
    }
  }
  return args;
}

const REDISCOVER_COOLDOWN_HOURS = Math.max(
  1,
  Number.parseInt(process.env.SOURCE_CIRCUIT_REDISCOVER_COOLDOWN_HOURS ?? "", 10) || 24
);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const candidates = await prisma.companySource.findMany({
    where: {
      status: { not: "DISABLED" },
      consecutiveFailures: { gte: 25 },
    },
    select: {
      id: true,
      companyId: true,
      sourceName: true,
      connectorName: true,
      status: true,
      pollState: true,
      consecutiveFailures: true,
      retainedLiveJobCount: true,
      lastSuccessfulPollAt: true,
      createdAt: true,
      cooldownUntil: true,
      metadataJson: true,
    },
    orderBy: { consecutiveFailures: "desc" },
    take: args.limit,
  });

  console.log(
    `[zombie-sweep] candidates=${candidates.length} limit=${args.limit} apply=${args.apply}`
  );

  let disabled = 0;
  let rediscoveries = 0;
  let kept = 0;

  for (const source of candidates) {
    const decision = decideSourceCircuitAction({
      now,
      consecutiveFailures: source.consecutiveFailures,
      retainedLiveJobCount: source.retainedLiveJobCount,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
      createdAt: source.createdAt,
    });

    if (decision.action === "KEEP") {
      kept += 1;
      continue;
    }

    const existingMetadata =
      source.metadataJson && typeof source.metadataJson === "object" && !Array.isArray(source.metadataJson)
        ? (source.metadataJson as Record<string, unknown>)
        : {};

    if (decision.action === "DISABLE") {
      disabled += 1;
      console.log(
        `[zombie-sweep] DISABLE ${source.sourceName} (${source.connectorName}) — ${decision.reason}`
      );
      if (args.apply) {
        await prisma.companySource.update({
          where: { id: source.id },
          data: {
            status: "DISABLED",
            pollState: "DISABLED",
            metadataJson: {
              ...existingMetadata,
              circuitBreaker: {
                action: "DISABLE",
                reason: decision.reason,
                decidedAt: now.toISOString(),
                consecutiveFailures: source.consecutiveFailures,
              },
            } as Prisma.InputJsonValue,
          },
        });
      }
      continue;
    }

    // REDISCOVER
    rediscoveries += 1;
    console.log(
      `[zombie-sweep] REDISCOVER ${source.sourceName} (${source.connectorName}) — ${decision.reason}`
    );
    if (args.apply) {
      const cooldownUntil = new Date(
        now.getTime() + REDISCOVER_COOLDOWN_HOURS * 60 * 60 * 1000
      );
      await prisma.companySource.update({
        where: { id: source.id },
        data: {
          status: "REDISCOVER_REQUIRED",
          validationState: "NEEDS_REDISCOVERY",
          cooldownUntil:
            source.cooldownUntil && source.cooldownUntil > cooldownUntil
              ? source.cooldownUntil
              : cooldownUntil,
          metadataJson: {
            ...existingMetadata,
            circuitBreaker: {
              action: "REDISCOVER",
              reason: decision.reason,
              decidedAt: now.toISOString(),
              consecutiveFailures: source.consecutiveFailures,
            },
          } as Prisma.InputJsonValue,
        },
      });
      await enqueueUniqueSourceTask({
        kind: "REDISCOVERY",
        companySourceId: source.id,
        companyId: source.companyId,
        priorityScore: Math.min(500, source.retainedLiveJobCount * 5 + 50),
        payloadJson: { trigger: "zombie-sweep" },
      });
    }
  }

  console.log(
    `[zombie-sweep] done: disabled=${disabled} rediscoveries=${rediscoveries} kept=${kept}${
      args.apply ? "" : " (dry run — pass --apply to write)"
    }`
  );
}

main()
  .catch((error) => {
    console.error("[zombie-sweep] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
