// Proactive ATS board discovery / self-healing.
//
// Derives candidate board slugs from company names + domains already in the
// database and probes the public JSON endpoints of the clean-application ATS
// platforms (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee).
// Hits are registered as SourceCandidates and flow through the normal
// validation + promotion pipeline — this script never promotes directly.
//
// Modes:
//   --mode=coverage  (default) companies with a domain but no healthy source
//   --mode=repair    companies whose sources are all broken/quarantined
//   --names="Acme, Foo Corp"  probe explicit company names from the DB
//
// Usage:
//   npm run source:probe-slugs -- --limit=100 --dry-run
//   npm run source:probe-slugs -- --mode=repair --limit=50 --apply
//   npm run source:probe-slugs -- --names="PepsiCo" --apply

import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  PROBEABLE_ATS_PLATFORMS,
  probeAtsSlugsForCompany,
  type AtsSlugProbeResult,
  type ProbeableAtsPlatform,
} from "../src/lib/ingestion/discovery/ats-slug-probe";
import { registerSourceCandidate } from "../src/lib/ingestion/discovery/source-registry";

type Mode = "coverage" | "repair" | "names";

type CliArgs = {
  mode: Mode;
  names: string[];
  limit: number;
  concurrency: number;
  platforms: ProbeableAtsPlatform[];
  minJobCount: number;
  apply: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "coverage",
    names: [],
    limit: 100,
    concurrency: 4,
    platforms: PROBEABLE_ATS_PLATFORMS,
    minJobCount: 1,
    apply: false,
  };

  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--mode=")) {
      const mode = raw.slice("--mode=".length);
      if (mode === "coverage" || mode === "repair") args.mode = mode;
      else throw new Error(`Unknown --mode=${mode}`);
    } else if (raw.startsWith("--names=")) {
      args.names = raw
        .slice("--names=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      args.mode = "names";
    } else if (raw.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(raw.slice("--limit=".length), 10) || 100);
    } else if (raw.startsWith("--concurrency=")) {
      args.concurrency = Math.min(
        16,
        Math.max(1, Number.parseInt(raw.slice("--concurrency=".length), 10) || 4)
      );
    } else if (raw.startsWith("--min-job-count=")) {
      args.minJobCount = Math.max(
        0,
        Number.parseInt(raw.slice("--min-job-count=".length), 10) || 1
      );
    } else if (raw.startsWith("--platforms=")) {
      const requested = raw
        .slice("--platforms=".length)
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      const valid = requested.filter((value): value is ProbeableAtsPlatform =>
        (PROBEABLE_ATS_PLATFORMS as string[]).includes(value)
      );
      if (valid.length === 0) {
        throw new Error(`--platforms matched none of: ${PROBEABLE_ATS_PLATFORMS.join(",")}`);
      }
      args.platforms = valid;
    }
  }

  return args;
}

type ProbeTargetCompany = {
  id: string;
  name: string;
  domain: string | null;
};

const HEALTHY_SOURCE_STATUSES = ["ACTIVE", "PROVISIONED"] as const;

async function loadCoverageTargets(limit: number): Promise<ProbeTargetCompany[]> {
  return prisma.company.findMany({
    where: {
      domain: { not: null },
      sources: {
        none: { status: { in: [...HEALTHY_SOURCE_STATUSES] } },
      },
    },
    select: { id: true, name: true, domain: true },
    orderBy: [{ discoveryConfidence: "desc" }, { createdAt: "asc" }],
    take: limit,
  });
}

