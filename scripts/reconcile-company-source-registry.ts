import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  buildCompanyKey,
  cleanCompanyName,
} from "@/lib/ingestion/discovery/company-corpus";
import {
  buildDiscoveredSourceName,
  discoverSourceCandidatesFromUrls,
} from "@/lib/ingestion/discovery/sources";
import { upsertCompanySourceByIdentity } from "@/lib/ingestion/company-source-upsert";
import { enqueueSourceTask } from "@/lib/ingestion/task-queue";
import { coerceNormalizedIndustry, type NormalizedIndustry } from "@/lib/job-metadata";
import { uniqueKnownIndustries } from "@/lib/company-industry";

const DEFAULT_FILE = "data/applyoverflow-source-registry-2026-06-04.csv";
const DEFAULT_CADENCE_MINUTES = 180;
const MARKER_PREFIXES = [
  "NEEDS_REVIEW",
  "NO_VERIFIED",
  "INVALID",
  "NOT_FOUND",
  "UNAVAILABLE",
  "BLOCKED",
];

type Args = {
  file: string;
  apply: boolean;
  limit: number | null;
  startLine: number;
  queuePoll: boolean;
  disableMarkedSources: boolean;
  out: string;
};

type RegistryRow = {
  lineNumber: number;
  companyId: string | null;
  companyName: string;
  companyKey: string;
  domain: string | null;
  careersUrlRaw: string;
  careersUrl: string | null;
  sourceMarker: string | null;
  detectedAts: string | null;
  primaryIndustry: NormalizedIndustry | null;
  industries: NormalizedIndustry[];
  bestSourceName: string | null;
  bestConnectorName: string | null;
  bestBoardUrl: string | null;
};

type ImportReport = {
  generatedAt: string;
  mode: "apply" | "dry-run";
  file: string;
  rowsRead: number;
  usableRows: number;
  validUrlRows: number;
  markedRows: number;
  companiesCreated: number;
  companiesUpdated: number;
  companiesMatchedById: number;
  companiesMatchedByKey: number;
  companiesMatchedByDomain: number;
  companyIndustryRows: number;
  canonicalJobsUpdated: number;
  feedRowsUpdated: number;
  normalizedRowsUpdated: number;
  atsSourcesCreated: number;
  atsSourcesUpdated: number;
  companySiteSourcesCreated: number;
  companySiteSourcesUpdated: number;
  markedSourcesDisabled: number;
  replacedWeakSourcesDisabled: number;
  validationTasksQueued: number;
  pollTasksQueued: number;
  discoveryTasksQueued: number;
  manualReviewSources: number;
  invalidSources: number;
  countsByConnector: Record<string, number>;
  countsByMarker: Record<string, number>;
  sampleCreatedCompanies: string[];
  sampleUpdatedCompanies: string[];
  sampleManualReview: Array<{
    companyName: string;
    companyKey: string;
    marker: string;
    bestSourceName: string | null;
    bestBoardUrl: string | null;
  }>;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: DEFAULT_FILE,
    apply: false,
    limit: null,
    startLine: 2,
    queuePoll: false,
    disableMarkedSources: true,
    out: "data/discovery/reports/company-source-registry-reconcile.json",
  };

  for (const rawArg of argv) {
    if (rawArg === "--apply") {
      args.apply = true;
      continue;
    }
    if (rawArg === "--queue-poll") {
      args.queuePoll = true;
      continue;
    }
    if (rawArg === "--no-disable-marked-sources") {
      args.disableMarkedSources = false;
      continue;
    }
    const [rawKey, value] = rawArg.replace(/^--/, "").split("=");
    if (!value) continue;
    if (rawKey === "file") args.file = value;
    if (rawKey === "limit") args.limit = Math.max(1, Number.parseInt(value, 10));
    if (rawKey === "start-line") {
      args.startLine = Math.max(2, Number.parseInt(value, 10));
    }
    if (rawKey === "out") args.out = value;
  }

  return args;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readCell(columns: string[], headerIndex: Map<string, number>, name: string) {
  const index = headerIndex.get(name);
  if (index == null) return "";
  return (columns[index] ?? "").trim();
}

