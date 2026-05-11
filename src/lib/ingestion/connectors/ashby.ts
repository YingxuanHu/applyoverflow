import type { Prisma } from "@/generated/prisma/client";
import type {
  EmploymentType,
  WorkMode,
} from "@/generated/prisma/client";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";
import {
  buildTimeoutSignal,
  throwIfAborted,
} from "@/lib/ingestion/runtime-control";

type AshbyConnectorOptions = {
  orgSlug: string;
  companyName?: string;
};

// ─── Page-embedded data types ────────────────────────────────────────────────
// Ashby embeds window.__appData on every page.
// Listing page: appData.jobBoard.jobPostings[]
// Detail page:  appData.posting

type AshbyJobListing = {
  id: string;
  title: string;
  updatedAt?: string | null;
  publishedDate?: string | null;
  applicationDeadline?: string | null;
  locationName?: string | null;
  locationExternalName?: string | null;
  workplaceType?: string | null; // "Remote" | "OnSite" | "Hybrid"
  employmentType?: string | null; // "FullTime" | "PartTime" | "Contract" | "Intern"
  isListed?: boolean | null;
  departmentName?: string | null;
  teamName?: string | null;
  secondaryLocations?: Array<{ locationName?: string | null }> | null;
};

type AshbyJobDetail = {
  id: string;
  descriptionPlainText?: string | null;
  descriptionHtml?: string | null;
  isRemote?: boolean | null;
};

type AshbyAppData = {
  jobBoard?: {
    jobPostings?: AshbyJobListing[] | null;
  } | null;
  posting?: AshbyJobDetail | null;
};

// ─── Connector factory ────────────────────────────────────────────────────────

