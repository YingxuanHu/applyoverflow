import "dotenv/config";

import type { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  type AtsExpansionSignal,
  expandAtsTenantsFromSignals,
} from "../src/lib/ingestion/frontier-expansion";
import { getCompanyFrontierWindow } from "../src/lib/ingestion/frontier-rotation";
import { discoverSourceCandidatesFromPageUrls } from "../src/lib/ingestion/discovery/sources";
import { normalizeUrlIdentityKey } from "../src/lib/ingestion/source-quality";

type CliArgs = {
  companyLimit: number;
  urlLimit: number;
  pageScanLimit: number;
  pageDiscoveryConcurrency: number;
  promotionThreshold: number;
  rotationWindowMinutes: number;
  rotationSlot: number | null;
  dryRun: boolean;
};

const VISIBLE_STATUSES = ["LIVE", "AGING", "STALE"] as const;
const AGGREGATOR_PREFIXES = new Set([
  "adzuna",
  "jobicy",
  "jooble",
  "remoteok",
  "remotive",
]);
const BOARD_PREFIXES = new Set([
  "himalayas",
  "jobbank",
  "themuse",
  "usajobs",
  "weworkremotely",
]);

function parseArgs(argv: string[]): CliArgs {
  return {
    companyLimit: Math.max(1, readIntArg(argv, "--company-limit", 1_500)),
    urlLimit: Math.max(1, readIntArg(argv, "--url-limit", 5_000)),
    pageScanLimit: Math.max(0, readIntArg(argv, "--page-scan-limit", 400)),
    pageDiscoveryConcurrency: Math.max(1, readIntArg(argv, "--page-discovery-concurrency", 8)),
    promotionThreshold: readFloatArg(argv, "--promotion-threshold", 0.84),
    rotationWindowMinutes: Math.max(
      1,
      readIntArg(argv, "--rotation-window-minutes", 360)
    ),
    rotationSlot: readOptionalIntArg(argv, "--rotation-slot"),
    dryRun: argv.includes("--dry-run"),
  };
}

function readArg(argv: string[], name: string) {
  const exact = argv.find((arg) => arg.startsWith(`${name}=`));
  return exact ? exact.slice(name.length + 1) : null;
}

