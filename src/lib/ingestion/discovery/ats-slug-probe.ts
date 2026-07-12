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
// Pause between consecutive probe requests within a company. Rapid-fire
// probing gets the whole run 403/429'd by the platform APIs; tests pass 0.
const DEFAULT_REQUEST_DELAY_MS = 250;

// Several platform APIs throttle or hard-block clients that present no
// browser-ish User-Agent, so every probe request sends one.
const PROBE_REQUEST_HEADERS: Record<string, string> = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Domain labels that identify job infrastructure or shared hosts rather than
// the company itself. Companies recorded with an incubator/ATS/job-board
// domain (e.g. Zepto with domain ycombinator.com, or a jobvite-hosted careers
// host) must never derive a slug from that label — probing ashby:ycombinator
// "succeeds" against Y Combinator's own board and registers a wrong-company
// lead. Name-derived slugs still apply.
export const SHARED_HOST_SLUG_BLOCKLIST = new Set<string>([
  "ycombinator",
  "jobvite",
  "greenhouse",
  "lever",
  "ashbyhq",
  "ashby",
  "workable",
  "recruitee",
  "rippling",
  "smartrecruiters",
  "myworkdayjobs",
  "workday",
  "icims",
  "taleo",
  "successfactors",
  "teamtailor",
  "breezyhr",
  "bamboohr",
  "linkedin",
  "indeed",
  "glassdoor",
  "wellfound",
  "angellist",
  "notion",
  "google",
  "gmail",
  "facebook",
  "squarespace",
  "wixsite",
  "wordpress",
  "github",
]);

