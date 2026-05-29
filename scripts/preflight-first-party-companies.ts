import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type ExtractionRouteKind } from "../src/generated/prisma/client";
import {
  createCompanySiteConnector,
  createOfficialCompanyConnector,
  inspectCompanySiteRoute,
} from "../src/lib/ingestion/connectors";
import {
  FIRST_PARTY_COMPANY_SEEDS_PATH,
  classifyFirstPartyCompanySeed,
  readFirstPartyCompanySeeds,
  selectFirstPartyCompanySeeds,
  splitCompanySelection,
  type FirstPartyCompanySeed,
  type FirstPartySeedDisposition,
} from "../src/lib/ingestion/official-company-seeds";
import type { SourceConnectorFetchResult } from "../src/lib/ingestion/types";

type CliArgs = {
  file?: string;
  out?: string;
  companies?: string;
  limit?: number;
  "priority-tier"?: number;
  "preview-limit"?: number;
  concurrency?: number;
  register?: boolean;
  promote?: boolean;
  "no-queue"?: boolean;
  "register-company-sites"?: boolean;
  "with-db"?: boolean;
};

type PreflightFeasibility =
  | "IMPLEMENTED"
  | "PROMOTE_COMPANY_SITE"
  | "NEEDS_CONNECTOR"
  | "BLOCKED"
  | "FRAGILE"
  | "UNKNOWN"
  | "ERROR";

type PreflightRecord = {
  rank: number;
  companyName: string;
  companyKey: string;
  careersUrl: string;
  priorityTier: number;
  regionPriority: string;
  whyImportant: string;
  notes: string;
  disposition: FirstPartySeedDisposition;
  feasibility: PreflightFeasibility;
  finalUrl: string | null;
  extractionRoute: string | null;
  parserVersion: string | null;
  confidence: number;
  jobsFound: number;
  exhausted: boolean | null;
  sampleTitles: string[];
  sampleLocations: string[];
  recommendation: string;
  existing?: ExistingSourceComparison | null;
  registeredCompanySourceId?: string;
  queuedTask?: "SOURCE_VALIDATION" | "CONNECTOR_POLL";
  error?: string;
};

type ExistingSourceComparison = {
  companyExists: boolean;
  companySourceCount: number;
  officialCompanySourceCount: number;
  lowerTrustSourceCount: number;
  liveCanonicalCount: number;
};

const rawArgs = parseArgs(process.argv.slice(2));
type PrismaClientInstance = Awaited<typeof import("../src/lib/db")>["prisma"];
let loadedPrisma: PrismaClientInstance | null = null;

async function main() {
  const seeds = await readFirstPartyCompanySeeds(rawArgs.file ?? FIRST_PARTY_COMPANY_SEEDS_PATH);
  const selectedSeeds = selectFirstPartyCompanySeeds(seeds, {
    companies: splitCompanySelection(rawArgs.companies),
    priorityTier: rawArgs["priority-tier"],
    limit: rawArgs.limit ?? seeds.length,
  });
  const previewLimit = rawArgs["preview-limit"] ?? 3;
  const records = await preflightSeeds(selectedSeeds, {
    previewLimit,
    concurrency: rawArgs.concurrency ?? 3,
    withDb:
      rawArgs["with-db"] === true ||
      rawArgs.register === true ||
      rawArgs.promote === true,
  });

  const persistence =
    rawArgs.register === true || rawArgs.promote === true
      ? await persistRecords(records, {
          promote: rawArgs.promote === true,
          queue: rawArgs["no-queue"] !== true,
          registerCompanySites: rawArgs["register-company-sites"] === true,
        })
      : null;

  const outputFile = path.resolve(
    rawArgs.out ?? "data/discovery/seeds/first-party-company-preflight.json"
  );
  const reportPath = outputFile.replace(/\.json$/i, ".report.json");
  const report = buildReport(records, {
    selectedCount: selectedSeeds.length,
    previewLimit,
    persistence,
  });

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    [
      `Wrote ${records.length} first-party preflight records to ${outputFile}`,
      `Report: ${reportPath}`,
      `Implemented: ${report.byFeasibility.IMPLEMENTED ?? 0}`,
      `Promotable company-site: ${report.byFeasibility.PROMOTE_COMPANY_SITE ?? 0}`,
      `Needs connector: ${report.byFeasibility.NEEDS_CONNECTOR ?? 0}`,
      `Blocked/fragile: ${(report.byFeasibility.BLOCKED ?? 0) + (report.byFeasibility.FRAGILE ?? 0)}`,
    ].join("\n")
  );
}

