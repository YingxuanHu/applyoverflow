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
import { coerceNormalizedIndustry, type NormalizedIndustry } from "@/lib/job-metadata";
import { uniqueKnownIndustries } from "@/lib/company-industry";

const DEFAULT_FILE = "data/applyoverflow-source-registry-2026-06-04.csv";
const DEFAULT_OUT = "data/discovery/reports/company-source-registry-bulk-reconcile.json";
const BATCH_SIZE = 500;
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
  out: string;
  apply: boolean;
  limit: number | null;
  skipTasks: boolean;
  validationTaskLimit: number;
  discoveryTaskLimit: number;
  propagateJobs: boolean;
};

type RegistryRow = {
  lineNumber: number;
  companyName: string;
  companyKey: string;
  domain: string | null;
  careersUrlRaw: string;
  careersUrl: string | null;
  sourceMarker: string | null;
  detectedAts: string | null;
  normalizedIndustry: NormalizedIndustry;
  normalizedIndustries: NormalizedIndustry[];
};

type SourceInput = {
  companyKey: string;
  sourceName: string;
  connectorName: string;
  token: string;
  boardUrl: string;
  sourceType: string;
  extractionRoute: "ATS_NATIVE" | "UNKNOWN";
  parserVersion: string;
  priorityScore: number;
  sourceQualityScore: number;
  yieldScore: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: DEFAULT_FILE,
    out: DEFAULT_OUT,
    apply: false,
    limit: null,
    skipTasks: false,
    validationTaskLimit: 500,
    discoveryTaskLimit: 200,
    propagateJobs: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--apply") {
      args.apply = true;
      continue;
    }
    if (rawArg === "--skip-tasks") {
      args.skipTasks = true;
      continue;
    }
    if (rawArg === "--propagate-jobs") {
      args.propagateJobs = true;
      continue;
    }
    const [key, value] = rawArg.replace(/^--/, "").split("=");
    if (!value) continue;
    if (key === "file") args.file = value;
    if (key === "out") args.out = value;
    if (key === "limit") args.limit = Math.max(1, Number.parseInt(value, 10));
    if (key === "validation-task-limit") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) args.validationTaskLimit = parsed;
    }
    if (key === "discovery-task-limit") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) args.discoveryTaskLimit = parsed;
    }
  }

  return args;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
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

