import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db";

type Args = {
  output: string;
  limit: number | null;
  minLiveJobs: number;
  fillSafeSuggestions: boolean;
};

type CandidateRow = {
  company_id: string;
  company_name: string;
  company_key: string;
  domain: string | null;
  careers_url: string | null;
  detected_ats: string | null;
  discovery_status: string;
  crawl_status: string;
  live_job_count: number;
  current_industry_code: string | null;
  current_industry_confidence: number | null;
  current_industry_source: string | null;
  current_industry_codes_semicolon_separated: string[];
};

const DEFAULT_OUTPUT = `data/company-industry-candidates-${new Date()
  .toISOString()
  .slice(0, 10)}.csv`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    output: DEFAULT_OUTPUT,
    limit: null,
    minLiveJobs: 1,
    fillSafeSuggestions: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length).trim();
    } else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(arg.slice("--limit=".length), 10));
    } else if (arg.startsWith("--min-live-jobs=")) {
      args.minLiveJobs = Math.max(
        0,
        Number.parseInt(arg.slice("--min-live-jobs=".length), 10)
      );
    } else if (arg === "--fill-safe-suggestions") {
      args.fillSafeSuggestions = true;
    }
  }

  return args;
}

function csvCell(value: unknown) {
  const text =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join(";")
        : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function safeSuggestedIndustries(row: CandidateRow) {
  const hasUsefulIndustry =
    row.current_industry_code != null &&
    row.current_industry_code !== "UNKNOWN" &&
    row.current_industry_code !== "OTHER_UNKNOWN" &&
    row.current_industry_confidence != null &&
    row.current_industry_confidence >= 0.9;

  if (!hasUsefulIndustry) return [];
  return row.current_industry_codes_semicolon_separated.length > 0
    ? row.current_industry_codes_semicolon_separated
    : [row.current_industry_code as string];
}

function evidenceNote(row: CandidateRow, suggestedIndustries: string[]) {
  if (suggestedIndustries.length === 0) {
    return "Needs manual company-industry research before importing as verified.";
  }

  return [
    `Suggested from ${row.current_industry_source ?? "unknown source"}`,
    `confidence=${row.current_industry_confidence ?? "unknown"}`,
    "Review before importing as company_verified_csv.",
  ].join("; ");
}

async function loadCandidates(args: Args) {
  const limitClause =
    args.limit == null ? "" : `LIMIT ${Number.isFinite(args.limit) ? args.limit : 0}`;

  return prisma.$queryRawUnsafe<CandidateRow[]>(`
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      c."companyKey" AS company_key,
      c.domain,
      c."careersUrl" AS careers_url,
      c."detectedAts" AS detected_ats,
      c."discoveryStatus"::text AS discovery_status,
      c."crawlStatus"::text AS crawl_status,
      COUNT(jc.id)::int AS live_job_count,
      c."normalizedIndustry" AS current_industry_code,
      c."normalizedIndustryConfidence" AS current_industry_confidence,
      c."normalizedIndustrySource" AS current_industry_source,
      c."normalizedIndustries" AS current_industry_codes_semicolon_separated
    FROM "Company" c
    LEFT JOIN "JobCanonical" jc
      ON jc."companyId" = c.id
     AND jc.status IN ('LIVE', 'AGING')
    WHERE COALESCE(c."normalizedIndustrySource", '') <> 'company_verified_csv'
    GROUP BY c.id
    HAVING COUNT(jc.id) >= ${args.minLiveJobs}
    ORDER BY live_job_count DESC, c."updatedAt" DESC, c.name ASC
    ${limitClause}
  `);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadCandidates(args);
  const header = [
    "company_id",
    "company_name",
    "company_key",
    "domain",
    "careers_url",
    "detected_ats",
    "discovery_status",
    "crawl_status",
    "live_job_count",
    "current_industry_code",
    "current_industry_confidence",
    "current_industry_source",
    "suggested_industry_codes_semicolon_separated",
    "suggested_primary_industry_code",
    "verified_industry_codes_semicolon_separated",
    "primary_industry_code",
    "evidence_url",
    "evidence_note",
  ];

  const lines = [csvRow(header)];
  let safeSuggestionCount = 0;

  for (const row of rows) {
    const suggestedIndustries = safeSuggestedIndustries(row);
    if (suggestedIndustries.length > 0) safeSuggestionCount += 1;
    const verifiedIndustries = args.fillSafeSuggestions ? suggestedIndustries : [];

    lines.push(
      csvRow([
        row.company_id,
        row.company_name,
        row.company_key,
        row.domain,
        row.careers_url,
        row.detected_ats,
        row.discovery_status,
        row.crawl_status,
        row.live_job_count,
        row.current_industry_code,
        row.current_industry_confidence,
        row.current_industry_source,
        suggestedIndustries,
        suggestedIndustries[0] ?? "",
        verifiedIndustries,
        verifiedIndustries[0] ?? "",
        row.careers_url ?? row.domain ?? "",
        evidenceNote(row, suggestedIndustries),
      ])
    );
  }

  const outputPath = path.resolve(process.cwd(), args.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        output: outputPath,
        exportedRows: rows.length,
        safeSuggestionRows: safeSuggestionCount,
        verifiedColumnsPrefilled: args.fillSafeSuggestions,
      },
      null,
      2
    )
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
