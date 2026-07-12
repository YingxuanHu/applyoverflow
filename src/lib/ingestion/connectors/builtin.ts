/**
 * BuiltIn job board connector (builtin.com).
 *
 * BuiltIn aggregates tech + tech-adjacent roles across major NA cities
 * (NYC, SF, Boston, Austin, Chicago, LA, Seattle, Denver, plus a national
 * listing). They don't publish an API, but every job page exposes a
 * schema.org JobPosting block as JSON-LD, and the listing page renders
 * canonical job URLs in plain HTML. We scrape both:
 *
 *   1. GET https://builtin.com/jobs/all?page=N      — listing page → URLs
 *   2. GET each https://builtin.com/job/<slug>/<id> — individual page → JSON-LD
 *
 * Volume: ~17-18 unique job URLs per listing page; pagination runs deep
 * (100+ pages observed). We cap pages-per-cycle from env so a single run
 * doesn't blow the runtime budget.
 *
 * NA relevance: very high — BuiltIn is NA-only (US cities + remote roles
 * that hire across NA). Tech-heavy, finance-tech and ops mixed in.
 *
 * Attribution: link back to the BuiltIn job URL via sourceUrl (apply URL
 * usually points to the employer's ATS, which we preserve when present in
 * the JSON-LD payload).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EmploymentType, WorkMode } from "@/generated/prisma/client";
import { sleepWithAbort, throwIfAborted } from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

// Built In has a national board (builtin.com/jobs/all) plus city subsites
// (built in NYC, LA, Boston, Austin, Chicago, Seattle, Denver/Colorado,
// SF). Each city subsite paginates its own job set, so adding them as
// separate profiles 5-8× the connector's throughput vs. running just the
// national board. Maps profile name → base listing URL.
const BUILTIN_LISTING_URLS: Record<string, string> = {
  national: "https://builtin.com/jobs/all",
  nyc: "https://www.builtinnyc.com/jobs/all",
  la: "https://www.builtinla.com/jobs/all",
  boston: "https://www.builtinboston.com/jobs/all",
  chicago: "https://www.builtinchicago.org/jobs/all",
  austin: "https://www.builtinaustin.com/jobs/all",
  seattle: "https://www.builtinseattle.com/jobs/all",
  colorado: "https://www.builtincolorado.com/jobs/all",
  sf: "https://www.builtinsf.com/jobs/all",
};
const BUILTIN_DEFAULT_MAX_PAGES = 8;
const BUILTIN_DEFAULT_RATE_DELAY_MS = 600;
const BUILTIN_USER_AGENT =
  "Mozilla/5.0 (compatible; applyoverflow-builtin/1.0; +https://applyoverflow.com/bot)";

// JSON-LD JobPosting per schema.org. Fields we actually consume.
type JsonLdJobPosting = {
  "@type"?: string | string[];
  "@context"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  hiringOrganization?: {
    name?: string;
    sameAs?: string;
    "@type"?: string;
  };
  jobLocation?:
    | {
        "@type"?: string;
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }
    | Array<{
        "@type"?: string;
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }>;
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
  url?: string;
  identifier?: { value?: string | number; name?: string };
  baseSalary?: {
    currency?: string;
    value?: {
      minValue?: number;
      maxValue?: number;
      unitText?: string;
    };
  };
  directApply?: boolean;
  industry?: string;
};

export type BuiltInConnectorOptions = {
  /**
   * Which Built In subsite to scrape. Defaults to "national" (builtin.com).
   * City profiles paginate independently — running multiple profiles in
   * parallel multiplies throughput.
   */
  profile?: keyof typeof BUILTIN_LISTING_URLS;
};