function normalizeUrl(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || isSourceMarker(trimmed)) return null;

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function normalizeString(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCompanyName(value: string) {
  return cleanCompanyName(value).replace(/\s{2,}/g, " ").trim();
}

function isSourceMarker(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return MARKER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function markerValidationState(marker: string) {
  if (/BLOCKED/i.test(marker)) return "BLOCKED" as const;
  if (/INVALID|NOT_FOUND|UNAVAILABLE|NO_VERIFIED|NOT_COMPANY_ROW/i.test(marker)) {
    return "INVALID" as const;
  }
  return "NEEDS_REDISCOVERY" as const;
}

function sourceTypeForMarker(marker: string) {
  if (/INVALID|NOT_FOUND|UNAVAILABLE|NO_VERIFIED|NOT_COMPANY_ROW/i.test(marker)) {
    return {
      status: "DISABLED" as const,
      validationState: markerValidationState(marker),
      pollState: "DISABLED" as const,
    };
  }

  return {
    status: "REDISCOVER_REQUIRED" as const,
    validationState: markerValidationState(marker),
    pollState: "QUARANTINED" as const,
  };
}

function readIndustries(value: string, primary: NormalizedIndustry | null) {
  const values = uniqueKnownIndustries(value.split(/[;|]/).map((entry) => entry.trim()));
  if (values.length > 0) return values;
  return primary && primary !== "UNKNOWN" ? [primary] : [];
}

function parseRegistryRows(content: string, limit: number | null, startLine: number) {
  const [header, ...records] = parseCsv(content);
  if (!header) return [];
  const headerIndex = new Map(header.map((name, index) => [name.trim(), index]));
  const rows: RegistryRow[] = [];

  for (let index = 0; index < records.length; index += 1) {
    if (limit != null && rows.length >= limit) break;
    const lineNumber = index + 2;
    if (lineNumber < startLine) continue;
    const columns = records[index]!;
    const companyName = normalizeCompanyName(readCell(columns, headerIndex, "companyName"));
    if (!companyName) continue;

    const rawCompanyKey = readCell(columns, headerIndex, "companyKey");
    const companyKey = rawCompanyKey || buildCompanyKey(companyName);
    if (!companyKey) continue;

    const careersUrlRaw = readCell(columns, headerIndex, "careersUrl");
    const careersUrl = normalizeUrl(careersUrlRaw);
    const sourceMarker = !careersUrl && isSourceMarker(careersUrlRaw)
      ? careersUrlRaw.trim().toUpperCase()
      : null;
    const primaryIndustry = coerceNormalizedIndustry(
      readCell(columns, headerIndex, "primaryIndustry")
    );
    const usablePrimary = primaryIndustry === "UNKNOWN" ? null : primaryIndustry;

    rows.push({
      lineNumber,
      companyId: normalizeString(readCell(columns, headerIndex, "companyId")),
      companyName,
      companyKey,
      domain: normalizeDomain(readCell(columns, headerIndex, "domain")),
      careersUrlRaw,
      careersUrl,
      sourceMarker,
      detectedAts: normalizeString(readCell(columns, headerIndex, "detectedAts")),
      primaryIndustry: usablePrimary,
      industries: readIndustries(
        readCell(columns, headerIndex, "industries"),
        usablePrimary
      ),
      bestSourceName: normalizeString(readCell(columns, headerIndex, "bestSourceName")),
      bestConnectorName: normalizeString(readCell(columns, headerIndex, "bestConnectorName")),
      bestBoardUrl: normalizeUrl(readCell(columns, headerIndex, "bestBoardUrl")),
    });
  }

  return rows;
}

function mergeMetadata(
  current: unknown,
  next: Record<string, Prisma.InputJsonValue | null>
) {
  const currentRecord =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};

  return {
    ...currentRecord,
    ...next,
  } as Prisma.InputJsonValue;
}

async function findCompanyForRow(row: RegistryRow) {
  const or: Prisma.CompanyWhereInput[] = [];
  if (row.companyId) or.push({ id: row.companyId });
  if (row.companyKey) or.push({ companyKey: row.companyKey });
  if (row.domain) or.push({ domain: row.domain });
  if (or.length === 0) return null;

  return prisma.company.findFirst({
    where: { OR: or },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      companyKey: true,
      metadataJson: true,
      careersUrl: true,
    },
  });
}

