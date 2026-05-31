/**
 * JSearch (RapidAPI) connector.
 *
 * JSearch aggregates millions of jobs across LinkedIn, Indeed, Glassdoor,
 * ZipRecruiter, etc. via a single REST endpoint. The free tier is capped
 * at 200 requests / month, so this connector is BUDGET-AWARE by design:
 *
 *   - Each scheduled run consumes at most JSEARCH_MAX_REQUESTS_PER_RUN
 *     requests (default 1). Combined with a daily cadence, that's ~30
 *     requests/month — comfortably under the 200 cap.
 *
 *   - Each request returns up to 10 jobs by default (jsearch's max is
 *     also 10 per page on free tier). Realistic per-cycle yield: 5-10
 *     jobs. Quality is high though — these jobs span LinkedIn / Indeed
 *     etc. that we cannot reach directly.
 *
 *   - The query rotates each run through a curated set of high-yield
 *     keywords (12 priority categories) using the IngestionRun checkpoint
 *     so we don't waste requests asking the same thing twice.
 *
 * Environment: JSEARCH_API_KEY (RapidAPI key)
 * Endpoint: https://jsearch.p.rapidapi.com/search
 */
import type { Prisma } from "@/generated/prisma/client";

import { throwIfAborted } from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const JSEARCH_API_HOST = "jsearch.p.rapidapi.com";
const JSEARCH_API_URL = `https://${JSEARCH_API_HOST}/search`;
const JSEARCH_USER_AGENT =
  "Mozilla/5.0 (compatible; applyoverflow-jsearch/1.0)";

// Free tier: 200 requests/month → ~6/day. Default = 1 request per
// scheduled run. Schedule the connector daily and we use ~30/month.
const JSEARCH_DEFAULT_MAX_REQUESTS_PER_RUN = 1;
const JSEARCH_DEFAULT_RATE_DELAY_MS = 1100;
const JSEARCH_DEFAULT_NUM_PAGES = 1;

// Queries rotate per-cycle using the IngestionRun checkpoint. One query per
// run; the index advances each cycle and wraps.
const JSEARCH_QUERIES: string[] = [
  // Tech / IT
  "Software Engineer in United States",
  "Senior Software Engineer in Canada",
  "Data Scientist in United States",
  "Machine Learning Engineer in United States",
  "Cybersecurity Analyst in United States",
  "Cloud Engineer in Canada",
  "DevOps Engineer in United States",
  "Product Manager in United States",
  // Finance / Accounting
  "Financial Analyst in United States",
  "Senior Accountant in Canada",
  "FP&A Analyst in United States",
  "Investment Banking Analyst in United States",
  "Audit Senior in United States",
  "Tax Manager in Canada",
  // Marketing / Sales
  "Marketing Manager in United States",
  "Demand Generation Manager in United States",
  "Account Executive SaaS in United States",
  "Enterprise Account Executive in Canada",
  // Consulting / business ops
  "Management Consultant in United States",
  "Business Operations Analyst in United States",
  "Strategy Consultant in Canada",
  // Healthcare admin / Education / Law
  "Healthcare Operations Manager in United States",
  "Hospital Administrator in United States",
  "Academic Advisor in United States",
  "Corporate Counsel in United States",
  "Paralegal in Canada",
  // HR
  "HR Business Partner in United States",
  "Talent Acquisition Manager in Canada",
  // Engineering (non-software)
  "Mechanical Engineer in United States",
  "Civil Engineer in Canada",
  "Electrical Engineer in United States",
  "Biomedical Engineer in United States",
];

type JSearchJob = {
  job_id?: string;
  employer_name?: string;
  employer_logo?: string | null;
  job_title?: string;
  job_description?: string;
  job_apply_link?: string;
  job_apply_is_direct?: boolean;
  job_employment_type?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_offer_expiration_datetime_utc?: string | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_period?: string | null;
  job_publisher?: string;
};

type JSearchResponse = {
  status?: string;
  request_id?: string;
  parameters?: Record<string, unknown>;
  data?: JSearchJob[];
};

type JSearchCheckpoint = {
  queryIndex: number;
  page: number;
};

