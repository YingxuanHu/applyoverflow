import test from "node:test";
import assert from "node:assert/strict";

import { assessSourceCandidatePreview } from "../src/lib/ingestion/source-candidate-validation";

test("assessSourceCandidatePreview accepts candidates with normalized jobs", () => {
  const assessment = assessSourceCandidatePreview({
    fetchedCount: 8,
    acceptedCount: 5,
    previewCreatedCount: 3,
    previewUpdatedCount: 2,
    sampleTitles: ["Software Engineer", "Data Analyst"],
  });

  assert.equal(assessment.passed, true);
  assert.equal(assessment.kind, "VALIDATED");
  assert.match(assessment.message, /accepted 5 jobs/i);
  assert.ok(assessment.evidence.includes("sample=Software Engineer"));
});

test("assessSourceCandidatePreview rejects preview errors", () => {
  const assessment = assessSourceCandidatePreview({
    error: "404 not found",
    fetchedCount: 0,
    acceptedCount: 0,
  });

  assert.equal(assessment.passed, false);
  assert.equal(assessment.kind, "PREVIEW_ERROR");
  assert.match(assessment.message, /404 not found/i);
});

test("assessSourceCandidatePreview rejects sources that fetch only bad rows", () => {
  const assessment = assessSourceCandidatePreview({
    fetchedCount: 10,
    acceptedCount: 0,
    previewCreatedCount: 0,
  });

  assert.equal(assessment.passed, false);
  assert.equal(assessment.kind, "NO_ACCEPTED_JOBS");
});

test("assessSourceCandidatePreview rejects no-yield candidates", () => {
  const assessment = assessSourceCandidatePreview({
    fetchedCount: 0,
    acceptedCount: 0,
    existingLiveCanonicalCount: 0,
  });

  assert.equal(assessment.passed, false);
  assert.equal(assessment.kind, "NO_YIELD");
});
