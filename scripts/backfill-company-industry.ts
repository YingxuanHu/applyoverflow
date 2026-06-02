import { prisma } from "@/lib/db";
import {
  resolveCompanyIndustry,
  type CompanyIndustryResolution,
} from "@/lib/company-industry";
import { Prisma } from "@/generated/prisma/client";

type Args = {
  apply: boolean;
  batchSize: number;
  limit: number | null;
  company: string | null;
  companiesOnly: boolean;
  jobsOnly: boolean;
  safeOnly: boolean;
};

type CompanyForIndustryBackfill = {
  id: string;
  name: string;
  companyKey: string;
  domain: string | null;
  metadataJson: Prisma.JsonValue | null;
  normalizedIndustry: string | null;
  normalizedIndustryConfidence: number | null;
  normalizedIndustrySource: string | null;
};

type ResolvedCompanyIndustry = {
  company: CompanyForIndustryBackfill;
  industry: CompanyIndustryResolution;
};

type JobIndustryRow = {
  id: string;
  normalizedIndustry: string;
  normalizedIndustryConfidence: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    batchSize: 500,
    limit: null,
    company: null,
    companiesOnly: false,
    jobsOnly: false,
    safeOnly: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg.startsWith("--batch-size=")) {
      args.batchSize = Math.max(1, Number.parseInt(arg.slice("--batch-size=".length), 10));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(arg.slice("--limit=".length), 10));
    } else if (arg.startsWith("--company=")) {
      args.company = arg.slice("--company=".length).trim();
    } else if (arg === "--companies-only") {
      args.companiesOnly = true;
    } else if (arg === "--jobs-only") {
      args.jobsOnly = true;
    } else if (arg === "--safe-only") {
      args.safeOnly = true;
    }
  }

  return args;
}

