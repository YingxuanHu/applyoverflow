import type { JobContext } from "./job-fit";

const MIN_USABLE_JOB_DESCRIPTION_CHARS = 80;
const UNUSABLE_DESCRIPTION_PATTERNS = [
  /no full job description is available/i,
  /full description unavailable/i,
  /source page could not be accessed/i,
  /write the cover letter using the known job title/i,
];

export function hasUsableCoverLetterJobContext(job: Pick<JobContext, "description"> | null) {
  if (!job) return false;
  const description = job.description.trim();
  return (
    description.length >= MIN_USABLE_JOB_DESCRIPTION_CHARS &&
    !UNUSABLE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description))
  );
}

export function getCoverLetterJobContextIssue(job: Pick<JobContext, "description"> | null) {
  if (!job) return "Job details could not be loaded.";
  if (!hasUsableCoverLetterJobContext(job)) {
    return "A usable job description is required before generating a tailored cover letter.";
  }
  return null;
}
