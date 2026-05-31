/**
 * Live Job Bank Canada (jobbank.gc.ca/jobsearch) connector.
 *
 * The existing `createJobBankConnector` pulls monthly CSV dumps — slow but
 * comprehensive (50k-100k jobs once a month). This complementary live
 * connector hits the search UI directly and surfaces same-week postings.
 *
 * Strategy: rotate through a set of high-yield (keyword × city) combos,
 * scrape the result list HTML, and emit one SourceConnectorJob per result
 * with structured fields parsed from the result-item markup:
 *
 *   <article id="article-{jobId}">
 *     <h3 class="title">… <span class="noctitle">{title}</span></h3>
 *     <li class="date">{date}</li>
 *     <li class="business">{company}</li>
 *     <li class="location">{location}</li>
 *     <li class="salary">{salary}</li>
 *   </article>
 *
 * The detail-page apply URL is /jobsearch/jobposting/{jobId}. No auth, no
 * rate limit issues observed. Set `?sort=M` for most-recent-first.
 */
import type { Prisma } from "@/generated/prisma/client";

import { throwIfAborted } from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const JOBBANK_BASE = "https://www.jobbank.gc.ca";
const JOBBANK_SEARCH_PATH = "/jobsearch/jobsearch";
const JOBBANK_USER_AGENT =
  "Mozilla/5.0 (compatible; applyoverflow-jobbank-live/1.0)";
const JOBBANK_DEFAULT_PAGE_DELAY_MS = 800;
const JOBBANK_DEFAULT_MAX_QUERIES_PER_RUN = 6;

// Canadian-focused queries: 12 priority categories × select cities.
// Job Bank surfaces both public-sector and private postings, with strong
// Healthcare, Education, Government, Trades coverage (trades stay filtered
// downstream — Job Bank delivers them via this connector but
// EXCLUDED_TITLE_PATTERNS drops them at normalization).
const JOBBANK_LIVE_QUERIES: Array<{ keyword: string; location: string }> = [
  // Tech / IT
  { keyword: "software developer", location: "Toronto, ON" },
  { keyword: "software developer", location: "Vancouver, BC" },
  { keyword: "data analyst", location: "Toronto, ON" },
  { keyword: "data analyst", location: "Montreal, QC" },
  { keyword: "cybersecurity", location: "Ottawa, ON" },
  { keyword: "it support", location: "Calgary, AB" },
  // Finance / Accounting
  { keyword: "financial analyst", location: "Toronto, ON" },
  { keyword: "accountant", location: "Montreal, QC" },
  { keyword: "auditor", location: "Vancouver, BC" },
  { keyword: "bookkeeper", location: "Calgary, AB" },
  // Marketing / Sales
  { keyword: "marketing manager", location: "Toronto, ON" },
  { keyword: "account manager", location: "Montreal, QC" },
  { keyword: "sales representative", location: "Vancouver, BC" },
  // Consulting / Business operations
  { keyword: "business analyst", location: "Toronto, ON" },
  { keyword: "operations manager", location: "Calgary, AB" },
  { keyword: "project manager", location: "Vancouver, BC" },
  // Healthcare admin (clinical roles filtered downstream)
  { keyword: "healthcare administrator", location: "Toronto, ON" },
  { keyword: "health policy analyst", location: "Ottawa, ON" },
  // Education admin
  { keyword: "registrar", location: "Toronto, ON" },
  { keyword: "academic advisor", location: "Vancouver, BC" },
  // Law
  { keyword: "paralegal", location: "Toronto, ON" },
  { keyword: "legal counsel", location: "Montreal, QC" },
  // Engineering (non-software)
  { keyword: "mechanical engineer", location: "Calgary, AB" },
  { keyword: "civil engineer", location: "Toronto, ON" },
  { keyword: "electrical engineer", location: "Vancouver, BC" },
  // HR
  { keyword: "human resources", location: "Toronto, ON" },
  { keyword: "recruiter", location: "Montreal, QC" },
  // Government / public sector
  { keyword: "policy analyst", location: "Ottawa, ON" },
  { keyword: "program officer", location: "Ottawa, ON" },
];

type JobBankLiveCheckpoint = {
  queryIndex: number;
};

