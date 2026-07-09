import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert";

import {
  assessUserJobIntentSignal,
  buildUserJobIntent,
  type UserJobIntent,
} from "../src/lib/top-picks/intent";
import {
  scoreJobForUser,
  type TopPickScoringJob,
  type TopPickUserHistory,
} from "../src/lib/top-picks/scoring";

const emptyHistory: TopPickUserHistory = {
  savedJobIds: new Set(),
  appliedJobIds: new Set(),
  excludedJobIds: new Set(),
  suppressedRoleCategories: new Set(),
  suppressedLocations: new Set(),
  suppressedWorkModes: new Set(),
  tooSeniorRoleCategories: new Set(),
  tooJuniorRoleCategories: new Set(),
};

function intent(overrides: Partial<UserJobIntent> = {}): UserJobIntent {
  return {
    userId: "profile_1",
    profileVersion: 1,
    explicitTargetTitles: [],
    inferredTargetTitles: ["full stack software engineer", "backend engineer"],
    explicitTargetRoleCategories: [],
    inferredTargetRoleCategories: ["SOFTWARE_ENGINEERING"],
    excludedRoleCategories: [],
    targetCareerStages: ["ENTRY_JUNIOR"],
    minAcceptableCareerStage: "STUDENT_INTERN",
    maxAcceptableCareerStage: "ENTRY_JUNIOR",
    inferredYearsExperience: 1,
    maxRequiredYears: 3,
    mustHaveSkills: ["typescript", "react"],
    strongSkills: ["typescript", "react", "node", "postgresql"],
    niceToHaveSkills: ["aws"],
    weakSkills: [],
    preferredLocationCity: "Toronto",
    preferredLocationRegion: "Ontario",
    preferredLocationCountry: "Canada",
    openToRemote: true,
    preferredWorkModes: ["REMOTE", "HYBRID"],
    targetSalaryMin: 80_000,
    targetSalaryMax: 150_000,
    targetSalaryCurrency: "CAD",
    positiveSignals: {
      savedJobIds: [],
      appliedJobIds: [],
      likedRoleCategories: [],
      likedTitles: [],
      likedCompanies: [],
      likedSkills: [],
    },
    negativeSignals: {
      rejectedJobIds: [],
      dislikedRoleCategories: [],
      dislikedTitles: [],
      dislikedSeniorityLevels: [],
      dislikedLocations: [],
      dislikedWorkModes: [],
    },
    confidence: {
      roleIntent: 0.86,
      seniorityIntent: 0.82,
      skillIntent: 0.9,
      locationIntent: 0.85,
    },
    experienceSummary:
      "Entry-level full-stack engineer using TypeScript, React, Node, and PostgreSQL.",
    profileHash: "hash",
    ...overrides,
  };
}

function job(overrides: Partial<TopPickScoringJob> = {}): TopPickScoringJob {
  return {
    id: "job_1",
    title: "Junior Full Stack Software Engineer",
    company: "Acme",
    location: "Toronto, Ontario, Canada",
    workMode: "HYBRID",
    status: "LIVE",
    normalizedRoleCategory: "SOFTWARE_ENGINEERING",
    normalizedRoleCategoryConfidence: 0.92,
    normalizedRoleCategoryStatus: "CONFIDENT",
    normalizedCareerStage: "ASSOCIATE_JUNIOR",
    normalizedCareerStageConfidence: 0.84,
    experienceLevelGroup: "ENTRY_JUNIOR",
    experienceLevelEvidenceJson: ["junior title signal", "1-2 years"],
    employmentTypeGroup: "FULL_TIME",
    salaryMin: 90_000,
    salaryMax: 130_000,
    salaryCurrency: "CAD",
    shortSummary:
      "Build React, TypeScript, Node APIs, and PostgreSQL-backed product features.",
    description: null,
    postedAt: new Date(),
    deadline: null,
    applyUrl: "https://example.com/jobs/1",
    applyUrlValidationStatus: "VALID",
    availabilityScore: 90,
    qualityScore: 85,
    trustScore: 90,
    freshnessScore: 90,
    deadSignalAt: null,
    ...overrides,
  };
}

