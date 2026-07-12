import {
  hasUnresolvedGenericCompanyName,
  isSuspiciousJobTitle,
} from "@/lib/job-cleanup";
import {
  classifyNonJobPosting,
  isClearlyNonJobContentUrl,
} from "@/lib/job-integrity";

export type JobDataQualityIssue =
  | "missing_title"
  | "missing_company"
  | "suspicious_title"
  | "generic_platform_company"
  | "non_job_posting"
  | "generic_non_job_url"
  | "empty_description"
  | "short_description";

export type JobDataQualitySeverity = "accept" | "review" | "reject";

export type JobDataQualityAssessment = {
  severity: JobDataQualitySeverity;
  primaryIssue: JobDataQualityIssue | null;
  rejectionReason: string | null;
  issues: JobDataQualityIssue[];
  detail: string | null;
};

const MIN_DESCRIPTION_REVIEW_LENGTH = 80;
export function assessJobDataQuality(input: {
  title: string | null | undefined;
  company: string | null | undefined;
  description: string | null | undefined;
  applyUrl: string | null | undefined;
}): JobDataQualityAssessment {
  const title = compact(input.title);
  const company = compact(input.company);
  const description = compact(input.description);
  const applyUrl = compact(input.applyUrl);
  const issues: JobDataQualityIssue[] = [];
  let hardRejectIssue: JobDataQualityIssue | null = null;
  let detail: string | null = null;

  if (!title) {
    hardRejectIssue = "missing_title";
    issues.push("missing_title");
  }

  if (!company || /^unknown(?: company)?$/i.test(company)) {
    hardRejectIssue ??= "missing_company";
    issues.push("missing_company");
  }

  if (title && isSuspiciousJobTitle(title, company)) {
    hardRejectIssue ??= "suspicious_title";
    issues.push("suspicious_title");
  }

  if (company && hasUnresolvedGenericCompanyName(company, applyUrl)) {
    hardRejectIssue ??= "generic_platform_company";
    issues.push("generic_platform_company");
  }

  const nonJob = classifyNonJobPosting({
    title,
    description,
    applyUrl,
  });
  if (nonJob.detected) {
    hardRejectIssue ??= "non_job_posting";
    issues.push("non_job_posting");
    detail = nonJob.reason;
  }

  if (looksLikeGenericNonJobUrl(applyUrl)) {
    hardRejectIssue ??= "generic_non_job_url";
    issues.push("generic_non_job_url");
  }

  if (!description) {
    issues.push("empty_description");
  } else if (description.length < MIN_DESCRIPTION_REVIEW_LENGTH) {
    issues.push("short_description");
  }

  if (hardRejectIssue) {
    return {
      severity: "reject",
      primaryIssue: hardRejectIssue,
      rejectionReason: `bad_core_fields:${hardRejectIssue}`,
      issues: unique(issues),
      detail,
    };
  }

  const reviewIssues = issues.filter(
    (issue) => issue === "empty_description" || issue === "short_description"
  );
  if (reviewIssues.length > 0) {
    return {
      severity: "review",
      primaryIssue: reviewIssues[0] ?? null,
      rejectionReason: null,
      issues: unique(issues),
      detail,
    };
  }

  return {
    severity: "accept",
    primaryIssue: null,
    rejectionReason: null,
    issues: [],
    detail: null,
  };
}

function looksLikeGenericNonJobUrl(applyUrl: string) {
  return isClearlyNonJobContentUrl(applyUrl);
}

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}
