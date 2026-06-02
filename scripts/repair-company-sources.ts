import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/db";
import type {
  CompanySource,
  CompanySourcePollState,
  CompanySourceStatus,
  CompanySourceValidationState,
  ExtractionRouteKind,
  Prisma,
} from "../src/generated/prisma/client";
import { promoteDiscoveredAtsCompanySource } from "../src/lib/ingestion/company-discovery";
import {
  buildDiscoveredSourceName,
  discoverSourceCandidatesFromPageUrls,
  discoverSourceCandidatesFromUrls,
  extractSourceCandidateFromUrl,
  type DiscoveredSourceCandidate,
} from "../src/lib/ingestion/discovery/sources";
import { validateCompanySource } from "../src/lib/ingestion/source-validator";

type Args = {
  apply: boolean;
  scanPages: boolean;
  repairOwners: boolean;
  limit: number;
  concurrency: number;
  minScore: number;
  out: string;
  companyKey: string | null;
  sourceName: string | null;
};

type RepairAction =
  | "PROMOTE_ATS"
  | "REPAIR_EXISTING_SOURCE_OWNER"
  | "SKIP_NO_CANDIDATE"
  | "SKIP_WEAK_OWNER_MATCH"
  | "SKIP_VALIDATION_FAILED"
  | "SKIP_EXISTING_SOURCE"
  | "SKIP_EXISTING_SOURCE_WRONG_OWNER"
  | "ERROR";

type SourceRow = CompanySource & {
  company: {
    id: string;
    name: string;
    companyKey: string;
    domain: string | null;
    careersUrl: string | null;
    discoveryConfidence: number;
    metadataJson: Prisma.JsonValue | null;
  };
};

type RepairRecord = {
  sourceName: string;
  company: string;
  companyKey: string;
  oldConnectorName: string;
  oldBoardUrl: string;
  oldState: {
    status: CompanySourceStatus;
    validationState: CompanySourceValidationState;
    pollState: CompanySourcePollState;
  };
  candidate: {
    connectorName: string;
    sourceName: string;
    token: string;
    boardUrl: string;
    evidenceUrls: string[];
  } | null;
  ownership: {
    score: number;
    reasons: string[];
  };
  validation: {
    kind: string;
    jobsFound: number;
    message: string;
  } | null;
  action: RepairAction;
  applied: boolean;
  promotedSourceId: string | null;
  existingSourceId: string | null;
  existingSourceCompany: string | null;
  existingSourceCompanyKey: string | null;
  error: string | null;
};

type ExistingSourceOwner = {
  id: string;
  companyId: string;
  sourceName: string;
  connectorName: string;
  token: string;
  company: {
    id: string;
    name: string;
    companyKey: string;
    domain: string | null;
    careersUrl: string | null;
    discoveryConfidence: number;
    metadataJson: Prisma.JsonValue | null;
  };
};

const BAD_STATES: CompanySourceValidationState[] = [
  "INVALID",
  "NEEDS_REDISCOVERY",
  "BLOCKED",
  "SUSPECT",
];

const GENERIC_ATS_TOKENS = new Set([
  "about",
  "apply",
  "career",
  "careers",
  "candidates",
  "community",
  "company",
  "general",
  "global",
  "international",
  "jobs",
  "join",
  "new",
  "opportunities",
  "search",
  "talent",
  "test",
  "work",
]);

