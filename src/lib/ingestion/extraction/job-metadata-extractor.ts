import type { EmploymentType, Prisma, WorkMode } from "@/generated/prisma/client";
import type { NormalizedEmploymentType } from "@/lib/job-metadata";
import type {
  EmploymentTypeGroup,
  FieldCandidate,
  FieldCandidateSource,
  FieldStatus,
  JobDateExtraction,
  JobMetadataExtractionResult,
  SelectedField,
} from "@/lib/ingestion/extraction/types";
import type { SourceConnectorJob } from "@/lib/ingestion/types";

type MetadataExtractionContext = {
  company?: string | null;
  title: string;
  location: string;
  description: string;
  urls?: Array<string | null | undefined>;
  fetchedAt: Date;
  sourceName?: string | null;
  metadata?: Prisma.InputJsonValue | Prisma.JsonValue | null;
};

type MetadataHit = {
  keyPath: string;
  value: unknown;
};

const WORK_MODE_SOURCE_WEIGHTS: Partial<Record<FieldCandidateSource, number>> = {
  official_api: 0.98,
  ats_api: 0.95,
  json_ld: 0.92,
  connector_raw: 0.78,
  structured_location: 0.78,
  ats_location: 0.82,
  html_location: 0.6,
  remote_text: 0.58,
  detail_html: 0.58,
  description_text: 0.54,
  url: 0.25,
  url_slug: 0.25,
  h1: 0.35,
  meta_title: 0.3,
  og_title: 0.3,
  link_text: 0.35,
  body_text: 0.35,
  metadata: 0.7,
  fallback: 0.2,
};

const EMPLOYMENT_SOURCE_WEIGHTS: Partial<Record<FieldCandidateSource, number>> = {
  official_api: 0.98,
  ats_api: 0.95,
  json_ld: 0.92,
  connector_raw: 0.8,
  metadata: 0.72,
  h1: 0.55,
  meta_title: 0.5,
  og_title: 0.5,
  link_text: 0.5,
  detail_html: 0.55,
  description_text: 0.42,
  body_text: 0.35,
  url: 0.25,
  url_slug: 0.25,
  structured_location: 0.25,
  ats_location: 0.25,
  html_location: 0.25,
  remote_text: 0.25,
  fallback: 0.2,
};

const DATE_SOURCE_WEIGHTS: Record<string, number> = {
  official_api: 0.98,
  ats_api: 0.95,
  json_ld: 0.92,
  connector_raw: 0.85,
  metadata: 0.72,
  detail_html: 0.62,
  description_text: 0.52,
  fallback: 0.25,
  none: 0,
};

const ATS_SOURCE_RE =
  /^(Ashby|BreezyHR|Greenhouse|Hireology|Jobvite|Lever|OracleCloud|Recruitee|Rippling|SmartRecruiters|SuccessFactors|Taleo|Teamtailor|Workable|Workday|iCIMS):?/i;
const OFFICIAL_SOURCE_RE = /^(OfficialCompany|FirstPartyCompany):?/i;

const REMOTE_RE =
  /\b(?:fully\s+remote|100%\s+remote|remote(?:ly)?|work\s+from\s+home|virtual|distributed|anywhere)\b/i;
const HYBRID_RE =
  /\b(?:hybrid|partially\s+remote|office\s+days?|days?\s+(?:in|at)\s+(?:the\s+)?office|days?\s+onsite|split\s+between\s+home\s+and\s+office|in[-\s]?office\s+and\s+remote)\b/i;
const ONSITE_RE =
  /\b(?:on[-\s]?site|onsite|on\s+site|in[-\s]?office|office[-\s]?based|must\s+work\s+from\s+(?:the\s+)?office|warehouse|store\s+location|plant\s+location|field\s+location|clinic\s+location|school\s+location|hospital\s+location)\b/i;
const FLEXIBLE_RE =
  /\b(?:remote\s+or\s+hybrid|hybrid\s+or\s+remote|flexible\s+work|flexible\s+work\s+arrangements?|multiple\s+work\s+arrangements?|work\s+mode\s+varies|location\s+flexible)\b/i;
const NEGATIVE_REMOTE_RE =
  /\b(?:no|not|non)[-\s]?remote\b|\bremote\s+work\s+(?:is\s+)?not\s+available\b|\bnot\s+available\s+for\s+remote\b|\bonsite\s+only\b|\bon[-\s]?site\s+only\b/i;

