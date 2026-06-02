import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { validateCompanySource } from "../src/lib/ingestion/source-validator";
import { enqueueUniqueSourceTask } from "../src/lib/ingestion/task-queue";
import type {
  CompanySource,
  CompanySourcePollState,
  CompanySourceStatus,
  CompanySourceValidationState,
  Prisma,
} from "../src/generated/prisma/client";

type Args = {
  apply: boolean;
  validate: boolean;
  includeValidated: boolean;
  deleteSafeInvalid: boolean;
  limit: number;
  maxDelete: number;
  concurrency: number;
  connector: string | null;
  companyKey: string | null;
  sourceName: string | null;
  out: string | null;
};

type SourceRow = CompanySource & {
  company: {
    id: string;
    name: string;
    companyKey: string;
    metadataJson: Prisma.JsonValue | null;
  };
};

type SafeInvalidRow = {
  id: string;
  sourceName: string;
  connectorName: string;
  token: string;
  boardUrl: string;
  companyId: string;
  companyName: string;
  companyKey: string;
  metadataJson: Prisma.JsonValue | null;
  status: CompanySourceStatus;
  validationState: CompanySourceValidationState;
  pollState: CompanySourcePollState;
  validationMessage: string | null;
};

type ValidationRecord = {
  sourceName: string;
  company: string;
  connectorName: string;
  before: {
    status: CompanySourceStatus;
    validationState: CompanySourceValidationState;
    pollState: CompanySourcePollState;
  };
  result: {
    kind: string;
    validationState: CompanySourceValidationState;
    pollState: CompanySourcePollState;
    httpStatus: number | null;
    jobsFound: number;
    message: string;
  };
  action: "VALIDATED" | "QUARANTINED" | "BACKOFF" | "DELETE_SAFE_INVALID";
  applied: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    validate: false,
    includeValidated: false,
    deleteSafeInvalid: false,
    limit: 250,
    maxDelete: 1000,
    concurrency: 4,
    connector: null,
    companyKey: null,
    sourceName: null,
    out: null,
  };

  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [rawKey, rawValue] = rawArg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    const value = rawValue?.trim();

    if (key === "apply") args.apply = true;
    else if (key === "validate") args.validate = true;
    else if (key === "include-validated") args.includeValidated = true;
    else if (key === "delete-safe-invalid") args.deleteSafeInvalid = true;
    else if (key === "limit" && value) args.limit = parsePositiveInt(key, value);
    else if (key === "max-delete" && value) args.maxDelete = parsePositiveInt(key, value);
    else if (key === "concurrency" && value) args.concurrency = parsePositiveInt(key, value);
    else if (key === "connector" && value) args.connector = value;
    else if (key === "company-key" && value) args.companyKey = value;
    else if (key === "source-name" && value) args.sourceName = value;
    else if (key === "out" && value) args.out = value;
  }

  return args;
}

