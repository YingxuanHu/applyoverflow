import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedExtension,
  applicationContext,
  sameApplication,
  captureSchema,
  extensionCallback,
  extensionRequestSchema,
  greenhouseContext,
  mergeCapturedQuestions,
  parseAnswerLibrary,
  questionKind,
  reviewSaveSchema,
  appliedConfirmationSchema,
  historySelectionSchema,
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

test("Workday and iCIMS identities follow steps without crossing employers", () => {
  const job =
    "https://example.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Analyst_R123";
  assert.equal(
    applicationContext(job)?.url,
    applicationContext(`${job}/apply/myExperience`)?.url,
  );
  assert.equal(applicationContext(job)?.provider, "workday");
  const noLocation = job.replace("/Toronto", "");
  assert.equal(
    sameApplication(
      job,
      job.replace("Toronto", "Toronto%2C-Ontario") + "/apply/myInformation",
    ),
    true,
  );
  assert.equal(sameApplication(job, noLocation + "/apply"), true);
  assert.equal(
    sameApplication(job, job.replace("Analyst_R123", "Analyst_R456")),
    false,
  );
  assert.equal(
    sameApplication(job, job.replace("example.", "another.")),
    false,
  );
  for (const suffix of [
    "/apply",
    "/apply/myInformation",
    "/apply/myExperience",
  ]) {
    assert.equal(
      applicationContext(`${noLocation}${suffix}`)?.url,
      applicationContext(noLocation)?.url,
    );
    assert.equal(
      applicationContext(`${job}${suffix}`)?.url,
      applicationContext(job)?.url,
    );
  }
  assert.notEqual(
    applicationContext(job)?.companyKey,
    applicationContext(job.replace("example.", "other."))?.companyKey,
  );
  assert.equal(
    applicationContext(
      "https://careers-example.icims.com/jobs/123/analyst/job?mode=apply",
    )?.url,
    "https://careers-example.icims.com/jobs/123/job",
  );
  for (const url of [
    "https://example.wd1.myworkdayjobs.com/en-US/External/login",
    "https://careers-example.icims.com/connect",
    "https://example.wd1.myworkdayjobs.com.evil.test/en-US/External/job/Toronto/Analyst_R123",
  ])
    assert.equal(applicationContext(url), null);
});
test("generic application URLs are explicit, public HTTPS and job scoped", () => {
  const url = "https://careers.example.com/apply?id=123&utm_source=board";
  assert.equal(applicationContext(url), null);
  assert.equal(
    applicationContext(url, true)?.url,
    "https://careers.example.com/apply?id=123",
  );
  assert.notEqual(
    applicationContext(url, true)?.companyKey,
    applicationContext(url.replace("123", "456"), true)?.companyKey,
  );
  for (const bad of [
    "http://careers.example.com/apply",
    "https://127.0.0.1/apply",
    "https://localhost/apply",
    "https://a.local/apply",
    "https://careers.example.com/login",
    "https://careers.example.com/apply?token=secret",
    "https://careers.example.com/apply?email=a",
    "https://careers.example.com/apply#token",
    "https://user:password@careers.example.com/apply",
  ])
    assert.equal(applicationContext(bad, true), null, bad);
  const payload = {
    url,
    title: "Analyst",
    company: "Example",
    confirmed: true,
  };
  assert.equal(appliedConfirmationSchema.safeParse(payload).success, true);
  assert.equal(
    appliedConfirmationSchema.safeParse({ ...payload, confirmed: false })
      .success,
    false,
  );
  assert.equal(
    appliedConfirmationSchema.safeParse({ ...payload, userId: "other" })
      .success,
    false,
  );
  assert.equal(
    historySelectionSchema.safeParse({
      kind: "experience",
      index: 50,
      revision: new Date().toISOString(),
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

test("Greenhouse embeds share identity with the direct job, never with a different tenant or region", () => {
  for (const [host, region] of [
    ["boards.greenhouse.io", "us"],
    ["job-boards.eu.greenhouse.io", "eu"],
  ]) {
    const embed = `https://${host}/embed/job_app?for=acme&token=123&source=example`;
    const direct = `https://job-boards.${region === "eu" ? "eu." : ""}greenhouse.io/acme/jobs/123`;
    assert.deepEqual(applicationContext(embed), applicationContext(direct));
    const initial = mergeCapturedQuestions(null, {
      url: direct,
      title: "Engineer",
      questions: ["Why this role?"],
    });
    initial.questions[0].answer = "Reviewed";
    assert.equal(
      mergeCapturedQuestions(initial, {
        url: embed,
        title: "Engineer",
        questions: [],
      }).questions[0].answer,
      "Reviewed",
    );
  }
  for (const query of [
    "for=acme",
    "token=123",
    "for=acme&token=123&token=456",
    "for=acme&for=other&token=123",
    "for=https%3A%2F%2Fevil.test&token=123",
    "for=acme&token=-1",
    "for=&token=123",
    "for=acme&token=123abc",
  ])
    assert.equal(
      applicationContext(`https://boards.greenhouse.io/embed/job_app?${query}`),
      null,
    );
  assert.equal(
    applicationContext(
      "https://greenhouse.io.evil.test/embed/job_app?for=acme&token=123",
    ),
    null,
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