const MONTH_NAMES =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_TOKEN_RE = new RegExp(
  `(?:\\d{4}-\\d{1,2}-\\d{1,2}|(?:${MONTH_NAMES})\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:${MONTH_NAMES})\\s+\\d{4}|(?:${MONTH_NAMES})\\s+\\d{1,2}|today|yesterday|\\d+\\+?\\s+days?\\s+ago|recently\\s+posted)`,
  "i"
);

const POSTED_LABEL_RE =
  /\b(?:date\s+posted|posted(?:\s+on)?|published(?:\s+on)?|opened(?:\s+on)?|created(?:\s+on)?)\b\s*:?\s*(.{0,80})/gi;
const DEADLINE_LABEL_RE =
  /\b(?:application\s+deadline|deadline\s+to\s+apply|apply\s+by|apply\s+before|closing\s+date|applications?\s+close(?:s|d)?(?:\s+on)?|posting\s+closes?|job\s+closes?|requisition\s+closes?|valid\s+through|accepting\s+applications\s+until)\b\s*:?\s*(.{0,90})/gi;

const METADATA_WORK_KEYS =
  /(workplace|work_mode|workmode|workArrangement|workLocation|jobLocationType|applicantLocationRequirements|remote|isRemote|locationType)/i;
const METADATA_EMPLOYMENT_KEYS =
  /(employmentType|jobEmploymentType|typeOfEmployment|commitment|schedule|employment|positionType|jobType|workType|contractType)/i;
const METADATA_POSTED_KEYS =
  /(datePosted|postedAt|postedDate|publishedAt|publishedDate|first_published|firstPublished|releasedDate|created_at|createdAt|publicationStartDate|PublicationStartDate)/i;
const METADATA_DEADLINE_KEYS =
  /(validThrough|closingDate|closeDate|applicationDeadline|deadline|ApplicationCloseDate|postingCloses|closing_at|closingAt)/i;

export const ENABLE_METADATA_CANDIDATE_EXTRACTION =
  process.env.ENABLE_METADATA_CANDIDATE_EXTRACTION !== "false";
export const MIN_METADATA_FILTER_CONFIDENCE = Number(
  process.env.MIN_METADATA_FILTER_CONFIDENCE ?? "0.60"
);

export function extractJobMetadata(
  job: SourceConnectorJob,
  context: MetadataExtractionContext
): JobMetadataExtractionResult {
  const metadata = context.metadata ?? job.metadata;
  const sourceName = context.sourceName ?? null;
  const workModeCandidates = extractWorkModeCandidates(job, {
    ...context,
    metadata,
    sourceName,
  });
  const employmentTypeCandidates = extractEmploymentTypeCandidates(job, {
    ...context,
    metadata,
    sourceName,
  });
  const workMode = selectWorkModeCandidate(workModeCandidates);
  const employmentType = selectEmploymentTypeCandidate(employmentTypeCandidates);
  const datePosted = extractPostedDate(job, { ...context, metadata, sourceName });
  const applicationDeadline = extractApplicationDeadline(job, {
    ...context,
    metadata,
    sourceName,
    datePosted: datePosted.value,
  });
  const warnings: string[] = [];

  if (workMode.status === "quarantine") warnings.push("WORK_MODE_LOW_CONFIDENCE");
  if (workMode.status === "missing") warnings.push("WORK_MODE_UNKNOWN");
  if (employmentType.status === "quarantine") warnings.push("EMPLOYMENT_TYPE_LOW_CONFIDENCE");
  if (employmentType.status === "missing") warnings.push("EMPLOYMENT_TYPE_UNKNOWN");
  if (datePosted.status === "missing" || datePosted.status === "ambiguous") {
    warnings.push(`DATE_POSTED_${datePosted.status.toUpperCase()}`);
  }
  if (applicationDeadline.status === "invalid") warnings.push("DEADLINE_INVALID");
  if (
    datePosted.value &&
    applicationDeadline.value &&
    applicationDeadline.value.getTime() < datePosted.value.getTime()
  ) {
    warnings.push("DEADLINE_BEFORE_POSTED_DATE");
  }

  return {
    workMode,
    workModeCandidates,
    employmentType,
    employmentTypeGroup: employmentTypeToGroup(employmentType.value),
    employmentTypeCandidates,
    datePosted,
    applicationDeadline,
    warnings: [...new Set(warnings)],
  };
}

