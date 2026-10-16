import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProfileFormValues } from "../src/lib/profile";
import { applyReviewedSetup, pendingSetupScopes, parseOnboardingState, INITIAL_ONBOARDING, onboardingDestination, setupProfileSchema } from "../src/lib/profile-setup";
import { setupNextAction } from "../src/lib/extension-setup";
import { onboardingEventSchema } from "../src/lib/onboarding-events";

test("contact confirmation never applies imported history, sharing flags or optional answers", () => {
  const current = buildProfileFormValues({}, { name: "Current", email: "current@example.invalid" });
  const draft = structuredClone(current);
  draft.contact.fullName = "Reviewed Name";
  draft.contact.autofillResume = true;
  draft.contact.githubUrl = "https://example.invalid/imported";
  draft.educations.push({ school: "Draft School", degree: "", time: "", location: "", description: "", dates: { start: "2025", end: "2020", current: false } });
  const result = applyReviewedSetup(current, draft, ["contact"]);
  assert.equal(result.contact.fullName, "Reviewed Name");
  assert.equal(result.contact.autofillResume, current.contact.autofillResume);
  assert.equal(result.contact.githubUrl, current.contact.githubUrl);
  assert.deepEqual(result.educations, []);
  assert.deepEqual(pendingSetupScopes(result, draft), ["address", "educations"]);
  assert.ok(setupProfileSchema.safeParse(draft).success, "unfinished history must not prevent draft persistence/contact confirmation");
});

test("explicit reviewed scope handles deletion without replacing unrelated values", () => {
  const current = buildProfileFormValues({}, { name: "Current", email: "current@example.invalid" });
  current.experiences = [{ company: "Saved Co", title: "Analyst", time: "2020", location: "", description: "Saved evidence" }];
  const draft = structuredClone(current); draft.experiences = [];
  assert.equal(applyReviewedSetup(current, draft, ["contact"]).experiences.length, 1);
  assert.equal(applyReviewedSetup(current, draft, ["experiences"]).experiences.length, 0);
  assert.deepEqual(pendingSetupScopes(current, structuredClone(current)), []);
});

test("versioned state keeps legacy drafts and short extension destinations", () => {
  assert.equal(parseOnboardingState(JSON.stringify(INITIAL_ONBOARDING))?.version, 1);
  assert.equal(parseOnboardingState(JSON.stringify({ ...INITIAL_ONBOARDING, version: 2, confirmedScopes: ["contact"] }))?.version, 2);
  assert.equal(onboardingDestination(INITIAL_ONBOARDING, "/extension/setup?context=abc"), "/extension/setup?context=abc");
  assert.equal(onboardingDestination(INITIAL_ONBOARDING, "/extension/connect?state=abc"), "/extension/connect?state=abc");
  assert.equal(onboardingDestination(INITIAL_ONBOARDING, "https://evil.invalid"), "/onboarding?from=%2Fjobs");
});

test("readiness never conflates installation, account match and profile capability", () => {
  assert.equal(setupNextAction("unsupported", true, false), "jobs");
  assert.equal(setupNextAction("not-detected", true, true), "install");
  assert.equal(setupNextAction("unavailable", true, true), "retry");
  assert.equal(setupNextAction("mismatch", true, true), "connect");
  assert.equal(setupNextAction("verified", true, false), "profile");
  assert.equal(setupNextAction("verified", true, true), "continue");
});

test("measurement refuses personal data and unbounded counters", () => {
  const event = { event: "setup_opened", journey: "d9428888-122b-4d32-b123-4d6b984b557a", entry: "extension" };
  assert.ok(onboardingEventSchema.safeParse(event).success);
  for (const extra of [{ url: "https://employer.invalid" }, { email: "private@example.invalid" }, { answer: "Private" }, { filled: 501 }])
    assert.equal(onboardingEventSchema.safeParse({ ...event, ...extra }).success, false);
  assert.equal(onboardingEventSchema.safeParse({ ...event, event: "autofill_attempted" }).success, false);
  assert.equal(onboardingEventSchema.safeParse({ ...event, event: "autofill_attempted", run: event.journey }).success, true);
});
