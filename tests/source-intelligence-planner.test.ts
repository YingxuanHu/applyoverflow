import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceIntelligencePlan,
  type PlannerCompanyCoverageGap,
  type PlannerCompanySource,
  type PlannerSourceCandidate,
} from "@/lib/ingestion/source-intelligence-planner";

const NOW = new Date("2026-06-25T12:00:00.000Z");

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function source(overrides: Partial<PlannerCompanySource> = {}): PlannerCompanySource {
  return {
    id: "source-1",
    companyId: "company-1",
    companyName: "Example Co",
    sourceName: "Example Co official",
    connectorName: "company-site",
    sourceType: "OFFICIAL_COMPANY_CAREERS",
    extractionRoute: "ATS_ENDPOINT",
    boardUrl: "https://example.com/careers",
    status: "ACTIVE",
    validationState: "VALIDATED",
    pollState: "READY",
    sourceQualityScore: 0.9,
    yieldScore: 0.55,
    priorityScore: 4,
    retainedLiveJobCount: 90,
    cooldownUntil: null,
    lastSuccessfulPollAt: hoursAgo(8),
    lastFailureAt: null,
    consecutiveFailures: 0,
    failureStreak: 0,
    pollAttemptCount: 10,
    pollSuccessCount: 9,
    jobsAcceptedCount: 400,
    jobsCreatedCount: 120,
    lastJobsAcceptedCount: 80,
    lastJobsCreatedCount: 20,
    recentRunCount: 4,
    recentFailedRunCount: 0,
    recentAcceptedCount: 180,
    recentCreatedCount: 45,
    recentDedupedCount: 120,
    recentRuntimeMs: 90_000,
    ...overrides,
  };
}

function candidate(overrides: Partial<PlannerSourceCandidate> = {}): PlannerSourceCandidate {
  return {
    id: "candidate-1",
    companyId: "company-2",
    companyName: "Candidate Co",
    companyNameHint: "Candidate Co",
    candidateType: "ATS_ENDPOINT",
    status: "NEW",
    candidateUrl: "https://candidate.example/jobs",
    rootDomain: "candidate.example",
    atsPlatform: "greenhouse",
    confidence: 0.92,
    noveltyScore: 0.8,
    coverageGapScore: 0.9,
    potentialYieldScore: 0.85,
    sourceQualityScore: 0.88,
    failureCount: 0,
    ...overrides,
  };
}

function coverageGap(
  overrides: Partial<PlannerCompanyCoverageGap> = {}
): PlannerCompanyCoverageGap {
  return {
    companyId: "company-3",
    companyName: "Gap Co",
    domain: "gap.example",
    careersUrl: "https://gap.example/careers",
    sourceCount: 2,
    activeSourceCount: 1,
    validatedSourceCount: 1,
    feedLiveJobCount: 0,
    canonicalVisibleJobCount: 12,
    maxSourceQualityScore: 0.86,
    maxPriorityScore: 3,
    ...overrides,
  };
}

test("planner polls stale validated high-yield sources", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [source()],
    options: { now: NOW },
  });

  assert.equal(action.kind, "POLL_SOURCE");
  assert.equal(action.sourceTaskKind, "CONNECTOR_POLL");
  assert.equal(action.companySourceId, "source-1");
  assert.ok(action.priorityScore >= 45);
});

test("planner validates uncertain sources before polling", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [
      source({
        validationState: "SUSPECT",
        status: "DEGRADED",
        retainedLiveJobCount: 0,
        recentCreatedCount: 0,
        lastJobsCreatedCount: 0,
      }),
    ],
    options: { now: NOW },
  });

  assert.equal(action.kind, "VALIDATE_SOURCE");
  assert.equal(action.sourceTaskKind, "SOURCE_VALIDATION");
});

test("planner routes repairable degraded sources to rediscovery", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [
      source({
        status: "REDISCOVER_REQUIRED",
        validationState: "NEEDS_REDISCOVERY",
        pollState: "BACKOFF",
        consecutiveFailures: 18,
        retainedLiveJobCount: 0,
      }),
    ],
    options: { now: NOW },
  });

  assert.equal(action.kind, "REDISCOVER_SOURCE");
  assert.equal(action.sourceTaskKind, "REDISCOVERY");
});