function differs(company: CompanyForIndustryBackfill, industry: CompanyIndustryResolution) {
  return (
    company.normalizedIndustry !== industry.normalizedIndustry ||
    company.normalizedIndustryConfidence !== industry.confidence ||
    company.normalizedIndustrySource !== industry.source
  );
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printMap(title: string, map: Map<string, number>) {
  console.log(`\n${title}`);
  for (const [key, value] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${value.toLocaleString()}`);
  }
}

async function updateCompanyIndustryBatch(items: ResolvedCompanyIndustry[]) {
  if (items.length === 0) return 0;

  const values = Prisma.join(
    items.map(({ company, industry }) => Prisma.sql`(
      ${company.id}::text,
      ${industry.normalizedIndustry}::text,
      ${industry.confidence}::double precision,
      ${industry.source}::text
    )`)
  );

  return Number(await prisma.$executeRaw`
    UPDATE "Company" c
    SET
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "normalizedIndustrySource" = values.normalized_industry_source,
      "normalizedIndustryUpdatedAt" = NOW()
    FROM (VALUES ${values}) AS values(
      id,
      normalized_industry,
      normalized_industry_confidence,
      normalized_industry_source
    )
    WHERE c.id = values.id
      AND (
        c."normalizedIndustry" IS DISTINCT FROM values.normalized_industry
        OR c."normalizedIndustryConfidence" IS DISTINCT FROM values.normalized_industry_confidence
        OR c."normalizedIndustrySource" IS DISTINCT FROM values.normalized_industry_source
      )
  `);
}

async function updateJobIndustryBatch(items: ResolvedCompanyIndustry[]) {
  if (items.length === 0) return { canonicalUpdated: 0, feedUpdated: 0 };
  const companyIds = Prisma.join(items.map(({ company }) => company.id));

  const canonicalUpdated = Number(await prisma.$executeRaw`
    UPDATE "JobCanonical" jc
    SET
      "normalizedIndustry" = c."normalizedIndustry",
      "normalizedIndustryConfidence" = c."normalizedIndustryConfidence"
    FROM "Company" c
    WHERE c.id IN (${companyIds})
      AND jc."companyId" = c.id
      AND (
        jc."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jc."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
  `);

  const feedUpdated = Number(await prisma.$executeRaw`
    UPDATE "JobFeedIndex" jfi
    SET
      "normalizedIndustry" = c."normalizedIndustry",
      "normalizedIndustryConfidence" = c."normalizedIndustryConfidence",
      "indexedAt" = NOW()
    FROM "JobCanonical" jc
    JOIN "Company" c ON jc."companyId" = c.id
    WHERE jfi."canonicalJobId" = jc.id
      AND c.id IN (${companyIds})
      AND (
        jfi."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jfi."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
  `);

  return { canonicalUpdated, feedUpdated };
}

function buildJobIndustryValues(rows: JobIndustryRow[]) {
  return Prisma.join(
    rows.map((row) => Prisma.sql`(
      ${row.id}::text,
      ${row.normalizedIndustry}::text,
      ${row.normalizedIndustryConfidence}::double precision
    )`)
  );
}

async function updateCanonicalJobIndustryRows(rows: JobIndustryRow[]) {
  if (rows.length === 0) return 0;
  const values = buildJobIndustryValues(rows);
  return Number(await prisma.$executeRaw`
    UPDATE "JobCanonical" jc
    SET
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence
    FROM (VALUES ${values}) AS values(
      id,
      normalized_industry,
      normalized_industry_confidence
    )
    WHERE jc.id = values.id
      AND (
        jc."normalizedIndustry" IS DISTINCT FROM values.normalized_industry
        OR jc."normalizedIndustryConfidence" IS DISTINCT FROM values.normalized_industry_confidence
      )
  `);
}

async function updateFeedJobIndustryRows(rows: JobIndustryRow[]) {
  if (rows.length === 0) return 0;
  const values = buildJobIndustryValues(rows);
  return Number(await prisma.$executeRaw`
    UPDATE "JobFeedIndex" jfi
    SET
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "indexedAt" = NOW()
    FROM (VALUES ${values}) AS values(
      id,
      normalized_industry,
      normalized_industry_confidence
    )
    WHERE jfi."canonicalJobId" = values.id
      AND (
        jfi."normalizedIndustry" IS DISTINCT FROM values.normalized_industry
        OR jfi."normalizedIndustryConfidence" IS DISTINCT FROM values.normalized_industry_confidence
      )
  `);
}

async function selectCanonicalJobIndustryRows(take: number, safeOnly: boolean) {
  return prisma.$queryRaw<JobIndustryRow[]>`
    SELECT
      jc.id,
      c."normalizedIndustry",
      c."normalizedIndustryConfidence"
    FROM "JobCanonical" jc
    JOIN "Company" c ON jc."companyId" = c.id
    WHERE c."normalizedIndustry" IS NOT NULL
      AND c."normalizedIndustryConfidence" IS NOT NULL
      AND (${safeOnly} = false OR (
        c."normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
        AND c."normalizedIndustryConfidence" >= 0.9
      ))
      AND (
        jc."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jc."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
    ORDER BY jc.id
    LIMIT ${take}
  `;
}

async function selectFeedJobIndustryRows(take: number, safeOnly: boolean) {
  return prisma.$queryRaw<JobIndustryRow[]>`
    SELECT
      jfi."canonicalJobId" AS id,
      c."normalizedIndustry",
      c."normalizedIndustryConfidence"
    FROM "JobFeedIndex" jfi
    JOIN "JobCanonical" jc ON jfi."canonicalJobId" = jc.id
    JOIN "Company" c ON jc."companyId" = c.id
    WHERE c."normalizedIndustry" IS NOT NULL
      AND c."normalizedIndustryConfidence" IS NOT NULL
      AND (${safeOnly} = false OR (
        c."normalizedIndustry" NOT IN ('UNKNOWN', 'OTHER_UNKNOWN')
        AND c."normalizedIndustryConfidence" >= 0.9
      ))
      AND (
        jfi."normalizedIndustry" IS DISTINCT FROM c."normalizedIndustry"
        OR jfi."normalizedIndustryConfidence" IS DISTINCT FROM c."normalizedIndustryConfidence"
      )
    ORDER BY jfi."canonicalJobId"
    LIMIT ${take}
  `;
}

async function backfillJobRowsFromCompanyIndustry(args: Args) {
  let canonicalUpdated = 0;
  let feedUpdated = 0;
  let iterations = 0;
  const maxRows = args.limit ?? Number.POSITIVE_INFINITY;

  while (canonicalUpdated < maxRows) {
    const take = Math.min(args.batchSize, maxRows - canonicalUpdated);
    const rows = await selectCanonicalJobIndustryRows(take, args.safeOnly);
    if (rows.length === 0) break;
    const updated = args.apply ? await updateCanonicalJobIndustryRows(rows) : rows.length;
    canonicalUpdated += updated;
    iterations += 1;
    console.log(
      `[company-industry] canonicalRowsUpdated=${canonicalUpdated.toLocaleString()} feedRowsUpdated=${feedUpdated.toLocaleString()} iterations=${iterations.toLocaleString()}`
    );
    if (!args.apply) break;
  }

  while (feedUpdated < maxRows) {
    const take = Math.min(args.batchSize, maxRows - feedUpdated);
    const rows = await selectFeedJobIndustryRows(take, args.safeOnly);
    if (rows.length === 0) break;
    const updated = args.apply ? await updateFeedJobIndustryRows(rows) : rows.length;
    feedUpdated += updated;
    iterations += 1;
    console.log(
      `[company-industry] canonicalRowsUpdated=${canonicalUpdated.toLocaleString()} feedRowsUpdated=${feedUpdated.toLocaleString()} iterations=${iterations.toLocaleString()}`
    );
    if (!args.apply) break;
  }

  return { canonicalUpdated, feedUpdated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let cursor: string | undefined;
  let processed = 0;
  let changedCompanies = 0;
  let canonicalUpdated = 0;
  let feedUpdated = 0;
  const sourceCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();

  console.log(
    `[company-industry] mode=${args.apply ? "apply" : "dry-run"} batchSize=${args.batchSize} limit=${args.limit ?? "all"} companiesOnly=${args.companiesOnly} jobsOnly=${args.jobsOnly} safeOnly=${args.safeOnly}`
  );

  if (args.jobsOnly) {
    const updated = await backfillJobRowsFromCompanyIndustry(args);
    console.log(
      `[company-industry] completed jobs-only canonicalUpdated=${updated.canonicalUpdated.toLocaleString()} feedUpdated=${updated.feedUpdated.toLocaleString()}`
    );
    return;
  }

  while (args.limit == null || processed < args.limit) {
    const take = Math.min(args.batchSize, args.limit == null ? args.batchSize : args.limit - processed);
    const companies = await prisma.company.findMany({
      where: args.company
        ? {
            OR: [
              { name: { contains: args.company, mode: "insensitive" } },
              { companyKey: { contains: args.company.toLowerCase().replace(/[^a-z0-9]+/g, ""), mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        name: true,
        companyKey: true,
        domain: true,
        metadataJson: true,
        normalizedIndustry: true,
        normalizedIndustryConfidence: true,
        normalizedIndustrySource: true,
      },
    });

    if (companies.length === 0) break;

    const resolvedBatch: ResolvedCompanyIndustry[] = [];
    for (const company of companies) {
      const industry = resolveCompanyIndustry({
        companyName: company.name,
        domain: company.domain,
        metadataJson: company.metadataJson,
      });
      increment(sourceCounts, industry.source);
      increment(industryCounts, industry.normalizedIndustry);

      if (differs(company, industry)) changedCompanies += 1;
      resolvedBatch.push({ company, industry });
    }

    if (args.apply) {
      if (!args.jobsOnly) {
        await updateCompanyIndustryBatch(resolvedBatch);
      }
      if (!args.companiesOnly) {
        const jobBatch = args.safeOnly
            ? resolvedBatch.filter(
              ({ industry }) =>
                industry.normalizedIndustry !== "UNKNOWN" &&
                industry.confidence >= 0.9
            )
          : resolvedBatch;
        const updated = await updateJobIndustryBatch(jobBatch);
        canonicalUpdated += updated.canonicalUpdated;
        feedUpdated += updated.feedUpdated;
      }
    }

    processed += companies.length;
    cursor = companies.at(-1)?.id;
    console.log(
      `[company-industry] processed=${processed.toLocaleString()} changedCompanies=${changedCompanies.toLocaleString()} canonicalUpdated=${canonicalUpdated.toLocaleString()} feedUpdated=${feedUpdated.toLocaleString()}`
    );
  }

  printMap("Resolved industries", industryCounts);
  printMap("Resolution sources", sourceCounts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
