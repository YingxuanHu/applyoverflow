import type { Prisma } from "@/generated/prisma/client";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";
import {
  STRIP_TAGS_RE,
  decodeHtmlEntitiesFull,
} from "@/lib/ingestion/html-description";

const FETCH_TIMEOUT_MS = 20_000;
const AMAZON_PAGE_SIZE = 100;
const APPLE_PAGE_SIZE = 20;
const GOOGLE_PAGE_SIZE = 20;
const EIGHTFOLD_PAGE_SIZE = 100;
const AMAZON_GLOBAL_SHARD_MODE = "global-unfiltered-first-v2";
export const AMAZON_US_CATEGORY_SHARDS = [
  "Software Development",
  "Administrative Support",
  "Audio / Video / Photography Production",
  "Business & Merchant Development",
  "Business Intelligence",
  "Buying, Planning, & Instock Management",
  "Customer Service",
  "Database Administration",
  "Design",
  "Economics",
  "Editorial, Writing, & Content Management",
  "Facilities, Maintenance, & Real Estate",
  "Finance & Accounting",
  "Fulfillment & Operations Management",
  "Fulfillment / Warehouse Associate",
  "Hardware Development",
  "Human Resources",
  "Investigation & Loss Prevention",
  "Leadership Development & Training",
  "Legal",
  "Applied Science",
  "Marketing & PR",
  "Medical, Health, & Safety",
  "Operations, IT, & Support Engineering",
  "Project/Program/Product Management--Non-Tech",
  "Project/Program/Product Management--Technical",
  "Research Science",
  "Sales, Advertising, & Account Management",
  "Solutions Architect",
  "Supply Chain/Transportation Management",
  "Systems, Quality, & Security Engineering",
  "Public Policy",
  "Data Science",
  "PR",
] as const;
const EIGHTFOLD_LOCATIONS = {
  ca: ["Canada"],
  us: ["United States"],
  "north-america": ["Canada", "United States"],
  global: [""],
} as const;

export type OfficialCompanyKey =
  | "amazon"
  | "apple"
  | "google"
  | "microsoft"
  | "nvidia";
export type OfficialCompanyMarket = "ca" | "us" | "north-america" | "global";

type OfficialCompanyConnectorOptions = {
  company: OfficialCompanyKey;
  market?: OfficialCompanyMarket;
};

type AmazonSearchResponse = {
  hits?: number;
  jobs?: AmazonJob[];
};

type AmazonFetchShard = {
  country: "CAN" | "USA" | null;
  category: string | null;
};

type AmazonCheckpoint = {
  kind: "amazon-official";
  market: OfficialCompanyMarket;
  shardIndex: number;
  offset: number;
  shardMode?: typeof AMAZON_GLOBAL_SHARD_MODE;
};

type AmazonJob = {
  id?: string;
  id_icims?: string | number;
  title?: string;
  company_name?: string;
  location?: string;
  city?: string | null;
  country_code?: string | null;
  description?: string;
  description_short?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  job_path?: string;
  posted_date?: string;
  updated_time?: string;
  job_schedule_type?: string;
  job_category?: string;
  job_family?: string;
  normalized_job_title?: string;
  locations?: string[];
};

type AppleHydrationData = {
  loaderData?: Record<
    string,
    {
      searchResults?: AppleJob[];
      totalRecords?: number;
      search?: {
        searchResults?: AppleJob[];
        totalRecords?: number;
      };
    }
  >;
};

type AppleJob = {
  id?: string;
  positionId?: string;
  reqId?: string;
  jobPositionId?: string;
  postingTitle?: string;
  transformedPostingTitle?: string;
  jobSummary?: string;
  postingDate?: string;
  postDateInGMT?: string;
  standardWeeklyHours?: number;
  homeOffice?: boolean;
  team?: {
    teamName?: string;
    teamCode?: string;
  };
  locations?: Array<{
    name?: string;
    countryName?: string;
    countryID?: string;
    stateProvince?: string;
    city?: string;
  }>;
};

type AppleCheckpoint = {
  kind: "apple-official";
  market: OfficialCompanyMarket;
  marketIndex: number;
  page: number;
  itemIndex: number;
};

type GoogleCheckpoint = {
  kind: "google-official";
  page: number;
  itemIndex: number;
};

type EightfoldCompanyKey = Extract<OfficialCompanyKey, "microsoft" | "nvidia">;

type EightfoldConfig = {
  company: EightfoldCompanyKey;
  displayName: "Microsoft" | "NVIDIA";
  domain: "microsoft.com" | "nvidia.com";
  baseUrl: "https://apply.careers.microsoft.com" | "https://jobs.nvidia.com";
};

type EightfoldSearchResponse = {
  status?: number;
  data?: {
    count?: number;
    positions?: EightfoldSearchJob[];
  };
  error?: {
    message?: string;
    body?: string;
  };
};

type EightfoldDetailResponse = {
  status?: number;
  data?: EightfoldJobDetail;
  error?: {
    message?: string;
    body?: string;
  };
};

type EightfoldSearchJob = {
  id?: string | number;
  displayJobId?: string;
  name?: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  creationTs?: number;
  department?: string;
  workLocationOption?: string | null;
  atsJobId?: string;
  positionUrl?: string;
};

type EightfoldJobDetail = EightfoldSearchJob & {
  jobDescription?: string;
  applyUrl?: string;
  employmentType?: string;
};

