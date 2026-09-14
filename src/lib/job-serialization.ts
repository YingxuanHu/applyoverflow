import { resolveJobLinks, getSourceTrust } from "@/lib/job-links";
import {
  sanitizeCompanyName,
  sanitizeJobDescriptionText,
  sanitizeJobTitle,
} from "@/lib/job-cleanup";
import { METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD } from "@/lib/job-metadata";
import { inferGeoScope } from "@/lib/geo-scope";
import { resolveCompanyLogoDomain } from "@/lib/company-logo";
import { isJobLocationProse } from "@/lib/jobs/location-label";
import type {
  JobCardData,
  JobCardEligibility,
  JobCardSource,
  JobDetailData,
} from "@/types";

type JobSerializationInput = {
  id: string;
  title: string;
  company: string;
  companyRecord?: { name?: string; domain: string | null; careersUrl?: string | null } | null;
  location: string;
  workMode: JobCardData["workMode"];
  workModeConfidence?: number | null;
  workModeStatus?: string | null;
  industry: JobCardData["industry"];
  status: JobCardData["status"];
  region?: JobDetailData["region"];
  roleFamily: string;
  normalizedRoleCategory?: string | null;
  normalizedRoleCategoryConfidence?: number | null;
  normalizedIndustry?: string | null;
  normalizedIndustries?: string[] | null;
  normalizedIndustryConfidence?: number | null;
  classificationStatus?: string | null;
  experienceLevel: JobCardData["experienceLevel"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod?: string | null;
  shortSummary: string;
  description: string;
  applyUrl: string;
  postedAt: Date;
  deadline: Date | null;
  lastConfirmedAliveAt?: Date | null;
  lastSourceSeenAt?: Date | null;
  eligibility: JobCardEligibility;
  sourceMappings: Array<{
    sourceName: string;
    sourceUrl: string | null;
    isPrimary: boolean;
  }>;
  isSaved: boolean;
  hasApplied?: boolean;
};

export function serializeJobCardData(job: JobSerializationInput): JobCardData {
  const title = sanitizeJobTitle(job.title);
  const location = isJobLocationProse(job.location) ? "Location not listed" : job.location;
  const company = sanitizeCompanyName(job.company, {
    urls: [job.applyUrl, ...job.sourceMappings.map((mapping) => mapping.sourceUrl)],
  });
  const description = sanitizeJobDescriptionText(job.description, {
    title,
    location: job.location,
  });
  const shortSummary = job.shortSummary
    ? sanitizeJobDescriptionText(job.shortSummary, {
        title,
        location: job.location,
      })
    : job.shortSummary;
  const sourceMappings = serializeJobSourceMappings(job.sourceMappings);
  const { linkTrust, primaryExternalLink, sourcePostingLink } = resolveJobLinks({
    applyUrl: job.applyUrl,
    sourceMappings: job.sourceMappings,
  });

  return {
    id: job.id,
    title,
    company,
    companyDomain: resolveCompanyLogoDomain({ company, companyRecord: job.companyRecord, sourceUrls: [job.applyUrl, ...job.sourceMappings.map((mapping) => mapping.sourceUrl)] }),
    location,
    geoScope: inferGeoScope(location, job.region ?? null),
    workMode: (job.workModeConfidence !== undefined && (job.workModeConfidence ?? 0) < METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD) || ["missing", "quarantine", "rejected"].includes(job.workModeStatus ?? "") ? "UNKNOWN" : job.workMode,
    industry: job.industry,
    status: job.status,
    roleFamily: job.roleFamily,
    normalizedRoleCategory: job.normalizedRoleCategory ?? null,
    normalizedRoleCategoryConfidence: job.normalizedRoleCategoryConfidence ?? null,
    normalizedIndustry: job.normalizedIndustry ?? null,
    normalizedIndustries: job.normalizedIndustries ?? [],
    normalizedIndustryConfidence: job.normalizedIndustryConfidence ?? null,
    classificationStatus: job.classificationStatus ?? null,
    experienceLevel: job.experienceLevel,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod ?? null,
    shortSummary,
    description,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt.toISOString(),
    deadline: job.deadline?.toISOString() ?? null,
    lastConfirmedAliveAt: job.lastConfirmedAliveAt?.toISOString() ?? null,
    lastSourceSeenAt: job.lastSourceSeenAt?.toISOString() ?? null,
    isSaved: job.isSaved,
    hasApplied: Boolean(job.hasApplied),
    eligibility: job.eligibility,
    sourceMappings,
    primaryExternalLink,
    sourcePostingLink,
    linkTrust,
  };
}

export function serializeJobDetailData(
  job: JobSerializationInput & {
    region: JobDetailData["region"];
    employmentType: JobDetailData["employmentType"];
  }
): JobDetailData {
  return {
    ...serializeJobCardData(job),
    description: job.description,
    region: job.region,
    employmentType: job.employmentType,
  };
}

function serializeJobSourceMappings(
  sourceMappings: JobSerializationInput["sourceMappings"]
): JobCardSource[] {
  return sourceMappings.map((mapping) => ({
    sourceName: mapping.sourceName,
    sourceUrl: mapping.sourceUrl,
    isPrimary: mapping.isPrimary,
    trust: getSourceTrust(mapping.sourceName, mapping.sourceUrl),
  }));
}
