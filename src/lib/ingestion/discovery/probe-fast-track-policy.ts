import type { AtsSlugIdentityVerdict } from "@/lib/ingestion/discovery/ats-slug-probe";

// Fast-track policy for ATS slug-probe hits.
//
// The slug-probe discovers ~20 net-new boards/day and registers each as a
// SourceCandidate in status=NEW. Every hit here is identity-VERIFIED (the
// board self-reports an org name that matches the company we probed for), yet
// those fresh candidates then have to compete for validation against a backlog
// of ~549k old, mostly-dead candidates in the exploration scheduler's ranking.
// In practice only ~1-2/day are ever validated and promoted to a pollable
// CompanySource, so the clean discovery engine's real yield is wasted sitting
// in a clogged queue.
//
// When a probe hit is high-confidence — identityVerdict === "match" AND it
// carries a meaningful number of live postings — we fast-track it: the probe
// enqueues a SOURCE_VALIDATION task directly for that candidate, bypassing the
// scheduler ranking entirely so a fresh identity-verified board does not starve
// behind the 549k dead candidates. Unverified/mismatch/low-job hits are NOT
// fast-tracked; they still register normally and flow through the standard
// pipeline, where ownership scoring and validation settle them.

export type ProbeFastTrackInput = {
  identityVerdict: AtsSlugIdentityVerdict;
  jobCount: number | null;
};

// A board must expose at least this many live postings to earn a fast-track.
// Identity-verified boards with only a posting or two are usually low-yield or
// stub tenants; the standard pipeline can still pick them up later.
export const FAST_TRACK_MIN_JOBS = 3;

// Priority for a fast-tracked SOURCE_VALIDATION task. Comfortably above typical
// exploration priorities (computeExplorationPriorityScore tops out ~70 for a
// strong ATS board), so a fresh identity-verified board jumps ahead of the
// backlog it would otherwise starve behind.
export const FAST_TRACK_VALIDATION_PRIORITY = 100;

export function shouldFastTrackProbeHit(input: ProbeFastTrackInput): boolean {
  return (
    input.identityVerdict === "match" &&
    (input.jobCount ?? 0) >= FAST_TRACK_MIN_JOBS
  );
}
