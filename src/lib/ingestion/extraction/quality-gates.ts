import type { Prisma } from "@/generated/prisma/client";
import { extractAndScoreDescription } from "@/lib/ingestion/extraction/description-extractor";
import { extractAndScoreLocation, extractLocationCandidates } from "@/lib/ingestion/extraction/location-extractor";
import { extractJobMetadata } from "@/lib/ingestion/extraction/job-metadata-extractor";
import { extractSalaryV2 } from "@/lib/ingestion/extraction/salary-extractor-v2";
import {
  extractJobTitle,
  isGenericCareerPageTitle,
  isLocationOnlyTitle,
  isMetadataOnlyTitleFragment,
  looksLikeSentenceInsteadOfTitle,
} from "@/lib/ingestion/extraction/title-extractor";
import type { ExtractedJobFacts } from "@/lib/ingestion/extraction/types";
import type { SourceConnectorJob } from "@/lib/ingestion/types";

export const ENABLE_CANDIDATE_EXTRACTION =
  process.env.ENABLE_CANDIDATE_EXTRACTION !== "false";
export const STRICT_TITLE_QUALITY_GATE =
  process.env.STRICT_TITLE_QUALITY_GATE !== "false";

type ExtractionContext = {
  company?: string | null;
  urls?: Array<string | null | undefined>;
  sourceName?: string | null;
  metadata?: Prisma.InputJsonValue | Prisma.JsonValue | null;
  fetchedAt?: Date;
};

export function extractNormalizedJobFacts(
  job: SourceConnectorJob,
  context: ExtractionContext = {}
): ExtractedJobFacts {
  const urls = context.urls ?? [job.applyUrl, job.sourceUrl];
  const metadata = context.metadata ?? job.metadata;
  const titleExtraction = extractJobTitle(job, {
    company: context.company,
    urls,
    sourceName: context.sourceName,
    metadata,
  });
  const title = titleExtraction.title;
  const enrichedJob = {
    ...job,
    location:
      job.location ||
      titleExtraction.extractedMetadata?.location ||
      "",
    workMode:
      job.workMode ??
      coerceExtractedWorkMode(titleExtraction.extractedMetadata?.workMode),
    employmentType:
      job.employmentType ??
      coerceExtractedEmploymentType(titleExtraction.extractedMetadata?.employmentType),
  };
  const locationCandidates = extractLocationCandidates(job, { metadata });
  const location =
    extractAndScoreLocation(enrichedJob, { metadata }) ??
    buildRecoveredLocationField(titleExtraction.extractedMetadata?.location);
  const description = extractAndScoreDescription(job, {
    title: title.value || job.title,
    location: location?.value ?? job.location,
  });
  const metadataExtraction = extractJobMetadata(enrichedJob, {
    company: context.company,
    title: title.value || job.title,
    location: location?.value ?? job.location,
    description: description.text ?? job.description,
    urls,
    fetchedAt: context.fetchedAt ?? new Date(),
    sourceName: context.sourceName,
    metadata,
  });
  const salary = extractSalaryV2({
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    description: description.text ?? job.description,
    regionHint: null,
  });

  const quality = evaluateExtractionQuality({
    title,
    company: context.company ?? job.company,
    applyUrl: job.applyUrl || job.sourceUrl || "",
    descriptionStatus: description.status,
  });

  if (description.status === "missing" || description.status === "short") {
    quality.warnings.push(`DESCRIPTION_${description.status.toUpperCase()}`);
    quality.shouldReview = true;
  }
  if (description.status === "page_chrome") {
    quality.warnings.push("DESCRIPTION_PAGE_CHROME");
    quality.shouldReview = true;
  }
  if (location?.status === "quarantine" || location?.status === "rejected") {
    quality.warnings.push("LOCATION_LOW_CONFIDENCE");
    quality.shouldReview = true;
  }
  if (salary.status !== "present") {
    quality.warnings.push(`SALARY_${salary.status.toUpperCase()}`);
  }
  quality.warnings.push(...titleExtraction.warnings);
  quality.warnings.push(...metadataExtraction.warnings);

  return {
    title,
    displayTitle: titleExtraction.displayTitle,
    titleCandidates: titleExtraction.titleCandidates,
    titleRejectedFragments: titleExtraction.rejectedFragments,
    titleExtractionWarnings: titleExtraction.warnings,
    jobPageType: titleExtraction.jobPageType,
    location,
    locationCandidates,
    salary,
    description,
    metadata: metadataExtraction,
    quality,
  };
}

