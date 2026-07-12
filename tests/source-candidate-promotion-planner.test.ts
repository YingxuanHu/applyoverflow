import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceCandidatePromotionPlan,
  detectPromotionCandidateSource,
  selectPromotionValidationActions,
  scoreCandidateOwnership,
  type ExistingPromotionSource,
  type SourceCandidatePromotionAction,
  type PromotionCandidate,
} from "../src/lib/ingestion/source-candidate-promotion-planner";

function candidate(
  overrides: Partial<PromotionCandidate> = {}
): PromotionCandidate {
  return {
    id: "candidate_1",
    companyId: "company_1",
    company: {
      id: "company_1",
      name: "Acme",
      companyKey: "acme",
      domain: "acme.com",
      careersUrl: "https://acme.com/careers",
    },
    atsTenantId: "tenant_1",
    candidateType: "ATS_BOARD",
    status: "VALIDATED",
    candidateUrl: "https://jobs.ashbyhq.com/acme",
    rootDomain: "ashbyhq.com",
    companyNameHint: "Acme",
    atsPlatform: "ASHBY",
    atsTenantKey: "acme",
    confidence: 0.92,
    noveltyScore: 0.8,
    coverageGapScore: 0.82,
    potentialYieldScore: 0.86,
    sourceQualityScore: 0.82,
    failureCount: 0,
    lastValidatedAt: new Date(),
    ...overrides,
  };
}

function existingSource(
  overrides: Partial<ExistingPromotionSource> = {}
): ExistingPromotionSource {
  return {
    id: "source_1",
    companyId: "company_1",
    connectorName: "ashby",
    token: "acme",
    sourceName: "Ashby:acme",
    boardUrl: "https://jobs.ashbyhq.com/acme",
    status: "ACTIVE",
    ...overrides,
  };
}

function validationAction(
  kind: "VALIDATE_ATS_SOURCE" | "VALIDATE_COMPANY_SITE",
  id: string
): SourceCandidatePromotionAction {
  return {
    kind,
    priorityScore: 90,
    candidateId: id,
    candidateStatus: "NEW",
    validationTaskKey: `${id}:candidate-validation:standard:unvalidated`,
    companyId: "company_1",
    companyName: "Acme",
    candidateUrl: `https://example.com/${id}`,
    detectedSource:
      kind === "VALIDATE_ATS_SOURCE"
        ? {
            connectorName: "lever",
            token: id,
            sourceName: `Lever:${id}`,
            boardUrl: `https://jobs.lever.co/${id}`,
            atsPlatform: "LEVER",
          }
        : null,
    ownership: { score: 0.8, reasons: [] },
    reason: "test",
    evidence: [],
    canApply: false,
  };
}

test("detectPromotionCandidateSource normalizes direct ATS URLs", () => {
  const detected = detectPromotionCandidateSource(candidate());

  assert.deepEqual(detected, {
    connectorName: "ashby",
    token: "acme",
    sourceName: "Ashby:acme",
    boardUrl: "https://jobs.ashbyhq.com/acme",
    atsPlatform: "ASHBY",
  });
});

test("detectPromotionCandidateSource normalizes Oracle Cloud HCM URLs without a Prisma ATS enum", () => {
  const detected = detectPromotionCandidateSource(
    candidate({
      atsTenantId: null,
      atsPlatform: null,
      atsTenantKey: null,
      candidateUrl:
        "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions",
    })
  );

  assert.deepEqual(detected, {
    connectorName: "oraclecloud",
    token: "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com|cx",
    sourceName: "OracleCloud:fa-ewgu-saasfaprod1.fa.ocs",
    boardUrl:
      "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions",
    atsPlatform: null,
  });
});

test("scoreCandidateOwnership uses company and ATS ownership signals", () => {
  const ownership = scoreCandidateOwnership(candidate());

  assert.ok(ownership.score >= 0.5);
  assert.ok(ownership.reasons.includes("candidate-linked-to-company"));
  assert.ok(ownership.reasons.includes("company-name-hint-exact-match"));
  assert.ok(ownership.reasons.includes("ats-token-contains-company-key"));
});

test("buildSourceCandidatePromotionPlan promotes strong owned ATS candidates", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [candidate()],
    existingSources: [],
  });

  assert.equal(action?.kind, "PROMOTE_ATS_SOURCE");
  assert.equal(action?.canApply, true);
  assert.equal(action?.detectedSource?.connectorName, "ashby");
});