describe("buildUserJobIntent", () => {
  it("reports missing profile signal before recommendations can be generated", () => {
    const readiness = assessUserJobIntentSignal(
      intent({
        explicitTargetTitles: [],
        inferredTargetTitles: [],
        explicitTargetRoleCategories: [],
        inferredTargetRoleCategories: [],
        mustHaveSkills: [],
        strongSkills: [],
        niceToHaveSkills: [],
        weakSkills: [],
        experienceSummary: "",
      })
    );

    strictEqual(readiness.canGenerate, false);
    ok(readiness.missingSignals.some((signal) => signal.includes("target roles")));
  });

  it("allows top picks when the profile has role intent", () => {
    const readiness = assessUserJobIntentSignal(intent());

    strictEqual(readiness.canGenerate, true);
    strictEqual(readiness.missingSignals.length, 0);
  });

  it("requires skill, experience, saved, or applied-job signal in addition to role intent", () => {
    const readiness = assessUserJobIntentSignal(
      intent({
        mustHaveSkills: [],
        strongSkills: [],
        niceToHaveSkills: [],
        weakSkills: [],
        experienceSummary: "",
        positiveSignals: {
          savedJobIds: [],
          appliedJobIds: [],
          likedRoleCategories: [],
          likedTitles: [],
          likedCompanies: [],
          likedSkills: [],
        },
      })
    );

    strictEqual(readiness.canGenerate, false);
    ok(readiness.missingSignals.some((signal) => signal.includes("skills")));
  });

  it("infers realistic role and seniority intent without hardcoding a user", () => {
    const result = buildUserJobIntent({
      userId: "profile_new_grad",
      profileVersion: 1,
      headline: "New grad software engineer",
      summary: "Recent computer science graduate building full-stack web applications.",
      location: "Toronto, Ontario, Canada",
      skillsText: "TypeScript, React, Node, PostgreSQL",
      skills: [{ name: "TypeScript" }, { name: "React" }],
      experiences: [],
      educations: [{ school: "U", degree: "Computer Science", time: "2021-2025", location: "", description: "" }],
      projects: [{ name: "API app", title: "", time: "", location: "", description: "React Node PostgreSQL app" }],
      preferredWorkMode: "HYBRID",
      experienceLevel: null,
    });

    ok(result.inferredTargetRoleCategories.includes("SOFTWARE_ENGINEERING"));
    ok(result.targetCareerStages.includes("ENTRY_JUNIOR"));
    ok((result.maxRequiredYears ?? 0) <= 3);
    ok(result.strongSkills.includes("typescript"));
  });
});

