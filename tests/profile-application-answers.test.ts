import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationAnswerFields, applicationAnswerKey, applicationAnswerPlan, commonApplicationAnswers, normalizeApplicationAnswers, profileApplicationAnswersSchema } from "../src/lib/profile-application-answers";
import { normalizeContact } from "../src/lib/profile";

test("posting-relative eligibility uses a single known job country, not applicant residence", () => {
  const labels = ["Are you legally authorized to work in the country of employment for this position?",
    "Will you require visa sponsorship now or in future to work where this role is based?"];
  const saved = { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "No", sponsorshipCA: "No", sponsorshipUS: "Yes" } };
  assert.deepEqual(applicationAnswerPlan(saved, labels).answers, []);
  assert.deepEqual(applicationAnswerPlan(saved, labels, undefined, "CA").answers.map(a => a.answer), ["Yes", "No"]);
  assert.deepEqual(applicationAnswerPlan(saved, labels, undefined, "US").answers.map(a => a.answer), ["No", "Yes"]);
  for (const label of ["Are you authorized to work here?", "Are you authorized to work in the country of employment without sponsorship?", "Are you legally authorized to work in Canada and the country of employment?", "I certify that I am authorized to work in the country of employment"])
    assert.equal(applicationAnswerKey(label, "US"), undefined, label);
  assert.equal(applicationAnswerKey("Are you legally authorized to work in the United States?", "CA"), "authorizedUS");
  assert.equal(applicationAnswerPlan({ ...saved, enabled: false }, labels, undefined, "CA").answers.length, 0);
  assert.equal(applicationAnswerPlan({ enabled: true, values: { authorizedUS: "Yes" } }, labels, undefined, "CA").answers.length, 0);
});

test("voluntary application answers require explicit opt-in and valid per-field values", () => {
  const values = { gender: "Woman", authorizedCA: "No", over18: "Yes" };
  assert.deepEqual(commonApplicationAnswers({ enabled: false, values }, ["Gender identity"]), []);
  assert.deepEqual(normalizeApplicationAnswers({ enabled: "true", values }), { enabled: false, values: {} });
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { gender: "Yes" } }).success, false);
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { ssn: "secret" } }).success, false);
  assert.equal(normalizeContact({ applicationAnswers: { enabled: true, values } }).applicationAnswers?.values.authorizedCA, "No");
  assert.deepEqual(commonApplicationAnswers({ enabled: true, values }, ["Are you legally authorized to work in Canada?"]), [{ label: "Are you legally authorized to work in Canada?", answer: "No" }]);
});

test("split salary widgets require explicit annual amount and currency, without conversion", () => {
  const labels = ["Desired salary (amount)", "Desired salary (currency)"];
  for (const desiredPay of ["USD 80,000 per year", "CAD 95000/year", "CAD 100000.50 annually"]) {
    const plan = applicationAnswerPlan({enabled:true,values:{desiredPay}}, labels);
    assert.equal(plan.answers.length, 2);
    assert.equal(plan.answers[0].answer, desiredPay.match(/[\d,.]+/)![0].replaceAll(",", ""));
    assert.equal(plan.answers[1].answer, `${desiredPay.slice(0,3)} $`);
    assert.deepEqual(plan.answers[0].dependsOn, {answerKey:"desiredPayCurrency",answer:plan.answers[1].answer});
  }
  for (const desiredPay of ["USD 25 per hour", "$80000", "80000", "USD 80000", "USD 70,000-90,000 per year", "USD 80,00 per year", "Negotiable"])
    assert.equal(applicationAnswerPlan({enabled:true,values:{desiredPay}},labels).answers.length, 0, desiredPay);
  assert.equal(applicationAnswerPlan({enabled:false,values:{desiredPay:"USD 80000 per year"}},labels).answers.length, 0);
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
  assert.deepEqual(plan.answers[0].alternatives, ["Other", "Other Website", "Job Board", "Job Boards", "Job board / aggregator", "Website"]);
  const elsewhere = applicationAnswerPlan(saved, labels, "https://job-boards.greenhouse.io/anotheremployer/jobs/123");
  assert.ok(!elsewhere.answers.some(x => x.answerKey === "employeeRelationship" || x.answerKey === "relationshipDetails"));
  assert.equal(applicationAnswerPlan({ enabled: true, values: { authorizedUS: "Yes" } }, [labels[4]], url).answers.length, 0);
  assert.equal(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).answers.length, 0);
  assert.match(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).details[0].reason, /Enable sharing/);
});

test("Other with explicit ApplyOverflow details retains equivalent source choices", () => {
  const labels = ["How Did You Hear About Us?"];
  const url = "https://example.wd1.myworkdayjobs.com/en-US/External/job/Toronto-CAN/Engineer_R1/apply";
  const plan = applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "ApplyOverflow" } }, labels, url);
  assert.equal(plan.answers[0].answer, "Other");
  assert.ok(plan.answers[0].alternatives?.includes("Job Board"));
  assert.ok(plan.answers[0].alternatives?.includes("Other Website"));
  assert.equal(applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "A personal conversation" } }, labels, url).answers[0].alternatives, undefined);
});

test("source variants and unspecified sponsorship use verified posting context", () => {
  const labels = ["How did you first hear about Recursion?", "If you chose Recursion Employee, Recursion Event, or Other, please specify here:",
    "Will you now or in the future require visa sponsorship?", "What is your ideal start date?"];
  const saved = { enabled: true, values: { jobSource: "ApplyOverflow", sponsorshipCA: "No", sponsorshipUS: "Yes", startDate: "2026-10-15" } };
  const url = "https://job-boards.greenhouse.io/recursion/jobs/123";
  const plan = applicationAnswerPlan(saved, labels, url, "CA");
  assert.deepEqual(plan.answers.map(answer => answer.answer), ["ApplyOverflow", "ApplyOverflow", "No", "2026-10-15"]);
  assert.equal(plan.answers[1].dependsOn?.answer, "Other");
  assert.equal(applicationAnswerPlan(saved, [labels[2]], url, "US").answers[0].answer, "Yes");
  assert.equal(applicationAnswerPlan(saved, [labels[2]], url).answers.length, 0);
  const employmentSponsorship = "Will you require sponsorship for employment now or in the future?";
  assert.equal(applicationAnswerPlan(saved, [employmentSponsorship], url, "CA").answers[0].answer, "No");
  assert.equal(applicationAnswerPlan(saved, [employmentSponsorship], url).answers.length, 0);
  assert.equal(applicationAnswerPlan(saved, ["Will you now or in the future require sponsorship in the United Kingdom?"], url, "US").answers.length, 0);
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
  assert.ok(plan.answers[0].alternatives?.includes("Prefer not to disclose"));
  assert.ok(plan.answers[0].alternatives?.includes("Choose not to disclose"));
  assert.ok(plan.answers[0].alternatives?.includes("Choose not to answer"));
  assert.equal(plan.details.filter(d => d.notApplicable).length, 2);
  assert.equal(applicationAnswerPlan({ ...saved, enabled: false }, labels, url).details.some(d => d.notApplicable), false);
  assert.equal(applicationAnswerKey("I have a physical disability"), "physicalDisability");
  assert.equal(applicationAnswerPlan({ enabled: true, values: { disability: "I do not want to answer" } }, ["I have a physical disability"], url).answers.length, 0, "Do not equate a specific physical condition with general disability");
});
