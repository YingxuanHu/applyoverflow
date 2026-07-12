/**
 * Y Combinator "Work at a Startup" connector (workatastartup.com).
 *
 * IMPORTANT: This site is Rails + Inertia.js (Vue), NOT Next.js. It serves
 * an HTML page with the page payload embedded in a `data-page="..."`
 * attribute on the root div, URL-encoded. Hitting `/jobs` returns 406 to
 * unauthenticated clients, but `/companies` and `/companies/{slug}` return
 * 200 with the data-page payload intact.
 *
 * Strategy:
 *   1. Fetch `/companies` to discover company slugs (~8 per page, plus
 *      the "otherCompanies" array embedded in any company page).
 *   2. For each discovered company, fetch `/companies/{slug}` and extract
 *      `props.company.jobs` — typically 1-10 jobs per company.
 *   3. Dedupe across pages.
 *
 * Volume: lower per-cycle than direct ATS polling (we already cover most
 * YC companies via Greenhouse/Lever/Ashby), but surfaces companies the
 * enterprise discovery catalog hasn't seeded yet. Tier 3.
 */
import type { Prisma } from "@/generated/prisma/client";

import { throwIfAborted } from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const WORKATASTARTUP_BASE = "https://www.workatastartup.com";
const WORKATASTARTUP_COMPANIES_URL = `${WORKATASTARTUP_BASE}/companies`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";
const COMPANY_FETCH_DELAY_MS = 600;
const DEFAULT_MAX_COMPANIES_PER_RUN = 12;

type YcCompany = {
  id?: number | string;
  name?: string;
  slug?: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  jobs?: YcJob[];
};

type YcJob = {
  id?: number | string;
  title?: string;
  name?: string;
  description?: string;
  location?: string;
  jobType?: string;
  salaryRange?: string;
  equityRange?: string;
  minExperience?: string;
  sponsorsVisa?: string;
  url?: string;
  apply_url?: string;
};

type DataPageProps = {
  props?: {
    company?: YcCompany;
    companies?: YcCompany[];
    otherCompanies?: YcCompany[];
    jobs?: YcJob[];
  };
};

