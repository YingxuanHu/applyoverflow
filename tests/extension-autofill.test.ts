import { test } from "node:test";
import assert from "node:assert/strict";
import { autofillAnswerSchema, reusableAutofillAnswers } from "../src/lib/extension-autofill";
import { normalizeContact } from "../src/lib/profile";

const revision = "2026-09-20T00:00:00.000Z";
test("autofill reuses only explicit, exact, current and employer-scoped answers", () => {
  const entry = { companyId: "greenhouse:fixture", questionKey: "relevant project", kind: "custom" as const, profileRevision: revision, answer: "Built an app.", autofillConfirmed: true };
  const reuse = (library = [entry], company = entry.companyId, rev = revision, labels = ["Relevant project"]) => reusableAutofillAnswers(library, company, rev, labels);
  assert.equal(reuse().length, 1);
  assert.equal(reuse([{ ...entry, autofillConfirmed: false }]).length, 0);
  assert.equal(reuse([entry], "greenhouse:other").length, 0);
  assert.equal(reuse([entry], entry.companyId, "new-revision").length, 0);
  assert.equal(reuse([entry], entry.companyId, revision, ["Other project"]).length, 0);
  assert.equal(reuse([entry, entry]).length, 0);
});
test("remembering fixed profile fields validates formats and never implicitly opts into resume sharing", () => {
  const input = { url: "https://job-boards.greenhouse.io/fixture/jobs/123", label: "Country", answer: "CA", profileKey: "country", revision };
  assert.equal(autofillAnswerSchema.safeParse(input).success, true);
  assert.equal(autofillAnswerSchema.safeParse({ ...input, answer: "anything" }).success, false);
  assert.equal(autofillAnswerSchema.safeParse({ ...input, profileKey: "autofillResume", answer: "true" }).success, false);
  assert.equal(autofillAnswerSchema.safeParse({ ...input, profileKey: "email", answer: "invalid" }).success, false);
  assert.equal(normalizeContact({ preferredName: " Jo ", pronouns: "they/them", autofillResume: "true" }).autofillResume, false);
  assert.equal(normalizeContact({ autofillResume: true }).autofillResume, true);
});
test("company relationship, legal and sensitive answers cannot be remembered for automatic reuse", () => {
  for (const label of ["Do you require sponsorship?", "I certify", "Do you have a relative here?", "Who referred you?", "Gender"]) {
    assert.equal(autofillAnswerSchema.safeParse({ url: "https://job-boards.greenhouse.io/fixture/jobs/123", label, answer: "No", revision }).success, false);
  }
});
