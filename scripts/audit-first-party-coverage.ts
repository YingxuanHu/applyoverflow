import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  buildAmazonSearchUrl,
  buildAppleSearchUrl,
  buildEightfoldSearchUrl,
  extractAppleTotalRecords,
  AMAZON_US_CATEGORY_SHARDS,
} from "../src/lib/ingestion/connectors/official-company";

type Args = {
  companies: string[];
  market: "ca" | "us" | "north-america";
};

type SourceCoverage = {
  company: string;
  sourceName: string;
  market: string;
  sourceReportedCount: number | null;
  sourceCapped: boolean;
  activeMappings: number;
  primaryMappings: number;
  boardVisibleLive: number;
  coverageRatio: number | null;
  shards?: Record<string, number>;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    companies: ["amazon", "apple", "microsoft", "nvidia"],
    market: "north-america",
  };

  for (const rawArg of argv) {
    const [rawKey, rawValue] = rawArg.replace(/^--/, "").split("=");
    if (!rawKey || rawValue === undefined) continue;
    if (rawKey === "companies") {
      args.companies = rawValue
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    }
    if (
      rawKey === "market" &&
      (rawValue === "ca" || rawValue === "us" || rawValue === "north-america")
    ) {
      args.market = rawValue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const coverage: SourceCoverage[] = [];

  for (const company of args.companies) {
    if (company === "amazon") {
      coverage.push(await auditAmazon(args.market));
    } else if (company === "apple") {
      coverage.push(await auditApple(args.market));
    } else if (company === "microsoft" || company === "nvidia") {
      coverage.push(await auditEightfold(company, args.market));
    }
  }

  const seedCompanies = await prisma.company.count({
    where: {
      metadataJson: {
        path: ["seedFile"],
        equals: "first-party-company-seeds.import.csv",
      },
    },
  });
  const seedCompanySites = await prisma.companySource.count({
    where: {
      connectorName: "company-site",
      company: {
        metadataJson: {
          path: ["seedFile"],
          equals: "first-party-company-seeds.import.csv",
        },
      },
    },
  });
  const pendingSeedDiscovery = await prisma.sourceTask.count({
    where: {
      kind: "COMPANY_DISCOVERY",
      status: "PENDING",
      payloadJson: {
        path: ["origin"],
        equals: "csv_seed_import_fast_company_site",
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        market: args.market,
        coverage,
        seedList: {
          companiesImported: seedCompanies,
          companySiteSources: seedCompanySites,
          pendingDiscoveryTasks: pendingSeedDiscovery,
        },
      },
      null,
      2
    )
  );
}

async function auditAmazon(market: Args["market"]) {
  const shards =
    market === "ca"
      ? [{ key: "CAN", url: buildAmazonSearchUrl({ country: "CAN", offset: 0, limit: 1 }) }]
      : market === "us"
        ? AMAZON_US_CATEGORY_SHARDS.map((category) => ({
            key: `USA:${category}`,
            url: buildAmazonSearchUrl({
              country: "USA",
              category,
              offset: 0,
              limit: 1,
            }),
          }))
        : [
            { key: "CAN", url: buildAmazonSearchUrl({ country: "CAN", offset: 0, limit: 1 }) },
            ...AMAZON_US_CATEGORY_SHARDS.map((category) => ({
              key: `USA:${category}`,
              url: buildAmazonSearchUrl({
                country: "USA",
                category,
                offset: 0,
                limit: 1,
              }),
            })),
          ];

  const shardCounts: Record<string, number> = {};
  for (const shard of shards) {
    const payload = await fetchJson<{ hits?: number }>(shard.url);
    shardCounts[shard.key] = typeof payload.hits === "number" ? payload.hits : 0;
  }

  const sourceReportedCount = Object.values(shardCounts).reduce(
    (total, count) => total + count,
    0
  );
  return buildCoverageRow({
    company: "amazon",
    sourceName: "OfficialCompany:Amazon",
    market,
    sourceReportedCount,
    sourceCapped: Object.values(shardCounts).some((count) => count >= 10_000),
    shards: shardCounts,
  });
}

async function auditApple(market: Args["market"]) {
  const markets = market === "north-america" ? ["ca", "us"] as const : [market] as const;
  const shardCounts: Record<string, number> = {};
  for (const appleMarket of markets) {
    if (appleMarket !== "ca" && appleMarket !== "us") continue;
    const html = await fetchText(buildAppleSearchUrl({ market: appleMarket, page: 1 }));
    shardCounts[appleMarket] = extractAppleTotalRecords(html) ?? 0;
  }

  const sourceReportedCount = Object.values(shardCounts).reduce(
    (total, count) => total + count,
    0
  );
  return buildCoverageRow({
    company: "apple",
    sourceName: "OfficialCompany:Apple",
    market,
    sourceReportedCount,
    sourceCapped: false,
    shards: shardCounts,
  });
}

async function auditEightfold(
  company: "microsoft" | "nvidia",
  market: Args["market"]
) {
  const config =
    company === "microsoft"
      ? {
          company,
          displayName: "Microsoft" as const,
          domain: "microsoft.com" as const,
          baseUrl: "https://apply.careers.microsoft.com" as const,
        }
      : {
          company,
          displayName: "NVIDIA" as const,
          domain: "nvidia.com" as const,
          baseUrl: "https://jobs.nvidia.com" as const,
        };
  const locations =
    market === "north-america"
      ? ["Canada", "United States"]
      : [market === "ca" ? "Canada" : "United States"];
  const shardCounts: Record<string, number> = {};

  for (const location of locations) {
    const payload = await fetchJson<{ data?: { count?: number } }>(
      buildEightfoldSearchUrl({
        config,
        location,
        offset: 0,
        limit: 1,
      })
    );
    shardCounts[location] = typeof payload.data?.count === "number" ? payload.data.count : 0;
  }

  const sourceReportedCount = Object.values(shardCounts).reduce(
    (total, count) => total + count,
    0
  );
  return buildCoverageRow({
    company,
    sourceName: `OfficialCompany:${company === "nvidia" ? "NVIDIA" : "Microsoft"}`,
    market,
    sourceReportedCount,
    sourceCapped: false,
    shards: shardCounts,
  });
}

async function buildCoverageRow(input: {
  company: string;
  sourceName: string;
  market: string;
  sourceReportedCount: number | null;
  sourceCapped: boolean;
  shards?: Record<string, number>;
}): Promise<SourceCoverage> {
  const [activeMappings, primaryMappings, boardVisibleLive] = await Promise.all([
    prisma.jobSourceMapping.count({
      where: { sourceName: input.sourceName, removedAt: null },
    }),
    prisma.jobSourceMapping.count({
      where: { sourceName: input.sourceName, removedAt: null, isPrimary: true },
    }),
    prisma.jobCanonical.count({
      where: {
        sourceMappings: {
          some: { sourceName: input.sourceName, removedAt: null },
        },
        status: "LIVE",
        availabilityScore: { gte: 60 },
        deadSignalAt: null,
        region: { in: ["US", "CA"] },
      },
    }),
  ]);

  return {
    company: input.company,
    sourceName: input.sourceName,
    market: input.market,
    sourceReportedCount: input.sourceReportedCount,
    sourceCapped: input.sourceCapped,
    activeMappings,
    primaryMappings,
    boardVisibleLive,
    coverageRatio:
      input.sourceReportedCount && input.sourceReportedCount > 0
        ? activeMappings / input.sourceReportedCount
        : null,
    shards: input.shards,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; autoapplication-first-party-audit/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`First-party audit fetch failed ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; autoapplication-first-party-audit/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`First-party audit fetch failed ${response.status}: ${url}`);
  }
  return response.text();
}

main()
  .catch((error) => {
    console.error("First-party coverage audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