type EightfoldCheckpoint = {
  kind: "eightfold-official";
  company: EightfoldCompanyKey;
  market: OfficialCompanyMarket;
  locationIndex: number;
  offset: number;
};

export function createOfficialCompanyConnector(
  options: OfficialCompanyConnectorOptions
): SourceConnector {
  const market = options.market ?? "north-america";

  return {
    key: `official-company:${options.company}:${market}`,
    sourceName: `OfficialCompany:${officialCompanyDisplayName(options.company)}`,
    sourceTier: "TIER_1",
    freshnessMode: "FULL_SNAPSHOT",
    fetchJobs(fetchOptions) {
      if (options.company === "amazon") {
        return fetchAmazonJobs({ market }, fetchOptions);
      }

      if (options.company === "google") {
        return fetchGoogleJobs(fetchOptions);
      }

      if (options.company === "microsoft" || options.company === "nvidia") {
        return fetchEightfoldJobs({ company: options.company, market }, fetchOptions);
      }

      return fetchAppleJobs({ market }, fetchOptions);
    },
  };
}

export function parseOfficialCompanySourceToken(token: string): {
  company: OfficialCompanyKey;
  market: OfficialCompanyMarket;
} {
  const [companyRaw, marketRaw] = token.split(":");
  const company = companyRaw?.trim().toLowerCase();
  const market = (marketRaw?.trim().toLowerCase() || "global") as OfficialCompanyMarket;

  if (
    company !== "amazon" &&
    company !== "apple" &&
    company !== "google" &&
    company !== "microsoft" &&
    company !== "nvidia"
  ) {
    throw new Error(
      `Unsupported official company source "${token}". Supported values: amazon, apple, google, microsoft, nvidia.`
    );
  }

  if (
    market !== "ca" &&
    market !== "us" &&
    market !== "north-america" &&
    market !== "global"
  ) {
    throw new Error(
      `Unsupported official company market "${market}". Use ca, us, north-america, or global.`
    );
  }

  return { company, market };
}

export async function fetchAmazonJobs(
  options: { market: OfficialCompanyMarket },
  fetchOptions: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  const shards = buildAmazonFetchShards(options.market);
  const checkpoint = parseAmazonCheckpoint(fetchOptions.checkpoint, options.market);
  const jobsById = new Map<string, SourceConnectorJob>();
  const totalHitsByShard: Record<string, number> = {};
  const cappedShards: string[] = [];
  let exhausted = true;

  for (
    let shardIndex = checkpoint?.shardIndex ?? 0;
    shardIndex < shards.length;
    shardIndex += 1
  ) {
    const shard = shards[shardIndex]!;
    let offset = shardIndex === checkpoint?.shardIndex ? checkpoint.offset : 0;
    while (true) {
      if (isDeadlineNear(fetchOptions)) {
        exhausted = false;
        const nextCheckpoint = buildAmazonCheckpoint(options.market, shardIndex, offset);
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: "amazon",
          market: options.market,
          totalHitsByShard,
          cappedShards,
          stoppedReason: "deadline_near",
        }, nextCheckpoint);
      }

      const pageLimit =
        fetchOptions.limit && fetchOptions.limit > jobsById.size
          ? Math.min(AMAZON_PAGE_SIZE, fetchOptions.limit - jobsById.size)
          : AMAZON_PAGE_SIZE;
      const url = buildAmazonSearchUrl({
        country: shard.country,
        category: shard.category,
        offset,
        limit: pageLimit,
      });
      const payload = await fetchJson<AmazonSearchResponse>(url, fetchOptions.signal);
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const totalHits = typeof payload.hits === "number" ? payload.hits : jobs.length;
      const shardKey = getAmazonShardKey(shard);
      totalHitsByShard[shardKey] = totalHits;
      if (totalHits >= 10_000 && !cappedShards.includes(shardKey)) {
        cappedShards.push(shardKey);
      }

      for (const job of jobs) {
        const mapped = mapAmazonJob(job);
        if (mapped) jobsById.set(mapped.sourceId, mapped);
      }

      offset += jobs.length;
      if (fetchOptions.limit && jobsById.size >= fetchOptions.limit) {
        exhausted = false;
        const nextCheckpoint = getNextAmazonCheckpoint({
          market: options.market,
          shards,
          shardIndex,
          offset,
          totalHits,
        });
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: "amazon",
          market: options.market,
          totalHitsByShard,
          cappedShards,
        }, nextCheckpoint);
      }

      if (jobs.length === 0 || offset >= totalHits) break;
    }
  }

  return buildResult(jobsById, exhausted && cappedShards.length === 0, {
    company: "amazon",
    market: options.market,
    totalHitsByShard,
    cappedShards,
    isPotentiallyCapped: cappedShards.length > 0,
  });
}