function parsePositiveInt(key: string, value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value "${value}".`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const safeInvalidRows = args.deleteSafeInvalid
    ? await findSafeInvalidRows(args)
    : [];

  let deletedSafeInvalidCount = 0;
  if (args.apply && args.deleteSafeInvalid && safeInvalidRows.length > 0) {
    deletedSafeInvalidCount = await deleteSafeInvalidRows(safeInvalidRows, now);
  }

  const validationRecords = args.validate
    ? await validateSources(args, now)
    : [];

  const report = {
    generatedAt: now.toISOString(),
    apply: args.apply,
    validate: args.validate,
    deleteSafeInvalid: args.deleteSafeInvalid,
    safeInvalidCandidates: safeInvalidRows.length,
    deletedSafeInvalidCount,
    validationCount: validationRecords.length,
    validationByAction: countBy(validationRecords, (record) => record.action),
    validationByResult: countBy(validationRecords, (record) => record.result.kind),
    safeInvalidSample: safeInvalidRows.slice(0, 25).map((row) => ({
      sourceName: row.sourceName,
      connectorName: row.connectorName,
      company: row.companyName,
      companyKey: row.companyKey,
      boardUrl: row.boardUrl,
      validationState: row.validationState,
      pollState: row.pollState,
      message: row.validationMessage,
    })),
    validationSample: validationRecords.slice(0, 25),
  };

  if (args.out) {
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

async function findSafeInvalidRows(args: Args): Promise<SafeInvalidRow[]> {
  const filters = {
    connector: args.connector,
    companyKey: args.companyKey,
    sourceName: args.sourceName,
  };

  return prisma.$queryRaw`
    SELECT
      cs.id,
      cs."sourceName",
      cs."connectorName",
      cs.token,
      cs."boardUrl",
      cs."companyId",
      c.name AS "companyName",
      c."companyKey",
      c."metadataJson",
      cs.status,
      cs."validationState",
      cs."pollState",
      cs."validationMessage"
    FROM "CompanySource" cs
    JOIN "Company" c ON c.id = cs."companyId"
    LEFT JOIN (
      SELECT "sourceName", COUNT(*)::int AS mapping_count
      FROM "JobSourceMapping"
      GROUP BY "sourceName"
    ) m ON m."sourceName" = cs."sourceName"
    WHERE cs."validationState" IN ('INVALID', 'NEEDS_REDISCOVERY')
      AND cs."connectorName" <> 'official-company'
      AND cs."retainedLiveJobCount" = 0
      AND cs."jobsFetchedCount" = 0
      AND cs."jobsAcceptedCount" = 0
      AND cs."jobsCreatedCount" = 0
      AND cs."lastSuccessfulPollAt" IS NULL
      AND COALESCE(m.mapping_count, 0) = 0
      AND (${filters.connector}::text IS NULL OR cs."connectorName" = ${filters.connector})
      AND (${filters.companyKey}::text IS NULL OR c."companyKey" = ${filters.companyKey})
      AND (${filters.sourceName}::text IS NULL OR cs."sourceName" = ${filters.sourceName})
    ORDER BY cs."updatedAt" ASC
    LIMIT ${args.maxDelete}
  `;
}

async function deleteSafeInvalidRows(rows: SafeInvalidRow[], now: Date) {
  const rowsByCompany = new Map<string, SafeInvalidRow[]>();
  for (const row of rows) {
    const existing = rowsByCompany.get(row.companyId) ?? [];
    existing.push(row);
    rowsByCompany.set(row.companyId, existing);
  }

  const tombstoneEntries = [...rowsByCompany.entries()];
  for (const batch of chunk(tombstoneEntries, 25)) {
    await Promise.all(
      batch.map(async ([companyId, companyRows]) => {
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { metadataJson: true },
        });
        const metadata = asRecord(company?.metadataJson);
        const invalidSourceUrls = new Set(readStringArray(metadata.invalidSourceUrls));
        const invalidSourceNames = new Set(readStringArray(metadata.invalidSourceNames));

        for (const row of companyRows) {
          invalidSourceUrls.add(normalizeTombstonedSourceUrl(row.boardUrl));
          invalidSourceNames.add(row.sourceName);
        }

        metadata.invalidSourceUrls = [...invalidSourceUrls].slice(-250);
        metadata.invalidSourceNames = [...invalidSourceNames].slice(-250);
        metadata.invalidSourceCleanup = {
          lastRunAt: now.toISOString(),
          deletedCount: companyRows.length,
          reason: "safe-invalid-company-source-cleanup",
        };

        await prisma.company.update({
          where: { id: companyId },
          data: { metadataJson: metadata as Prisma.InputJsonValue },
        });
      })
    );
  }

  let deleted = 0;
  for (const ids of chunk(rows.map((row) => row.id), 500)) {
    const result = await prisma.companySource.deleteMany({
      where: { id: { in: ids } },
    });
    deleted += result.count;
  }
  return deleted;
}

async function validateSources(args: Args, now: Date) {
  const sources = await loadValidationSources(args);
  const records: ValidationRecord[] = [];
  let index = 0;

  async function worker() {
    while (index < sources.length) {
      const source = sources[index++];
      records.push(await validateOneSource(source, args, now));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, sources.length) }, () => worker())
  );
  return records;
}

async function loadValidationSources(args: Args) {
  const where: Prisma.CompanySourceWhereInput = {
    ...(args.connector ? { connectorName: args.connector } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
    ...(args.companyKey
      ? { company: { companyKey: args.companyKey } }
      : {}),
    ...(args.includeValidated
      ? {}
      : {
          OR: [
            { validationState: { in: ["UNVALIDATED", "SUSPECT", "INVALID", "NEEDS_REDISCOVERY", "BLOCKED"] } },
            { pollState: { in: ["QUARANTINED", "BACKOFF"] } },
            { status: { in: ["REDISCOVER_REQUIRED", "DEGRADED"] } },
          ],
        }),
  };

  return prisma.companySource.findMany({
    where,
    include: {
      company: {
        select: {
          id: true,
          name: true,
          companyKey: true,
          metadataJson: true,
        },
      },
    },
    orderBy: [
      { validationState: "asc" },
      { updatedAt: "asc" },
    ],
    take: args.limit,
  });
}

async function validateOneSource(source: SourceRow, args: Args, now: Date) {
  const before = {
    status: source.status,
    validationState: source.validationState,
    pollState: source.pollState,
  };
  const rawResult = await validateCompanySource(source, now);
  const result =
    rawResult.kind === "VALIDATED" && isLikelyWrongAtsOwner(source)
      ? {
          ...rawResult,
          kind: "NEEDS_REDISCOVERY" as const,
          validationState: "NEEDS_REDISCOVERY" as const,
          pollState: "QUARANTINED" as const,
          jobsFound: 0,
          sourceQualityScore: 0.08,
          recommendedCooldownMinutes: 720,
          message: `Validated endpoint, but source token/host does not match company owner (${source.company.name}); quarantined for ownership repair.`,
        }
      : rawResult;
  const action = await chooseValidationAction(source, result.kind);

  if (args.apply) {
    if (action === "DELETE_SAFE_INVALID") {
      await deleteSafeInvalidRows([toSafeInvalidRow(source, result.message)], now);
    } else {
      await applyValidationResult(source, result, action, now);
    }
  }

  return {
    sourceName: source.sourceName,
    company: source.company.name,
    connectorName: source.connectorName,
    before,
    result: {
      kind: result.kind,
      validationState: result.validationState,
      pollState: result.pollState,
      httpStatus: result.httpStatus,
      jobsFound: result.jobsFound,
      message: result.message,
    },
    action,
    applied: args.apply,
  } satisfies ValidationRecord;
}

function isLikelyWrongAtsOwner(source: SourceRow) {
  if (source.connectorName === "company-site" || source.connectorName === "official-company") {
    return false;
  }
  if (
    source.retainedLiveJobCount > 0 ||
    source.jobsCreatedCount > 0 ||
    source.jobsAcceptedCount > 0
  ) {
    return false;
  }

  const companyHints = [
    compactOwnerText(source.company.name),
    compactOwnerText(source.company.companyKey),
  ].filter((hint) => hint.length >= 4);
  if (companyHints.length === 0) return false;

  const hints = extractAtsOwnerHints(source).filter((hint) => hint.length >= 6);
  if (hints.length === 0) return false;

  return hints.every((hint) =>
    companyHints.every(
      (companyHint) => !companyHint.includes(hint) && !hint.includes(companyHint)
    )
  );
}

function extractAtsOwnerHints(source: SourceRow) {
  const hints = new Set<string>();
  if (source.connectorName === "workday") {
    const [hostPart, tenantPart] = source.token.split("|");
    hints.add(hostPart?.split(".")[0] ?? "");
    hints.add(tenantPart ?? "");
  } else if (source.connectorName === "successfactors") {
    try {
      const host = new URL(source.boardUrl).hostname.replace(/^www\./i, "");
      const [first, second] = host.split(".");
      hints.add(first === "jobs" || first === "careers" ? second ?? "" : first ?? "");
    } catch {
      hints.add(source.token.split(".")[0] ?? "");
    }
  } else {
    hints.add(source.token);
  }

  try {
    const host = new URL(source.boardUrl).hostname.replace(/^www\./i, "");
    const first = host.split(".")[0] ?? "";
    if (first !== "jobs" && first !== "careers" && first !== "job-boards") {
      hints.add(first);
    }
  } catch {
    // Ignore malformed board URLs; token/sourceName still provide hints.
  }

  return [...hints].map(compactOwnerText).filter(Boolean);
}

function compactOwnerText(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:and|the|inc|llc|ltd|plc|corp|corporation|company|companies|group|global|international|limited|private|technologies|technology|systems|software|services|canada|usa|unitedstates|university|college|bank)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function chooseValidationAction(
  source: SourceRow,
  kind: string
): Promise<ValidationRecord["action"]> {
  if (kind === "VALIDATED") return "VALIDATED";
  if (kind === "SUSPECT" || kind === "BLOCKED") return "BACKOFF";
  const mappingCount = await prisma.jobSourceMapping.count({
    where: { sourceName: source.sourceName },
  });
  if (
    mappingCount === 0 &&
    source.retainedLiveJobCount === 0 &&
    source.jobsFetchedCount === 0 &&
    source.jobsAcceptedCount === 0 &&
    source.jobsCreatedCount === 0 &&
    !source.lastSuccessfulPollAt &&
    source.connectorName !== "official-company"
  ) {
    return "DELETE_SAFE_INVALID";
  }
  return "QUARANTINED";
}

async function applyValidationResult(
  source: SourceRow,
  result: Awaited<ReturnType<typeof validateCompanySource>>,
  action: ValidationRecord["action"],
  now: Date
) {
  const nextStatus: CompanySourceStatus =
    result.kind === "VALIDATED"
      ? source.lastSuccessfulPollAt
        ? "ACTIVE"
        : "PROVISIONED"
      : result.kind === "INVALID" || result.kind === "NEEDS_REDISCOVERY"
        ? "REDISCOVER_REQUIRED"
        : "DEGRADED";
  const nextFailureCount =
    result.kind === "VALIDATED" ? 0 : source.consecutiveFailures + 1;

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status: nextStatus,
      validationState:
        action === "QUARANTINED" && result.kind === "SUSPECT"
          ? "NEEDS_REDISCOVERY"
          : result.validationState,
      pollState: action === "QUARANTINED" ? "QUARANTINED" : result.pollState,
      lastValidatedAt: now,
      lastFailureAt: result.kind === "VALIDATED" ? null : now,
      lastHttpStatus: result.httpStatus,
      cooldownUntil:
        result.recommendedCooldownMinutes > 0
          ? new Date(now.getTime() + result.recommendedCooldownMinutes * 60 * 1000)
          : null,
      validationAttemptCount: { increment: 1 },
      validationSuccessCount:
        result.kind === "VALIDATED" ? { increment: 1 } : undefined,
      consecutiveFailures: nextFailureCount,
      failureStreak: nextFailureCount,
      sourceQualityScore: result.sourceQualityScore,
      validationMessage: result.message,
    },
  });

  if (result.kind === "VALIDATED" && (result.jobsFound > 0 || source.retainedLiveJobCount > 0)) {
    await enqueueUniqueSourceTask({
      kind: "CONNECTOR_POLL",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: Math.max(70, Math.round(source.priorityScore * 100)),
      notBeforeAt: now,
      payloadJson: { origin: "company_source_audit_cleanup" },
    });
  }
}

function toSafeInvalidRow(source: SourceRow, validationMessage: string): SafeInvalidRow {
  return {
    id: source.id,
    sourceName: source.sourceName,
    connectorName: source.connectorName,
    token: source.token,
    boardUrl: source.boardUrl,
    companyId: source.companyId,
    companyName: source.company.name,
    companyKey: source.company.companyKey,
    metadataJson: source.company.metadataJson,
    status: source.status,
    validationState: source.validationState,
    pollState: source.pollState,
    validationMessage,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeTombstonedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

main().catch(async (error) => {
  console.error("[audit-company-sources] failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