export function extractWorkModeCandidates(
  job: SourceConnectorJob,
  context: MetadataExtractionContext
): FieldCandidate<WorkMode>[] {
  const candidates: FieldCandidate<WorkMode>[] = [];
  const structuredSource = inferStructuredSource(context.sourceName);

  addWorkModeCandidate(candidates, job.workMode, structuredSource, "job.workMode", 0.95);
  addWorkModeCandidate(candidates, job.location, "structured_location", "job.location", 0.74);

  for (const hit of collectMetadataHits(context.metadata, METADATA_WORK_KEYS)) {
    addWorkModeCandidate(
      candidates,
      stringifyMetadataValue(hit.value),
      sourceForMetadataHit(hit, context.sourceName),
      `metadata:${hit.keyPath}`,
      0.86
    );
  }

  addWorkModeCandidate(candidates, context.title, "h1", "title text", 0.42);
  addWorkModeCandidate(candidates, context.description, "description_text", "description text", 0.65);
  for (const url of context.urls ?? [job.applyUrl, job.sourceUrl]) {
    addWorkModeCandidate(candidates, url, "url", `url:${url}`, 0.28);
  }

  return withAgreementPenalty(dedupeCandidates(candidates), "UNKNOWN");
}

export function extractEmploymentTypeCandidates(
  job: SourceConnectorJob,
  context: MetadataExtractionContext
): FieldCandidate<NormalizedEmploymentType>[] {
  const candidates: FieldCandidate<NormalizedEmploymentType>[] = [];
  const structuredSource = inferStructuredSource(context.sourceName);

  addEmploymentCandidate(
    candidates,
    job.employmentType,
    structuredSource,
    "job.employmentType",
    "structured"
  );

  for (const hit of collectMetadataHits(context.metadata, METADATA_EMPLOYMENT_KEYS)) {
    addEmploymentCandidate(
      candidates,
      stringifyMetadataValue(hit.value),
      sourceForMetadataHit(hit, context.sourceName),
      `metadata:${hit.keyPath}`,
      "structured"
    );
  }

  addEmploymentCandidate(candidates, context.title, "h1", "title text", "title");
  addEmploymentCandidate(candidates, context.description, "description_text", "description text", "description");
  for (const url of context.urls ?? [job.applyUrl, job.sourceUrl]) {
    addEmploymentCandidate(candidates, url, "url", `url:${url}`, "url");
  }

  return withAgreementPenalty(dedupeCandidates(candidates), "UNKNOWN");
}

export function selectWorkModeCandidate(
  candidates: FieldCandidate<WorkMode>[]
): SelectedField<WorkMode> {
  if (candidates.length === 0) {
    return {
      value: "UNKNOWN",
      source: "fallback",
      confidence: 0.2,
      status: "missing",
      reasons: ["no_reliable_work_mode_signal"],
      penalties: [],
    };
  }
  const best = [...candidates].sort((left, right) => right.confidence - left.confidence)[0]!;
  return { ...best, status: fieldStatusForConfidence(best.confidence, best.value === "UNKNOWN") };
}

export function selectEmploymentTypeCandidate(
  candidates: FieldCandidate<NormalizedEmploymentType>[]
): SelectedField<NormalizedEmploymentType> {
  if (candidates.length === 0) {
    return {
      value: "UNKNOWN",
      source: "fallback",
      confidence: 0.2,
      status: "missing",
      reasons: ["no_reliable_employment_type_signal"],
      penalties: [],
    };
  }
  const best = [...candidates].sort((left, right) => right.confidence - left.confidence)[0]!;
  return { ...best, status: fieldStatusForConfidence(best.confidence, best.value === "UNKNOWN") };
}

export function employmentTypeToGroup(value: NormalizedEmploymentType): EmploymentTypeGroup {
  switch (value) {
    case "FULL_TIME":
      return "FULL_TIME";
    case "PART_TIME":
      return "PART_TIME";
    case "CONTRACT":
      return "CONTRACT";
    case "INTERNSHIP":
    case "CO_OP":
    case "APPRENTICESHIP":
      return "INTERNSHIP_COOP";
    case "TEMPORARY":
    case "SEASONAL":
      return "TEMPORARY_SEASONAL";
    case "FREELANCE":
      return "FREELANCE";
    case "VOLUNTEER":
      return "VOLUNTEER";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return "OTHER";
  }
}

