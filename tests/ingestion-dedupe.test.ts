import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";

import type { CanonicalMatchCandidate } from "../src/lib/ingestion/dedupe";
import type { SourceIdentitySnapshot } from "../src/lib/ingestion/source-quality";
import type { NormalizedJobInput } from "../src/lib/ingestion/types";

let dedupeModulePromise:
  | Promise<typeof import("../src/lib/ingestion/dedupe")>
  | null = null;

function loadDedupeModule() {
  dedupeModulePromise ??= import("../src/lib/ingestion/dedupe");
  return dedupeModulePromise;
}

type DedupeBuilder = typeof import("../src/lib/ingestion/dedupe")["buildCanonicalDedupeFields"];

function buildNormalizedJob(
  overrides: Partial<NormalizedJobInput>,
  buildCanonicalDedupeFields: DedupeBuilder
): NormalizedJobInput {
  const description =
    overrides.description ??
    "Build product systems with reliable services and cross-functional collaboration.";
  const dedupe = buildCanonicalDedupeFields({
    company: overrides.company ?? "Example Company",
    title: overrides.title ?? "Software Engineer",
    description,
    location: overrides.location ?? "Toronto, ON, Canada",
    region: overrides.region ?? "CA",
    applyUrl: overrides.applyUrl ?? "https://example.com/jobs/one",
  });

  return {
    title: overrides.title ?? "Software Engineer",
    company: overrides.company ?? "Example Company",
    companyKey: overrides.companyKey ?? dedupe.companyKey,
    titleKey: overrides.titleKey ?? dedupe.titleKey,
    titleCoreKey: overrides.titleCoreKey ?? dedupe.titleCoreKey,
    descriptionFingerprint:
      overrides.descriptionFingerprint ?? dedupe.descriptionFingerprint,
    location: overrides.location ?? "Toronto, ON, Canada",
    locationKey: overrides.locationKey ?? dedupe.locationKey,
    region: overrides.region ?? "CA",
    workMode: overrides.workMode ?? "ONSITE",
    salaryMin: overrides.salaryMin ?? null,
    salaryMax: overrides.salaryMax ?? null,
    salaryCurrency: overrides.salaryCurrency ?? null,
    employmentType: overrides.employmentType ?? "FULL_TIME",
    experienceLevel: overrides.experienceLevel ?? "UNKNOWN",
    description,
    shortSummary: overrides.shortSummary ?? description,
    industry: overrides.industry ?? "TECH",
    roleFamily: overrides.roleFamily ?? "Engineering",
    normalizedEmploymentType: overrides.normalizedEmploymentType ?? "FULL_TIME",
    normalizedEmploymentTypeConfidence: overrides.normalizedEmploymentTypeConfidence ?? 0.9,
    normalizedCareerStage: overrides.normalizedCareerStage ?? "UNKNOWN",
    normalizedCareerStageConfidence: overrides.normalizedCareerStageConfidence ?? 0.2,
    normalizedIndustry: overrides.normalizedIndustry ?? "TECHNOLOGY",
    normalizedIndustries: overrides.normalizedIndustries ?? [overrides.normalizedIndustry ?? "TECHNOLOGY"],
    normalizedIndustryConfidence: overrides.normalizedIndustryConfidence ?? 0.8,
    normalizedRoleCategory: overrides.normalizedRoleCategory ?? "SOFTWARE_ENGINEERING",
    normalizedRoleCategoryConfidence: overrides.normalizedRoleCategoryConfidence ?? 0.9,
    classificationStatus: overrides.classificationStatus ?? "CONFIDENT",
    applyUrl: overrides.applyUrl ?? "https://example.com/jobs/one",
    applyUrlKey: overrides.applyUrlKey ?? dedupe.applyUrlKey,
    postedAt: overrides.postedAt ?? new Date("2026-05-01T00:00:00.000Z"),
    deadline: overrides.deadline ?? null,
    duplicateClusterId: overrides.duplicateClusterId ?? dedupe.duplicateClusterId,
  };
}

function buildCandidate(job: NormalizedJobInput): CanonicalMatchCandidate {
  return {
    id: "candidate",
    applyUrl: job.applyUrl,
    description: job.description,
    shortSummary: job.shortSummary,
    postedAt: job.postedAt,
    deadline: job.deadline,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    companyKey: job.companyKey,
    titleKey: job.titleKey,
    titleCoreKey: job.titleCoreKey,
    descriptionFingerprint: job.descriptionFingerprint,
    locationKey: job.locationKey,
    applyUrlKey: job.applyUrlKey,
    roleFamily: job.roleFamily,
    workMode: job.workMode,
  };
}

