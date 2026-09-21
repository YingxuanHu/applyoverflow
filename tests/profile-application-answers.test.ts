import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationAnswerFields, commonApplicationAnswers, normalizeApplicationAnswers, profileApplicationAnswersSchema } from "../src/lib/profile-application-answers";
import { normalizeContact } from "../src/lib/profile";

test("voluntary application answers require explicit opt-in and valid per-field values", () => {
  const values = { gender: "Woman", authorizedCA: "No", over18: "Yes" };
  assert.deepEqual(commonApplicationAnswers({ enabled: false, values }, ["Gender identity"]), []);
  assert.deepEqual(normalizeApplicationAnswers({ enabled: "true", values }), { enabled: false, values: {} });
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { gender: "Yes" } }).success, false);
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { ssn: "secret" } }).success, false);
  assert.equal(normalizeContact({ applicationAnswers: { enabled: true, values } }).applicationAnswers?.values.authorizedCA, "No");
  assert.deepEqual(commonApplicationAnswers({ enabled: true, values }, ["Are you legally authorized to work in Canada?"]), [{ label: "Are you legally authorized to work in Canada?", answer: "No" }]);
});

test("answers do not cross country, time scope, identity or employer boundaries", () => {
  const values = Object.fromEntries(applicationAnswerFields.map(field => [field.key, field.options[0]]));
  const saved = { enabled: true, values };
  for (const label of ["Are you a veteran?", "Do you currently have a disability?", "Sex assigned at birth", "Are you over the age of 18?", "Are you authorized to work here?", "Are you authorized to work in Canada and the US?", "Do you have a relative at this company?", "I agree to the terms", "I consent to receive SMS", "Government official relationship"]) {
    assert.deepEqual(commonApplicationAnswers(saved, [label]), [], label);
  }
  assert.equal(commonApplicationAnswers(saved, ["Gender identity", "Disability Status", "Veteran Status", "Are you at least 18 years old?"]).length, 4);
  assert.equal(commonApplicationAnswers({ enabled: true, values: { authorizedCA: "Yes" } }, ["Are you legally authorized to work in the United States?"]).length, 0);
});