test("planner only recommends cooldown for repeatedly failing no-yield sources", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [
      source({
        status: "DEGRADED",
        validationState: "VALIDATED",
        pollState: "BACKOFF",
        sourceQualityScore: 0.12,
        yieldScore: 0,
        retainedLiveJobCount: 0,
        jobsCreatedCount: 0,
        lastJobsCreatedCount: 0,
        recentCreatedCount: 0,
        consecutiveFailures: 35,
        failureStreak: 12,
        recentRunCount: 10,
        recentFailedRunCount: 10,
      }),
    ],
    options: { now: NOW },
  });

  assert.equal(action.kind, "COOLDOWN_LOW_VALUE");
  assert.equal(action.sourceTaskKind, undefined);
});

test("planner surfaces high-potential source candidates for review", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [],
    candidates: [candidate()],
    options: { now: NOW },
  });

  assert.equal(action.kind, "REVIEW_CANDIDATE");
  assert.equal(action.sourceCandidateId, "candidate-1");
});

test("planner surfaces companies with sources but low visible coverage", () => {
  const [action] = buildSourceIntelligencePlan({
    sources: [],
    coverageGaps: [coverageGap()],
    options: { now: NOW },
  });

  assert.equal(action.kind, "REVIEW_COVERAGE_GAP");
  assert.equal(action.companyId, "company-3");
});

test("planner sorts by priority, dedupes duplicate source actions, and honors limit", () => {
  const actions = buildSourceIntelligencePlan({
    sources: [
      source({ id: "source-stale", sourceName: "Stale", priorityScore: 1, retainedLiveJobCount: 20 }),
      source({
        id: "source-redisc",
        sourceName: "Rediscover",
        status: "REDISCOVER_REQUIRED",
        validationState: "NEEDS_REDISCOVERY",
        consecutiveFailures: 30,
        priorityScore: 8,
      }),
      source({
        id: "source-redisc",
        sourceName: "Rediscover duplicate",
        status: "REDISCOVER_REQUIRED",
        validationState: "NEEDS_REDISCOVERY",
        consecutiveFailures: 30,
        priorityScore: 8,
      }),
    ],
    candidates: [candidate({ id: "candidate-priority", potentialYieldScore: 1 })],
    options: { now: NOW, limit: 3 },
  });

  assert.equal(actions.length, 3);
  assert.deepEqual(
    actions.map((action) => action.priorityScore),
    [...actions.map((action) => action.priorityScore)].sort((a, b) => b - a)
  );
  assert.equal(
    actions.filter((action) => action.companySourceId === "source-redisc").length,
    1
  );
});

test("planner can cap each action kind so poll work does not starve repair/review actions", () => {
  const actions = buildSourceIntelligencePlan({
    sources: [
      source({ id: "poll-1", sourceName: "Poll 1", priorityScore: 9 }),
      source({ id: "poll-2", sourceName: "Poll 2", priorityScore: 8 }),
      source({
        id: "repair-1",
        sourceName: "Repair 1",
        status: "REDISCOVER_REQUIRED",
        validationState: "NEEDS_REDISCOVERY",
        pollState: "BACKOFF",
        consecutiveFailures: 20,
        retainedLiveJobCount: 0,
      }),
    ],
    candidates: [candidate({ id: "candidate-1" })],
    coverageGaps: [coverageGap({ companyId: "gap-1" })],
    options: {
      now: NOW,
      limit: 10,
      perKindLimit: {
        POLL_SOURCE: 1,
        REDISCOVER_SOURCE: 1,
        REVIEW_CANDIDATE: 1,
        REVIEW_COVERAGE_GAP: 1,
      },
    },
  });

  assert.equal(actions.filter((action) => action.kind === "POLL_SOURCE").length, 1);
  assert.equal(actions.filter((action) => action.kind === "REDISCOVER_SOURCE").length, 1);
  assert.equal(actions.filter((action) => action.kind === "REVIEW_CANDIDATE").length, 1);
  assert.equal(actions.filter((action) => action.kind === "REVIEW_COVERAGE_GAP").length, 1);
});
