/**
 * Jooble public job search API connector.
 *
 * Official docs:
 *   POST https://jooble.org/api/{apiKey}
 *
 * The API is query-driven rather than a full market dump, so this connector
 * fans out across configurable keyword/location searches and checkpoints across
 * that frontier over multiple runs.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EmploymentType, WorkMode } from "@/generated/prisma/client";
import {
  readCsvEnv,
  readPositiveIntEnv,
} from "@/lib/ingestion/source-family-config";
import {
  sleepWithAbort,
  throwIfAborted,
} from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const JOOBLE_API_BASE = "https://jooble.org/api";
const JOOBLE_DEFAULT_RATE_DELAY_MS = 750;
const JOOBLE_DEFAULT_RESULTS_PER_PAGE = 75;
const JOOBLE_DEFAULT_MAX_PAGES = 4;
const JOOBLE_DEFAULT_SEARCHES_PER_RUN = 6;
const JOOBLE_PLACEHOLDER_COMPANIES = new Set(["jooble", "jooble.org"]);

const DEFAULT_JOOBLE_KEYWORDS = [
  "software engineer",
  "data engineer",
  "data scientist",
  "product manager",
  "business analyst",
  "financial analyst",
  "accountant",
  "cybersecurity",
  "devops",
  "operations manager",
];

const DEFAULT_JOOBLE_LOCATIONS = [
  "Remote",
  "United States",
  "Canada",
];

const JOOBLE_TECH_KEYWORDS = [
  "software engineer",
  "software developer",
  "frontend engineer",
  "backend engineer",
  "full stack engineer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "ai engineer",
  "devops engineer",
  "cloud engineer",
  "security engineer",
  "cybersecurity analyst",
  "product manager",
  "technical program manager",
  "business analyst",
  "qa engineer",
];

const JOOBLE_FINANCE_KEYWORDS = [
  "financial analyst",
  "finance manager",
  "investment analyst",
  "quantitative analyst",
  "risk analyst",
  "accountant",
  "controller",
  "auditor",
  "tax analyst",
  "treasury analyst",
  "fp&a analyst",
  "business analyst finance",
];

const JOOBLE_OPERATIONS_KEYWORDS = [
  "operations manager",
  "project manager",
  "program manager",
  "customer success manager",
  "implementation consultant",
  "solutions consultant",
  "sales engineer",
  "revenue operations",
  "marketing analyst",
];

// Broader white-collar keywords beyond tech/finance. These pull in office /
// knowledge-worker roles from Jooble's general search index. Targeted enough
// to avoid blue-collar/clinical/retail dilution — the exclusion patterns in
// normalize.ts catch anything that slips through.
const JOOBLE_WHITECOLLAR_KEYWORDS = [
  // Marketing & content
  "marketing manager",
  "brand manager",
  "product marketing",
  "growth marketing",
  "content strategist",
  "digital marketing",
  // Sales & revenue
  "account executive",
  "sales development",
  "sales operations",
  "partnerships manager",
  // HR & people
  "hr business partner",
  "talent acquisition",
  "people operations",
  "compensation analyst",
  // Legal & corporate
  "corporate counsel",
  "paralegal",
  "compliance analyst",
  // Communications & PR
  "communications manager",
  "investor relations",
  "public relations",
  // Operations & admin
  "chief of staff",
  "executive assistant",
  "office manager",
  // Supply chain & procurement
  "supply chain analyst",
  "procurement manager",
  "logistics analyst",
  // Consulting & strategy
  "strategy consultant",
  "management consultant",
  "business strategy",
  // Customer success
  "customer success",
  "implementation specialist",
];

const JOOBLE_US_TECH_HUBS = [
  "New York, NY",
  "San Francisco, CA",
  "San Jose, CA",
  "Seattle, WA",
  "Austin, TX",
  "Boston, MA",
  "Chicago, IL",
  "Los Angeles, CA",
  "Denver, CO",
  "Atlanta, GA",
  "Dallas, TX",
  "Washington, DC",
  "Raleigh, NC",
  "Pittsburgh, PA",
  "Minneapolis, MN",
  "Philadelphia, PA",
];

const JOOBLE_CANADA_TECH_HUBS = [
  "Toronto, ON",
  "Vancouver, BC",
  "Montreal, QC",
  "Ottawa, ON",
  "Waterloo, ON",
  "Calgary, AB",
  "Edmonton, AB",
];

type JoobleJob = {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
};

type JoobleResponse = {
  totalCount?: number;
  jobs?: JoobleJob[];
};

type JoobleCheckpoint = {
  searchIndex: number;
  page: number;
};

type JoobleSearchSpec = {
  keyword: string;
  location: string | null;
};

type JoobleConnectorOptions = {
  profile?: string;
  keywords?: string[];
  locations?: Array<string | null>;
};

type JoobleProfileDefaults = {
  keywords: string[];
  locations: Array<string | null>;
};

const JOOBLE_PROFILE_DEFAULTS: Record<string, JoobleProfileDefaults> = {
  feed: {
    keywords: DEFAULT_JOOBLE_KEYWORDS,
    locations: DEFAULT_JOOBLE_LOCATIONS,
  },
  "all-na": {
    keywords: [""],
    locations: ["United States", "Canada", "Remote"],
  },
  "tech-na": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "finance-na": {
    keywords: JOOBLE_FINANCE_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "operations-na": {
    keywords: JOOBLE_OPERATIONS_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "tech-cities-us": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "tech-cities-ca": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },
  "finance-cities-us": {
    keywords: JOOBLE_FINANCE_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "early-career-na": {
    keywords: [
      "new grad software engineer",
      "entry level software engineer",
      "junior software developer",
      "junior data analyst",
      "data analyst",
      "business analyst",
      "financial analyst",
      "junior accountant",
      "software engineer intern",
      "data science intern",
    ],
    locations: ["United States", "Canada", "Remote"],
  },
  "remote-broad-na": {
    keywords: [
      ...JOOBLE_TECH_KEYWORDS,
      ...JOOBLE_FINANCE_KEYWORDS,
      ...JOOBLE_OPERATIONS_KEYWORDS,
    ],
    locations: ["Remote", "Remote United States", "Remote Canada", "Remote North America"],
  },
  // Broader white-collar profile: marketing, HR, legal, comms, sales, supply
  // chain, consulting, admin. Pulls in office/knowledge-worker roles outside
  // pure tech & finance to expand pool coverage.
  "whitecollar-na": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "whitecollar-cities-us": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "whitecollar-cities-ca": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },
};

export function createJoobleConnector(
  options: JoobleConnectorOptions = {}
): SourceConnector {
  const apiKey = process.env.JOOBLE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      "Jooble connector requires JOOBLE_API_KEY."
    );
  }

  const profile = normalizeProfileName(options.profile ?? "feed");
  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();

  return {
    key: `jooble:${profile}`,
    sourceName: "Jooble",
    sourceTier: "TIER_3",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = JSON.stringify({
        limit: fetchOptions.limit ?? "all",
        checkpoint: fetchOptions.checkpoint ?? null,
      });
      const existing = fetchCache.get(cacheKey);
      if (existing) {
        return existing;
      }

      const request = fetchJoobleJobs({
        apiKey,
        profile,
        keywords: options.keywords,
        locations: options.locations,
        now: fetchOptions.now,
        limit: fetchOptions.limit,
        signal: fetchOptions.signal,
        log: fetchOptions.log,
        checkpoint: parseCheckpoint(fetchOptions.checkpoint),
        onCheckpoint: fetchOptions.onCheckpoint,
      });
      request.catch(() => fetchCache.delete(cacheKey));
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchJoobleJobs(input: {
  apiKey: string;
  profile: string;
  keywords?: string[];
  locations?: Array<string | null>;
  now: Date;
  limit?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
  checkpoint?: JoobleCheckpoint | null;
  onCheckpoint?: (checkpoint: Prisma.InputJsonValue | null) => Promise<void> | void;
}): Promise<SourceConnectorFetchResult> {
  const searches = buildSearchSpecs({
    profile: input.profile,
    keywords: input.keywords,
    locations: input.locations,
  });
  const resultsPerPage = readPositiveIntEnv(
    "JOOBLE_RESULTS_PER_PAGE",
    JOOBLE_DEFAULT_RESULTS_PER_PAGE
  );
  const maxPages = readPositiveIntEnv(
    "JOOBLE_MAX_PAGES",
    JOOBLE_DEFAULT_MAX_PAGES
  );
  const searchesPerRun = readPositiveIntEnv(
    "JOOBLE_SEARCHES_PER_RUN",
    JOOBLE_DEFAULT_SEARCHES_PER_RUN
  );
  const rateDelayMs = readPositiveIntEnv(
    "JOOBLE_RATE_DELAY_MS",
    JOOBLE_DEFAULT_RATE_DELAY_MS
  );
  const seenIds = new Set<string>();
  const jobs: SourceConnectorJob[] = [];
  const searchSummaries: Array<Record<string, Prisma.InputJsonValue | null>> = [];
  const log = input.log ?? console.log;
  let nextCheckpoint: JoobleCheckpoint | null = input.checkpoint ?? {
    searchIndex: 0,
    page: 1,
  };
  let searchesProcessed = 0;
  let filteredForQualityCount = 0;

  for (
    let searchIndex = input.checkpoint?.searchIndex ?? 0;
    searchIndex < searches.length;
    searchIndex += 1
  ) {
    if (searchesPerRun > 0 && searchesProcessed >= searchesPerRun) {
      break;
    }

    const search = searches[searchIndex]!;
    const startPage =
      searchIndex === (input.checkpoint?.searchIndex ?? 0)
        ? input.checkpoint?.page ?? 1
        : 1;
    let pagesFetchedForSearch = 0;
    let fetchedForSearch = 0;
    let filteredForQualityForSearch = 0;

    for (
      let page = startPage;
      page <= maxPages && pagesFetchedForSearch < maxPages;
      page += 1
    ) {
      throwIfAborted(input.signal);
      if (typeof input.limit === "number" && jobs.length >= input.limit) {
        break;
      }

      const payload = await fetchJoobleSearchPage({
        apiKey: input.apiKey,
        keyword: search.keyword,
        location: search.location,
        page,
        resultsPerPage,
        signal: input.signal,
      });
      const entries = payload.jobs ?? [];

      if (entries.length === 0) {
        nextCheckpoint = {
          searchIndex: searchIndex + 1,
          page: 1,
        };
        await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);
        break;
      }

      for (const entry of entries) {
        if (!isAcceptableJoobleEntry(entry)) {
          filteredForQualityCount += 1;
          filteredForQualityForSearch += 1;
          continue;
        }

        const sourceId = buildSourceId(entry);
        if (!sourceId || seenIds.has(sourceId)) {
          continue;
        }
        seenIds.add(sourceId);
        jobs.push(mapJoobleJob(entry, input.now, search));
        fetchedForSearch += 1;
      }

      pagesFetchedForSearch += 1;
      nextCheckpoint = {
        searchIndex,
        page: page + 1,
      };
      await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);

      if (entries.length < resultsPerPage) {
        nextCheckpoint = {
          searchIndex: searchIndex + 1,
          page: 1,
        };
        await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);
        break;
      }

      await sleepWithAbort(rateDelayMs, input.signal);
    }

    searchSummaries.push({
      keyword: search.keyword,
      location: search.location,
      fetchedCount: fetchedForSearch,
      pagesFetched: pagesFetchedForSearch,
      filteredForQualityCount: filteredForQualityForSearch,
    });
    searchesProcessed += 1;

    if (pagesFetchedForSearch === 0) {
      log(
        `[jooble] search "${search.keyword}" @ "${search.location ?? "any"}" yielded no jobs`
      );
    }

    if (typeof input.limit === "number" && jobs.length >= input.limit) {
      break;
    }
  }

  const finalJobs =
    typeof input.limit === "number" ? jobs.slice(0, input.limit) : jobs;

  return {
    jobs: finalJobs,
    checkpoint: nextCheckpoint as Prisma.InputJsonValue | null,
    exhausted:
      nextCheckpoint == null ||
      nextCheckpoint.searchIndex >= searches.length,
    metadata: {
      apiBaseUrl: JOOBLE_API_BASE,
      profile: input.profile,
      fetchedAt: input.now.toISOString(),
      searchCount: searches.length,
      searchesProcessed,
      searchesPerRun,
      resultsPerPage,
      maxPages,
      rateDelayMs,
      filteredForQualityCount,
      searchSummaries,
      attribution: {
        required: false,
        note: "Provider-specific attribution should still be preserved where Jooble terms require it.",
      },
    } as Prisma.InputJsonValue,
  };
}

function isAcceptableJoobleEntry(job: JoobleJob) {
  const title = job.title?.trim();
  const company = job.company?.trim();
  if (!title || !company) return false;

  const normalizedCompany = company.toLowerCase().replace(/^www\./, "");
  return !JOOBLE_PLACEHOLDER_COMPANIES.has(normalizedCompany);
}

async function fetchJoobleSearchPage(input: {
  apiKey: string;
  keyword: string;
  location: string | null;
  page: number;
  resultsPerPage: number;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${JOOBLE_API_BASE}/${input.apiKey}`, {
    method: "POST",
    signal: input.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; autoapplication-jooble/1.0)",
    },
    body: JSON.stringify({
      keywords: input.keyword,
      location: input.location ?? undefined,
      page: String(input.page),
      ResultOnPage: String(input.resultsPerPage),
      SearchMode: "0",
      companysearch: "false",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Jooble API fetch failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as JoobleResponse;
}

function parseCheckpoint(value: Prisma.InputJsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const checkpoint = value as Prisma.InputJsonObject;
  const rawSearchIndex = checkpoint.searchIndex;
  const rawPage = checkpoint.page;
  const searchIndex =
    typeof rawSearchIndex === "number" ? Math.max(0, Math.round(rawSearchIndex)) : 0;
  const page = typeof rawPage === "number" ? Math.max(1, Math.round(rawPage)) : 1;

  return {
    searchIndex,
    page,
  } satisfies JoobleCheckpoint;
}

function buildSearchSpecs(input: {
  profile: string;
  keywords?: string[];
  locations?: Array<string | null>;
}) {
  const profileDefaults =
    JOOBLE_PROFILE_DEFAULTS[input.profile] ?? JOOBLE_PROFILE_DEFAULTS.feed;
  const envPrefix = input.profile.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const rawKeywords =
    input.keywords ??
    readCsvEnv(
      input.profile === "feed"
        ? "JOOBLE_KEYWORDS"
        : `JOOBLE_${envPrefix}_KEYWORDS`,
      profileDefaults.keywords
    );
  const rawLocations =
    input.locations ??
    readCsvEnv(
      input.profile === "feed"
        ? "JOOBLE_LOCATIONS"
        : `JOOBLE_${envPrefix}_LOCATIONS`,
      profileDefaults.locations.filter(
        (location): location is string => typeof location === "string"
      )
    );
  const keywords =
    rawKeywords.length === 1 && rawKeywords[0] === "ALL"
      ? [""]
      : rawKeywords;
  const locations =
    rawLocations.length === 1 && rawLocations[0] === "ALL"
      ? [null]
      : rawLocations
          .map((location) =>
            typeof location === "string" ? location.trim() : null
          )
          .filter((location): location is string => Boolean(location));

  const specs: JoobleSearchSpec[] = [];

  for (const location of locations.length > 0 ? locations : [null]) {
    for (const keyword of keywords.length > 0 ? keywords : [""]) {
      specs.push({
        keyword: keyword.trim(),
        location: location && location.trim().length > 0 ? location.trim() : null,
      });
    }
  }

  return specs.filter((spec) => spec.keyword.length > 0 || spec.location != null);
}

function normalizeProfileName(profile: string) {
  const normalized = profile.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized || "feed";
}

function buildSourceId(job: JoobleJob) {
  if (job.id != null) {
    return `jooble:${String(job.id).trim()}`;
  }

  const link = job.link?.trim();
  if (link && link.length > 0) {
    return `jooble:${link}`;
  }

  const fallbackParts = [
    job.title?.trim().toLowerCase() ?? "",
    job.company?.trim().toLowerCase() ?? "",
    job.location?.trim().toLowerCase() ?? "",
    job.updated?.trim() ?? "",
  ].filter(Boolean);
  return fallbackParts.length > 0
    ? `jooble:${fallbackParts.join("|")}`
    : null;
}

function mapJoobleJob(
  job: JoobleJob,
  now: Date,
  search: JoobleSearchSpec
): SourceConnectorJob {
  const salary = parseSalaryRange(job.salary);
  const link = job.link?.trim() ?? "";
  const location = normalizeLocation(job.location, search.location);
  const description = (job.snippet ?? "").trim();
  const workMode = inferWorkMode(job, location);

  return {
    sourceId:
      buildSourceId(job) ??
      `jooble:${search.keyword.trim().toLowerCase() || "any"}|${
        search.location?.trim().toLowerCase() || "anywhere"
      }`,
    sourceUrl: link || null,
    title: (job.title ?? "").trim() || "Untitled Position",
    company: (job.company ?? "").trim() || "Unknown Company",
    location,
    description,
    applyUrl: link,
    postedAt: parseDate(job.updated) ?? now,
    deadline: null,
    employmentType: inferEmploymentType(job.type),
    workMode,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    metadata: {
      source: "jooble",
      providerSource: job.source ?? null,
      providerType: job.type ?? null,
      searchKeyword: search.keyword,
      searchLocation: search.location,
      rawLocation: job.location ?? null,
      rawSalary: job.salary ?? null,
    } as Prisma.InputJsonValue,
  };
}

function normalizeLocation(
  rawLocation: string | undefined,
  fallbackLocation: string | null
) {
  const raw = rawLocation?.trim();
  if (raw && raw.length > 0) {
    if (/remote|work from home|anywhere/i.test(raw)) {
      if (/canada/i.test(raw)) return "Remote (Canada)";
      if (/united states|usa|u\.s\./i.test(raw)) return "Remote (US Only)";
      if (/north america/i.test(raw)) return "Remote (North America)";
      return "Remote";
    }

    return raw;
  }

  if (fallbackLocation) {
    if (/remote/i.test(fallbackLocation)) return "Remote";
    return fallbackLocation;
  }

  return "Unknown";
}

function inferWorkMode(job: JoobleJob, location: string): WorkMode | null {
  const joined = [job.title, job.snippet, job.location, location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bremote|work from home|anywhere\b/.test(joined)) return "REMOTE" as WorkMode;
  if (/\bhybrid\b/.test(joined)) return "HYBRID" as WorkMode;
  if (/\bon[- ]?site\b/.test(joined)) return "ONSITE" as WorkMode;
  return null;
}

function inferEmploymentType(rawType: string | undefined): EmploymentType | null {
  const value = rawType?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("contract") || value.includes("freelance")) return "CONTRACT";
  if (value.includes("part")) return "PART_TIME";
  if (value.includes("intern")) return "INTERNSHIP";
  if (value.includes("temp")) return "CONTRACT";
  if (value.includes("full")) return "FULL_TIME";
  return null;
}

function parseSalaryRange(rawValue: string | undefined) {
  if (!rawValue || !rawValue.trim()) {
    return {
      min: null,
      max: null,
      currency: null,
    };
  }

  const currency =
    /\bCAD\b|C\$/i.test(rawValue)
      ? "CAD"
      : /\bEUR\b|€/i.test(rawValue)
        ? "EUR"
        : "USD";
  const values = [...rawValue.matchAll(/\$?C?\$?€?\s*(\d+(?:\.\d+)?)\s*([kK])?/g)]
    .map((match) => {
      const base = Number(match[1]);
      if (!Number.isFinite(base)) return null;
      return match[2] ? base * 1_000 : base;
    })
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (values.length === 0) {
    return {
      min: null,
      max: null,
      currency: null,
    };
  }

  return {
    min: values[0] ?? null,
    max: values[1] ?? values[0] ?? null,
    currency,
  };
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
