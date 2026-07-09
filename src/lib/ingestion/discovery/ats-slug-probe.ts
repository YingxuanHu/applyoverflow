// Proactive ATS board discovery: instead of waiting for a careers-page URL to
// be curated (CSV imports) or found by search, derive candidate board slugs
// from a company's name and domain and probe the public, unauthenticated
// JSON endpoints that the clean-application ATS platforms expose
// (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee).
//
// A probe hit is a LEAD, not a truth: a slug can collide with an unrelated
// company. Hits must be registered as SourceCandidates and flow through the
// existing validation + promotion-planner pipeline (ownership scoring,
// duplicate/conflict checks) — never promoted directly from a probe.

export type ProbeableAtsPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "recruitee";

export const PROBEABLE_ATS_PLATFORMS: ProbeableAtsPlatform[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
];

const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_CANDIDATES = 5;
const DEFAULT_PROBE_TIMEOUT_MS = 8_000;

// Legal / structural suffixes that rarely appear in ATS slugs.
const COMPANY_NAME_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "sa",
  "ag",
  "holdings",
  "group",
]);

function normalizeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function stripSuffixTokens(tokens: string[]): string[] {
  const stripped = [...tokens];
  while (
    stripped.length > 1 &&
    COMPANY_NAME_SUFFIXES.has(stripped[stripped.length - 1])
  ) {
    stripped.pop();
  }
  return stripped;
}

export function buildCompanySlugCandidates(input: {
  name?: string | null;
  domain?: string | null;
}): string[] {
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const slug = value?.trim().toLowerCase() ?? "";
    if (slug.length < MIN_SLUG_LENGTH) return;
    if (!/^[a-z0-9-]+$/.test(slug)) return;
    if (!candidates.includes(slug)) candidates.push(slug);
  };

  // The registrable domain label is the strongest signal (acme.com -> acme).
  const domain = input.domain?.trim().toLowerCase() ?? "";
  if (domain) {
    const host = domain
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .replace(/^www\./, "");
    const labels = host.split(".").filter(Boolean);
    if (labels.length >= 2) {
      push(labels[labels.length - 2]);
    }
  }

  const tokens = normalizeTokens(input.name ?? "");
  if (tokens.length > 0) {
    const strippedTokens = stripSuffixTokens(tokens);
    push(strippedTokens.join(""));
    push(strippedTokens.join("-"));
    push(tokens.join(""));
    push(tokens.join("-"));
  }

  return candidates.slice(0, MAX_SLUG_CANDIDATES);
}

export type AtsSlugProbeStatus = "hit" | "miss" | "blocked" | "error";

export type AtsSlugProbeResult = {
  platform: ProbeableAtsPlatform;
  connectorName: string;
  slug: string;
  status: AtsSlugProbeStatus;
  probeUrl: string;
  boardUrl: string;
  jobCount: number | null;
  companyNameHint: string | null;
  detail?: string;
};

type PlatformProbeSpec = {
  connectorName: string;
  buildProbeUrl: (slug: string) => string;
  buildBoardUrl: (slug: string) => string;
  classify: (payload: unknown) => { jobCount: number; companyNameHint?: string } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const PLATFORM_PROBES: Record<ProbeableAtsPlatform, PlatformProbeSpec> = {
  greenhouse: {
    connectorName: "greenhouse",
    buildProbeUrl: (slug) =>
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    buildBoardUrl: (slug) => `https://boards.greenhouse.io/${slug}`,
    classify: (payload) => {
      const record = asRecord(payload);
      if (!record || !Array.isArray(record.jobs)) return null;
      return { jobCount: record.jobs.length };
    },
  },
  lever: {
    connectorName: "lever",
    buildProbeUrl: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    buildBoardUrl: (slug) => `https://jobs.lever.co/${slug}`,
    classify: (payload) => {
      if (!Array.isArray(payload)) return null;
      return { jobCount: payload.length };
    },
  },
  ashby: {
    connectorName: "ashby",
    buildProbeUrl: (slug) =>
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    buildBoardUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    classify: (payload) => {
      const record = asRecord(payload);
      if (!record || !Array.isArray(record.jobs)) return null;
      return { jobCount: record.jobs.length };
    },
  },
  smartrecruiters: {
    connectorName: "smartrecruiters",
    buildProbeUrl: (slug) =>
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
    buildBoardUrl: (slug) => `https://careers.smartrecruiters.com/${slug}`,
    classify: (payload) => {
      const record = asRecord(payload);
      if (!record || typeof record.totalFound !== "number") return null;
      return { jobCount: record.totalFound };
    },
  },
  workable: {
    connectorName: "workable",
    buildProbeUrl: (slug) => `https://www.workable.com/api/accounts/${slug}`,
    buildBoardUrl: (slug) => `https://apply.workable.com/${slug}/`,
    classify: (payload) => {
      const record = asRecord(payload);
      if (!record || !Array.isArray(record.jobs)) return null;
      const companyNameHint =
        typeof record.name === "string" && record.name.trim().length > 0
          ? record.name.trim()
          : undefined;
      return { jobCount: record.jobs.length, companyNameHint };
    },
  },
  recruitee: {
    connectorName: "recruitee",
    buildProbeUrl: (slug) => `https://${slug}.recruitee.com/api/offers/`,
    buildBoardUrl: (slug) => `https://${slug}.recruitee.com/`,
    classify: (payload) => {
      const record = asRecord(payload);
      if (!record || !Array.isArray(record.offers)) return null;
      return { jobCount: record.offers.length };
    },
  },
};

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> }
) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