async function upsertCompany(row: RegistryRow, report: ImportReport, now: Date) {
  const existing = await findCompanyForRow(row);
  const companyKey = existing?.companyKey ?? row.companyKey;
  const normalizedIndustries = row.industries;
  const normalizedIndustry = row.primaryIndustry ?? normalizedIndustries[0] ?? "UNKNOWN";
  const hasVerifiedIndustry = normalizedIndustries.length > 0;
  const metadata = {
    sourceRegistryImport: {
      importedAt: now.toISOString(),
      lineNumber: row.lineNumber,
      careersUrlRaw: row.careersUrlRaw,
      sourceMarker: row.sourceMarker,
      sourceFileFormat: "visible-company-source-summary",
    },
    verifiedIndustryCodes: normalizedIndustries,
    primaryIndustryCode: normalizedIndustry,
  } satisfies Record<string, Prisma.InputJsonValue | null>;

  if (existing) {
    if (row.companyId && existing.id === row.companyId) report.companiesMatchedById += 1;
    else if (existing.companyKey === row.companyKey) report.companiesMatchedByKey += 1;
    else report.companiesMatchedByDomain += 1;

    const company = await prisma.company.update({
      where: { id: existing.id },
      data: {
        name: row.companyName,
        domain: row.domain,
        careersUrl: row.careersUrl,
        detectedAts: row.detectedAts,
        discoveryStatus: row.careersUrl ? "DISCOVERED" : "PENDING",
        crawlStatus: "IDLE",
        discoveryConfidence: row.careersUrl ? 0.95 : 0.25,
        metadataJson: mergeMetadata(existing.metadataJson, metadata),
        normalizedIndustry,
        normalizedIndustries,
        normalizedIndustryConfidence: hasVerifiedIndustry ? 0.99 : 0.2,
        normalizedIndustrySource: hasVerifiedIndustry
          ? "company_verified_csv"
          : "unknown_company_industry",
        normalizedIndustryUpdatedAt: now,
      },
      select: { id: true, companyKey: true, name: true },
    });
    report.companiesUpdated += 1;
    if (report.sampleUpdatedCompanies.length < 12) {
      report.sampleUpdatedCompanies.push(`${company.name} (${company.companyKey})`);
    }
    return company;
  }

  const company = await prisma.company.create({
    data: {
      name: row.companyName,
      companyKey,
      domain: row.domain,
      careersUrl: row.careersUrl,
      detectedAts: row.detectedAts,
      discoveryStatus: row.careersUrl ? "DISCOVERED" : "PENDING",
      crawlStatus: "IDLE",
      discoveryConfidence: row.careersUrl ? 0.9 : 0.25,
      metadataJson: metadata,
      normalizedIndustry,
      normalizedIndustries,
      normalizedIndustryConfidence: hasVerifiedIndustry ? 0.99 : 0.2,
      normalizedIndustrySource: hasVerifiedIndustry
        ? "company_verified_csv"
        : "unknown_company_industry",
      normalizedIndustryUpdatedAt: now,
    },
    select: { id: true, companyKey: true, name: true },
  });
  report.companiesCreated += 1;
  if (report.sampleCreatedCompanies.length < 12) {
    report.sampleCreatedCompanies.push(`${company.name} (${company.companyKey})`);
  }
  return company;
}

async function upsertAtsSource(input: {
  companyId: string;
  companyKey: string;
  companyName: string;
  careersUrl: string;
  candidate: Awaited<ReturnType<typeof discoverSourceCandidatesFromUrls>>["candidates"][number];
  now: Date;
  report: ImportReport;
}) {
  const sourceName = buildDiscoveredSourceName(
    input.candidate.connectorName,
    input.candidate.token
  );
  const existing = await prisma.companySource.findFirst({
    where: {
      OR: [
        { sourceName },
        {
          companyId: input.companyId,
          connectorName: input.candidate.connectorName,
          token: input.candidate.token,
        },
      ],
    },
    select: { id: true },
  });

  const source = await upsertCompanySourceByIdentity({
    identity: {
      companyId: input.companyId,
      sourceName,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
    },
    create: {
      companyId: input.companyId,
      sourceName,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
      boardUrl: input.candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "source-registry-import:v1",
      pollingCadenceMinutes: DEFAULT_CADENCE_MINUTES,
      priorityScore: 1.08,
      sourceQualityScore: 0.86,
      yieldScore: 0.62,
      firstSeenAt: input.now,
      lastProvisionedAt: input.now,
      lastDiscoveryAt: input.now,
      metadataJson: {
        importSource: "applyoverflow_source_registry",
        sourceRegistryCareersUrl: input.careersUrl,
        sourceRegistryCompanyKey: input.companyKey,
      },
    },
    update: {
      companyId: input.companyId,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
      boardUrl: input.candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "source-registry-import:v1",
      pollingCadenceMinutes: DEFAULT_CADENCE_MINUTES,
      priorityScore: 1.08,
      sourceQualityScore: 0.86,
      yieldScore: 0.62,
      lastProvisionedAt: input.now,
      lastDiscoveryAt: input.now,
      lastValidatedAt: null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: null,
      metadataJson: {
        importSource: "applyoverflow_source_registry",
        sourceRegistryCareersUrl: input.careersUrl,
        sourceRegistryCompanyKey: input.companyKey,
      },
    },
  });

  if (existing) input.report.atsSourcesUpdated += 1;
  else input.report.atsSourcesCreated += 1;
  input.report.countsByConnector[input.candidate.connectorName] =
    (input.report.countsByConnector[input.candidate.connectorName] ?? 0) + 1;
  await queueValidationAndPoll({
    companyId: input.companyId,
    companySourceId: source.id,
    sourceName,
    priorityScore: 98,
    now: input.now,
    report: input.report,
  });
}

