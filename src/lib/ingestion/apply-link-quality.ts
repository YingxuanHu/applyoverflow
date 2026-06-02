export const APPLY_LINK_VALIDATION_STATUS = {
  ACTIVE: "ACTIVE",
  NEEDS_REVALIDATION: "NEEDS_REVALIDATION",
  EXPIRED: "EXPIRED",
  BROKEN_APPLY_LINK: "BROKEN_APPLY_LINK",
  GENERIC_APPLY_PAGE: "GENERIC_APPLY_PAGE",
  SOURCE_STALE: "SOURCE_STALE",
  HIDDEN_LOW_QUALITY: "HIDDEN_LOW_QUALITY",
} as const;

export type ApplyLinkValidationStatus =
  (typeof APPLY_LINK_VALIDATION_STATUS)[keyof typeof APPLY_LINK_VALIDATION_STATUS];

export type ApplyLinkRedirectHop = {
  url: string;
  statusCode: number | null;
  location: string | null;
};

export type ApplyLinkContentMatch = {
  titleTokens: string[];
  matchedTitleTokens: string[];
  titleMatchRatio: number;
  jobIdCandidates: string[];
  jobIdMatched: boolean;
  companyMatched: boolean;
  genericUrlSignals: string[];
  genericPageSignals: string[];
  expiredSignals: string[];
};

export type ApplyLinkQualityResult = {
  status: ApplyLinkValidationStatus;
  reason: string;
  isBadForFeed: boolean;
  contentMatch: ApplyLinkContentMatch;
};

const TERMINAL_HTTP_STATUSES = new Set([404, 410, 451]);
const BLOCKING_HTTP_STATUSES = new Set([401, 403, 429]);
const MAX_SAFE_REDIRECT_DEPTH = 6;

const TITLE_STOP_WORDS = new Set([
  "and",
  "are",
  "assistant",
  "associate",
  "contract",
  "full",
  "hybrid",
  "intermediate",
  "intern",
  "internship",
  "job",
  "jobs",
  "junior",
  "lead",
  "manager",
  "part",
  "remote",
  "senior",
  "specialist",
  "staff",
  "temporary",
  "the",
  "time",
]);

const EXPIRED_PATTERNS: Array<[RegExp, string]> = [
  [/\b(job|position|posting|requisition)\s+(is\s+)?no longer available\b/i, "posting_no_longer_available"],
  [/\bthis\s+(job|position|posting|requisition)\s+has\s+(expired|closed|been filled)\b/i, "posting_expired_or_closed"],
  [/\b(no longer accepting applications|applications are now closed)\b/i, "applications_closed"],
  [/\b(job|position|posting|requisition)\s+not\s+found\b/i, "posting_not_found"],
  [/\bthe job you are looking for cannot be found\b/i, "posting_not_found"],
  [/\bthis opportunity is no longer available\b/i, "opportunity_no_longer_available"],
];

const GENERIC_PAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\bsearch\s+by\s+keyword\b/i, "search_by_keyword"],
  [/\bsearch\s+by\s+location\b/i, "search_by_location"],
  [/\blocationsearch\b/i, "location_search_form"],
  [/\bcreatenewalert\b/i, "job_alert_search_page"],
  [/\bview\s+all\s+jobs\b/i, "view_all_jobs"],
  [/\bjoin\s+our\s+talent\s+community\b/i, "talent_community"],
  [/\bset\s+up\s+job\s+alerts\b/i, "job_alerts"],
  [/\bsearch\s+jobs\b/i, "search_jobs"],
  [/\bkeyword\s+or\s+job\s+id\b/i, "keyword_or_job_id_search"],
  [/\bthere\s+are\s+currently\s+no\s+open\s+positions\s+matching\b/i, "empty_search_results"],
];