function readPositiveIntegerEnv(
  envName: string,
  fallback: number
) {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DETAIL_BATCH_SIZE = readPositiveIntegerEnv(
  "ASHBY_DETAIL_BATCH_SIZE",
  5
);
const LISTING_FETCH_TIMEOUT_MS = readPositiveIntegerEnv(
  "ASHBY_LISTING_FETCH_TIMEOUT_MS",
  20_000
);
const DETAIL_FETCH_TIMEOUT_MS = readPositiveIntegerEnv(
  "ASHBY_DETAIL_FETCH_TIMEOUT_MS",
  12_000
);
const DETAIL_RUNTIME_RESERVE_MS = readPositiveIntegerEnv(
  "ASHBY_DETAIL_RUNTIME_RESERVE_MS",
  20_000
);
const DETAIL_MIN_BATCH_BUDGET_MS = readPositiveIntegerEnv(
  "ASHBY_DETAIL_MIN_BATCH_BUDGET_MS",
  6_000
);
const DETAIL_WARNING_LOG_CAP = readPositiveIntegerEnv(
  "ASHBY_DETAIL_WARNING_LOG_CAP",
  3
);
const BASE_URL = "https://jobs.ashbyhq.com";
const USER_AGENT =
  "Mozilla/5.0 (compatible; JobIndexer/1.0)";

export function createAshbyConnector({
  orgSlug,
  companyName,
}: AshbyConnectorOptions): SourceConnector {
  const resolvedCompanyName = companyName ?? buildCompanyName(orgSlug);

  return {
    key: `ashby:${orgSlug}`,
    sourceName: `Ashby:${orgSlug}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      options: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const log = options.log ?? console.warn;
      // Stage 1: fetch listing page to get job summaries
      const listingData = await fetchAshbyPage(
        `${BASE_URL}/${orgSlug}`,
        options.signal,
        LISTING_FETCH_TIMEOUT_MS
      );
      const allListings = (listingData.jobBoard?.jobPostings ?? []).filter(
        (job) => job.isListed !== false
      );

      const listings =
        typeof options.limit === "number"
          ? allListings.slice(0, options.limit)
          : allListings;

      // Stage 2: fetch detail pages for jobs that may be NA-relevant
      // We only fetch detail for jobs whose location suggests North America or Remote
      // to avoid heavy fetches for clearly out-of-scope jobs.
      const detailCandidates = listings.filter((job) =>
        mayBeNorthAmerica(job.locationName, job.workplaceType)
      );

      const detailMap = new Map<string, AshbyJobDetail>();
      let detailBudgetTruncated = false;
      let detailWarnings = 0;
      let detailWarningsSuppressed = 0;
      const detailDeadlineAt = getDetailDeadlineAt(options.deadlineAt);

      for (let i = 0; i < detailCandidates.length; i += DETAIL_BATCH_SIZE) {
        throwIfAborted(options.signal);
        const remainingDetailBudgetMs = getRemainingBudgetMs(detailDeadlineAt);
        if (
          remainingDetailBudgetMs != null &&
          remainingDetailBudgetMs < DETAIL_MIN_BATCH_BUDGET_MS
        ) {
          detailBudgetTruncated = true;
          break;
        }

        const batch = detailCandidates.slice(i, i + DETAIL_BATCH_SIZE);
        const batchSignal = buildTimeoutSignal(
          options.signal,
          remainingDetailBudgetMs == null
            ? DETAIL_FETCH_TIMEOUT_MS
            : Math.max(
                1,
                Math.min(DETAIL_FETCH_TIMEOUT_MS, remainingDetailBudgetMs)
              )
        );
        const results = await Promise.allSettled(
          batch.map(async (job) => {
            const data = await fetchAshbyPage(
              `${BASE_URL}/${orgSlug}/${job.id}`,
              batchSignal,
              DETAIL_FETCH_TIMEOUT_MS
            );
            if (data.posting) detailMap.set(job.id, data.posting);
          })
        );

        let batchHitRuntimeBudget = false;
        for (const result of results) {
          if (result.status === "rejected") {
            const errorMessage =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);

            if (isRuntimeBudgetLikeError(errorMessage)) {
              batchHitRuntimeBudget = true;
              continue;
            }

            if (detailWarnings < DETAIL_WARNING_LOG_CAP) {
              log(`[ashby:${orgSlug}] Detail fetch warning: ${errorMessage}`);
              detailWarnings += 1;
            } else {
              detailWarningsSuppressed += 1;
            }
          }
        }

        if (batchHitRuntimeBudget) {
          detailBudgetTruncated = true;
          break;
        }
      }

      if (detailBudgetTruncated) {
        log(
          `[ashby:${orgSlug}] Detail fetch truncated at ${detailMap.size}/${detailCandidates.length} candidate pages to stay within runtime budget`
        );
      }

      if (detailWarningsSuppressed > 0) {
        log(
          `[ashby:${orgSlug}] Suppressed ${detailWarningsSuppressed} additional detail warning(s)`
        );
      }

      const jobs: SourceConnectorJob[] = listings.map((listing) => {
        const detail = detailMap.get(listing.id) ?? null;
        const description = buildDescription(listing, detail);
        const location = buildLocation(listing);
        const applyUrl = `${BASE_URL}/${orgSlug}/${listing.id}`;

        return {
          sourceId: listing.id,
          sourceUrl: applyUrl,
          title: listing.title,
          company: resolvedCompanyName,
          location,
          description,
          applyUrl,
          postedAt: parseDateValue(listing.publishedDate),
          deadline: parseDateValue(listing.applicationDeadline),
          employmentType: inferEmploymentType(listing.employmentType),
          workMode: inferWorkMode(listing.workplaceType, detail?.isRemote),
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          metadata: {
            listing,
            detail: detail ?? null,
          } as unknown as Prisma.InputJsonValue,
        };
      });

      return {
        jobs,
        metadata: {
          orgSlug,
          companyName: resolvedCompanyName,
          fetchedAt: options.now.toISOString(),
          totalListings: allListings.length,
          detailCandidates: detailCandidates.length,
          detailsFetched: detailMap.size,
          detailBudgetTruncated,
        },
      };
    },
  };
}

// ─── HTML data extraction ─────────────────────────────────────────────────────

async function fetchAshbyPage(
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = 45_000
): Promise<AshbyAppData> {
  throwIfAborted(signal);
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: buildTimeoutSignal(signal, timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Ashby page fetch failed for ${url}: ${response.status} ${response.statusText}`
    );
  }

  throwIfAborted(signal);
  const html = await response.text();
  return extractAppData(html, url);
}

function getDetailDeadlineAt(deadlineAt?: Date | null) {
  if (!deadlineAt) return null;
  return new Date(deadlineAt.getTime() - DETAIL_RUNTIME_RESERVE_MS);
}

function getRemainingBudgetMs(deadlineAt?: Date | null) {
  if (!deadlineAt) return null;
  return deadlineAt.getTime() - Date.now();
}

function isRuntimeBudgetLikeError(errorMessage: string) {
  return /\bTIME_BUDGET_EXCEEDED\b|ABORTED_BY_RUNNER|AbortError|runtime budget exceeded/i.test(
    errorMessage
  );
}