export function mapNormalizedEmploymentTypeToLegacy(
  value: NormalizedEmploymentType
): EmploymentType {
  switch (value) {
    case "FULL_TIME":
      return "FULL_TIME";
    case "PART_TIME":
      return "PART_TIME";
    case "CONTRACT":
    case "TEMPORARY":
    case "SEASONAL":
    case "FREELANCE":
      return "CONTRACT";
    case "INTERNSHIP":
    case "CO_OP":
    case "APPRENTICESHIP":
      return "INTERNSHIP";
    default:
      return "UNKNOWN";
  }
}

function addWorkModeCandidate(
  candidates: FieldCandidate<WorkMode>[],
  raw: unknown,
  source: FieldCandidateSource,
  evidence: string,
  sourceConfidenceHint: number
) {
  const parsed = parseWorkModeSignal(raw);
  if (!parsed) return;
  const sourceScore = WORK_MODE_SOURCE_WEIGHTS[source] ?? 0.25;
  const confidence = clamp01(sourceScore * 0.62 + parsed.signalStrength * 0.28 + sourceConfidenceHint * 0.1 - parsed.penalty);
  candidates.push({
    value: parsed.value,
    rawValue: stringifyMetadataValue(raw),
    source,
    evidence,
    confidence,
    reasons: parsed.reasons,
    penalties: parsed.penalties,
  });
}

function parseWorkModeSignal(raw: unknown) {
  const text = normalizeText(stringifyMetadataValue(raw));
  if (!text) return null;
  const canonical = text.toUpperCase().replace(/[\s-]+/g, "_");

  if (canonical === "REMOTE") {
    return signal("REMOTE" as WorkMode, 0.98, ["structured_remote"]);
  }
  if (canonical === "HYBRID") {
    return signal("HYBRID" as WorkMode, 0.98, ["structured_hybrid"]);
  }
  if (canonical === "ONSITE" || canonical === "ON_SITE") {
    return signal("ONSITE" as WorkMode, 0.98, ["structured_onsite"]);
  }
  if (canonical === "FLEXIBLE") {
    return signal("FLEXIBLE" as WorkMode, 0.92, ["structured_flexible"]);
  }
  if (NEGATIVE_REMOTE_RE.test(text) && !HYBRID_RE.test(text)) {
    if (ONSITE_RE.test(text)) {
      return signal("ONSITE" as WorkMode, 0.78, ["negative_remote_with_onsite_signal"]);
    }
    return signal(
      "UNKNOWN" as WorkMode,
      0.5,
      ["remote_negated_without_work_mode"],
      ["remote_negated"]
    );
  }
  if (FLEXIBLE_RE.test(text)) {
    return signal("FLEXIBLE" as WorkMode, 0.78, ["flexible_or_remote_hybrid_signal"]);
  }
  if (HYBRID_RE.test(text)) {
    return signal("HYBRID" as WorkMode, 0.86, ["hybrid_signal"]);
  }
  if (REMOTE_RE.test(text)) {
    return signal("REMOTE" as WorkMode, 0.82, ["remote_signal"]);
  }
  if (ONSITE_RE.test(text)) {
    return signal("ONSITE" as WorkMode, 0.74, ["onsite_signal"]);
  }

  return null;
}

function addEmploymentCandidate(
  candidates: FieldCandidate<NormalizedEmploymentType>[],
  raw: unknown,
  source: FieldCandidateSource,
  evidence: string,
  context: "structured" | "title" | "description" | "url"
) {
  const parsed = parseEmploymentTypeSignal(raw, context);
  if (!parsed) return;
  const sourceScore = EMPLOYMENT_SOURCE_WEIGHTS[source] ?? 0.25;
  const contextWeight =
    context === "structured" ? 0.98 : context === "title" ? 0.74 : context === "description" ? 0.52 : 0.28;
  const confidence = clamp01(sourceScore * 0.58 + parsed.signalStrength * 0.3 + contextWeight * 0.12 - parsed.penalty);
  candidates.push({
    value: parsed.value,
    rawValue: stringifyMetadataValue(raw),
    source,
    evidence,
    confidence,
    reasons: parsed.reasons,
    penalties: parsed.penalties,
  });
}

