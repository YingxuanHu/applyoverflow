import { readFile } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  buildCompanyIndustryResolution,
  uniqueKnownIndustries,
  type CompanyIndustryResolution,
} from "@/lib/company-industry";
import { coerceNormalizedIndustry, type NormalizedIndustry } from "@/lib/job-metadata";

const DEFAULT_FILE = "data/company-industry-labeling-template-2026-06-01.csv";

type Args = {
  apply: boolean;
  file: string;
  batchSize: number;
  limit: number | null;
};

type CsvCompanyIndustryRow = {
  companyId: string | null;
  companyName: string;
  companyKey: string;
  domain: string | null;
  verifiedIndustries: NormalizedIndustry[];
  primaryIndustry: NormalizedIndustry | null;
};

type ImportItem = {
  row: CsvCompanyIndustryRow;
  resolution: CompanyIndustryResolution;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    file: DEFAULT_FILE,
    batchSize: 500,
    limit: null,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length).trim();
    } else if (arg.startsWith("--batch-size=")) {
      args.batchSize = Math.max(1, Number.parseInt(arg.slice("--batch-size=".length), 10));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(arg.slice("--limit=".length), 10));
    }
  }

  return args;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === "\"") {
        if (line[index + 1] === "\"") {
          current += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function splitCsvText(text: string) {
  return text.replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
}

function readCell(
  columns: string[],
  headerIndex: Map<string, number>,
  name: string
) {
  const index = headerIndex.get(name);
  if (index == null) return "";
  return (columns[index] ?? "").trim();
}

function readIndustryList(value: string) {
  return uniqueKnownIndustries(value.split(/[;|]/).map((entry) => entry.trim()));
}

async function loadCsvRows(filePath: string, limit: number | null) {
  const text = await readFile(filePath, "utf8");
  const lines = splitCsvText(text);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0] ?? "");
  const headerIndex = new Map(header.map((name, index) => [name, index]));
  const rows: CsvCompanyIndustryRow[] = [];

  for (const line of lines.slice(1)) {
    if (limit != null && rows.length >= limit) break;
    if (!line.trim()) continue;

    const columns = parseCsvLine(line);
    const verifiedIndustries = readIndustryList(
      readCell(columns, headerIndex, "verified_industry_codes_semicolon_separated")
    );
    const primaryIndustry = coerceNormalizedIndustry(
      readCell(columns, headerIndex, "primary_industry_code")
    );
    const usablePrimary = primaryIndustry === "UNKNOWN" ? null : primaryIndustry;
    const industries =
      verifiedIndustries.length > 0
        ? verifiedIndustries
        : usablePrimary
          ? [usablePrimary]
          : [];

    if (industries.length === 0) continue;

    rows.push({
      companyId: readCell(columns, headerIndex, "company_id") || null,
      companyName: readCell(columns, headerIndex, "company_name"),
      companyKey: readCell(columns, headerIndex, "company_key"),
      domain: readCell(columns, headerIndex, "domain") || null,
      verifiedIndustries: industries,
      primaryIndustry: usablePrimary ?? industries[0] ?? null,
    });
  }

  return rows;
}

async function updateCompanyBatch(items: ImportItem[]) {
  if (items.length === 0) return 0;

  const values = Prisma.join(
    items.map(({ row, resolution }) => Prisma.sql`(
      ${row.companyId}::text,
      ${row.companyKey}::text,
      ${row.domain}::text,
      ${row.companyName}::text,
      ${resolution.normalizedIndustry}::text,
      ${sqlTextArray(resolution.normalizedIndustries)},
      ${resolution.confidence}::double precision,
      ${resolution.source}::text
    )`)
  );

  return Number(await prisma.$executeRaw`
    UPDATE "Company" c
    SET
      "name" = COALESCE(NULLIF(values.company_name, ''), c."name"),
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustries" = values.normalized_industries,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "normalizedIndustrySource" = values.normalized_industry_source,
      "normalizedIndustryUpdatedAt" = NOW()
    FROM (VALUES ${values}) AS values(
      company_id,
      company_key,
      domain,
      company_name,
      normalized_industry,
      normalized_industries,
      normalized_industry_confidence,
      normalized_industry_source
    )
    WHERE (
        (values.company_id IS NOT NULL AND c.id = values.company_id)
        OR (values.company_id IS NULL AND values.company_key <> '' AND c."companyKey" = values.company_key)
        OR (values.company_id IS NULL AND values.company_key = '' AND values.domain IS NOT NULL AND c.domain = values.domain)
      )
      AND (
        c."name" IS DISTINCT FROM COALESCE(NULLIF(values.company_name, ''), c."name")
        OR
        c."normalizedIndustry" IS DISTINCT FROM values.normalized_industry
        OR c."normalizedIndustries" IS DISTINCT FROM values.normalized_industries
        OR c."normalizedIndustryConfidence" IS DISTINCT FROM values.normalized_industry_confidence
        OR c."normalizedIndustrySource" IS DISTINCT FROM values.normalized_industry_source
      )
  `);
}