function isSourceMarker(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  return MARKER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeDomain(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || isSourceMarker(trimmed)) return null;
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function normalizeCompanyName(value: string) {
  return cleanCompanyName(value).replace(/\s{2,}/g, " ").trim();
}

function readIndustries(value: string, primary: NormalizedIndustry) {
  const fromList = uniqueKnownIndustries(value.split(/[;|]/).map((entry) => entry.trim()));
  if (fromList.length > 0) return fromList;
  return primary !== "UNKNOWN" ? [primary] : [];
}

function parseRegistryRows(content: string, limit: number | null) {
  const [header, ...records] = parseCsv(content);
  if (!header) return [];
  const headerIndex = new Map(header.map((name, index) => [name.trim(), index]));
  const rows: RegistryRow[] = [];

  for (let index = 0; index < records.length; index += 1) {
    if (limit != null && rows.length >= limit) break;
    const columns = records[index]!;
    const companyName = normalizeCompanyName(readCell(columns, headerIndex, "companyName"));
    if (!companyName) continue;
    const companyKey =
      readCell(columns, headerIndex, "companyKey") || buildCompanyKey(companyName);
    if (!companyKey) continue;

    const careersUrlRaw = readCell(columns, headerIndex, "careersUrl");
    const careersUrl = normalizeUrl(careersUrlRaw);
    const sourceMarker = !careersUrl && isSourceMarker(careersUrlRaw)
      ? careersUrlRaw.toUpperCase()
      : null;
    const primary =
      coerceNormalizedIndustry(readCell(columns, headerIndex, "primaryIndustry")) ?? "UNKNOWN";
    const normalizedIndustries = readIndustries(
      readCell(columns, headerIndex, "industries"),
      primary
    );

    rows.push({
      lineNumber: index + 2,
      companyName,
      companyKey,
      domain: normalizeDomain(readCell(columns, headerIndex, "domain")),
      careersUrlRaw,
      careersUrl,
      sourceMarker,
      detectedAts: readCell(columns, headerIndex, "detectedAts") || null,
      normalizedIndustry: primary,
      normalizedIndustries,
    });
  }

  return [...new Map(rows.map((row) => [row.companyKey, row])).values()];
}

function markerSourceState(marker: string) {
  if (/INVALID|NOT_FOUND|UNAVAILABLE|NO_VERIFIED|NOT_COMPANY_ROW/i.test(marker)) {
    return {
      status: "DISABLED" as const,
      validationState: "INVALID" as const,
      pollState: "DISABLED" as const,
    };
  }
  if (/BLOCKED/i.test(marker)) {
    return {
      status: "DISABLED" as const,
      validationState: "BLOCKED" as const,
      pollState: "DISABLED" as const,
    };
  }
  return {
    status: "REDISCOVER_REQUIRED" as const,
    validationState: "NEEDS_REDISCOVERY" as const,
    pollState: "QUARANTINED" as const,
  };
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sqlTextArray(values: string[]) {
  if (values.length === 0) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}::text`))}]::text[]`;
}

async function buildSourceInputsAsync(rows: RegistryRow[]) {
  const inputs = new Map<string, SourceInput>();

  for (const row of rows) {
    if (!row.careersUrl) continue;
    const discovery = await discoverSourceCandidatesFromUrls([row.careersUrl]);
    if (discovery.candidates.length > 0) {
      for (const candidate of discovery.candidates) {
        const sourceName = buildDiscoveredSourceName(candidate.connectorName, candidate.token);
        inputs.set(sourceName, {
          companyKey: row.companyKey,
          sourceName,
          connectorName: candidate.connectorName,
          token: candidate.token,
          boardUrl: candidate.boardUrl,
          sourceType: "ATS",
          extractionRoute: "ATS_NATIVE",
          parserVersion: "source-registry-bulk-import:v1",
          priorityScore: 1.08,
          sourceQualityScore: 0.86,
          yieldScore: 0.62,
        });
      }
      continue;
    }

    const sourceName = `CompanyHtml:${row.companyKey}`;
    inputs.set(sourceName, {
      companyKey: row.companyKey,
      sourceName,
      connectorName: "company-site",
      token: row.companyKey,
      boardUrl: row.careersUrl,
      sourceType: "COMPANY_HTML",
      extractionRoute: "UNKNOWN",
      parserVersion: "source-registry-bulk-import:v1",
      priorityScore: 0.78,
      sourceQualityScore: 0.48,
      yieldScore: 0.3,
    });
  }

  return [...inputs.values()];
}

async function bulkCreateCompanies(rows: RegistryRow[], now: Date) {
  let created = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const result = await prisma.company.createMany({
      data: batch.map((row) => {
        const hasIndustry = row.normalizedIndustries.length > 0;
        return {
          name: row.companyName,
          companyKey: row.companyKey,
          domain: row.domain,
          careersUrl: row.careersUrl,
          detectedAts: row.detectedAts,
          discoveryStatus: row.careersUrl ? "DISCOVERED" : "PENDING",
          crawlStatus: "IDLE",
          discoveryConfidence: row.careersUrl ? 0.9 : 0.25,
          metadataJson: {
            sourceRegistryImport: {
              importedAt: now.toISOString(),
              lineNumber: row.lineNumber,
              careersUrlRaw: row.careersUrlRaw,
              sourceMarker: row.sourceMarker,
              sourceFileFormat: "visible-company-source-summary",
            },
            verifiedIndustryCodes: row.normalizedIndustries,
            primaryIndustryCode: row.normalizedIndustry,
          },
          normalizedIndustry: row.normalizedIndustry,
          normalizedIndustries: row.normalizedIndustries,
          normalizedIndustryConfidence: hasIndustry ? 0.99 : 0.2,
          normalizedIndustrySource: hasIndustry
            ? "company_verified_csv"
            : "unknown_company_industry",
          normalizedIndustryUpdatedAt: now,
        };
      }),
      skipDuplicates: true,
    });
    created += result.count;
  }
  return created;
}

