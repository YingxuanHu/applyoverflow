const JOBS_RETURN_PATHS = new Set(["/jobs", "/jobs/top-picks"]);

export function getSafeJobsReturnHref(rawHref?: string | null) {
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, "https://applyoverflow.local");
    if (parsed.origin !== "https://applyoverflow.local") return null;
    if (!JOBS_RETURN_PATHS.has(parsed.pathname)) return null;

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function buildJobDetailHref(jobId: string, sourceHref?: string | null) {
  const safeSourceHref = getSafeJobsReturnHref(sourceHref);
  if (!safeSourceHref) return `/jobs/${jobId}`;

  const params = new URLSearchParams({ from: safeSourceHref });
  return `/jobs/${jobId}?${params.toString()}`;
}

export function getJobsReturnLabel(returnHref?: string | null) {
  return returnHref?.startsWith("/jobs/top-picks") ? "Top picks" : "Jobs";
}