export function passesCanonicalQualityGate(facts: ExtractedJobFacts, job: SourceConnectorJob) {
  return evaluateExtractionQuality({
    title: facts.title,
    company: job.company,
    applyUrl: job.applyUrl || job.sourceUrl || "",
    descriptionStatus: facts.description.status,
  }).shouldIndex;
}

function evaluateExtractionQuality(input: {
  title: ExtractedJobFacts["title"];
  company: string | null | undefined;
  applyUrl: string;
  descriptionStatus: string;
}) {
  const rejectionReasons: string[] = [];
  const warnings: string[] = [];
  let shouldReview = false;

  if (!input.title.value) rejectionReasons.push("TITLE_MISSING");
  if (input.title.status === "missing") rejectionReasons.push("TITLE_MISSING");
  if (input.title.status === "rejected") {
    if (isGenericCareerPageTitle(input.title.value)) rejectionReasons.push("TITLE_GENERIC_PAGE");
    else if (isLocationOnlyTitle(input.title.value)) rejectionReasons.push("TITLE_LOCATION_ONLY");
    else if (isMetadataOnlyTitleFragment(input.title.value)) rejectionReasons.push("TITLE_METADATA_FRAGMENT");
    else rejectionReasons.push("TITLE_REJECTED");
  }
  if (input.title.status === "quarantine") rejectionReasons.push("TITLE_LOW_CONFIDENCE");
  if (input.title.confidence < 0.6) rejectionReasons.push("TITLE_LOW_CONFIDENCE");
  if (looksLikeSentenceInsteadOfTitle(input.title.value)) rejectionReasons.push("TITLE_SENTENCE_LIKE");
  if (input.title.value.length > 120) rejectionReasons.push("TITLE_TOO_LONG");

  if (!input.company?.trim() || /^unknown(?: company)?$/i.test(input.company.trim())) {
    rejectionReasons.push("COMPANY_MISSING");
  }
  if (!/^https?:\/\//i.test(input.applyUrl)) rejectionReasons.push("URL_MISSING");

  const strongEnoughTitle =
    input.title.status === "verified" ||
    input.title.status === "confident" ||
    (!STRICT_TITLE_QUALITY_GATE && input.title.status === "usable_review");
  if (!strongEnoughTitle) shouldReview = true;

  return {
    shouldIndex: rejectionReasons.length === 0 && strongEnoughTitle,
    shouldReview,
    rejectionReasons: [...new Set(rejectionReasons)],
    warnings: [...new Set(warnings)],
  };
}

function coerceExtractedWorkMode(value: string | null | undefined) {
  if (value === "REMOTE" || value === "HYBRID" || value === "ONSITE" || value === "FLEXIBLE" || value === "UNKNOWN") {
    return value;
  }
  return null;
}

function coerceExtractedEmploymentType(value: string | null | undefined) {
  if (value === "FULL_TIME" || value === "PART_TIME" || value === "CONTRACT" || value === "INTERNSHIP" || value === "UNKNOWN") {
    return value;
  }
  return null;
}

function buildRecoveredLocationField(value: string | null | undefined) {
  if (!value) return null;
  return {
    value,
    rawValue: value,
    source: "recovered_from_header" as const,
    confidence: 0.68,
    status: "usable_review" as const,
    evidence: "title_header_metadata",
    reasons: ["recovered_from_title_header"],
    penalties: [],
  };
}