async function bulkUpdateCompanies(rows: RegistryRow[], now: Date) {
  let updated = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const values = Prisma.join(
      batch.map((row) => {
        const hasIndustry = row.normalizedIndustries.length > 0;
        return Prisma.sql`(
          ${row.companyKey}::text,
          ${row.companyName}::text,
          ${row.domain}::text,
          ${row.careersUrl}::text,
          ${row.detectedAts}::text,
          ${row.careersUrl ? "DISCOVERED" : "PENDING"}::"CompanyDiscoveryStatus",
          ${row.careersUrl ? 0.95 : 0.25}::double precision,
          ${row.normalizedIndustry}::text,
          ${sqlTextArray(row.normalizedIndustries)},
          ${hasIndustry ? 0.99 : 0.2}::double precision,
          ${hasIndustry ? "company_verified_csv" : "unknown_company_industry"}::text,
          ${JSON.stringify({
            sourceRegistryImport: {
              importedAt: now.toISOString(),
              lineNumber: row.lineNumber,
              careersUrlRaw: row.careersUrlRaw,
              sourceMarker: row.sourceMarker,
              sourceFileFormat: "visible-company-source-summary",
            },
            verifiedIndustryCodes: row.normalizedIndustries,
            primaryIndustryCode: row.normalizedIndustry,
          })}::jsonb
        )`;
      })
    );
    updated += Number(await prisma.$executeRaw`
      UPDATE "Company" c
      SET
        name = v.name,
        domain = v.domain,
        "careersUrl" = v.careers_url,
        "detectedAts" = v.detected_ats,
        "discoveryStatus" = v.discovery_status,
        "crawlStatus" = 'IDLE',
        "discoveryConfidence" = GREATEST(c."discoveryConfidence", v.discovery_confidence),
        "metadataJson" = COALESCE(c."metadataJson"::jsonb, '{}'::jsonb) || v.metadata_json,
        "normalizedIndustry" = v.normalized_industry,
        "normalizedIndustries" = v.normalized_industries,
        "normalizedIndustryConfidence" = v.normalized_industry_confidence,
        "normalizedIndustrySource" = v.normalized_industry_source,
        "normalizedIndustryUpdatedAt" = ${now}
      FROM (VALUES ${values}) AS v(
        company_key,
        name,
        domain,
        careers_url,
        detected_ats,
        discovery_status,
        discovery_confidence,
        normalized_industry,
        normalized_industries,
        normalized_industry_confidence,
        normalized_industry_source,
        metadata_json
      )
      WHERE c."companyKey" = v.company_key
    `);
  }
  return updated;
}

async function loadCompanyIds(rows: RegistryRow[]) {
  const companies = await prisma.company.findMany({
    where: { companyKey: { in: rows.map((row) => row.companyKey) } },
    select: { id: true, companyKey: true },
  });
  return new Map(companies.map((company) => [company.companyKey, company.id]));
}

async function bulkUpsertSources(sourceInputs: SourceInput[], companiesByKey: Map<string, string>, now: Date) {
  const rows = sourceInputs
    .map((source) => {
      const companyId = companiesByKey.get(source.companyKey);
      if (!companyId) return null;
      return { ...source, companyId };
    })
    .filter((source): source is SourceInput & { companyId: string } => Boolean(source));

  let created = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const result = await prisma.companySource.createMany({
      data: batch.map((source) => ({
        companyId: source.companyId,
        sourceName: source.sourceName,
        connectorName: source.connectorName,
        token: source.token,
        boardUrl: source.boardUrl,
        status: "PROVISIONED",
        validationState: "UNVALIDATED",
        pollState: "READY",
        sourceType: source.sourceType,
        extractionRoute: source.extractionRoute,
        parserVersion: source.parserVersion,
        pollingCadenceMinutes: source.sourceType === "ATS" ? 180 : 360,
        priorityScore: source.priorityScore,
        sourceQualityScore: source.sourceQualityScore,
        yieldScore: source.yieldScore,
        firstSeenAt: now,
        lastProvisionedAt: now,
        lastDiscoveryAt: now,
        metadataJson: {
          importSource: "applyoverflow_source_registry",
          sourceRegistryCompanyKey: source.companyKey,
        },
      })),
      skipDuplicates: true,
    });
    created += result.count;

    const values = Prisma.join(
      batch.map((source) => Prisma.sql`(
        ${source.sourceName}::text,
        ${source.companyId}::text,
        ${source.connectorName}::text,
        ${source.token}::text,
        ${source.boardUrl}::text,
        ${source.sourceType}::text,
        ${source.extractionRoute}::"ExtractionRouteKind",
        ${source.parserVersion}::text,
        ${source.sourceType === "ATS" ? 180 : 360}::int,
        ${source.priorityScore}::double precision,
        ${source.sourceQualityScore}::double precision,
        ${source.yieldScore}::double precision
      )`)
    );
    await prisma.$executeRaw`
      UPDATE "CompanySource" cs
      SET
        "boardUrl" = v.board_url,
        status = 'PROVISIONED',
        "validationState" = 'UNVALIDATED',
        "pollState" = 'READY',
        "sourceType" = v.source_type,
        "extractionRoute" = v.extraction_route,
        "parserVersion" = v.parser_version,
        "pollingCadenceMinutes" = v.polling_cadence_minutes,
        "priorityScore" = v.priority_score,
        "sourceQualityScore" = v.source_quality_score,
        "yieldScore" = v.yield_score,
        "lastProvisionedAt" = ${now},
        "lastDiscoveryAt" = ${now},
        "lastValidatedAt" = NULL,
        "lastHttpStatus" = NULL,
        "consecutiveFailures" = 0,
        "failureStreak" = 0,
        "validationMessage" = NULL
      FROM (VALUES ${values}) AS v(
        source_name,
        company_id,
        connector_name,
        token,
        board_url,
        source_type,
        extraction_route,
        parser_version,
        polling_cadence_minutes,
        priority_score,
        source_quality_score,
        yield_score
      )
      WHERE cs."sourceName" = v.source_name
    `;
  }

  const sourceRows = await prisma.companySource.findMany({
    where: { sourceName: { in: rows.map((row) => row.sourceName) } },
    select: { id: true, companyId: true, sourceName: true, connectorName: true },
  });

  return { created, updated: rows.length - created, sourceRows };
}

