/**
 * BreezyHR connector.
 *
 * BreezyHR is a mid-market ATS that hiringcafe data revealed our pipeline
 * was NOT polling directly. Each company on BreezyHR exposes a public
 * JSON feed at:
 *
 *   https://{company}.breezy.hr/json
 *
 * The endpoint returns an array of open positions for the company with
 * structured fields (title, location, department, type, description,
 * application_url). No auth, no rate limit issues observed.
 *
 * Mid-tier companies use BreezyHR — adding native connectors per company
 * gives us 5-50 jobs per tenant, fresher than the slow hiringcafe meta-
 * aggregator path.
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

const BREEZY_USER_AGENT =
  "Mozilla/5.0 (compatible; applyoverflow-breezyhr/1.0)";

type BreezyHrJob = {
  _id?: string;
  id?: string;
  name?: string;
  state?: string; // "published" | "archived" | "draft"
  description?: string;
  type?: { name?: string; id?: string };
  category?: { name?: string; id?: string };
  department?: { name?: string; id?: string };
  experience?: { name?: string; id?: string };
  location?: {
    name?: string;
    country?: { name?: string; code?: string };
    city?: string;
    state?: string;
    is_remote?: boolean;
    location_str?: string;
  };
  published_date?: string;
  updated_date?: string;
  application_url?: string;
  url?: string;
};

type BreezyHrConnectorOptions = {
  /** Company subdomain on breezy.hr — e.g. "acme" for acme.breezy.hr */
  company: string;
};

export function createBreezyHrConnector(
  options: BreezyHrConnectorOptions
): SourceConnector {
  const company = (options.company ?? "").trim().toLowerCase();
  if (!company) {
    throw new Error("BreezyHR connector requires a `company` subdomain.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(company)) {
    throw new Error(
      `BreezyHR connector got invalid company slug '${company}'. Expected lowercase alphanumeric + dashes.`
    );
  }

  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: `breezyhr:${company}`,
    sourceName: `BreezyHR:${company}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(fetchOptions.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchBreezyHrJobs({ company, ...fetchOptions });
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchBreezyHrJobs(
  input: SourceConnectorFetchOptions & { company: string }
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(input.signal);
  const now = input.now ?? new Date();
  const url = `https://${input.company}.breezy.hr/json`;

  const response = await fetch(url, {
    signal: input.signal,
    headers: {
      "User-Agent": BREEZY_USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `BreezyHR fetch failed for ${input.company}: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | BreezyHrJob[]
    | { positions?: BreezyHrJob[] }
    | null;

  // BreezyHR sometimes wraps the array under `positions`; tolerate both shapes.
  const rawJobs: BreezyHrJob[] = Array.isArray(payload)
    ? payload
    : payload?.positions ?? [];

  const limited =
    typeof input.limit === "number" ? rawJobs.slice(0, input.limit) : rawJobs;
  const jobs: SourceConnectorJob[] = [];
  let skippedArchived = 0;
  let skippedMissingFields = 0;

  for (const job of limited) {
    if (job.state && job.state !== "published") {
      skippedArchived += 1;
      continue;
    }
    const mapped = mapBreezyHrJob(job, input.company, now);
    if (!mapped) {
      skippedMissingFields += 1;
      continue;
    }
    jobs.push(mapped);
  }

  return {
    jobs,
    metadata: {
      sourceUrl: url,
      company: input.company,
      hitsInResponse: rawJobs.length,
      skippedArchived,
      skippedMissingFields,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

function mapBreezyHrJob(
  job: BreezyHrJob,
  company: string,
  now: Date
): SourceConnectorJob | null {
  const sourceId = sanitizeText(job._id) ?? sanitizeText(job.id);
  const title = sanitizeText(job.name);
  if (!sourceId || !title) return null;

  const applyUrl =
    sanitizeText(job.application_url) ??
    sanitizeText(job.url) ??
    `https://${company}.breezy.hr/p/${sourceId}`;

  const locationStr =
    sanitizeText(job.location?.location_str) ??
    sanitizeText(job.location?.name);
  const city = sanitizeText(job.location?.city);
  const state = sanitizeText(job.location?.state);
  const country = sanitizeText(job.location?.country?.name);
  const locationParts = [city, state, country].filter(Boolean);
  const location =
    locationStr ??
    (locationParts.length > 0 ? locationParts.join(", ") : "Unknown");

  const description = sanitizeText(stripHtml(job.description ?? "")) ?? "";
  const postedAt = parseDate(job.published_date);

  return {
    sourceId: `breezyhr:${company}:${sourceId}`,
    sourceUrl: applyUrl,
    title,
    company: humanizeCompanyName(company),
    location,
    description,
    applyUrl,
    postedAt,
    deadline: null,
    employmentType: inferEmploymentType(job.type?.name, title),
    workMode: inferWorkMode(job.location?.is_remote ?? false, location),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      source: "breezyhr",
      company,
      category: sanitizeText(job.category?.name) ?? null,
      department: sanitizeText(job.department?.name) ?? null,
      experienceLevel: sanitizeText(job.experience?.name) ?? null,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function inferWorkMode(isRemote: boolean, location: string): WorkMode {
  if (isRemote) return "REMOTE";
  if (/remote/i.test(location)) return "REMOTE";
  if (/hybrid/i.test(location)) return "HYBRID";
  return "UNKNOWN";
}

function inferEmploymentType(
  typeName: string | undefined,
  title: string
): EmploymentType | null {
  const t = (typeName ?? "").toLowerCase();
  if (t.includes("intern") || /\bintern(ship)?\b/i.test(title)) return "INTERNSHIP";
  if (t.includes("contract") || /\bcontract\b/i.test(title)) return "CONTRACT";
  if (t.includes("part") || /\bpart[ -]?time\b/i.test(title)) return "PART_TIME";
  if (t.includes("full")) return "FULL_TIME";
  return null;
}

function humanizeCompanyName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
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
