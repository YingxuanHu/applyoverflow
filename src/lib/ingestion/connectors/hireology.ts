/**
 * Hireology connector.
 *
 * Hireology is a mid-market ATS heavy in retail HQ, hospitality, dealer
 * networks (auto dealerships' corporate functions), and franchise admin.
 * Each customer gets a careers page at:
 *
 *   https://www.hireology.com/careers/{slug}
 *
 * Hireology embeds standard schema.org JSON-LD JobPosting objects in the
 * HTML. We harvest them and normalize. No auth needed — public board.
 *
 * Some clients also use hireology.com job slug URLs directly:
 *   https://www.hireology.com/careers/{slug}/{job-id}
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

const HIREOLOGY_USER_AGENT =
  "Mozilla/5.0 (compatible; autoapplication-hireology/1.0)";

type HireologyOptions = {
  /** Hireology customer slug. e.g. "acme" → hireology.com/careers/acme */
  slug: string;
};

type JsonLdJobPosting = {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string; sameAs?: string };
  jobLocation?:
    | {
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }
    | Array<{
        address?: {
          addressLocality?: string;
          addressRegion?: string;
          addressCountry?: string | { name?: string };
        };
      }>;
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
  url?: string;
  identifier?: { value?: string | number; name?: string } | string;
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number; maxValue?: number; unitText?: string };
  };
};

export function createHireologyConnector(
  options: HireologyOptions
): SourceConnector {
  const slug = options.slug.trim().toLowerCase();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(
      `Hireology connector got invalid slug '${slug}'. Expected lowercase alphanumeric + dashes.`
    );
  }

  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: `hireology:${slug}`,
    sourceName: `Hireology:${slug}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(fetchOptions.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchHireologyJobs({ slug, ...fetchOptions });
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchHireologyJobs(
  input: SourceConnectorFetchOptions & { slug: string }
): Promise<SourceConnectorFetchResult> {
  throwIfAborted(input.signal);
  const now = input.now ?? new Date();
  const url = `https://www.hireology.com/careers/${input.slug}`;

  const response = await fetch(url, {
    signal: input.signal,
    headers: {
      "User-Agent": HIREOLOGY_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Hireology fetch failed for ${input.slug}: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const postings = extractJsonLdPostings(html);
  const limited =
    typeof input.limit === "number"
      ? postings.slice(0, input.limit)
      : postings;

  const jobs: SourceConnectorJob[] = [];
  let skippedMissingFields = 0;
  const seenIds = new Set<string>();

  for (const posting of limited) {
    const mapped = mapJsonLdPosting(posting, input.slug, now);
    if (!mapped) {
      skippedMissingFields += 1;
      continue;
    }
    if (mapped.sourceId && seenIds.has(mapped.sourceId)) continue;
    if (mapped.sourceId) seenIds.add(mapped.sourceId);
    jobs.push(mapped);
  }

  return {
    jobs,
    metadata: {
      sourceUrl: url,
      slug: input.slug,
      hitsInResponse: postings.length,
      skippedMissingFields,
      fetchedAt: now.toISOString(),
      totalFetched: jobs.length,
    } as Prisma.InputJsonValue,
  };
}

const JSON_LD_REGEX =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function extractJsonLdPostings(html: string): JsonLdJobPosting[] {
  const postings: JsonLdJobPosting[] = [];
  for (const match of html.matchAll(JSON_LD_REGEX)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const typed = item as JsonLdJobPosting;
        const t = typed["@type"];
        const isJobPosting =
          t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
        if (isJobPosting) postings.push(typed);
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }
  return postings;
}

function mapJsonLdPosting(
  posting: JsonLdJobPosting,
  slug: string,
  now: Date
): SourceConnectorJob | null {
  const title = sanitizeText(posting.title);
  if (!title) return null;

  const companyName =
    sanitizeText(posting.hiringOrganization?.name) ?? humanizeSlug(slug);

  const applyUrl = sanitizeText(posting.url);
  if (!applyUrl) return null;

  const identifier = extractIdentifier(posting.identifier);
  const sourceId = identifier ?? hashUrl(applyUrl);

  const location = extractLocation(posting.jobLocation);
  const description =
    sanitizeText(stripHtml(posting.description ?? "")) ?? "";
  const postedAt = parseDate(posting.datePosted);
  const deadline = parseDate(posting.validThrough);
  const employmentType = mapEmploymentType(posting.employmentType);
  const isRemote = (posting.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";

  const minSalary = posting.baseSalary?.value?.minValue;
  const maxSalary = posting.baseSalary?.value?.maxValue;
  const salaryCurrency = sanitizeText(posting.baseSalary?.currency);

  return {
    sourceId: `hireology:${slug}:${sourceId}`,
    sourceUrl: applyUrl,
    title,
    company: companyName,
    location,
    description,
    applyUrl,
    postedAt,
    deadline,
    employmentType,
    workMode: isRemote ? "REMOTE" : "UNKNOWN",
    salaryMin: typeof minSalary === "number" ? minSalary : null,
    salaryMax: typeof maxSalary === "number" ? maxSalary : null,
    salaryCurrency: salaryCurrency ?? null,
    metadata: {
      source: "hireology",
      slug,
      fetchedAt: now.toISOString(),
    } as Prisma.InputJsonValue,
  };
}

function extractIdentifier(
  raw: JsonLdJobPosting["identifier"]
): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return sanitizeText(raw) ?? null;
  if (typeof raw === "object") {
    const v = raw.value;
    if (typeof v === "string") return sanitizeText(v) ?? null;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function extractLocation(
  location: JsonLdJobPosting["jobLocation"]
): string {
  if (!location) return "Unknown";
  const entry = Array.isArray(location) ? location[0] : location;
  const addr = entry?.address;
  if (!addr) return "Unknown";
  const country =
    typeof addr.addressCountry === "string"
      ? addr.addressCountry
      : addr.addressCountry?.name;
  const parts = [
    sanitizeText(addr.addressLocality),
    sanitizeText(addr.addressRegion),
    sanitizeText(country),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

function mapEmploymentType(
  value: string | string[] | undefined
): EmploymentType | null {
  if (!value) return null;
  const tokens = Array.isArray(value)
    ? value.map((v) => v.toUpperCase())
    : [String(value).toUpperCase()];
  if (tokens.includes("INTERN") || tokens.includes("INTERNSHIP"))
    return "INTERNSHIP";
  if (tokens.includes("CONTRACTOR") || tokens.includes("CONTRACT"))
    return "CONTRACT";
  if (tokens.includes("PART_TIME") || tokens.includes("PARTTIME"))
    return "PART_TIME";
  if (tokens.includes("FULL_TIME") || tokens.includes("FULLTIME"))
    return "FULL_TIME";
  return null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function hashUrl(url: string): string {
  // Simple deterministic identifier when JSON-LD doesn't supply one.
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
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
