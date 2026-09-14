export type FeedPosition = {
  jobId: string;
  listTop: number;
  detailTop: number;
  savedAt: number;
};

export function feedPositionKey(owner: string, href: string) {
  const url = new URL(href, "https://applyoverflow.local");
  url.searchParams.delete("reset");
  url.searchParams.sort();
  return `job-position:${owner}:${url.pathname}?${url.searchParams}`;
}

export function parseFeedPosition(
  value: string | null,
  now = Date.now(),
): FeedPosition | null {
  try {
    const position = JSON.parse(value ?? "null") as FeedPosition | null;
    if (
      !position ||
      typeof position.jobId !== "string" ||
      position.jobId.length > 200
    )
      return null;
    if (
      ![position.listTop, position.detailTop, position.savedAt].every(
        Number.isFinite,
      )
    )
      return null;
    if (
      position.listTop < 0 ||
      position.detailTop < 0 ||
      position.savedAt > now ||
      now - position.savedAt > 86_400_000
    )
      return null;
    return position;
  } catch {
    return null;
  }
}

export function jobIdFromHash(hash: string) {
  return /^#job-[A-Za-z0-9_-]+$/.test(hash) ? hash.slice(5) : null;
}
