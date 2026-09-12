import type {
  EmploymentType,
  WorkMode,
} from "@/generated/prisma/client";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
} from "@/lib/ingestion/types";
import { throwIfAborted } from "@/lib/ingestion/runtime-control";
import { isClearlyNonNorthAmericanLocation } from "@/lib/geo-scope";
import { isExcludedJobTitle } from "@/lib/jobs/scope-policy";
import { descriptionHtmlToText } from "@/lib/jobs/description-html";

const SMARTRECRUITERS_PAGE_SIZE = 100;
const DETAIL_BATCH_SIZE = 8;

type SmartRecruitersConnectorOptions = {
  companyIdentifier: string;
  companyName?: string;
};

type SmartRecruitersListingResponse = {
  offset: number;
  limit: number;
  totalFound: number;
  content: SmartRecruitersListing[];
};

type SmartRecruitersLocation = {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  fullLocation?: string | null;
};

type SmartRecruitersValueLabel = {
  id?: string | null;
  label?: string | null;
};

type SmartRecruitersCompany = {
  identifier?: string | null;
  name?: string | null;
};

type SmartRecruitersListing = {
  id: string;
  name: string;
  refNumber?: string | null;
  releasedDate?: string | null;
  postingUrl?: string | null;
  applyUrl?: string | null;
  location?: SmartRecruitersLocation | null;
  company?: SmartRecruitersCompany | null;
  department?: SmartRecruitersValueLabel | null;
  function?: SmartRecruitersValueLabel | null;
  industry?: SmartRecruitersValueLabel | null;
  typeOfEmployment?: SmartRecruitersValueLabel | null;
  experienceLevel?: SmartRecruitersValueLabel | null;
};

type SmartRecruitersDetailSection = {
  title?: string | null;
  text?: string | null;
};

type SmartRecruitersDetail = SmartRecruitersListing & {
  jobAd?: {
    sections?: Record<string, SmartRecruitersDetailSection> | null;
  } | null;
};

export function createSmartRecruitersConnector({
  companyIdentifier,
  companyName,
}: SmartRecruitersConnectorOptions): SourceConnector {
  const resolvedCompanyName =
    companyName ?? buildCompanyName(companyIdentifier);

  return {
    key: `smartrecruiters:${companyIdentifier}`,
    sourceName: `SmartRecruiters:${companyIdentifier}`,
    sourceTier: "TIER_2",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      options: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const snapshot = await fetchAllListings({
        companyIdentifier,
        limit: options.limit,
        signal: options.signal,
      });

      const jobs: SourceConnectorFetchResult["jobs"] = [];
      let error = snapshot.error;
      let failedDetailCount = 0;
      for (let index = 0; index < snapshot.listings.length; index += DETAIL_BATCH_SIZE) {
        throwIfAborted(options.signal);
        const batch = snapshot.listings.slice(index, index + DETAIL_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map((listing) => buildSourceJob({
          companyIdentifier,
          fallbackCompanyName: resolvedCompanyName,
          listing,
          signal: options.signal,
        })));
        throwIfAborted(options.signal);
        let stopDetails = false;
        for (const result of results) {
          if (result.status === "fulfilled") {
            jobs.push(result.value);
          } else {
            failedDetailCount += 1;
            error ??= errorMessage(result.reason);
            // Finish the in-flight batch, but do not keep hitting a blocked API.
            if (!(result.reason instanceof PostingHttpError) ||
                ![404, 410].includes(result.reason.status)) stopDetails = true;
          }
        }
        if (stopDetails) break;
      }

      return {
        jobs,
        exhausted: snapshot.exhausted && error === null,
        metadata: {
          companyIdentifier,
          companyName: resolvedCompanyName,
          fetchedAt: options.now.toISOString(),
          pageSize: SMARTRECRUITERS_PAGE_SIZE,
          listedCount: snapshot.listings.length,
          failedDetailCount,
          ...(error ? { error, partial: snapshot.listings.length > 0 } : {}),
        },
      };
    },
  };
}

async function fetchAllListings({
  companyIdentifier,
  limit,
  signal,
}: {
  companyIdentifier: string;
  limit?: number;
  signal?: AbortSignal;
}) {
  const listings: SmartRecruitersListing[] = [];
  const seenIds = new Set<string>();
  let offset = 0;
  let exhausted = false;
  let error: string | null = null;

  try {
    while (true) {
      throwIfAborted(signal);
      const response = await fetch(
        `https://api.smartrecruiters.com/v1/companies/${companyIdentifier}/postings?limit=${SMARTRECRUITERS_PAGE_SIZE}&offset=${offset}`,
        {
          signal,
          headers: { Accept: "application/json" },
        }
      );

      if (!response.ok) {
        throw new Error(
          `SmartRecruiters fetch failed for ${companyIdentifier}: ${response.status} ${response.statusText}`
        );
      }

      const payload = (await response.json()) as SmartRecruitersListingResponse;
      if (!Array.isArray(payload?.content) || !Number.isFinite(payload.totalFound)) {
        throw new Error("SmartRecruiters returned an invalid listing response");
      }
      if (payload.content.length === 0) {
        if (offset < payload.totalFound) throw new Error("SmartRecruiters snapshot ended before totalFound");
        exhausted = true;
        break;
      }

      const previousCount = listings.length;
      for (const listing of payload.content) {
        if (!listing || typeof listing.id !== "string" || typeof listing.name !== "string") {
          throw new Error("SmartRecruiters returned an invalid posting");
        }
        if (seenIds.has(listing.id)) continue;
        seenIds.add(listing.id);
        listings.push(listing);
      }
      if (previousCount === listings.length) throw new Error("SmartRecruiters pagination made no progress");
      offset += payload.content.length;

      if (typeof limit === "number" && listings.length >= limit) {
        return {
          listings: listings.slice(0, limit),
          exhausted: offset >= payload.totalFound && listings.length <= limit,
          error,
        };
      }

      if (offset >= payload.totalFound) {
        exhausted = true;
        break;
      }
    }
  } catch (cause) {
    throwIfAborted(signal);
    if (listings.length === 0) throw cause;
    error = errorMessage(cause);
  }

  return { listings, exhausted, error };
}