export async function fetchAppleJobs(
  options: { market: OfficialCompanyMarket },
  fetchOptions: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  const markets: Array<"ca" | "us" | "global"> =
    options.market === "global"
      ? ["global"]
      : options.market === "north-america"
        ? ["ca", "us"]
        : [options.market];
  const checkpoint = parseAppleCheckpoint(fetchOptions.checkpoint, options.market);
  const jobsById = new Map<string, SourceConnectorJob>();
  let exhausted = true;

  for (
    let marketIndex = checkpoint?.marketIndex ?? 0;
    marketIndex < markets.length;
    marketIndex += 1
  ) {
    const market = markets[marketIndex]!;
    let page = marketIndex === checkpoint?.marketIndex ? checkpoint.page : 1;
    let itemIndex = marketIndex === checkpoint?.marketIndex ? checkpoint.itemIndex : 0;
    let totalRecords = Number.POSITIVE_INFINITY;

    while ((page - 1) * APPLE_PAGE_SIZE < totalRecords) {
      if (isDeadlineNear(fetchOptions)) {
        exhausted = false;
        const nextCheckpoint = buildAppleCheckpoint(
          options.market,
          marketIndex,
          page,
          itemIndex
        );
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: "apple",
          market: options.market,
          stoppedReason: "deadline_near",
        }, nextCheckpoint);
      }

      const url = buildAppleSearchUrl({ market, page });
      const html = await fetchText(url, fetchOptions.signal);
      const jobs = extractAppleJobsFromHydration(html);
      totalRecords = extractAppleTotalRecords(html) ?? jobs.length;

      for (; itemIndex < jobs.length; itemIndex += 1) {
        const job = jobs[itemIndex]!;
        const mapped = mapAppleJob(job);
        if (mapped) jobsById.set(mapped.sourceId, mapped);
        if (fetchOptions.limit && jobsById.size >= fetchOptions.limit) {
          exhausted = false;
          const nextCheckpoint = getNextAppleCheckpoint({
            market: options.market,
            markets,
            marketIndex,
            page,
            itemIndex: itemIndex + 1,
            pageJobCount: jobs.length,
            totalRecords,
          });
          await fetchOptions.onCheckpoint?.(nextCheckpoint);
          return buildResult(jobsById, exhausted, {
            company: "apple",
            market: options.market,
            totalRecords,
          }, nextCheckpoint);
        }
      }

      if (jobs.length === 0) break;
      page += 1;
      itemIndex = 0;
    }
  }

  return buildResult(jobsById, exhausted, {
    company: "apple",
    market: options.market,
  });
}

export async function fetchGoogleJobs(
  fetchOptions: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  const checkpoint = parseGoogleCheckpoint(fetchOptions.checkpoint);
  const jobsById = new Map<string, SourceConnectorJob>();
  let page = checkpoint?.page ?? 1;
  let itemIndex = checkpoint?.itemIndex ?? 0;
  let totalRecords = Number.POSITIVE_INFINITY;
  let exhausted = true;

  while ((page - 1) * GOOGLE_PAGE_SIZE < totalRecords) {
    if (isDeadlineNear(fetchOptions)) {
      exhausted = false;
      const nextCheckpoint = buildGoogleCheckpoint(page, itemIndex);
      await fetchOptions.onCheckpoint?.(nextCheckpoint);
      return buildResult(jobsById, exhausted, {
        company: "google",
        totalRecords: Number.isFinite(totalRecords) ? totalRecords : null,
        stoppedReason: "deadline_near",
      }, nextCheckpoint);
    }

    const html = await fetchText(buildGoogleSearchUrl({ page }), fetchOptions.signal);
    const extractedJobs = extractGoogleJobsFromHtml(html);
    totalRecords = extractGoogleTotalRecords(html) ?? totalRecords;

    for (; itemIndex < extractedJobs.length; itemIndex += 1) {
      const mapped = mapGoogleJob(extractedJobs[itemIndex]!);
      if (mapped) jobsById.set(mapped.sourceId, mapped);
      if (fetchOptions.limit && jobsById.size >= fetchOptions.limit) {
        exhausted = false;
        const nextCheckpoint = getNextGoogleCheckpoint({
          page,
          itemIndex: itemIndex + 1,
          pageJobCount: extractedJobs.length,
          totalRecords,
        });
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: "google",
          totalRecords: Number.isFinite(totalRecords) ? totalRecords : null,
        }, nextCheckpoint);
      }
    }

    if (extractedJobs.length === 0) break;
    page += 1;
    itemIndex = 0;
  }

  return buildResult(jobsById, exhausted, {
    company: "google",
    totalRecords: Number.isFinite(totalRecords) ? totalRecords : jobsById.size,
  });
}