async function preflightSeeds(
  seeds: FirstPartyCompanySeed[],
  options: { previewLimit: number; concurrency: number; withDb: boolean }
) {
  const records = new Array<PreflightRecord>(seeds.length);
  let cursor = 0;

  async function worker() {
    while (cursor < seeds.length) {
      const index = cursor;
      cursor += 1;
      const seed = seeds[index]!;
      records[index] = await preflightSeed(seed, options);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, seeds.length) }, () => worker())
  );
  return records;
}

async function preflightSeed(
  seed: FirstPartyCompanySeed,
  options: { previewLimit: number; withDb: boolean }
): Promise<PreflightRecord> {
  const disposition = classifyFirstPartyCompanySeed(seed);
  const base = buildBaseRecord(seed, disposition);

  try {
    if (disposition.kind === "official_connector") {
      const connector = createOfficialCompanyConnector({
        company: disposition.company,
        market: "north-america",
      });
      const result = await connector.fetchJobs({
        now: new Date(),
        limit: options.previewLimit,
        log: () => {},
      });
      return {
        ...base,
        feasibility: result.jobs.length > 0 ? "IMPLEMENTED" : "UNKNOWN",
        finalUrl: disposition.boardUrl,
        extractionRoute: disposition.extractionRoute,
        parserVersion: disposition.parserVersion,
        confidence: disposition.confidence,
        jobsFound: result.jobs.length,
        exhausted: result.exhausted ?? null,
        sampleTitles: result.jobs.map((job) => job.title).slice(0, 5),
        sampleLocations: result.jobs.map((job) => job.location).slice(0, 5),
        recommendation:
          result.jobs.length > 0
            ? "Promote this official connector as canonical for the company."
            : "Keep registered but validate before polling; the official endpoint returned no jobs in preview.",
        existing: options.withDb ? await compareExistingSources(seed.companyKey) : null,
      };
    }

    if (disposition.kind === "deferred") {
      return {
        ...base,
        feasibility:
          disposition.recommendation === "blocked" ? "BLOCKED" : "FRAGILE",
        confidence: disposition.confidence,
        recommendation: disposition.reason,
        existing: options.withDb ? await compareExistingSources(seed.companyKey) : null,
      };
    }

    const inspection = await inspectCompanySiteRoute(seed.careersUrl);
    if (inspection.extractionRoute === "UNKNOWN") {
      return {
        ...base,
        feasibility: "NEEDS_CONNECTOR",
        finalUrl: inspection.finalUrl,
        extractionRoute: inspection.extractionRoute,
        parserVersion: inspection.parserVersion,
        confidence: inspection.confidence,
        recommendation:
          "The careers URL is reachable but did not expose a stable structured feed. Add a custom connector before promoting.",
        existing: options.withDb ? await compareExistingSources(seed.companyKey) : null,
      };
    }

    const result = await previewCompanySite(seed, inspection, options.previewLimit);
    const highQualityStructured =
      inspection.extractionRoute === "STRUCTURED_API" ||
      inspection.extractionRoute === "STRUCTURED_JSON" ||
      inspection.extractionRoute === "STRUCTURED_SITEMAP";
    const sampleLooksJobLike = result.jobs.some((job) => looksLikeConcreteJobTitle(job.title));
    const sampleHasSpecificLocation = result.jobs.some(
      (job) => job.location.trim().toLowerCase() !== "unknown"
    );
    const promotableCompanySite =
      highQualityStructured &&
      (inspection.extractionRoute === "STRUCTURED_API" ||
        inspection.extractionRoute === "STRUCTURED_JSON" ||
        (sampleLooksJobLike && sampleHasSpecificLocation)) &&
      (result.jobs.length > 0 || inspection.confidence >= 0.72);

    return {
      ...base,
      feasibility: promotableCompanySite ? "PROMOTE_COMPANY_SITE" : "NEEDS_CONNECTOR",
      finalUrl: inspection.finalUrl,
      extractionRoute: inspection.extractionRoute,
      parserVersion: inspection.parserVersion,
      confidence: inspection.confidence,
      jobsFound: result.jobs.length,
      exhausted: result.exhausted ?? null,
      sampleTitles: result.jobs.map((job) => job.title).slice(0, 5),
      sampleLocations: result.jobs.map((job) => job.location).slice(0, 5),
      recommendation:
        inspection.extractionRoute === "STRUCTURED_SITEMAP" && !sampleLooksJobLike
          ? "Structured sitemap is reachable, but sampled pages do not look like job postings. Add a custom connector or better sitemap filter before promoting."
          : inspection.extractionRoute === "STRUCTURED_SITEMAP" && !sampleHasSpecificLocation
            ? "Structured sitemap samples lack specific job locations. Add a custom connector or better sitemap filter before promoting."
          : highQualityStructured
          ? "Can be registered as a first-party company-site source after review."
          : "HTML fallback is lower quality; keep for diagnostics or write a custom connector.",
      existing: options.withDb ? await compareExistingSources(seed.companyKey) : null,
    };
  } catch (error) {
    return {
      ...base,
      feasibility: "ERROR",
      error: error instanceof Error ? error.message : String(error),
      recommendation: "Preflight failed; retry before deciding whether to promote.",
      existing: options.withDb ? await compareExistingSources(seed.companyKey) : null,
    };
  }
}

