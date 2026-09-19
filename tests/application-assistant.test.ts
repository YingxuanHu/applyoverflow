import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedExtension,
  applicationContext,
  captureSchema,
  extensionCallback,
  extensionRequestSchema,
  greenhouseContext,
  mergeCapturedQuestions,
  parseAnswerLibrary,
  questionKind,
  reviewSaveSchema,
} from "../src/lib/application-assistant";

test("extension allowlist fails closed and validates IDs", () => {
  const id = "a".repeat(32);
  assert.equal(allowedExtension(id, ""), false);
  assert.equal(allowedExtension(id, ` ${id},${"b".repeat(32)}`), true);
  assert.equal(allowedExtension("z".repeat(32), "z".repeat(32)), false);
  assert.equal(extensionCallback(id), `https://${id}.chromiumapp.org/callback`);
  assert.throws(() => extensionCallback("https://evil.example"));
  assert.equal(
    extensionRequestSchema.safeParse({
      clientId: id,
      challenge: "a".repeat(43),
      state: "a".repeat(32),
      redirect: "https://evil.example",
    }).success,
    false,
  );
});
test("job identity is tenant- and region-scoped, strips tracking only", () => {
  assert.deepEqual(
    greenhouseContext(
      "https://boards.greenhouse.io/acme/jobs/123?utm_source=x#app",
    ),
    {
      companyKey: "greenhouse:us:acme",
      tenant: "acme",
      url: "https://job-boards.greenhouse.io/acme/jobs/123",
    },
  );
  assert.equal(
    greenhouseContext("https://job-boards.eu.greenhouse.io/acme/jobs/123")
      ?.companyKey,
    "greenhouse:eu:acme",
  );
  for (const url of [
    "http://boards.greenhouse.io/acme/jobs/123",
    "https://boards.greenhouse.io.evil.com/acme/jobs/123",
    "https://a@boards.greenhouse.io/acme/jobs/123",
    "https://boards.greenhouse.io:8443/acme/jobs/123",
    "https://boards.greenhouse.io/embed/job_app?token=123",
    "https://boards.greenhouse.io/acme",
  ])
    assert.equal(greenhouseContext(url), null, url);
});
test("capture merges multi-step questions without overwriting answers", () => {
  const input = {
    url: "https://boards.greenhouse.io/acme/jobs/123",
    title: "Engineer",
    questions: ["Why this role?", "Why this role?"],
  };
  const initial = mergeCapturedQuestions(null, input);
  initial.questions[0].answer = "Reviewed answer";
  const next = mergeCapturedQuestions(initial, {
    ...input,
    questions: ["Why this role?", "Tell us more."],
  });
  assert.equal(next.questions.length, 2);
  assert.equal(next.questions[0].answer, "Reviewed answer");
  assert.equal(next.revision, 2);
  assert.equal(
    mergeCapturedQuestions(initial, {
      ...input,
      url: "https://boards.greenhouse.io/acme/jobs/456",
    }).questions[0].answer,
    "",
  );
});

test("Lever and Ashby identities merge application steps without crossing tenants or regions", () => {
  const id = "ac978161-6f46-4f6b-ad9e-a258e642751c";
  for (const [host, step, provider] of [
    ["jobs.lever.co", "apply", "lever"],
    ["jobs.eu.lever.co", "apply", "lever"],
    ["jobs.ashbyhq.com", "application", "ashby"],
  ]) {
    const base = `https://${host}/acme/${id}`;
    const context = applicationContext(`${base}/${step}?source=x`)!;
    assert.equal(context.url, base);
    assert.equal(context.provider, provider);
    assert.equal(
      captureSchema.safeParse({
        url: `${base}/${step}`,
        title: "Engineer",
        questions: [],
      }).success,
      true,
    );
    const state = mergeCapturedQuestions(null, {
      url: base,
      title: "Engineer",
      questions: ["Why here?"],
    });
    state.questions[0].answer = "Reviewed";
    assert.equal(
      mergeCapturedQuestions(state, {
        url: `${base}/${step}`,
        title: "Engineer",
        questions: [],
      }).questions[0].answer,
      "Reviewed",
    );
    assert.notEqual(
      context.companyKey,
      applicationContext(base.replace("acme", "other"))?.companyKey,
    );
  }
  assert.notEqual(
    applicationContext(`https://jobs.lever.co/acme/${id}`)?.companyKey,
    applicationContext(`https://jobs.eu.lever.co/acme/${id}`)?.companyKey,
  );
  for (const url of [
    `https://jobs.lever.co/acme/${id}/application`,
    `https://jobs.ashbyhq.com/acme/${id}/apply`,
    `https://jobs.ashbyhq.com.evil.test/acme/${id}`,
    `https://jobs.lever.co/acme`,
    `https://jobs.lever.co/acme/${id}/../../login`,
  ])
    assert.equal(applicationContext(url), null);
});
test("capture and answers are bounded and cannot impersonate an owner", () => {
  const input = {
    url: "https://boards.greenhouse.io/acme/jobs/123",
    title: "Engineer",
    questions: ["Why this role?"],
  };
  assert.equal(
    captureSchema.safeParse({ ...input, userId: "someone" }).success,
    false,
  );
  assert.equal(
    captureSchema.safeParse({ ...input, questions: Array(41).fill("Question") })
      .success,
    false,
  );
  assert.equal(
    captureSchema.safeParse({ ...input, questions: ["x".repeat(501)] }).success,
    false,
  );
  assert.equal(
    reviewSaveSchema.safeParse({
      revision: 1,
      answers: [{ key: "q", answer: "x".repeat(3001), remember: true }],
    }).success,
    false,
  );
  assert.deepEqual(parseAnswerLibrary("bad JSON"), []);
});
test("personal, legal and employer-specific questions are not profile facts", () => {
  for (const question of [
    "Gender",
    "What pronouns would you like our team to use?",
    "Disability status",
    "Veteran status",
    "I agree to the terms",
    "Certify this is accurate",
    "Date of birth",
  ])
    assert.equal(questionKind(question), "sensitive");
  for (const question of [
    "Will you need sponsorship?",
    "Right to work",
    "Eligible to work in Canada?",
  ])
    assert.equal(questionKind(question), "work_authorization");
  assert.equal(questionKind("Who referred you?"), "referral");
  assert.equal(
    questionKind("Do you have family here?"),
    "company_relationship",
  );
  assert.equal(questionKind("Tell us about your experience."), "custom");
});