async function probeOne(
  platform: ProbeableAtsPlatform,
  slug: string,
  options: { fetchImpl: FetchLike; timeoutMs: number }
): Promise<AtsSlugProbeResult> {
  const spec = PLATFORM_PROBES[platform];
  const probeUrl = spec.buildProbeUrl(slug);
  const base: Omit<AtsSlugProbeResult, "status" | "jobCount" | "companyNameHint"> =
    {
      platform,
      connectorName: spec.connectorName,
      slug,
      probeUrl,
      boardUrl: spec.buildBoardUrl(slug),
    };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(probeUrl, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (response.status === 404 || response.status === 410) {
      return { ...base, status: "miss", jobCount: null, companyNameHint: null };
    }
    if (response.status === 403 || response.status === 429) {
      return {
        ...base,
        status: "blocked",
        jobCount: null,
        companyNameHint: null,
        detail: `HTTP ${response.status}`,
      };
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        ...base,
        status: "error",
        jobCount: null,
        companyNameHint: null,
        detail: `HTTP ${response.status}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ...base,
        status: "miss",
        jobCount: null,
        companyNameHint: null,
        detail: "non-JSON 2xx response",
      };
    }

    const classified = spec.classify(payload);
    if (!classified) {
      return {
        ...base,
        status: "miss",
        jobCount: null,
        companyNameHint: null,
        detail: "unrecognized payload shape",
      };
    }

    return {
      ...base,
      status: "hit",
      jobCount: classified.jobCount,
      companyNameHint: classified.companyNameHint ?? null,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      jobCount: null,
      companyNameHint: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type CompanySlugProbeSummary = {
  slugCandidates: string[];
  hits: AtsSlugProbeResult[];
  blocked: AtsSlugProbeResult[];
  errors: AtsSlugProbeResult[];
  attempts: number;
};

// Probes every requested platform, trying slug candidates in order and
// stopping at the first hit per platform (a company rarely runs two boards on
// the same ATS). Platforms are independent — a company can legitimately show
// up on more than one, and downstream ownership scoring decides which to keep.
export async function probeAtsSlugsForCompany(input: {
  name?: string | null;
  domain?: string | null;
  platforms?: ProbeableAtsPlatform[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  minJobCount?: number;
}): Promise<CompanySlugProbeSummary> {
  const slugCandidates = buildCompanySlugCandidates(input);
  const platforms = input.platforms ?? PROBEABLE_ATS_PLATFORMS;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const minJobCount = input.minJobCount ?? 1;

  const hits: AtsSlugProbeResult[] = [];
  const blocked: AtsSlugProbeResult[] = [];
  const errors: AtsSlugProbeResult[] = [];
  let attempts = 0;

  for (const platform of platforms) {
    for (const slug of slugCandidates) {
      attempts += 1;
      const result = await probeOne(platform, slug, { fetchImpl, timeoutMs });
      if (result.status === "hit") {
        if ((result.jobCount ?? 0) >= minJobCount) {
          hits.push(result);
        }
        break;
      }
      if (result.status === "blocked") {
        blocked.push(result);
        // A blocked platform will block the remaining slugs too — move on.
        break;
      }
      if (result.status === "error") {
        errors.push(result);
      }
    }
  }

  return { slugCandidates, hits, blocked, errors, attempts };
}