// Belt-and-suspenders registration guard: a hit whose slug IS a shared-host
// label (arriving via the name path) is almost always someone else's board
// unless the board's self-reported identity confirms the match.
export function isSuspectSharedHostHit(hit: {
  slug: string;
  identityVerdict: AtsSlugIdentityVerdict;
}): boolean {
  return (
    SHARED_HOST_SLUG_BLOCKLIST.has(hit.slug) && hit.identityVerdict !== "match"
  );
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
      const label = labels[labels.length - 2];
      if (!SHARED_HOST_SLUG_BLOCKLIST.has(label)) push(label);
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

// Identity verification verdict for a hit: does the board's self-reported
// organization name correspond to the company we probed for? A slug can
// collide with an unrelated company (boards.greenhouse.io/acme belonging to a
// different "Acme"), and ownership scoring alone can be fooled by the slug
// itself — the board's own metadata is the stronger signal.
//   match      — reported name overlaps the expected name
//   mismatch   — reported name shares no tokens with the expected name
//   unverified — the platform exposed no organization name to compare
export type AtsSlugIdentityVerdict = "match" | "mismatch" | "unverified";

export type AtsSlugProbeResult = {
  platform: ProbeableAtsPlatform;
  connectorName: string;
  slug: string;
  status: AtsSlugProbeStatus;
  probeUrl: string;
  boardUrl: string;
  jobCount: number | null;
  companyNameHint: string | null;
  identityVerdict: AtsSlugIdentityVerdict;
  identitySimilarity: number | null;
  detail?: string;
};

// Token-containment similarity between an expected company name and a
// board-reported one, after normalizing and stripping legal suffixes.
// "Acme" vs "Acme Robotics, Inc." scores 1.0 (full containment); unrelated
// names score 0. Used with a conservative rule: only a ZERO overlap is
// treated as a mismatch — partial overlaps stay eligible and are settled by
// ownership scoring downstream.
export function computeCompanyNameSimilarity(
  expected: string,
  reported: string
): number {
  const expectedTokens = new Set(stripSuffixTokens(normalizeTokens(expected)));
  const reportedTokens = new Set(stripSuffixTokens(normalizeTokens(reported)));
  if (expectedTokens.size === 0 || reportedTokens.size === 0) return 0;

  let shared = 0;
  for (const token of expectedTokens) {
    if (reportedTokens.has(token)) shared += 1;
  }
  return shared / Math.min(expectedTokens.size, reportedTokens.size);
}

const IDENTITY_MATCH_THRESHOLD = 0.5;

export function classifyIdentity(
  expectedName: string | null | undefined,
  reportedName: string | null | undefined
): { verdict: AtsSlugIdentityVerdict; similarity: number | null } {
  const expected = expectedName?.trim() ?? "";
  const reported = reportedName?.trim() ?? "";
  if (!expected || !reported) return { verdict: "unverified", similarity: null };

  const similarity = computeCompanyNameSimilarity(expected, reported);
  if (similarity >= IDENTITY_MATCH_THRESHOLD) {
    return { verdict: "match", similarity };
  }
  if (similarity === 0) {
    return { verdict: "mismatch", similarity };
  }
  return { verdict: "unverified", similarity };
}

type PlatformProbeSpec = {
  connectorName: string;
  buildProbeUrl: (slug: string) => string;
  buildBoardUrl: (slug: string) => string;
  classify: (payload: unknown) => { jobCount: number; companyNameHint?: string } | null;
  // Optional follow-up request that returns the organization's self-reported
  // name (used for identity verification when the jobs payload lacks one).
  buildIdentityUrl?: (slug: string) => string;
  extractIdentityName?: (payload: unknown) => string | null;
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
    buildIdentityUrl: (slug) =>
      `https://boards-api.greenhouse.io/v1/boards/${slug}`,
    extractIdentityName: (payload) => {
      const record = asRecord(payload);
      return record && typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : null;
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
      // Ashby's posting API includes the org's display name on jobs.
      const firstJob = asRecord(record.jobs[0]);
      const organizationName =
        (typeof record.organizationName === "string" && record.organizationName.trim()) ||
        (firstJob && typeof firstJob.organizationName === "string" && firstJob.organizationName.trim()) ||
        undefined;
      return {
        jobCount: record.jobs.length,
        companyNameHint: organizationName || undefined,
      };
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
      // Postings embed the company identity — use it for verification.
      const content = Array.isArray(record.content) ? record.content : [];
      const firstPosting = asRecord(content[0]);
      const company = firstPosting ? asRecord(firstPosting.company) : null;
      const companyNameHint =
        company && typeof company.name === "string" && company.name.trim()
          ? company.name.trim()
          : undefined;
      return { jobCount: record.totalFound, companyNameHint };
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
  options: { fetchImpl: FetchLike; timeoutMs: number; pace: () => Promise<void> }
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
      identityVerdict: "unverified",
      identitySimilarity: null,
    };

  await options.pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(probeUrl, {
      signal: controller.signal,
      headers: { ...PROBE_REQUEST_HEADERS },
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
  // Boards that exist and have jobs but whose self-reported organization name
  // shares nothing with the expected company — slug collisions. Kept out of
  // `hits` so callers cannot accidentally register a wrong-company board.
  identityMismatches: AtsSlugProbeResult[];
  blocked: AtsSlugProbeResult[];
  errors: AtsSlugProbeResult[];
  // Platforms not probed for this company because an earlier company in the
  // same run saw them blocked (run-level bench, see createProbeRunContext).
  skippedPlatforms: ProbeableAtsPlatform[];
  attempts: number;
};

// Run-level shared state, one per script/daemon run. A platform that starts
// returning 403/429 will keep doing so for every subsequent company, so the
// first blocked verdict benches the platform for the remainder of the run
// instead of hammering it another few hundred times.
export type ProbeRunContext = {
  isBenched: (platform: ProbeableAtsPlatform) => boolean;
  bench: (platform: ProbeableAtsPlatform) => void;
  benchedPlatforms: () => ProbeableAtsPlatform[];
};

export function createProbeRunContext(options?: {
  // Fired exactly once per platform, on the transition into benched.
  onPlatformBenched?: (platform: ProbeableAtsPlatform) => void;
}): ProbeRunContext {
  const benched = new Set<ProbeableAtsPlatform>();
  return {
    isBenched: (platform) => benched.has(platform),
    bench: (platform) => {
      if (benched.has(platform)) return;
      benched.add(platform);
      options?.onPlatformBenched?.(platform);
    },
    benchedPlatforms: () => [...benched],
  };
}

// Fetches the board's self-reported organization name via the platform's
// identity endpoint when the jobs payload did not already include one.
async function resolveReportedCompanyName(
  hit: AtsSlugProbeResult,
  options: { fetchImpl: FetchLike; timeoutMs: number; pace: () => Promise<void> }
): Promise<string | null> {
  if (hit.companyNameHint) return hit.companyNameHint;

  const spec = PLATFORM_PROBES[hit.platform];
  if (!spec.buildIdentityUrl || !spec.extractIdentityName) return null;

  await options.pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(spec.buildIdentityUrl(hit.slug), {
      signal: controller.signal,
      headers: { ...PROBE_REQUEST_HEADERS },
    });
    if (response.status < 200 || response.status >= 300) return null;
    return spec.extractIdentityName(await response.json());
  } catch {
    // Identity lookup failures degrade to "unverified", never to a hard fail.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Probes every requested platform, trying slug candidates in order and
// stopping at the first hit per platform (a company rarely runs two boards on
// the same ATS). Platforms are independent — a company can legitimately show
// up on more than one, and downstream ownership scoring decides which to keep.
// Every hit is identity-verified against the expected company name when the
// platform exposes an organization name.
export async function probeAtsSlugsForCompany(input: {
  name?: string | null;
  domain?: string | null;
  platforms?: ProbeableAtsPlatform[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  minJobCount?: number;
  // Delay between consecutive probe requests (default 250ms; 0 disables).
  requestDelayMs?: number;
  // Shared across companies in one run: benched (blocked) platforms are
  // skipped for every subsequent company instead of re-probed.
  runContext?: ProbeRunContext;
}): Promise<CompanySlugProbeSummary> {
  const slugCandidates = buildCompanySlugCandidates(input);
  const platforms = input.platforms ?? PROBEABLE_ATS_PLATFORMS;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const minJobCount = input.minJobCount ?? 1;
  const requestDelayMs = input.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const runContext = input.runContext;

  const hits: AtsSlugProbeResult[] = [];
  const identityMismatches: AtsSlugProbeResult[] = [];
  const blocked: AtsSlugProbeResult[] = [];
  const errors: AtsSlugProbeResult[] = [];
  const skippedPlatforms: ProbeableAtsPlatform[] = [];
  let attempts = 0;

  // Pacing: no delay ahead of the first request, then requestDelayMs between
  // each subsequent one (probe and identity lookups alike).
  let requestCount = 0;
  const pace = async () => {
    if (requestCount > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
    requestCount += 1;
  };

  for (const platform of platforms) {
    if (runContext?.isBenched(platform)) {
      skippedPlatforms.push(platform);
      continue;
    }
    for (const slug of slugCandidates) {
      attempts += 1;
      const result = await probeOne(platform, slug, {
        fetchImpl,
        timeoutMs,
        pace,
      });
      if (result.status === "hit") {
        if ((result.jobCount ?? 0) >= minJobCount) {
          const reportedName = await resolveReportedCompanyName(result, {
            fetchImpl,
            timeoutMs,
            pace,
          });
          const identity = classifyIdentity(input.name, reportedName);
          const verified: AtsSlugProbeResult = {
            ...result,
            companyNameHint: reportedName ?? result.companyNameHint,
            identityVerdict: identity.verdict,
            identitySimilarity: identity.similarity,
          };
          if (identity.verdict === "mismatch" || isSuspectSharedHostHit(verified)) {
            identityMismatches.push(verified);
          } else {
            hits.push(verified);
          }
        }
        break;
      }
      if (result.status === "blocked") {
        blocked.push(result);
        // A blocked platform will block the remaining slugs too — bench it
        // for the rest of the run and move on.
        runContext?.bench(platform);
        break;
      }
      if (result.status === "error") {
        errors.push(result);
      }
    }
  }

  return {
    slugCandidates,
    hits,
    identityMismatches,
    blocked,
    errors,
    skippedPlatforms,
    attempts,
  };
}