async function upsertCompanySiteSource(input: {
  companyId: string;
  companyKey: string;
  careersUrl: string;
  now: Date;
  report: ImportReport;
}) {
  const sourceName = `CompanyHtml:${input.companyKey}`;
  const existing = await prisma.companySource.findFirst({
    where: {
      OR: [
        { sourceName },
        {
          companyId: input.companyId,
          connectorName: "company-site",
          token: input.companyKey,
        },
      ],
    },
    select: { id: true },
  });

  const source = await upsertCompanySourceByIdentity({
    identity: {
      companyId: input.companyId,
      sourceName,
      connectorName: "company-site",
      token: input.companyKey,
    },
    create: {
      companyId: input.companyId,
      sourceName,
      connectorName: "company-site",
      token: input.companyKey,
      boardUrl: input.careersUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "COMPANY_HTML",
      extractionRoute: "UNKNOWN",
      parserVersion: "source-registry-import:v1",
      pollingCadenceMinutes: 360,
      priorityScore: 0.78,
      sourceQualityScore: 0.48,
      yieldScore: 0.3,
      firstSeenAt: input.now,
      lastProvisionedAt: input.now,
      lastDiscoveryAt: input.now,
      metadataJson: {
        importSource: "applyoverflow_source_registry",
        sourceRegistryCareersUrl: input.careersUrl,
      },
    },
    update: {
      companyId: input.companyId,
      boardUrl: input.careersUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "COMPANY_HTML",
      extractionRoute: "UNKNOWN",
      parserVersion: "source-registry-import:v1",
      pollingCadenceMinutes: 360,
      priorityScore: 0.78,
      sourceQualityScore: 0.48,
      yieldScore: 0.3,
      lastProvisionedAt: input.now,
      lastDiscoveryAt: input.now,
      lastValidatedAt: null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: null,
      metadataJson: {
        importSource: "applyoverflow_source_registry",
        sourceRegistryCareersUrl: input.careersUrl,
      },
    },
  });

  if (existing) input.report.companySiteSourcesUpdated += 1;
  else input.report.companySiteSourcesCreated += 1;
  input.report.countsByConnector["company-site"] =
    (input.report.countsByConnector["company-site"] ?? 0) + 1;

  await queueValidationAndPoll({
    companyId: input.companyId,
    companySourceId: source.id,
    sourceName,
    priorityScore: 72,
    now: input.now,
    report: input.report,
  });

  await enqueueSourceTask({
    kind: "COMPANY_DISCOVERY",
    companyId: input.companyId,
    priorityScore: 58,
    notBeforeAt: input.now,
    payloadJson: {
      origin: "source_registry_import",
      careersUrl: input.careersUrl,
    },
  });
  input.report.discoveryTasksQueued += 1;
}

async function queueValidationAndPoll(input: {
  companyId: string;
  companySourceId: string;
  sourceName: string;
  priorityScore: number;
  now: Date;
  report: ImportReport;
}) {
  await enqueueSourceTask({
    kind: "SOURCE_VALIDATION",
    companyId: input.companyId,
    companySourceId: input.companySourceId,
    priorityScore: input.priorityScore,
    notBeforeAt: input.now,
    payloadJson: {
      origin: "source_registry_import",
      sourceName: input.sourceName,
    },
  });
  input.report.validationTasksQueued += 1;
}