function extractAppData(html: string, sourceUrl: string): AshbyAppData {
  const marker = "window.__appData = ";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`window.__appData not found on Ashby page: ${sourceUrl}`);
  }

  const start = markerIdx + marker.length;

  // Walk the string counting braces to find the end of the JSON object
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(
      `Could not locate end of window.__appData on Ashby page: ${sourceUrl}`
    );
  }

  try {
    return JSON.parse(html.slice(start, end)) as AshbyAppData;
  } catch (e) {
    throw new Error(
      `Failed to parse window.__appData on ${sourceUrl}: ${String(e)}`
    );
  }
}

// ─── Field builders ───────────────────────────────────────────────────────────

function buildDescription(
  listing: AshbyJobListing,
  detail: AshbyJobDetail | null
): string {
  if (detail?.descriptionPlainText?.trim()) {
    return detail.descriptionPlainText.trim();
  }
  // Fallback: compose a minimal description from listing metadata
  const parts: string[] = [];
  if (listing.teamName) parts.push(`Team: ${listing.teamName}`);
  if (listing.departmentName) parts.push(`Department: ${listing.departmentName}`);
  return parts.join("\n");
}

function buildLocation(listing: AshbyJobListing): string {
  const primary = listing.locationName?.trim();
  const secondaries = (listing.secondaryLocations ?? [])
    .map((l) => l.locationName?.trim())
    .filter(Boolean) as string[];

  const all = [primary, ...secondaries].filter(Boolean) as string[];
  if (all.length > 0) return [...new Set(all)].join(", ");
  return "Unknown";
}

// Approximate NA-relevance check — used to decide whether to fetch detail pages.
// The real NA filter runs in normalize.ts; this just avoids fetching clearly
// non-NA pages (e.g., "Australia", "France", "Singapore" without remote).
function mayBeNorthAmerica(
  locationName: unknown,
  workplaceType: unknown
): boolean {
  const normalizedWorkplaceType = readAshbyText(workplaceType)?.toLowerCase() ?? null;
  // Remote positions are always candidates (could be open to NA residents)
  if (normalizedWorkplaceType === "remote") return true;

  const normalizedLocation = readAshbyText(locationName);
  if (!normalizedLocation) return true; // Uncertain — include it
  const lower = normalizedLocation.toLowerCase();
  // Explicit NA markers
  if (
    lower.includes("united states") ||
    lower.includes("canada") ||
    lower.includes("remote") ||
    lower.includes("u.s.") ||
    lower.includes(" us ") ||
    lower.endsWith(", us") ||
    lower.includes("new york") ||
    lower.includes("san francisco") ||
    lower.includes("los angeles") ||
    lower.includes("chicago") ||
    lower.includes("seattle") ||
    lower.includes("boston") ||
    lower.includes("austin") ||
    lower.includes("toronto") ||
    lower.includes("vancouver")
  ) {
    return true;
  }
  // Explicit non-NA markers — skip detail fetch
  if (
    lower.includes("australia") ||
    lower.includes("europe") ||
    lower.includes("uk ") ||
    lower.includes("united kingdom") ||
    lower.includes("london") ||
    lower.includes("amsterdam") ||
    lower.includes("berlin") ||
    lower.includes("paris") ||
    lower.includes("singapore") ||
    lower.includes("tokyo") ||
    lower.includes("india") ||
    lower.includes("brazil")
  ) {
    return false;
  }
  return true; // Uncertain — include it
}

// ─── Inference helpers ────────────────────────────────────────────────────────

function inferEmploymentType(
  value: unknown
): EmploymentType | null {
  const normalized = readAshbyText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("intern")) return "INTERNSHIP";
  if (normalized.includes("contract") || normalized.includes("temp"))
    return "CONTRACT";
  if (normalized.includes("part")) return "PART_TIME";
  if (normalized.includes("full")) return "FULL_TIME";
  return null;
}

function inferWorkMode(
  workplaceType: unknown,
  isRemote: boolean | null | undefined
): WorkMode | null {
  if (isRemote) return "REMOTE";
  const normalized = readAshbyText(workplaceType)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "remote") return "REMOTE";
  if (normalized === "hybrid") return "HYBRID";
  if (normalized === "onsite" || normalized === "on-site") return "ONSITE";
  return null;
}

function readAshbyText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Known company name overrides for slugs where naive title-casing is wrong. */
const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  openai: "OpenAI",
  workos: "WorkOS",
  nerdwallet: "NerdWallet",
  "runway-ml": "Runway ML",
};

function buildCompanyName(orgSlug: string): string {
  if (COMPANY_NAME_OVERRIDES[orgSlug]) return COMPANY_NAME_OVERRIDES[orgSlug];
  return orgSlug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
