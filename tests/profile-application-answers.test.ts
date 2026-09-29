import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationAnswerFields, applicationAnswerKey, applicationAnswerPlan, commonApplicationAnswers, commuteLocationError, normalizeApplicationAnswers, profileApplicationAnswersSchema } from "../src/lib/profile-application-answers";
import { normalizeContact } from "../src/lib/profile";
import { autofillAnswerSchema, autofillPlanSchema, autofillProfileFields, currentEmploymentFields } from "../src/lib/extension-autofill";
import { normalizeLocationSubdivision } from "../src/lib/location-search";

test("employer sponsorship wording and explicit US examples preserve country and time scope", () => {
  const question = "Do you currently, or will you in the future, require employer sponsorship to work in the United States? Examples include H-1B, TN, O-1, employment-based green card sponsorship, or continued employment after F-1 OPT.";
  assert.equal(applicationAnswerKey(question, "CA"), "sponsorshipUS");
  const saved = { enabled: true, values: { sponsorshipUS: "Yes", sponsorshipCA: "No" } };
  assert.deepEqual(applicationAnswerPlan(saved, [question], undefined, "CA").answers.map(a => a.answer), ["Yes"]);
  assert.equal(applicationAnswerKey("Do you currently or will you in the future require employer sponsorship to work in Canada?"), "sponsorshipCA");
  for (const label of [
    question.replace("currently, or will you in the future,", "currently"),
    question.replace("require employer", "not require employer"),
    question.replace("United States", "Australia"),
    question + " I certify that I am eligible.",
    "Are you legally authorized to work for any employer in the United States?",
  ]) assert.equal(applicationAnswerKey(label, "US"), undefined, label);
});

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

test("entitlement and repeated-tense sponsorship use the posting country with unchanged scope", () => {
  const labels = [
    "Are you legally entitled to work in the country you are applying for?",
    "Do you now or will you in the future require sponsorship from an employer to work in the country for which you are applying?",
    "Are you authorized to work in the country where this job is posted?",
  ];
  const saved = { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "No", sponsorshipCA: "No", sponsorshipUS: "Yes" } };
  assert.deepEqual(applicationAnswerPlan(saved, labels).answers, []);
  assert.deepEqual(applicationAnswerPlan(saved, labels, undefined, "CA").answers.map(a => a.answer), ["Yes", "No", "Yes"]);
  assert.deepEqual(applicationAnswerPlan(saved, labels, undefined, "US").answers.map(a => a.answer), ["No", "Yes", "No"]);
  for (const label of [
    "Are you legally entitled to work in the country you are applying for without sponsorship?",
    "Are you legally entitled to work in the country you are applying for and Canada?",
    "Do you now or will you in the future not require sponsorship from an employer to work in the country for which you are applying?",
    "Do you now and will you in the future require sponsorship from an employer to work in Canada?",
    "Do you now or will you in the future require financial sponsorship from an employer to work in Canada?",
    "Do you now or will you in the future require sponsorship from an employer to work in Australia?",
  ]) assert.equal(applicationAnswerKey(label, "CA"), undefined, label);
});

test("demographic instruction text does not prevent using explicitly saved identity answers", () => {
  const labels = ["What gender do you identify as?", "I identify my ethnicity as Select all that apply"];
  const saved = { enabled: true, values: { gender: "Man", ethnicity: "Prefer not to answer" } };
  const plan = applicationAnswerPlan(saved, labels);
  assert.deepEqual(plan.answers.map(a => [a.answerKey, a.answer]), [["gender", "Man"], ["ethnicity", "Prefer not to answer"]]);
  assert.ok(plan.answers[0].alternatives?.includes("Male"));
  assert.ok(plan.answers[1].alternatives?.includes("Prefer not to disclose"));
  assert.deepEqual(applicationAnswerPlan({ ...saved, enabled: false }, labels).answers, []);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values: {} }, labels).answers, []);
  for (const label of [
    "What gender do you identify as and what was your sex assigned at birth?",
    "I identify my ethnicity as and my nationality as Select all that apply",
    "I certify my gender identity Select all that apply",
  ]) assert.equal(applicationAnswerKey(label), undefined, label);
});

test("named-employer source details require the source question and actual Other selection", () => {
  const url = "https://jobs.ashbyhq.com/zip/b5242472-5679-4084-af77-238b6335b792/application";
  const labels = ["How did you hear about Zip?", 'If you selected "Other", please let us know how you heard about Zip.'];
  const saved = { enabled: true, values: { jobSource: "ApplyOverflow" } };
  const plan = applicationAnswerPlan(saved, labels, url);
  assert.equal(plan.answers.length, 2);
  assert.equal(plan.answers[1].answer, "ApplyOverflow");
  assert.equal(plan.answers[1].dependsOn?.answerKey, "jobSource");
  assert.equal(plan.answers[1].dependsOn?.answer, "Other");
  assert.equal(applicationAnswerPlan(saved, [labels[1]], url).answers.length, 0);
  assert.equal(applicationAnswerPlan(saved, [labels[0], labels[1].replace("about Zip", "about Another Employer")], url).answers.length, 1);
  assert.equal(applicationAnswerPlan(saved, labels, "https://jobs.ashbyhq.com/elsewhere/00000000-0000-4000-8000-000000000000").answers.length, 0);
  assert.equal(applicationAnswerPlan({ enabled: true, values: { jobSource: "LinkedIn" } }, labels, url).answers.length, 1);
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
  assert.deepEqual(plan.answers[0].alternatives, ["Other", "Other (please specify)", "Other - please specify"]);
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

test("new common preferences remain optional and use the existing contact JSON record", () => {
  const empty = { enabled: true, values: {} };
  assert.deepEqual(normalizeApplicationAnswers(empty), empty);
  const saved = { enabled: false, values: { noticePeriod: "  2 weeks  ", travel: "No", talentCommunity: "Yes", jobAlerts: "No" },
    commutes: [{ location: " Toronto, ON, CA ", willingness: "Yes" }] };
  const normalized = normalizeContact({ applicationAnswers: saved }).applicationAnswers!;
  assert.equal(normalized.values.noticePeriod, "2 weeks");
  assert.equal(normalized.values.travel, "No");
  assert.equal(normalized.values.talentCommunity, "Yes");
  assert.equal(normalized.values.jobAlerts, "No");
  assert.deepEqual(normalized.commutes, [{ location: "Toronto, ON, CA", willingness: "Yes" }]);
  for (const key of ["smsUpdates", "emailUpdates", "gender", "authorizedCA", "sponsorshipUS"]) assert.equal(Reflect.get(normalized.values, key), undefined);
  assert.deepEqual(applicationAnswerPlan(normalized, ["What is your notice period?", "Are you willing to travel?", "Would you like to join our talent community?", "Would you like to receive email job alerts?", "Are you willing to commute to Toronto, ON, CA?"]).answers, []);
  for (const invalid of [
    { enabled: true, values: { travel: true } },
    { enabled: true, values: { talentCommunity: "Maybe" } },
    { enabled: true, values: { noticePeriod: "x".repeat(201) } },
    { enabled: true, values: {}, commutes: [{ location: "x".repeat(201), willingness: "Yes" }] },
    { enabled: true, values: {}, commutes: [{ location: "Toronto, CA", willingness: "Maybe" }] },
    { enabled: true, values: {}, commutes: [{ location: "Toronto, CA", willingness: "Yes", anyLocation: true }] },
    { enabled: true, values: {}, commutes: Array.from({ length: 13 }, () => ({ location: "Toronto, CA" })) },
  ]) assert.equal(profileApplicationAnswersSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: false, values: {}, commutes: [{ location: "" }] }).success, true);
});

