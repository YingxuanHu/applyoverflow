import type { JobCanonical } from "@/generated/prisma/client";
import { formatDisplayLabel, formatSalary } from "@/lib/job-display";
import { METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD } from "@/lib/job-metadata";
import { hasBadApplyLinkValidationStatus } from "@/lib/ingestion/apply-link-quality";
import { isJobLocationProse } from "@/lib/jobs/location-label";

export const DECISION_FACT_LABELS = {
  availability: "Availability", location: "Location", workStyle: "Work style",
  salary: "Salary", employment: "Employment", deadline: "Deadline",
} as const;
export type DecisionFacts = { version: 1 } & Record<keyof typeof DECISION_FACT_LABELS, string | null>;

export const decisionFactSelect = {
  status: true, deadSignalAt: true, applyUrlValidationStatus: true,
  location: true, locationConfidence: true, locationStatus: true,
  workMode: true, workModeConfidence: true, workModeStatus: true,
  salaryMin: true, salaryMax: true, salaryCurrency: true, salaryPeriod: true, salaryConfidence: true, salaryStatus: true,
  employmentType: true, employmentTypeConfidence: true, employmentTypeStatus: true,
  deadline: true, applicationDeadlineConfidence: true, applicationDeadlineStatus: true,
} as const;
type FactInput = Pick<JobCanonical, keyof typeof decisionFactSelect>;

function reliable(status: string | null, confidence: number | null) {
  return ["verified", "confident"].includes(status ?? "") && (confidence ?? 0) >= METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD;
}

export function buildDecisionFacts(job: FactInput): DecisionFacts {
  return {
    version: 1,
    availability: job.status === "LIVE" && !job.deadSignalAt && !hasBadApplyLinkValidationStatus(job.applyUrlValidationStatus) ? "Open" : "Not currently listed",
    location: reliable(job.locationStatus, job.locationConfidence) && job.location.trim() && !isJobLocationProse(job.location) ? job.location.trim().slice(0, 180) : null,
    workStyle: reliable(job.workModeStatus, job.workModeConfidence) && job.workMode !== "UNKNOWN" ? formatDisplayLabel(job.workMode) : null,
    salary: reliable(job.salaryStatus, job.salaryConfidence) ? (formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod) || null) : null,
    employment: reliable(job.employmentTypeStatus, job.employmentTypeConfidence) && job.employmentType !== "UNKNOWN" ? formatDisplayLabel(job.employmentType) : null,
    deadline: reliable(job.applicationDeadlineStatus, job.applicationDeadlineConfidence) ? job.deadline?.toISOString().slice(0, 10) ?? null : null,
  };
}

export function changedDecisionFacts(previous: unknown, next: DecisionFacts) {
  if (!previous || typeof previous !== "object" || Array.isArray(previous) || !("version" in previous) || previous.version !== 1) return [];
  const prior = previous as Record<string, unknown>;
  return (Object.keys(DECISION_FACT_LABELS) as Array<keyof typeof DECISION_FACT_LABELS>)
    .filter((key) => Object.hasOwn(prior, key) && prior[key] !== next[key])
    .map((key) => ({ field: key, label: DECISION_FACT_LABELS[key], before: typeof prior[key] === "string" ? prior[key] as string : null, after: next[key] }));
}
