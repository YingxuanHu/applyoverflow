/**
 * Generic JSON-LD careers-page connector.
 *
 * Many mid-market ATSes (Paradox, HRSmart, Avature, custom branded career
 * portals) don't expose a documented JSON API but DO embed schema.org
 * JobPosting JSON-LD in their HTML — that's a Google for Jobs SEO
 * requirement. This connector fetches a configured `boardUrl`, extracts
 * all JobPosting entries from `<script type="application/ld+json">`
 * blocks, and normalizes them.
 *
 * Use cases:
 *   - createParadoxConnector — wraps this with a Paradox URL template
 *   - createHrSmartConnector — wraps this with HRSmart URL template
 *   - createGenericJsonLdBoardConnector — for one-off employer career pages
 *
 * Shared so we don't duplicate the JSON-LD parser across 4-5 connectors.
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

const JSON_LD_USER_AGENT =
  "Mozilla/5.0 (compatible; autoapplication-jsonld/1.0)";

export type JsonLdBoardOptions = {
  /** Connector family — used in source ID prefix. e.g. "paradox", "hrsmart" */
  family: string;
  /** Tenant identifier within the family. e.g. company slug */
  tenant: string;
  /** Fully-qualified URL of the careers page to scrape. */
  boardUrl: string;
  /** Override the default company name shown to users. */
  companyOverride?: string;
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

export function createJsonLdBoardConnector(
  options: JsonLdBoardOptions
): SourceConnector {
  const family = options.family.trim().toLowerCase();
  const tenant = options.tenant.trim().toLowerCase();
  if (!family || !tenant) {
    throw new Error("JSON-LD board connector requires family + tenant.");
  }
  if (!options.boardUrl || !/^https?:\/\//.test(options.boardUrl)) {
    throw new Error(
      `JSON-LD board connector requires a fully-qualified boardUrl. Got '${options.boardUrl}'`
    );
  }

  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();
  return {
    key: `${family}:${tenant}`,
    sourceName: `${capitalize(family)}:${tenant}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = String(fetchOptions.limit ?? "all");
      const existing = fetchCache.get(cacheKey);
      if (existing) return existing;
      const request = fetchJsonLdBoardJobs({
        family,
        tenant,
        boardUrl: options.boardUrl,
        companyOverride: options.companyOverride,
        fetchOptions,
      });
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchJsonLdBoardJobs(input: {
  family: string;
  tenant: string;
  boardUrl: string;
  companyOverride?: string;
  fetchOptions: SourceConnectorFetchOptions;
}): Promise<SourceConnectorFetchResult> {
  throwIfAborted(input.fetchOptions.signal);
  const now = input.fetchOptions.now ?? new Date();

  const response = await fetch(input.boardUrl, {
    signal: input.fetchOptions.signal,
    headers: {
      "User-Agent": JSON_LD_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(
      `${input.family}:${input.tenant} fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const postings = extractJsonLdPostings(html);
  const limited =
    typeof input.fetchOptions.limit === "number"
      ? postings.slice(0, input.fetchOptions.limit)
      : postings;

  const jobs: SourceConnectorJob[] = [];
  const seenIds = new Set<string>();
  let skippedMissingFields = 0;

  for (const posting of limited) {
    const mapped = mapJsonLdPosting(posting, {
      family: input.family,
      tenant: input.tenant,
      companyOverride: input.companyOverride,
      now,
    });
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
      sourceUrl: input.boardUrl,
      family: input.family,
      tenant: input.tenant,
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
      // Skip malformed JSON-LD blocks silently
    }
  }
  return postings;
}

function mapJsonLdPosting(
  posting: JsonLdJobPosting,
  ctx: {
    family: string;
    tenant: string;
    companyOverride?: string;
    now: Date;
  }
): SourceConnectorJob | null {
  const title = sanitizeText(posting.title);
  if (!title) return null;

  const applyUrl = sanitizeText(posting.url);
  if (!applyUrl) return null;

  const companyName =
    sanitizeText(ctx.companyOverride) ??
    sanitizeText(posting.hiringOrganization?.name) ??
    humanizeSlug(ctx.tenant);

  const identifier = extractIdentifier(posting.identifier);
  const sourceId = identifier ?? hashString(applyUrl);

  const location = extractLocation(posting.jobLocation);
  const description = sanitizeText(stripHtml(posting.description ?? "")) ?? "";
  const postedAt = parseDate(posting.datePosted);
  const deadline = parseDate(posting.validThrough);
  const employmentType = mapEmploymentType(posting.employmentType);
  const isRemote =
    (posting.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";

  const minSalary = posting.baseSalary?.value?.minValue;
  const maxSalary = posting.baseSalary?.value?.maxValue;
  const salaryCurrency = sanitizeText(posting.baseSalary?.currency);

  return {
    sourceId: `${ctx.family}:${ctx.tenant}:${sourceId}`,
    sourceUrl: applyUrl,
    title,
    company: companyName,
    location,
    description,
    applyUrl,
    postedAt,
    deadline,
    employmentType,
    workMode: isRemote ? "REMOTE" : ("UNKNOWN" as WorkMode),
    salaryMin: typeof minSalary === "number" ? minSalary : null,
    salaryMax: typeof maxSalary === "number" ? maxSalary : null,
    salaryCurrency: salaryCurrency ?? null,
    metadata: {
      source: ctx.family,
      tenant: ctx.tenant,
      fetchedAt: ctx.now.toISOString(),
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

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
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

/**
 * Convenience wrapper for Paradox AI career sites. Each Paradox client
 * gets a configurable career portal URL — pass it in. The boardUrl is
 * required because Paradox does not have a uniform URL pattern.
 */
export function createParadoxConnector(options: {
  tenant: string;
  boardUrl: string;
  companyOverride?: string;
}): SourceConnector {
  return createJsonLdBoardConnector({
    family: "paradox",
    tenant: options.tenant,
    boardUrl: options.boardUrl,
    companyOverride: options.companyOverride,
  });
}

/**
 * Convenience wrapper for HRSmart (ClearCompany) career sites.
 * Pattern: https://{client}-applications.hrsmart.com or custom subdomain.
 */
export function createHrSmartConnector(options: {
  tenant: string;
  boardUrl: string;
  companyOverride?: string;
}): SourceConnector {
  return createJsonLdBoardConnector({
    family: "hrsmart",
    tenant: options.tenant,
    boardUrl: options.boardUrl,
    companyOverride: options.companyOverride,
  });
}