test("generic legal eligibility uses only a supplied country and preserves question scope", () => {
  const authorization = [
    "Are you legally authorized to work?", "Are you currently authorised to work?",
    "Do you have the legal right to work?", "Can you legally work?", "Are you legally permitted to work?",
    "Are you legally authorized to work in the country where you are applying?",
    "Are you authorized to work in the country in which you will be employed?",
  ];
  const sponsorship = [
    "Will you now or in the future require sponsorship?",
    "Do you require visa sponsorship now or in future?",
    "Would you require employment sponsorship from our company now or in the future?",
    "Will you now or at any point in the future require visa sponsorship for employment?",
    "Will you now, or in the future, require sponsorship for employment visa status?",
    "Do you require visa sponsorship, now or in the future, to work?",
  ];
  for (const [labels, stem] of [[authorization, "authorized"], [sponsorship, "sponsorship"]] as const) {
    for (const label of labels) {
      assert.equal(applicationAnswerKey(label), undefined, label);
      for (const country of ["CA", "US"] as const) assert.equal(applicationAnswerKey(label, country), `${stem}${country}`, label);
    }
  }
  for (const label of ["Are you legally authorized to work in the U.S.?", "Are you legally authorised to work in the USA?", "Do you have the legal right to work in the United States of America?"])
    assert.equal(applicationAnswerKey(label, "CA"), "authorizedUS", label);
  for (const label of [
    "Are you authorized to work in Canada or the United States?", "Are you authorized to work in Canada and the UK?",
    "Are you legally authorized to work in Canada or elsewhere?", "Are you legally authorized to work in Australia?",
    "Are you legally authorized to work here?", "Do you have unrestricted authorization to work in the US?",
    "Are you legally authorized to work in the US without a visa?", "Can you provide proof of authorization to work in Canada?",
    "Are you not legally authorized to work in Canada?", "Are you legally authorized to work in Canada and at least 18?",
    "Will you require sponsorship?", "Will you require sponsorship in the US in the future?",
    "Do you currently require sponsorship in Canada?", "Will you require sponsorship now and in the future in Canada?",
    "Will you now or in the future not require sponsorship in Canada?", "Will you need financial sponsorship now or in the future in Canada?",
    "Will you require visa sponsorship now or in the future in Canada and the US?",
    "I confirm that I am legally authorized to work in the US", "I certify that I require sponsorship now or in the future",
  ]) assert.equal(applicationAnswerKey(label, "US"), undefined, label);
  const values = { authorizedUS: "Yes", authorizedCA: "No", sponsorshipUS: "No", sponsorshipCA: "Yes" };
  const labels = [authorization[0], sponsorship[0]];
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values }, labels, "https://jobs.lever.co/us-company/123").answers, []);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values }, labels, undefined, "CA").answers.map(a => a.answer), ["No", "Yes"]);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values }, labels, undefined, "US").answers.map(a => a.answer), ["Yes", "No"]);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values }, labels, undefined, "US", "Toronto, ON, CA").answers, [], "Conflicting job context is not unambiguous country evidence");
});

test("legal option aliases do not add citizenship, visa status or sponsorship claims", () => {
  for (const country of ["CA", "US"] as const) for (const answer of ["Yes", "No"]) {
    const plan = applicationAnswerPlan({ enabled: true, values: { [`authorized${country}`]: answer, [`sponsorship${country}`]: answer } },
      ["Are you legally authorized to work?", "Will you now or in the future require sponsorship?"], undefined, country);
    assert.equal(plan.answers.length, 2);
    for (const item of plan.answers) {
      assert.equal(item.answer, answer);
      assert.ok(item.alternatives?.every(value => value.startsWith(`${answer}, `)));
      assert.doesNotMatch(item.alternatives!.join(" "), /citizen|resident|without|h1|h-1/i);
      if (item.answerKey.startsWith("authorized")) assert.doesNotMatch(item.alternatives!.join(" "), /sponsor/);
    }
  }
});