async function buildSourceJob({
  companyIdentifier,
  fallbackCompanyName,
  listing,
  signal,
}: {
  companyIdentifier: string;
  fallbackCompanyName: string;
  listing: SmartRecruitersListing;
  signal?: AbortSignal;
}) {
  const shouldFetchDetail = mayNeedDetailFetch(listing);
  const detail = shouldFetchDetail
    ? await fetchPostingDetail(companyIdentifier, listing.id, signal)
    : null;

  const sourceRecord = detail ?? listing;
  const location = buildLocation(sourceRecord.location);
  const description = detail
    ? buildDetailDescription(detail)
    : buildListingDescription(listing);

  return {
    sourceId: sourceRecord.id,
    sourceUrl: sourceRecord.postingUrl ?? sourceRecord.applyUrl ?? null,
    title: sourceRecord.name,
    company: sourceRecord.company?.name ?? fallbackCompanyName,
    location,
    description,
    applyUrl:
      sourceRecord.applyUrl ?? sourceRecord.postingUrl ?? "",
    postedAt: parseDateValue(sourceRecord.releasedDate),
    deadline: null,
    employmentType: inferEmploymentType(sourceRecord.typeOfEmployment?.label),
    workMode: inferWorkMode(sourceRecord.location),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      listing,
      detailFetched: Boolean(detail),
      detail,
    },
  };
}

async function fetchPostingDetail(
  companyIdentifier: string,
  postingId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `https://api.smartrecruiters.com/v1/companies/${companyIdentifier}/postings/${postingId}`,
    {
      signal,
      headers: {
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new PostingHttpError(
      `SmartRecruiters detail fetch failed for ${companyIdentifier}/${postingId}: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const detail = (await response.json()) as SmartRecruitersDetail;
  if (detail.id !== postingId || typeof detail.name !== "string") {
    throw new Error("SmartRecruiters detail identity does not match the requested posting");
  }
  return detail;
}

function mayNeedDetailFetch(listing: SmartRecruitersListing) {
  const country = readLowerText(listing.location?.country);
  const explicitlyForeignCountry = country &&
    !["us", "usa", "ca", "canada", "united states", "united states of america"].includes(country);
  return !isExcludedJobTitle(listing.name) && !explicitlyForeignCountry &&
    !isClearlyNonNorthAmericanLocation(buildLocation(listing.location));
}

function buildLocation(location: SmartRecruitersLocation | null | undefined) {
  if (!location) return "Unknown";
  const fullLocation = readText(location.fullLocation);
  if (fullLocation) return fullLocation;

  return [location.city, location.region, location.country]
    .map((value) => readText(value))
    .filter(Boolean)
    .join(", ");
}

function buildListingDescription(listing: SmartRecruitersListing) {
  return [
    listing.function?.label,
    listing.department?.label,
    listing.industry?.label,
    listing.experienceLevel?.label,
  ]
    .map((value) => readText(value))
    .filter(Boolean)
    .join(" · ");
}

function buildDetailDescription(detail: SmartRecruitersDetail) {
  const sections = Object.values(detail.jobAd?.sections ?? {})
    .map((section) => {
      const body = descriptionHtmlToText(section.text ?? "");
      if (!body) return "";
      const title = readText(section.title);
      return title ? `${title}\n${body}` : body;
    })
    .filter(Boolean);

  if (sections.length > 0) {
    return sections.join("\n\n");
  }

  return buildListingDescription(detail);
}

function parseDateValue(value: string | null | undefined) {
  if (!value) return null;

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) return null;
  return parsedValue;
}

function inferEmploymentType(value: string | null | undefined): EmploymentType | null {
  const normalizedValue = readLowerText(value);
  if (!normalizedValue) return null;
  if (normalizedValue.includes("intern")) return "INTERNSHIP";
  if (normalizedValue.includes("contract") || normalizedValue.includes("temporary")) {
    return "CONTRACT";
  }
  if (normalizedValue.includes("part")) return "PART_TIME";
  if (normalizedValue.includes("full") || normalizedValue.includes("permanent")) {
    return "FULL_TIME";
  }
  return null;
}

function inferWorkMode(location: SmartRecruitersLocation | null | undefined): WorkMode | null {
  if (!location) return null;
  if (location.remote) return "REMOTE";
  if (location.hybrid) return "HYBRID";
  return null;
}

function buildCompanyName(companyIdentifier: string) {
  return companyIdentifier
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readLowerText(value: unknown): string | null {
  const text = readText(value);
  return text ? text.toLowerCase() : null;
}

class PostingHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