const COMPANY_WORD_STOPWORDS = new Set([
  "and",
  "at",
  "canada",
  "career",
  "careers",
  "company",
  "corporation",
  "corp",
  "group",
  "holdings",
  "inc",
  "incorporated",
  "international",
  "jobs",
  "limited",
  "llc",
  "ltd",
  "page",
  "services",
  "solutions",
  "systems",
  "technologies",
  "technology",
  "the",
]);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    scanPages: false,
    repairOwners: true,
    limit: 100,
    concurrency: 4,
    minScore: 4,
    out: "data/discovery/reports/company-source-repair.json",
    companyKey: null,
    sourceName: null,
  };

  for (const rawArg of argv) {
    const arg = rawArg.replace(/^--/, "");
    if (arg === "apply") args.apply = true;
    else if (arg === "scan-pages") args.scanPages = true;
    else if (arg === "no-owner-repair") args.repairOwners = false;
    else {
      const [key, value] = arg.split("=");
      if (!value) continue;
      if (key === "limit") args.limit = readPositiveInteger(value, key);
      if (key === "concurrency") args.concurrency = readPositiveInteger(value, key);
      if (key === "min-score") args.minScore = readPositiveInteger(value, key);
      if (key === "out") args.out = value;
      if (key === "company-key") args.companyKey = value;
      if (key === "source-name") args.sourceName = value;
    }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = await loadRepairCandidates(args);
  const records = new Array<RepairRecord>(sources.length);
  let cursor = 0;

  async function worker() {
    while (cursor < sources.length) {
      const index = cursor;
      cursor += 1;
      records[index] = await repairSource(sources[index]!, args);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, sources.length) }, () => worker())
  );

  const summary = summarize(records);
  const report = {
    generatedAt: new Date().toISOString(),
    apply: args.apply,
    scanPages: args.scanPages,
    selectedCount: sources.length,
    summary,
    records,
  };

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ out: outPath, ...summary }, null, 2));
}

async function loadRepairCandidates(args: Args) {
  return prisma.companySource.findMany({
    where: {
      connectorName: "company-site",
      validationState: { in: BAD_STATES },
      ...(args.sourceName ? {} : { status: { not: "DISABLED" as CompanySourceStatus } }),
      ...(args.sourceName ? { sourceName: args.sourceName } : {}),
      ...(args.companyKey ? { company: { companyKey: args.companyKey } } : {}),
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          companyKey: true,
          domain: true,
          careersUrl: true,
          discoveryConfidence: true,
          metadataJson: true,
        },
      },
    },
    orderBy: [
      { retainedLiveJobCount: "desc" },
      { jobsCreatedCount: "desc" },
      { jobsFetchedCount: "desc" },
      { priorityScore: "desc" },
      { updatedAt: "desc" },
    ],
    take: args.limit,
  });
}

