import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProfileFormValues,
  normalizeContact,
  normalizeEducations,
  normalizeExperiences,
} from "../src/lib/profile";
import {
  INITIAL_ONBOARDING,
  onboardingDestination,
  parseOnboardingState,
  parseJobGoals,
  setupProfileSchema,
  setupReturnPath,
  getSetupCompletionError,
} from "../src/lib/profile-setup";
import {
  buildUserJobIntent,
  getAllowedRoleCategories,
} from "../src/lib/top-picks/intent";
import { parseExperiences, parseSkills } from "../src/types/profile";

test("only explicitly enrolled new users enter onboarding", () => {
  const destination = "/jobs?titleSearch=analyst#job-example";
  assert.equal(onboardingDestination(null, destination), destination);
  assert.equal(
    onboardingDestination(
      { ...INITIAL_ONBOARDING, status: "complete" },
      destination,
    ),
    destination,
  );
  assert.equal(
    onboardingDestination(
      { ...INITIAL_ONBOARDING, status: "deferred" },
      destination,
    ),
    destination,
  );
  assert.equal(
    onboardingDestination(INITIAL_ONBOARDING, destination),
    `/onboarding?from=${encodeURIComponent(destination)}`,
  );
});

test("setup return paths reject external destinations and auth loops", () => {
  for (const path of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/onboarding?from=/onboarding",
    "/api/auth/sign-out",
    "/sign-up",
    "/",
    "/jobs/../onboarding",
  ])
    assert.equal(setupReturnPath(path), "/jobs", path);
  assert.equal(
    setupReturnPath("/applications/compare?ids=a,b"),
    "/applications/compare?ids=a,b",
  );
});

test("state and goals reject corrupt, oversized and incompatible input", () => {
  assert.equal(parseOnboardingState('{"status":"pending"}'), null);
  assert.equal(
    parseOnboardingState(JSON.stringify({ ...INITIAL_ONBOARDING, version: 2 })),
    null,
  );
  assert.equal(
    parseJobGoals(
      JSON.stringify({
        targetTitles: Array(6).fill("Engineer"),
        preferredLocation: "",
        country: "CA",
      }),
    ),
    null,
  );
  assert.equal(
    parseJobGoals(
      JSON.stringify({
        targetTitles: [],
        preferredLocation: "",
        country: "UK",
      }),
    ),
    null,
  );
  assert.deepEqual(
    parseOnboardingState(JSON.stringify(INITIAL_ONBOARDING)),
    INITIAL_ONBOARDING,
  );
});

test("profile compatibility readers accept both legacy and current shapes", () => {
  assert.equal(
    normalizeExperiences([
      {
        title: "Analyst",
        company: "Example",
        startDate: "2021-09",
        endDate: "2023",
      },
    ])[0].time,
    "2021-09 - 2023",
  );
  assert.equal(
    normalizeEducations([
      { school: "Example", time: "Fall 2020", startDate: "2021" },
    ])[0].time,
    "Fall 2020",
  );
  assert.equal(
    parseExperiences([
      { title: "Analyst", company: "Example", time: "2022 - Present" },
    ])[0].time,
    "2022 - Present",
  );
  assert.deepEqual(parseSkills(["Excel", { name: "SQL" }, null]), [
    "Excel",
    "SQL",
  ]);
});

test("optional addresses survive profile loading without inferring missing values", () => {
  const contact = normalizeContact({
    fullName: "Test Person",
    streetAddress: " 12 Example St ",
    postalCode: "A1A 1A1",
    country: "CA",
  });
  const values = buildProfileFormValues({ contactJson: contact });
  assert.equal(values.contact.streetAddress, "12 Example St");
  assert.equal(values.contact.country, "CA");
  assert.equal(values.contact.city, undefined);
  assert.equal(setupProfileSchema.safeParse(values).success, true);
});

test("incomplete contact details can be saved as a draft but not confirmed", () => {
  const draft = setupProfileSchema.parse(
    buildProfileFormValues({
      contactJson: { fullName: "Test Person", email: "unfinished@" },
    }),
  );
  assert.match(getSetupCompletionError(draft)!, /valid contact email/);
  draft.contact.email = "test@example.invalid";
  assert.equal(getSetupCompletionError(draft), null);
  draft.contact.fullName = " ";
  assert.match(getSetupCompletionError(draft)!, /full name/);
});

test("explicit job interests outrank historical role categories and do not alter residence", () => {
  const input = {
    userId: "test",
    profileVersion: 1,
    skills: [],
    projects: [],
    educations: [],
    experiences: [
      {
        title: "Software Engineer",
        company: "Example",
        time: "2020 - 2024",
        location: "Seattle",
        description: "TypeScript backend development",
      },
    ],
    location: "Seattle, WA, United States",
  };
  const intent = buildUserJobIntent({
    ...input,
    targetTitles: ["Financial Analyst"],
    preferredLocation: "Toronto, Ontario",
    preferredCountry: "CA",
  });
  assert.ok(
    intent.explicitTargetTitles.some((title) =>
      /financial analyst/i.test(title),
    ),
  );
  assert.ok(!getAllowedRoleCategories(intent).includes("SOFTWARE_ENGINEERING"));
  assert.ok(getAllowedRoleCategories(intent).length > 0);
  assert.equal(intent.preferredLocationCity, "Toronto");
  assert.equal(intent.preferredLocationCountry, "Canada");
  assert.equal(input.location, "Seattle, WA, United States");
  assert.notEqual(buildUserJobIntent(input).profileHash, intent.profileHash);
});

test("a deliberately empty preferred location does not fall back to residence", () => {
  const intent = buildUserJobIntent({
    userId: "test",
    profileVersion: 1,
    skills: [],
    projects: [],
    educations: [],
    experiences: [],
    location: "Toronto",
    preferredLocation: "",
    targetTitles: ["Accountant"],
  });
  assert.equal(intent.preferredLocationCity, undefined);
});