export function classifyApplyLinkQuality(input: {
  requestedUrl: string;
  finalUrl: string | null;
  statusCode: number | null;
  bodyText: string;
  title: string;
  company?: string | null;
  redirectDepth: number;
  maxRedirectsReached?: boolean;
}): ApplyLinkQualityResult {
  const finalUrl = input.finalUrl ?? input.requestedUrl;
  const normalizedBody = normalizeText(stripHtml(input.bodyText));
  const contentMatch = buildContentMatch({
    requestedUrl: input.requestedUrl,
    finalUrl,
    bodyText: normalizedBody,
    title: input.title,
    company: input.company ?? null,
  });

  if (!input.requestedUrl || !/^https?:\/\//i.test(input.requestedUrl)) {
    return bad(
      APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK,
      "Apply URL is missing or not absolute.",
      contentMatch
    );
  }

  if (input.statusCode !== null && TERMINAL_HTTP_STATUSES.has(input.statusCode)) {
    return bad(
      APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK,
      `Apply URL returned terminal HTTP ${input.statusCode}.`,
      contentMatch
    );
  }

  if (input.statusCode !== null && input.statusCode >= 500) {
    return needsRevalidation(
      `Apply URL returned server error HTTP ${input.statusCode}.`,
      contentMatch
    );
  }

  if (input.statusCode !== null && BLOCKING_HTTP_STATUSES.has(input.statusCode)) {
    return needsRevalidation(
      `Apply URL returned blocking HTTP ${input.statusCode}.`,
      contentMatch
    );
  }

  if (input.maxRedirectsReached || input.redirectDepth > MAX_SAFE_REDIRECT_DEPTH) {
    return bad(
      APPLY_LINK_VALIDATION_STATUS.HIDDEN_LOW_QUALITY,
      `Apply URL exceeded safe redirect depth (${input.redirectDepth}).`,
      contentMatch
    );
  }

  if (contentMatch.expiredSignals.length > 0) {
    return bad(
      APPLY_LINK_VALIDATION_STATUS.EXPIRED,
      `Apply page indicates the posting is unavailable: ${contentMatch.expiredSignals[0]}.`,
      contentMatch
    );
  }

  const hasGenericDestinationEvidence =
    contentMatch.genericUrlSignals.length > 0 || contentMatch.genericPageSignals.length >= 2;

  if (hasGenericDestinationEvidence && !contentMatch.jobIdMatched) {
    return bad(
      APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE,
      buildGenericReason(contentMatch),
      contentMatch
    );
  }

  if (!normalizedBody || normalizedBody.length < 80) {
    return needsRevalidation(
      "Apply page body was too small to confirm a live posting.",
      contentMatch
    );
  }

  const hasSpecificJobEvidence =
    contentMatch.jobIdMatched ||
    (!hasGenericDestinationEvidence &&
      (contentMatch.titleMatchRatio >= 0.55 || contentMatch.matchedTitleTokens.length >= 3));

  if (hasSpecificJobEvidence) {
    return {
      status: APPLY_LINK_VALIDATION_STATUS.ACTIVE,
      reason: "Apply page contains job-specific evidence.",
      isBadForFeed: false,
      contentMatch,
    };
  }

  return needsRevalidation(
    "Apply page did not contain enough job-specific evidence.",
    contentMatch
  );
}

export function hasBadApplyLinkValidationStatus(status: string | null | undefined) {
  return (
    status === APPLY_LINK_VALIDATION_STATUS.EXPIRED ||
    status === APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK ||
    status === APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE ||
    status === APPLY_LINK_VALIDATION_STATUS.SOURCE_STALE ||
    status === APPLY_LINK_VALIDATION_STATUS.HIDDEN_LOW_QUALITY
  );
}

export function isClearlyGenericFinalApplyUrl(requestedUrl: string, finalUrl: string | null) {
  const signals = getGenericUrlSignals(requestedUrl, finalUrl ?? requestedUrl);
  return signals.length > 0;
}

function buildContentMatch(input: {
  requestedUrl: string;
  finalUrl: string;
  bodyText: string;
  title: string;
  company: string | null;
}): ApplyLinkContentMatch {
  const titleTokens = tokenizeTitle(input.title);
  const matchedTitleTokens = titleTokens.filter((token) => input.bodyText.includes(token));
  const titleMatchRatio =
    titleTokens.length > 0 ? matchedTitleTokens.length / titleTokens.length : 0;
  const jobIdCandidates = extractJobIdCandidates(input.requestedUrl, input.finalUrl);
  const searchableFinalUrl = input.finalUrl.toLowerCase();
  const jobIdMatched = jobIdCandidates.some(
    (candidate) =>
      input.bodyText.includes(candidate.toLowerCase()) ||
      searchableFinalUrl.includes(candidate.toLowerCase())
  );
  const companyMatched = input.company
    ? normalizeText(input.company)
        .split(" ")
        .filter((token) => token.length >= 4)
        .some((token) => input.bodyText.includes(token))
    : false;

  return {
    titleTokens,
    matchedTitleTokens,
    titleMatchRatio,
    jobIdCandidates,
    jobIdMatched,
    companyMatched,
    genericUrlSignals: getGenericUrlSignals(input.requestedUrl, input.finalUrl),
    genericPageSignals: getPatternSignals(input.bodyText, GENERIC_PAGE_PATTERNS),
    expiredSignals: getPatternSignals(input.bodyText, EXPIRED_PATTERNS),
  };
}