async function bulkCreateTasks(input: {
  sourceRows: Array<{ id: string; companyId: string; sourceName: string; connectorName: string }>;
  companySiteRows: Array<{ companyId: string; careersUrl: string }>;
  now: Date;
  validationTaskLimit: number;
  discoveryTaskLimit: number;
}) {
  let validationTasks = 0;
  let discoveryTasks = 0;
  for (const batch of chunk(input.sourceRows.slice(0, input.validationTaskLimit), BATCH_SIZE)) {
    const result = await prisma.sourceTask.createMany({
      data: batch.map((source) => ({
        kind: "SOURCE_VALIDATION",
        companyId: source.companyId,
        companySourceId: source.id,
        priorityScore: source.connectorName === "company-site" ? 72 : 98,
        notBeforeAt: input.now,
        payloadJson: {
          origin: "source_registry_bulk_import",
          sourceName: source.sourceName,
        },
      })),
    });
    validationTasks += result.count;
  }

  for (const batch of chunk(input.companySiteRows.slice(0, input.discoveryTaskLimit), BATCH_SIZE)) {
    const result = await prisma.sourceTask.createMany({
      data: batch.map((row) => ({
        kind: "COMPANY_DISCOVERY",
        companyId: row.companyId,
        priorityScore: 58,
        notBeforeAt: input.now,
        payloadJson: {
          origin: "source_registry_bulk_import",
          careersUrl: row.careersUrl,
        },
      })),
    });
    discoveryTasks += result.count;
  }

  return { validationTasks, discoveryTasks };
}

async function disableMarkedSources(rows: RegistryRow[], companiesByKey: Map<string, string>, now: Date) {
  let disabled = 0;
  let quarantined = 0;
  for (const [stateKey, stateRows] of groupBy(rows.filter((row) => row.sourceMarker), (row) => {
    const state = markerSourceState(row.sourceMarker ?? "");
    return `${state.status}|${state.validationState}|${state.pollState}`;
  }).entries()) {
    const [status, validationState, pollState] = stateKey.split("|");
    const companyIds = stateRows
      .map((row) => companiesByKey.get(row.companyKey))
      .filter((value): value is string => Boolean(value));
    for (const ids of chunk(companyIds, BATCH_SIZE)) {
      const result = await prisma.companySource.updateMany({
        where: { companyId: { in: ids } },
        data: {
          status: status as never,
          validationState: validationState as never,
          pollState: pollState as never,
          validationMessage: "Disabled or quarantined by source registry marker.",
          lastFailureAt: now,
        },
      });
      if (pollState === "DISABLED") disabled += result.count;
      else quarantined += result.count;
    }
  }
  return { disabled, quarantined };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }
  return grouped;
}