async function disableMarkedSources(
  row: RegistryRow,
  companyId: string,
  report: ImportReport,
  now: Date
) {
  if (!row.sourceMarker) return;
  const sourceState = sourceTypeForMarker(row.sourceMarker);
  const or: Prisma.CompanySourceWhereInput[] = [];
  if (row.bestSourceName) or.push({ sourceName: row.bestSourceName });
  if (row.bestBoardUrl) or.push({ boardUrl: row.bestBoardUrl });
  or.push({ companyId, connectorName: "company-site", token: row.companyKey });
  if (/DOMAIN_MISMATCH|NOT_COMPANY_ROW|AMBIGUOUS|NO_VERIFIED|LINK_DOES_NOT_SHOW/i.test(row.sourceMarker)) {
    or.push({ companyId });
  }

  if (or.length === 0) return;
  const updated = await prisma.companySource.updateMany({
    where: {
      OR: or,
      pollState: { not: "DISABLED" },
    },
    data: {
      status: sourceState.status,
      validationState: sourceState.validationState,
      pollState: sourceState.pollState,
      validationMessage: `Disabled by source registry marker ${row.sourceMarker}`,
      cooldownUntil: null,
      lastFailureAt: now,
      failureStreak: { increment: 1 },
      consecutiveFailures: { increment: 1 },
    },
  });

  report.markedSourcesDisabled += updated.count;
  if (sourceState.status === "DISABLED") report.invalidSources += 1;
  else report.manualReviewSources += 1;
  if (report.sampleManualReview.length < 20) {
    report.sampleManualReview.push({
      companyName: row.companyName,
      companyKey: row.companyKey,
      marker: row.sourceMarker,
      bestSourceName: row.bestSourceName,
      bestBoardUrl: row.bestBoardUrl,
    });
  }
}

async function disableWeakReplacedCompanySiteSources(
  row: RegistryRow,
  companyId: string,
  report: ImportReport,
  now: Date
) {
  if (!row.careersUrl) return;

  const updated = await prisma.companySource.updateMany({
    where: {
      companyId,
      connectorName: "company-site",
      boardUrl: { not: row.careersUrl },
      OR: [
        { validationState: { in: ["INVALID", "SUSPECT", "NEEDS_REDISCOVERY", "BLOCKED"] } },
        { retainedLiveJobCount: 0 },
      ],
      pollState: { not: "DISABLED" },
    },
    data: {
      status: "REDISCOVER_REQUIRED",
      validationState: "NEEDS_REDISCOVERY",
      pollState: "QUARANTINED",
      validationMessage:
        "Quarantined by source registry import because a corrected careersUrl replaced this weak company-site source.",
      lastFailureAt: now,
    },
  });
  report.replacedWeakSourcesDisabled += updated.count;
}

async function propagateCompaniesToJobs(companyIds: string[]) {
  let canonicalJobsUpdated = 0;
  let feedRowsUpdated = 0;
  let normalizedRowsUpdated = 0;

  for (let start = 0; start < companyIds.length; start += 500) {
    const ids = companyIds.slice(start, start + 500);
    canonicalJobsUpdated += Number(await prisma.$executeRaw`
      WITH target_companies AS MATERIALIZED (
        SELECT id, "companyKey", name, "normalizedIndustry", "normalizedIndustries", "normalizedIndustryConfidence"
        FROM "Company"
        WHERE id IN (${Prisma.join(ids)})
      )
      UPDATE "JobCanonical" jc
      SET
        company = c.name,
        "companyKey" = c."companyKey",
        "normalizedIndustry" = c."normalizedIndustry",
        "normalizedIndustries" = c."normalizedIndustries",
        "normalizedIndustryConfidence" = c."normalizedIndustryConfidence"
      FROM target_companies c
      WHERE jc."companyId" = c.id
        AND (
          jc.company IS DISTINCT FROM c.name
          OR jc."companyKey" IS DISTINCT FROM c."companyKey"
          OR jc."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
          OR jc."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
          OR jc."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
        )
    `);

    feedRowsUpdated += Number(await prisma.$executeRaw`
      WITH target_companies AS MATERIALIZED (
        SELECT id, name, "normalizedIndustry", "normalizedIndustries", "normalizedIndustryConfidence"
        FROM "Company"
        WHERE id IN (${Prisma.join(ids)})
      )
      UPDATE "JobFeedIndex" jfi
      SET
        company = c.name,
        "normalizedIndustry" = c."normalizedIndustry",
        "normalizedIndustries" = c."normalizedIndustries",
        "normalizedIndustryConfidence" = c."normalizedIndustryConfidence",
        "indexedAt" = NOW()
      FROM "JobCanonical" jc
      JOIN target_companies c ON c.id = jc."companyId"
      WHERE jfi."canonicalJobId" = jc.id
        AND (
          jfi.company IS DISTINCT FROM c.name
          OR jfi."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
          OR jfi."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
          OR jfi."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
        )
    `);

    normalizedRowsUpdated += Number(await prisma.$executeRaw`
      WITH target_companies AS MATERIALIZED (
        SELECT "companyKey", name, "normalizedIndustry", "normalizedIndustries", "normalizedIndustryConfidence"
        FROM "Company"
        WHERE id IN (${Prisma.join(ids)})
      )
      UPDATE "NormalizedJobRecord" njr
      SET
        company = c.name,
        "normalizedIndustry" = c."normalizedIndustry",
        "normalizedIndustries" = c."normalizedIndustries",
        "normalizedIndustryConfidence" = c."normalizedIndustryConfidence"
      FROM target_companies c
      WHERE njr."companyKey" = c."companyKey"
        AND (
          njr.company IS DISTINCT FROM c.name
          OR njr."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
          OR njr."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
          OR njr."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
        )
    `);
  }

  return { canonicalJobsUpdated, feedRowsUpdated, normalizedRowsUpdated };
}