async function previewCompanySite(
  seed: FirstPartyCompanySeed,
  inspection: Awaited<ReturnType<typeof inspectCompanySiteRoute>>,
  previewLimit: number
): Promise<SourceConnectorFetchResult> {
  const sourceName =
    inspection.extractionRoute === "HTML_FALLBACK"
      ? `CompanyHtml:${seed.companyKey}`
      : `CompanyJson:${seed.companyKey}`;
  const connector = createCompanySiteConnector({
    sourceName,
    companyName: seed.companyName,
    boardUrl: inspection.finalUrl,
    extractionRoute: inspection.extractionRoute,
    parserVersion: inspection.parserVersion,
  });

  return connector.fetchJobs({
    now: new Date(),
    limit: previewLimit,
    log: () => {},
  });
}

async function compareExistingSources(companyKey: string): Promise<ExistingSourceComparison> {
  const prisma = await getPrisma();
  const [company, liveCanonicalCount] = await Promise.all([
    prisma.company.findUnique({
      where: { companyKey },
      include: {
        sources: {
          select: {
            connectorName: true,
          },
        },
      },
    }),
    prisma.jobCanonical.count({
      where: {
        companyKey,
        status: { in: ["LIVE", "AGING"] },
      },
    }),
  ]);

  const officialCompanySourceCount =
    company?.sources.filter((source) => source.connectorName === "official-company").length ?? 0;
  const companySourceCount = company?.sources.length ?? 0;

  return {
    companyExists: Boolean(company),
    companySourceCount,
    officialCompanySourceCount,
    lowerTrustSourceCount: Math.max(0, companySourceCount - officialCompanySourceCount),
    liveCanonicalCount,
  };
}

async function persistRecords(
  records: PreflightRecord[],
  options: { promote: boolean; queue: boolean; registerCompanySites: boolean }
) {
  let registered = 0;
  let skipped = 0;
  let validationTasksQueued = 0;
  let pollTasksQueued = 0;

  for (const record of records) {
    const shouldPersistOfficial =
      record.disposition.kind === "official_connector" &&
      record.feasibility === "IMPLEMENTED";
    const shouldPersistCompanySite =
      options.registerCompanySites &&
      record.feasibility === "PROMOTE_COMPANY_SITE" &&
      record.finalUrl &&
      record.extractionRoute &&
      record.parserVersion;

    if (!shouldPersistOfficial && !shouldPersistCompanySite) {
      skipped += 1;
      continue;
    }

    const persisted = await persistCompanySource(record, {
      promote: options.promote,
      queue: options.queue,
    });
    record.registeredCompanySourceId = persisted.companySourceId;
    record.queuedTask = persisted.queuedTask;
    registered += 1;
    if (persisted.queuedTask === "CONNECTOR_POLL") pollTasksQueued += 1;
    if (persisted.queuedTask === "SOURCE_VALIDATION") validationTasksQueued += 1;
  }

  return {
    registered,
    skipped,
    validationTasksQueued,
    pollTasksQueued,
  };
}