test("application updates, talent community and future-job email alerts are independent opt-ins", () => {
  const labels = [
    "I consent to receive text messages about my application",
    "I agree to receive email updates about my application",
    "Would you like to join our talent community?",
    "Would you like to receive email job alerts?",
  ];
  const keys = ["smsUpdates", "emailUpdates", "talentCommunity", "jobAlerts"];
  for (const [index, key] of keys.entries()) for (const answer of ["Yes", "No"]) {
    const saved = { enabled: true, values: { [key]: answer } };
    assert.deepEqual(applicationAnswerPlan(saved, labels).answers.map(a => [a.label, a.answer, a.answerKey]), [[labels[index], answer, key]]);
  }
  assert.equal(applicationAnswerKey("Would you like to be a part of Braze's talent community?"), "talentCommunity");
  assert.equal(applicationAnswerKey("I would like to join the talent network for future career opportunities"), "talentCommunity");
  assert.equal(applicationAnswerKey("I consent to receive job alerts via email"), "jobAlerts");
  assert.equal(applicationAnswerKey("Do you want to receive email updates about future job opportunities?"), "jobAlerts");
  for (const label of [
    "I consent to receive SMS", "Would you like to receive job alerts?",
    "I agree to receive email or text messages about my application",
    "Would you like to receive SMS job alerts?", "Would you like to join our talent community and receive text messages?",
    "Would you like to receive marketing emails and application updates?",
    "I agree to receive email job alerts from third-party partners", "I agree to the talent community privacy policy",
    "I consent to retention of my application for future job opportunities", "Join the talent community and agree to the terms",
    "Would you like to receive email updates about my application and future positions?",
  ]) assert.equal(applicationAnswerKey(label), undefined, label);
  const plan = applicationAnswerPlan({ enabled: true, values: {} }, labels);
  assert.equal(plan.answers.length, 0);
  assert.equal(plan.details.length, 4);
});

const smsApplicationAgreement = "Check Yes or No to indicate your agreement to receive text message updates from BioAge Labs regarding your job application.";
const smsApplicationNotices = " Frequency may vary. Message and data rates may apply. Reply HELP for assistance. Reply STOP to opt out of future messaging.";

test("application-only SMS agreements accept named employers and informational messaging notices", () => {
  const labels = [
    smsApplicationAgreement + smsApplicationNotices,
    smsApplicationAgreement,
    smsApplicationAgreement + " Message and data rates may apply.",
    smsApplicationAgreement + " Reply STOP to opt out of future messaging.",
    (smsApplicationAgreement + smsApplicationNotices).replace("BioAge Labs", "Acme Research, Inc."),
    (smsApplicationAgreement + smsApplicationNotices).replace("BioAge Labs", "O'Reilly Research"),
    (smsApplicationAgreement + smsApplicationNotices).replace("BioAge Labs", "P&G"),
    `  ${(smsApplicationAgreement + smsApplicationNotices).replaceAll(" ", "\n")} * `,
  ];
  for (const label of labels) for (const answer of ["Yes", "No"]) {
    assert.equal(applicationAnswerKey(label), "smsUpdates", label);
    const plan = applicationAnswerPlan({ enabled: true, values: { smsUpdates: answer } }, [label]);
    assert.equal(plan.answers.length, 1, label);
    assert.deepEqual(plan.answers[0], {
      label, answer, answerKey: "smsUpdates", alternatives: answer === "Yes"
        ? ["Yes - I consent to receiving text messages", "Yes, please", "Yes, I would like to opt in"]
        : ["No - I do not consent to receiving text messages", "No, thank you", "No, I do not wish to opt in"],
    });
    assert.deepEqual(plan.details, []);
  }
});

test("SMS agreement options require an enabled explicit SMS preference and never cross consent channels", () => {
  const label = smsApplicationAgreement + smsApplicationNotices;
  for (const saved of [undefined, { enabled: false, values: { smsUpdates: "Yes" } },
    { enabled: true, values: {} }, { enabled: true, values: { smsUpdates: "" } },
    { enabled: true, values: { emailUpdates: "Yes", talentCommunity: "Yes", jobAlerts: "Yes", careerNewsletters: "Yes" } }]) {
    const plan = applicationAnswerPlan(saved, [label]);
    assert.deepEqual(plan.answers, [], JSON.stringify(saved));
    assert.equal(plan.details[0]?.answerKey, "smsUpdates");
    assert.match(plan.details[0].reason, /Enable sharing|Add receive text messages about my application/);
  }
  for (const [otherLabel, key] of [
    ["Would you like to receive email updates about my application?", "emailUpdates"],
    ["Would you like to join our talent community?", "talentCommunity"],
    ["Would you like to receive email job alerts?", "jobAlerts"],
    ["Would you like to receive career newsletters?", "careerNewsletters"],
  ]) for (const answer of ["Yes", "No"]) {
    const plan = applicationAnswerPlan({ enabled: true, values: { [key]: answer } }, [otherLabel]);
    assert.equal(plan.answers.length, 1);
    assert.doesNotMatch(plan.answers[0].alternatives!.join(" "), /text messages/);
  }
});

