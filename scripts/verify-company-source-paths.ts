import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import {
  FIRST_PARTY_COMPANY_SEEDS_PATH,
  readFirstPartyCompanySeeds,
  selectFirstPartyCompanySeeds,
  splitCompanySelection,
  type FirstPartyCompanySeed,
} from "../src/lib/ingestion/official-company-seeds";
import {
  createCompanySiteConnector,
  inspectCompanySiteRoute,
} from "../src/lib/ingestion/connectors";
import {
  buildDiscoveredSourceName,
  discoverSourceCandidatesFromPageUrls,
  discoverSourceCandidatesFromUrls,
  previewSourceCandidates,
  type DiscoveredSourceCandidate,
  type SourceDiscoveryPreviewResult,
} from "../src/lib/ingestion/discovery/sources";
import { ensureCompanyRecord } from "../src/lib/ingestion/company-records";
import { upsertCompanySourceByIdentity } from "../src/lib/ingestion/company-source-upsert";
import { enqueueUniqueSourceTask } from "../src/lib/ingestion/task-queue";
import type { ExtractionRouteKind, Prisma } from "../src/generated/prisma/client";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";
import {
  isClearlyNonJobContentUrl,
  isClearlyNonJobPosting,
} from "../src/lib/job-integrity";

type Args = {
  file: string;
  companies?: string;
  priorityTier?: number;
  limit: number;
  concurrency: number;
  previewLimit: number;
  apply: boolean;
  out: string;
};

type SourceDecision =
  | "ALREADY_GOOD"
  | "PROMOTE_ATS"
  | "PROMOTE_COMPANY_JSON"
  | "PROMOTE_COMPANY_SITEMAP"
  | "PROMOTE_COMPANY_HTML"
  | "SOURCE_GOOD_VISIBILITY_GAP"
  | "BLOCKED"
  | "GENERIC_CAREERS_PAGE"
  | "INVALID"
  | "NEEDS_CUSTOM_CONNECTOR"
  | "NO_CANDIDATE";

type CompanyRow = Awaited<ReturnType<typeof loadCompanyByKey>>;

type CompanySiteCandidate = {
  inputUrl: string;
  finalUrl: string;
  extractionRoute: ExtractionRouteKind;
  parserVersion: string;
  confidence: number;
  jobsFound: number;
  sampleTitles: string[];
  sampleLocations: string[];
  error: string | null;
};

type VerificationRecord = {
  companyName: string;
  companyKey: string;
  rank: number;
  priorityTier: number;
  decision: SourceDecision;
  applied: boolean;
  visibleLive: number;
  canonicalLive: number;
  currentCareersUrl: string | null;
  seedCareersUrl: string;
  candidateUrls: string[];
  currentSources: Array<{
    sourceName: string;
    connectorName: string;
    boardUrl: string;
    status: string;
    validationState: string;
    pollState: string;
    retainedLiveJobCount: number;
    jobsCreatedCount: number;
    validationMessage: string | null;
  }>;
  bestAts: SourceDiscoveryPreviewResult | null;
  bestCompanySite: CompanySiteCandidate | null;
  errors: string[];
  action: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: FIRST_PARTY_COMPANY_SEEDS_PATH,
    limit: 200,
    concurrency: 6,
    previewLimit: 3,
    apply: false,
    out: "data/discovery/reports/company-source-path-verification.json",
  };

  for (const rawArg of argv) {
    const arg = rawArg.replace(/^--/, "");
    if (arg === "apply") {
      args.apply = true;
      continue;
    }

    const [key, value] = arg.split("=");
    if (value == null) continue;
    if (key === "file") args.file = value;
    if (key === "companies") args.companies = value;
    if (key === "priority-tier") args.priorityTier = readPositiveInteger(value, key);
    if (key === "limit") args.limit = readPositiveInteger(value, key);
    if (key === "concurrency") args.concurrency = readPositiveInteger(value, key);
    if (key === "preview-limit") args.previewLimit = readPositiveInteger(value, key);
    if (key === "out") args.out = value;
  }

  return args;
}