async function loadRepairTargets(limit: number): Promise<ProbeTargetCompany[]> {
  // Companies whose registered sources are all broken: at least one source in
  // a repair-needing state and none healthy. These are the rotted career URLs
  // the probe can often replace with a working board on the same platform or
  // reveal a migration to a different ATS.
  return prisma.company.findMany({
    where: {
      sources: {
        some: {
          OR: [
            { status: { in: ["REDISCOVER_REQUIRED", "DISABLED"] } },
            { validationState: { in: ["INVALID", "BLOCKED", "NEEDS_REDISCOVERY"] } },
          ],
        },
        none: { status: { in: [...HEALTHY_SOURCE_STATUSES] } },
      },
    },
    select: { id: true, name: true, domain: true },
    orderBy: [{ discoveryConfidence: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
}

async function loadNamedTargets(names: string[]): Promise<ProbeTargetCompany[]> {
  const results: ProbeTargetCompany[] = [];
  for (const name of names) {
    const company = await prisma.company.findFirst({
      where: { name: { contains: name, mode: "insensitive" } },
      select: { id: true, name: true, domain: true },
    });
    if (company) results.push(company);
    else console.warn(`[probe] No company found matching name: ${name}`);
  }
  return results;
}

function probeConfidence(hit: AtsSlugProbeResult): number {
  const jobCount = hit.jobCount ?? 0;
  // Live board with real postings: strong lead. Bounded below auto-promotion
  // territory — validation and ownership scoring make the final call.
  const base = Math.min(0.85, 0.45 + Math.log1p(jobCount) * 0.07);
  // Identity-verified boards (board self-reports the expected company name)
  // earn a bump; unverified ones stay at base and are settled downstream.
  return Math.min(0.9, hit.identityVerdict === "match" ? base + 0.08 : base);
}

async function registerHit(company: ProbeTargetCompany, hit: AtsSlugProbeResult) {
  await registerSourceCandidate({
    candidateUrl: hit.boardUrl,
    candidateType: "ATS_BOARD",
    // Always attribute to the company we probed for — the board-reported name
    // is recorded as evidence, not used for attribution, so a formatting
    // variant ("Acme" vs "Acme, Inc.") can never mint a duplicate company.
    companyNameHint: company.name,
    confidence: probeConfidence(hit),
    potentialYieldScore: Math.min(1, (hit.jobCount ?? 0) / 50),
    sourceQualityScore: 0.6,
    metadataJson: {
      discovery: {
        method: "ats-slug-probe",
        platform: hit.platform,
        slug: hit.slug,
        probeUrl: hit.probeUrl,
        jobCount: hit.jobCount,
        probedCompanyId: company.id,
        reportedCompanyName: hit.companyNameHint,
        identityVerdict: hit.identityVerdict,
        identitySimilarity: hit.identitySimilarity,
      },
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targets =
    args.mode === "names"
      ? await loadNamedTargets(args.names)
      : args.mode === "repair"
        ? await loadRepairTargets(args.limit)
        : await loadCoverageTargets(args.limit);

  console.log(
    `[probe] mode=${args.mode} targets=${targets.length} platforms=${args.platforms.join(",")} apply=${args.apply}`
  );
  if (targets.length === 0) {
    console.log("[probe] Nothing to probe.");
    return;
  }

  let processed = 0;
  let totalHits = 0;
  let totalMismatches = 0;
  let totalBlocked = 0;
  let totalRegistered = 0;
  const queue = [...targets];

  const workers = Array.from(
    { length: Math.min(args.concurrency, queue.length) },
    async () => {
      for (;;) {
        const company = queue.shift();
        if (!company) return;

        const summary = await probeAtsSlugsForCompany({
          name: company.name,
          domain: company.domain,
          platforms: args.platforms,
          minJobCount: args.minJobCount,
        });
        processed += 1;
        totalHits += summary.hits.length;
        totalMismatches += summary.identityMismatches.length;
        totalBlocked += summary.blocked.length;

        for (const mismatch of summary.identityMismatches) {
          console.warn(
            `[probe] IDENTITY-MISMATCH ${company.name} -> ${mismatch.platform}:${mismatch.slug} reports "${mismatch.companyNameHint}" — skipped (slug collision)`
          );
        }

        for (const hit of summary.hits) {
          console.log(
            `[probe] HIT ${company.name} -> ${hit.platform}:${hit.slug} (${hit.jobCount} jobs, identity ${hit.identityVerdict}${hit.companyNameHint ? `: "${hit.companyNameHint}"` : ""}) ${hit.boardUrl}`
          );
          if (args.apply) {
            try {
              await registerHit(company, hit);
              totalRegistered += 1;
            } catch (error) {
              console.error(
                `[probe] Failed to register candidate for ${company.name}:`,
                error instanceof Error ? error.message : error
              );
            }
          }
        }

        for (const blocked of summary.blocked) {
          console.warn(
            `[probe] BLOCKED ${blocked.platform} (${blocked.detail ?? "?"}) while probing ${company.name} — consider lowering concurrency`
          );
        }

        if (processed % 25 === 0) {
          console.log(`[probe] progress ${processed}/${targets.length}`);
        }
      }
    }
  );

  await Promise.all(workers);

  console.log(
    `[probe] done: companies=${processed} hits=${totalHits} registered=${totalRegistered} identityMismatches=${totalMismatches} blocked=${totalBlocked}${
      args.apply ? "" : " (dry run — pass --apply to register hits)"
    }`
  );
}

main()
  .catch((error) => {
    console.error("[probe] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
