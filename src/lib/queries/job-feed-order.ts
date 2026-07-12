import type { Prisma } from "@/generated/prisma/client";

import type { JobSortBy } from "./jobs";

// Every paginated feed ordering ends with a unique, deterministic tiebreaker so
// that rows tied on the sort key (e.g. identical postedAt/rankingScore) keep a
// stable total order across skip/take page boundaries. Without it, tied rows can
// be silently dropped or duplicated between adjacent pages.
const FEED_INDEX_TIEBREAKER: Prisma.JobFeedIndexOrderByWithRelationInput = {
  canonicalJobId: "desc",
};
const CANONICAL_TIEBREAKER: Prisma.JobCanonicalOrderByWithRelationInput = {
  id: "desc",
};

export function buildJobFeedIndexOrderBy(
  sortBy: JobSortBy | undefined
): Prisma.JobFeedIndexOrderByWithRelationInput[] {
  if (sortBy === "deadline") {
    return [
      { deadline: { sort: "asc", nulls: "last" } },
      { rankingScore: "desc" },
      { freshnessScore: "desc" },
      { postedAt: "desc" },
      FEED_INDEX_TIEBREAKER,
    ];
  }
  if (sortBy === "newest") {
    return [{ postedAt: "desc" }, FEED_INDEX_TIEBREAKER];
  }
  if (sortBy === "company") {
    return [{ company: "asc" }, { postedAt: "desc" }, FEED_INDEX_TIEBREAKER];
  }
  return [
    { rankingScore: "desc" },
    { freshnessScore: "desc" },
    { qualityScore: "desc" },
    { trustScore: "desc" },
    { postedAt: "desc" },
    FEED_INDEX_TIEBREAKER,
  ];
}

export function buildCanonicalFeedOrderBy(
  sortBy: JobSortBy | undefined
): Prisma.JobCanonicalOrderByWithRelationInput[] {
  if (sortBy === "deadline") {
    return [
      { deadline: { sort: "asc", nulls: "last" } },
      { postedAt: "desc" },
      CANONICAL_TIEBREAKER,
    ];
  }
  if (sortBy === "company") {
    return [{ company: "asc" }, { postedAt: "desc" }, CANONICAL_TIEBREAKER];
  }
  return [{ postedAt: "desc" }, CANONICAL_TIEBREAKER];
}
