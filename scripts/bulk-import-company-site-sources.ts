import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  buildCompanyKey,
  cleanCompanyName,
} from "../src/lib/ingestion/discovery/company-corpus";

const DEFAULT_CADENCE_MINUTES = 360;
const BATCH_SIZE = 500;
const ACTIVE_TASK_STATUSES = ["PENDING", "RUNNING"] as const;

type CsvRow = {
  companyName: string;
  careersUrl: string;
  atsVendor: string | null;
  lineNumber: number;
};

type PreparedRow = {
  companyName: string;
  companyKey: string;
  careersUrl: string;
  atsVendor: string;
};

type Summary = {
  file: string;
  totalRows: number;
  acceptedRows: number;
  skippedRows: number;
  companiesCreated: number;
  sourcesCreated: number;
  validationTasksCreated: number;
  discoveryTasksCreated: number;
};

function parseArgs(argv: string[]) {
  let file: string | null = null;

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      file = arg;
      continue;
    }

    const [rawKey, value] = arg.replace(/^--/, "").split("=");
    if (rawKey === "file" && value) {
      file = value;
    }
  }

  if (!file) {
    throw new Error("Missing CSV file. Use --file=/path/to/accepted.csv");
  }

  return { file: path.resolve(file) };
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
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

function findHeaderIndex(header: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const index = header.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function parseRows(content: string): CsvRow[] {
  const [header, ...dataRows] = parseCsv(content);
  if (!header) return [];

  const normalizedHeader = header.map((value) => value.trim().toLowerCase());
  const companyNameIndex = findHeaderIndex(normalizedHeader, [
    "company_name",
    "company name",
    "companyname",
  ]);
  const careersUrlIndex = findHeaderIndex(normalizedHeader, [
    "careers_url",
    "careers url",
    "careersurl",
    "company_careers_url",
    "company careers url",
    "companycareersurl",
  ]);
  const atsVendorIndex = findHeaderIndex(normalizedHeader, [
    "ats_vendor",
    "ats vendor",
    "atsvendor",
    "detected_ats",
    "detected ats",
    "detectedats",
  ]);

  if (companyNameIndex < 0 || careersUrlIndex < 0) {
    throw new Error("Expected company_name and careers_url columns.");
  }

  return dataRows.map((row, rowIndex) => ({
    companyName: (row[companyNameIndex] ?? "").trim(),
    careersUrl: (row[careersUrlIndex] ?? "").trim(),
    atsVendor:
      atsVendorIndex >= 0 ? (row[atsVendorIndex] ?? "").trim() || null : null,
    lineNumber: rowIndex + 2,
  }));
}

function normalizeUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeImportedCompanyName(value: string) {
  return cleanCompanyName(value.replace(/\s*-\s*expansion\s+\d+\s*$/i, ""));
}

function prepareRows(rows: CsvRow[]) {
  const seen = new Set<string>();
  const prepared: PreparedRow[] = [];

  for (const row of rows) {
    const companyName = normalizeImportedCompanyName(row.companyName);
    const careersUrl = normalizeUrl(row.careersUrl);
    if (!companyName || !careersUrl) continue;

    const companyKey = buildCompanyKey(companyName);
    const dedupeKey = `${companyKey}|${careersUrl}`;
    if (!companyKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    prepared.push({
      companyName,
      companyKey,
      careersUrl,
      atsVendor: row.atsVendor?.trim().toLowerCase() || "company-site",
    });
  }

  return prepared;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  const rows = parseRows(await readFile(file, "utf8"));
  const prepared = prepareRows(rows);
  const now = new Date();
  const summary: Summary = {
    file,
    totalRows: rows.length,
    acceptedRows: prepared.length,
    skippedRows: rows.length - prepared.length,
    companiesCreated: 0,
    sourcesCreated: 0,
    validationTasksCreated: 0,
    discoveryTasksCreated: 0,
  };

  for (const batch of chunk(prepared, BATCH_SIZE)) {
    const created = await prisma.company.createMany({
      data: batch.map((row) => ({
        name: row.companyName,
        companyKey: row.companyKey,
        careersUrl: row.careersUrl,
        detectedAts: "company-site",
        discoveryStatus: "PENDING",
        crawlStatus: "IDLE",
        discoveryConfidence: 0.6,
        metadataJson: {
          seedSource: "csv-job-board-seed",
          seedFile: path.basename(file),
          importedAt: now.toISOString(),
          sourceCareerUrls: [row.careersUrl],
          csvVendors: [row.atsVendor],
        },
      })),
      skipDuplicates: true,
    });
    summary.companiesCreated += created.count;
  }

  const companiesByKey = new Map<string, { id: string; companyKey: string }>();
  for (const keys of chunk(prepared.map((row) => row.companyKey), BATCH_SIZE)) {
    const companies = await prisma.company.findMany({
      where: { companyKey: { in: keys } },
      select: { id: true, companyKey: true },
    });
    for (const company of companies) {
      companiesByKey.set(company.companyKey, company);
    }
  }

  const sourceInputs = prepared
    .map((row) => {
      const company = companiesByKey.get(row.companyKey);
      if (!company) return null;

      return {
        companyId: company.id,
        sourceName: `CompanyHtml:${row.companyKey}`,
        connectorName: "company-site",
        token: row.companyKey,
        boardUrl: row.careersUrl,
        status: "PROVISIONED" as const,
        validationState: "UNVALIDATED" as const,
        pollState: "READY" as const,
        sourceType: "COMPANY_HTML",
        extractionRoute: "HTML_FALLBACK" as const,
        parserVersion: "csv-import:fast-company-site:v1",
        pollingCadenceMinutes: DEFAULT_CADENCE_MINUTES,
        priorityScore: 0.72,
        sourceQualityScore: 0.48,
        yieldScore: 0.312,
        firstSeenAt: now,
        lastProvisionedAt: now,
        lastDiscoveryAt: now,
        metadataJson: {
          importSource: "csv-seed",
          importFamily: "company-site",
          csvVendors: [row.atsVendor],
          careerPageUrls: [row.careersUrl],
          seedPageUrl: row.careersUrl,
          deferredInspection: true,
        } satisfies Prisma.InputJsonValue,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const existingSourcesByKey = new Map<string, { id: string; companyId: string }>();
  for (const batch of chunk(sourceInputs, BATCH_SIZE)) {
    const existing = await prisma.companySource.findMany({
      where: {
        OR: [
          { sourceName: { in: batch.map((source) => source.sourceName) } },
          {
            connectorName: "company-site",
            token: { in: batch.map((source) => source.token) },
          },
        ],
      },
      select: { id: true, companyId: true, sourceName: true, token: true },
    });
    for (const source of existing) {
      existingSourcesByKey.set(source.sourceName, source);
      existingSourcesByKey.set(`company-site:${source.token}`, source);
    }
  }

  const sourcesToCreate = sourceInputs.filter(
    (source) =>
      !existingSourcesByKey.has(source.sourceName) &&
      !existingSourcesByKey.has(`company-site:${source.token}`)
  );

  for (const batch of chunk(sourcesToCreate, BATCH_SIZE)) {
    const created = await prisma.companySource.createMany({
      data: batch,
      skipDuplicates: true,
    });
    summary.sourcesCreated += created.count;
  }

  const companySourcesByName = new Map<
    string,
    { id: string; companyId: string; sourceName: string; token: string }
  >();
  for (const batch of chunk(sourceInputs, BATCH_SIZE)) {
    const sources = await prisma.companySource.findMany({
      where: {
        OR: [
          { sourceName: { in: batch.map((source) => source.sourceName) } },
          {
            connectorName: "company-site",
            token: { in: batch.map((source) => source.token) },
          },
        ],
      },
      select: { id: true, companyId: true, sourceName: true, token: true },
    });
    for (const source of sources) {
      companySourcesByName.set(source.sourceName, source);
      companySourcesByName.set(`company-site:${source.token}`, source);
    }
  }

  const allSources = sourceInputs
    .map((source) =>
      companySourcesByName.get(source.sourceName) ??
      companySourcesByName.get(`company-site:${source.token}`) ??
      null
    )
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const existingValidationTaskSourceIds = new Set<string>();
  const existingDiscoveryTaskCompanyIds = new Set<string>();
  for (const batch of chunk(allSources, BATCH_SIZE)) {
    const validationTasks = await prisma.sourceTask.findMany({
      where: {
        kind: "SOURCE_VALIDATION",
        status: { in: [...ACTIVE_TASK_STATUSES] },
        companySourceId: { in: batch.map((source) => source.id) },
      },
      select: { companySourceId: true },
    });
    for (const task of validationTasks) {
      if (task.companySourceId) existingValidationTaskSourceIds.add(task.companySourceId);
    }

    const discoveryTasks = await prisma.sourceTask.findMany({
      where: {
        kind: "COMPANY_DISCOVERY",
        status: { in: [...ACTIVE_TASK_STATUSES] },
        companyId: { in: batch.map((source) => source.companyId) },
        companySourceId: null,
        canonicalJobId: null,
      },
      select: { companyId: true },
    });
    for (const task of discoveryTasks) {
      if (task.companyId) existingDiscoveryTaskCompanyIds.add(task.companyId);
    }
  }

  const validationTasksToCreate = allSources
    .filter((source) => !existingValidationTaskSourceIds.has(source.id))
    .map((source) => ({
      kind: "SOURCE_VALIDATION" as const,
      status: "PENDING" as const,
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: 78,
      notBeforeAt: now,
      payloadJson: {
        origin: "csv_seed_import_company_site",
        sourceName: source.sourceName,
      } satisfies Prisma.InputJsonValue,
    }));

  for (const batch of chunk(validationTasksToCreate, BATCH_SIZE)) {
    const created = await prisma.sourceTask.createMany({ data: batch });
    summary.validationTasksCreated += created.count;
  }

  const discoveryTasksToCreate = allSources
    .filter((source) => !existingDiscoveryTaskCompanyIds.has(source.companyId))
    .map((source) => ({
      kind: "COMPANY_DISCOVERY" as const,
      status: "PENDING" as const,
      companyId: source.companyId,
      priorityScore: 55,
      notBeforeAt: now,
      payloadJson: {
        origin: "csv_seed_import_fast_company_site",
      } satisfies Prisma.InputJsonValue,
    }));

  for (const batch of chunk(discoveryTasksToCreate, BATCH_SIZE)) {
    const created = await prisma.sourceTask.createMany({ data: batch });
    summary.discoveryTasksCreated += created.count;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("[bulk-import-company-site-sources] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