export async function fetchEightfoldJobs(
  options: { company: EightfoldCompanyKey; market: OfficialCompanyMarket },
  fetchOptions: SourceConnectorFetchOptions
): Promise<SourceConnectorFetchResult> {
  const config = getEightfoldConfig(options.company);
  const locations = EIGHTFOLD_LOCATIONS[options.market];
  const checkpoint = parseEightfoldCheckpoint(
    fetchOptions.checkpoint,
    options.company,
    options.market
  );
  const jobsById = new Map<string, SourceConnectorJob>();
  const totalHitsByLocation: Record<string, number> = {};
  let exhausted = true;

  for (
    let locationIndex = checkpoint?.locationIndex ?? 0;
    locationIndex < locations.length;
    locationIndex += 1
  ) {
    const location = locations[locationIndex]!;
    let offset = locationIndex === checkpoint?.locationIndex ? checkpoint.offset : 0;

    while (true) {
      if (isDeadlineNear(fetchOptions)) {
        exhausted = false;
        const nextCheckpoint = buildEightfoldCheckpoint(
          options.company,
          options.market,
          locationIndex,
          offset
        );
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: config.company,
          market: options.market,
          totalHitsByLocation,
          stoppedReason: "deadline_near",
        }, nextCheckpoint);
      }

      const pageLimit =
        fetchOptions.limit && fetchOptions.limit > jobsById.size
          ? Math.min(
              getEightfoldPageSize(options.company),
              fetchOptions.limit - jobsById.size
            )
          : getEightfoldPageSize(options.company);
      const searchUrl = buildEightfoldSearchUrl({
        config,
        location,
        offset,
        limit: pageLimit,
      });
      let payload: EightfoldSearchResponse;
      try {
        payload = await fetchJson<EightfoldSearchResponse>(
          searchUrl,
          fetchOptions.signal
        );
        assertEightfoldOk(payload, searchUrl);
      } catch (error) {
        if (jobsById.size === 0) {
          throw error;
        }

        exhausted = false;
        const nextCheckpoint = buildEightfoldCheckpoint(
          options.company,
          options.market,
          locationIndex,
          offset
        );
        await fetchOptions.onCheckpoint?.(nextCheckpoint);
        return buildResult(jobsById, exhausted, {
          company: config.company,
          market: options.market,
          totalHitsByLocation,
          stoppedReason: "search_page_error",
          error: error instanceof Error ? error.message : String(error),
        }, nextCheckpoint);
      }
      const positions = Array.isArray(payload.data?.positions)
        ? payload.data.positions
        : [];
      const totalHits =
        typeof payload.data?.count === "number" ? payload.data.count : positions.length;
      totalHitsByLocation[location] = totalHits;

      for (const position of positions) {
        if (isDeadlineNear(fetchOptions)) {
          exhausted = false;
          const nextCheckpoint = buildEightfoldCheckpoint(
            options.company,
            options.market,
            locationIndex,
            offset
          );
          await fetchOptions.onCheckpoint?.(nextCheckpoint);
          return buildResult(jobsById, exhausted, {
            company: config.company,
            market: options.market,
            totalHitsByLocation,
            stoppedReason: "deadline_near",
          }, nextCheckpoint);
        }

        const detail = shouldFetchEightfoldDetails()
          ? await fetchEightfoldJobDetail(config, position, fetchOptions)
          : null;
        const mapped = mapEightfoldJob(config, position, detail);
        if (mapped) jobsById.set(mapped.sourceId, mapped);

        if (fetchOptions.limit && jobsById.size >= fetchOptions.limit) {
          exhausted = false;
          const nextCheckpoint = getNextEightfoldCheckpoint({
            company: options.company,
            market: options.market,
            locations,
            locationIndex,
            offset: offset + positions.length,
            totalHits,
          });
          await fetchOptions.onCheckpoint?.(nextCheckpoint);
          return buildResult(jobsById, exhausted, {
            company: config.company,
            market: options.market,
            totalHitsByLocation,
          }, nextCheckpoint);
        }
      }

      offset += positions.length;
      if (positions.length === 0 || offset >= totalHits) break;
    }
  }

  return buildResult(jobsById, exhausted, {
    company: config.company,
    market: options.market,
    totalHitsByLocation,
  });
}

export function buildAmazonSearchUrl(input: {
  country?: "CAN" | "USA" | null;
  category?: string | null;
  offset: number;
  limit: number;
}) {
  const url = new URL("https://www.amazon.jobs/en/search.json");
  url.searchParams.set("offset", String(input.offset));
  url.searchParams.set("result_limit", String(input.limit));
  if (input.country) {
    url.searchParams.set("country", input.country);
  }
  if (input.category) {
    url.searchParams.set("category[]", input.category);
  }
  return url.toString();
}

export function buildAppleSearchUrl(input: { market: "ca" | "us" | "global"; page: number }) {
  const url = new URL("https://jobs.apple.com/en-us/search");
  url.searchParams.set("sort", "relevance");
  if (input.market !== "global") {
    url.searchParams.set("location", input.market === "ca" ? "canada-CANC" : "united-states-USA");
  }
  if (input.page > 1) {
    url.searchParams.set("page", String(input.page));
  }
  return url.toString();
}

export function buildGoogleSearchUrl(input: { page: number }) {
  const url = new URL("https://www.google.com/about/careers/applications/jobs/results/");
  if (input.page > 1) {
    url.searchParams.set("page", String(input.page));
  }
  return url.toString();
}

export function buildEightfoldSearchUrl(input: {
  config: EightfoldConfig;
  location: string;
  offset: number;
  limit: number;
}) {
  const url = new URL(`${input.config.baseUrl}/api/pcsx/search`);
  url.searchParams.set("domain", input.config.domain);
  url.searchParams.set("num", String(input.limit));
  url.searchParams.set("start", String(input.offset));
  if (input.location) {
    url.searchParams.set("location", input.location);
  }
  return url.toString();
}

export function buildEightfoldDetailUrl(input: {
  config: EightfoldConfig;
  positionId: string;
}) {
  const url = new URL(`${input.config.baseUrl}/api/pcsx/position_details`);
  url.searchParams.set("domain", input.config.domain);
  url.searchParams.set("position_id", input.positionId);
  return url.toString();
}

export function extractAppleJobsFromHydration(html: string): AppleJob[] {
  const hydration = extractAppleHydrationData(html);
  if (!hydration?.loaderData) return [];

  for (const value of Object.values(hydration.loaderData)) {
    const jobs = value.searchResults ?? value.search?.searchResults;
    if (Array.isArray(jobs)) return jobs;
  }

  return [];
}

export function extractAppleTotalRecords(html: string) {
  const hydration = extractAppleHydrationData(html);
  if (!hydration?.loaderData) return null;

  for (const value of Object.values(hydration.loaderData)) {
    const totalRecords = value.totalRecords ?? value.search?.totalRecords;
    if (typeof totalRecords === "number") return totalRecords;
  }

  return null;
}