test("SMS template matching rejects combined purposes, other recipients and added legal conditions", () => {
  const label = smsApplicationAgreement + smsApplicationNotices;
  const labels = [
    smsApplicationAgreement.replace("text message updates", "marketing text message updates"),
    smsApplicationAgreement.replace("text message updates", "text message and email updates"),
    smsApplicationAgreement.replace("your job application", "your job application and future job opportunities"),
    smsApplicationAgreement.replace("your job application", "your job application or marketing offers"),
    smsApplicationAgreement.replace("regarding your job application", "for any purpose"),
    smsApplicationAgreement.replace("regarding your job application", "regarding job alerts"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs and its partners"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs or third-party affiliates"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs & partners"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs & Acme"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs, Acme"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs for future opportunities"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs on behalf of Acme"),
    smsApplicationAgreement.replace("BioAge Labs", "BioAge Labs marketing"),
    smsApplicationAgreement.replace("your agreement", "your disagreement"),
    label + " I agree to the terms and conditions.",
    label + " I consent to the privacy policy.",
    label + " I certify that I own this phone number.",
    label + " I agree to receive marketing messages.",
    label + " This consent also covers promotional offers.",
    label.replace("Frequency may vary.", "Frequency may vary and promotional messages may be sent."),
    label.replace("Message and data rates may apply.", "I accept all messaging charges."),
    label.replace("Reply HELP for assistance.", "Reply HELP for assistance and accept our terms."),
    label.replace("Reply STOP to opt out of future messaging.", "You cannot opt out of future messaging."),
  ];
  const saved = { enabled: true, values: { smsUpdates: "Yes", emailUpdates: "Yes", talentCommunity: "Yes", jobAlerts: "Yes", careerNewsletters: "Yes" } };
  for (const text of labels) {
    assert.equal(applicationAnswerKey(text), undefined, text);
    assert.deepEqual(applicationAnswerPlan(saved, [text]).answers, [], text);
  }
});

test("notice period, earliest start and weekly schedule never substitute for one another", () => {
  const saved = { enabled: true, values: { noticePeriod: "2 weeks", startDate: "2026-10-15", availability: "Monday to Friday, 9am to 5pm", travel: "No" } };
  for (const label of ["Notice period", "What is your current notice period?", "Please specify your notice period.", "How much notice do you need to give your current employer?"])
    assert.equal(applicationAnswerPlan(saved, [label]).answers[0]?.answer, "2 weeks", label);
  assert.equal(applicationAnswerPlan(saved, ["When are you available to start?"]).answers[0].answer, "2026-10-15");
  assert.equal(applicationAnswerPlan(saved, ["What days and hours are you available to work?"]).answers[0].answer, saved.values.availability);
  assert.equal(applicationAnswerPlan(saved, ["Are you willing to travel for business?"]).answers[0].answer, "No");
  for (const label of [
    "Availability", "When are you available?", "Notice period in days", "Can you start in two weeks?",
    "What is your notice period and current salary?", "What is your contractual minimum notice period?",
    "Are you available for weekend shifts?", "How much time off do you need?",
    "Are you willing to travel 50% of the time?", "Are you willing to travel internationally?",
    "Are you able to drive for work?", "Are you willing to travel and relocate?",
  ]) assert.deepEqual(applicationAnswerPlan(saved, [label]).answers, [], label);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values: { startDate: "2026-10-15" } }, ["Notice period"]).answers, []);
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values: { noticePeriod: "2 weeks" } }, ["When can you start?"]).answers, []);
});

test("commute preferences require the exact city, region and country, never any location", () => {
  const saved = { enabled: true, values: { relocation: "Yes", travel: "Yes" }, commutes: [
    { location: "Toronto, ON, Canada", willingness: "Yes" }, { location: "New York, NY, US", willingness: "No" },
    { location: "Portland, OR, US", willingness: "Yes" },
  ] };
  for (const [label, answer] of [
    ["Are you willing to commute to Toronto, ON, CA?", "Yes"],
    ["Are you willing to commute to our office in Toronto, ON, Canada?", "Yes"],
    ["Are you willing to commute to Toronto, Ontario, Canada?", "Yes"],
    ["Are you open to commute to New York, NY, United States?", "No"],
    ["Are you prepared to commute to Portland, OR, US?", "Yes"],
  ]) assert.equal(applicationAnswerPlan(saved, [label]).answers[0]?.answer, answer, label);
  for (const label of [
    "Are you willing to commute to Ottawa, ON, CA?", "Are you willing to commute to Toronto?",
    "Are you willing to commute to Toronto, Canada?",
    "Are you willing to commute to Toronto, OH, US?", "Are you willing to commute to any location?",
    "Are you willing to commute to Toronto, ON, CA every day?", "Are you willing to commute to Toronto, ON, CA or New York, NY, US?",
    "Are you willing to commute 50 miles?", "Do you live within commuting distance of Toronto, ON, CA?",
    "Can you reliably commute to Toronto, ON, CA?", "Are you willing to relocate to Toronto, ON, CA?",
  ]) assert.deepEqual(applicationAnswerPlan(saved, [label], undefined, "CA", "Toronto, ON, CA").answers, [], label);
  const label = "Are you willing to commute to Toronto, ON, CA?";
  assert.deepEqual(applicationAnswerPlan({ ...saved, commutes: undefined }, [label]).answers, []);
  assert.deepEqual(applicationAnswerPlan({ ...saved, enabled: false }, [label]).answers, []);
  assert.deepEqual(applicationAnswerPlan({ ...saved, commutes: [{ location: "Toronto, ON, CA" }] }, [label]).answers, []);
  assert.deepEqual(applicationAnswerPlan({ ...saved, commutes: [...saved.commutes, { location: "toronto, on, ca", willingness: "No" }] }, [label]).answers, []);
});

test("posting-location commute is wired through the plan input without a residence fallback", () => {
  const url = "https://job-boards.greenhouse.io/example/jobs/123";
  const labels = ["Are you willing to commute?", "Are you willing to commute to our office?", "Are you willing to commute to this job's location?"];
  const saved = { enabled: true, values: {}, commutes: [{ location: "Toronto, ON, CA", willingness: "Yes" }] };
  const input = autofillPlanSchema.parse({ url, questions: labels, employmentCountry: "CA", employmentLocation: "  Toronto, ON, CA  " });
  assert.equal(input.employmentLocation, "Toronto, ON, CA");
  assert.deepEqual(applicationAnswerPlan(saved, input.questions, input.url, input.employmentCountry, input.employmentLocation).answers.map(a => a.answerKey), ["commute", "commute", "commute"]);
  for (const employmentLocation of [undefined, "Toronto", "Toronto, ON", "Canada", "Remote, CA", "Toronto, ON, CA; New York, NY, US", "Toronto, ON, CA / Ottawa, ON, CA", "Ottawa, ON, CA"])
    assert.deepEqual(applicationAnswerPlan(saved, labels, url, "CA", employmentLocation).answers, [], String(employmentLocation));
  const missing = applicationAnswerPlan(saved, labels, url, "CA");
  assert.match(missing.details[0].reason, /could not be confirmed/);
  assert.deepEqual(applicationAnswerPlan(saved, labels, url, "US", "Toronto, ON, CA").answers, [], "Conflicting country and location cannot confirm generic commute scope");
  assert.deepEqual(applicationAnswerPlan({ ...saved, enabled: false }, labels, url, "CA", "Toronto, ON, CA").answers, []);
  for (const employmentLocation of ["", " ", "x".repeat(201), ["Toronto, ON, CA"], { city: "Toronto" }])
    assert.equal(autofillPlanSchema.safeParse({ url, questions: labels, employmentLocation }).success, false);
  assert.equal(autofillPlanSchema.parse({ url, questions: labels }).employmentLocation, undefined);
});