function readPositiveInteger(value: string, key: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value "${value}"`);
  }
  return parsed;
}

function dedupeSeedsByCompanyKey(seeds: FirstPartyCompanySeed[]) {
  const seen = new Set<string>();
  const unique: FirstPartyCompanySeed[] = [];
  for (const seed of seeds) {
    if (seen.has(seed.companyKey)) continue;
    seen.add(seed.companyKey);
    unique.push(seed);
  }
  return unique;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = await readFirstPartyCompanySeeds(args.file);
  const selectedSeeds = dedupeSeedsByCompanyKey(
    selectFirstPartyCompanySeeds(seeds, {
      companies: splitCompanySelection(args.companies),
      priorityTier: args.priorityTier,
      limit: args.limit,
    })
  );
  const records = new Array<VerificationRecord>(selectedSeeds.length);
  let cursor = 0;

  async function worker() {
    while (cursor < selectedSeeds.length) {
      const index = cursor;
      cursor += 1;
      const seed = selectedSeeds[index]!;
      records[index] = await verifySeed(seed, args);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, selectedSeeds.length) }, () =>
      worker()
    )
  );

  const report = {
    generatedAt: new Date().toISOString(),
    apply: args.apply,
    selectedCount: selectedSeeds.length,
    summary: summarize(records),
    records,
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ out: outPath, ...report.summary }, null, 2));
}

async function verifySeed(
  seed: FirstPartyCompanySeed,
  args: Args
): Promise<VerificationRecord> {
  const company = await loadCompanyByKey(seed.companyKey);
  const candidateUrls = collectCandidateUrls(seed, company);
  const currentSources = company?.sources ?? [];
  const currentSourceSummary = currentSources.map((source) => ({
    sourceName: source.sourceName,
    connectorName: source.connectorName,
    boardUrl: source.boardUrl,
    status: source.status,
    validationState: source.validationState,
    pollState: source.pollState,
    retainedLiveJobCount: source.retainedLiveJobCount,
    jobsCreatedCount: source.jobsCreatedCount,
    validationMessage: source.validationMessage,
  }));
  const visibleLive = company
    ? await prisma.jobFeedIndex.count({
        where: {
          status: "LIVE",
          canonicalJob: { companyId: company.id },
        },
      })
    : 0;
  const canonicalLive = company
    ? await prisma.jobCanonical.count({
        where: { companyId: company.id, status: "LIVE" },
      })
    : 0;
  const errors: string[] = [];

  if (hasGoodCurrentSource(currentSources, visibleLive)) {
    if (args.apply && company) {
      await repairSafeCompanyAliasesForSeed({
        canonicalCompanyId: company.id,
        seedCompanyName: seed.companyName,
        seedCompanyKey: seed.companyKey,
        now: new Date(),
      });
    }
    return buildRecord({
      seed,
      company,
      candidateUrls,
      currentSources: currentSourceSummary,
      visibleLive,
      canonicalLive,
      bestAts: null,
      bestCompanySite: null,
      decision: "ALREADY_GOOD",
      applied: false,
      errors,
      action: "Existing validated source already retains and displays live jobs.",
    });
  }

  if (hasRetainedJobsButNoVisibleJobs(currentSources, visibleLive)) {
    if (args.apply && company) {
      await repairSafeCompanyAliasesForSeed({
        canonicalCompanyId: company.id,
        seedCompanyName: seed.companyName,
        seedCompanyKey: seed.companyKey,
        now: new Date(),
      });
    }
    return buildRecord({
      seed,
      company,
      candidateUrls,
      currentSources: currentSourceSummary,
      visibleLive,
      canonicalLive,
      bestAts: null,
      bestCompanySite: null,
      decision: "SOURCE_GOOD_VISIBILITY_GAP",
      applied: false,
      errors,
      action: explainDecision("SOURCE_GOOD_VISIBILITY_GAP"),
    });
  }

  const { bestAts, discoveryErrors } = await findBestAtsCandidate(
    candidateUrls,
    args.previewLimit
  );
  errors.push(...discoveryErrors);
  const companySiteCandidates = await inspectCompanySiteCandidates(
    seed,
    candidateUrls,
    args.previewLimit
  );
  errors.push(
    ...companySiteCandidates
      .map((candidate) => candidate.error)
      .filter((value): value is string => Boolean(value))
  );
  const bestCompanySite = chooseBestCompanySiteCandidate(companySiteCandidates);

  const decision = chooseDecision({
    bestAts,
    bestCompanySite,
    currentSources,
    visibleLive,
    canonicalLive,
    errors,
    candidateUrls,
  });
  const action = explainDecision(decision);
  let applied = false;

  if (args.apply && company && shouldApplyDecision(decision)) {
    if (bestAts && decision === "PROMOTE_ATS") {
      await promoteAtsSource({ seed, company, candidate: bestAts });
      applied = true;
    } else if (bestCompanySite) {
      await promoteCompanySiteSource({ seed, company, candidate: bestCompanySite });
      applied = true;
    }
  } else if (args.apply && !company && shouldApplyDecision(decision)) {
    const created = await ensureCompanyRecord({
      companyName: seed.companyName,
      companyKey: seed.companyKey,
      urls: candidateUrls,
      careersUrl: seed.careersUrl,
      detectedAts: bestAts?.connectorName ?? "company-site",
      discoveryStatus: "DISCOVERED",
      crawlStatus: "IDLE",
      discoveryConfidence: 0.8,
      metadataJson: {
        sourcePathVerification: {
          createdAt: new Date().toISOString(),
          decision,
        },
      },
    });

    if (bestAts && decision === "PROMOTE_ATS") {
      await promoteAtsSource({ seed, company: created, candidate: bestAts });
      applied = true;
    } else if (bestCompanySite) {
      await promoteCompanySiteSource({ seed, company: created, candidate: bestCompanySite });
      applied = true;
    }
  }

  return buildRecord({
    seed,
    company,
    candidateUrls,
    currentSources: currentSourceSummary,
    visibleLive,
    canonicalLive,
    bestAts,
    bestCompanySite,
    decision,
    applied,
    errors,
    action,
  });
}

async function loadCompanyByKey(companyKey: string) {
  return prisma.company.findUnique({
    where: { companyKey },
    select: {
      id: true,
      name: true,
      companyKey: true,
      careersUrl: true,
      domain: true,
      metadataJson: true,
      sources: {
        select: {
          id: true,
          sourceName: true,
          connectorName: true,
          token: true,
          boardUrl: true,
          status: true,
          validationState: true,
          pollState: true,
          sourceType: true,
          extractionRoute: true,
          parserVersion: true,
          retainedLiveJobCount: true,
          jobsCreatedCount: true,
          validationMessage: true,
        },
      },
    },
  });
}

function collectCandidateUrls(seed: FirstPartyCompanySeed, company: CompanyRow) {
  const metadata =
    company?.metadataJson &&
    typeof company.metadataJson === "object" &&
    !Array.isArray(company.metadataJson)
      ? (company.metadataJson as Record<string, unknown>)
      : {};
  const urls = [
    seed.careersUrl,
    company?.careersUrl,
    ...readStringArray(metadata.sourceCareerUrls),
    ...readStringArray(metadata.seedPageUrls),
    ...(company?.sources.map((source) => source.boardUrl) ?? []),
  ];

  if (company?.domain) {
    urls.push(`https://${company.domain}/careers`);
    urls.push(`https://${company.domain}/jobs`);
    urls.push(`https://${company.domain}/careers/search`);
  }

  return Array.from(
    new Set(
      urls
        .map((url) => normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
    )
  ).slice(0, 12);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasGoodCurrentSource(sources: NonNullable<CompanyRow>["sources"], visibleLive: number) {
  if (visibleLive <= 0) return false;
  return sources.some(
    (source) =>
      ["ACTIVE", "PROVISIONED", "DEGRADED"].includes(source.status) &&
      source.validationState === "VALIDATED" &&
      source.pollState !== "DISABLED" &&
      source.pollState !== "QUARANTINED" &&
      source.retainedLiveJobCount > 0
  );
}

function hasRetainedJobsButNoVisibleJobs(
  sources: NonNullable<CompanyRow>["sources"],
  visibleLive: number
) {
  return (
    visibleLive <= 0 &&
    sources.some(
      (source) =>
        ["ACTIVE", "PROVISIONED", "DEGRADED"].includes(source.status) &&
        source.validationState === "VALIDATED" &&
        source.pollState !== "DISABLED" &&
        source.pollState !== "QUARANTINED" &&
        source.retainedLiveJobCount > 0
    )
  );
}

async function findBestAtsCandidate(urls: string[], previewLimit: number) {
  const discoveryErrors: string[] = [];
  const direct = await discoverSourceCandidatesFromUrls(urls);
  for (const report of direct.reports) {
    discoveryErrors.push(...report.errors.map((error) => `${report.inputUrl}: ${error}`));
  }

  const firstPartyUrls = urls.filter((url) => !isKnownAtsUrl(url));
  const page = await discoverSourceCandidatesFromPageUrls(firstPartyUrls, {
    concurrency: 4,
  });
  for (const report of page.reports) {
    discoveryErrors.push(...report.errors.map((error) => `${report.pageUrl}: ${error}`));
  }

  const candidatesByKey = new Map<string, DiscoveredSourceCandidate>();
  for (const candidate of [...direct.candidates, ...page.candidates]) {
    candidatesByKey.set(candidate.sourceKey, {
      ...candidate,
      sourceName: buildDiscoveredSourceName(candidate.connectorName, candidate.token),
    });
  }

  const previews = await previewSourceCandidates(
    [...candidatesByKey.values()],
    previewLimit
  );
  const viable = previews.filter(isViableAtsPreview);
  return {
    bestAts: viable[0] ?? null,
    discoveryErrors,
  };
}

function isKnownAtsUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return [
      "ashbyhq.com",
      "greenhouse.io",
      "job-boards.greenhouse.io",
      "lever.co",
      "myworkdayjobs.com",
      "myworkdaysite.com",
      "smartrecruiters.com",
      "icims.com",
      "taleo.net",
      "successfactors.com",
      "successfactors.eu",
      "oraclecloud.com",
      "workable.com",
      "jobvite.com",
      "teamtailor.com",
      "recruitee.com",
      "rippling.com",
    ].some((hint) => host === hint || host.endsWith(`.${hint}`));
  } catch {
    return false;
  }
}

