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
 * Why this connector is valuable even at 0 net-new canonical:
 *   In 12 recent runs, hiring.cafe produced 1048 accepted jobs but 0 new
 *   canonical rows — every job collapsed to an existing canonical record
 *   from one of the ATSes we already poll directly (Greenhouse, Lever,
 *   Ashby, Workday, etc.). Looks wasteful — it isn't:
 *
 *   1. The 100% overlap path delivers ~100 raw refreshes per cycle that
 *      keep existing canonical rows fresh from a second source. That's
 *      protective against any single ATS connector going down.
 *   2. The metadata.upstreamSource field surfaces ATSes we do NOT poll
 *      directly: oraclecloud (35%), paradox (8%), higherme (8%), hrsmart
 *      (7%), brassring (4%), adp (4%), ultipro (4%), hireology (3%),
 *      betterteam (3%), breezy (2%), avature (1%). When we add native
 *      connectors for those ATSes, the same jobs will start net-new'ing
 *      via the direct path.
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
  "Mozilla/5.0 (compatible; applyoverflow-hiringcafe/1.0)";
// HiringCafe's SSR includes ~145 jobs per render. We try multiple page +
// filter variants per cycle and dedupe by sourceId to grow the catch
// without re-fetching the same slice. The duplicate-detection short-circuit
// stops the loop as soon as a page contributes no new IDs (signals the
// site doesn't honor that param combo).
const HIRINGCAFE_MAX_PAGES = 12;
const HIRINGCAFE_PAGE_DELAY_MS = 600;
// Filter slices we know hiring.cafe accepts in its query string. Each one
// produces a different result set in SSR. Empty string = the homepage's
// default. Region filters are top of the list because they're highest
// variance.
const HIRINGCAFE_FILTER_SLICES = [
  "",
  "?country=United+States",
  "?country=Canada",
  "?remote=true",
  "?seniority_level=Mid+Level",
  "?seniority_level=Senior+Level",
  "?seniority_level=Junior+Level",
  "?seniority_level=Entry+Level",
  "?seniority_level=Lead",
];

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

  const limit = options.limit;
  const jobs: SourceConnectorJob[] = [];
  const seenIds = new Set<string>();
  let skippedExpired = 0;
  let skippedMissingFields = 0;
  let totalHitsInResponses = 0;
  let pagesFetched = 0;
  let slicesAttempted = 0;
  let slicesAbandonedNoNewIds = 0;

  // Outer loop: walk through filter slices. Inner loop: paginate within
  // each slice via ?page=N until the page contributes no new IDs.
  for (const slice of HIRINGCAFE_FILTER_SLICES) {
    if (limit && jobs.length >= limit) break;
    slicesAttempted += 1;
    let lastPageNewIds = -1;

    for (let page = 1; page <= HIRINGCAFE_MAX_PAGES; page += 1) {
      if (limit && jobs.length >= limit) break;
      throwIfAborted(options.signal);

      const url = buildSliceUrl(slice, page);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: options.signal,
          headers: {
            "User-Agent": HIRINGCAFE_USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
          },
        });
      } catch (error) {
        // Mid-pagination network failure — break this slice, try the next
        if (page === 1 && slicesAttempted === 1) throw error;
        break;
      }

      if (!response.ok) {
        if (page === 1 && slicesAttempted === 1) {
          throw new Error(
            `Hiring.cafe fetch failed: ${response.status} ${response.statusText}`
          );
        }
        break;
      }

      pagesFetched += 1;
      const html = await response.text();
      const nextData = extractNextData(html);
      const hits = nextData?.props?.pageProps?.ssrHits ?? [];
      totalHitsInResponses += hits.length;

      let newIdsThisPage = 0;
      for (const hit of hits) {
        if (limit && jobs.length >= limit) break;
        if (hit.is_expired) {
          skippedExpired += 1;
          continue;
        }
        const mapped = mapHiringCafeHit(hit, now);
        if (!mapped) {
          skippedMissingFields += 1;
          continue;
        }
        if (mapped.sourceId && seenIds.has(mapped.sourceId)) continue;
        if (mapped.sourceId) seenIds.add(mapped.sourceId);
        jobs.push(mapped);
        newIdsThisPage += 1;
      }

      // Short-circuit: if this slice's page returns the SAME job set as
      // the previous page (no new IDs), hiring.cafe likely ignored the
      // pagination param. Move on to the next slice.
      if (newIdsThisPage === 0 && lastPageNewIds === 0) {
        slicesAbandonedNoNewIds += 1;
        break;
      }
      lastPageNewIds = newIdsThisPage;

      // If the page returned fewer hits than a "full" page (~50+), assume
      // we've walked off the end of the slice.
      if (hits.length < 30) break;

      await new Promise((resolve) =>
        setTimeout(resolve, HIRINGCAFE_PAGE_DELAY_MS)
      );
    }
  }

  return {
    jobs,
    metadata: {
      sourceUrl: HIRINGCAFE_URL,
      slicesAttempted,
      slicesAbandonedNoNewIds,
      pagesFetched,
      hitsInResponse: totalHitsInResponses,
      uniqueIds: seenIds.size,
      skippedExpired,
      skippedMissingFields,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

function buildSliceUrl(slice: string, page: number): string {
  if (page <= 1) {
    // Slice may already include a query string ("?country=US"). Use as-is.
    return slice ? `${HIRINGCAFE_URL}${slice}` : HIRINGCAFE_URL;
  }
  if (!slice) return `${HIRINGCAFE_URL}?page=${page}`;
  return `${HIRINGCAFE_URL}${slice}&page=${page}`;
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
    sanitizeText(v5.compensation_currency ?? undefined) ??
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