test("source follow-ups require adjacent source context and the selected Other option", () => {
  const url = "https://job-boards.greenhouse.io/braze/jobs/8222294";
  for (const parent of ["How did you hear about Braze?", "How did you find this job?", "How did you hear about this career opportunity?"]) {
    for (const followup of ["Please specify", "If Other, please specify.", 'If "other," please tell us more!', "If you selected 'Other', please provide details"]) {
      const plan = applicationAnswerPlan({ enabled: true, values: { jobSource: "ApplyOverflow" } }, [parent, followup], url);
      assert.equal(plan.answers.length, 2, `${parent}: ${followup}`);
      assert.equal(plan.answers[1].answer, "ApplyOverflow");
      assert.deepEqual(plan.answers[1].dependsOn, { answerKey: "jobSource", answer: "Other", alternatives: ["Other (please specify)", "Other - please specify"] });
    }
  }
  const labels = ["How did you hear about this job?", "If Other, please specify"];
  assert.equal(applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "University job board" } }, labels).answers[1].answer, "University job board");
  for (const values of [{ jobSource: "LinkedIn", sourceDetails: "Do not export" }, { jobSource: "Other" }, { sourceDetails: "Do not export" }])
    assert.ok(!applicationAnswerPlan({ enabled: true, values }, labels).answers.some(a => a.answerKey === "sourceDetails"));
  for (const labels of [
    ["Please specify"], ["What is your disability status?", "If Other, please specify"],
    ["How did you hear about this job?", "Gender", "If Other, please specify"],
    ["How did you hear about this job?", "If Other, provide your citizenship and visa details"],
    ["How did you hear about a different employer?", "Please specify"],
  ]) assert.ok(!applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "Do not export" } }, labels, url).answers.some(a => a.answerKey === "sourceDetails"), labels.join("; "));
});

test("combined source follow-ups use Other only, never an employee or event identity", () => {
  const parent = "How did you initially hear about this job?*";
  for (const label of [
    "If you chose Braze Employee, Conference / Event / Career Fair, or Other, please specify here:",
    "If you chose Recursion Employee, Recursion Event, or Other, please specify here:",
    "If you selected Employee Referral or Other, please specify:",
  ]) {
    for (const jobSource of ["Other", "ApplyOverflow"]) {
      const plan = applicationAnswerPlan({ enabled: true, values: { jobSource, sourceDetails: "Community job board" } }, [parent, label]);
      assert.equal(plan.answers.length, 2, label);
      assert.equal(plan.answers[1].answer, jobSource === "Other" ? "Community job board" : "ApplyOverflow");
      assert.equal(plan.answers[1].dependsOn?.answer, "Other");
      assert.doesNotMatch(plan.answers[1].dependsOn?.alternatives?.join(" ") || "", /employee|event|conference/i);
    }
    assert.ok(!applicationAnswerPlan({ enabled: true, values: { jobSource: "LinkedIn", sourceDetails: "Must stay private" } }, [parent, label]).answers.some(a => a.answerKey === "sourceDetails"));
    assert.deepEqual(applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "Must stay private" } }, [label]).answers, []);
  }
  for (const label of [
    "If you chose Braze Employee or Conference / Event / Career Fair, please specify here:",
    "If you chose Other, please specify and certify the information is accurate:",
    "If you chose Other, please provide a referrer's name:",
  ]) assert.ok(!applicationAnswerPlan({ enabled: true, values: { jobSource: "Other", sourceDetails: "Must stay private" } }, [parent, label]).answers.some(a => a.answerKey === "sourceDetails"), label);
});

test("common yes/no aliases are fixed semantic phrases, never arbitrary declarations", () => {
  const cases = [
    ["Are you legally authorized to work in Canada?", "authorizedCA", "Yes, I am", "No, I am not"],
    ["Will you require sponsorship now or in the future in Canada?", "sponsorshipCA", "Yes, I do", "No, I do not"],
    ["Would you like to receive email job alerts?", "jobAlerts", "Yes, please", "No, thank you"],
    ["Are you willing to travel for work?", "travel", "Yes, I am willing to travel", "No, I am not willing to travel"],
  ];
  for (const [label, key, yes, no] of cases) for (const answer of ["Yes", "No"]) {
    const alternatives = applicationAnswerPlan({ enabled: true, values: { [key]: answer } }, [label]).answers[0]?.alternatives;
    assert.ok(alternatives?.includes(answer === "Yes" ? yes : no), label);
    assert.doesNotMatch(alternatives!.join(" "), /certif|attest|privacy|terms|citizen|permanent resident|marketing|third.party/i);
  }
});