async function propagateCompaniesToJobs(companyIds: string[]) {
  let canonicalUpdated = 0;
  let feedUpdated = 0;
  let normalizedUpdated = 0;
  for (const ids of chunk(companyIds, BATCH_SIZE)) {
    canonicalUpdated += Number(await prisma.$executeRaw`
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

    feedUpdated += Number(await prisma.$executeRaw`
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

    normalizedUpdated += Number(await prisma.$executeRaw`
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
  return { canonicalUpdated, feedUpdated, normalizedUpdated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  const rows = parseRegistryRows(await readFile(filePath, "utf8"), args.limit);
  const validRows = rows.filter((row) => row.careersUrl);
  const markedRows = rows.filter((row) => row.sourceMarker);
  const sourceInputs = await buildSourceInputsAsync(validRows);
  const connectorCounts = groupBy(sourceInputs, (source) => source.connectorName);
  const markerCounts = groupBy(markedRows, (row) => row.sourceMarker ?? "UNKNOWN");
  const now = new Date();

  const report = {
    generatedAt: now.toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    file: filePath,
    rowsRead: rows.length,
    validUrlRows: validRows.length,
    markedRows: markedRows.length,
    companyIndustryRows: rows.filter((row) => row.normalizedIndustries.length > 0).length,
    sourceInputs: sourceInputs.length,
    countsByConnector: Object.fromEntries([...connectorCounts.entries()].map(([key, value]) => [key, value.length])),
    countsByMarker: Object.fromEntries([...markerCounts.entries()].map(([key, value]) => [key, value.length])),
    skipTasks: args.skipTasks,
    validationTaskLimit: args.validationTaskLimit,
    discoveryTaskLimit: args.discoveryTaskLimit,
    propagateJobs: args.propagateJobs,
    companiesCreated: 0,
    companiesUpdated: 0,
    sourcesCreated: 0,
    sourcesUpdated: 0,
    markerSourcesDisabled: 0,
    markerSourcesQuarantined: 0,
    validationTasksQueued: 0,
    discoveryTasksQueued: 0,
    canonicalJobsUpdated: 0,
    feedRowsUpdated: 0,
    normalizedRowsUpdated: 0,
  };

  if (!args.apply) {
    await writeReport(args.out, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const existingBefore = await prisma.company.count({
    where: { companyKey: { in: rows.map((row) => row.companyKey) } },
  });
  report.companiesCreated = await bulkCreateCompanies(rows, now);
  report.companiesUpdated = await bulkUpdateCompanies(rows, now);
  const companiesByKey = await loadCompanyIds(rows);
  const sourceResult = await bulkUpsertSources(sourceInputs, companiesByKey, now);
  report.sourcesCreated = sourceResult.created;
  report.sourcesUpdated = sourceResult.updated;
  const markerResult = await disableMarkedSources(markedRows, companiesByKey, now);
  report.markerSourcesDisabled = markerResult.disabled;
  report.markerSourcesQuarantined = markerResult.quarantined;
  const companySiteTaskRows = sourceInputs
    .filter((source) => source.connectorName === "company-site")
    .map((source) => ({
      companyId: companiesByKey.get(source.companyKey),
      careersUrl: source.boardUrl,
    }))
    .filter((row): row is { companyId: string; careersUrl: string } => Boolean(row.companyId));
  if (!args.skipTasks) {
    const tasks = await bulkCreateTasks({
      sourceRows: sourceResult.sourceRows,
      companySiteRows: companySiteTaskRows,
      now,
      validationTaskLimit: args.validationTaskLimit,
      discoveryTaskLimit: args.discoveryTaskLimit,
    });
    report.validationTasksQueued = tasks.validationTasks;
    report.discoveryTasksQueued = tasks.discoveryTasks;
  }
  if (args.propagateJobs) {
    const propagated = await propagateCompaniesToJobs([...companiesByKey.values()]);
    report.canonicalJobsUpdated = propagated.canonicalUpdated;
    report.feedRowsUpdated = propagated.feedUpdated;
    report.normalizedRowsUpdated = propagated.normalizedUpdated;
  }
  report.companiesUpdated = Math.max(report.companiesUpdated, existingBefore);

  await writeReport(args.out, report);
  console.log(JSON.stringify(report, null, 2));
}

async function writeReport(out: string, report: unknown) {
  const outPath = path.resolve(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main()
  .catch((error) => {
    console.error("Bulk company source registry reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