function isViableAtsPreview(preview: SourceDiscoveryPreviewResult) {
  if (preview.error) return false;
  if (preview.acceptedCount > 0) return true;
  return preview.existingLiveCanonicalCount > 0;
}

async function inspectCompanySiteCandidates(
  seed: FirstPartyCompanySeed,
  urls: string[],
  previewLimit: number
) {
  const candidates: CompanySiteCandidate[] = [];
  for (const inputUrl of urls.filter((url) => !isKnownAtsUrl(url)).slice(0, 8)) {
    try {
      const inspection = await inspectCompanySiteRoute(inputUrl);
      if (inspection.extractionRoute === "UNKNOWN") {
        candidates.push({
          inputUrl,
          finalUrl: inspection.finalUrl,
          extractionRoute: inspection.extractionRoute,
          parserVersion: inspection.parserVersion,
          confidence: inspection.confidence,
          jobsFound: 0,
          sampleTitles: [],
          sampleLocations: [],
          error: readMetadataReason(inspection.metadata) ?? "No stable job listing route found.",
        });
        continue;
      }

      const connector = createCompanySiteConnector({
        sourceName:
          inspection.extractionRoute === "HTML_FALLBACK"
            ? `CompanyHtml:${seed.companyKey}`
            : `CompanyJson:${seed.companyKey}`,
        companyName: seed.companyName,
        boardUrl: inspection.finalUrl,
        extractionRoute: inspection.extractionRoute,
        parserVersion: inspection.parserVersion,
      });
      const result = await connector.fetchJobs({
        now: new Date(),
        limit: previewLimit,
        log: () => {},
      });

      const concreteJobs = result.jobs.filter(isConcreteJobSample);
      candidates.push({
        inputUrl,
        finalUrl: inspection.finalUrl,
        extractionRoute: inspection.extractionRoute,
        parserVersion: inspection.parserVersion,
        confidence: inspection.confidence,
        jobsFound: concreteJobs.length,
        sampleTitles: concreteJobs.map((job) => job.title).filter(Boolean).slice(0, 5),
        sampleLocations: concreteJobs
          .map((job) => job.location)
          .filter(Boolean)
          .slice(0, 5),
        error:
          concreteJobs.length > 0
            ? null
            : result.jobs.length > 0
              ? "Route produced generic/non-job samples, not concrete job postings."
              : "Route inspected but produced no sample jobs.",
      });
    } catch (error) {
      candidates.push({
        inputUrl,
        finalUrl: inputUrl,
        extractionRoute: "UNKNOWN",
        parserVersion: "company-site:v4",
        confidence: 0,
        jobsFound: 0,
        sampleTitles: [],
        sampleLocations: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return candidates;
}

function isConcreteJobSample(job: SourceConnectorJob) {
  const title = job.title.trim();
  if (title.length < 5) return false;
  if (
    /^(?:careers?|jobs?|open positions?|current openings?|current opportunities|job search|search jobs?|join us|join our team|life at .+|why .+|benefits|application steps?|faqs?|come find purpose)/i.test(
      title
    )
  ) {
    return false;
  }
  if (
    /\b(?:application steps and faqs|come find purpose|career site|talent community|general application|future opportunities)\b/i.test(
      title
    )
  ) {
    return false;
  }
  return !isClearlyNonJobPosting({
    title,
    description: job.description,
    applyUrl: job.applyUrl || job.sourceUrl,
  });
}

function readMetadataReason(metadata: Record<string, Prisma.InputJsonValue | null>) {
  const reason = metadata.notAJobSourceReason ?? metadata.fallbackReason;
  return typeof reason === "string" ? reason : null;
}

function chooseBestCompanySiteCandidate(candidates: CompanySiteCandidate[]) {
  return candidates
    .filter(
      (candidate) =>
        candidate.jobsFound > 0 &&
        !isClearlyNonJobContentUrl(candidate.finalUrl) &&
        !/(?:sitemap-(?:customers?|resources?|videos?)|\/resources\/|\/videos\/)/i.test(
          candidate.finalUrl
        )
    )
    .sort((left, right) => scoreCompanySite(right) - scoreCompanySite(left))[0] ?? null;
}

function scoreCompanySite(candidate: CompanySiteCandidate) {
  let score = candidate.jobsFound * 10 + candidate.confidence * 100;
  if (candidate.extractionRoute === "STRUCTURED_API") score += 40;
  if (candidate.extractionRoute === "STRUCTURED_JSON") score += 35;
  if (candidate.extractionRoute === "STRUCTURED_SITEMAP") score += 25;
  if (candidate.extractionRoute === "HTML_FALLBACK") score -= 15;
  return score;
}

function chooseDecision(input: {
  bestAts: SourceDiscoveryPreviewResult | null;
  bestCompanySite: CompanySiteCandidate | null;
  currentSources: NonNullable<CompanyRow>["sources"];
  visibleLive: number;
  canonicalLive: number;
  errors: string[];
  candidateUrls: string[];
}): SourceDecision {
  if (input.bestAts) return "PROMOTE_ATS";
  if (input.bestCompanySite) {
    if (input.bestCompanySite.extractionRoute === "STRUCTURED_SITEMAP") {
      return "PROMOTE_COMPANY_SITEMAP";
    }
    if (input.bestCompanySite.extractionRoute === "HTML_FALLBACK") {
      return "PROMOTE_COMPANY_HTML";
    }
    return "PROMOTE_COMPANY_JSON";
  }
  if (input.visibleLive <= 0 && input.currentSources.some((source) => source.retainedLiveJobCount > 0)) {
    return "SOURCE_GOOD_VISIBILITY_GAP";
  }
  if (input.errors.some(isBlockedError)) return "BLOCKED";
  if (input.candidateUrls.length === 0) return "NO_CANDIDATE";
  if (input.errors.some((error) => /\b(404|410|not found|non-job-content-url)\b/i.test(error))) {
    return "INVALID";
  }
  if (input.errors.some((error) => /career-surface|no sample jobs|no stable job/i.test(error))) {
    return "GENERIC_CAREERS_PAGE";
  }
  return "NEEDS_CUSTOM_CONNECTOR";
}

function isBlockedError(error: string) {
  return /\b(401|403|429|blocked|forbidden|access denied|too many requests)\b/i.test(error);
}

function explainDecision(decision: SourceDecision) {
  switch (decision) {
    case "ALREADY_GOOD":
      return "Keep current source; it is validated and visible jobs exist.";
    case "PROMOTE_ATS":
      return "Promote direct ATS candidate and queue connector polling.";
    case "PROMOTE_COMPANY_JSON":
      return "Promote official structured company JSON/API source and queue polling.";
    case "PROMOTE_COMPANY_SITEMAP":
      return "Promote official sitemap-backed company source and queue polling.";
    case "PROMOTE_COMPANY_HTML":
      return "Promote official HTML listing source; acceptable but lower quality than structured feeds.";
    case "SOURCE_GOOD_VISIBILITY_GAP":
      return "Source retains jobs but visible board count is zero; inspect visibility/indexing rules.";
    case "BLOCKED":
      return "Source appears official but is blocked from ingestion host; needs approved/custom access path.";
    case "GENERIC_CAREERS_PAGE":
      return "Careers page is reachable but does not expose real job-specific listings.";
    case "INVALID":
      return "Candidate source is invalid or not a job source.";
    case "NO_CANDIDATE":
      return "No usable candidate source URL is known.";
    case "NEEDS_CUSTOM_CONNECTOR":
      return "No generic connector can extract this company reliably; add a custom connector.";
  }
}

function shouldApplyDecision(decision: SourceDecision) {
  return [
    "PROMOTE_ATS",
    "PROMOTE_COMPANY_JSON",
    "PROMOTE_COMPANY_SITEMAP",
    "PROMOTE_COMPANY_HTML",
  ].includes(decision);
}

async function promoteAtsSource(input: {
  seed: FirstPartyCompanySeed;
  company: { id: string };
  candidate: SourceDiscoveryPreviewResult;
}) {
  const now = new Date();
  const sourceName = buildDiscoveredSourceName(
    input.candidate.connectorName,
    input.candidate.token
  );
  const companySource = await upsertCompanySourceByIdentity({
    identity: {
      companyId: input.company.id,
      sourceName,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
    },
    create: {
      companyId: input.company.id,
      sourceName,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
      boardUrl: input.candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "VALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "source-verification:v1",
      pollingCadenceMinutes: 180,
      priorityScore: 0.98,
      sourceQualityScore: 0.9,
      yieldScore: 0.7,
      firstSeenAt: now,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: now,
      validationMessage: "Promoted by source path verification after previewing real jobs.",
      metadataJson: buildPromotionMetadata(input.seed, input.candidate),
    },
    update: {
      companyId: input.company.id,
      sourceName,
      connectorName: input.candidate.connectorName,
      token: input.candidate.token,
      boardUrl: input.candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "VALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "source-verification:v1",
      pollingCadenceMinutes: 180,
      priorityScore: 0.98,
      sourceQualityScore: 0.9,
      yieldScore: 0.7,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: now,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: "Promoted by source path verification after previewing real jobs.",
      metadataJson: buildPromotionMetadata(input.seed, input.candidate),
    },
  });
  const ownedCompanySource = await ensurePromotedSourceOwnership({
    companySourceId: companySource.id,
    companyId: input.company.id,
    seedCompanyName: input.seed.companyName,
    seedCompanyKey: input.seed.companyKey,
    sourceName,
    connectorName: input.candidate.connectorName,
    token: input.candidate.token,
    boardUrl: input.candidate.boardUrl,
    sourceType: "ATS",
    extractionRoute: "ATS_NATIVE",
    parserVersion: "source-verification:v1",
    qualityScore: 0.9,
    yieldScore: 0.7,
    now,
  });

  await enqueueUniqueSourceTask({
    kind: "CONNECTOR_POLL",
    companyId: ownedCompanySource.companyId,
    companySourceId: ownedCompanySource.id,
    priorityScore: 98,
    notBeforeAt: now,
    payloadJson: { origin: "source_path_verification", sourceName },
  });
}

async function promoteCompanySiteSource(input: {
  seed: FirstPartyCompanySeed;
  company: { id: string };
  candidate: CompanySiteCandidate;
}) {
  const now = new Date();
  const isHtml = input.candidate.extractionRoute === "HTML_FALLBACK";
  const sourceName = isHtml
    ? `CompanyHtml:${input.seed.companyKey}`
    : `CompanyJson:${input.seed.companyKey}`;
  const quality = isHtml ? 0.58 : 0.84;
  const companySource = await upsertCompanySourceByIdentity({
    identity: {
      companyId: input.company.id,
      sourceName,
      connectorName: "company-site",
      token: input.seed.companyKey,
    },
    create: {
      companyId: input.company.id,
      sourceName,
      connectorName: "company-site",
      token: input.seed.companyKey,
      boardUrl: input.candidate.finalUrl,
      status: "PROVISIONED",
      validationState: "VALIDATED",
      pollState: "READY",
      sourceType: isHtml ? "COMPANY_HTML" : "COMPANY_JSON",
      extractionRoute: input.candidate.extractionRoute,
      parserVersion: input.candidate.parserVersion,
      pollingCadenceMinutes: isHtml ? 360 : 180,
      priorityScore: Math.max(0.74, input.candidate.confidence),
      sourceQualityScore: quality,
      yieldScore: quality * 0.7,
      firstSeenAt: now,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: now,
      validationMessage: "Promoted by source path verification after previewing real jobs.",
      metadataJson: buildCompanySitePromotionMetadata(input.seed, input.candidate),
    },
    update: {
      companyId: input.company.id,
      sourceName,
      connectorName: "company-site",
      token: input.seed.companyKey,
      boardUrl: input.candidate.finalUrl,
      status: "PROVISIONED",
      validationState: "VALIDATED",
      pollState: "READY",
      sourceType: isHtml ? "COMPANY_HTML" : "COMPANY_JSON",
      extractionRoute: input.candidate.extractionRoute,
      parserVersion: input.candidate.parserVersion,
      pollingCadenceMinutes: isHtml ? 360 : 180,
      priorityScore: Math.max(0.74, input.candidate.confidence),
      sourceQualityScore: quality,
      yieldScore: quality * 0.7,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: now,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: "Promoted by source path verification after previewing real jobs.",
      metadataJson: buildCompanySitePromotionMetadata(input.seed, input.candidate),
    },
  });
  const ownedCompanySource = await ensurePromotedSourceOwnership({
    companySourceId: companySource.id,
    companyId: input.company.id,
    seedCompanyName: input.seed.companyName,
    seedCompanyKey: input.seed.companyKey,
    sourceName,
    connectorName: "company-site",
    token: input.seed.companyKey,
    boardUrl: input.candidate.finalUrl,
    sourceType: isHtml ? "COMPANY_HTML" : "COMPANY_JSON",
    extractionRoute: input.candidate.extractionRoute,
    parserVersion: input.candidate.parserVersion,
    qualityScore: quality,
    yieldScore: quality * 0.7,
    now,
  });

  await enqueueUniqueSourceTask({
    kind: "CONNECTOR_POLL",
    companyId: ownedCompanySource.companyId,
    companySourceId: ownedCompanySource.id,
    priorityScore: Math.round(Math.max(0.74, input.candidate.confidence) * 100),
    notBeforeAt: now,
    payloadJson: { origin: "source_path_verification", sourceName },
  });
}

async function ensurePromotedSourceOwnership(input: {
  companySourceId: string;
  companyId: string;
  seedCompanyName: string;
  seedCompanyKey: string;
  sourceName: string;
  connectorName: string;
  token: string;
  boardUrl: string;
  sourceType: string;
  extractionRoute: ExtractionRouteKind;
  parserVersion: string;
  qualityScore: number;
  yieldScore: number;
  now: Date;
}) {
  const current = await prisma.companySource.findUnique({
    where: { id: input.companySourceId },
    select: {
      companyId: true,
      company: {
        select: {
          name: true,
          companyKey: true,
        },
      },
    },
  });
  const shouldRepairOwner =
    !current ||
    current.companyId === input.companyId ||
    isSuspiciousSourceOwner({
      ownerName: current.company.name,
      ownerCompanyKey: current.company.companyKey,
      seedCompanyName: input.seedCompanyName,
      seedCompanyKey: input.seedCompanyKey,
    });
  const data: Prisma.CompanySourceUncheckedUpdateInput = {
    ...(shouldRepairOwner ? { companyId: input.companyId } : {}),
    sourceName: input.sourceName,
    connectorName: input.connectorName,
    token: input.token,
    boardUrl: input.boardUrl,
    status: "PROVISIONED",
    validationState: "VALIDATED",
    pollState: "READY",
    sourceType: input.sourceType,
    extractionRoute: input.extractionRoute,
    parserVersion: input.parserVersion,
    priorityScore: 0.98,
    sourceQualityScore: input.qualityScore,
    yieldScore: input.yieldScore,
    lastProvisionedAt: input.now,
    lastDiscoveryAt: input.now,
    lastValidatedAt: input.now,
    lastHttpStatus: null,
    consecutiveFailures: 0,
    failureStreak: 0,
    validationMessage:
      "Promoted by source path verification after previewing real jobs.",
  };

  const updated = await prisma.companySource.update({
    where: { id: input.companySourceId },
    data,
  });

  await repairSafeCompanyAliasesForSeed({
    canonicalCompanyId: input.companyId,
    seedCompanyName: input.seedCompanyName,
    seedCompanyKey: input.seedCompanyKey,
    now: input.now,
  });

  return updated;
}

function isSuspiciousSourceOwner(input: {
  ownerName: string;
  ownerCompanyKey: string;
  seedCompanyName: string;
  seedCompanyKey: string;
}) {
  const ownerName = input.ownerName.toLowerCase();
  const ownerKey = input.ownerCompanyKey.toLowerCase();
  const seedKey = input.seedCompanyKey.toLowerCase();
  const seedName = input.seedCompanyName.toLowerCase();

  if (ownerKey === seedKey) return false;
  if (ownerName === seedName) return false;
  if (
    isSafeCompanyAlias({
      ownerName,
      ownerCompanyKey: ownerKey,
      seedName,
      seedCompanyKey: seedKey,
    })
  ) {
    return true;
  }
  if (/\b(?:backer|raises|raised|stock|shares|acquires|acquired|merger|ipo|news)\b/i.test(ownerName)) {
    return true;
  }
  if (/\b(?:corp|inc|plc|ltd)\s*\/de\b/i.test(ownerName)) {
    return true;
  }
  if (ownerKey.includes(seedKey) && ownerKey.length > seedKey.length + 18) {
    return true;
  }

  return false;
}

async function repairSafeCompanyAliasesForSeed(input: {
  canonicalCompanyId: string;
  seedCompanyName: string;
  seedCompanyKey: string;
  now: Date;
}) {
  const canonical = await prisma.company.findUnique({
    where: { id: input.canonicalCompanyId },
    select: { id: true, name: true, companyKey: true },
  });
  if (!canonical) return;

  const seedBase = stripCompanyAliasSuffixes(input.seedCompanyKey);
  if (seedBase.length < 5) return;

  const candidates = await prisma.company.findMany({
    where: {
      id: { not: canonical.id },
      OR: [
        { companyKey: { contains: seedBase, mode: "insensitive" } },
        { name: { contains: seedBase, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, companyKey: true },
    take: 50,
  });
  const aliases = candidates.filter((candidate) =>
    isSafeCompanyAlias({
      ownerName: candidate.name,
      ownerCompanyKey: candidate.companyKey,
      seedName: input.seedCompanyName,
      seedCompanyKey: input.seedCompanyKey,
    })
  );
  if (aliases.length === 0) return;

  const aliasIds = aliases.map((alias) => alias.id);
  await prisma.$transaction(async (tx) => {
    const movedJobs = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "JobCanonical"
      SET
        "companyId" = ${canonical.id},
        "company" = ${input.seedCompanyName},
        "companyKey" = ${input.seedCompanyKey},
        "updatedAt" = ${input.now}
      WHERE "companyId" = ANY(${aliasIds})
      RETURNING id
    `;
    const movedJobIds = movedJobs.map((job) => job.id);
    if (movedJobIds.length > 0) {
      await tx.jobFeedIndex.updateMany({
        where: { canonicalJobId: { in: movedJobIds } },
        data: {
          company: input.seedCompanyName,
          updatedAt: input.now,
        },
      });
    }

    const aliasSources = await tx.companySource.findMany({
      where: { companyId: { in: aliasIds } },
      select: { id: true, connectorName: true, token: true },
    });
    for (const source of aliasSources) {
      const conflict = await tx.companySource.findFirst({
        where: {
          companyId: canonical.id,
          connectorName: source.connectorName,
          token: source.token,
          id: { not: source.id },
        },
        select: { id: true },
      });
      if (conflict) continue;
      await tx.companySource.update({
        where: { id: source.id },
        data: { companyId: canonical.id },
      });
    }
  }, { timeout: 60000 });
}

function isSafeCompanyAlias(input: {
  ownerName: string;
  ownerCompanyKey: string;
  seedName: string;
  seedCompanyKey: string;
}) {
  const ownerBase = stripCompanyAliasSuffixes(input.ownerCompanyKey);
  const seedBase = stripCompanyAliasSuffixes(input.seedCompanyKey);
  if (ownerBase.length >= 5 && ownerBase === seedBase) {
    return true;
  }

  const ownerWords = new Set(extractCompanyWords(input.ownerName));
  const seedWords = new Set(extractCompanyWords(input.seedName));
  if (ownerWords.size === 0 || seedWords.size === 0) {
    return false;
  }

  const ownerMeaningfulWords = [...ownerWords].filter(
    (word) => !SAFE_ALIAS_WORDS.has(word)
  );
  const seedMeaningfulWords = [...seedWords].filter(
    (word) => !SAFE_ALIAS_WORDS.has(word)
  );
  if (ownerMeaningfulWords.length === 0 || seedMeaningfulWords.length === 0) {
    return false;
  }

  const shared = ownerMeaningfulWords.filter((word) => seedWords.has(word));
  const ownerOnly = ownerMeaningfulWords.filter((word) => !seedWords.has(word));
  const seedOnly = seedMeaningfulWords.filter((word) => !ownerWords.has(word));
  return (
    shared.length > 0 &&
    ownerOnly.every((word) => SAFE_ALIAS_WORDS.has(word)) &&
    seedOnly.every((word) => SAFE_ALIAS_WORDS.has(word))
  );
}

function stripCompanyAliasSuffixes(value: string) {
  let key = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SAFE_ALIAS_KEY_SUFFIXES) {
      if (key.length > suffix.length + 4 && key.endsWith(suffix)) {
        key = key.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return key;
}

function extractCompanyWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const SAFE_ALIAS_KEY_SUFFIXES = [
  "softwareprivate",
  "software",
  "technologies",
  "technology",
  "private",
  "limited",
  "systems",
  "labs",
  "group",
  "holdings",
  "inc",
  "corp",
  "corporation",
  "ltd",
  "llc",
  "plc",
  "company",
  "co",
  "tech",
  "ai",
  "ml",
];

const SAFE_ALIAS_WORDS = new Set([
  "ai",
  "ml",
  "software",
  "technology",
  "technologies",
  "systems",
  "labs",
  "group",
  "holdings",
  "inc",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "llc",
  "plc",
  "company",
  "co",
  "private",
]);

function buildPromotionMetadata(
  seed: FirstPartyCompanySeed,
  candidate: SourceDiscoveryPreviewResult
) {
  return {
    importSource: "source-path-verification",
    firstPartySeed: {
      rank: seed.rank,
      priorityTier: seed.priorityTier,
      careersUrl: seed.careersUrl,
    },
    preview: {
      fetchedCount: candidate.fetchedCount,
      acceptedCount: candidate.acceptedCount,
      sampleTitles: candidate.sampleTitles,
      sampleLocations: candidate.sampleLocations,
    },
  } satisfies Prisma.InputJsonValue;
}

function buildCompanySitePromotionMetadata(
  seed: FirstPartyCompanySeed,
  candidate: CompanySiteCandidate
) {
  return {
    importSource: "source-path-verification",
    firstPartySeed: {
      rank: seed.rank,
      priorityTier: seed.priorityTier,
      careersUrl: seed.careersUrl,
    },
    preview: {
      inputUrl: candidate.inputUrl,
      jobsFound: candidate.jobsFound,
      sampleTitles: candidate.sampleTitles,
      sampleLocations: candidate.sampleLocations,
    },
  } satisfies Prisma.InputJsonValue;
}

function buildRecord(input: {
  seed: FirstPartyCompanySeed;
  company: CompanyRow;
  candidateUrls: string[];
  currentSources: VerificationRecord["currentSources"];
  visibleLive: number;
  canonicalLive: number;
  bestAts: SourceDiscoveryPreviewResult | null;
  bestCompanySite: CompanySiteCandidate | null;
  decision: SourceDecision;
  applied: boolean;
  errors: string[];
  action: string;
}): VerificationRecord {
  return {
    companyName: input.seed.companyName,
    companyKey: input.seed.companyKey,
    rank: input.seed.rank,
    priorityTier: input.seed.priorityTier,
    decision: input.decision,
    applied: input.applied,
    visibleLive: input.visibleLive,
    canonicalLive: input.canonicalLive,
    currentCareersUrl: input.company?.careersUrl ?? null,
    seedCareersUrl: input.seed.careersUrl,
    candidateUrls: input.candidateUrls,
    currentSources: input.currentSources,
    bestAts: input.bestAts,
    bestCompanySite: input.bestCompanySite,
    errors: [...new Set(input.errors)].slice(0, 12),
    action: input.action,
  };
}

function summarize(records: VerificationRecord[]) {
  const byDecision: Record<string, number> = {};
  for (const record of records) {
    byDecision[record.decision] = (byDecision[record.decision] ?? 0) + 1;
  }

  return {
    byDecision,
    appliedCount: records.filter((record) => record.applied).length,
    promotionCandidates: records.filter((record) => shouldApplyDecision(record.decision))
      .length,
    blockedCount: records.filter((record) => record.decision === "BLOCKED").length,
    needsCustomConnectorCount: records.filter(
      (record) => record.decision === "NEEDS_CUSTOM_CONNECTOR"
    ).length,
    visibilityGapCount: records.filter(
      (record) => record.decision === "SOURCE_GOOD_VISIBILITY_GAP"
    ).length,
  };
}

main()
  .catch((error) => {
    console.error("[verify-company-source-paths] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
