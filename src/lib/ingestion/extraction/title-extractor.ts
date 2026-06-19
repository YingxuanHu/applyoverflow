import type { Prisma } from "@/generated/prisma/client";
import { decodeHtmlEntitiesFull } from "@/lib/ingestion/html-description";
import type {
  FieldCandidate,
  FieldCandidateSource,
  FieldStatus,
  SelectedField,
  TitleExtractionResult,
  TitlePageType,
} from "@/lib/ingestion/extraction/types";
import type { SourceConnectorJob } from "@/lib/ingestion/types";

type TitleContext = {
  company?: string | null;
  urls?: Array<string | null | undefined>;
  sourceName?: string | null;
  metadata?: Prisma.InputJsonValue | Prisma.JsonValue | null;
  location?: string | null;
  description?: string | null;
};

type RawTitleCandidate = {
  rawValue: string;
  source: FieldCandidateSource;
  evidence: string;
};

type ExtractedTitleMetadata = {
  workMode?: string | null;
  location?: string | null;
  employmentType?: string | null;
};

type FragmentClassification = {
  kind:
    | "metadata"
    | "title"
    | "department"
    | "page_chrome"
    | "section_heading"
    | "marketing"
    | "unknown";
  reason?: string;
  metadata?: ExtractedTitleMetadata;
};

type HeaderParseResult = {
  titleCandidates: Array<{
    value: string;
    rawValue: string;
    source: FieldCandidateSource;
    evidence: string;
  }>;
  rejectedFragments: FieldCandidate<string>[];
  extractedMetadata: ExtractedTitleMetadata;
  displayTitle?: string | null;
  jobPageType?: TitlePageType;
  warnings: string[];
};

type MarketingRecovery = {
  title: string;
  displayTitle: string | null;
  location: string | null;
  employmentType: string | null;
  workMode: string | null;
  jobPageType: TitlePageType;
  reason: string;
};

const SOURCE_WEIGHTS: Partial<Record<FieldCandidateSource, number>> = {
  official_api: 0.98,
  ats_api: 0.95,
  json_ld: 0.92,
  connector_raw: 0.88,
  h1: 0.85,
  page_title: 0.72,
  og_title: 0.7,
  meta_title: 0.65,
  header_block: 0.62,
  recovered_from_header: 0.74,
  recovered_from_marketing_headline: 0.82,
  recovered_from_seo_title: 0.82,
  url_slug: 0.55,
  link_text: 0.5,
  body_text: 0.3,
  metadata: 0.65,
  fallback: 0.2,
};

export const ENABLE_CANDIDATE_TITLE_EXTRACTION =
  process.env.ENABLE_CANDIDATE_TITLE_EXTRACTION !== "false";
export const STRICT_TITLE_QUALITY_GATE =
  process.env.STRICT_TITLE_QUALITY_GATE !== "false";
export const MIN_TITLE_INDEX_CONFIDENCE = Number(
  process.env.MIN_TITLE_INDEX_CONFIDENCE ?? "0.75"
);
export const ALLOW_USABLE_REVIEW_TITLES =
  process.env.ALLOW_USABLE_REVIEW_TITLES === "true";

const PAGE_CHROME_PATTERNS = [
  /^careers?$/i,
  /^jobs?$/i,
  /^job search$/i,
  /^join us$/i,
  /^join our team$/i,
  /^open positions?$/i,
  /^open roles?$/i,
  /^search results?$/i,
  /^apply now$/i,
  /^apply$/i,
  /^view job$/i,
  /^view all jobs$/i,
  /^life at\b/i,
  /^privacy policy$/i,
  /^terms of use$/i,
  /^cookie policy$/i,
  /^home$/i,
  /^about us$/i,
  /^opportunities$/i,
  /^talent community$/i,
  /^general application$/i,
  /^not found$/i,
  /^error$/i,
  /^loading$/i,
  /^login$/i,
  /^sign in$/i,
  /^current openings?$/i,
  /^job openings?$/i,
  /^career opportunities?$/i,
] satisfies RegExp[];

const SECTION_HEADING_PATTERNS = [
  /^job description$/i,
  /^overview$/i,
  /^about the role$/i,
  /^about the team$/i,
  /^about us$/i,
  /^who we are$/i,
  /^who you are$/i,
  /^the opportunity$/i,
  /^why work for us$/i,
  /^what you will do$/i,
  /^responsibilities$/i,
  /^requirements$/i,
  /^qualifications$/i,
  /^minimum qualifications$/i,
  /^preferred qualifications$/i,
  /^benefits$/i,
  /^compensation$/i,
  /^application process$/i,
  /^how to apply$/i,
  /^equal opportunity employer$/i,
] satisfies RegExp[];

const APPLY_CHROME_RE =
  /\b(apply now|apply for this job|view job|view all jobs|job details|company careers?|careers? home|search jobs?|open positions?|current openings?)\b/i;