function parseEmploymentTypeSignal(raw: unknown, context: "structured" | "title" | "description" | "url") {
  const text = normalizeText(stringifyMetadataValue(raw));
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9+]+/gi, "").toLowerCase();

  if (context === "structured") {
    if (/^(fulltime|full_time|permanentfulltime|regularfulltime|regular)$/.test(compact)) {
      return employmentSignal("FULL_TIME", 0.98, ["structured_full_time"]);
    }
    if (/^(parttime|part_time)$/.test(compact)) {
      return employmentSignal("PART_TIME", 0.98, ["structured_part_time"]);
    }
    if (/^(contract|contractor|fixedtermcontract|independentcontractor)$/.test(compact)) {
      return employmentSignal("CONTRACT", 0.96, ["structured_contract"]);
    }
    if (/^(intern|internship|studentintern)$/.test(compact)) {
      return employmentSignal("INTERNSHIP", 0.96, ["structured_internship"]);
    }
    if (/^(coop|co_op|cooperativeeducation|workterm)$/.test(compact)) {
      return employmentSignal("CO_OP", 0.96, ["structured_coop"]);
    }
  }

  if (/\bco[-\s]?op\b|\bcooperative education\b|\bwork term\b/i.test(text)) {
    return employmentSignal("CO_OP", context === "title" ? 0.94 : 0.76, ["coop_context"]);
  }
  if (/\b(?:software engineering |data |student |summer )?intern(?:ship)?\b/i.test(text)) {
    return employmentSignal("INTERNSHIP", context === "title" ? 0.92 : 0.7, ["internship_context"]);
  }
  if (/\bapprentice(?:ship)?\b/i.test(text)) {
    return employmentSignal("APPRENTICESHIP", context === "title" ? 0.88 : 0.7, ["apprenticeship_context"]);
  }
  if (/\bpart[-\s]?time\b/i.test(text)) {
    return employmentSignal("PART_TIME", context === "title" ? 0.9 : 0.72, ["part_time_context"]);
  }
  if (/\bfull[-\s]?time\b|\bpermanent full[-\s]?time\b|\bregular full[-\s]?time\b/i.test(text)) {
    return employmentSignal("FULL_TIME", context === "title" ? 0.82 : 0.7, ["full_time_context"]);
  }
  if (/\bfreelance(?:r)?\b/i.test(text)) {
    return employmentSignal("FREELANCE", context === "title" ? 0.86 : 0.68, ["freelance_context"]);
  }
  if (/\bseasonal\b/i.test(text)) {
    return employmentSignal("SEASONAL", context === "title" ? 0.86 : 0.68, ["seasonal_context"]);
  }
  if (/\btemporary\b|\btemp\b|\bfixed[-\s]?term\b|\blimited[-\s]?term\b/i.test(text)) {
    return employmentSignal("TEMPORARY", context === "title" ? 0.84 : 0.68, ["temporary_context"]);
  }
  if (isContractEmploymentSignal(text, context)) {
    return employmentSignal("CONTRACT", context === "title" ? 0.88 : 0.7, ["contract_employment_context"]);
  }
  if (/\bvolunteer\b/i.test(text)) {
    const strong = /\b(unpaid volunteer|volunteer role|volunteer position|volunteer opportunity)\b/i.test(text);
    return employmentSignal(
      "VOLUNTEER",
      strong ? 0.8 : 0.38,
      [strong ? "volunteer_role_context" : "ambiguous_volunteer_title"],
      strong ? [] : ["volunteer_may_be_role_function"]
    );
  }

  return null;
}

function isContractEmploymentSignal(text: string, context: string) {
  if (
    /\bcontract\s+(?:manager|specialist|analyst|administrator|coordinator|lifecycle|management|negotiat|compliance|counsel)\b/i.test(
      text
    ) ||
    /\bcontract lifecycle management\b/i.test(text)
  ) {
    return false;
  }

  if (context === "title") {
    return /(?:[-–—(,]\s*(?:\d+\s*(?:month|mo|year|yr)s?\s+)?contract(?:or)?\)?$)|\b\d+\s*(?:month|mo|year|yr)s?\s+contract\b|\bcontract[-\s]?to[-\s]?hire\b|\bindependent contractor\b|\bcontractor\b|\bcontract\s+(?:role|position|job|opportunity)\b/i.test(
      text
    );
  }

  return /\b(?:employment type|job type|position type|schedule|type)\s*:?\s*(?:\d+\s*(?:month|mo|year|yr)s?\s+)?contract\b|\bthis is (?:a|an) contract (?:role|position|job)\b|\bindependent contractor\b|\bcontract[-\s]?to[-\s]?hire\b/i.test(
    text
  );
}