describe("scoreJobForUser v2", () => {
  it("scores a strong role and seniority match highly", () => {
    const result = scoreJobForUser(intent(), job(), emptyHistory);

    strictEqual(result.excluded, false);
    ok(result.score >= 80);
    ok(result.matchReasons.some((reason) => reason.includes("Strong role match")));
  });

  it("stores LinkedIn-style top applicant proxy metadata for explainable ranking", () => {
    const result = scoreJobForUser(intent(), job(), emptyHistory);
    const breakdown = result.scoreBreakdown as {
      strategy?: string;
      components?: Record<string, number>;
    };

    strictEqual(
      breakdown.strategy,
      "linkedin-style-preferences-profile-top-applicant-proxy"
    );
    ok((breakdown.components?.topApplicantFit ?? 0) >= 80);
  });

  it("ranks stronger applicant-fit jobs above shallow role-only matches", () => {
    const strongFit = scoreJobForUser(intent(), job(), emptyHistory);
    const shallowFit = scoreJobForUser(
      intent(),
      job({
        id: "job_shallow",
        title: "Junior Software Engineer",
        shortSummary: "Build product features with a modern engineering team.",
        experienceLevelEvidenceJson: [],
        salaryMin: null,
        salaryMax: null,
        qualityScore: 55,
        trustScore: 55,
      }),
      emptyHistory
    );

    strictEqual(strongFit.excluded, false);
    strictEqual(shallowFit.excluded, false);
    ok(strongFit.score > shallowFit.score);
  });

  it("rejects wrong-role jobs even when they mention matching skills", () => {
    const result = scoreJobForUser(
      intent(),
      job({
        id: "job_wrong_role",
        title: "Developer Marketing Manager",
        normalizedRoleCategory: "MARKETING",
        normalizedRoleCategoryConfidence: 0.91,
        shortSummary:
          "Run developer campaigns using TypeScript, React, Node, APIs, and PostgreSQL examples.",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    strictEqual(result.exclusionReason, "unrelated_role");
  });

  it("rejects too-senior software roles for entry-level profiles", () => {
    const result = scoreJobForUser(
      intent(),
      job({
        id: "job_senior",
        title: "Principal Software Engineer",
        normalizedCareerStage: "STAFF_PRINCIPAL",
        normalizedCareerStageConfidence: 0.92,
        experienceLevelGroup: "SENIOR_LEAD_STAFF",
        shortSummary: "Requires 10+ years leading distributed systems architecture.",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    ok(["requires_too_many_years", "too_senior_for_entry_profile"].includes(result.exclusionReason ?? ""));
  });

  it("lets senior title signals override overly junior stored labels", () => {
    const result = scoreJobForUser(
      intent(),
      job({
        id: "job_avp_manager",
        title: "AVP, Frontend Outsystems Manager",
        normalizedCareerStage: "ASSOCIATE_JUNIOR",
        normalizedCareerStageConfidence: 0.8,
        experienceLevelGroup: "ENTRY_JUNIOR",
        shortSummary: "Lead frontend delivery for a business application platform.",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    strictEqual(result.exclusionReason, "management_or_director_mismatch");
  });

  it("does not exclude jobs with unknown salary after gates pass", () => {
    const result = scoreJobForUser(
      intent(),
      job({ id: "job_unknown_salary", salaryMin: null, salaryMax: null, salaryCurrency: null }),
      emptyHistory
    );

    strictEqual(result.excluded, false);
    ok(result.concerns.some((concern) => concern.includes("Salary is not listed")));
  });

  it("caps low-confidence unknown role jobs even with a strong title match", () => {
    const result = scoreJobForUser(
      intent(),
      job({
        id: "job_unknown_role",
        normalizedRoleCategory: null,
        normalizedRoleCategoryConfidence: 0.2,
      }),
      emptyHistory
    );

    strictEqual(result.excluded, false);
    ok(result.score <= 68);
    strictEqual(result.scoreCap, 68);
  });

  it("rejects software jobs for a finance candidate unless software is an intended role", () => {
    const financeIntent = intent({
      inferredTargetTitles: ["financial analyst", "fp&a analyst"],
      inferredTargetRoleCategories: ["FINANCE_ACCOUNTING"],
      targetCareerStages: ["ENTRY_JUNIOR", "MID_EXPERIENCED"],
      maxAcceptableCareerStage: "MID_EXPERIENCED",
      mustHaveSkills: ["excel"],
      strongSkills: ["excel", "financial modeling"],
      experienceSummary: "Finance candidate focused on FP&A, accounting, and financial modeling.",
    });
    const result = scoreJobForUser(
      financeIntent,
      job({
        id: "job_bank_swe",
        title: "Software Engineer at Bank",
        company: "Large Bank",
        normalizedRoleCategory: "SOFTWARE_ENGINEERING",
        normalizedRoleCategoryConfidence: 0.94,
        shortSummary: "Build payment systems with Python and SQL.",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    strictEqual(result.exclusionReason, "unrelated_role");
  });

  it("rejects software engineering roles for product designers", () => {
    const designIntent = intent({
      inferredTargetTitles: ["product designer", "ux designer"],
      inferredTargetRoleCategories: ["DESIGN_UX"],
      mustHaveSkills: ["figma"],
      strongSkills: ["figma", "design systems", "user research"],
      experienceSummary: "Product designer focused on UX, user research, Figma, and design systems.",
    });
    const result = scoreJobForUser(
      designIntent,
      job({
        id: "job_design_systems_engineer",
        title: "Frontend Software Engineer, Design Systems",
        normalizedRoleCategory: "SOFTWARE_ENGINEERING",
        normalizedRoleCategoryConfidence: 0.9,
        shortSummary: "Build design systems with React and Figma collaboration.",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    strictEqual(result.exclusionReason, "unrelated_role");
  });

  it("rejects internships for senior backend engineers", () => {
    const seniorIntent = intent({
      inferredTargetTitles: ["senior backend engineer", "staff backend engineer"],
      inferredTargetRoleCategories: ["SOFTWARE_ENGINEERING"],
      targetCareerStages: ["SENIOR_LEAD_STAFF"],
      minAcceptableCareerStage: "MID_EXPERIENCED",
      maxAcceptableCareerStage: "SENIOR_LEAD_STAFF",
      inferredYearsExperience: 7,
      maxRequiredYears: 10,
      experienceSummary: "Senior backend engineer with 7 years of platform engineering.",
    });
    const result = scoreJobForUser(
      seniorIntent,
      job({
        id: "job_intern",
        title: "Software Engineer Intern",
        normalizedCareerStage: "INTERNSHIP_COOP_STUDENT",
        normalizedCareerStageConfidence: 0.93,
        experienceLevelGroup: "STUDENT_INTERN",
      }),
      emptyHistory
    );

    strictEqual(result.excluded, true);
    ok(["too_junior_for_senior_profile", "too_junior"].includes(result.exclusionReason ?? ""));
  });

  it("rejects pure software roles for a data analyst profile", () => {
    const analystIntent = intent({
      inferredTargetTitles: ["data analyst", "bi analyst"],
      inferredTargetRoleCategories: ["DATA_ANALYTICS"],
      mustHaveSkills: ["sql"],
      strongSkills: ["sql", "tableau", "excel"],
      experienceSummary: "Data analyst focused on SQL, dashboards, Tableau, and analytics.",
    });
    const dataResult = scoreJobForUser(
      analystIntent,
      job({
        id: "job_data",
        title: "Data Analyst",
        normalizedRoleCategory: "DATA_ANALYTICS",
        normalizedRoleCategoryConfidence: 0.93,
        shortSummary: "Analyze dashboards with SQL, Tableau, and Excel.",
      }),
      emptyHistory
    );
    const softwareResult = scoreJobForUser(
      analystIntent,
      job({
        id: "job_pure_swe",
        title: "Backend Software Engineer",
        normalizedRoleCategory: "SOFTWARE_ENGINEERING",
        normalizedRoleCategoryConfidence: 0.93,
        shortSummary: "Build backend services with SQL and Python.",
      }),
      emptyHistory
    );

    strictEqual(dataResult.excluded, false);
    strictEqual(softwareResult.excluded, true);
  });
});
