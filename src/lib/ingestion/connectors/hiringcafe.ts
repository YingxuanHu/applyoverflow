/**
 * Hiring.cafe job board connector.
 *
 * Hiring.cafe is a meta-aggregator that pulls listings from many ATS
 * sources (Oracle Cloud, Greenhouse, Lever, Breezy, etc.) and surfaces
 * them through a single Next.js front-end. They embed the full search
 * result set as JSON inside `__NEXT_DATA__` on the homepage / /jobs page,
 * so we can extract ~145 structured jobs in one fetch — no per-job
 * page scraping, no auth, no rate limit issues observed.
 *
 * Notably:
 *   - Heavily Canadian content (a meaningful share of hits are CA-based)
 *   - Surfaces Oracle Cloud / Breezy boards we don't yet ingest directly
 *   - Strict white-collar filter is handled downstream by the existing
 *     EXCLUDED_TITLE_PATTERNS (retail / blue-collar drops out)
 *
 * Volume: ~145 jobs per fetch. Cycle every ~30 min for fresh content.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EmploymentType, WorkMode } from "@/generated/prisma/client";
import { throwIfAborted } from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const HIRINGCAFE_URL = "https://hiring.cafe/";
const HIRINGCAFE_USER_AGENT =
  "Mozilla/5.0 (compatible; autoapplication-hiringcafe/1.0)";

type HiringCafeV5 = {
  core_job_title?: string;
  company_name?: string;
  commitment?: string[] | null;
  formatted_workplace_location?: string;
  workplace_type?: string;
  workplace_physical_environment?: string;
  seniority_level?: string;
  estimated_publish_date?: string;
  expires_at?: string;
  yearly_min_compensation?: number | null;
  yearly_max_compensation?: number | null;
  compensation_currency?: string | null;
  job_category?: string;
  requirements_summary?: string;
  responsibilities_summary?: string;
};

type HiringCafeEnrichedCompany = {
  name?: string;
  homepage_uri?: string;
  hq_country?: string;
};

type HiringCafeHit = {
  id?: string;
  objectID?: string;
  apply_url?: string;
  board_token?: string;
  source?: string;
  is_expired?: boolean;
  job_information?: { title?: string; job_title_raw?: string };
  v5_processed_job_data?: HiringCafeV5;
  enriched_company_data?: HiringCafeEnrichedCompany;
};

type HiringCafeNextData = {
  props?: {
    pageProps?: {
      ssrHits?: HiringCafeHit[];
    };
  };
};

export function createHiringCafeConnector(): SourceConnector {
  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: "hiringcafe:feed",
    sourceName: "HiringCafe:feed",
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      options: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(options.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchHiringCafeJobs(options);
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchHiringCafeJobs(
  options: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? new Date();

  const response = await fetch(HIRINGCAFE_URL, {
    signal: options.signal,
    headers: {
      "User-Agent": HIRINGCAFE_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Hiring.cafe fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const nextData = extractNextData(html);
  const hits = nextData?.props?.pageProps?.ssrHits ?? [];

  const limited = typeof options.limit === "number" ? hits.slice(0, options.limit) : hits;
  const jobs: SourceConnectorJob[] = [];
  let skippedExpired = 0;
  let skippedMissingFields = 0;

  for (const hit of limited) {
    if (hit.is_expired) {
      skippedExpired += 1;
      continue;
    }
    const mapped = mapHiringCafeHit(hit, now);
    if (!mapped) {
      skippedMissingFields += 1;
      continue;
    }
    jobs.push(mapped);
  }

  return {
    jobs,
    metadata: {
      sourceUrl: HIRINGCAFE_URL,
      hitsInResponse: hits.length,
      skippedExpired,
      skippedMissingFields,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const NEXT_DATA_REGEX =
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;

function extractNextData(html: string): HiringCafeNextData | null {
  const match = html.match(NEXT_DATA_REGEX);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as HiringCafeNextData;
  } catch {
    return null;
  }
}

function mapHiringCafeHit(
  hit: HiringCafeHit,
  now: Date
): SourceConnectorJob | null {
  const sourceId =
    sanitizeText(hit.id) ?? sanitizeText(hit.objectID) ?? null;
  if (!sourceId) return null;

  const applyUrl = sanitizeText(hit.apply_url);
  if (!applyUrl) return null;

  const v5 = hit.v5_processed_job_data ?? {};
  const title =
    sanitizeText(v5.core_job_title) ??
    sanitizeText(hit.job_information?.title) ??
    sanitizeText(hit.job_information?.job_title_raw);
  if (!title) return null;

  const company =
    sanitizeText(v5.company_name) ??
    sanitizeText(hit.enriched_company_data?.name);
  if (!company) return null;

  const location =
    sanitizeText(v5.formatted_workplace_location) ?? "Unknown";
  const workMode = inferWorkMode(v5.workplace_type, location);
  const employmentType = inferEmploymentType(v5.commitment, title);
  const postedAt = parseDate(v5.estimated_publish_date);
  const deadline = parseDate(v5.expires_at);
  const description = buildDescription(v5);

  const salaryMin =
    typeof v5.yearly_min_compensation === "number" && v5.yearly_min_compensation > 0
      ? v5.yearly_min_compensation
      : null;
  const salaryMax =
    typeof v5.yearly_max_compensation === "number" && v5.yearly_max_compensation > 0
      ? v5.yearly_max_compensation
      : null;
  const salaryCurrency =
    sanitizeText(v5.compensation_currency) ??
    (salaryMin || salaryMax ? inferCurrencyFromLocation(location) : null);

  return {
    sourceId: `hiringcafe:${sourceId}`,
    sourceUrl: applyUrl,
    title,
    company,
    location,
    description,
    applyUrl,
    postedAt,
    deadline,
    employmentType,
    workMode,
    salaryMin,
    salaryMax,
    salaryCurrency,
    metadata: {
      source: "hiringcafe",
      upstreamSource: hit.source ?? null,
      boardToken: hit.board_token ?? null,
      jobCategory: v5.job_category ?? null,
      seniorityLevel: v5.seniority_level ?? null,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function inferWorkMode(
  workplaceType: string | undefined,
  location: string
): WorkMode {
  const t = workplaceType?.toLowerCase() ?? "";
  if (t.includes("remote")) return "REMOTE";
  if (t.includes("hybrid")) return "HYBRID";
  if (t.includes("onsite") || t.includes("on-site") || t.includes("on site")) {
    return "ONSITE";
  }
  if (/^remote\b/i.test(location)) return "REMOTE";
  if (/hybrid/i.test(location)) return "HYBRID";
  return "ONSITE";
}

function inferEmploymentType(
  commitment: string[] | null | undefined,
  title: string
): EmploymentType | null {
  const flat = (commitment ?? []).join(" ").toLowerCase();
  if (flat.includes("intern")) return "INTERNSHIP";
  if (flat.includes("contract") || flat.includes("temporary") || flat.includes("temp")) {
    return "CONTRACT";
  }
  if (flat.includes("part time") || flat.includes("part-time")) return "PART_TIME";
  if (flat.includes("full time") || flat.includes("full-time")) return "FULL_TIME";
  const lt = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(lt) || /\bco-?op\b/.test(lt)) return "INTERNSHIP";
  if (/\bcontract\b/.test(lt)) return "CONTRACT";
  return null;
}

function buildDescription(v5: HiringCafeV5): string {
  const parts: string[] = [];
  const reqs = sanitizeText(v5.requirements_summary);
  const resp = sanitizeText(v5.responsibilities_summary);
  if (resp) parts.push(`Responsibilities: ${resp}`);
  if (reqs) parts.push(`Requirements: ${reqs}`);
  return parts.join("\n\n");
}

function inferCurrencyFromLocation(location: string): string | null {
  if (/canada/i.test(location)) return "CAD";
  if (/united states|usa|, us\b|\bus\b/i.test(location)) return "USD";
  return null;
}

function parseDate(input: string | undefined): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function sanitizeText<T extends string | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || undefined) as T;
}