const SALARY_FRAGMENT_RE =
  /(?:[$€£]|(?:USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:-|–|—|to)\s*(?:[$€£]|(?:USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)?\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?(?:\s*(?:per|\/)\s*(?:year|yr|hour|hr|month|week|day))?/i;
const COMPENSATION_BENEFIT_RE =
  /\b(?:sign[-\s]?on|signing|joining|starting|retention|relocation|performance|annual)\s+bonus\b|\bbonus\s+(?:available|eligible|offered|included)\b/i;
const TRAILING_COMPENSATION_BENEFIT_RE =
  /\s*(?:[-–—|,]\s*)?(?:(?:up to|as much as)\s+)?(?:(?:[$€£]|(?:USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*)?(?:sign[-\s]?on|signing|joining|starting|retention|relocation|performance|annual)\s+bonus(?:\s+(?:available|eligible|offered|included))?!?\s*$/i;
const REQ_ID_RE =
  /^(?:req(?:uisition)?|job|posting|position|reference)\s*(?:id|number|#)?:?\s*[a-z0-9][a-z0-9-]{2,}$/i;
const REQ_ID_SUFFIX_RE =
  /\s*(?:[-–—|,]\s*)?(?:req(?:uisition)?|job|posting|position|reference)\s*(?:id|number|#)?:?\s*[a-z0-9][a-z0-9-]{2,}\s*$/i;
const DATE_LABEL_RE =
  /^(?:posted(?:\s+(?:today|yesterday|\d+\+?\s+days?\s+ago|on\s+.+))?|posted\s+on\s+.+|application\s+deadline|apply\s+by\s+.+|closing\s+date|applications?\s+close(?:s)?\s+.+)$/i;
const TERM_SEGMENT_RE =
  /^(?:summer|fall|winter|spring)\s+20\d{2}$|^\d{1,2}\s*(?:month|months|mo)\s+(?:contract|term)$/i;
const SENTENCE_VERB_RE =
  /\b(we are|we're|you will|you'll|join us|looking for|responsible for|this role|our team|click|learn more|please|welcome to)\b/i;

const ROLE_LIKE_RE =
  /\b(engineer|developer|analyst|manager|designer|associate|consultant|specialist|coordinator|director|scientist|technician|representative|advisor|administrator|architect|lead|leader|partner|president|vp|intern|internship|co-?op|officer|assistant|executive|nurse|physician|therapist|mechanic|operator|driver|courier|mover|sales|accountant|auditor|clerk|recruiter|counsel|lawyer|attorney|paralegal|audiologists?|electrician|welder|welding|fabrication|product|program|project|marketing|finance|data|software|machine|security|support|customer|success|teacher|professor|researcher|sre|devops|qa|ux|ui|designer|planner|buyer|writer|editor|strategist|controller|bookkeeper|underwriter|actuary)\b/i;

const DEPARTMENT_ONLY = new Set([
  "administrative",
  "ai",
  "analytics",
  "business",
  "communications",
  "customer success",
  "data",
  "design",
  "engineering",
  "finance",
  "human resources",
  "infrastructure",
  "legal",
  "machine learning",
  "marketing",
  "operations",
  "people",
  "platform",
  "product",
  "sales",
  "security",
]);

const CITY_OR_REGION_TOKENS = new Set([
  "alberta",
  "americas",
  "austin",
  "boston",
  "british columbia",
  "calgary",
  "california",
  "canada",
  "chicago",
  "dallas",
  "denver",
  "florida",
  "hyderabad",
  "los angeles",
  "mississauga",
  "montreal",
  "montréal",
  "multiple locations",
  "new jersey",
  "new york",
  "new york city",
  "north america",
  "ontario",
  "ottawa",
  "quebec",
  "québec",
  "remote",
  "san francisco",
  "seattle",
  "toronto",
  "united states",
  "us",
  "usa",
  "u.s.",
  "vancouver",
  "waterloo",
]);

const STATE_OR_COUNTRY_CODES = new Set([
  "ab",
  "bc",
  "ca",
  "co",
  "dc",
  "fl",
  "ga",
  "il",
  "ma",
  "ny",
  "on",
  "qc",
  "tx",
  "uk",
  "us",
  "usa",
  "wa",
]);

const EMPLOYMENT_ONLY_PATTERNS = [
  /^full[-\s]?time$/i,
  /^part[-\s]?time$/i,
  /^contract$/i,
  /^contractor$/i,
  /^independent contractor$/i,
  /^\d{1,2}\s*(?:month|months|mo)\s+contract$/i,
  /^temporary$/i,
  /^temp$/i,
  /^fixed[-\s]?term$/i,
  /^internship$/i,
  /^intern$/i,
  /^co[-\s]?op$/i,
  /^coop$/i,
  /^apprenticeship$/i,
  /^apprentice$/i,
  /^seasonal$/i,
  /^freelance$/i,
  /^volunteer$/i,
] satisfies RegExp[];

const WORK_MODE_ONLY_PATTERNS = [
  /^remote$/i,
  /^fully remote$/i,
  /^100%\s*remote$/i,
  /^hybrid$/i,
  /^on[-\s]?site$/i,
  /^onsite$/i,
  /^in[-\s]?office$/i,
  /^office[-\s]?based$/i,
  /^flexible$/i,
] satisfies RegExp[];

const MARKETING_HEADLINE_RE =
  /\b(?:earn money|make money|get paid|be your own boss|start earning|work when you want|set your own schedule|drive with|deliver with|join our platform|become a driver|become a shopper|become a courier|sign up to|start driving|start delivering)\b/i;
const SEO_JOB_TITLE_RE =
  /^(?:.+?\s+)?jobs?\s+in\s+.+$|^.+?\s+jobs?\s+in\s+.+$|^hiring\s+in\s+.+$|^now hiring\b.+/i;

const URL_PATH_IGNORED_SEGMENTS = new Set([
  "",
  "en",
  "en-us",
  "fr",
  "fr-ca",
  "job",
  "jobs",
  "career",
  "careers",
  "position",
  "positions",
  "opening",
  "openings",
  "requisition",
  "requisitions",
  "role",
  "roles",
  "apply",
  "details",
  "jobdetail",
  "jobdetails",
  "jobposting",
  "search",
  "search-results",
]);

const FORCED_CASE = new Map([
  ["ai", "AI"],
  ["api", "API"],
  ["apac", "APAC"],
  ["aws", "AWS"],
  ["c++", "C++"],
  ["c#", "C#"],
  ["devops", "DevOps"],
  ["emea", "EMEA"],
  ["ios", "iOS"],
  ["it", "IT"],
  ["ml", "ML"],
  ["qa", "QA"],
  ["sre", "SRE"],
  ["ui", "UI"],
  ["ux", "UX"],
  ["us", "US"],
]);

export function extractJobTitle(
  job: Pick<SourceConnectorJob, "title" | "applyUrl" | "sourceUrl" | "metadata" | "location" | "description">,
  context: TitleContext = {}
): TitleExtractionResult {
  const urls = uniqueStrings([...(context.urls ?? []), job.applyUrl, job.sourceUrl]);
  const rawTitleSource = inferStructuredTitleSource(context.sourceName, context.metadata ?? job.metadata);
  const rawCandidates: RawTitleCandidate[] = [];

  addRaw(rawCandidates, job.title, rawTitleSource, "job.title");

  for (const hit of collectMetadataTitleCandidates(context.metadata ?? job.metadata)) {
    addRaw(rawCandidates, hit.value, hit.source, hit.evidence);
  }

  for (const url of urls) {
    const urlTitle = extractTitleFromUrl(url);
    if (urlTitle) addRaw(rawCandidates, urlTitle, "url_slug", `url:${url}`);
  }

  const candidateInputs: HeaderParseResult["titleCandidates"] = [];
  const rejectedFragments: FieldCandidate<string>[] = [];
  const extractedMetadata: ExtractedTitleMetadata = {};
  const warnings: string[] = [];
  let displayTitle: string | null = null;
  let jobPageType: TitlePageType = "unknown";

  for (const rawCandidate of rawCandidates) {
    const rawText = normalizeTitleText(rawCandidate.rawValue);
    if (!rawText) continue;

    const headerResult = parseJobHeaderBlock(rawText, {
      ...context,
      urls,
      sourceName: context.sourceName,
      metadata: context.metadata ?? job.metadata,
      location: context.location ?? job.location,
      description: context.description ?? job.description,
    }, rawCandidate);

    mergeMetadata(extractedMetadata, headerResult.extractedMetadata);
    rejectedFragments.push(...headerResult.rejectedFragments);
    warnings.push(...headerResult.warnings);
    if (headerResult.displayTitle && !displayTitle) displayTitle = headerResult.displayTitle;
    if (headerResult.jobPageType && headerResult.jobPageType !== "unknown") {
      jobPageType = headerResult.jobPageType;
    }
    candidateInputs.push(...headerResult.titleCandidates);
  }

  const seen = new Set<string>();
  const candidates: FieldCandidate<string>[] = [];
  const allValues = candidateInputs.map((candidate) => candidate.rawValue);
  for (const input of candidateInputs) {
    const cleaned = cleanTitleCandidate(input.value, context.company ?? null, urls);
    const value = cleaned || normalizeTitleText(input.value);
    if (!value) continue;

    const key = `${input.source}:${normalizeComparable(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rejectionReason = metadataOnlyRejectionReason(value, context.company ?? null);
    if (rejectionReason) {
      rejectedFragments.push(makeRejectedCandidate({
        value,
        rawValue: input.rawValue,
        source: input.source,
        evidence: input.evidence,
        reason: rejectionReason,
      }));
      continue;
    }

    candidates.push(scoreCandidate({
      value,
      rawValue: input.rawValue,
      source: input.source,
      evidence: input.evidence,
      allValues,
      allCandidates: candidateInputs,
      urls,
      company: context.company ?? null,
    }));
  }

  const sortedCandidates = [...candidates, ...rejectedFragments]
    .sort((left, right) => right.confidence - left.confidence);
  const title = selectBestTitleCandidate(sortedCandidates);

  if (title.status === "missing") warnings.push("TITLE_MISSING");
  if (title.status === "quarantine") warnings.push("TITLE_LOW_CONFIDENCE");
  if (title.status === "rejected") warnings.push(title.rejectionReason ?? "TITLE_REJECTED");

  return {
    title,
    displayTitle,
    titleCandidates: sortedCandidates,
    rejectedFragments,
    extractedMetadata,
    jobPageType,
    warnings: [...new Set(warnings)],
  };
}

export function extractAndScoreJobTitle(
  job: Pick<SourceConnectorJob, "title" | "applyUrl" | "sourceUrl" | "metadata">,
  context: TitleContext = {}
) {
  return extractJobTitle(
    {
      ...job,
      location: context.location ?? "",
      description: context.description ?? "",
    },
    context
  ).title;
}

export function extractTitleCandidates(
  job: Pick<SourceConnectorJob, "title" | "applyUrl" | "sourceUrl" | "metadata">,
  context: TitleContext = {}
): FieldCandidate<string>[] {
  return extractJobTitle(
    {
      ...job,
      location: context.location ?? "",
      description: context.description ?? "",
    },
    context
  ).titleCandidates;
}

export function selectBestTitleCandidate(
  candidates: FieldCandidate<string>[]
): SelectedField<string> {
  const eligible = candidates.filter((candidate) => !candidate.rejected);
  if (eligible.length === 0) {
    const firstRejected = candidates[0];
    return {
      value: "",
      rawValue: firstRejected?.rawValue,
      source: firstRejected?.source ?? "fallback",
      confidence: 0,
      status: firstRejected ? "rejected" : "missing",
      reasons: [],
      penalties: firstRejected?.penalties ?? ["TITLE_MISSING"],
      rejected: Boolean(firstRejected),
      rejectionReason: firstRejected?.rejectionReason,
    };
  }

  const best = eligible.sort((left, right) => right.confidence - left.confidence)[0]!;
  return {
    ...best,
    status: statusForTitle(best),
  };
}

export function parseJobHeaderBlock(
  textOrLines: string | string[],
  context: TitleContext = {},
  rawCandidate: RawTitleCandidate = {
    rawValue: Array.isArray(textOrLines) ? textOrLines.join("\n") : textOrLines,
    source: "header_block",
    evidence: "header_block",
  }
): HeaderParseResult {
  const raw = normalizeTitleText(Array.isArray(textOrLines) ? textOrLines.join("\n") : textOrLines);
  const result: HeaderParseResult = {
    titleCandidates: [],
    rejectedFragments: [],
    extractedMetadata: {},
    warnings: [],
    jobPageType: "unknown",
  };
  if (!raw) return result;

  const marketing = recoverRoleTitleFromMarketingHeadline(raw, context) ?? recoverRoleTitleFromSeoJobTitle(raw, context);
  if (marketing) {
    result.rejectedFragments.push(makeRejectedCandidate({
      value: raw,
      rawValue: rawCandidate.rawValue,
      source: rawCandidate.source,
      evidence: rawCandidate.evidence,
      reason: marketing.reason,
    }));
    result.titleCandidates.push({
      value: marketing.title,
      rawValue: raw,
      source:
        marketing.reason === "TITLE_SEO_JOB_LANDING"
          ? "recovered_from_seo_title"
          : "recovered_from_marketing_headline",
      evidence: `${rawCandidate.evidence}:marketing_recovery`,
    });
    mergeMetadata(result.extractedMetadata, {
      location: marketing.location,
      employmentType: marketing.employmentType,
      workMode: marketing.workMode,
    });
    result.displayTitle = marketing.displayTitle;
    result.jobPageType = marketing.jobPageType;
    result.warnings.push(marketing.reason);
    return result;
  }

  const wholeRejection = metadataOnlyRejectionReason(raw, context.company ?? null);
  if (wholeRejection) {
    result.rejectedFragments.push(makeRejectedCandidate({
      value: raw,
      rawValue: rawCandidate.rawValue,
      source: rawCandidate.source,
      evidence: rawCandidate.evidence,
      reason: wholeRejection,
    }));
    const classification = classifyFragment(raw, context);
    mergeMetadata(result.extractedMetadata, classification.metadata ?? {});
    result.warnings.push(wholeRejection);
    return result;
  }

  const stripped = stripMetadataAroundTitle(raw, context);
  result.rejectedFragments.push(...stripped.rejectedFragments);
  mergeMetadata(result.extractedMetadata, stripped.extractedMetadata);
  result.warnings.push(...stripped.warnings);

  const candidateValue = stripped.title || raw;
  const candidateSource =
    candidateValue === raw && rawCandidate.source !== "header_block"
      ? rawCandidate.source
      : "recovered_from_header";
  result.titleCandidates.push({
    value: candidateValue,
    rawValue: raw,
    source: candidateSource,
    evidence: candidateValue === raw ? rawCandidate.evidence : `${rawCandidate.evidence}:header_parse`,
  });

  return result;
}

export function cleanTitleCandidate(
  raw: unknown,
  company?: string | null,
  urls: Array<string | null | undefined> = []
) {
  let value = normalizeTitleText(raw);
  if (!value) return "";

  value = value
    .replace(SALARY_FRAGMENT_RE, " ")
    .replace(TRAILING_COMPENSATION_BENEFIT_RE, " ")
    .replace(REQ_ID_SUFFIX_RE, "")
    .replace(/\s+\|\s+remote jobs?$/i, "")
    .replace(/\s+-\s+apply(?: now)?$/i, "")
    .replace(/\s+\|\s+apply(?: now)?$/i, "");
  value = compactWhitespace(stripObviousCompanyAffixes(value, company));

  const stripped = stripMetadataAroundTitle(value, { company, urls });
  if (stripped.title) value = stripped.title;

  const urlCompanies = urls.map((url) => companyFromUrl(url)).filter(Boolean);
  for (const urlCompany of urlCompanies) {
    value = stripObviousCompanyAffixes(value, urlCompany);
  }

  if (metadataOnlyRejectionReason(value, company)) return "";
  return compactWhitespace(value);
}

export function extractTitleFromUrl(value: string | null | undefined) {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const usefulSegments = parsed.pathname
    .split("/")
    .map((segment) => normalizeSlugSegment(segment))
    .filter((segment): segment is string => Boolean(segment));

  const candidates = usefulSegments
    .filter((segment) => looksLikeUsefulTitleSlug(segment))
    .map((segment) => formatSlugTitle(segment))
    .map((candidate) => cleanTitleCandidate(candidate, null, [value]))
    .filter((candidate) => candidate && hasRoleLikeToken(candidate));

  return candidates.sort((left, right) => scoreTitleShape(right) - scoreTitleShape(left))[0] ?? null;
}

export function isGenericCareerPageTitle(title: string) {
  const normalized = compactWhitespace(title);
  if (!normalized) return true;
  return PAGE_CHROME_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isLocationOnlyTitle(title: string) {
  return isGeoOnlyText(title);
}

export function looksLikeSentenceInsteadOfTitle(title: string) {
  const normalized = compactWhitespace(title);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (looksLikeMarketingFalsePositive(normalized)) return false;
  return words.length > 16 || /[.!?]$/.test(normalized) || SENTENCE_VERB_RE.test(normalized);
}

export function containsApplyChrome(title: string) {
  return APPLY_CHROME_RE.test(title);
}

export function containsSalaryFragment(title: string) {
  return SALARY_FRAGMENT_RE.test(title);
}

export function containsTooMuchLocation(title: string) {
  const normalized = compactWhitespace(title);
  if (!ROLE_LIKE_RE.test(normalized)) return false;
  const stripped = stripMetadataAroundTitle(normalized, {});
  return Boolean(stripped.title && stripped.title !== normalized && stripped.extractedMetadata.location);
}

export function hasRoleLikeToken(title: string) {
  return ROLE_LIKE_RE.test(title);
}

export function hasBadTitleToken(title: string) {
  return Boolean(metadataOnlyRejectionReason(title, null)) || containsApplyChrome(title);
}

export function isMetadataOnlyTitleFragment(text: string, context: TitleContext = {}) {
  return Boolean(metadataOnlyRejectionReason(text, context.company ?? null));
}

export function isWorkModeOnlyText(text: string) {
  const normalized = normalizeComparable(stripWrapperPunctuation(text));
  return WORK_MODE_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isGeoOnlyText(text: string) {
  const normalized = normalizeComparable(stripWrapperPunctuation(text));
  if (!normalized || hasRoleLikeToken(normalized)) return false;
  if (isWorkModeOnlyText(normalized) || isEmploymentTypeOnlyText(normalized)) return false;
  if (/^multiple locations?$/.test(normalized)) return true;

  const withoutOffice = normalized.replace(/\s+(?:office|area|region|city|metro)$/i, "");
  if (CITY_OR_REGION_TOKENS.has(withoutOffice)) return true;
  if (STATE_OR_COUNTRY_CODES.has(withoutOffice)) return true;
  if (/^[a-z .'-]+,\s*(?:[a-z]{2}|canada|united states|usa|us)$/i.test(withoutOffice)) {
    return true;
  }

  const parts = withoutOffice
    .split(/\s*(?:,|\/|\||–|—|-)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    parts.length > 0 &&
    parts.length <= 4 &&
    parts.every((part) => CITY_OR_REGION_TOKENS.has(part) || STATE_OR_COUNTRY_CODES.has(part))
  );
}

export function isWorkModeLocationText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  if (/^(?:remote|fully remote|100%\s*remote|hybrid|on[-\s]?site|onsite)\s*(?:-|,|\/)?\s*(?:in\s+)?(.+)$/i.test(normalized)) {
    const locationPart = normalized.replace(/^(?:remote|fully remote|100%\s*remote|hybrid|on[-\s]?site|onsite)\s*(?:-|,|\/)?\s*(?:in\s+)?/i, "");
    return locationPart.length > 0 && isGeoOnlyText(locationPart);
  }
  return false;
}

export function isEmploymentTypeOnlyText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  return EMPLOYMENT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isDateOnlyOrDateLabelText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  return DATE_LABEL_RE.test(normalized) || TERM_SEGMENT_RE.test(normalized);
}

export function isSectionHeadingText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  return SECTION_HEADING_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isPageChromeTitleText(text: string) {
  const normalized = stripWrapperPunctuation(text);
  return isGenericCareerPageTitle(normalized) || APPLY_CHROME_RE.test(normalized);
}

export function isJobIdOnlyText(text: string) {
  return REQ_ID_RE.test(compactWhitespace(stripWrapperPunctuation(text)));
}

export function isDepartmentOnlyText(text: string) {
  const normalized = normalizeComparable(stripWrapperPunctuation(text));
  return DEPARTMENT_ONLY.has(normalized);
}

export function isSalaryOnlyText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  return SALARY_FRAGMENT_RE.test(normalized) && normalized.replace(SALARY_FRAGMENT_RE, "").trim().length <= 4;
}

export function isCompensationBenefitOnlyText(text: string) {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  if (!COMPENSATION_BENEFIT_RE.test(normalized)) return false;

  const remainder = compactWhitespace(
    normalized
      .replace(SALARY_FRAGMENT_RE, " ")
      .replace(COMPENSATION_BENEFIT_RE, " ")
      .replace(/\b(?:up to|as much as|available|eligible|offered|included|bonus|sign[-\s]?on|signing|joining|starting|retention|relocation|performance|annual)\b/gi, " ")
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
  );

  return !remainder || !hasRoleLikeToken(remainder);
}

export function isCompanyOnlyText(text: string, company?: string | null) {
  const companyComparable = normalizeComparable(company ?? "");
  return Boolean(companyComparable && normalizeComparable(text) === companyComparable);
}

export function isMarketingRecruitingHeadline(text: string) {
  const normalized = compactWhitespace(text);
  if (looksLikeMarketingFalsePositive(normalized)) return false;
  return MARKETING_HEADLINE_RE.test(normalized);
}

export function isSeoJobLandingTitle(text: string) {
  const normalized = compactWhitespace(text);
  if (looksLikeMarketingFalsePositive(normalized)) return false;
  return SEO_JOB_TITLE_RE.test(normalized);
}

export function recoverRoleTitleFromMarketingHeadline(
  text: string,
  _context: TitleContext = {}
): MarketingRecovery | null {
  void _context;
  const normalized = compactWhitespace(text);
  if (!isMarketingRecruitingHeadline(normalized)) return null;
  const location = extractLocationFromMarketingText(normalized);

  if (/\b(?:deliver|delivering|start delivering)\b/i.test(normalized)) {
    return marketingRecovery("Delivery Driver", normalized, location, "gig_signup_page", "TITLE_MARKETING_HEADLINE");
  }
  if (/\b(?:courier)\b/i.test(normalized)) {
    return marketingRecovery("Courier", normalized, location, "gig_signup_page", "TITLE_MARKETING_HEADLINE");
  }
  if (/\b(?:driver|driving|drive with|start driving|box truck|cargo van|pickup truck|suv|car)\b/i.test(normalized)) {
    return marketingRecovery("Driver", normalized, location, "gig_signup_page", "TITLE_MARKETING_HEADLINE");
  }
  if (/\bshopper\b/i.test(normalized)) {
    return marketingRecovery("Shopper", normalized, location, "gig_signup_page", "TITLE_MARKETING_HEADLINE");
  }

  return null;
}

export function recoverRoleTitleFromSeoJobTitle(
  text: string,
  _context: TitleContext = {}
): MarketingRecovery | null {
  void _context;
  const normalized = compactWhitespace(text);
  if (!isSeoJobLandingTitle(normalized)) return null;

  const jobsMatch = normalized.match(/^(.+?)\s+jobs?\s+in\s+(.+)$/i);
  if (jobsMatch?.[1] && jobsMatch[2]) {
    const rolePhrase = compactWhitespace(jobsMatch[1]);
    const location = cleanRecoveredLocation(jobsMatch[2]);
    if (/^driver$/i.test(rolePhrase)) {
      return marketingRecovery("Driver", `Driver Jobs in ${location}`, location, "seo_category_page", "TITLE_SEO_JOB_LANDING");
    }
    if (/^moving$/i.test(rolePhrase)) {
      return marketingRecovery("Mover", `Mover Jobs in ${location}`, location, "seo_category_page", "TITLE_SEO_JOB_LANDING");
    }
    if (/^delivery$/i.test(rolePhrase)) {
      return marketingRecovery("Delivery Driver", `Delivery Driver Jobs in ${location}`, location, "seo_category_page", "TITLE_SEO_JOB_LANDING");
    }
    const candidate = titleCaseRole(rolePhrase.replace(/\bjobs?$/i, ""));
    if (hasRoleLikeToken(candidate)) {
      return marketingRecovery(candidate, `${candidate} Jobs in ${location}`, location, "seo_category_page", "TITLE_SEO_JOB_LANDING");
    }
  }

  const hiringMatch = normalized.match(/^(?:now\s+)?hiring\s+(?:in\s+)?(.+)$/i);
  if (hiringMatch?.[1]) {
    const location = cleanRecoveredLocation(hiringMatch[1]);
    return marketingRecovery("Worker", `Jobs in ${location}`, location, "seo_category_page", "TITLE_SEO_JOB_LANDING");
  }

  return null;
}

export function scoreTitleShape(title: string) {
  const normalized = compactWhitespace(title);
  if (!normalized) return 0;

  const rejectionReason = metadataOnlyRejectionReason(normalized, null);
  if (rejectionReason) return 0;

  let score = 0.45;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (normalized.length >= 4 && normalized.length <= 110) score += 0.14;
  if (wordCount >= 2 && wordCount <= 12) score += 0.12;
  if (wordCount === 1 && hasRoleLikeToken(normalized)) score += 0.04;
  if (hasRoleLikeToken(normalized)) score += 0.24;
  if (/[A-Z]/.test(normalized[0] ?? "")) score += 0.03;
  if (/\b(?:II|III|IV|Senior|Staff|Principal|Lead|Junior|Intern|Manager|Director)\b/i.test(normalized)) score += 0.04;
  if (/[,/:&+]/.test(normalized)) score += 0.03;

  if (looksLikeSentenceInsteadOfTitle(normalized)) score -= 0.25;
  if (normalized.length > 140) score -= 0.35;
  if (!hasRoleLikeToken(normalized)) score -= 0.12;

  return clamp01(score);
}

export function scoreTitleAgreement(
  candidate: FieldCandidate<string> | string,
  allCandidates: Array<FieldCandidate<string> | string>
) {
  const candidateText = typeof candidate === "string" ? candidate : candidate.value;
  const candidateTokens = meaningfulTokens(candidateText);
  if (candidateTokens.length === 0) return 0.25;

  let agreement = 0;
  for (const other of allCandidates) {
    const otherText = typeof other === "string" ? other : other.value;
    const otherClean = cleanTitleCandidate(otherText);
    if (!otherClean) continue;
    if (normalizeComparable(otherClean) === normalizeComparable(candidateText)) {
      agreement += 1;
      continue;
    }
    const overlap = overlapRatio(candidateTokens, meaningfulTokens(otherClean));
    if (overlap >= 0.85) agreement += 0.8;
    else if (overlap >= 0.55) agreement += 0.45;
  }

  return clamp01(agreement / Math.max(1, allCandidates.length));
}

function stripMetadataAroundTitle(raw: string, context: TitleContext): {
  title: string;
  rejectedFragments: FieldCandidate<string>[];
  extractedMetadata: ExtractedTitleMetadata;
  warnings: string[];
} {
  let current = compactWhitespace(raw);
  const rejectedFragments: FieldCandidate<string>[] = [];
  const extractedMetadata: ExtractedTitleMetadata = {};
  const warnings: string[] = [];

  for (let index = 0; index < 4; index += 1) {
    const wrapper = current.match(/^(.*?)\s*(?:\(([^()]+)\)|\[([^\][]+)])$/);
    const wrapperText = wrapper?.[2] ?? wrapper?.[3];
    if (!wrapper?.[1] || !wrapperText) break;
    const classification = classifyFragment(wrapperText, context);
    if (classification.kind !== "metadata") break;
    rejectedFragments.push(makeRejectedCandidate({
      value: wrapperText,
      rawValue: raw,
      source: "header_block",
      evidence: "parenthetical_metadata",
      reason: classification.reason ?? "TITLE_METADATA_FRAGMENT",
    }));
    mergeMetadata(extractedMetadata, classification.metadata ?? {});
    current = compactWhitespace(wrapper[1]);
    warnings.push(classification.reason ?? "TITLE_METADATA_FRAGMENT");
  }

  const prefixMatch = current.match(/^(.{2,80}?)\s*(?:[-–—|])\s*(.{3,160})$/u);
  if (prefixMatch?.[1] && prefixMatch[2]) {
    const prefix = compactWhitespace(prefixMatch[1]);
    const rest = compactWhitespace(prefixMatch[2]);
    const prefixClassification = classifyCompositeMetadataPrefix(prefix, context);
    if (prefixClassification.kind === "metadata" && hasRoleLikeToken(rest)) {
      rejectedFragments.push(makeRejectedCandidate({
        value: prefix,
        rawValue: raw,
        source: "header_block",
        evidence: "prefix_metadata",
        reason: prefixClassification.reason ?? "TITLE_METADATA_PREFIX",
      }));
      mergeMetadata(extractedMetadata, prefixClassification.metadata ?? {});
      current = rest;
      warnings.push(prefixClassification.reason ?? "TITLE_METADATA_PREFIX");
    }
  }

  const segments = splitHeaderSegments(current);
  if (segments.length > 1) {
    const titleSegments: string[] = [];
    for (const segment of segments) {
      const classification = classifyFragment(segment, context);
      if (classification.kind === "metadata" || classification.kind === "page_chrome" || classification.kind === "section_heading" || classification.kind === "department") {
        rejectedFragments.push(makeRejectedCandidate({
          value: segment,
          rawValue: raw,
          source: "header_block",
          evidence: "header_segment",
          reason: classification.reason ?? "TITLE_METADATA_FRAGMENT",
        }));
        mergeMetadata(extractedMetadata, classification.metadata ?? {});
        warnings.push(classification.reason ?? "TITLE_METADATA_FRAGMENT");
        continue;
      }
      titleSegments.push(segment);
    }
    if (titleSegments.length > 0) {
      current = compactWhitespace(titleSegments.join(" - "));
    }
  }

  const employmentPrefix = stripEmploymentPrefix(current);
  if (employmentPrefix.title !== current) {
    rejectedFragments.push(makeRejectedCandidate({
      value: employmentPrefix.prefix,
      rawValue: raw,
      source: "header_block",
      evidence: "employment_prefix",
      reason: "TITLE_EMPLOYMENT_TYPE_PREFIX",
    }));
    mergeMetadata(extractedMetadata, { employmentType: employmentPrefix.employmentType });
    warnings.push("TITLE_EMPLOYMENT_TYPE_PREFIX");
    current = employmentPrefix.title;
  }

  current = compactWhitespace(stripObviousCompanyAffixes(current, context.company));
  return {
    title: current,
    rejectedFragments,
    extractedMetadata,
    warnings,
  };
}

function classifyCompositeMetadataPrefix(prefix: string, context: TitleContext): FragmentClassification {
  const parts = prefix
    .split(/\s*(?:\/|,|\||–|—|-)\s*/u)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);
  if (parts.length === 0) return { kind: "unknown" };
  const metadata: ExtractedTitleMetadata = {};
  const reasons: string[] = [];
  for (const part of parts) {
    const classification = classifyFragment(part, context);
    if (classification.kind !== "metadata") return { kind: "unknown" };
    mergeMetadata(metadata, classification.metadata ?? {});
    if (classification.reason) reasons.push(classification.reason);
  }
  return {
    kind: "metadata",
    reason: reasons[0] ?? "TITLE_METADATA_PREFIX",
    metadata,
  };
}

function classifyFragment(fragment: string, context: TitleContext): FragmentClassification {
  const text = compactWhitespace(stripWrapperPunctuation(fragment));
  if (!text) return { kind: "metadata", reason: "TITLE_EMPTY_FRAGMENT" };
  if (isCompanyOnlyText(text, context.company)) return { kind: "metadata", reason: "TITLE_EQUALS_COMPANY" };
  if (isPageChromeTitleText(text)) return { kind: "page_chrome", reason: "TITLE_PAGE_CHROME" };
  if (isSectionHeadingText(text)) return { kind: "section_heading", reason: "TITLE_SECTION_HEADING" };
  if (isJobIdOnlyText(text)) return { kind: "metadata", reason: "TITLE_JOB_ID_ONLY" };
  if (isSalaryOnlyText(text)) return { kind: "metadata", reason: "TITLE_SALARY_ONLY" };
  if (isCompensationBenefitOnlyText(text)) return { kind: "metadata", reason: "TITLE_COMPENSATION_ONLY" };
  if (isDateOnlyOrDateLabelText(text)) return { kind: "metadata", reason: "TITLE_DATE_ONLY" };
  if (isWorkModeLocationText(text)) {
    return {
      kind: "metadata",
      reason: "TITLE_WORK_MODE_LOCATION_FRAGMENT",
      metadata: parseWorkModeLocationMetadata(text),
    };
  }
  if (isWorkModeOnlyText(text)) {
    return {
      kind: "metadata",
      reason: "TITLE_WORK_MODE_ONLY",
      metadata: { workMode: parseWorkModeValue(text) },
    };
  }
  if (isEmploymentTypeOnlyText(text)) {
    return {
      kind: "metadata",
      reason: "TITLE_EMPLOYMENT_TYPE_ONLY",
      metadata: { employmentType: parseEmploymentTypeValue(text) },
    };
  }
  if (isGeoOnlyText(text)) {
    return {
      kind: "metadata",
      reason: "TITLE_LOCATION_ONLY",
      metadata: { location: text },
    };
  }
  if (isDepartmentOnlyText(text)) return { kind: "department", reason: "TITLE_DEPARTMENT_ONLY" };
  if (isMarketingRecruitingHeadline(text) || isSeoJobLandingTitle(text)) return { kind: "marketing", reason: "TITLE_MARKETING_HEADLINE" };
  if (hasRoleLikeToken(text)) return { kind: "title" };
  return { kind: "unknown" };
}

function metadataOnlyRejectionReason(value: string, company?: string | null) {
  const classification = classifyFragment(value, { company });
  if (classification.kind === "metadata" || classification.kind === "page_chrome" || classification.kind === "section_heading" || classification.kind === "department" || classification.kind === "marketing") {
    return classification.reason ?? "TITLE_METADATA_FRAGMENT";
  }
  return null;
}

function splitHeaderSegments(value: string) {
  return value
    .replace(/\s*[\r\n]+\s*/g, " | ")
    .split(/\s+(?:\||•|·|–|—|-)\s+/u)
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);
}

function stripEmploymentPrefix(value: string) {
  const normalized = compactWhitespace(value);
  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /^(full[-\s]?time)\s+(.+)$/i, type: "FULL_TIME" },
    { re: /^(part[-\s]?time)\s+(.+)$/i, type: "PART_TIME" },
    { re: /^(freelance)\s+(.+)$/i, type: "FREELANCE" },
    { re: /^(seasonal)\s+(.+)$/i, type: "SEASONAL" },
    { re: /^(temporary|temp)\s+(.+)$/i, type: "TEMPORARY" },
    { re: /^(contract)\s+(.+)$/i, type: "CONTRACT" },
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern.re);
    if (!match?.[1] || !match[2]) continue;
    const rest = compactWhitespace(match[2]);
    if (!hasRoleLikeToken(rest)) continue;
    if (/^contract\s+(?:manager|specialist|administrator|negotiator|lifecycle|counsel|analyst)\b/i.test(normalized)) {
      continue;
    }
    if (/^temporary\s+works?\s+\w+/i.test(normalized)) {
      continue;
    }
    if (/^freelance\s+marketplace\b/i.test(normalized)) {
      continue;
    }
    if (/^volunteer\s+(?:coordinator|program manager|manager)$/i.test(normalized)) {
      continue;
    }
    return {
      prefix: match[1],
      title: rest,
      employmentType: pattern.type,
    };
  }
  return {
    prefix: "",
    title: normalized,
    employmentType: null,
  };
}

function scoreCandidate(input: {
  value: string;
  rawValue: string;
  source: FieldCandidateSource;
  evidence: string;
  allValues: string[];
  allCandidates: Array<{ rawValue: string; source: FieldCandidateSource; evidence: string }>;
  urls: Array<string | null | undefined>;
  company: string | null;
}): FieldCandidate<string> {
  const reasons: string[] = [];
  const penalties: string[] = [];
  const sourceScore = SOURCE_WEIGHTS[input.source] ?? 0.25;
  const shapeScore = scoreTitleShape(input.value);
  let agreementScore = scoreTitleAgreement(input.value, input.allValues);
  const nonUrlCandidates = input.allCandidates.filter((candidate) => candidate.source !== "url_slug");
  if (
    input.source !== "url_slug" &&
    nonUrlCandidates.length === 1 &&
    hasRoleLikeToken(input.value)
  ) {
    agreementScore = Math.max(agreementScore, 0.65);
  }
  const urlAgreementScore = scoreUrlAgreement(input.value, input.urls);
  const roleTokenScore = hasRoleLikeToken(input.value) ? 1 : 0;
  let penaltyScore = 0;

  if (hasRoleLikeToken(input.value)) reasons.push("role_like_token");
  if (urlAgreementScore >= 0.7) reasons.push("matches_url_slug");
  if (agreementScore >= 0.5) reasons.push("candidate_agreement");
  if (input.rawValue !== input.value) reasons.push("cleaned_from_raw");
  if (input.source === "recovered_from_marketing_headline" || input.source === "recovered_from_seo_title") {
    reasons.push("recovered_from_non_canonical_headline");
  }

  const companyComparable = normalizeComparable(input.company ?? "");
  if (companyComparable && normalizeComparable(input.value) === companyComparable) {
    penalties.push("TITLE_EQUALS_COMPANY");
    penaltyScore += 0.75;
  }
  const rejectionReason = metadataOnlyRejectionReason(input.value, input.company);
  if (rejectionReason) {
    penalties.push(rejectionReason);
    penaltyScore += 1;
  }
  if (looksLikeSentenceInsteadOfTitle(input.value)) {
    penalties.push("TITLE_SENTENCE_LIKE");
    penaltyScore += 0.25;
  }
  if (input.value.length > 140) {
    penalties.push("TITLE_TOO_LONG");
    penaltyScore += 0.35;
  }
  if (!hasRoleLikeToken(input.value)) {
    penalties.push("TITLE_NO_ROLE_TOKEN");
    penaltyScore += 0.12;
  }
  if (input.source === "url_slug" && disagreesWithStructuredTitle(input.value, input.allCandidates)) {
    penalties.push("URL_TITLE_DISAGREES_WITH_STRUCTURED_TITLE");
    penaltyScore += 0.22;
  }

  const recoveredBoost =
    input.source === "recovered_from_marketing_headline" ||
    input.source === "recovered_from_seo_title"
      ? 0.16
      : 0;
  const confidence = clamp01(
    sourceScore * 0.35 +
      shapeScore * 0.3 +
      agreementScore * 0.2 +
      urlAgreementScore * 0.1 +
      roleTokenScore * 0.05 -
      penaltyScore +
      recoveredBoost
  );

  return {
    value: input.value,
    rawValue: input.rawValue,
    source: input.source,
    confidence,
    evidence: input.evidence,
    reasons,
    penalties,
  };
}

function statusForTitle(candidate: FieldCandidate<string>): FieldStatus {
  if (!candidate.value) return "missing";
  if (candidate.rejected || candidate.rejectionReason) return "rejected";
  if (candidate.penalties.some((penalty) => penalty.startsWith("TITLE_") && penalty !== "TITLE_NO_ROLE_TOKEN")) {
    return candidate.confidence >= 0.6 ? "quarantine" : "rejected";
  }
  if (candidate.confidence >= 0.85) return "verified";
  if (candidate.confidence >= 0.75) return "confident";
  if (candidate.confidence >= 0.6) return "usable_review";
  if (candidate.confidence >= 0.3) return "quarantine";
  return "rejected";
}

function collectMetadataTitleCandidates(
  metadata: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined
) {
  const hits: Array<{ value: string; source: FieldCandidateSource; evidence: string }> = [];
  const visit = (value: unknown, path: string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase();
      const nextPath = [...path, key];
      const pathLower = nextPath.join(".").toLowerCase();
      if (typeof child === "string") {
        if (["rawtitle", "listingtitle"].includes(keyLower)) {
          hits.push({ value: child, source: "connector_raw", evidence: nextPath.join(".") });
        } else if (["heading", "h1"].includes(keyLower)) {
          hits.push({ value: child, source: "h1", evidence: nextPath.join(".") });
        } else if (["headerblock", "header_block", "headertext"].includes(keyLower)) {
          hits.push({ value: child, source: "header_block", evidence: nextPath.join(".") });
        } else if (["ogtitle", "og:title"].includes(keyLower)) {
          hits.push({ value: child, source: "og_title", evidence: nextPath.join(".") });
        } else if (["metatitle", "meta_title"].includes(keyLower)) {
          hits.push({ value: child, source: "meta_title", evidence: nextPath.join(".") });
        } else if (["pagetitle", "page_title"].includes(keyLower)) {
          hits.push({ value: child, source: "page_title", evidence: nextPath.join(".") });
        } else if (
          ["title", "jobtitle"].includes(keyLower) &&
          /(jsonld|json_ld|structured|schema|jobposting)/i.test(pathLower)
        ) {
          hits.push({ value: child, source: "json_ld", evidence: nextPath.join(".") });
        } else if (
          keyLower === "name" &&
          /(jsonld|json_ld|structured|schema|jobposting)/i.test(pathLower)
        ) {
          hits.push({ value: child, source: "json_ld", evidence: nextPath.join(".") });
        } else if (keyLower === "linktext") {
          hits.push({ value: child, source: "link_text", evidence: nextPath.join(".") });
        }
      } else if (typeof child === "object" && child !== null) {
        visit(child, nextPath);
      }
    }
  };

  visit(metadata, ["metadata"]);
  return hits;
}

function inferStructuredTitleSource(
  sourceName: string | null | undefined,
  metadata: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined
): FieldCandidateSource {
  const sourcePrefix = sourceName?.split(":")[0] ?? "";
  if (/^(OfficialCompany|FirstPartyCompany)$/i.test(sourcePrefix)) return "official_api";
  if (
    /^(Ashby|Greenhouse|Lever|Workday|Workable|SmartRecruiters|Recruitee|Teamtailor|Jobvite|iCIMS|BreezyHR|OracleCloud|SuccessFactors|Taleo|Rippling|CompanyJson)$/i.test(sourcePrefix)
  ) {
    return "ats_api";
  }
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const route = String((metadata as Record<string, unknown>).route ?? "");
    if (route === "structured") return "json_ld";
  }
  return "connector_raw";
}

function addRaw(
  list: RawTitleCandidate[],
  value: unknown,
  source: FieldCandidateSource,
  evidence: string
) {
  if (typeof value !== "string") return;
  const compacted = normalizeTitleText(value);
  if (!compacted) return;
  list.push({ rawValue: normalizeHeaderBlockText(value) || compacted, source, evidence });
}

function makeRejectedCandidate(input: {
  value: string;
  rawValue: string;
  source: FieldCandidateSource;
  evidence: string;
  reason: string;
}): FieldCandidate<string> {
  return {
    value: input.value,
    rawValue: input.rawValue,
    source: input.source,
    confidence: 0,
    evidence: input.evidence,
    reasons: [],
    penalties: [input.reason],
    rejected: true,
    rejectionReason: input.reason,
  };
}

function stripObviousCompanyAffixes(value: string, company?: string | null) {
  const companyText = compactWhitespace(company ?? "");
  if (!companyText || companyText.length < 2) return value;
  const escaped = escapeRegExp(companyText);
  return compactWhitespace(
    value
      .replace(new RegExp(`^${escaped}\\s+(?:careers?|jobs?)\\s*[-–—|:]\\s*`, "i"), "")
      .replace(new RegExp(`^${escaped}\\s*[-–—|:]\\s*`, "i"), "")
      .replace(new RegExp(`\\s*[-–—|:]\\s*${escaped}\\s+(?:careers?|jobs?)$`, "i"), "")
      .replace(new RegExp(`\\s*[-–—|:]\\s*${escaped}$`, "i"), "")
      .replace(new RegExp(`\\s+at\\s+${escaped}$`, "i"), "")
  );
}

function parseWorkModeLocationMetadata(text: string): ExtractedTitleMetadata {
  const normalized = compactWhitespace(stripWrapperPunctuation(text));
  const workMode = parseWorkModeValue(normalized);
  const location = cleanRecoveredLocation(
    normalized.replace(/^(?:remote|fully remote|100%\s*remote|hybrid|on[-\s]?site|onsite)\s*(?:-|,|\/)?\s*(?:in\s+)?/i, "")
  );
  return { workMode, location };
}

function parseWorkModeValue(text: string) {
  if (/hybrid/i.test(text)) return "HYBRID";
  if (/on[-\s]?site|onsite|in[-\s]?office|office[-\s]?based/i.test(text)) return "ONSITE";
  if (/flexible/i.test(text)) return "FLEXIBLE";
  if (/remote/i.test(text)) return "REMOTE";
  return null;
}

function parseEmploymentTypeValue(text: string) {
  const normalized = normalizeComparable(text);
  if (/full[-\s]?time/.test(normalized)) return "FULL_TIME";
  if (/part[-\s]?time/.test(normalized)) return "PART_TIME";
  if (/co[-\s]?op|coop/.test(normalized)) return "CO_OP";
  if (/intern/.test(normalized)) return "INTERNSHIP";
  if (/apprentice/.test(normalized)) return "APPRENTICESHIP";
  if (/seasonal/.test(normalized)) return "SEASONAL";
  if (/freelance/.test(normalized)) return "FREELANCE";
  if (/volunteer/.test(normalized)) return "VOLUNTEER";
  if (/temporary|temp|fixed[-\s]?term/.test(normalized)) return "TEMPORARY";
  if (/contract|contractor/.test(normalized)) return "CONTRACT";
  return null;
}

function marketingRecovery(
  title: string,
  rawDisplay: string,
  location: string | null,
  jobPageType: TitlePageType,
  reason: string
): MarketingRecovery {
  const displayTitle = location ? `${title} Jobs in ${location}` : rawDisplay;
  return {
    title,
    displayTitle,
    location,
    employmentType: jobPageType === "gig_signup_page" ? "FREELANCE" : null,
    workMode: jobPageType === "gig_signup_page" ? "ONSITE" : null,
    jobPageType,
    reason,
  };
}

function extractLocationFromMarketingText(text: string) {
  const inMatch = text.match(/\bin\s+([A-Z][A-Za-zÀ-ÿ .'-]+(?:,\s*[A-Z]{2})?)(?:$|[.!?]| - )/);
  if (inMatch?.[1]) return cleanRecoveredLocation(inMatch[1]);
  return null;
}

function cleanRecoveredLocation(value: string) {
  return compactWhitespace(value)
    .replace(/\s+(?:today|now|near you|with us).*$/i, "")
    .replace(/\s+jobs?$/i, "");
}

function titleCaseRole(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const forced = FORCED_CASE.get(part.toLowerCase());
      return forced ?? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function looksLikeMarketingFalsePositive(value: string) {
  return /\b(?:earned value analyst|revenue operations manager|money movement product manager|delivery operations manager|driver manager|truck mechanic|fleet operations manager|growth marketing manager|payments risk analyst)\b/i.test(value);
}

function normalizeSlugSegment(segment: string) {
  const decoded = safeDecodeURIComponent(segment)
    .replace(/\.[a-z0-9]{2,6}$/i, "")
    .replace(/[_+]+/g, "-")
    .trim();
  if (!decoded) return null;
  const normalized = decoded.toLowerCase();
  if (URL_PATH_IGNORED_SEGMENTS.has(normalized)) return null;
  if (/^[a-f0-9]{8,}$/i.test(decoded)) return null;
  if (/^[a-f0-9-]{24,}$/i.test(decoded)) return null;
  if (/^\d+$/i.test(decoded)) return null;
  return decoded;
}

function looksLikeUsefulTitleSlug(segment: string) {
  const cleaned = stripTrailingSlugLocationWords(
    segment
      .split(/[-\s]+/)
      .filter((part) => !isIdentifierToken(part))
      .join(" ")
  );
  if (!cleaned || URL_PATH_IGNORED_SEGMENTS.has(cleaned.toLowerCase())) return false;
  if (metadataOnlyRejectionReason(cleaned, null)) return false;
  return ROLE_LIKE_RE.test(cleaned) || cleaned.split(/\s+/).length >= 3;
}

function formatSlugTitle(segment: string) {
  const withoutLocations = stripTrailingSlugLocationWords(segment);
  return withoutLocations
    .split(/[-\s]+/)
    .filter((part) => !isIdentifierToken(part))
    .map((part) => {
      const normalized = part.toLowerCase();
      const forced = FORCED_CASE.get(normalized);
      if (forced) return forced;
      if (/^(ii|iii|iv|vi|vii)$/i.test(part)) return part.toUpperCase();
      if (["and", "or", "of", "for", "with", "to", "in"].includes(normalized)) return normalized;
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

function stripTrailingSlugLocationWords(segment: string) {
  let parts = segment.split(/[-\s]+/).filter(Boolean);
  for (let index = 0; index < 3 && parts.length > 1; index += 1) {
    const last = parts[parts.length - 1]!.toLowerCase();
    const lastTwo = parts.slice(-2).join(" ").toLowerCase();
    if (CITY_OR_REGION_TOKENS.has(lastTwo)) {
      parts = parts.slice(0, -2);
      continue;
    }
    if (CITY_OR_REGION_TOKENS.has(last) || STATE_OR_COUNTRY_CODES.has(last)) {
      parts = parts.slice(0, -1);
      continue;
    }
    break;
  }
  return parts.join("-");
}

function isIdentifierToken(value: string) {
  return (
    /^\d{3,}$/.test(value) ||
    /^jr$/i.test(value) ||
    /^(?=.*\d)[a-f0-9]{4,}$/i.test(value) ||
    /^[a-z]{1,4}\d{2,}$/i.test(value) ||
    /^gh_jid$/i.test(value)
  );
}

function scoreUrlAgreement(title: string, urls: Array<string | null | undefined>) {
  const urlTitles = urls.map(extractTitleFromUrl).filter((value): value is string => Boolean(value));
  if (urlTitles.length === 0) return 0.35;
  return Math.max(...urlTitles.map((urlTitle) => overlapRatio(meaningfulTokens(title), meaningfulTokens(urlTitle))));
}

function disagreesWithStructuredTitle(
  title: string,
  candidates: Array<{ rawValue: string; source: FieldCandidateSource }>
) {
  const titleTokens = meaningfulTokens(title);
  if (titleTokens.length === 0) return false;
  return candidates.some((candidate) => {
    if (candidate.source === "url_slug" || candidate.source === "fallback") return false;
    const cleaned = cleanTitleCandidate(candidate.rawValue);
    if (!cleaned || !hasRoleLikeToken(cleaned) || isGenericCareerPageTitle(cleaned)) return false;
    return overlapRatio(titleTokens, meaningfulTokens(cleaned)) < 0.55;
  });
}

function meaningfulTokens(value: string) {
  return normalizeComparable(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !["and", "or", "the", "for", "with", "at", "in", "to", "of"].includes(token));
}

function overlapRatio(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function companyFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "");
    const [first] = host.split(".");
    return first || null;
  } catch {
    return null;
  }
}

function mergeMetadata(target: ExtractedTitleMetadata, source: ExtractedTitleMetadata) {
  if (!target.workMode && source.workMode) target.workMode = source.workMode;
  if (!target.location && source.location) target.location = source.location;
  if (!target.employmentType && source.employmentType) target.employmentType = source.employmentType;
}

function normalizeTitleText(value: unknown) {
  return compactWhitespace(
    decodeHtmlEntitiesFull(String(value ?? ""))
      .replace(/<[^>]+>/g, " ")
      .replace(/[®™]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s*[∙●]\s*/g, " • ")
      .replace(/\s+/g, " ")
  );
}

function normalizeHeaderBlockText(value: unknown) {
  return compactWhitespace(
    decodeHtmlEntitiesFull(String(value ?? ""))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[®™]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s*[∙●]\s*/g, " • ")
      .replace(/\s*[\r\n]+\s*/g, " | ")
      .replace(/[ \t\f\v]+/g, " ")
  );
}

function stripWrapperPunctuation(value: string) {
  return compactWhitespace(value.replace(/^[()[\]{}"'`]+|[()[\]{}"'`.,;:]+$/g, ""));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeComparable(value: string) {
  return compactWhitespace(value).toLowerCase().replace(/[®™]/g, "");
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}
