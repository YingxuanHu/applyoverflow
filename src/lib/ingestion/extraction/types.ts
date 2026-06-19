import type { WorkMode } from "@/generated/prisma/client";
import type { NormalizedEmploymentType } from "@/lib/job-metadata";

export type FieldCandidateSource =
  | "official_api"
  | "ats_api"
  | "json_ld"
  | "h1"
  | "page_title"
  | "meta_title"
  | "og_title"
  | "url_slug"
  | "link_text"
  | "body_text"
  | "header_block"
  | "recovered_from_header"
  | "recovered_from_marketing_headline"
  | "recovered_from_seo_title"
  | "connector_raw"
  | "structured_location"
  | "ats_location"
  | "html_location"
  | "remote_text"
  | "detail_html"
  | "description_text"
  | "url"
  | "metadata"
  | "fallback";

export type FieldCandidate<T = string> = {
  value: T;
  rawValue?: string;
  source: FieldCandidateSource;
  confidence: number;
  evidence?: string;
  reasons: string[];
  penalties: string[];
  rejected?: boolean;
  rejectionReason?: string;
};

export type FieldStatus =
  | "verified"
  | "confident"
  | "usable_review"
  | "quarantine"
  | "rejected"
  | "missing";

export type SelectedField<T = string> = FieldCandidate<T> & {
  status: FieldStatus;
};

export type SalaryPeriod = "hour" | "day" | "week" | "month" | "year" | null;

export type SalaryExtractionV2 = {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod;
  annualizedMin: number | null;
  annualizedMax: number | null;
  rawText: string | null;
  source: "structured" | "description_regex" | "none";
  status: "present" | "not_disclosed" | "not_found" | "ambiguous" | "failed_parse";
  confidence: number;
  reasons: string[];
  penalties: string[];
};

export type DescriptionExtractionResult = {
  text: string | null;
  source: "structured" | "detail_html" | "body_fallback" | "connector_raw" | "none";
  confidence: number;
  status: "strong" | "usable" | "short" | "missing" | "page_chrome" | "failed";
  wordCount: number;
  reasons: string[];
  penalties: string[];
};

export type EmploymentTypeGroup =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERNSHIP_COOP"
  | "TEMPORARY_SEASONAL"
  | "FREELANCE"
  | "VOLUNTEER"
  | "OTHER"
  | "UNKNOWN";

export type JobDateExtractionStatus =
  | "verified"
  | "confident"
  | "usable_review"
  | "ambiguous"
  | "missing"
  | "invalid";

export type JobDateExtractionSource =
  | "official_api"
  | "ats_api"
  | "json_ld"
  | "connector_raw"
  | "detail_html"
  | "description_text"
  | "metadata"
  | "fallback"
  | "none";

export type JobDateExtraction = {
  value: Date | null;
  rawValue?: string | null;
  source: JobDateExtractionSource;
  confidence: number;
  status: JobDateExtractionStatus;
  evidence?: string;
  reasons: string[];
  penalties: string[];
};

export type JobMetadataExtractionResult = {
  workMode: SelectedField<WorkMode>;
  workModeCandidates: FieldCandidate<WorkMode>[];
  employmentType: SelectedField<NormalizedEmploymentType>;
  employmentTypeGroup: EmploymentTypeGroup;
  employmentTypeCandidates: FieldCandidate<NormalizedEmploymentType>[];
  datePosted: JobDateExtraction;
  applicationDeadline: JobDateExtraction;
  warnings: string[];
};

export type TitlePageType =
  | "single_job"
  | "job_landing_page"
  | "gig_signup_page"
  | "seo_category_page"
  | "unknown";

export type TitleExtractionResult = {
  title: SelectedField<string>;
  displayTitle?: string | null;
  titleCandidates: FieldCandidate<string>[];
  rejectedFragments: FieldCandidate<string>[];
  extractedMetadata?: {
    workMode?: string | null;
    location?: string | null;
    employmentType?: string | null;
  };
  jobPageType?: TitlePageType;
  warnings: string[];
};

export type ExtractedJobFacts = {
  title: SelectedField<string>;
  displayTitle?: string | null;
  titleCandidates: FieldCandidate<string>[];
  titleRejectedFragments: FieldCandidate<string>[];
  titleExtractionWarnings: string[];
  jobPageType?: TitlePageType;
  location: SelectedField<string> | null;
  locationCandidates: FieldCandidate<string>[];
  salary: SalaryExtractionV2;
  description: DescriptionExtractionResult;
  metadata: JobMetadataExtractionResult;
  quality: {
    shouldIndex: boolean;
    shouldReview: boolean;
    rejectionReasons: string[];
    warnings: string[];
  };
};