function extractPostedDate(job: SourceConnectorJob, context: MetadataExtractionContext) {
  const candidates: JobDateExtraction[] = [];
  addDateCandidate(candidates, job.postedAt, inferStructuredDateSource(context.sourceName), "job.postedAt", context.fetchedAt, "posted");

  for (const hit of collectMetadataHits(context.metadata, METADATA_POSTED_KEYS)) {
    addDateCandidate(
      candidates,
      hit.value,
      sourceForDateMetadataHit(hit, context.sourceName),
      `metadata:${hit.keyPath}`,
      context.fetchedAt,
      "posted"
    );
  }
  for (const raw of extractDateLabelMatches(context.description, POSTED_LABEL_RE)) {
    addDateCandidate(candidates, raw, "description_text", `description:${raw}`, context.fetchedAt, "posted");
  }
  if (/\brecently\s+posted\b/i.test(context.description)) {
    addDateCandidate(
      candidates,
      "Recently posted",
      "description_text",
      "description:recently posted",
      context.fetchedAt,
      "posted"
    );
  }

  return selectDateCandidate(candidates, {
    fallbackDate: context.fetchedAt,
    fallbackRaw: "ingestion observed time",
    field: "posted",
  });
}

function extractApplicationDeadline(
  job: SourceConnectorJob,
  context: MetadataExtractionContext & { datePosted?: Date | null }
) {
  const candidates: JobDateExtraction[] = [];
  addDateCandidate(candidates, job.deadline, inferStructuredDateSource(context.sourceName), "job.deadline", context.fetchedAt, "deadline");

  for (const hit of collectMetadataHits(context.metadata, METADATA_DEADLINE_KEYS)) {
    addDateCandidate(
      candidates,
      hit.value,
      sourceForDateMetadataHit(hit, context.sourceName),
      `metadata:${hit.keyPath}`,
      context.fetchedAt,
      "deadline"
    );
  }
  for (const raw of extractDateLabelMatches(context.description, DEADLINE_LABEL_RE)) {
    addDateCandidate(candidates, raw, "description_text", `description:${raw}`, context.fetchedAt, "deadline");
  }

  const selected = selectDateCandidate(candidates, { field: "deadline" });
  if (
    selected.value &&
    context.datePosted &&
    selected.value.getTime() < context.datePosted.getTime()
  ) {
    return {
      ...selected,
      status: selected.confidence >= 0.9 ? "ambiguous" : "invalid",
      penalties: [...selected.penalties, "deadline_before_posted_date"],
      confidence: Math.min(selected.confidence, 0.55),
    } satisfies JobDateExtraction;
  }
  return selected;
}

function addDateCandidate(
  candidates: JobDateExtraction[],
  raw: unknown,
  source: JobDateExtraction["source"],
  evidence: string,
  anchor: Date,
  field: "posted" | "deadline"
) {
  const parsed = parseJobDate(raw, anchor, field);
  if (!parsed) return;
  const sourceScore = DATE_SOURCE_WEIGHTS[source] ?? 0.35;
  const confidence = clamp01(sourceScore * 0.72 + parsed.signalStrength * 0.28 - parsed.penalty);
  const status = dateStatusForConfidence(confidence, parsed.value, parsed.invalid, parsed.ambiguous);
  candidates.push({
    value: parsed.value,
    rawValue: parsed.rawValue,
    source,
    confidence,
    status,
    evidence,
    reasons: parsed.reasons,
    penalties: parsed.penalties,
  });
}

