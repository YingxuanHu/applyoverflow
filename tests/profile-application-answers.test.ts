import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationAnswerFields, applicationAnswerKey, applicationAnswerPlan, commonApplicationAnswers, normalizeApplicationAnswers, profileApplicationAnswersSchema } from "../src/lib/profile-application-answers";
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

test("Mission Lane questions map to explicit scoped facts, not guessed citizenship or relationships", () => {
  const url = "https://job-boards.greenhouse.io/missionlane/jobs/8848599002";
  const labels = [
    "How did you hear about this position?*", 'If "other," please tell us more!',
    "Are you related to or have any close personal ties with any current Mission Lane employee? *",
    "If applicable, please provide their name(s) and your relationship to them.",
    "Are you a US citizen, lawful permanent resident, green card holder, or asylee/refugee? *",
    "Will you now or in the future require Mission Lane to commence or sponsor an immigration case in order to employ you (for example H1-B or other employment based immigration)?*",
    "If yes, for current visa holders, please specify the type of visa/sponsorship you have and the time remaining",
    "Would you like to opt-in to receiving text messages at the number you provided in your application, in relation to the hiring process? *",
  ];
  const saved = { enabled: true, values: { jobSource: "ApplyOverflow", authorizedUS: "Yes", sponsorshipUS: "Yes", usPerson: "No", visaDetailsUS: "Applicant-entered visa details", smsUpdates: "No" },
    employers: [{ url, employeeRelationship: "Yes", relationshipDetails: "Applicant-entered relationship details" }] };
  const plan = applicationAnswerPlan(saved, labels, url);
  assert.equal(plan.answers.length, 8);
  assert.equal(plan.answers.find(x => x.answerKey === "usPerson")?.answer, "No");
  assert.deepEqual(plan.answers[0].alternatives, ["Other"]);
  const elsewhere = applicationAnswerPlan(saved, labels, "https://job-boards.greenhouse.io/anotheremployer/jobs/123");
  assert.ok(!elsewhere.answers.some(x => x.answerKey === "employeeRelationship" || x.answerKey === "relationshipDetails"));
  assert.equal(applicationAnswerPlan({ enabled: true, values: { authorizedUS: "Yes" } }, [labels[4]], url).answers.length, 0);
  assert.equal(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).answers.length, 0);
  assert.match(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).details[0].reason, /Enable sharing/);
});

test("different words retain legal and preference meaning without loose fuzzy matches", () => {
  for (const [label, key] of [
    ["Are you legally eligible to work in the United States?", "authorizedUS"],
    ["Do you have the legal right to work in Canada?", "authorizedCA"],
    ["Are you 18 years of age or older?", "over18"],
    ["When are you available to start?", "startDate"],
    ["What weekdays and times are you available to work?", "availability"],
    ["Please indicate desired starting pay.", "desiredPay"],
  ]) assert.equal(applicationAnswerKey(label), key, label);
  for (const label of ["Are you authorized to work in the US without sponsorship?", "Are you legally authorized to work in Canada and the United States?", "Are you not authorized to work in the US?", "Will you require sponsorship in the UK?", "May we email or text application updates?", "Agree to receive marketing text messages and application updates", "Are you a US citizen?", "I certify that I am authorized to work in Canada", "Are you over the age of 18?"])
    assert.equal(applicationAnswerKey(label), undefined, label);
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { startDate: "2026-02-30" } }).success, false);
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { startDate: "2026-10-01" } }).success, true);
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

test("live demographic synonyms preserve explicit choices and conditional follow-ups stay blank", () => {
  const url = "https://job-boards.greenhouse.io/missionlane/jobs/8848599002";
  const labels = ["How would you describe your gender identity? (mark all that apply)", "I identify my ethnicity as:",
    "Do you identify as transgender?", "How would you describe your sexual orientation? (mark all that apply)",
    "Do you have a disability or chronic condition (physical, visual, auditory, cognitive, mental, emotional, or other) that substantially limits one or more of your major life activities, including mobility, communication (seeing, hearing, speaking), and learning?",
    "Are you a veteran or active member of the United States Armed Forces?",
    "Are you related to any current Mission Lane employee?", "If applicable, please provide their name(s) and your relationship to them.",
    "If you were referred, who should we thank for the introduction?"];
  const saved = { enabled: true, values: { gender: "Prefer not to answer", ethnicity: "Prefer not to answer", transgender: "Prefer not to answer", sexualOrientation: "Prefer not to answer", limitingDisability: "Prefer not to answer", veteranOrActiveUS: "Prefer not to answer" },
    employers: [{ url, employeeRelationship: "No", referral: "No" }] };
  const plan = applicationAnswerPlan(saved, labels, url);
  assert.equal(plan.answers.length, 7);
  assert.ok(plan.answers[0].alternatives?.includes("Decline to self identify"));
  assert.equal(plan.details.filter(d => d.notApplicable).length, 2);
  assert.equal(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).details.some(d => d.notApplicable), false);
  assert.equal(applicationAnswerKey("I have a physical disability"), "physicalDisability");
  assert.equal(applicationAnswerPlan({ enabled: true, values: { disability: "I do not want to answer" } }, ["I have a physical disability"], url).answers.length, 0, "Do not equate a specific physical condition with general disability");
});