function extractAppleHydrationData(html: string): AppleHydrationData | null {
  const match = html.match(
    /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("([\s\S]*?)"\);<\/script>/
  );
  if (!match?.[1]) return null;

  try {
    const decoded = JSON.parse(`"${match[1]}"`) as string;
    return JSON.parse(decoded) as AppleHydrationData;
  } catch {
    return null;
  }
}

function mapAmazonJob(job: AmazonJob): SourceConnectorJob | null {
  const postingId = stringOrNull(job.id_icims) ?? stringOrNull(job.id);
  const title = cleanText(job.title ?? job.normalized_job_title ?? "");
  if (!postingId || !title) return null;

  const sourceUrl = absoluteAmazonUrl(job.job_path ?? `/en/jobs/${postingId}`);
  const description = [
    job.description,
    sectionText("Basic Qualifications", job.basic_qualifications),
    sectionText("Preferred Qualifications", job.preferred_qualifications),
  ]
    .filter(Boolean)
    .map((value) => cleanText(value ?? ""))
    .filter(Boolean)
    .join("\n\n");
  const parsedLocations = parseAmazonLocations(job.locations);
  const location = cleanText(parsedLocations[0] ?? job.location ?? job.city ?? "Unknown");
  const applyUrl = `https://www.amazon.jobs/applicant/jobs/${postingId}/apply`;

  return {
    sourceId: `amazon:${postingId}`,
    sourceUrl,
    title,
    company: cleanText(job.company_name ?? "Amazon"),
    location,
    description: description || cleanText(job.description_short ?? title),
    applyUrl,
    postedAt: parseDate(job.posted_date ?? job.updated_time),
    deadline: null,
    employmentType: mapEmploymentType(job.job_schedule_type),
    workMode: inferWorkMode([location, description].join(" ")),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      officialCompany: "amazon",
      postingId,
      jobCategory: job.job_category ?? null,
      jobFamily: job.job_family ?? null,
      sourceUrl,
      applyUrl,
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

function mapAppleJob(job: AppleJob): SourceConnectorJob | null {
  const postingId = stringOrNull(job.positionId) ?? stringOrNull(job.id);
  const title = cleanText(job.postingTitle ?? "");
  if (!postingId || !title) return null;

  const slug = job.transformedPostingTitle || slugify(title);
  const sourceUrl = `https://jobs.apple.com/en-us/details/${postingId}/${slug}`;
  const location = cleanText(
    (job.locations ?? [])
      .map((entry) => {
        const pieces = [
          entry.name,
          entry.stateProvince,
          entry.countryName,
        ].filter(Boolean);
        const uniquePieces = pieces.filter(
          (piece, index) =>
            pieces.findIndex(
              (candidate) => candidate?.toLowerCase() === piece?.toLowerCase()
            ) === index
        );
        return uniquePieces.join(", ");
      })
      .filter(Boolean)
      .join("; ") || "Unknown"
  );

  return {
    sourceId: `apple:${postingId}`,
    sourceUrl,
    title,
    company: "Apple",
    location,
    description: cleanText(job.jobSummary ?? title),
    applyUrl: sourceUrl,
    postedAt: parseDate(job.postDateInGMT ?? job.postingDate),
    deadline: null,
    employmentType: job.standardWeeklyHours ? "FULL_TIME" : null,
    workMode: job.homeOffice ? "REMOTE" : inferWorkMode([location, job.jobSummary ?? ""].join(" ")),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      officialCompany: "apple",
      postingId,
      reqId: job.reqId ?? null,
      jobPositionId: job.jobPositionId ?? null,
      teamName: job.team?.teamName ?? null,
      teamCode: job.team?.teamCode ?? null,
      sourceUrl,
      applyUrl: sourceUrl,
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

type GoogleRawJob = unknown[];

function mapGoogleJob(job: GoogleRawJob): SourceConnectorJob | null {
  const postingId = stringOrNull(job[0] as string | number | null | undefined);
  const title = cleanText(typeof job[1] === "string" ? job[1] : "");
  const applyUrl = typeof job[2] === "string" ? decodeHtmlEntitiesFull(job[2]) : "";
  if (!postingId || !title || !applyUrl) return null;

  const locations = extractGoogleLocations(job);
  const description = extractGoogleDescription(job) || title;
  const postedAt = extractGooglePostedAt(job);
  const sourceUrl = `https://www.google.com/about/careers/applications/jobs/results/${postingId}-${slugify(title)}`;

  return {
    sourceId: `google:${postingId}`,
    sourceUrl,
    title,
    company: "Google",
    location: cleanText(locations.join("; ") || "Unknown"),
    description,
    applyUrl,
    postedAt,
    deadline: null,
    employmentType: null,
    workMode: inferWorkMode([locations.join(" "), description].join(" ")),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      officialCompany: "google",
      postingId,
      sourceUrl,
      applyUrl,
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

export function extractGoogleJobsFromHtml(html: string): GoogleRawJob[] {
  const jobs: GoogleRawJob[] = [];
  const seenIds = new Set<string>();
  const startRe = /\["\d{10,}","/g;
  let match: RegExpExecArray | null;

  while ((match = startRe.exec(html)) !== null) {
    const arrayText = readBalancedJsonArray(html, match.index);
    if (!arrayText) continue;

    try {
      const parsed = JSON.parse(arrayText) as unknown;
      if (!Array.isArray(parsed)) continue;
      const id = stringOrNull(parsed[0] as string | number | null | undefined);
      const title = typeof parsed[1] === "string" ? parsed[1].trim() : "";
      const applyUrl = typeof parsed[2] === "string" ? parsed[2] : "";
      if (!id || !title || !applyUrl.includes("/about/careers/applications/")) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      jobs.push(parsed);
    } catch {
      // Keep scanning. The page embeds several unrelated arrays with similar
      // shapes, and a malformed candidate should not fail the whole source.
    }
  }

  return jobs;
}

export function extractGoogleTotalRecords(html: string) {
  const matches = [...html.matchAll(/,null,(\d{2,6}),20\]/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function readBalancedJsonArray(source: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractGoogleLocations(job: GoogleRawJob) {
  const rawLocations = Array.isArray(job[9]) ? job[9] : [];
  return rawLocations
    .map((entry) => {
      if (!Array.isArray(entry)) return null;
      return typeof entry[0] === "string" ? entry[0] : null;
    })
    .filter((value): value is string => Boolean(value));
}

function extractGoogleDescription(job: GoogleRawJob) {
  const fragments = job
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry[1])
    .filter((value): value is string => typeof value === "string" && value.length > 40)
    .map(cleanText)
    .filter(Boolean);

  return [...new Set(fragments)].join("\n\n");
}

function extractGooglePostedAt(job: GoogleRawJob) {
  for (const entry of job) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "number" &&
      entry[0] > 1_500_000_000 &&
      entry[0] < 2_200_000_000
    ) {
      return parseEpochSeconds(entry[0]);
    }
  }

  return null;
}

async function fetchEightfoldJobDetail(
  config: EightfoldConfig,
  position: EightfoldSearchJob,
  fetchOptions: SourceConnectorFetchOptions
) {
  const positionId = stringOrNull(position.id);
  if (!positionId) return null;

  const detailUrl = buildEightfoldDetailUrl({ config, positionId });
  try {
    const payload = await fetchJson<EightfoldDetailResponse>(detailUrl, fetchOptions.signal);
    assertEightfoldOk(payload, detailUrl);
    return payload.data ?? null;
  } catch {
    return null;
  }
}

function mapEightfoldJob(
  config: EightfoldConfig,
  position: EightfoldSearchJob,
  detail: EightfoldJobDetail | null
): SourceConnectorJob | null {
  const postingId =
    stringOrNull(detail?.displayJobId) ??
    stringOrNull(position.displayJobId) ??
    stringOrNull(detail?.atsJobId) ??
    stringOrNull(position.atsJobId) ??
    stringOrNull(detail?.id) ??
    stringOrNull(position.id);
  const positionId = stringOrNull(detail?.id) ?? stringOrNull(position.id);
  const title = cleanText(detail?.name ?? position.name ?? "");
  if (!postingId || !positionId || !title) return null;

  const sourceUrl = `${config.baseUrl}/careers/job/${positionId}`;
  const locations =
    detail?.locations && detail.locations.length > 0
      ? detail.locations
      : position.locations ?? [];
  const standardizedLocations =
    detail?.standardizedLocations && detail.standardizedLocations.length > 0
      ? detail.standardizedLocations
      : position.standardizedLocations ?? [];
  const location = cleanText(
    [...locations, ...standardizedLocations].filter(Boolean).join("; ") || "Unknown"
  );
  const workLocationOption =
    detail?.workLocationOption ?? position.workLocationOption ?? null;
  const description = cleanText(
    detail?.jobDescription ??
      buildEightfoldFallbackDescription({
        title,
        department: detail?.department ?? position.department ?? null,
        location,
        workLocationOption,
      })
  );

  return {
    sourceId: `${config.company}:${postingId}`,
    sourceUrl,
    title,
    company: config.displayName,
    location,
    description,
    applyUrl: sourceUrl,
    postedAt: parseEpochSeconds(detail?.postedTs ?? position.postedTs),
    deadline: null,
    employmentType: mapEmploymentType(detail?.employmentType ?? null),
    workMode: mapEightfoldWorkMode(workLocationOption, [location, description].join(" ")),
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {
      officialCompany: config.company,
      postingId,
      positionId,
      displayJobId: detail?.displayJobId ?? position.displayJobId ?? null,
      atsJobId: detail?.atsJobId ?? position.atsJobId ?? null,
      department: detail?.department ?? position.department ?? null,
      workLocationOption,
      sourceUrl,
      applyUrl: sourceUrl,
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

function getEightfoldConfig(company: EightfoldCompanyKey): EightfoldConfig {
  if (company === "microsoft") {
    return {
      company,
      displayName: "Microsoft",
      domain: "microsoft.com",
      baseUrl: "https://apply.careers.microsoft.com",
    };
  }

  return {
    company,
    displayName: "NVIDIA",
    domain: "nvidia.com",
    baseUrl: "https://jobs.nvidia.com",
  };
}

function getEightfoldPageSize(company: EightfoldCompanyKey) {
  // NVIDIA's Eightfold endpoint intermittently returns 403s for larger page
  // sizes from the VPS, while small pages are accepted consistently.
  return company === "nvidia" ? 20 : EIGHTFOLD_PAGE_SIZE;
}

function shouldFetchEightfoldDetails() {
  const value = process.env.OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS;
  if (!value) return true;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function buildEightfoldFallbackDescription(input: {
  title: string;
  department: string | null;
  location: string;
  workLocationOption: string | null;
}) {
  const parts = [
    input.department ? `Department: ${input.department}.` : null,
    input.location && input.location !== "Unknown"
      ? `Locations: ${input.location}.`
      : null,
    input.workLocationOption
      ? `Work mode: ${input.workLocationOption.replace(/_/g, " ")}.`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : input.title;
}

function assertEightfoldOk(
  payload: EightfoldSearchResponse | EightfoldDetailResponse,
  url: string
) {
  if (payload.status === 200) return;
  const message = payload.error?.message || payload.error?.body || "Unknown Eightfold error";
  throw new Error(`Official Eightfold fetch failed: ${message} (${url})`);
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(url, {
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; applyoverflow-official-company/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`Official company fetch failed ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchWithTimeout(url, {
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; applyoverflow-official-company/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`Official company fetch failed ${response.status}: ${url}`);
  }
  return response.text();
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

function buildResult(
  jobsById: Map<string, SourceConnectorJob>,
  exhausted: boolean,
  metadata: Record<string, Prisma.InputJsonValue | null>,
  checkpoint: Prisma.InputJsonValue | null = null
): SourceConnectorFetchResult {
  return {
    jobs: [...jobsById.values()],
    exhausted,
    checkpoint,
    metadata: {
      ...metadata,
      totalFetched: jobsById.size,
      sourceTrust: "first_party_company",
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

function buildAmazonFetchShards(market: OfficialCompanyMarket): AmazonFetchShard[] {
  const shards: AmazonFetchShard[] = [];
  if (market === "global") {
    // Pull Amazon's global official feed first. Category shards are still useful
    // for coverage beyond Amazon's capped unfiltered listing, but starting with
    // them wastes many fetches on duplicates and delays the high-signal 10k set.
    shards.push({ country: null, category: null });
    for (const category of AMAZON_US_CATEGORY_SHARDS) {
      shards.push({ country: null, category });
    }
    return shards;
  }

  if (market === "ca" || market === "north-america") {
    shards.push({ country: "CAN", category: null });
  }

  if (market === "us" || market === "north-america") {
    for (const category of AMAZON_US_CATEGORY_SHARDS) {
      shards.push({ country: "USA", category });
    }
  }

  return shards;
}

function getAmazonShardKey(shard: AmazonFetchShard) {
  const country = shard.country ?? "global";
  return shard.category ? `${country}:${shard.category}` : country;
}

function buildAmazonCheckpoint(
  market: OfficialCompanyMarket,
  shardIndex: number,
  offset: number
): AmazonCheckpoint {
  return {
    kind: "amazon-official",
    market,
    shardIndex,
    offset,
    ...(market === "global" ? { shardMode: AMAZON_GLOBAL_SHARD_MODE } : {}),
  };
}

function getNextAmazonCheckpoint(input: {
  market: OfficialCompanyMarket;
  shards: AmazonFetchShard[];
  shardIndex: number;
  offset: number;
  totalHits: number;
}) {
  if (input.offset < input.totalHits) {
    return buildAmazonCheckpoint(input.market, input.shardIndex, input.offset);
  }

  const nextShardIndex = input.shardIndex + 1;
  if (nextShardIndex >= input.shards.length) return null;
  return buildAmazonCheckpoint(input.market, nextShardIndex, 0);
}

function parseAmazonCheckpoint(
  value: Prisma.InputJsonValue | null | undefined,
  market: OfficialCompanyMarket
): AmazonCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.InputJsonValue | null>;
  if (record.kind !== "amazon-official" || record.market !== market) return null;
  if (market === "global" && record.shardMode !== AMAZON_GLOBAL_SHARD_MODE) {
    return null;
  }
  const shardIndex = typeof record.shardIndex === "number" ? record.shardIndex : 0;
  const offset = typeof record.offset === "number" ? record.offset : 0;
  if (shardIndex < 0 || offset < 0) return null;
  return {
    kind: "amazon-official",
    market,
    shardIndex,
    offset,
  };
}

function buildAppleCheckpoint(
  market: OfficialCompanyMarket,
  marketIndex: number,
  page: number,
  itemIndex: number
): AppleCheckpoint {
  return {
    kind: "apple-official",
    market,
    marketIndex,
    page,
    itemIndex,
  };
}

function getNextAppleCheckpoint(input: {
  market: OfficialCompanyMarket;
  markets: Array<"ca" | "us" | "global">;
  marketIndex: number;
  page: number;
  itemIndex: number;
  pageJobCount: number;
  totalRecords: number;
}) {
  if (input.itemIndex < input.pageJobCount) {
    return buildAppleCheckpoint(
      input.market,
      input.marketIndex,
      input.page,
      input.itemIndex
    );
  }

  const nextPage = input.page + 1;
  if ((nextPage - 1) * APPLE_PAGE_SIZE < input.totalRecords) {
    return buildAppleCheckpoint(input.market, input.marketIndex, nextPage, 0);
  }

  const nextMarketIndex = input.marketIndex + 1;
  if (nextMarketIndex >= input.markets.length) return null;
  return buildAppleCheckpoint(input.market, nextMarketIndex, 1, 0);
}

function parseAppleCheckpoint(
  value: Prisma.InputJsonValue | null | undefined,
  market: OfficialCompanyMarket
): AppleCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.InputJsonValue | null>;
  if (record.kind !== "apple-official" || record.market !== market) return null;
  const marketIndex = typeof record.marketIndex === "number" ? record.marketIndex : 0;
  const page = typeof record.page === "number" ? record.page : 1;
  const itemIndex = typeof record.itemIndex === "number" ? record.itemIndex : 0;
  if (marketIndex < 0 || page < 1 || itemIndex < 0) return null;
  return {
    kind: "apple-official",
    market,
    marketIndex,
    page,
    itemIndex,
  };
}

function buildGoogleCheckpoint(page: number, itemIndex: number): GoogleCheckpoint {
  return {
    kind: "google-official",
    page,
    itemIndex,
  };
}

function getNextGoogleCheckpoint(input: {
  page: number;
  itemIndex: number;
  pageJobCount: number;
  totalRecords: number;
}) {
  if (input.itemIndex < input.pageJobCount) {
    return buildGoogleCheckpoint(input.page, input.itemIndex);
  }

  const nextPage = input.page + 1;
  if ((nextPage - 1) * GOOGLE_PAGE_SIZE < input.totalRecords) {
    return buildGoogleCheckpoint(nextPage, 0);
  }

  return null;
}

function parseGoogleCheckpoint(
  value: Prisma.InputJsonValue | null | undefined
): GoogleCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.InputJsonValue | null>;
  if (record.kind !== "google-official") return null;
  const page = typeof record.page === "number" ? record.page : 1;
  const itemIndex = typeof record.itemIndex === "number" ? record.itemIndex : 0;
  if (page < 1 || itemIndex < 0) return null;
  return {
    kind: "google-official",
    page,
    itemIndex,
  };
}

function buildEightfoldCheckpoint(
  company: EightfoldCompanyKey,
  market: OfficialCompanyMarket,
  locationIndex: number,
  offset: number
): EightfoldCheckpoint {
  return {
    kind: "eightfold-official",
    company,
    market,
    locationIndex,
    offset,
  };
}

function getNextEightfoldCheckpoint(input: {
  company: EightfoldCompanyKey;
  market: OfficialCompanyMarket;
  locations: readonly string[];
  locationIndex: number;
  offset: number;
  totalHits: number;
}) {
  if (input.offset < input.totalHits) {
    return buildEightfoldCheckpoint(
      input.company,
      input.market,
      input.locationIndex,
      input.offset
    );
  }

  const nextLocationIndex = input.locationIndex + 1;
  if (nextLocationIndex >= input.locations.length) return null;
  return buildEightfoldCheckpoint(input.company, input.market, nextLocationIndex, 0);
}

function parseEightfoldCheckpoint(
  value: Prisma.InputJsonValue | null | undefined,
  company: EightfoldCompanyKey,
  market: OfficialCompanyMarket
): EightfoldCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.InputJsonValue | null>;
  if (
    record.kind !== "eightfold-official" ||
    record.company !== company ||
    record.market !== market
  ) {
    return null;
  }

  const locationIndex =
    typeof record.locationIndex === "number" ? record.locationIndex : 0;
  const offset = typeof record.offset === "number" ? record.offset : 0;
  if (locationIndex < 0 || offset < 0) return null;
  return {
    kind: "eightfold-official",
    company,
    market,
    locationIndex,
    offset,
  };
}

function absoluteAmazonUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `https://www.amazon.jobs${path.startsWith("/") ? path : `/${path}`}`;
}

function parseAmazonLocations(locations: string[] | undefined) {
  if (!Array.isArray(locations)) return [];
  return locations
    .map((value) => {
      try {
        const parsed = JSON.parse(value) as { normalizedLocation?: string; location?: string };
        return parsed.normalizedLocation ?? parsed.location ?? null;
      } catch {
        return value;
      }
    })
    .filter((value): value is string => Boolean(value));
}

function cleanText(value: string) {
  return decodeHtmlEntitiesFull(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(STRIP_TAGS_RE, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sectionText(title: string, content: string | undefined) {
  const cleaned = cleanText(content ?? "");
  return cleaned ? `${title}\n${cleaned}` : "";
}

function parseDate(value: string | undefined | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEpochSeconds(value: number | undefined | null) {
  if (!value) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringOrNull(value: string | number | undefined | null) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function mapEmploymentType(value: string | undefined | null) {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("full")) return "FULL_TIME";
  if (normalized.includes("part")) return "PART_TIME";
  if (normalized.includes("contract")) return "CONTRACT";
  if (normalized.includes("intern")) return "INTERNSHIP";
  return null;
}

function inferWorkMode(value: string) {
  const normalized = value.toLowerCase();
  if (/\bremote\b|home office/.test(normalized)) return "REMOTE";
  if (/\bhybrid\b/.test(normalized)) return "HYBRID";
  if (/\bonsite\b|\bon-site\b/.test(normalized)) return "ONSITE";
  return null;
}

function mapEightfoldWorkMode(value: string | null, fallback: string) {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("remote")) return "REMOTE";
  if (normalized.includes("hybrid")) return "HYBRID";
  if (normalized.includes("onsite") || normalized.includes("on_site")) return "ONSITE";
  return inferWorkMode(fallback);
}

function isDeadlineNear(fetchOptions: SourceConnectorFetchOptions) {
  const deadlineAt = fetchOptions.deadlineAt;
  if (!deadlineAt) return false;
  return Date.now() + 5_000 >= deadlineAt.getTime();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function officialCompanyDisplayName(company: OfficialCompanyKey) {
  if (company === "nvidia") return "NVIDIA";
  return company.charAt(0).toUpperCase() + company.slice(1);
}
