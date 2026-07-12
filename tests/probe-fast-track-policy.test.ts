import assert from "node:assert/strict";
import test from "node:test";

import {
  FAST_TRACK_MIN_JOBS,
  shouldFastTrackProbeHit,
} from "@/lib/ingestion/discovery/probe-fast-track-policy";

test("fast-tracks identity-matched hits with enough jobs", () => {
  assert.equal(
    shouldFastTrackProbeHit({ identityVerdict: "match", jobCount: 25 }),
    true
  );
});

test("does not fast-track identity-matched hits below the job threshold", () => {
  assert.equal(
    shouldFastTrackProbeHit({
      identityVerdict: "match",
      jobCount: FAST_TRACK_MIN_JOBS - 1,
    }),
    false
  );
});

test("fast-tracks identity-matched hits exactly at the job boundary", () => {
  assert.equal(
    shouldFastTrackProbeHit({
      identityVerdict: "match",
      jobCount: FAST_TRACK_MIN_JOBS,
    }),
    true
  );
});

test("does not fast-track unverified hits even with many jobs", () => {
  assert.equal(
    shouldFastTrackProbeHit({ identityVerdict: "unverified", jobCount: 100 }),
    false
  );
});

test("does not fast-track identity-mismatch hits even with many jobs", () => {
  assert.equal(
    shouldFastTrackProbeHit({ identityVerdict: "mismatch", jobCount: 100 }),
    false
  );
});

test("treats a null job count as zero and does not fast-track", () => {
  assert.equal(
    shouldFastTrackProbeHit({ identityVerdict: "match", jobCount: null }),
    false
  );
});