function parseJobDate(raw: unknown, anchor: Date, field: "posted" | "deadline") {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return validateDate(raw, stringifyMetadataValue(raw), 0.98, ["structured_date"], [], anchor, field);
  }

  const text = stringifyMetadataValue(raw);
  if (!text) return null;
  const token = DATE_TOKEN_RE.exec(text)?.[0] ?? text;
  const normalized = token.trim();

  if (/recently\s+posted/i.test(normalized)) {
    return {
      value: null,
      rawValue: normalized,
      signalStrength: 0.3,
      invalid: false,
      ambiguous: true,
      reasons: ["vague_recently_posted"],
      penalties: ["no_exact_date"],
      penalty: 0.2,
    };
  }

  if (/^today$/i.test(normalized)) {
    return validateDate(startOfUtcDay(anchor), normalized, 0.72, ["relative_today"], [], anchor, field);
  }
  if (/^yesterday$/i.test(normalized)) {
    return validateDate(addDays(startOfUtcDay(anchor), -1), normalized, 0.72, ["relative_yesterday"], [], anchor, field);
  }
  const daysAgo = /^(\d+)(\+?)\s+days?\s+ago$/i.exec(normalized);
  if (daysAgo) {
    const days = Number(daysAgo[1]);
    const approximate = Boolean(daysAgo[2]);
    return validateDate(
      addDays(startOfUtcDay(anchor), -days),
      normalized,
      approximate ? 0.45 : 0.7,
      [approximate ? "relative_days_ago_approximate" : "relative_days_ago"],
      approximate ? ["approximate_relative_date"] : [],
      anchor,
      field,
      approximate
    );
  }

  const date = parseAbsoluteDate(normalized, anchor);
  if (!date) return null;
  return validateDate(date, normalized, 0.86, ["absolute_date"], [], anchor, field);
}

function validateDate(
  value: Date,
  rawValue: string,
  signalStrength: number,
  reasons: string[],
  penalties: string[],
  anchor: Date,
  field: "posted" | "deadline",
  ambiguous = false
) {
  const nextPenalties = [...penalties];
  let invalid = false;
  let penalty = 0;
  if (field === "posted" && value.getTime() > addDays(anchor, 1).getTime()) {
    invalid = true;
    penalty += 0.5;
    nextPenalties.push("posted_date_in_future");
  }
  if (value.getFullYear() < 1995 || value.getFullYear() > anchor.getFullYear() + 20) {
    invalid = true;
    penalty += 0.45;
    nextPenalties.push("date_out_of_reasonable_bounds");
  }
  return {
    value,
    rawValue,
    signalStrength,
    invalid,
    ambiguous,
    reasons,
    penalties: nextPenalties,
    penalty,
  };
}

function selectDateCandidate(
  candidates: JobDateExtraction[],
  options: {
    field: "posted" | "deadline";
    fallbackDate?: Date;
    fallbackRaw?: string;
  }
): JobDateExtraction {
  const valid = candidates
    .filter((candidate) => candidate.status !== "invalid")
    .sort((left, right) => right.confidence - left.confidence);
  if (valid[0]) return valid[0];
  if (candidates[0]) return candidates[0];
  if (options.fallbackDate && options.field === "posted") {
    return {
      value: options.fallbackDate,
      rawValue: options.fallbackRaw ?? null,
      source: "fallback",
      confidence: 0.25,
      status: "missing",
      reasons: ["fallback_to_ingestion_time"],
      penalties: ["not_real_posted_date"],
    };
  }
  return {
    value: null,
    rawValue: null,
    source: "none",
    confidence: 0,
    status: "missing",
    reasons: [`no_${options.field}_date_found`],
    penalties: [],
  };
}

function dateStatusForConfidence(
  confidence: number,
  value: Date | null,
  invalid: boolean,
  ambiguous: boolean
): JobDateExtraction["status"] {
  if (invalid) return "invalid";
  if (ambiguous) return "ambiguous";
  if (!value) return "missing";
  if (confidence >= 0.85) return "verified";
  if (confidence >= 0.75) return "confident";
  if (confidence >= 0.55) return "usable_review";
  return "ambiguous";
}

function extractDateLabelMatches(text: string, pattern: RegExp) {
  const matches: string[] = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const candidate = DATE_TOKEN_RE.exec(match[1] ?? "")?.[0];
    if (candidate) matches.push(candidate);
  }
  return matches;
}

function parseAbsoluteDate(value: string, anchor: Date) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  const withYear = new Date(`${value.replace(/,/g, "")} UTC`);
  if (!Number.isNaN(withYear.getTime()) && /\d{4}/.test(value)) {
    return startOfUtcDay(withYear);
  }

  if (!/\d{4}/.test(value) && new RegExp(`^(?:${MONTH_NAMES})\\s+\\d{1,2}$`, "i").test(value)) {
    const assumed = new Date(`${value} ${anchor.getUTCFullYear()} UTC`);
    if (!Number.isNaN(assumed.getTime())) return startOfUtcDay(assumed);
  }

  return null;
}