function readIntArg(argv: string[], name: string, fallback: number) {
  const raw = readArg(argv, name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalIntArg(argv: string[], name: string) {
  const raw = readArg(argv, name);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFloatArg(argv: string[], name: string, fallback: number) {
  const raw = readArg(argv, name);
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDomainPageUrls(domain: string | null) {
  if (!domain) return [];
  return [
    `https://${domain}`,
    `https://${domain}/careers`,
    `https://${domain}/jobs`,
    `https://${domain}/careers/jobs`,
    `https://${domain}/join-us`,
  ];
}

function isLikelyAtsUrl(url: string) {
  return /(?:ashbyhq|greenhouse|lever|smartrecruiters|workable|myworkdayjobs|myworkdaysite|icims|teamtailor|jobvite|recruitee|rippling|taleo|successfactors)/i.test(
    url
  );
}

function sourceFamilyFromSourceName(sourceName: string) {
  return (sourceName.split(":")[0] ?? sourceName).trim().toLowerCase();
}

const companyFrontierWhere = {
  OR: [
    { domain: { not: null } },
    { careersUrl: { not: null } },
    { discoveryPages: { some: {} } },
  ],
} satisfies Prisma.CompanyWhereInput;

const companyFrontierSelect = {
  id: true,
  name: true,
  domain: true,
  careersUrl: true,
  discoveryConfidence: true,
  discoveryPages: {
    where: { failureCount: { lt: 3 } },
    orderBy: [{ confidence: "desc" }, { lastCheckedAt: "desc" }],
    take: 5,
    select: {
      url: true,
      confidence: true,
    },
  },
} satisfies Prisma.CompanySelect;

async function loadCompanySignals(limit: number, rotationSlot: number) {
  const companyCount = await prisma.company.count({ where: companyFrontierWhere });
  const window = getCompanyFrontierWindow(companyCount, limit, rotationSlot);

  // Stable ID ordering plus a rotating window keeps this recurring frontier pass
  // moving across the company corpus instead of rechecking only recently touched rows.
  const tail =
    window.tailTake > 0
      ? await prisma.company.findMany({
          where: companyFrontierWhere,
          orderBy: { id: "asc" },
          skip: window.offset,
          take: window.tailTake,
          select: companyFrontierSelect,
        })
      : [];
  const head =
    window.headTake > 0
      ? await prisma.company.findMany({
          where: companyFrontierWhere,
          orderBy: { id: "asc" },
          take: window.headTake,
          select: companyFrontierSelect,
        })
      : [];
  const companies = [...tail, ...head];

  const signals: AtsExpansionSignal[] = [];
  const pageUrls = new Map<
    string,
    { url: string; companyId: string; companyName: string; confidence: number }
  >();

  for (const company of companies) {
    const confidence = Math.max(0.52, company.discoveryConfidence);
    const candidateUrls = new Set<string>([
      ...buildDomainPageUrls(company.domain),
      company.careersUrl ?? "",
      ...company.discoveryPages.map((page) => page.url),
    ]);

    for (const url of candidateUrls) {
      if (!url) continue;

      if (isLikelyAtsUrl(url)) {
        signals.push({
          url,
          companyId: company.id,
          companyNameHint: company.name,
          confidence: Math.max(0.82, confidence),
          matchedReason: "company-url",
          sourceFamily: "company",
          metadataJson: {
            seedSource: "ats-url-expansion",
            frontierExpansion: true,
            companySignal: true,
          },
        });
      } else {
        pageUrls.set(normalizeUrlIdentityKey(url) ?? url, {
          url,
          companyId: company.id,
          companyName: company.name,
          confidence,
        });
      }
    }
  }

  return {
    signals,
    pageUrls: [...pageUrls.entries()].map(([urlKey, value]) => ({ urlKey, ...value })),
    companyCount,
    rotationOffset: window.offset,
    scannedCompanyCount: companies.length,
  };
}

async function loadCanonicalUrlSignals(limit: number) {
  const [canonicals, mappings] = await Promise.all([
    prisma.jobCanonical.findMany({
      where: {
        status: { in: [...VISIBLE_STATUSES] },
        applyUrl: { not: "" },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        companyId: true,
        company: true,
        applyUrl: true,
      },
    }),
    prisma.jobSourceMapping.findMany({
      where: {
        removedAt: null,
        sourceUrl: { not: null },
        canonicalJob: {
          status: { in: [...VISIBLE_STATUSES] },
        },
      },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
      select: {
        sourceName: true,
        sourceUrl: true,
        canonicalJob: {
          select: {
            companyId: true,
            company: true,
            applyUrl: true,
          },
        },
      },
    }),
  ]);

  const signals: AtsExpansionSignal[] = [];

  for (const canonical of canonicals) {
    signals.push({
      url: canonical.applyUrl,
      companyId: canonical.companyId,
      companyNameHint: canonical.company,
      confidence: 0.72,
      matchedReason: "canonical-apply-url",
      sourceFamily: "canonical",
      metadataJson: {
        seedSource: "ats-url-expansion",
        frontierExpansion: true,
        signalType: "canonical_apply_url",
      },
    });
  }

  for (const mapping of mappings) {
    const sourceFamily = sourceFamilyFromSourceName(mapping.sourceName);
    const matchedReason = AGGREGATOR_PREFIXES.has(sourceFamily)
      ? "aggregator-source-url"
      : BOARD_PREFIXES.has(sourceFamily)
        ? "board-source-url"
        : "source-url";
    signals.push({
      url: mapping.sourceUrl ?? mapping.canonicalJob.applyUrl,
      companyId: mapping.canonicalJob.companyId,
      companyNameHint: mapping.canonicalJob.company,
      confidence:
        AGGREGATOR_PREFIXES.has(sourceFamily) || BOARD_PREFIXES.has(sourceFamily)
          ? 0.8
          : 0.74,
      matchedReason,
      sourceFamily,
      metadataJson: {
        seedSource: "ats-url-expansion",
        frontierExpansion: true,
        signalType: matchedReason,
        sourceName: mapping.sourceName,
      },
    });
  }

  return signals;
}

async function discoverAtsBoardsFromPages(
  pageEntries: Array<{ urlKey: string; url: string; companyId: string; companyName: string; confidence: number }>,
  limit: number,
  concurrency: number
) {
  const uniquePageEntries = pageEntries.slice(0, limit);
  const pageByUrlKey = new Map(
    uniquePageEntries.map((entry) => [entry.urlKey, entry] as const)
  );
  const discovery = await discoverSourceCandidatesFromPageUrls(
    uniquePageEntries.map((entry) => entry.url),
    { concurrency }
  );

  const signals: AtsExpansionSignal[] = [];

  for (const candidate of discovery.candidates) {
    const evidence = discovery.sourceMap.get(candidate.sourceKey) ?? [];
    const pageEntry =
      evidence
        .map((entry) => pageByUrlKey.get(normalizeUrlIdentityKey(entry.pageUrl) ?? entry.pageUrl))
        .find((value): value is NonNullable<typeof value> => Boolean(value)) ?? null;
    if (!pageEntry) continue;

    signals.push({
      url: candidate.boardUrl,
      companyId: pageEntry.companyId,
      companyNameHint: pageEntry.companyName,
      confidence: 0.92,
      matchedReason: "page-discovery",
      sourceFamily: "company-page",
      metadataJson: {
        seedSource: "ats-url-expansion",
        frontierExpansion: true,
        matchedPageUrl: pageEntry.url,
        sourceKey: candidate.sourceKey,
      },
    });
  }

  return signals;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rotationSlot =
    args.rotationSlot ??
    Math.floor(Date.now() / (args.rotationWindowMinutes * 60 * 1_000));
  const [companySignals, canonicalSignals] = await Promise.all([
    loadCompanySignals(args.companyLimit, rotationSlot),
    loadCanonicalUrlSignals(args.urlLimit),
  ]);

  const pageDiscoverySignals = await discoverAtsBoardsFromPages(
    companySignals.pageUrls,
    args.pageScanLimit,
    args.pageDiscoveryConcurrency
  );

  const allSignals = [
    ...companySignals.signals,
    ...canonicalSignals,
    ...pageDiscoverySignals,
  ];
  const result = await expandAtsTenantsFromSignals(allSignals, {
    promotionThreshold: args.promotionThreshold,
    dryRun: args.dryRun,
  });

  console.log(
    JSON.stringify(
      {
        companyCorpusCount: companySignals.companyCount,
        scannedCompanyCount: companySignals.scannedCompanyCount,
        rotationSlot,
        rotationOffset: companySignals.rotationOffset,
        companySignals: companySignals.signals.length,
        pageSeedCount: companySignals.pageUrls.length,
        canonicalSignals: canonicalSignals.length,
        pageDiscoverySignals: pageDiscoverySignals.length,
        totalSignals: allSignals.length,
        ...result,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "[ats:expand-frontier] failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