test("dedupe rejects same generic title when location and description differ", () => {
  return loadDedupeModule().then(
    ({ isCanonicalMatchCompatible, buildCanonicalDedupeFields }) => {
  const candidateJob = buildNormalizedJob({
    company: "Oraclecloud",
    title: "Driver",
    description: "Shuttle airport customers in Saint Louis.",
    location: "Saint Louis, MO, United States",
    applyUrl: "https://fa.example.oraclecloud.com/jobs/33871",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);
  const incomingJob = buildNormalizedJob({
    company: "Oraclecloud",
    title: "Driver",
    description: "Move rental vehicles and serve customers in Miami.",
    location: "Miami, FL, United States",
    applyUrl: "https://fa.example.oraclecloud.com/jobs/35193",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);

  assert.equal(
    isCanonicalMatchCompatible(incomingJob, buildCandidate(candidateJob)),
    false
  );
    }
  );
});

test("dedupe keeps matching specific jobs with strong content and location evidence", () => {
  return loadDedupeModule().then(
    ({ isCanonicalMatchCompatible, buildCanonicalDedupeFields }) => {
  const candidateJob = buildNormalizedJob({
    title: "Senior Platform Reliability Engineer",
    description:
      "Own Kubernetes reliability, incident response, observability, service level objectives, infrastructure automation, and platform tooling.",
    shortSummary:
      "Own Kubernetes reliability, incident response, observability, service level objectives, infrastructure automation, and platform tooling.",
    location: "Berlin, Germany",
    applyUrl: "https://example.com/jobs/platform-one",
  }, buildCanonicalDedupeFields);
  const incomingJob = buildNormalizedJob({
    title: "Senior Platform Reliability Engineer",
    description:
      "Own Kubernetes reliability, incident response, observability, service level objectives, infrastructure automation, and platform tooling.",
    shortSummary:
      "Own Kubernetes reliability, incident response, observability, service level objectives, infrastructure automation, and platform tooling.",
    location: "Berlin, Germany",
    applyUrl: "https://ats.example.com/jobs/platform-one",
  }, buildCanonicalDedupeFields);

  assert.equal(
    isCanonicalMatchCompatible(incomingJob, buildCandidate(candidateJob)),
    true
  );
    }
  );
});

test("dedupe rejects same official-style posting content when location differs", () => {
  return loadDedupeModule().then(
    ({ isCanonicalMatchCompatible, buildCanonicalDedupeFields }) => {
  const description =
    "Operate data center systems, perform hardware maintenance, troubleshoot infrastructure, coordinate vendor access, and maintain operational standards.";
  const candidateJob = buildNormalizedJob({
    company: "Amazon",
    title: "Data Center Technician",
    description,
    shortSummary: description,
    location: "Wink, Texas, USA",
    applyUrl: "https://www.amazon.jobs/applicant/jobs/10380427/apply",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);
  const incomingJob = buildNormalizedJob({
    company: "Amazon",
    title: "Data Center Technician",
    description,
    shortSummary: description,
    location: "Sparks, Nevada, USA",
    applyUrl: "https://www.amazon.jobs/applicant/jobs/10382224/apply",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);

  assert.equal(
    isCanonicalMatchCompatible(incomingJob, buildCandidate(candidateJob)),
    false
  );
    }
  );
});

test("first-party source compatibility requires exact apply URL identity", () => {
  return loadDedupeModule().then(
    ({
      isCanonicalMatchCompatible,
      isCanonicalMatchCompatibleForSource,
      buildCanonicalDedupeFields,
    }) => {
  const description =
    "Maintain data center systems, diagnose hardware failures, coordinate repairs, and operate critical infrastructure.";
  const candidateJob = buildNormalizedJob({
    company: "Amazon",
    title: "Data Center Engineering Operations Technician",
    description,
    shortSummary: description,
    location: "Sterling, Virginia, USA",
    applyUrl: "https://www.amazon.jobs/applicant/jobs/10377504/apply",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);
  const incomingJob = buildNormalizedJob({
    company: "Amazon",
    title: "Data Center Technician",
    description,
    shortSummary: description,
    location: "Sterling, Virginia, USA",
    applyUrl: "https://www.amazon.jobs/applicant/jobs/10407886/apply",
    roleFamily: "Operations",
    industry: "GENERAL",
  }, buildCanonicalDedupeFields);
  const sourceIdentity: SourceIdentitySnapshot = {
    sourceFamily: "OfficialCompany",
    sourceQualityKind: "FIRST_PARTY_COMPANY",
    sourceQualityRank: 1125,
    sourceTrustTier: "HIGH",
    canonicalOriginPreference: "PRIMARY",
    applyUrlKey: incomingJob.applyUrlKey,
    sourceUrlKey: null,
    postingIdKey: "OfficialCompany:10407886",
  };

  assert.equal(
    isCanonicalMatchCompatible(incomingJob, buildCandidate(candidateJob)),
    true
  );
  assert.equal(
    isCanonicalMatchCompatibleForSource(
      incomingJob,
      buildCandidate(candidateJob),
      sourceIdentity
    ),
    false
  );
    }
  );
});