function collectMetadataHits(
  metadata: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
  keyPattern: RegExp,
  prefix = "metadata"
): MetadataHit[] {
  const hits: MetadataHit[] = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (value == null || depth > 5) return;
    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = `${path}.${key}`;
        if (keyPattern.test(key) && isScalarOrScalarArray(child)) {
          hits.push({ keyPath: childPath, value: child });
        }
        visit(child, childPath, depth + 1);
      }
    }
  };
  visit(metadata, prefix, 0);
  return hits.slice(0, 20);
}

function sourceForMetadataHit(hit: MetadataHit, sourceName?: string | null): FieldCandidateSource {
  if (/json[-_ ]?ld|schema/i.test(hit.keyPath)) return "json_ld";
  if (OFFICIAL_SOURCE_RE.test(sourceName ?? "")) return "official_api";
  if (ATS_SOURCE_RE.test(sourceName ?? "")) return "ats_api";
  return "metadata";
}

function sourceForDateMetadataHit(
  hit: MetadataHit,
  sourceName?: string | null
): JobDateExtraction["source"] {
  if (/json[-_ ]?ld|schema/i.test(hit.keyPath)) return "json_ld";
  if (OFFICIAL_SOURCE_RE.test(sourceName ?? "")) return "official_api";
  if (ATS_SOURCE_RE.test(sourceName ?? "")) return "ats_api";
  return "metadata";
}

function inferStructuredSource(sourceName?: string | null): FieldCandidateSource {
  if (OFFICIAL_SOURCE_RE.test(sourceName ?? "")) return "official_api";
  if (ATS_SOURCE_RE.test(sourceName ?? "")) return "ats_api";
  return "connector_raw";
}

function inferStructuredDateSource(sourceName?: string | null): JobDateExtraction["source"] {
  if (OFFICIAL_SOURCE_RE.test(sourceName ?? "")) return "official_api";
  if (ATS_SOURCE_RE.test(sourceName ?? "")) return "ats_api";
  return "connector_raw";
}

function fieldStatusForConfidence(confidence: number, unknown = false): FieldStatus {
  if (unknown) return "missing";
  if (confidence >= 0.85) return "verified";
  if (confidence >= 0.75) return "confident";
  if (confidence >= 0.6) return "usable_review";
  if (confidence >= 0.3) return "quarantine";
  return "rejected";
}

function signal<T extends string>(
  value: T,
  signalStrength: number,
  reasons: string[],
  penalties: string[] = []
) {
  return {
    value,
    signalStrength,
    reasons,
    penalties,
    penalty: penalties.length * 0.08,
  };
}

function employmentSignal(
  value: NormalizedEmploymentType,
  signalStrength: number,
  reasons: string[],
  penalties: string[] = []
) {
  return signal(value, signalStrength, reasons, penalties);
}

function withAgreementPenalty<T extends string>(
  candidates: FieldCandidate<T>[],
  unknownValue: T
) {
  return candidates
    .map((candidate) => {
      if (candidate.value === unknownValue) return candidate;
      const conflicts = candidates.some(
        (other) => other.value !== candidate.value && other.value !== unknownValue && other.confidence >= 0.72
      );
      if (!conflicts || candidate.confidence >= 0.88) return candidate;
      return {
        ...candidate,
        confidence: clamp01(candidate.confidence - 0.08),
        penalties: [...candidate.penalties, "conflicting_metadata_signal"],
      };
    })
    .sort((left, right) => right.confidence - left.confidence);
}

function dedupeCandidates<T extends string>(candidates: FieldCandidate<T>[]) {
  const seen = new Set<string>();
  const out: FieldCandidate<T>[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.value}:${candidate.rawValue?.toLowerCase() ?? ""}:${candidate.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function isScalarOrScalarArray(value: unknown) {
  if (value == null) return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return Array.isArray(value) && value.every((item) => item == null || ["string", "number", "boolean"].includes(typeof item));
}

function stringifyMetadataValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => stringifyMetadataValue(entry)).filter(Boolean).join(" ");
  if (typeof value === "object") return "";
  return String(value);
}

function normalizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