async function persistCompanySource(
  record: PreflightRecord,
  options: { promote: boolean; queue: boolean }
) {
  const now = new Date();
  const [
    { ensureCompanyRecord },
    { upsertCompanySourceByIdentity },
    { enqueueUniqueSourceTask },
  ] = await Promise.all([
    import("../src/lib/ingestion/company-records"),
    import("../src/lib/ingestion/company-source-upsert"),
    import("../src/lib/ingestion/task-queue"),
  ]);
  const company = await ensureCompanyRecord({
    companyName: record.companyName,
    companyKey: record.companyKey,
    urls: [record.careersUrl, record.finalUrl],
    careersUrl: record.careersUrl,
    detectedAts:
      record.disposition.kind === "official_connector"
        ? "official-company"
        : "company-site",
    discoveryStatus: "DISCOVERED",
    crawlStatus: "IDLE",
    discoveryConfidence: record.confidence,
    metadataJson: {
      firstPartySeed: {
        rank: record.rank,
        priorityTier: record.priorityTier,
        regionPriority: record.regionPriority,
      },
    },
  });
  const sourceIdentity = buildSourceIdentity(record);
  const validationState = options.promote ? "VALIDATED" : "UNVALIDATED";
  const status = options.promote ? "ACTIVE" : "PROVISIONED";
  const sourceQualityScore =
    record.disposition.kind === "official_connector"
      ? 0.98
      : record.extractionRoute === "HTML_FALLBACK"
        ? 0.58
        : 0.83;
  const metadataJson = {
      firstPartySeed: {
        rank: record.rank,
        careersUrl: record.careersUrl,
        priorityTier: record.priorityTier,
        regionPriority: record.regionPriority,
        whyImportant: record.whyImportant,
        notes: record.notes,
      },
    preflight: {
      feasibility: record.feasibility,
      jobsFound: record.jobsFound,
      sampleTitles: record.sampleTitles,
      recommendation: record.recommendation,
    },
  } satisfies Prisma.InputJsonValue;

  const companySource = await upsertCompanySourceByIdentity({
    identity: {
      companyId: company.id,
      sourceName: sourceIdentity.sourceName,
      connectorName: sourceIdentity.connectorName,
      token: sourceIdentity.token,
    },
    create: {
      companyId: company.id,
      sourceName: sourceIdentity.sourceName,
      connectorName: sourceIdentity.connectorName,
      token: sourceIdentity.token,
      boardUrl: sourceIdentity.boardUrl,
      status,
      validationState,
      pollState: "READY",
      sourceType: sourceIdentity.sourceType,
      extractionRoute: sourceIdentity.extractionRoute,
      parserVersion: sourceIdentity.parserVersion,
      pollingCadenceMinutes: sourceIdentity.connectorName === "official-company" ? 360 : 720,
      priorityScore: record.confidence,
      sourceQualityScore,
      yieldScore: sourceQualityScore * 0.75,
      firstSeenAt: now,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: options.promote ? now : null,
      metadataJson,
    },
    update: {
      companyId: company.id,
      boardUrl: sourceIdentity.boardUrl,
      status,
      validationState,
      pollState: "READY",
      sourceType: sourceIdentity.sourceType,
      extractionRoute: sourceIdentity.extractionRoute,
      parserVersion: sourceIdentity.parserVersion,
      pollingCadenceMinutes: sourceIdentity.connectorName === "official-company" ? 360 : 720,
      priorityScore: record.confidence,
      sourceQualityScore,
      yieldScore: sourceQualityScore * 0.75,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: options.promote ? now : null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: null,
      metadataJson,
    },
  });

  const queuedTask: "CONNECTOR_POLL" | "SOURCE_VALIDATION" = options.promote
    ? "CONNECTOR_POLL"
    : "SOURCE_VALIDATION";
  if (options.queue) {
    await enqueueUniqueSourceTask({
      kind: queuedTask,
      companyId: company.id,
      companySourceId: companySource.id,
      priorityScore: Math.round(record.confidence * 100),
      notBeforeAt: now,
    });
  }

  return {
    companySourceId: companySource.id,
    queuedTask: options.queue ? queuedTask : undefined,
  };
}