export function createJobBankLiveConnector(): SourceConnector {
  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: "jobbank-live:feed",
    sourceName: "JobBankLive:feed",
    sourceTier: "TIER_1",
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
      const request = fetchJobBankLiveJobs(options);
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchJobBankLiveJobs(
  options: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? new Date();

  const checkpoint = parseCheckpoint(options.checkpoint);
  const startIndex = checkpoint?.queryIndex ?? 0;
  const maxQueries =
    readPositiveIntEnv(
      "JOBBANK_LIVE_MAX_QUERIES_PER_RUN",
      JOBBANK_DEFAULT_MAX_QUERIES_PER_RUN
    );
  const pageDelayMs = readPositiveIntEnv(
    "JOBBANK_LIVE_PAGE_DELAY_MS",
    JOBBANK_DEFAULT_PAGE_DELAY_MS
  );

  const jobs: SourceConnectorJob[] = [];
  const seenIds = new Set<string>();
  let queriesAttempted = 0;
  let totalResults = 0;
  let nextIndex = startIndex;

  for (let i = 0; i < maxQueries; i += 1) {
    if (options.limit && jobs.length >= options.limit) break;
    throwIfAborted(options.signal);

    const queryIndex = nextIndex % JOBBANK_LIVE_QUERIES.length;
    const query = JOBBANK_LIVE_QUERIES[queryIndex];

    const url = buildSearchUrl(query.keyword, query.location);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: options.signal,
        headers: {
          "User-Agent": JOBBANK_USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-CA,en;q=0.9",
        },
      });
    } catch (error) {
      if (queriesAttempted === 0) throw error;
      break;
    }

    queriesAttempted += 1;
    nextIndex = queryIndex + 1;

    if (!response.ok) {
      if (queriesAttempted === 1) {
        throw new Error(
          `JobBankLive fetch failed: ${response.status} ${response.statusText}`
        );
      }
      break;
    }

    const html = await response.text();
    const items = parseSearchResults(html);
    totalResults += items.length;

    for (const item of items) {
      const mapped = mapSearchResult(item, query, now);
      if (!mapped) continue;
      if (mapped.sourceId && seenIds.has(mapped.sourceId)) continue;
      if (mapped.sourceId) seenIds.add(mapped.sourceId);
      jobs.push(mapped);
      if (options.limit && jobs.length >= options.limit) break;
    }

    if (options.onCheckpoint) {
      await options.onCheckpoint({
        queryIndex: nextIndex % JOBBANK_LIVE_QUERIES.length,
      } satisfies JobBankLiveCheckpoint);
    }

    if (i < maxQueries - 1) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
  }

  return {
    jobs,
    metadata: {
      queriesAttempted,
      totalResults,
      startQueryIndex: startIndex,
      endQueryIndex: nextIndex % JOBBANK_LIVE_QUERIES.length,
      knownQueries: JOBBANK_LIVE_QUERIES.length,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

function buildSearchUrl(keyword: string, location: string): string {
  const params = new URLSearchParams({
    searchstring: keyword,
    locationstring: location,
    sort: "M", // M = "Most recent"
  });
  return `${JOBBANK_BASE}${JOBBANK_SEARCH_PATH}?${params.toString()}`;
}

type ParsedResult = {
  jobId: string;
  detailHref: string;
  title: string | null;
  date: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
};

// Article-block regex — matches each result <article id="article-{id}"…</article>.
// We use a lazy capture and post-process inside the block.
const ARTICLE_BLOCK_REGEX =
  /<article\s+id="article-(\d+)"[^>]*>([\s\S]*?)<\/article>/g;
const DETAIL_HREF_REGEX = /href="(\/jobsearch\/jobposting\/\d+[^"]*)"/;
const NOC_TITLE_REGEX = /<span\s+class="noctitle">\s*([^<]+?)\s*<\/span>/;
const DATE_LI_REGEX =
  /<li\s+class="date">\s*([\s\S]*?)\s*<\/li>/;
const BUSINESS_LI_REGEX =
  /<li\s+class="business">\s*([\s\S]*?)\s*<\/li>/;
const LOCATION_LI_REGEX =
  /<li\s+class="location">([\s\S]*?)<\/li>/;
