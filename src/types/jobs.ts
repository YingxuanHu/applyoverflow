import type {
  ApplicationStatus,
  EmploymentType,
  ExperienceLevel,
  Industry,
  JobCanonical,
  JobEligibility,
  JobStatus,
  JobSourceMapping,
  Region,
  SubmissionCategory,
  WorkMode,
} from "@/generated/prisma/client";
import type {
  JobLinkTrust,
  JobLinkTrustLevel,
  JobResolvedLink,
} from "@/lib/job-links";
import type { GeoScope } from "@/lib/geo-scope";

export type JobWithEligibility = JobCanonical & {
  eligibility: JobEligibility | null;
  sourceMappings: JobSourceMapping[];
  isSaved: boolean;
};

export type JobCardEligibility = {
  submissionCategory: SubmissionCategory;
  reasonCode: string;
  reasonDescription: string;
} | null;

export type JobCardSource = {
  sourceName: string;
  sourceUrl: string | null;
  isPrimary: boolean;
  trust: {
    level: JobLinkTrustLevel;
    label: string;
    summary: string;
  };
};

export type JobCardData = {
  id: string;
  title: string;
  company: string;
  location: string;
  geoScope: GeoScope;
  workMode: WorkMode;
  industry: Industry | null;
  status: JobStatus;
  roleFamily: string;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  normalizedIndustry: string | null;
  normalizedIndustries: string[];
  normalizedIndustryConfidence: number | null;
  classificationStatus: string | null;
  experienceLevel: ExperienceLevel | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  shortSummary: string;
  description: string;
  applyUrl: string;
  postedAt: string;
  deadline: string | null;
  isSaved: boolean;
  hasApplied: boolean;
  eligibility: JobCardEligibility;
  sourceMappings: JobCardSource[];
  primaryExternalLink: JobResolvedLink | null;
  sourcePostingLink: JobResolvedLink | null;
  linkTrust: JobLinkTrust;
};

export type JobDetailData = JobCardData & {
  region: Region | null;
  employmentType: EmploymentType;
};

export type ResumeVariantSummary = {
  id: string;
  label: string;
  targetRoleFamily: string | null;
  content: string | null;
  isDefault: boolean;
};

export type ApplicationPackagePreview = {
  attachedLinks: Array<{ label: string; value: string }>;
  savedAnswers: Array<{ label: string; value: string }>;
  whyItMatches: string;
  coverLetterMode: string;
};

export type ApplicationPackageSummary = {
  id: string;
  resumeVariant: ResumeVariantSummary;
  whyItMatches: string | null;
  coverLetterContent: string | null;
  userNotes: string | null;
  attachedLinks: Array<{ label: string; value: string }>;
  savedAnswers: Array<{ label: string; value: string }>;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationSubmissionSummary = {
  id: string;
  status: ApplicationStatus;
  submissionMethod: string | null;
  submittedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  packageId: string | null;
};

export type ApplicationReviewState =
  | "READY_FOR_REVIEW"
  | "MANUAL_ONLY"
  | "NOT_ELIGIBLE";

export type ApplicationReviewData = {
  job: JobDetailData;
  recommendedResume: ResumeVariantSummary | null;
  latestPackage: ApplicationPackageSummary | null;
  submissions: ApplicationSubmissionSummary[];
  packagePreview: ApplicationPackagePreview;
  reviewState: ApplicationReviewState;
  workAuthorization: string | null;
};

export type ApplicationHistoryStatus = ApplicationStatus | "PACKAGE_ONLY";

export type ApplicationHistoryItem = {
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    workMode: WorkMode;
    industry: Industry | null;
    status: JobStatus;
    roleFamily: string;
    normalizedRoleCategory: string | null;
    normalizedRoleCategoryConfidence: number | null;
    normalizedIndustry: string | null;
    normalizedIndustries: string[];
    normalizedIndustryConfidence: number | null;
    classificationStatus: string | null;
    applyUrl: string;
    postedAt: string;
    eligibility: JobCardEligibility;
  };
  latestPackage: ApplicationPackageSummary | null;
  latestSubmission: ApplicationSubmissionSummary | null;
  latestStatus: ApplicationHistoryStatus;
  latestActivityAt: string;
};

export type JobFilters = {
  search?: string;
  searchScope?: "all" | "title" | "company" | "location";
  titleSearch?: string;
  companySearch?: string;
  locationSearch?: string;
  location?: string;
  source?: string;
  region?: string;
  workMode?: string;
  employmentType?: string;
  industry?: string;
  jobFunction?: string;
  roleCategory?: string;
  roleFamily?: string;
  salaryMin?: string;
  salaryMax?: string;
  salaryCurrency?: string;
  includeUnknownSalary?: string;
  experienceLevel?: string;
  careerStage?: string;
  expiry?: string;
  posted?: string;
  submissionCategory?: string;
  status?: string;
  sortBy?: "relevance" | "newest" | "deadline" | "company";
  page?: string;
  debugFilters?: string;
};