test("career newsletters are separate and combined talent consent requires two identical explicit choices", () => {
  const label = "Select \u2018Yes\u2019 to join Braze\u2019s Talent Community and receive newsletters to help you stay up to date on career-related news, events and opportunities at Braze.";
  const otherEmployer = "Select 'Yes' to join Example Co's Talent Community and receive newsletters to help you stay up to date on career-related news, events and opportunities at Example Co.";
  for (const question of [label, otherEmployer]) {
    assert.equal(applicationAnswerKey(question), "talentCommunityNewsletters");
    for (const answer of ["Yes", "No"]) {
      const saved = { enabled: true, values: { talentCommunity: answer, careerNewsletters: answer } };
      const plan = applicationAnswerPlan(saved, [question]);
      assert.equal(plan.answers[0]?.answerKey, "talentCommunityNewsletters");
      assert.equal(plan.answers[0]?.answer, answer);
      assert.deepEqual(applicationAnswerPlan({ ...saved, enabled: false }, [question]).answers, []);
    }
    for (const values of [
      {}, { talentCommunity: "Yes" }, { careerNewsletters: "Yes" },
      { talentCommunity: "Yes", careerNewsletters: "No" }, { talentCommunity: "No", careerNewsletters: "Yes" },
      { talentCommunity: "", careerNewsletters: "No" }, { talentCommunity: "No", careerNewsletters: "" },
      { smsUpdates: "Yes", emailUpdates: "Yes", jobAlerts: "Yes" },
    ]) {
      const plan = applicationAnswerPlan({ enabled: true, values }, [question]);
      assert.deepEqual(plan.answers, [], JSON.stringify(values));
      assert.match(plan.details[0].reason, /matching explicit choices/);
    }
  }
  const single = "Would you like to receive career-related newsletters?";
  assert.equal(applicationAnswerKey(single), "careerNewsletters");
  assert.equal(applicationAnswerPlan({ enabled: true, values: { careerNewsletters: "No" } }, [single]).answers[0]?.answer, "No");
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values: { emailUpdates: "Yes", jobAlerts: "Yes", talentCommunity: "Yes" } }, [single]).answers, []);
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: { talentCommunityNewsletters: "Yes" } }).success, false, "Combined answers are derived, never a second saved value");
  for (const question of [
    label.replace("at Braze.", "at Other Employer."),
    label.replace("newsletters to help", "marketing newsletters to help"),
    label.replace("career-related news, events and opportunities", "news, promotional offers and partner opportunities"),
    label.replace("at Braze.", "at Braze and agree to the privacy policy."),
    "Would you like to receive newsletters?", "Would you like to receive career-related newsletters and SMS messages?",
  ]) assert.equal(applicationAnswerKey(question), undefined, question);
});

test("regular commute and office work still requires an explicit matching location preference", () => {
  const label = "Will you be able to regularly commute and work in an office in job posting location?";
  for (const willingness of ["Yes", "No"]) {
    const saved = { enabled: true, values: {}, commutes: [{ location: "Toronto, ON, CA", willingness }] };
    assert.equal(applicationAnswerPlan(saved, [label], undefined, "CA", "Toronto, ON, CA").answers[0]?.answer, willingness);
    for (const location of [undefined, "Toronto", "Ottawa, ON, CA", "Toronto, CA", "Remote, CA"])
      assert.deepEqual(applicationAnswerPlan(saved, [label], undefined, "CA", location).answers, [], String(location));
    assert.deepEqual(applicationAnswerPlan({ ...saved, enabled: false }, [label], undefined, "CA", "Toronto, ON, CA").answers, []);
    for (const question of [
      label.replace("regularly", "five days a week"), label.replace("an office", "any office"),
      label.replace("commute and work", "relocate and work"), label.replace("?", " and travel internationally?"),
    ]) assert.deepEqual(applicationAnswerPlan(saved, [question], undefined, "CA", "Toronto, ON, CA").answers, [], question);
  }
  assert.deepEqual(applicationAnswerPlan({ enabled: true, values: { relocation: "Yes", travel: "Yes" } }, [label], undefined, "CA", "Toronto, ON, CA").answers, []);
});

test("current company and title project only a single explicitly current structured experience", () => {
  const current = { company: "  Current Co  ", title: "  Engineer  ", dates: { start: "2024-01", end: "", current: true } };
  const past = { company: "Old Co", title: "Analyst", dates: { start: "2021-01", end: "2023-12", current: false } };
  const blank = { currentCompany: "", currentTitle: "" };
  assert.deepEqual(currentEmploymentFields([past, current]), { currentCompany: "Current Co", currentTitle: "Engineer" });
  assert.deepEqual(currentEmploymentFields([{ ...current, title: "" }]), { currentCompany: "Current Co", currentTitle: "" });
  assert.deepEqual(currentEmploymentFields([{ ...current, company: "" }]), { currentCompany: "", currentTitle: "Engineer" });
  for (const raw of [undefined, {}, [], [past], [current, current],
    [{ company: "Guess Co", title: "Engineer", time: "2024 - Present" }],
    [{ ...current, dates: { ...current.dates, current: "true" } }],
    [{ ...current, dates: { ...current.dates, end: "2025-01" } }],
    [current, { dates: { current: true } }],
    [...Array.from({ length: 40 }, () => past), current, current],
  ]) assert.deepEqual(currentEmploymentFields(raw), blank, JSON.stringify(raw));
  for (const profileKey of ["currentCompany", "currentTitle"]) {
    assert.equal(Object.hasOwn(autofillProfileFields, profileKey), false);
    assert.equal(autofillAnswerSchema.safeParse({ url: "https://job-boards.greenhouse.io/example/jobs/123", label: "Current company", answer: "Other", profileKey, revision: "2026-09-28T00:00:00.000Z" }).success, false);
  }
});

test("employer facts and conditional details reject negation, other employers and certifications", () => {
  const url = "https://job-boards.greenhouse.io/missionlane/jobs/123";
  const saved = { enabled: true, values: {}, employers: [{ url, employeeRelationship: "Yes", relationshipDetails: "Saved relationship", previousEmployment: "No", referral: "Yes", referralName: "Saved referrer" }] };
  assert.equal(applicationAnswerPlan(saved, ["Have you ever worked for us before?"], url).answers[0]?.answer, "No");
  assert.equal(applicationAnswerPlan(saved, ["Were you referred by an employee of this company?"], url).answers[0]?.answer, "Yes");
  for (const label of [
    "Are you not related to any current Mission Lane employee?", "Are you related to any current Mission Lane or Other Co employee?",
    "Are you related to any current Mission Lane Finance employee?", "Are you related to any current Other Co employee?",
    "I certify that you are related to a current Mission Lane employee", "I attest that you have worked for us before",
    "Have you worked for this company or any government agency?", "Were you referred by an employee of this company and did you pay a fee?",
    "Referrer's name and citizenship", "I certify the referring employee's name is accurate",
  ]) assert.deepEqual(applicationAnswerPlan(saved, [label], url).answers, [], label);
  const followup = "If applicable, please provide their name(s) and your relationship to them.";
  assert.equal(applicationAnswerPlan(saved, ["Are you related to any current Mission Lane employee?", followup], url).answers[1].answer, "Saved relationship");
  assert.ok(!applicationAnswerPlan(saved, ["Are you related to any current Other Co employee?", followup], url).answers.some(a => a.answerKey === "relationshipDetails"));
  assert.equal(applicationAnswerPlan({ ...saved, employers: [...saved.employers, saved.employers[0]] }, ["Have you ever worked for us before?"], url).answers.length, 0);
});

