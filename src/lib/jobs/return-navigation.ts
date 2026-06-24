const JOBS_RETURN_PATHS = new Set(["/jobs", "/jobs/top-picks"]);
const SAFE_RETURN_HASH_PATTERN = /^#[A-Za-z0-9_-]+$/;

export function getSafeJobsReturnHref(rawHref?: string | null) {
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, "https://applyoverflow.local");
    if (parsed.origin !== "https://applyoverflow.local") return null;
    if (!JOBS_RETURN_PATHS.has(parsed.pathname)) return null;

    const safeHash = SAFE_RETURN_HASH_PATTERN.test(parsed.hash) ? parsed.hash : "";
    return `${parsed.pathname}${parsed.search}${safeHash}`;
  } catch {
    return null;
  }
}

export function buildJobDetailHref(
  jobId: string,
  sourceHref?: string | null,
  anchorId?: string | null
) {
  const safeSourceHref = getSafeJobsReturnHref(
    anchorId ? withJobsReturnAnchor(sourceHref, anchorId) : sourceHref
  );
  if (!safeSourceHref) return `/jobs/${jobId}`;

  const params = new URLSearchParams({ from: safeSourceHref });
  return `/jobs/${jobId}?${params.toString()}`;
}

export function getJobsReturnLabel(returnHref?: string | null) {
  return returnHref?.startsWith("/jobs/top-picks") ? "Top picks" : "Jobs";
}

export function buildJobsReturnAnchorHash(anchorId: string) {
  const safeId = anchorId.replace(/[^A-Za-z0-9_-]/g, "_");
  return safeId ? `#job-${safeId}` : "";
}

function withJobsReturnAnchor(href: string | null | undefined, anchorId: string) {
  if (!href) return href;

  try {
    const parsed = new URL(href, "https://applyoverflow.local");
    parsed.hash = buildJobsReturnAnchorHash(anchorId);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return href;
  }
}