function buildReport(args: Args, rows: RegistryRow[]): ImportReport {
  const report: ImportReport = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    file: path.resolve(args.file),
    rowsRead: rows.length,
    usableRows: rows.length,
    validUrlRows: rows.filter((row) => row.careersUrl).length,
    markedRows: rows.filter((row) => row.sourceMarker).length,
    companiesCreated: 0,
    companiesUpdated: 0,
    companiesMatchedById: 0,
    companiesMatchedByKey: 0,
    companiesMatchedByDomain: 0,
    companyIndustryRows: rows.filter((row) => row.industries.length > 0).length,
    canonicalJobsUpdated: 0,
    feedRowsUpdated: 0,
    normalizedRowsUpdated: 0,
    atsSourcesCreated: 0,
    atsSourcesUpdated: 0,
    companySiteSourcesCreated: 0,
    companySiteSourcesUpdated: 0,
    markedSourcesDisabled: 0,
    replacedWeakSourcesDisabled: 0,
    validationTasksQueued: 0,
    pollTasksQueued: 0,
    discoveryTasksQueued: 0,
    manualReviewSources: 0,
    invalidSources: 0,
    countsByConnector: {},
    countsByMarker: {},
    sampleCreatedCompanies: [],
    sampleUpdatedCompanies: [],
    sampleManualReview: [],
  };

  for (const row of rows) {
    if (row.sourceMarker) {
      report.countsByMarker[row.sourceMarker] =
        (report.countsByMarker[row.sourceMarker] ?? 0) + 1;
    }
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  const rows = parseRegistryRows(await readFile(filePath, "utf8"), args.limit, args.startLine);
  const report = buildReport({ ...args, file: filePath }, rows);
  const now = new Date();
  const touchedCompanyIds = new Set<string>();

  for (const row of rows) {
    if (!args.apply) continue;

    const company = await upsertCompany(row, report, now);
    touchedCompanyIds.add(company.id);

    if (row.sourceMarker) {
      if (args.disableMarkedSources) {
        await disableMarkedSources(row, company.id, report, now);
      }
      continue;
    }

    if (!row.careersUrl) continue;
    const discovery = await discoverSourceCandidatesFromUrls([row.careersUrl]);
    if (discovery.candidates.length > 0) {
      for (const candidate of discovery.candidates) {
        await upsertAtsSource({
          companyId: company.id,
          companyKey: company.companyKey,
          companyName: company.name,
          careersUrl: row.careersUrl,
          candidate,
          now,
          report,
        });
      }
    } else {
      await upsertCompanySiteSource({
        companyId: company.id,
        companyKey: company.companyKey,
        careersUrl: row.careersUrl,
        now,
        report,
      });
    }

    await disableWeakReplacedCompanySiteSources(row, company.id, report, now);
  }

  if (args.apply && touchedCompanyIds.size > 0) {
    const propagated = await propagateCompaniesToJobs([...touchedCompanyIds]);
    report.canonicalJobsUpdated = propagated.canonicalJobsUpdated;
    report.feedRowsUpdated = propagated.feedRowsUpdated;
    report.normalizedRowsUpdated = propagated.normalizedRowsUpdated;
  }

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("Company source registry reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