export function createWorkAtAStartupConnector(): SourceConnector {
  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: "workatastartup:feed",
    sourceName: "WorkAtAStartup:feed",
    sourceTier: "TIER_3",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      options: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(options.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchWorkAtAStartupJobs(options);
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchWorkAtAStartupJobs(
  options: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(options.signal);
  const now = options.now ?? new Date();

  // 1) Hit /companies index — it lists 8 companies + the parent props has
  //    no jobs of its own, so we use it as a slug discovery source.
  const indexHtml = await fetchHtml(WORKATASTARTUP_COMPANIES_URL, options.signal);
  const indexProps = extractDataPage(indexHtml);
  const slugSet = new Set<string>();
  collectSlugs(indexProps, slugSet);
  // Also scrape `/companies/{slug}` href patterns from raw HTML as a
  // fallback if the data-page didn't include the list.
  for (const match of indexHtml.matchAll(/\/companies\/([a-z0-9][a-z0-9-]+)/gi)) {
    if (match[1]) slugSet.add(match[1]);
  }

  const slugs = Array.from(slugSet);
  const maxCompanies = readPositiveIntEnv(
    "WORKATASTARTUP_MAX_COMPANIES_PER_RUN",
    DEFAULT_MAX_COMPANIES_PER_RUN
  );
  const targetSlugs = slugs.slice(0, maxCompanies);

  const jobs: SourceConnectorJob[] = [];
  const seenIds = new Set<string>();
  let companiesFetched = 0;
  let companiesFailed = 0;

  for (const slug of targetSlugs) {
    if (options.limit && jobs.length >= options.limit) break;
    throwIfAborted(options.signal);

    let html: string;
    try {
      html = await fetchHtml(
        `${WORKATASTARTUP_BASE}/companies/${slug}`,
        options.signal
      );
    } catch {
      companiesFailed += 1;
      continue;
    }
    companiesFetched += 1;

    const data = extractDataPage(html);
    const company = data?.props?.company;
    if (!company) continue;

    const companyJobs = Array.isArray(company.jobs) ? company.jobs : [];
    for (const job of companyJobs) {
      if (options.limit && jobs.length >= options.limit) break;
      const mapped = mapYcJob(job, company, slug, now);
      if (!mapped) continue;
      if (mapped.sourceId && seenIds.has(mapped.sourceId)) continue;
      if (mapped.sourceId) seenIds.add(mapped.sourceId);
      jobs.push(mapped);
    }

    if (targetSlugs.indexOf(slug) < targetSlugs.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, COMPANY_FETCH_DELAY_MS)
      );
    }
  }

  return {
    jobs,
    metadata: {
      sourceUrl: WORKATASTARTUP_COMPANIES_URL,
      slugsDiscovered: slugs.length,
      companiesAttempted: targetSlugs.length,
      companiesFetched,
      companiesFailed,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

async function fetchHtml(url: string, signal: AbortSignal | undefined): Promise<string> {
  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Work at a Startup fetch failed: ${response.status} ${response.statusText} @ ${url}`
    );
  }
  return response.text();
}

const DATA_PAGE_REGEX = /data-page="([^"]+)"/;

function extractDataPage(html: string): DataPageProps | null {
  const match = html.match(DATA_PAGE_REGEX);
  if (!match?.[1]) return null;
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
  try {
    return JSON.parse(decoded) as DataPageProps;
  } catch {
    return null;
  }
}

function collectSlugs(props: DataPageProps | null, target: Set<string>) {
  const lists: YcCompany[] = [];
  if (props?.props?.companies) lists.push(...props.props.companies);
  if (props?.props?.otherCompanies) lists.push(...props.props.otherCompanies);
  for (const c of lists) {
    if (typeof c.slug === "string" && c.slug.length > 0) target.add(c.slug);
  }
}

function mapYcJob(
  job: YcJob,
  company: YcCompany,
  slug: string,
  now: Date
): SourceConnectorJob | null {
  const title = sanitizeText(job.title) ?? sanitizeText(job.name);
  if (!title) return null;

  const companyName = sanitizeText(company.name) ?? humanizeSlug(slug);
  const idCandidate = sanitizeText(
    typeof job.id === "number" ? job.id.toString() : job.id
  );
  if (!idCandidate) return null;

  const applyUrl =
    sanitizeText(job.apply_url) ??
    sanitizeText(job.url) ??
    `${WORKATASTARTUP_BASE}/companies/${slug}/jobs/${idCandidate}-${slugify(title)}`;

  const location = sanitizeText(job.location) ?? "Unknown";
  const description = sanitizeText(job.description) ?? "";

  return {
    sourceId: `workatastartup:${slug}:${idCandidate}`,
    sourceUrl: applyUrl,
    title,
    company: companyName,
    location,
    description,
    applyUrl,
    postedAt: now,
    deadline: null,
    employmentType: inferEmploymentType(job.jobType),
    workMode: /remote/i.test(location) ? "REMOTE" : "UNKNOWN",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      source: "workatastartup",
      companySlug: slug,
      companyOneLiner: sanitizeText(company.one_liner) ?? null,
      companyWebsite: sanitizeText(company.website) ?? null,
      jobType: sanitizeText(job.jobType) ?? null,
      salaryRange: sanitizeText(job.salaryRange) ?? null,
      equityRange: sanitizeText(job.equityRange) ?? null,
      minExperience: sanitizeText(job.minExperience) ?? null,
      sponsorsVisa: sanitizeText(job.sponsorsVisa) ?? null,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function inferEmploymentType(jobType: string | undefined) {
  if (!jobType) return null;
  const t = jobType.toLowerCase();
  if (t.includes("intern")) return "INTERNSHIP";
  if (t.includes("contract")) return "CONTRACT";
  if (t.includes("part")) return "PART_TIME";
  if (t.includes("full")) return "FULL_TIME";
  return null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeText<T extends string | undefined>(value: T): T {
  if (typeof value !== "string") return value;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || undefined) as T;
}