test("visa details require a scoped US parent and never substitute for other countries or declarations", () => {
  const saved = { enabled: true, values: { sponsorshipUS: "Yes", visaDetailsUS: "User-provided US visa details" } };
  const parent = "Will you require sponsorship now or in the future?";
  const followup = "If yes, please specify your visa type and remaining validity";
  const plan = applicationAnswerPlan(saved, [parent, followup], undefined, "US");
  assert.equal(plan.answers[1]?.answer, "User-provided US visa details");
  assert.equal(plan.answers[1]?.dependsOn?.answerKey, "sponsorshipUS");
  assert.equal(plan.answers[1]?.dependsOn?.answer, "Yes");
  for (const country of [undefined, "CA"] as const)
    assert.ok(!applicationAnswerPlan(saved, [parent, followup], undefined, country).answers.some(a => a.answerKey === "visaDetailsUS"));
  for (const label of [
    "Please provide your Australian visa type and remaining validity", "Visa type and remaining validity of your spouse",
    "I certify my visa type and validity", "Visa type and expiry; authorize a background check",
  ]) assert.ok(!applicationAnswerPlan(saved, [parent, label], undefined, "US").answers.some(a => a.answerKey === "visaDetailsUS"), label);
});

test("commute regions reuse exact country-scoped subdivision aliases without expanding cities", () => {
  for (const [country, name, code] of [
    ["CA", "Ontario", "ON"], ["CA", "British Columbia", "BC"], ["CA", "Quebec", "QC"],
    ["CA", "Newfoundland and Labrador", "NL"], ["CA", "Northwest Territories", "NT"],
    ["US", "California", "CA"], ["US", "New York", "NY"], ["US", "Oregon", "OR"], ["US", "District of Columbia", "DC"],
  ] as const) {
    assert.equal(normalizeLocationSubdivision(name, country), code);
    assert.equal(normalizeLocationSubdivision(code.toLowerCase(), country), code);
    assert.equal(normalizeLocationSubdivision(name, country === "CA" ? "US" : "CA"), undefined);
  }
  assert.equal(normalizeLocationSubdivision("Qu\u00e9bec", "CA"), "QC");
  for (const value of ["Toronto", "Greater Toronto Area", "Bay Area", "Canada", "United States", "Ontario or Quebec", "NY/NJ", "Unknown"])
    for (const country of ["CA", "US"] as const) assert.equal(normalizeLocationSubdivision(value, country), undefined, value);

  const label = "Will you be able to regularly commute and work in an office in job posting location?";
  for (const [savedLocation, jobLocation] of [
    ["Toronto, ON, CA", "Toronto, Ontario, Canada"], ["Toronto, Ontario, Canada", "Toronto, ON, CA"],
    ["San Francisco, CA, US", "San Francisco, California, United States"],
    ["Portland, OR, US", "Portland, Oregon, US"],
    ["St. John's, NL, CA", "St. John's, Newfoundland and Labrador, CA"],
    ["Montreal, QC, CA", "Montreal, Qu\u00e9bec, CA"],
  ]) {
    const saved = { enabled: true, values: {}, commutes: [{ location: savedLocation, willingness: "Yes" }] };
    assert.equal(applicationAnswerPlan(saved, [label], undefined, undefined, jobLocation).answers[0]?.answer, "Yes", jobLocation);
  }
  const saved = { enabled: true, values: {}, commutes: [{ location: "Toronto, ON, CA", willingness: "Yes" }] };
  for (const jobLocation of ["Toronto, California, US", "Toronto, ON, US", "Toronto, Ontario", "Toronto, CA", "Ottawa, Ontario, Canada", "Greater Toronto Area, Ontario, Canada"])
    assert.deepEqual(applicationAnswerPlan(saved, [label], undefined, undefined, jobLocation).answers, [], jobLocation);
  assert.deepEqual(applicationAnswerPlan({ ...saved, commutes: [...saved.commutes, { location: "Toronto, Ontario, Canada", willingness: "No" }] }, [label], undefined, "CA", "Toronto, ON, CA").answers, [], "Alias-equivalent duplicate rows remain ambiguous");
});

test("nonblank commute locations are validated before saving instead of silently becoming unusable", () => {
  for (const location of ["Toronto, Ontario, Canada", "Toronto, ON, CA", "Toronto, Canada", "San Francisco, California, United States", "Portland, OR, US", "St. John's, Newfoundland and Labrador, CA"]) {
    assert.equal(commuteLocationError(location), undefined, location);
    assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: {}, commutes: [{ location, willingness: "Yes" }] }).success, true, location);
  }
  for (const location of ["Toronto", "Toronto, Ontario", "Remote, CA", "Toronto, ON, US", "San Francisco, CA, CA", "Toronto, unknown, CA", "Toronto / Ottawa, Ontario, Canada", "Toronto, ON, CA; Ottawa, ON, CA", "123, CA", "Toronto, ON, UK"]) {
    assert.ok(commuteLocationError(location), location);
    const result = profileApplicationAnswersSchema.safeParse({ enabled: false, values: {}, commutes: [{ location }] });
    assert.equal(result.success, false, location);
    if (!result.success) assert.deepEqual(result.error.issues[0].path, ["commutes", 0, "location"]);
  }
  assert.equal(commuteLocationError(""), undefined, "An unused optional row may remain empty");
  assert.ok(commuteLocationError("", "Yes"), "Willingness alone must not become an unscoped preference");
  assert.equal(profileApplicationAnswersSchema.safeParse({ enabled: true, values: {}, commutes: [{ location: "", willingness: "No" }] }).success, false);
});