function buildSourceIdentity(record: PreflightRecord) {
  if (record.disposition.kind === "official_connector") {
    return {
      sourceName: record.disposition.sourceName,
      connectorName: record.disposition.connectorName,
      token: record.disposition.token,
      boardUrl: record.disposition.boardUrl,
      sourceType: record.disposition.sourceType,
      extractionRoute: record.disposition.extractionRoute,
      parserVersion: record.disposition.parserVersion,
    };
  }

  const extractionRoute = (record.extractionRoute ?? "UNKNOWN") as ExtractionRouteKind;
  return {
    sourceName:
      extractionRoute === "HTML_FALLBACK"
        ? `CompanyHtml:${record.companyKey}`
        : `CompanyJson:${record.companyKey}`,
    connectorName: "company-site",
    token: record.companyKey,
    boardUrl: record.finalUrl ?? record.careersUrl,
    sourceType: extractionRoute === "HTML_FALLBACK" ? "COMPANY_HTML" : "COMPANY_JSON",
    extractionRoute,
    parserVersion: record.parserVersion,
  };
}

function buildBaseRecord(
  seed: FirstPartyCompanySeed,
  disposition: FirstPartySeedDisposition
): PreflightRecord {
  return {
    rank: seed.rank,
    companyName: seed.companyName,
    companyKey: seed.companyKey,
    careersUrl: seed.careersUrl,
    priorityTier: seed.priorityTier,
    regionPriority: seed.regionPriority,
    whyImportant: seed.whyImportant,
    notes: seed.notes,
    disposition,
    feasibility: "UNKNOWN",
    finalUrl: null,
    extractionRoute: null,
    parserVersion: null,
    confidence: disposition.confidence,
    jobsFound: 0,
    exhausted: null,
    sampleTitles: [],
    sampleLocations: [],
    recommendation: disposition.reason,
  };
}

function looksLikeConcreteJobTitle(title: string) {
  const normalizedTitle = title.toLowerCase();
  if (
    /^(?:join us|work at|careers?|jobs?|open positions?|shape how|like no place|netflix culture|stripe logo jobs?)\b/.test(
      normalizedTitle
    )
  ) {
    return false;
  }

  return /\b(engineer|developer|architect|analyst|scientist|designer|manager|director|lead|specialist|consultant|intern|researcher|recruiter|account executive|sales|product|program|project|security|finance|operations|legal|marketing|data|machine learning|software|hardware|systems)\b/.test(
    normalizedTitle
  );
}

function buildReport(
  records: PreflightRecord[],
  options: {
    selectedCount: number;
    previewLimit: number;
    persistence: Awaited<ReturnType<typeof persistRecords>> | null;
  }
) {
  const byFeasibility: Record<string, number> = {};
  for (const record of records) {
    byFeasibility[record.feasibility] = (byFeasibility[record.feasibility] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    seedFile: FIRST_PARTY_COMPANY_SEEDS_PATH,
    selectedCount: options.selectedCount,
    previewLimit: options.previewLimit,
    byFeasibility,
    implemented: records
      .filter((record) => record.feasibility === "IMPLEMENTED")
      .map((record) => ({
        companyName: record.companyName,
        connector:
          record.disposition.kind === "official_connector"
            ? record.disposition.token
            : record.finalUrl,
        jobsFound: record.jobsFound,
        sampleTitles: record.sampleTitles,
      })),
    needsConnector: records
      .filter((record) => record.feasibility === "NEEDS_CONNECTOR")
      .map((record) => ({
        companyName: record.companyName,
        careersUrl: record.careersUrl,
        extractionRoute: record.extractionRoute,
        recommendation: record.recommendation,
      })),
    blockedOrFragile: records
      .filter((record) => record.feasibility === "BLOCKED" || record.feasibility === "FRAGILE")
      .map((record) => ({
        companyName: record.companyName,
        feasibility: record.feasibility,
        recommendation: record.recommendation,
      })),
    persistence: options.persistence,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, rawValue] = arg.slice(2).split("=", 2);
    if (!key) continue;

    const value = rawValue ?? "true";
    if (value === "true") {
      (args as Record<string, boolean>)[key] = true;
    } else if (value === "false") {
      (args as Record<string, boolean>)[key] = false;
    } else if (/^\d+$/.test(value)) {
      (args as Record<string, number>)[key] = Number(value);
    } else {
      (args as Record<string, string>)[key] = value;
    }
  }

  return args;
}

async function getPrisma() {
  if (!loadedPrisma) {
    const db = await import("../src/lib/db");
    loadedPrisma = db.prisma;
  }
  return loadedPrisma;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await loadedPrisma?.$disconnect();
  });
