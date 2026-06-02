import "dotenv/config";

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { FIRST_PARTY_COMPANY_SEEDS_PATH } from "@/lib/ingestion/official-company-seeds";

type CsvSeed = {
  rank: number;
  companyName: string;
  careersUrl: string;
  priorityTier: number;
  atsVendor: string | null;
};

type Args = {
  file: string;
  limit: number;
  maxPriorityTier: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: FIRST_PARTY_COMPANY_SEEDS_PATH,
    limit: 200,
    maxPriorityTier: 2,
  };

  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (!key || value == null) continue;
    if (key === "file") args.file = value;
    if (key === "limit") args.limit = Math.max(1, Number.parseInt(value, 10) || args.limit);
    if (key === "max-priority-tier") {
      args.maxPriorityTier = Math.max(
        1,
        Number.parseInt(value, 10) || args.maxPriorityTier
      );
    }
  }

  return args;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function cleanCompanyName(input: string) {
  return input
    .replace(/\s+-\s+/g, " ")
    .replace(/\b(?:inc|incorporated|corp|corporation|ltd|limited|llc|plc|co)\.?$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeCompanyKey(input: string) {
  return cleanCompanyName(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function readCell(row: string[], headerIndexes: Map<string, number>, name: string) {
  const index = headerIndexes.get(name);
  return index == null ? "" : (row[index] ?? "").trim();
}

function readSeeds(file: string): CsvSeed[] {
  const rows = parseCsvRows(readFileSync(file, "utf8")).filter((row) =>
    row.some((value) => value.trim())
  );
  const [header, ...records] = rows;
  const headerIndexes = new Map((header ?? []).map((name, index) => [name.trim(), index]));

  return records
    .map((row) => ({
      rank: Number(readCell(row, headerIndexes, "rank")) || Number.MAX_SAFE_INTEGER,
      companyName: readCell(row, headerIndexes, "companyName"),
      careersUrl: readCell(row, headerIndexes, "careersUrl"),
      priorityTier: Number(readCell(row, headerIndexes, "priorityTier")) || 3,
      atsVendor: readCell(row, headerIndexes, "ats_vendor") || null,
    }))
    .filter((seed) => seed.companyName && seed.careersUrl)
    .sort((left, right) => left.rank - right.rank);
}

function isOperationalSource(source: {
  status: string;
  pollState: string;
}) {
  return (
    ["ACTIVE", "DEGRADED", "PROVISIONED"].includes(source.status) &&
    source.pollState !== "DISABLED" &&
    source.pollState !== "QUARANTINED"
  );
}

function isPollableSource(source: {
  status: string;
  pollState: string;
  validationState: string;
}) {
  return isOperationalSource(source) && source.validationState === "VALIDATED";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = readSeeds(args.file);
  const auditSeeds = seeds
    .filter((seed) => seed.priorityTier <= args.maxPriorityTier)
    .slice(0, args.limit);

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      companyKey: true,
      detectedAts: true,
      discoveryStatus: true,
      crawlStatus: true,
      lastSuccessfulPollAt: true,
    },
  });

  const companiesByNormalizedKey = new Map<string, typeof companies>();
  for (const company of companies) {
    const keys = new Set([
      normalizeCompanyKey(company.name),
      normalizeCompanyKey(company.companyKey),
    ]);
    for (const key of keys) {
      if (!key) continue;
      const existing = companiesByNormalizedKey.get(key) ?? [];
      existing.push(company);
      companiesByNormalizedKey.set(key, existing);
    }
  }

  const matchedIds = new Set<string>();
  const matchedCompaniesBySeed = new Map<string, typeof companies>();
  for (const seed of auditSeeds) {
    const key = normalizeCompanyKey(seed.companyName);
    const matches = companiesByNormalizedKey.get(key) ?? [];
    matchedCompaniesBySeed.set(key, matches);
    for (const company of matches) matchedIds.add(company.id);
  }

  const sources = matchedIds.size
    ? await prisma.companySource.findMany({
        where: { companyId: { in: [...matchedIds] } },
        select: {
          id: true,
          companyId: true,
          sourceName: true,
          connectorName: true,
          token: true,
          status: true,
          validationState: true,
          pollState: true,
          retainedLiveJobCount: true,
          jobsCreatedCount: true,
          lastSuccessfulPollAt: true,
          validationMessage: true,
        },
      })
    : [];

  const sourcesByCompanyId = new Map<string, typeof sources>();
  for (const source of sources) {
    const existing = sourcesByCompanyId.get(source.companyId) ?? [];
    existing.push(source);
    sourcesByCompanyId.set(source.companyId, existing);
  }

  const rows = [];
  for (const seed of auditSeeds) {
    const key = normalizeCompanyKey(seed.companyName);
    const matches = matchedCompaniesBySeed.get(key) ?? [];
    const companyIds = matches.map((company) => company.id);
    const companySources = companyIds.flatMap((id) => sourcesByCompanyId.get(id) ?? []);
    const [canonicalLive, visibleLive] =
      companyIds.length === 0
        ? [0, 0]
        : await Promise.all([
            prisma.jobCanonical.count({
              where: { companyId: { in: companyIds }, status: { in: ["LIVE", "AGING"] } },
            }),
            prisma.jobFeedIndex.count({
              where: { status: "LIVE", canonicalJob: { companyId: { in: companyIds } } },
            }),
          ]);

    rows.push({
      rank: seed.rank,
      companyName: seed.companyName,
      careersUrl: seed.careersUrl,
      priorityTier: seed.priorityTier,
      seedAtsVendor: seed.atsVendor,
      companyRecords: matches.map((company) => ({
        id: company.id,
        name: company.name,
        companyKey: company.companyKey,
        detectedAts: company.detectedAts,
        discoveryStatus: company.discoveryStatus,
        crawlStatus: company.crawlStatus,
        lastSuccessfulPollAt: company.lastSuccessfulPollAt,
      })),
      sourceCount: companySources.length,
      operationalSourceCount: companySources.filter(isOperationalSource).length,
      pollableSourceCount: companySources.filter(isPollableSource).length,
      blockedOrInvalidSourceCount: companySources.filter(
        (source) =>
          ["BLOCKED", "INVALID"].includes(source.validationState) ||
          source.status === "DISABLED" ||
          ["QUARANTINED", "DISABLED"].includes(source.pollState)
      ).length,
      canonicalLive,
      visibleLive,
      retainedLiveFromSources: companySources.reduce(
        (sum, source) => sum + source.retainedLiveJobCount,
        0
      ),
      sources: companySources
        .sort((left, right) => right.retainedLiveJobCount - left.retainedLiveJobCount)
        .slice(0, 8)
        .map((source) => ({
          sourceName: source.sourceName,
          connectorName: source.connectorName,
          status: source.status,
          validationState: source.validationState,
          pollState: source.pollState,
          retainedLiveJobCount: source.retainedLiveJobCount,
          jobsCreatedCount: source.jobsCreatedCount,
          lastSuccessfulPollAt: source.lastSuccessfulPollAt,
          validationMessage: source.validationMessage,
        })),
    });
  }

  const missingCompany = rows.filter((row) => row.companyRecords.length === 0);
  const noSources = rows.filter(
    (row) => row.companyRecords.length > 0 && row.sourceCount === 0
  );
  const noPollableSources = rows.filter(
    (row) => row.sourceCount > 0 && row.pollableSourceCount === 0
  );
  const zeroVisibleWithPollable = rows.filter(
    (row) => row.pollableSourceCount > 0 && row.visibleLive === 0
  );
  const lowVisibleTop80 = rows.filter(
    (row) => row.rank <= 80 && row.pollableSourceCount > 0 && row.visibleLive > 0 && row.visibleLive < 50
  );

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary: {
          seedFileRows: seeds.length,
          auditedPriorityCompanies: auditSeeds.length,
          companiesFound: rows.filter((row) => row.companyRecords.length > 0).length,
          missingCompanyCount: missingCompany.length,
          noSourcesCount: noSources.length,
          noPollableSourcesCount: noPollableSources.length,
          zeroVisibleWithPollableCount: zeroVisibleWithPollable.length,
          lowVisibleTop80Count: lowVisibleTop80.length,
          totalVisibleForAudited: rows.reduce((sum, row) => sum + row.visibleLive, 0),
          totalCanonicalForAudited: rows.reduce((sum, row) => sum + row.canonicalLive, 0),
        },
        topVisible: [...rows]
          .sort((left, right) => right.visibleLive - left.visibleLive)
          .slice(0, 25),
        attention: rows
          .filter(
            (row) =>
              row.companyRecords.length === 0 ||
              row.sourceCount === 0 ||
              row.pollableSourceCount === 0 ||
              row.visibleLive === 0 ||
              (row.rank <= 80 && row.visibleLive < 50)
          )
          .slice(0, 100),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Priority company coverage audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