test("buildSourceCandidatePromotionPlan repairs promoted ATS candidates missing their source", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        status: "PROMOTED",
        repairMissingSource: true,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "PROMOTE_ATS_SOURCE");
  assert.ok(action?.evidence.includes("repair-missing-company-source"));
});

test("buildSourceCandidatePromotionPlan still skips intact promoted candidates", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [candidate({ status: "PROMOTED" })],
    existingSources: [],
  });

  assert.equal(action?.kind, "SKIP_DUPLICATE");
});

test("buildSourceCandidatePromotionPlan promotes validated owned Oracle Cloud sources", () => {
  const oracleUrl =
    "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions";
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
        candidateUrl: oracleUrl,
        rootDomain: "oraclecloud.com",
        company: {
          id: "company_1",
          name: "Acme",
          companyKey: "acme",
          domain: "acme.com",
          careersUrl: oracleUrl,
        },
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "PROMOTE_ATS_SOURCE");
  assert.equal(action?.canApply, true);
  assert.equal(action?.detectedSource?.connectorName, "oraclecloud");
  assert.equal(
    action?.detectedSource?.token,
    "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com|cx"
  );
});

test("buildSourceCandidatePromotionPlan skips duplicate Oracle Cloud sources", () => {
  const oracleUrl =
    "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions";
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
        candidateUrl: oracleUrl,
        rootDomain: "oraclecloud.com",
        company: {
          id: "company_1",
          name: "Acme",
          companyKey: "acme",
          domain: "acme.com",
          careersUrl: oracleUrl,
        },
      }),
    ],
    existingSources: [
      existingSource({
        connectorName: "oraclecloud",
        token: "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com|cx",
        sourceName: "OracleCloud:fa-ewgu-saasfaprod1.fa.ocs",
        boardUrl: oracleUrl,
      }),
    ],
  });

  assert.equal(action?.kind, "SKIP_DUPLICATE");
  assert.equal(action?.existingSourceId, "source_1");
});

test("buildSourceCandidatePromotionPlan skips duplicate ATS tenants for the same company", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [candidate()],
    existingSources: [existingSource()],
  });

  assert.equal(action?.kind, "SKIP_DUPLICATE");
  assert.equal(action?.existingSourceId, "source_1");
});

test("buildSourceCandidatePromotionPlan flags duplicate ATS tenants owned by another company", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [candidate()],
    existingSources: [existingSource({ companyId: "other_company" })],
  });

  assert.equal(action?.kind, "SKIP_CONFLICT");
  assert.equal(action?.canApply, false);
});

test("buildSourceCandidatePromotionPlan refuses weak ownership even with an ATS route", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        company: {
          id: "company_1",
          name: "Different Corp",
          companyKey: "different-corp",
          domain: "different.example",
          careersUrl: "https://different.example/careers",
        },
        companyNameHint: null,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "MANUAL_REVIEW");
  assert.match(action?.reason ?? "", /ownership/i);
});

test("buildSourceCandidatePromotionPlan does not auto-promote generic SuccessFactors hosts", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        id: "successfactors_generic",
        candidateUrl: "https://career2.successfactors.eu/career",
        atsPlatform: "SUCCESSFACTORS",
        atsTenantKey: "career2|career",
        confidence: 0.99,
        potentialYieldScore: 0.9,
        sourceQualityScore: 0.95,
        coverageGapScore: 0.95,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_ATS_SOURCE");
  assert.equal(action?.canApply, false);
});

test("buildSourceCandidatePromotionPlan promotes safe recently validated company career pages", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
        candidateUrl: "https://acme.com/careers",
        rootDomain: "acme.com",
        confidence: 0.86,
        potentialYieldScore: 0.9,
        sourceQualityScore: 0.72,
        coverageGapScore: 0.85,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "PROMOTE_COMPANY_SITE_SOURCE");
  assert.equal(action?.canApply, true);
});

test("buildSourceCandidatePromotionPlan validates weak company career pages instead of auto-promoting", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
        candidateUrl: "https://acme.com/careers",
        rootDomain: "acme.com",
        confidence: 0.78,
        potentialYieldScore: 0.62,
        sourceQualityScore: 0.58,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_COMPANY_SITE");
  assert.equal(action?.canApply, false);
});