function sqlTextArray(values: string[]) {
  if (values.length === 0) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`ARRAY[${Prisma.join(values.map((value) => Prisma.sql`${value}::text`))}]::text[]`;
}

async function propagateCompanyIndustriesToJobs() {
  const canonicalUpdated = Number(await prisma.$executeRaw`
    UPDATE "JobCanonical" jc
    SET
      "company" = c."name",
      "normalizedIndustry" = c."normalizedIndustry",
      "normalizedIndustries" = c."normalizedIndustries",
      "normalizedIndustryConfidence" = c."normalizedIndustryConfidence"
    FROM "Company" c
    WHERE jc."companyId" = c.id
      AND c."normalizedIndustrySource" = 'company_verified_csv'
      AND (
        jc."company" IS DISTINCT FROM c."name"
        OR jc."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jc."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
        OR jc."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
  `);

  const feedUpdated = Number(await prisma.$executeRaw`
    UPDATE "JobFeedIndex" jfi
    SET
      "company" = c."name",
      "normalizedIndustry" = c."normalizedIndustry",
      "normalizedIndustries" = c."normalizedIndustries",
      "normalizedIndustryConfidence" = c."normalizedIndustryConfidence",
      "indexedAt" = NOW()
    FROM "JobCanonical" jc
    JOIN "Company" c ON jc."companyId" = c.id
    WHERE jfi."canonicalJobId" = jc.id
      AND c."normalizedIndustrySource" = 'company_verified_csv'
      AND (
        jfi."company" IS DISTINCT FROM c."name"
        OR jfi."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jfi."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
        OR jfi."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
  `);

  const normalizedUpdated = Number(await prisma.$executeRaw`
    UPDATE "NormalizedJobRecord" njr
    SET
      "company" = c."name",
      "normalizedIndustry" = c."normalizedIndustry",
      "normalizedIndustries" = c."normalizedIndustries",
      "normalizedIndustryConfidence" = c."normalizedIndustryConfidence"
    FROM "Company" c
    WHERE njr."companyKey" = c."companyKey"
      AND c."normalizedIndustrySource" = 'company_verified_csv'
      AND (
        njr."company" IS DISTINCT FROM c."name"
        OR njr."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR njr."normalizedIndustries" IS DISTINCT FROM c."normalizedIndustries"
        OR njr."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
  `);

  return { canonicalUpdated, feedUpdated, normalizedUpdated };
}

function buildImportItems(rows: CsvCompanyIndustryRow[]) {
  return rows.map((row) => ({
    row,
    resolution: buildCompanyIndustryResolution({
      industries: row.verifiedIndustries,
      primaryIndustry: row.primaryIndustry,
      confidence: 0.99,
      source: "company_verified_csv",
      signals: ["company_industry_labeling_csv"],
    }),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  const rows = await loadCsvRows(filePath, args.limit);
  const items = buildImportItems(rows);
  const multiLabelCount = items.filter((item) => item.resolution.normalizedIndustries.length > 1).length;
  const industryCounts = new Map<string, number>();

  for (const item of items) {
    for (const industry of item.resolution.normalizedIndustries) {
      industryCounts.set(industry, (industryCounts.get(industry) ?? 0) + 1);
    }
  }

  console.log(
    `[company-industry-import] mode=${args.apply ? "apply" : "dry-run"} file=${args.file} rowsWithLabels=${items.length.toLocaleString()} multiLabelRows=${multiLabelCount.toLocaleString()}`
  );

  if (items.length === 0) {
    console.log(
      "[company-industry-import] No verified labels found. Fill verified_industry_codes_semicolon_separated or primary_industry_code, then rerun with --apply."
    );
    return;
  }

  console.log("[company-industry-import] label counts:");
  for (const [industry, count] of [...industryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${industry}: ${count.toLocaleString()}`);
  }

  if (!args.apply) return;

  let companyUpdated = 0;
  for (let start = 0; start < items.length; start += args.batchSize) {
    companyUpdated += await updateCompanyBatch(items.slice(start, start + args.batchSize));
  }
  const propagated = await propagateCompanyIndustriesToJobs();

  console.log(
    `[company-industry-import] companyUpdated=${companyUpdated.toLocaleString()} canonicalUpdated=${propagated.canonicalUpdated.toLocaleString()} feedUpdated=${propagated.feedUpdated.toLocaleString()} normalizedUpdated=${propagated.normalizedUpdated.toLocaleString()}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