async function repairSource(source: SourceRow, args: Args): Promise<RepairRecord> {
  try {
    const candidateResult = await findBestCandidate(source, args);
    if (!candidateResult) {
      return buildRecord(source, {
        action: "SKIP_NO_CANDIDATE",
        candidate: null,
        ownership: { score: 0, reasons: [] },
      });
    }

    const ownership = scoreOwnership(source, candidateResult.candidate);
    if (ownership.score < args.minScore) {
      return buildRecord(source, {
        action: "SKIP_WEAK_OWNER_MATCH",
        candidate: candidateResult,
        ownership,
      });
    }

    const existingGood = await prisma.companySource.findFirst({
      where: {
        companyId: source.companyId,
        connectorName: candidateResult.candidate.connectorName,
        token: candidateResult.candidate.token,
        validationState: "VALIDATED",
        pollState: { in: ["READY", "ACTIVE", "BACKOFF"] },
      },
      select: { id: true },
    });
    if (existingGood) {
      if (args.apply) {
        await retireOldSource(source, candidateResult, null, new Date());
      }
      return buildRecord(source, {
        action: "SKIP_EXISTING_SOURCE",
        candidate: candidateResult,
        ownership,
        applied: args.apply,
      });
    }

    const existingWrongOwner = await findExistingSourceWrongOwner(source, candidateResult.candidate);
    if (existingWrongOwner) {
      if (!args.repairOwners) {
        return buildRecord(source, {
          action: "SKIP_EXISTING_SOURCE_WRONG_OWNER",
          candidate: candidateResult,
          ownership,
          existingSource: existingWrongOwner,
          error: `Owner repair disabled; existing source belongs to ${existingWrongOwner.company.name} (${existingWrongOwner.company.companyKey}).`,
        });
      }

      const existingOwnership = scoreOwnership(
        sourceFromExistingOwner(source, existingWrongOwner),
        candidateResult.candidate
      );
      const ownershipMargin = ownership.score - existingOwnership.score;
      const existingOwnerSuspicious = isSuspiciousExistingOwner(
        existingWrongOwner,
        candidateResult.candidate
      );
      if (
        ownership.score >= args.minScore &&
        (ownershipMargin >= 4 || (ownershipMargin > 0 && existingOwnerSuspicious))
      ) {
        const targetConflict = await findTargetIdentityConflict(source, candidateResult.candidate);
        if (targetConflict) {
          return buildRecord(source, {
            action: "SKIP_EXISTING_SOURCE_WRONG_OWNER",
            candidate: candidateResult,
            ownership,
            existingSource: existingWrongOwner,
            error: `Cannot move existing source ${existingWrongOwner.id}; target company already has ${targetConflict.sourceName}.`,
          });
        }

        const validation = await validateCandidate(source, candidateResult.candidate);
        if (!isUsableValidation(validation)) {
          return buildRecord(source, {
            action: "SKIP_VALIDATION_FAILED",
            candidate: candidateResult,
            ownership,
            validation: {
              kind: validation.kind,
              jobsFound: validation.jobsFound,
              message: validation.message,
            },
            existingSource: existingWrongOwner,
          });
        }

        if (args.apply) {
          const now = new Date();
          await repairExistingSourceOwner({
            source,
            existingSource: existingWrongOwner,
            candidate: candidateResult,
            validation,
            now,
          });
        }

        return buildRecord(source, {
          action: "REPAIR_EXISTING_SOURCE_OWNER",
          candidate: candidateResult,
          ownership,
          validation: {
            kind: validation.kind,
            jobsFound: validation.jobsFound,
            message: validation.message,
          },
          applied: args.apply,
          promotedSourceId: existingWrongOwner.id,
          existingSource: existingWrongOwner,
        });
      }

      return buildRecord(source, {
        action: "SKIP_EXISTING_SOURCE_WRONG_OWNER",
        candidate: candidateResult,
        ownership,
        existingSource: existingWrongOwner,
        error: `Existing source belongs to ${existingWrongOwner.company.name} (${existingWrongOwner.company.companyKey}); existing score ${existingOwnership.score}, target score ${ownership.score}, suspicious=${existingOwnerSuspicious}.`,
      });
    }

    const validation = await validateCandidate(source, candidateResult.candidate);
    if (!isUsableValidation(validation)) {
      return buildRecord(source, {
        action: "SKIP_VALIDATION_FAILED",
        candidate: candidateResult,
        ownership,
        validation: {
          kind: validation.kind,
          jobsFound: validation.jobsFound,
          message: validation.message,
        },
      });
    }

    let promotedSourceId: string | null = null;
    if (args.apply) {
      const now = new Date();
      const promoted = await promoteDiscoveredAtsCompanySource(
        source.companyId,
        {
          sourceName: candidateResult.candidate.sourceName,
          connectorName: candidateResult.candidate.connectorName,
          token: candidateResult.candidate.token,
          boardUrl: candidateResult.candidate.boardUrl,
          careerPageUrls: candidateResult.evidenceUrls,
          directAtsUrls: [candidateResult.candidate.input, candidateResult.candidate.boardUrl],
          matchedReasons: ["source-repair", ...ownership.reasons],
          metadataJson: {
            repairedFromSourceName: source.sourceName,
            repairedFromBoardUrl: source.boardUrl,
            repairEvidenceUrls: candidateResult.evidenceUrls,
            repairOwnershipScore: ownership.score,
            repairValidationMessage: validation.message,
          },
        },
        now
      );
      promotedSourceId = promoted.id;

      await prisma.companySource.update({
        where: { id: promoted.id },
        data: {
          validationState: validation.validationState,
          pollState: validation.pollState,
          status: "ACTIVE",
          sourceQualityScore: validation.sourceQualityScore,
          lastValidatedAt: now,
          validationSuccessCount: { increment: 1 },
          validationMessage: validation.message,
        },
      });
      await prisma.company.update({
        where: { id: source.companyId },
        data: {
          careersUrl: candidateResult.candidate.boardUrl,
          detectedAts: candidateResult.candidate.connectorName,
          discoveryStatus: "DISCOVERED",
          discoveryConfidence: Math.max(0.9, source.company.discoveryConfidence ?? 0),
          metadataJson: mergeCompanyRepairMetadata(
            source.company.metadataJson,
            source,
            candidateResult,
            now
          ) as Prisma.InputJsonValue,
        },
      });
      await retireOldSource(source, candidateResult, promoted.id, now);
    }

    return buildRecord(source, {
      action: "PROMOTE_ATS",
      candidate: candidateResult,
      ownership,
      validation: {
        kind: validation.kind,
        jobsFound: validation.jobsFound,
        message: validation.message,
      },
      applied: args.apply,
      promotedSourceId,
    });
  } catch (error) {
    return buildRecord(source, {
      action: "ERROR",
      candidate: null,
      ownership: { score: 0, reasons: [] },
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function findBestCandidate(source: SourceRow, args: Args) {
  const directUrls = collectCandidateUrls(source);
  const directDiscovery = await discoverSourceCandidatesFromUrls(directUrls);
  const pageDiscovery =
    args.scanPages && directUrls.length > 0
      ? await discoverSourceCandidatesFromPageUrls(directUrls, { concurrency: 3 })
      : { candidates: [], sourceMap: new Map() };

  const candidates = dedupeCandidates([
    ...directDiscovery.candidates,
    ...pageDiscovery.candidates,
  ]).filter((candidate) => candidate.connectorName !== "official-company");

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      evidenceUrls: collectEvidenceUrls(candidate, directDiscovery.sourceMap, pageDiscovery.sourceMap),
      ownership: scoreOwnership(source, candidate),
    }))
    .sort((left, right) => {
      if (right.ownership.score !== left.ownership.score) {
        return right.ownership.score - left.ownership.score;
      }
      return sourceRank(right.candidate.connectorName) - sourceRank(left.candidate.connectorName);
    });

  return ranked[0] ?? null;
}

function dedupeCandidates(candidates: DiscoveredSourceCandidate[]) {
  const byKey = new Map<string, DiscoveredSourceCandidate>();
  for (const candidate of candidates) {
    if (!byKey.has(candidate.sourceKey)) byKey.set(candidate.sourceKey, candidate);
  }
  return [...byKey.values()];
}

function collectEvidenceUrls(
  candidate: DiscoveredSourceCandidate,
  ...maps: Array<Map<string, Array<{ inputUrl?: string; pageUrl?: string; value: string }>>>
) {
  const urls = new Set<string>([candidate.input, candidate.boardUrl]);
  for (const map of maps) {
    for (const entry of map.get(candidate.sourceKey) ?? []) {
      urls.add(entry.inputUrl ?? entry.pageUrl ?? entry.value);
      urls.add(entry.value);
    }
  }
  return [...urls].filter(Boolean);
}

function collectCandidateUrls(source: SourceRow) {
  const metadata = asRecord(source.metadataJson);
  const companyMetadata = asRecord(source.company.metadataJson);
  const urls = new Set<string>();

  for (const value of [
    source.company.careersUrl,
    source.boardUrl,
    ...readStringArray(metadata.careerPageUrls),
    ...readStringArray(metadata.directAtsUrls),
    ...readStringArray(metadata.sourceCareerUrls),
    ...readStringArray(metadata.seedPageUrls),
    ...readStringArray(companyMetadata.sourceCareerUrls),
    ...readStringArray(companyMetadata.seedPageUrls),
    ...readStringArray(companyMetadata.directAtsUrls),
  ]) {
    if (value && /^https?:\/\//i.test(value)) urls.add(value);
  }

  return [...urls];
}

async function validateCandidate(source: SourceRow, candidate: DiscoveredSourceCandidate) {
  return validateCompanySource({
    sourceName: candidate.sourceName,
    connectorName: candidate.connectorName,
    token: candidate.token,
    boardUrl: candidate.boardUrl,
    sourceType: "ATS",
    extractionRoute: "ATS_NATIVE" as ExtractionRouteKind,
    parserVersion: "source-repair:v1",
    validationState: "UNVALIDATED",
    consecutiveFailures: 0,
    company: { name: source.company.name },
  });
}

function isUsableValidation(validation: Awaited<ReturnType<typeof validateCandidate>>) {
  return validation.kind === "VALIDATED" && validation.jobsFound > 0;
}

async function findExistingSourceWrongOwner(
  source: SourceRow,
  candidate: DiscoveredSourceCandidate
): Promise<ExistingSourceOwner | null> {
  const matches = await prisma.companySource.findMany({
    where: {
      companyId: { not: source.companyId },
      OR: [
        { sourceName: candidate.sourceName },
        { connectorName: candidate.connectorName, token: candidate.token },
      ],
      status: { not: "DISABLED" },
    },
    select: {
      id: true,
      companyId: true,
      sourceName: true,
      connectorName: true,
      token: true,
      company: {
        select: {
          id: true,
          name: true,
          companyKey: true,
          domain: true,
          careersUrl: true,
          discoveryConfidence: true,
          metadataJson: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  return (
    matches.find((match) => match.sourceName === candidate.sourceName) ??
    matches[0] ??
    null
  );
}

async function findTargetIdentityConflict(
  source: SourceRow,
  candidate: DiscoveredSourceCandidate
) {
  return prisma.companySource.findFirst({
    where: {
      companyId: source.companyId,
      connectorName: candidate.connectorName,
      token: candidate.token,
    },
    select: { id: true, sourceName: true },
  });
}

function sourceFromExistingOwner(
  source: SourceRow,
  existingSource: ExistingSourceOwner
): SourceRow {
  return {
    ...source,
    companyId: existingSource.companyId,
    company: existingSource.company,
  };
}

function isSuspiciousExistingOwner(
  existingSource: ExistingSourceOwner,
  candidate: DiscoveredSourceCandidate
) {
  const key = normalizeCompact(existingSource.company.companyKey);
  const name = normalizeCompact(existingSource.company.name);
  const tokenParts = extractTokenParts(candidate);
  const tokenNorm = normalizeCompact(tokenParts.join(""));

  if (key === normalizeCompact(candidate.connectorName)) return true;
  if (key === tokenNorm && tokenParts.some((part) => GENERIC_ATS_TOKENS.has(part))) return true;
  if (key.includes("careers") || key.includes("jobs")) return true;
  if (name.includes("careers") || name.includes("jobs")) return true;

  const metadata = asRecord(existingSource.company.metadataJson);
  const seedSource = typeof metadata.seedSource === "string" ? metadata.seedSource : "";
  const sourceName = typeof metadata.sourceName === "string" ? metadata.sourceName : "";
  if (seedSource === "existing-ats-source" && sourceName !== candidate.sourceName) return true;

  return false;
}

async function repairExistingSourceOwner(input: {
  source: SourceRow;
  existingSource: ExistingSourceOwner;
  candidate: { candidate: DiscoveredSourceCandidate; evidenceUrls: string[] };
  validation: Awaited<ReturnType<typeof validateCandidate>>;
  now: Date;
}) {
  const { source, existingSource, candidate, validation, now } = input;
  const duplicateSources = await prisma.companySource.findMany({
    where: {
      id: { not: existingSource.id },
      connectorName: candidate.candidate.connectorName,
      token: candidate.candidate.token,
      companyId: { not: source.companyId },
      status: { not: "DISABLED" },
    },
    select: { id: true, sourceName: true, companyId: true },
  });
  const movedSourceNames = [
    candidate.candidate.sourceName,
    ...duplicateSources.map((duplicate) => duplicate.sourceName),
  ];
  const sourceMetadata = mergeRecord(asRecord(source.metadataJson), {
    sourceRepair: {
      repairedAt: now.toISOString(),
      replacementSourceId: existingSource.id,
      replacementSourceName: candidate.candidate.sourceName,
      replacementBoardUrl: candidate.candidate.boardUrl,
      evidenceUrls: candidate.evidenceUrls,
      action: "moved-existing-source-owner",
      previousOwnerCompanyId: existingSource.companyId,
      previousOwnerCompanyKey: existingSource.company.companyKey,
      disabledDuplicateSourceNames: duplicateSources.map((duplicate) => duplicate.sourceName),
    },
  });
  const previousOwnerMetadata = mergeRecord(asRecord(existingSource.company.metadataJson), {
    sourceRepair: {
      lastRunAt: now.toISOString(),
      movedSourceId: existingSource.id,
      movedSourceName: candidate.candidate.sourceName,
      movedToCompanyId: source.companyId,
      movedToCompanyKey: source.company.companyKey,
      reason: "stronger-company-source-ownership",
    },
  });

  await prisma.$transaction([
    prisma.companySource.update({
      where: { id: existingSource.id },
      data: {
        companyId: source.companyId,
        sourceName: candidate.candidate.sourceName,
        connectorName: candidate.candidate.connectorName,
        token: candidate.candidate.token,
        boardUrl: candidate.candidate.boardUrl,
        status: "ACTIVE",
        validationState: validation.validationState,
        pollState: validation.pollState,
        sourceType: "ATS",
        extractionRoute: "ATS_NATIVE",
        parserVersion: "source-repair:v1",
        sourceQualityScore: validation.sourceQualityScore,
        lastValidatedAt: now,
        validationSuccessCount: { increment: 1 },
        validationMessage: validation.message,
        metadataJson: mergeRecord(asRecord(source.metadataJson), {
          repairedFromSourceName: source.sourceName,
          repairedFromBoardUrl: source.boardUrl,
          repairEvidenceUrls: candidate.evidenceUrls,
          repairAction: "moved-existing-source-owner",
          previousOwnerCompanyId: existingSource.companyId,
          previousOwnerCompanyKey: existingSource.company.companyKey,
        }) as Prisma.InputJsonValue,
      },
    }),
    prisma.jobCanonical.updateMany({
      where: {
        sourceMappings: {
          some: {
            sourceName: { in: movedSourceNames },
            removedAt: null,
          },
        },
      },
      data: {
        companyId: source.companyId,
        company: source.company.name,
        companyKey: source.company.companyKey,
      },
    }),
    prisma.company.update({
      where: { id: source.companyId },
      data: {
        careersUrl: candidate.candidate.boardUrl,
        detectedAts: candidate.candidate.connectorName,
        discoveryStatus: "DISCOVERED",
        discoveryConfidence: Math.max(0.9, source.company.discoveryConfidence ?? 0),
        metadataJson: mergeCompanyRepairMetadata(
          source.company.metadataJson,
          source,
          candidate,
          now
        ) as Prisma.InputJsonValue,
      },
    }),
    prisma.company.update({
      where: { id: existingSource.companyId },
      data: {
        metadataJson: previousOwnerMetadata as Prisma.InputJsonValue,
      },
    }),
    prisma.companySource.update({
      where: { id: source.id },
      data: {
        status: "DISABLED",
        pollState: "DISABLED",
        validationState: "INVALID",
        validationMessage: `Repaired into existing ${candidate.candidate.sourceName}; disabled old generic company-site source.`,
        metadataJson: sourceMetadata as Prisma.InputJsonValue,
      },
    }),
    prisma.companySource.updateMany({
      where: {
        id: { in: duplicateSources.map((duplicate) => duplicate.id) },
      },
      data: {
        status: "DISABLED",
        pollState: "DISABLED",
        validationState: "INVALID",
        validationMessage: `Disabled duplicate ${candidate.candidate.sourceName} token after source owner repair.`,
      },
    }),
  ]);

  await tombstoneOldCompanySiteSource(source, now);
}

async function retireOldSource(
  source: SourceRow,
  candidate: { candidate: DiscoveredSourceCandidate; evidenceUrls: string[] },
  replacementSourceId: string | null,
  now: Date
) {
  const sourceMetadata = mergeRecord(asRecord(source.metadataJson), {
    sourceRepair: {
      repairedAt: now.toISOString(),
      replacementSourceId,
      replacementSourceName: candidate.candidate.sourceName,
      replacementBoardUrl: candidate.candidate.boardUrl,
      evidenceUrls: candidate.evidenceUrls,
    },
  });

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status: "DISABLED",
      pollState: "DISABLED",
      validationState: "INVALID",
      validationMessage: `Repaired into ${candidate.candidate.sourceName}; disabled old generic company-site source.`,
      metadataJson: sourceMetadata as Prisma.InputJsonValue,
    },
  });

  await tombstoneOldCompanySiteSource(source, now);
}

async function tombstoneOldCompanySiteSource(source: SourceRow, now: Date) {
  const metadata = asRecord(source.company.metadataJson);
  const invalidSourceUrls = new Set(readStringArray(metadata.invalidSourceUrls));
  const invalidSourceNames = new Set(readStringArray(metadata.invalidSourceNames));
  invalidSourceUrls.add(normalizeTombstonedSourceUrl(source.boardUrl));
  invalidSourceNames.add(source.sourceName);
  metadata.invalidSourceUrls = [...invalidSourceUrls].slice(-250);
  metadata.invalidSourceNames = [...invalidSourceNames].slice(-250);
  metadata.invalidSourceRepair = {
    lastRunAt: now.toISOString(),
    reason: "repaired-company-site-source",
  };

  await prisma.company.update({
    where: { id: source.companyId },
    data: { metadataJson: metadata as Prisma.InputJsonValue },
  });
}

function mergeCompanyRepairMetadata(
  metadataJson: Prisma.JsonValue | null,
  source: SourceRow,
  candidate: { candidate: DiscoveredSourceCandidate; evidenceUrls: string[] },
  now: Date
) {
  return mergeRecord(asRecord(metadataJson), {
    sourceRepair: {
      lastRunAt: now.toISOString(),
      oldSourceName: source.sourceName,
      oldBoardUrl: source.boardUrl,
      replacementSourceName: candidate.candidate.sourceName,
      replacementBoardUrl: candidate.candidate.boardUrl,
      evidenceUrls: candidate.evidenceUrls,
    },
  });
}

function scoreOwnership(source: SourceRow, candidate: DiscoveredSourceCandidate) {
  const reasons: string[] = [];
  const tokenParts = extractTokenParts(candidate);
  const tokenNorm = normalizeCompact(tokenParts.join(""));
  const companyKeyNorm = normalizeCompact(source.company.companyKey);
  const companyNameNorm = normalizeCompact(source.company.name);
  const companyWords = significantWords(source.company.name);
  let score = 0;

  if (isGenericToken(tokenParts, tokenNorm)) {
    return { score: -10, reasons: ["generic-token"] };
  }

  if (tokenNorm.length >= 5 && companyKeyNorm.includes(tokenNorm)) {
    score += 4;
    reasons.push("token-contained-in-company-key");
  } else if (tokenNorm.length >= 5 && tokenNorm.includes(companyKeyNorm)) {
    score += 4;
    reasons.push("company-key-contained-in-token");
  } else if (tokenNorm.length >= 5 && companyNameNorm.includes(tokenNorm)) {
    score += 3;
    reasons.push("token-contained-in-company-name");
  } else if (tokenNorm.length >= 5 && tokenNorm.includes(companyNameNorm)) {
    score += 3;
    reasons.push("company-name-contained-in-token");
  }

  const overlapWords = companyWords.filter(
    (word) => word.length >= 4 && tokenNorm.includes(word)
  );
  if (overlapWords.length > 0) {
    score += Math.min(2, overlapWords.length);
    reasons.push(`company-word-overlap:${overlapWords.slice(0, 3).join(",")}`);
  }

  if (source.company.careersUrl && candidate.input === source.company.careersUrl) {
    score += 2;
    reasons.push("candidate-from-company-careers-url");
  }
  if (candidate.input === source.boardUrl) {
    score += 1;
    reasons.push("candidate-from-existing-board-url");
  }

  const domain = source.company.domain ? normalizeHost(source.company.domain) : null;
  if (domain && candidate.input.includes(domain)) {
    score += 2;
    reasons.push("candidate-url-contains-company-domain");
  }

  return { score, reasons };
}

function extractTokenParts(candidate: DiscoveredSourceCandidate) {
  const token = candidate.token.toLowerCase();
  if (candidate.connectorName === "workday") {
    const [host, tenant, site] = token.split("|");
    return [tenant, site, host?.split(".")[0]].filter(Boolean);
  }
  if (candidate.connectorName === "successfactors") {
    return [token.split(".")[0], token.split(".")[1]].filter(Boolean);
  }
  if (candidate.connectorName === "oraclecloud") {
    return token.split("|").filter(Boolean);
  }
  return token.split(/[^a-z0-9]+/i).filter(Boolean);
}

function sourceRank(connectorName: string) {
  switch (connectorName) {
    case "workday":
    case "greenhouse":
    case "ashby":
    case "lever":
      return 8;
    case "successfactors":
    case "oraclecloud":
    case "smartrecruiters":
    case "icims":
      return 7;
    default:
      return 5;
  }
}

function isGenericToken(parts: string[], normalized: string) {
  if (normalized.length < 4) return true;
  if (GENERIC_ATS_TOKENS.has(normalized)) return true;
  return parts.some((part) => GENERIC_ATS_TOKENS.has(part));
}

function significantWords(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !COMPANY_WORD_STOPWORDS.has(word));
}

function normalizeCompact(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
  }
}

function normalizeTombstonedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function readStringArray(value: Prisma.JsonValue | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function mergeRecord(
  base: Record<string, Prisma.JsonValue>,
  patch: Record<string, Prisma.JsonValue>
) {
  return { ...base, ...patch };
}

function buildRecord(
  source: SourceRow,
  input: {
    action: RepairAction;
    candidate: { candidate: DiscoveredSourceCandidate; evidenceUrls: string[] } | null;
    ownership: { score: number; reasons: string[] };
    validation?: { kind: string; jobsFound: number; message: string } | null;
    applied?: boolean;
    promotedSourceId?: string | null;
    existingSource?: ExistingSourceOwner | null;
    error?: string | null;
  }
): RepairRecord {
  return {
    sourceName: source.sourceName,
    company: source.company.name,
    companyKey: source.company.companyKey,
    oldConnectorName: source.connectorName,
    oldBoardUrl: source.boardUrl,
    oldState: {
      status: source.status,
      validationState: source.validationState,
      pollState: source.pollState,
    },
    candidate: input.candidate
      ? {
          connectorName: input.candidate.candidate.connectorName,
          sourceName: input.candidate.candidate.sourceName,
          token: input.candidate.candidate.token,
          boardUrl: input.candidate.candidate.boardUrl,
          evidenceUrls: input.candidate.evidenceUrls,
        }
      : null,
    ownership: input.ownership,
    validation: input.validation ?? null,
    action: input.action,
    applied: input.applied ?? false,
    promotedSourceId: input.promotedSourceId ?? null,
    existingSourceId: input.existingSource?.id ?? null,
    existingSourceCompany: input.existingSource?.company.name ?? null,
    existingSourceCompanyKey: input.existingSource?.company.companyKey ?? null,
    error: input.error ?? null,
  };
}

function summarize(records: RepairRecord[]) {
  const byAction: Record<string, number> = {};
  const byConnector: Record<string, number> = {};
  for (const record of records) {
    byAction[record.action] = (byAction[record.action] ?? 0) + 1;
    if (record.candidate) {
      byConnector[record.candidate.connectorName] =
        (byConnector[record.candidate.connectorName] ?? 0) + 1;
    }
  }

  return {
    byAction,
    byConnector,
    promotedCount: records.filter((record) => record.action === "PROMOTE_ATS").length,
    appliedCount: records.filter((record) => record.applied).length,
    validationFailureCount: records.filter(
      (record) => record.action === "SKIP_VALIDATION_FAILED"
    ).length,
    weakOwnerMatchCount: records.filter(
      (record) => record.action === "SKIP_WEAK_OWNER_MATCH"
    ).length,
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