function bad(
  status: ApplyLinkValidationStatus,
  reason: string,
  contentMatch: ApplyLinkContentMatch
): ApplyLinkQualityResult {
  return {
    status,
    reason,
    isBadForFeed: true,
    contentMatch,
  };
}

function needsRevalidation(
  reason: string,
  contentMatch: ApplyLinkContentMatch
): ApplyLinkQualityResult {
  return {
    status: APPLY_LINK_VALIDATION_STATUS.NEEDS_REVALIDATION,
    reason,
    isBadForFeed: false,
    contentMatch,
  };
}

function buildGenericReason(contentMatch: ApplyLinkContentMatch) {
  const signals = [...contentMatch.genericUrlSignals, ...contentMatch.genericPageSignals];
  return `Apply URL resolves to a generic careers/search page (${signals.slice(0, 3).join(", ")}).`;
}

function getGenericUrlSignals(requestedUrl: string, finalUrl: string) {
  const signals: string[] = [];
  const requested = safeParseUrl(requestedUrl);
  const final = safeParseUrl(finalUrl);
  if (!final) return signals;

  const path = final.pathname.replace(/\/+$/, "").toLowerCase();
  const search = final.search.toLowerCase();
  const requestedPath = requested?.pathname.replace(/\/+$/, "").toLowerCase() ?? "";

  if (path === "" || path === "/") {
    signals.push("root_careers_url");
  }

  if (
    /^\/(careers?|jobs?|search|job-search|openings|opportunities|join-us)$/i.test(path) ||
    /^\/[a-z]{2}(-[a-z]{2})?\/(careers?|jobs?|search|job-search)$/i.test(path)
  ) {
    signals.push("generic_careers_path");
  }

  if (/\/search(\/|$)/i.test(path)) {
    signals.push("search_path");
  }

  if (/(^|[?&])(q|keyword|locationsearch)=(&|$)/i.test(search)) {
    signals.push("empty_search_query");
  }

  if (requestedPath && requestedPath !== path && likelyJobSpecificPath(requestedPath) && !likelyJobSpecificPath(path)) {
    signals.push("job_specific_path_lost_after_redirect");
  }

  return Array.from(new Set(signals));
}

function likelyJobSpecificPath(path: string) {
  if (/\b\d{5,}\b/.test(path)) return true;
  if (/(job|jobs|position|requisition|req|opening)[/-][a-z0-9-]*\d{3,}/i.test(path)) return true;
  if (/[a-z]+-[a-z]+-[a-z]+/.test(path) && !/\/(search|careers?|jobs?)$/i.test(path)) return true;
  return false;
}

function getPatternSignals(text: string, patterns: Array<[RegExp, string]>) {
  return patterns
    .filter(([pattern]) => pattern.test(text))
    .map(([, signal]) => signal);
}

function tokenizeTitle(title: string) {
  return normalizeText(title)
    .split(" ")
    .filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token))
    .slice(0, 12);
}

function extractJobIdCandidates(...urls: string[]) {
  const candidates = new Set<string>();

  for (const value of urls) {
    const parsed = safeParseUrl(value);
    if (!parsed) continue;

    for (const [, paramValue] of Array.from(parsed.searchParams.entries())) {
      if (isJobIdCandidate(paramValue)) candidates.add(paramValue.toLowerCase());
    }

    for (const token of parsed.pathname.split(/[^a-zA-Z0-9]+/)) {
      if (isJobIdCandidate(token)) candidates.add(token.toLowerCase());
    }
  }

  return Array.from(candidates).slice(0, 8);
}

function isJobIdCandidate(value: string) {
  const normalized = value.trim();
  return normalized.length >= 5 && normalized.length <= 40 && /\d/.test(normalized);
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.$/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeParseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