export function createBuiltInConnector(
  options: BuiltInConnectorOptions = {}
): SourceConnector {
  const profile = (options.profile ?? "national") as keyof typeof BUILTIN_LISTING_URLS;
  const baseUrl = BUILTIN_LISTING_URLS[profile];
  if (!baseUrl) {
    throw new Error(
      `BuiltIn connector got unknown profile '${String(profile)}'. Known: ${Object.keys(BUILTIN_LISTING_URLS).join(", ")}`
    );
  }

  // Preserve "builtin:feed" key for the national profile so existing
  // IngestionRun history + checkpoints + adaptive-budget signals carry
  // over. City profiles get distinct keys.
  const keySuffix = profile === "national" ? "feed" : profile;

  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: `builtin:${keySuffix}`,
    sourceName: `BuiltIn:${keySuffix}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(fetchOptions.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchBuiltInJobs(fetchOptions, baseUrl);
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchBuiltInJobs(
  options: SourceConnectorFetchOptions,
  baseListingUrl: string
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? new Date();
  const limit = options.limit;

  const maxPages = readPositiveIntEnv("BUILTIN_MAX_PAGES", BUILTIN_DEFAULT_MAX_PAGES);
  const rateDelayMs = readPositiveIntEnv(
    "BUILTIN_RATE_DELAY_MS",
    BUILTIN_DEFAULT_RATE_DELAY_MS
  );

  const collectedUrls = new Set<string>();
  let pagesFetched = 0;
  let lastListingFailure: { page: number; status: number } | null = null;

  // Phase 1: walk listing pages, accumulate canonical job URLs.
  for (let page = 1; page <= maxPages; page += 1) {
    if (limit && collectedUrls.size >= limit) break;
    throwIfAborted(options.signal);

    const listingUrl =
      page === 1 ? baseListingUrl : `${baseListingUrl}?page=${page}`;

    let html: string;
    try {
      const response = await fetch(listingUrl, {
        signal: options.signal,
        headers: {
          "User-Agent": BUILTIN_USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) {
        lastListingFailure = { page, status: response.status };
        // 404/410 from a paginated listing means we walked past the end;
        // anything else is treated the same way — stop and use what we have.
        break;
      }
      html = await response.text();
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastListingFailure = { page, status: 0 };
      break;
    }

    pagesFetched += 1;
    const before = collectedUrls.size;
    extractBuiltInJobUrls(html).forEach((url) => collectedUrls.add(url));
    const added = collectedUrls.size - before;

    // Listing page returned zero NEW URLs — we've reached the tail.
    if (added === 0) break;

    if (rateDelayMs > 0 && page < maxPages) {
      await sleepWithAbort(rateDelayMs, options.signal);
    }
  }

  // Phase 2: fetch each job page and parse JSON-LD.
  const urls = limit ? [...collectedUrls].slice(0, limit) : [...collectedUrls];
  const jobs: SourceConnectorJob[] = [];
  let jobPageFailures = 0;

  for (const url of urls) {
    throwIfAborted(options.signal);
    try {
      const job = await fetchBuiltInJobPage(url, options.signal, now);
      if (job) jobs.push(job);
    } catch (error) {
      if (isAbortError(error)) throw error;
      jobPageFailures += 1;
    }
    if (rateDelayMs > 0) {
      await sleepWithAbort(rateDelayMs, options.signal);
    }
  }

  return {
    jobs,
    metadata: {
      listingUrl: baseListingUrl,
      pagesFetched,
      urlsCollected: collectedUrls.size,
      jobPageFailures,
      lastListingFailure: lastListingFailure
        ? `page=${lastListingFailure.page} status=${lastListingFailure.status}`
        : null,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

async function fetchBuiltInJobPage(
  url: string,
  signal: AbortSignal | undefined,
  now: Date
): Promise<SourceConnectorJob | null> {
  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": BUILTIN_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const posting = extractFirstJobPostingJsonLd(html);
  if (!posting) return null;
  return mapBuiltInJobPostingToSourceJob(posting, url, now);
}

// ─── Parsers ────────────────────────────────────────────────────────────────

// Accept all BuiltIn host variants: builtin.com (national), builtinnyc.com,
// builtinla.com, builtinboston.com, builtinaustin.com, builtinseattle.com,
// builtincolorado.com, builtinsf.com, builtinchicago.org. Previously
// hardcoded to `builtin.com` which meant the city subsites' job URLs all
// got filtered out and the city shards produced zero jobs.
const JOB_URL_REGEX =
  /https:\/\/(?:www\.)?builtin[a-z]*\.(?:com|org)\/job\/[a-z0-9][a-z0-9\-]*\/\d+/g;

function extractBuiltInJobUrls(html: string): string[] {
  const matches = html.match(JOB_URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

// BuiltIn renders the script tag with `+` HTML-entity-encoded:
//   <script type="application/ld&#x2B;json">
// (other sites use the literal `+`). Accept either form. We also accept any
// `application/ld...json` shape rather than requiring the exact mime, so we
// don't get tripped up by future encoding variants.
const JSON_LD_BLOCK_REGEX =
  /<script[^>]+type=["']application\/ld(?:\+|&#x2B;|&#43;|&plus;)json["'][^>]*>([\s\S]*?)<\/script>/gi;

function extractFirstJobPostingJsonLd(html: string): JsonLdJobPosting | null {
  let match: RegExpExecArray | null;
  while ((match = JSON_LD_BLOCK_REGEX.exec(html)) != null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const parsed = safeParseJson(raw);
    if (!parsed) continue;
    const postings = collectJobPostings(parsed);
    if (postings.length > 0) return postings[0]!;
  }
  return null;
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    // BuiltIn occasionally includes raw HTML entities or trailing commas
    // inside the JSON-LD; one cheap recovery pass before giving up.
    const cleaned = input
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function collectJobPostings(node: unknown): JsonLdJobPosting[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((entry) => collectJobPostings(entry));
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isJobPosting =
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"));
  if (isJobPosting) return [obj as JsonLdJobPosting];
  // Some pages wrap in @graph: [{...JobPosting}, {...Organization}]
  if (Array.isArray(obj["@graph"])) {
    return collectJobPostings(obj["@graph"]);
  }
  return [];
}

function mapBuiltInJobPostingToSourceJob(
  posting: JsonLdJobPosting,
  sourceUrl: string,
  now: Date
): SourceConnectorJob | null {
  const title = sanitizeText(posting.title);
  if (!title) return null;
  const company = sanitizeText(posting.hiringOrganization?.name);
  if (!company) return null;

  const sourceId = extractSourceId(sourceUrl, posting);
  if (!sourceId) return null;

  const description = stripHtml(sanitizeText(posting.description) ?? "");
  const applyUrl =
    sanitizeText(posting.url) ?? sourceUrl;
  const location = inferLocation(posting);
  const workMode = inferWorkMode(posting, location);
  const employmentType = inferEmploymentType(posting.employmentType, title);
  const postedAt = parseDate(posting.datePosted);
  const deadline = parseDate(posting.validThrough);
  const { salaryMin, salaryMax, salaryCurrency } = readSalary(posting);

  return {
    sourceId: `builtin:${sourceId}`,
    sourceUrl,
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
      source: "builtin",
      industry: posting.industry ?? null,
      hiringOrganizationUrl: posting.hiringOrganization?.sameAs ?? null,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function extractSourceId(
  sourceUrl: string,
  posting: JsonLdJobPosting
): string | null {
  // Prefer the structured identifier when present.
  const identifier = posting.identifier?.value;
  if (typeof identifier === "string" && identifier.trim()) return identifier.trim();
  if (typeof identifier === "number") return String(identifier);
  // Fall back to the numeric segment of the canonical URL.
  const match = sourceUrl.match(/\/(\d+)(?:[/?#]|$)/);
  return match?.[1] ?? null;
}

function inferLocation(posting: JsonLdJobPosting): string {
  const job = posting.jobLocation;
  const first = Array.isArray(job) ? job[0] : job;
  if (first?.address) {
    const addr = first.address;
    const parts = [
      sanitizeText(addr.addressLocality),
      sanitizeText(addr.addressRegion),
      sanitizeText(
        typeof addr.addressCountry === "string"
          ? addr.addressCountry
          : addr.addressCountry?.name
      ),
    ].filter((value): value is string => Boolean(value));
    if (parts.length > 0) return parts.join(", ");
  }
  const remoteHint =
    posting.jobLocationType ?? sanitizeText(posting.applicantLocationRequirements as string | undefined);
  if (remoteHint && /telecommute|remote/i.test(remoteHint)) return "Remote";
  return "Unknown";
}

function inferWorkMode(
  posting: JsonLdJobPosting,
  location: string
): WorkMode {
  const locType = posting.jobLocationType;
  if (typeof locType === "string" && /telecommute|remote/i.test(locType)) {
    return "REMOTE";
  }
  if (/^remote\b/i.test(location)) return "REMOTE";
  if (/hybrid/i.test(location)) return "HYBRID";
  return "ONSITE";
}

function inferEmploymentType(
  raw: string | string[] | undefined,
  title: string
): EmploymentType | null {
  const flat = (Array.isArray(raw) ? raw.join(" ") : raw ?? "").toLowerCase();
  if (flat.includes("intern")) return "INTERNSHIP";
  if (flat.includes("contract") || flat.includes("temporary")) return "CONTRACT";
  if (flat.includes("part_time") || flat.includes("part-time")) return "PART_TIME";
  if (flat.includes("full_time") || flat.includes("full-time")) return "FULL_TIME";
  // Title-level hints when employmentType is missing.
  const lowerTitle = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(lowerTitle)) return "INTERNSHIP";
  if (/\bco-?op\b/.test(lowerTitle)) return "INTERNSHIP";
  if (/\bcontract\b/.test(lowerTitle)) return "CONTRACT";
  return null;
}

function readSalary(posting: JsonLdJobPosting): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
} {
  const value = posting.baseSalary?.value;
  if (!value) {
    return { salaryMin: null, salaryMax: null, salaryCurrency: null };
  }
  const min = typeof value.minValue === "number" && value.minValue > 0 ? value.minValue : null;
  const max = typeof value.maxValue === "number" && value.maxValue > 0 ? value.maxValue : null;
  const currency =
    sanitizeText(posting.baseSalary?.currency) ?? (min || max ? "USD" : null);
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: currency,
  };
}

function parseDate(input: string | undefined): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function sanitizeText<T extends string | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  return value.replace(/\s+/g, " ").trim() as T;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s)?/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}
