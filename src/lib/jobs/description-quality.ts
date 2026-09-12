import { isJobDescriptionSummaryUsable, isLowQualityJobDescription } from "@/lib/job-description-format";

export type DescriptionRepairInput = {
  description: string;
  sourceMappings?: Array<{ sourceName?: string }>;
};

export function hasUsableSourceDescription(description: string) {
  return !isLowQualityJobDescription(description) && isJobDescriptionSummaryUsable(description);
}

export function needsDescriptionRepair(job: DescriptionRepairInput) {
  if (!hasUsableSourceDescription(job.description)) return true;
  // The old Lever connector omitted the provider's named lists, even when its
  // introduction was long enough to pass the ordinary length/quality gate.
  return Boolean(job.sourceMappings?.some((source) => source.sourceName?.startsWith("Lever:"))) &&
    !/(?:^|\n)\s*#{1,3}\s+/.test(job.description);
}
