import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProfileFormValues,
  buildProfileTextCopies,
  normalizeExperiences,
  normalizeEducations,
} from "../src/lib/profile";
import {
  formatHistoryDates,
  historyDatesSchema,
  historyPeriodsMatch,
  historyValidationError,
} from "../src/lib/profile-history";
import {
  setupProfileSchema,
  parseOnboardingState,
  INITIAL_ONBOARDING,
} from "../src/lib/profile-setup";

test("structured history preserves year precision, unknown dates, and current status", () => {
  for (const [dates, expected] of [
    [{ start: "2020", end: "2023", current: false }, "2020 - 2023"],
    [
      { start: "2020-09", end: "2023-06", current: false },
      "Sep 2020 - Jun 2023",
    ],
    [{ start: "2020", end: "", current: true }, "2020 - Present"],
    [{ start: "", end: "", current: false }, ""],
    [{ start: "2020", end: "", current: false }, "From 2020"],
    [{ start: "", end: "2023", current: false }, "Until 2023"],
  ] as const) {
    assert.equal(historyDatesSchema.safeParse(dates).success, true);
    assert.equal(formatHistoryDates(dates), expected);
  }
});

test("invalid history dates and contradictory periods cannot be saved", () => {
  for (const dates of [
    { start: "2020-00", end: "", current: false },
    { start: "2020-13", end: "", current: false },
    { start: "2020-01-01", end: "", current: false },
    { start: "20", end: "", current: false },
    { start: "September 2020", end: "", current: false },
    { start: "2020", end: "2019", current: false },
    { start: "2020-09", end: "2020-08", current: false },
    { start: "2020", end: "2023", current: true },
    { start: "2020", end: "", current: "false" },
    null,
  ]) {
    assert.equal(historyDatesSchema.safeParse(dates).success, false);
    assert.match(historyValidationError([{ dates }])!, /Entry 1/);
  }
  assert.equal(
    historyDatesSchema.safeParse({
      start: "2020-09",
      end: "2020",
      current: false,
    }).success,
    true,
  );
  assert.equal(historyValidationError([{ time: "2020 - Present" }]), null);
});

test("legacy history is not silently converted or treated as precise dates", () => {
  for (const time of [
    "Fall 2020",
    "2018 - Present",
    "2018 - 2022",
    "Unknown",
  ]) {
    const entry = normalizeExperiences([{ title: "Engineer", time }])[0];
    assert.equal(entry.time, time);
    assert.equal(entry.dates, undefined);
  }
  const entry = normalizeExperiences([
    { title: "Engineer", time: "Old date", dates: { start: "bad" } },
  ])[0];
  assert.equal(
    entry.dates,
    undefined,
    "invalid stored metadata does not crash the profile reader",
  );
  assert.equal(entry.time, "Old date");
});

test("structured dates survive normalization, onboarding drafts, and resume text copies", () => {
  const dates = { start: "2019", end: "2021-06", current: false };
  const experiences = normalizeExperiences([
    { title: "Engineer", company: "Example", time: "legacy date", dates },
  ]);
  const educations = normalizeEducations([
    { school: "Example University", time: "", dates },
  ]);
  assert.deepEqual(experiences[0].dates, dates);
  assert.equal(experiences[0].time, "2019 - Jun 2021");
  assert.deepEqual(normalizeExperiences(experiences), experiences);
  const profile = buildProfileFormValues({
    experiencesJson: experiences,
    educationsJson: educations,
  });
  assert.deepEqual(
    setupProfileSchema.parse(profile).experiences[0].dates,
    dates,
  );
  const stored = parseOnboardingState(
    JSON.stringify({ ...INITIAL_ONBOARDING, draft: profile }),
  );
  assert.deepEqual(stored?.draft?.educations[0].dates, dates);
  const copies = buildProfileTextCopies(profile);
  assert.match(copies.experienceText!, /2019 - Jun 2021/);
  assert.match(copies.educationText!, /2019 - Jun 2021/);
});

test("different stints with the same role or qualification are not merged", () => {
  assert.equal(
    historyPeriodsMatch({ time: "2018 - 2020" }, { time: "2023 - Present" }),
    false,
  );
  assert.equal(
    historyPeriodsMatch({ time: "2023 - Present" }, { time: "2023 - present" }),
    true,
  );
  assert.equal(
    historyPeriodsMatch({ time: "" }, { time: "2023 - Present" }),
    true,
  );
  assert.equal(
    historyPeriodsMatch(
      { time: "legacy", dates: { start: "2023", end: "", current: true } },
      { time: "2023 - Present" },
    ),
    true,
  );
});
