import test from "node:test";
import assert from "node:assert/strict";

test("relevance score prefers jobs matching the user's location, stage, work mode, and skills", async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoapplication_test";
  const { scoreJobDetailed } = await import("../src/lib/queries/jobs");

  const prefs = {
    roleFamilies: [],
    workModes: [],
  };

  const behavior = {
    boostedRoleFamilies: new Set<string>(),
    suppressedRoleFamilies: new Set<string>(),
    boostedCompanies: new Set<string>(),
  };

  const profile = {
    location: "toronto ontario canada",
    locationRegion: "CA" as const,
    preferredWorkMode: "HYBRID",
    experienceLevel: "MID",
    salaryMin: 90_000,
    salaryMax: 160_000,
    salaryCurrency: "CAD" as const,
    summaryPhrases: ["typescript react"],
    summaryTokens: new Set(["typescript", "react"]),
    experiencePhrases: ["software engineer"],
    experienceTokens: new Set(["software", "engineer"]),
    skillPhrases: ["typescript", "react", "postgresql"],
    educationPhrases: [],
  };

  function makeJob(overrides: Record<string, unknown> = {}) {
    return {
      title: "Software Engineer",
      location: "Toronto, Ontario, Canada",
      postedAt: new Date(),
      status: "LIVE",
      availabilityScore: 95,
      region: "CA",
      workMode: "HYBRID",
      roleFamily: "SWE",
      experienceLevel: "MID",
      salaryMin: 100_000,
      salaryMax: 140_000,
      salaryCurrency: "CAD",
      shortSummary: "Build TypeScript and React product features.",
      company: "Example Co",
      eligibility: { submissionCategory: "MANUAL_ONLY" },
      sourceMappings: [{ sourceName: "Greenhouse:Example", sourceQualityRank: 90, sourceReliability: 0.9 }],
      ...overrides,
    };
  }

  const strongMatch = scoreJobDetailed(makeJob(), prefs, behavior, profile).total;
  const weakMatch = scoreJobDetailed(
    makeJob({
      title: "Senior Accountant",
      location: "New York, NY, United States",
      region: "US",
      workMode: "ONSITE",
      roleFamily: "Finance",
      experienceLevel: "SENIOR",
      shortSummary: "Prepare reports and reconciliations.",
      sourceMappings: [{ sourceName: "CompanyCareer:Example", sourceReliability: 0.55 }],
    }),
    prefs,
    behavior,
    profile
  ).total;

  assert.ok(strongMatch > weakMatch + 15);
});