test("recognizable eligibility without a confirmed country gets guidance but never a guessed answer", () => {
  const labels = ["Are you legally authorized to work?", "Will you now or in the future require sponsorship?",
    "Are you legally authorized to work in the country where this position is located?"];
  const values = { authorizedCA: "Yes", authorizedUS: "Yes", sponsorshipCA: "No", sponsorshipUS: "No" };
  for (const enabled of [true, false]) {
    const plan = applicationAnswerPlan({ enabled, values }, labels, "https://job-boards.greenhouse.io/braze/jobs/8222294", undefined, "Toronto");
    assert.deepEqual(plan.answers, []);
    assert.deepEqual(plan.details.map(detail => detail.answerKey), ["authorizationCountry", "sponsorshipCountry", "authorizationCountry"]);
    for (const detail of plan.details) {
      assert.match(detail.reason, /country could not be confirmed/);
      assert.match(detail.reason, /employer form/);
      assert.equal(detail.notApplicable, undefined);
    }
  }
  const known = applicationAnswerPlan({ enabled: true, values }, labels, undefined, "CA", "Toronto, Ontario, Canada");
  assert.equal(known.answers.length, 3);
  assert.equal(known.details.length, 0);
  const conflict = applicationAnswerPlan({ enabled: true, values }, labels, undefined, "US", "Toronto, Ontario, Canada");
  assert.deepEqual(conflict.answers, []);
  assert.equal(conflict.details.length, 3);
  for (const label of ["I certify that I am legally authorized to work", "Are you authorized to work without sponsorship?", "Will you require sponsorship only in the future in the UK?"])
    assert.deepEqual(applicationAnswerPlan({ enabled: true, values }, [label]).details, [], "Unsupported legal scope is not mislabeled as just a missing country");
});

test("positive country-of-work-authorization questions export only explicitly saved Yes countries", () => {
  const label = "Please select the country (or countries) where you have work authorization: *";
  const cases = [
    [{ authorizedCA: "Yes", authorizedUS: "No" }, ["Canada"]],
    [{ authorizedCA: "No", authorizedUS: "Yes" }, ["United States"]],
    [{ authorizedCA: "Yes", authorizedUS: "Yes" }, ["Canada", "United States"]],
    [{ authorizedUS: "Yes", authorizedCA: "Yes" }, ["Canada", "United States"]],
    [{ authorizedCA: "Yes" }, ["Canada"]],
    [{ authorizedCA: "", authorizedUS: "Yes" }, ["United States"]],
  ] as const;
  assert.equal(applicationAnswerKey(label), "authorizedCountries");
  for (const [values, selections] of cases) {
    for (const employmentCountry of [undefined, "CA", "US"] as const) {
      const plan = applicationAnswerPlan({ enabled: true, values }, [label], undefined, employmentCountry, "Toronto");
      assert.deepEqual(plan.answers, [{ label, answer: selections[0], answerKey: "authorizedCountries", selections }]);
      assert.deepEqual(plan.details, []);
    }
  }
  const saved = { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "Yes" } };
  assert.deepEqual(commonApplicationAnswers(saved, [label]), [{ label, answer: "Canada" }], "Legacy scalar consumers retain the first answer");
  assert.equal(profileApplicationAnswersSchema.safeParse({ ...saved, values: { ...saved.values, authorizedCountries: "Canada" } }).success, false, "The country set is derived, not a duplicate saved fact");
  const scalar = applicationAnswerPlan(saved, ["Are you authorized to work in Canada?"]).answers[0];
  assert.equal(scalar.answer, "Yes");
  assert.equal(scalar.selections, undefined, "Existing scalar mappings do not gain selection metadata");
});

test("authorization country selections stay empty for disabled, unknown or all-No facts", () => {
  const label = "Please select the country (or countries) where you have work authorization: *";
  for (const values of [
    {}, { authorizedCA: "", authorizedUS: "" }, { authorizedCA: "No" }, { authorizedUS: "No" },
    { authorizedCA: "No", authorizedUS: "No" }, { usPerson: "Yes", sponsorshipUS: "No", sponsorshipCA: "No" },
  ]) {
    const plan = applicationAnswerPlan({ enabled: true, values }, [label], "https://job-boards.greenhouse.io/recursion/jobs/123", "US");
    assert.deepEqual(plan.answers, [], JSON.stringify(values));
    assert.equal(plan.details.length, 1);
    assert.equal(plan.details[0].answerKey, "authorizedCountries");
    assert.match(plan.details[0].reason, /No country has an explicit saved Yes/);
    assert.equal(plan.details[0].notApplicable, undefined);
  }
  for (const raw of [undefined, { enabled: false, values: { authorizedCA: "Yes", authorizedUS: "Yes" } }, { enabled: true, values: { authorizedCA: true } }]) {
    const plan = applicationAnswerPlan(raw, [label]);
    assert.deepEqual(plan.answers, []);
    assert.match(plan.details[0].reason, /Enable sharing/);
  }
});

test("country-set matching preserves positive work authorization without legal or citizenship expansion", () => {
  const saved = { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "Yes", usPerson: "Yes", sponsorshipUS: "No" } };
  for (const label of [
    "Select the countries where you have work authorization.",
    "Please choose the country(ies) in which you currently have work authorisation",
    "Please select countries where you are legally authorized to work (select all that apply)",
    "Which countries are you currently authorised to work in?",
  ]) assert.deepEqual(applicationAnswerPlan(saved, [label]).answers[0]?.selections, ["Canada", "United States"], label);
  for (const label of [
    "Please select the countries where you do not have work authorization",
    "Please select countries where you will have work authorization",
    "Please select the countries where you have work authorization without sponsorship",
    "Please select the countries where you have unrestricted work authorization",
    "Please select countries where you have work authorization or citizenship",
    "Please select countries where you are a citizen",
    "Please select countries where you have permanent residence",
    "Please select countries where you require sponsorship",
    "Please select countries where you have work authorization and agree to the terms",
    "I certify the countries where you have work authorization",
    "Please select countries where you have work authorization in the future",
    "Please select the country where you have work authorization in Canada only",
  ]) assert.deepEqual(applicationAnswerPlan(saved, [label], undefined, "US").answers, [], label);
});