export function createJSearchConnector(): SourceConnector {
  const apiKey = process.env.JSEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "JSearch connector requires JSEARCH_API_KEY environment variable."
    );
  }

  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: "jsearch:feed",
    sourceName: "JSearch:feed",
    sourceTier: "TIER_3",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      options: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = JSON.stringify({
        limit: options.limit ?? "all",
        checkpoint: options.checkpoint ?? null,
      });
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchJSearchJobs({ ...options, apiKey });
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchJSearchJobs(
  options: SourceConnectorFetchOptions & { apiKey: string }
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? new Date();

  const checkpoint = parseCheckpoint(options.checkpoint);
  const startIndex = checkpoint?.queryIndex ?? 0;

  // Budget: how many requests we're willing to spend this run. Default 1.
  const maxRequests = readPositiveIntEnv(
    "JSEARCH_MAX_REQUESTS_PER_RUN",
    JSEARCH_DEFAULT_MAX_REQUESTS_PER_RUN
  );
  const numPages = readPositiveIntEnv(
    "JSEARCH_NUM_PAGES",
    JSEARCH_DEFAULT_NUM_PAGES
  );

  const jobs: SourceConnectorJob[] = [];
  const seenIds = new Set<string>();
  let requestsMade = 0;
  let nextIndex = startIndex;
  let totalResults = 0;

  for (let attempt = 0; attempt < maxRequests; attempt += 1) {
    if (options.limit && jobs.length >= options.limit) break;
    throwIfAborted(options.signal);

    const queryIndex = nextIndex % JSEARCH_QUERIES.length;
    const query = JSEARCH_QUERIES[queryIndex];

    const url = `${JSEARCH_API_URL}?query=${encodeURIComponent(query)}&page=1&num_pages=${numPages}&date_posted=month`;
    let response: Response;
    try {
      response = await fetch(url, {
        signal: options.signal,
        headers: {
          "x-rapidapi-host": JSEARCH_API_HOST,
          "x-rapidapi-key": options.apiKey,
          "User-Agent": JSEARCH_USER_AGENT,
          Accept: "application/json",
        },
      });
    } catch (error) {
      if (attempt === 0) throw error;
      break;
    }

    requestsMade += 1;
    nextIndex = queryIndex + 1;

    if (response.status === 429) {
      // Rate limited / monthly cap hit — back off and exit cleanly
      console.warn("[jsearch] rate limited (429); stopping run");
      break;
    }
    if (!response.ok) {
      if (attempt === 0) {
        throw new Error(
          `JSearch fetch failed: ${response.status} ${response.statusText}`
        );
      }
      break;
    }

    const payload = (await response.json().catch(() => null)) as
      | JSearchResponse
      | null;
    if (!payload || !Array.isArray(payload.data)) break;

    totalResults += payload.data.length;
    for (const item of payload.data) {
      const mapped = mapJSearchJob(item, now, query);
      if (!mapped) continue;
      if (mapped.sourceId && seenIds.has(mapped.sourceId)) continue;
      if (mapped.sourceId) seenIds.add(mapped.sourceId);
      jobs.push(mapped);
      if (options.limit && jobs.length >= options.limit) break;
    }

    // Persist the rotation index so the next run starts at the following
    // query and we don't waste budget repeating the same one.
    if (options.onCheckpoint) {
      await options.onCheckpoint({
        queryIndex: nextIndex % JSEARCH_QUERIES.length,
        page: 1,
      } satisfies JSearchCheckpoint);
    }

    if (attempt < maxRequests - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, JSEARCH_DEFAULT_RATE_DELAY_MS)
      );
    }
  }

  return {
    jobs,
    metadata: {
      requestsMade,
      totalResults,
      startQueryIndex: startIndex,
      endQueryIndex: nextIndex % JSEARCH_QUERIES.length,
      knownQueries: JSEARCH_QUERIES.length,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

function mapJSearchJob(
  job: JSearchJob,
  now: Date,
  query: string
): SourceConnectorJob | null {
  const title = sanitizeText(job.job_title);
  const company = sanitizeText(job.employer_name);
  const sourceId = sanitizeText(job.job_id);
  const applyUrl = sanitizeText(job.job_apply_link);
  if (!title || !company || !sourceId || !applyUrl) return null;

  const locationParts = [
    sanitizeText(job.job_city ?? undefined),
    sanitizeText(job.job_state ?? undefined),
    sanitizeText(job.job_country ?? undefined),
  ].filter(Boolean);
  const location = locationParts.length ? locationParts.join(", ") : "Unknown";
  const description = sanitizeText(job.job_description) ?? "";
  const postedAt = parseDate(job.job_posted_at_datetime_utc);
  const deadline = parseDate(job.job_offer_expiration_datetime_utc ?? undefined);

  return {
    sourceId: `jsearch:${sourceId}`,
    sourceUrl: applyUrl,
    title,
    company,
    location,
    description,
    applyUrl,
    postedAt,
    deadline,
    employmentType: mapEmploymentType(job.job_employment_type),
    workMode: job.job_is_remote ? "REMOTE" : "UNKNOWN",
    salaryMin: typeof job.job_min_salary === "number" ? job.job_min_salary : null,
    salaryMax: typeof job.job_max_salary === "number" ? job.job_max_salary : null,
    salaryCurrency: sanitizeText(job.job_salary_currency ?? undefined) ?? null,
    metadata: {
      source: "jsearch",
      query,
      publisher: sanitizeText(job.job_publisher) ?? null,
      directApply: job.job_apply_is_direct ?? null,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function mapEmploymentType(value: string | undefined) {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v === "FULLTIME" || v === "FULL_TIME") return "FULL_TIME";
  if (v === "PARTTIME" || v === "PART_TIME") return "PART_TIME";
  if (v === "CONTRACTOR" || v === "CONTRACT") return "CONTRACT";
  if (v === "INTERN" || v === "INTERNSHIP") return "INTERNSHIP";
  return null;
}

function parseCheckpoint(
  value: Prisma.InputJsonValue | null | undefined
): JSearchCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { queryIndex?: unknown; page?: unknown };
  const queryIndex =
    typeof raw.queryIndex === "number" && Number.isFinite(raw.queryIndex)
      ? Math.max(0, Math.floor(raw.queryIndex))
      : 0;
  const page =
    typeof raw.page === "number" && Number.isFinite(raw.page)
      ? Math.max(1, Math.floor(raw.page))
      : 1;
  return { queryIndex, page };
}

function parseDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim() ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText<T extends string | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || undefined) as T;
}
