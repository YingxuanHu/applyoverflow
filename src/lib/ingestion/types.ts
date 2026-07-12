import type {
  EmploymentType,
  ExperienceLevel,
  IngestionRunMode,
  IngestionRunStatus,
  Industry,
  Prisma,
  Region,
  SourceTier,
  SubmissionCategory,
  WorkMode,
} from "@/generated/prisma/client";
import type {
  NormalizedCareerStage,
  NormalizedEmploymentType,
  NormalizedIndustry,
  NormalizedRoleCategory,
  JobClassificationStatus,
} from "@/lib/job-metadata";

export type ConnectorFreshnessMode = "FULL_SNAPSHOT" | "INCREMENTAL";

export type SourceConnectorJob = {
  sourceId: string;
  sourceUrl: string | null;
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  postedAt: Date | null;
  deadline: Date | null;
  employmentType: EmploymentType | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  metadata: Prisma.InputJsonValue;
};

export type SourceConnectorFetchOptions = {
  now: Date;
  limit?: number;
  signal?: AbortSignal;
  deadlineAt?: Date;
  maxRuntimeMs?: number;
  checkpoint?: Prisma.InputJsonValue | null;
  onCheckpoint?: (checkpoint: Prisma.InputJsonValue | null) => Promise<void> | void;
  /** Optional structured logger. Defaults to console.log inside connectors. */
  log?: (message: string) => void;
};

export type SourceConnectorFetchResult = {
  jobs: SourceConnectorJob[];
  metadata?: Prisma.InputJsonValue;
  checkpoint?: Prisma.InputJsonValue | null;
  exhausted?: boolean;
};

export type SourceConnector = {
  key: string;
  sourceName: string;
  sourceTier: SourceTier;
  freshnessMode: ConnectorFreshnessMode;
  fetchJobs(options: SourceConnectorFetchOptions): Promise<SourceConnectorFetchResult>;
};

export type NormalizedJobInput = {
  title: string;
  company: string;
  companyKey: string;
  titleKey: string;
  titleCoreKey: string;
  descriptionFingerprint: string;
  location: string;
  locationKey: string;
  /** null = geography could not be resolved to a known NA region */
  region: Region | null;
  /** UNKNOWN = work arrangement could not be confidently inferred */
  workMode: WorkMode;
  workModeConfidence?: number | null;
  workModeStatus?: string | null;
  workModeSource?: string | null;
  workModeCandidatesJson?: Prisma.InputJsonValue;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** UNKNOWN = employment type could not be confidently inferred */
  employmentType: EmploymentType;
  employmentTypeGroup?: string | null;
  employmentTypeConfidence?: number | null;
  employmentTypeStatus?: string | null;
  employmentTypeSource?: string | null;
  employmentTypeCandidatesJson?: Prisma.InputJsonValue;
  /** UNKNOWN = career stage could not be confidently inferred */
  experienceLevel: ExperienceLevel;
  experienceLevelGroup?: string | null;
  experienceLevelSource?: string | null;
  experienceLevelEvidenceJson?: Prisma.InputJsonValue;
  experienceLevelWarningsJson?: Prisma.InputJsonValue;
  description: string;
  shortSummary: string;
  /** null = role did not match a known industry pattern */
  industry: Industry | null;
  /** "Unknown" when title did not match any role-family pattern */
  roleFamily: string;
  /** Standardized user-facing employment taxonomy used by filters. */
  normalizedEmploymentType: NormalizedEmploymentType;
  normalizedEmploymentTypeConfidence: number;
  /** Standardized user-facing career-stage taxonomy used by filters. */
  normalizedCareerStage: NormalizedCareerStage;
  normalizedCareerStageConfidence: number;
  /** Standardized top-level industry taxonomy used by filters. */
  normalizedIndustry: NormalizedIndustry;
  /** Multi-label company industry taxonomy used by filters. */
  normalizedIndustries: NormalizedIndustry[];
  normalizedIndustryConfidence: number;
  /** Standardized job-family taxonomy used by filters. */
  normalizedRoleCategory: NormalizedRoleCategory;
  normalizedRoleCategoryConfidence: number;
  normalizedRoleCategoryGroup?: string | null;
  normalizedRoleCategoryStatus?: string | null;
  normalizedRoleCategorySource?: string | null;
  normalizedRoleCategoryCandidatesJson?: Prisma.InputJsonValue;
  normalizedRoleCategoryEvidenceJson?: Prisma.InputJsonValue;
  normalizedRoleCategoryWarningsJson?: Prisma.InputJsonValue;
  classificationStatus: JobClassificationStatus;
  displayTitle?: string | null;
  titleConfidence?: number | null;
  titleStatus?: string | null;
  titleSource?: string | null;
  titleCandidatesJson?: Prisma.InputJsonValue;
  titleRejectedFragmentsJson?: Prisma.InputJsonValue;
  titleExtractionWarnings?: Prisma.InputJsonValue;
  jobPageType?: string | null;
  locationConfidence?: number | null;
  locationStatus?: string | null;
  locationSource?: string | null;
  locationCandidatesJson?: Prisma.InputJsonValue;
  salaryStatus?: string | null;
  salaryPeriod?: string | null;
  salaryRawText?: string | null;
  salaryConfidence?: number | null;
  salarySource?: string | null;
  descriptionStatus?: string | null;
  descriptionConfidence?: number | null;
  descriptionWordCount?: number | null;
  datePostedConfidence?: number | null;
  datePostedStatus?: string | null;
  datePostedSource?: string | null;
  datePostedRawText?: string | null;
  applicationDeadlineConfidence?: number | null;
  applicationDeadlineStatus?: string | null;
  applicationDeadlineSource?: string | null;
  applicationDeadlineRawText?: string | null;
  metadataExtractionWarnings?: Prisma.InputJsonValue;
  extractionWarnings?: Prisma.InputJsonValue;
  extractionRejectionReasons?: Prisma.InputJsonValue;
  applyUrl: string;
  applyUrlKey: string | null;
  postedAt: Date;
  deadline: Date | null;
  duplicateClusterId: string;
};

