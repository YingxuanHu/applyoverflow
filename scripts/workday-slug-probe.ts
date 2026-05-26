/**
 * workday-slug-probe.ts
 *
 * For each input company, generates slug candidates and probes Workday
 * URL patterns (wd1/wd3/wd5/wd12 × external/careers/search/jobs/...).
 * Persists hits as validated CompanySource records.
 *
 * Usage:
 *   node --max-old-space-size=512 node_modules/.bin/tsx -r dotenv/config \
 *     scripts/workday-slug-probe.ts --input=/path/to/companies.jsonl [--concurrency=8]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ensureCompanyRecord } from "../src/lib/ingestion/company-records";
import { upsertCompanySourceByIdentity } from "../src/lib/ingestion/company-source-upsert";
import { buildCompanyKey } from "../src/lib/ingestion/discovery/company-corpus";
import { prisma } from "../src/lib/db";

type CompanyInput = {
  name: string;
  website?: string | null;
  source?: string;
};

const WD_VERSIONS = ["wd1", "wd3", "wd5", "wd12"];
const WD_SITES = [
  "external",
  "careers",
  "search",
  "jobs",
  "external_careers",
  "external_career_site",
];
const DEFAULT_POLL_CADENCE = 180;

function slugCandidates(name: string): string[] {
  const cands = new Set<string>();
  const lower = name.toLowerCase().trim();

  // Direct slug
  cands.add(lower.replace(/[^a-z0-9]/g, ""));
  cands.add(
    lower
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  );

  // First word
  const firstWord = lower.split(/[\s,.]/)[0]!;
  if (firstWord.length > 2) cands.add(firstWord.replace(/[^a-z0-9]/g, ""));

  // First two words concatenated
  const words = lower.split(/[\s,.]+/).filter((w) => w.length > 0);
  if (words.length >= 2) {
    cands.add((words[0]! + words[1]!).replace(/[^a-z0-9]/g, ""));
  }

  // Remove common suffixes
  const stripped = lower
    .replace(
      /\s+(inc|corp|llc|ltd|co|company|group|holdings|technologies|technology|tech|solutions|systems|services|international|global|enterprises|partners|capital|management|financial|health|healthcare)\s*$/,
      ""
    )
    .trim();
  cands.add(stripped.replace(/[^a-z0-9]/g, ""));

  return [...cands].filter((s) => s.length >= 2 && s.length <= 50);
}

async function probeWorkday(
  slug: string
): Promise<{ site: string; version: string; jobCount: number; host: string } | null> {
  for (const version of WD_VERSIONS) {
    const host = `${slug}.${version}.myworkdayjobs.com`;
    for (const site of WD_SITES) {
      const url = `https://${host}/wday/cxs/${slug}/${site}/jobs`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; autoapplication/1.0)",
          },
          body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
          signal: ctl.signal,
        });
        if (r.ok || r.status === 200) {
          const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
          if (j && (Array.isArray(j.jobPostings) || (j.total as number) > 0)) {
            clearTimeout(timer);
            const jobCount =
              typeof j.total === "number"
                ? j.total
                : Array.isArray(j.jobPostings)
                  ? (j.jobPostings as unknown[]).length
                  : 0;
            return { site, version, host, jobCount };
          }
        }
      } catch {
        // ignore
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return null;
}

async function persistHit(
  input: CompanyInput,
  slug: string,
  hit: { site: string; version: string; host: string; jobCount: number }
) {
  const companyName = input.name.trim();
  const companyKey = buildCompanyKey(companyName);
  const token = `${hit.host}|${slug}|${hit.site}`;
  const boardUrl = `https://${hit.host}/${slug}/${hit.site}/jobs`;
  const sourceName = `Workday:${token}`;
  const now = new Date();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

  try {
    const company = await ensureCompanyRecord({
      companyName,
      companyKey,
      careersUrl: boardUrl,
      detectedAts: "workday",
      discoveryStatus: "DISCOVERED",
      discoveryConfidence: 0.9,
    });

    await upsertCompanySourceByIdentity({
      identity: { companyId: company.id, connectorName: "workday", token, sourceName },
      create: {
        companyId: company.id,
        sourceName,
        connectorName: "workday",
        token,
        boardUrl,
        status: "ACTIVE",
        validationState: "VALIDATED",
        pollState: "READY",
        pollingCadenceMinutes: DEFAULT_POLL_CADENCE,
        lastSuccessfulPollAt: fourHoursAgo,
        lastValidatedAt: now,
        consecutiveFailures: 0,
      },
      update: {
        boardUrl,
        status: "ACTIVE",
        validationState: "VALIDATED",
        pollState: "READY",
        pollingCadenceMinutes: DEFAULT_POLL_CADENCE,
        lastSuccessfulPollAt: fourHoursAgo,
        lastValidatedAt: now,
        consecutiveFailures: 0,
      },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("Unique constraint") && !msg.includes("P2002")) {
      console.error(`[persist-error] ${input.name}: ${msg}`);
    }
  }
}

async function pool<T>(items: T[], concurrency: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try {
        await fn(items[idx]!);
      } catch {}
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = args.find((a) => a.startsWith("--input="))?.slice(8);
  const concurrency = parseInt(
    args.find((a) => a.startsWith("--concurrency="))?.slice(14) ?? "8"
  );

  if (!inputFile) {
    console.error("Usage: --input=path.jsonl [--concurrency=8]");
    process.exit(1);
  }

  const lines = readFileSync(inputFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  const companies = lines
    .map((l) => {
      try {
        return JSON.parse(l) as CompanyInput;
      } catch {
        return null;
      }
    })
    .filter((x): x is CompanyInput => x !== null && Boolean(x.name));

  console.log(`[workday-probe] ${companies.length} companies | concurrency=${concurrency}`);

  let processed = 0;
  let hits = 0;
  let totalJobs = 0;
  const t0 = Date.now();

  const interval = setInterval(() => {
    const sec = (Date.now() - t0) / 1000;
    console.log(
      `[progress] processed=${processed}/${companies.length} (${(processed / sec).toFixed(1)}/s) hits=${hits} jobsFound=${totalJobs}`
    );
  }, 30_000);

  await pool(companies, concurrency, async (company) => {
    processed++;
    const slugs = slugCandidates(company.name);

    for (const slug of slugs) {
      const hit = await probeWorkday(slug);
      if (hit) {
        hits++;
        totalJobs += hit.jobCount;
        console.log(
          `[hit] ${company.name} -> ${hit.host}|${slug}|${hit.site} (${hit.jobCount} jobs)`
        );
        await persistHit(company, slug, hit);
        break; // found one, stop trying other slugs for this company
      }
    }
  });

  clearInterval(interval);
  const sec = (Date.now() - t0) / 1000;
  console.log(
    `[done] processed=${companies.length} in ${sec.toFixed(0)}s | hits=${hits} | jobsFound=${totalJobs}`
  );
  await prisma.$disconnect();
}

void main();