test("buildSourceCandidatePromotionPlan revalidates stale company career pages before promotion", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
        candidateUrl: "https://acme.com/careers",
        rootDomain: "acme.com",
        confidence: 0.9,
        potentialYieldScore: 0.9,
        sourceQualityScore: 0.8,
        coverageGapScore: 0.9,
        lastValidatedAt: new Date("2020-01-01T00:00:00Z"),
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_COMPANY_SITE");
  assert.equal(action?.canApply, false);
});

test("buildSourceCandidatePromotionPlan validates stale ATS candidates before promotion", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [candidate({ lastValidatedAt: new Date("2020-01-01T00:00:00Z") })],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_ATS_SOURCE");
  assert.equal(action?.canApply, false);
  assert.match(action?.validationTaskKey ?? "", /candidate-validation:standard:2020/);
});

test("buildSourceCandidatePromotionPlan uses a stable validation key for a fresh candidate", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        confidence: 0.65,
        potentialYieldScore: 0.55,
        sourceQualityScore: 0.5,
        coverageGapScore: 0.55,
        noveltyScore: 0.2,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_ATS_SOURCE");
  assert.match(action?.validationTaskKey ?? "", /^candidate_1:candidate-validation:standard:/);
});

test("buildSourceCandidatePromotionPlan gives an aged stale validation a new epoch key", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        status: "STALE",
        lastValidatedAt: new Date("2020-01-01T00:00:00Z"),
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "VALIDATE_ATS_SOURCE");
  assert.match(action?.validationTaskKey ?? "", /candidate-validation:standard:2020/);
});

test("buildSourceCandidatePromotionPlan keeps ownerless candidates in manual review", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        companyId: null,
        company: null,
        companyNameHint: null,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "MANUAL_REVIEW");
  assert.match(action?.reason ?? "", /company owner/i);
});

test("buildSourceCandidatePromotionPlan rejects repeated low-quality failures", () => {
  const [action] = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        status: "STALE",
        confidence: 0.5,
        potentialYieldScore: 0.2,
        sourceQualityScore: 0.1,
        failureCount: 6,
      }),
    ],
    existingSources: [],
  });

  assert.equal(action?.kind, "REJECT_LOW_QUALITY");
});

test("buildSourceCandidatePromotionPlan prioritizes apply-safe promotions first", () => {
  const actions = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({
        id: "review",
        candidateUrl: "https://example.com/careers",
        atsTenantId: null,
        atsPlatform: null,
        atsTenantKey: null,
        candidateType: "CAREER_PAGE",
      }),
      candidate({ id: "promote" }),
    ],
    existingSources: [],
  });

  assert.equal(actions[0]?.candidateId, "promote");
  assert.equal(actions[0]?.kind, "PROMOTE_ATS_SOURCE");
});

test("buildSourceCandidatePromotionPlan dedupes repeated ATS candidates inside one plan", () => {
  const actions = buildSourceCandidatePromotionPlan({
    candidates: [
      candidate({ id: "first" }),
      candidate({
        id: "second",
        candidateUrl: "https://jobs.ashbyhq.com/acme/jobs",
      }),
    ],
    existingSources: [],
  });

  assert.equal(actions[0]?.kind, "PROMOTE_ATS_SOURCE");
  assert.equal(actions[1]?.kind, "SKIP_DUPLICATE");
  assert.match(actions[1]?.reason ?? "", /same ATS tenant/i);
});

test("selectPromotionValidationActions reserves capacity for ATS validation", () => {
  const actions = [
    validationAction("VALIDATE_COMPANY_SITE", "company_1"),
    validationAction("VALIDATE_COMPANY_SITE", "company_2"),
    validationAction("VALIDATE_COMPANY_SITE", "company_3"),
    validationAction("VALIDATE_ATS_SOURCE", "ats_1"),
    validationAction("VALIDATE_ATS_SOURCE", "ats_2"),
    validationAction("VALIDATE_ATS_SOURCE", "ats_3"),
    validationAction("VALIDATE_ATS_SOURCE", "ats_4"),
  ];

  const selected = selectPromotionValidationActions(actions, {
    limit: 5,
    atsShare: 0.6,
  });

  assert.equal(selected.length, 5);
  assert.equal(
    selected.filter((action) => action.kind === "VALIDATE_ATS_SOURCE").length,
    3
  );
  assert.equal(
    selected.filter((action) => action.kind === "VALIDATE_COMPANY_SITE").length,
    2
  );
});