export type NormalizationResult =
  | {
      kind: "accepted";
      job: NormalizedJobInput;
    }
  | {
      kind: "rejected";
      reason: string;
    };

export type EligibilityDraft = {
  submissionCategory: SubmissionCategory;
  reasonCode: string;
  reasonDescription: string;
  jobValidityConfidence: number;
  applicationFlowConfidence: number;
  packageFitConfidence: number;
  submissionQualityConfidence: number;
  customizationLevel: number;
  evaluatedAt: Date;
};

export type IngestionSummary = {
  runId?: string;
  runMode: IngestionRunMode;
  status: IngestionRunStatus;
  connectorKey: string;
  sourceName: string;
  sourceTier: SourceTier;
  freshnessMode: ConnectorFreshnessMode;
  fetchedCount: number;
  /** Phase-1 broad-intake alias for acceptedCount */
  minimallyAcceptedCount: number;
  acceptedCount: number;
  acceptedCanadaCount: number;
  acceptedCanadaRemoteCount: number;
  rejectedCount: number;
  rawCreatedCount: number;
  rawUpdatedCount: number;
  canonicalCreatedCount: number;
  canonicalCreatedCanadaCount: number;
  canonicalCreatedCanadaRemoteCount: number;
  canonicalUpdatedCount: number;
  dedupedCount: number;
  sourceMappingCreatedCount: number;
  sourceMappingUpdatedCount: number;
  sourceMappingsRemovedCount: number;
  /** Phase-1 downstream visibility alias for liveCount */
  visibleLiveCount: number;
  liveCount: number;
  staleCount: number;
  expiredCount: number;
  removedCount: number;
  skippedReasons: Record<string, number>;
  /** Connector-level fetch diagnostics, never raw page content. */
  fetchMetadata: Prisma.InputJsonValue | null;
  checkpoint?: Prisma.InputJsonValue | null;
  checkpointExhausted?: boolean;
};

export type IngestionRunListItem = {
  id: string;
  connectorKey: string;
  sourceName: string;
  sourceTier: SourceTier;
  runMode: IngestionRunMode;
  status: IngestionRunStatus;
  startedAt: string;
  endedAt: string | null;
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rawCreatedCount: number;
  rawUpdatedCount: number;
  canonicalCreatedCount: number;
  canonicalUpdatedCount: number;
  dedupedCount: number;
  sourceMappingCreatedCount: number;
  sourceMappingUpdatedCount: number;
  sourceMappingsRemovedCount: number;
  liveCount: number;
  staleCount: number;
  expiredCount: number;
  removedCount: number;
  errorSummary: string | null;
};

export type IngestionSourceCoverage = {
  sourceName: string;
  rawCount: number;
  activeMappingCount: number;
  liveCanonicalCount: number;
  staleCanonicalCount: number;
  removedMappingCount: number;
  lastRunStatus: IngestionRunStatus | null;
  lastRunStartedAt: string | null;
  lastSuccessfulRunAt: string | null;
  scheduleCadenceMinutes: number | null;
  isScheduled: boolean;
};

export type IngestionOverview = {
  rawCount: number;
  canonicalCount: number;
  sourceMappingCount: number;
  liveCount: number;
  agingCount: number;
  staleCount: number;
  expiredCount: number;
  removedCount: number;
  readyToApplyCount: number;
  reviewRequiredCount: number;
  manualOnlyCount: number;
  recentRunCount: number;
  sources: IngestionSourceCoverage[];
  recentRuns: IngestionRunListItem[];
};