const SALARY_LI_REGEX =
  /<li\s+class="salary">([\s\S]*?)<\/li>/;

function parseSearchResults(html: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  for (const match of html.matchAll(ARTICLE_BLOCK_REGEX)) {
    const jobId = match[1];
    const block = match[2] ?? "";
    if (!jobId) continue;

    const detailHrefRaw = block.match(DETAIL_HREF_REGEX)?.[1] ?? null;
    const detailHref = detailHrefRaw
      ? stripJsessionId(detailHrefRaw)
      : `/jobsearch/jobposting/${jobId}`;

    const title = textOf(block.match(NOC_TITLE_REGEX)?.[1]);
    const date = textOf(block.match(DATE_LI_REGEX)?.[1]);
    const company = textOf(block.match(BUSINESS_LI_REGEX)?.[1]);
    const location = extractInnerLocation(
      block.match(LOCATION_LI_REGEX)?.[1] ?? null
    );
    const salary = textOf(block.match(SALARY_LI_REGEX)?.[1]);

    results.push({
      jobId,
      detailHref,
      title,
      date,
      company,
      location,
      salary,
    });
  }
  return results;
}

function stripJsessionId(href: string): string {
  return href.replace(/;jsessionid=[^?]+/i, "");
}

function extractInnerLocation(snippet: string | null): string | null {
  if (!snippet) return null;
  // The .location li contains an icon + "Location" wb-inv label + the
  // actual city/province text. Strip tags, collapse whitespace, then
  // remove the leading "Location" label.
  const stripped = stripHtml(snippet)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^Location\s*/i, "")
    .trim();
  return stripped || null;
}

function textOf(snippet: string | undefined): string | null {
  if (!snippet) return null;
  const text = stripHtml(snippet).replace(/\s+/g, " ").trim();
  return text || null;
}

function stripHtml(snippet: string): string {
  return snippet.replace(/<[^>]+>/g, " ");
}

function mapSearchResult(
  result: ParsedResult,
  query: { keyword: string; location: string },
  now: Date
): SourceConnectorJob | null {
  if (!result.title) return null;
  const applyUrl = `${JOBBANK_BASE}${result.detailHref}`;
  const postedAt = parseDate(result.date) ?? now;

  // Parse salary — Job Bank uses formats like "$133,000.00 to $133,900.00
  // annually" — extract min/max numerically; default currency CAD.
  const salary = parseSalary(result.salary);

  return {
    sourceId: `jobbank-live:${result.jobId}`,
    sourceUrl: applyUrl,
    title: result.title,
    company: result.company ?? "Unknown",
    location: result.location ?? query.location,
    description: "", // Will be enriched on detail-page fetch if needed
    applyUrl,
    postedAt,
    deadline: null,
    employmentType: null,
    workMode: "UNKNOWN",
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? "CAD",
    metadata: {
      source: "jobbank-live",
      query: query.keyword,
      queryLocation: query.location,
      salaryText: result.salary,
      datePosted: result.date,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function parseSalary(
  text: string | null
): { min: number | null; max: number | null; currency: string } | null {
  if (!text) return null;
  // Examples:
  //   "$133,000.00 to $133,900.00 annually (to be negotiated)"
  //   "$25.50 hourly"
  //   "$80,000 yearly"
  const numericMatches = text.match(/\$([\d,]+(?:\.\d+)?)/g);
  if (!numericMatches || numericMatches.length === 0) return null;
  const numbers = numericMatches.map((m) =>
    Number.parseFloat(m.replace(/[$,]/g, ""))
  );
  const cleaned = numbers.filter((n) => Number.isFinite(n) && n > 0);
  if (cleaned.length === 0) return null;
  const min = cleaned[0];
  const max = cleaned.length > 1 ? cleaned[cleaned.length - 1] : null;
  return { min, max, currency: "CAD" };
}

function parseDate(input: string | null): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseCheckpoint(
  value: Prisma.InputJsonValue | null | undefined
): JobBankLiveCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { queryIndex?: unknown };
  const queryIndex =
    typeof raw.queryIndex === "number" && Number.isFinite(raw.queryIndex)
      ? Math.max(0, Math.floor(raw.queryIndex))
      : 0;
  return { queryIndex };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
