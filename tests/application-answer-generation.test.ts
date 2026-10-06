import test from "node:test";
import assert from "node:assert/strict";
import { generateApplicationAnswer, answerReviewInstructions } from "../src/lib/application-answer-generation";
import { questionAssistance, suggestionEvidence, suggestionRequestSchema } from "../src/lib/extension-suggestions";
import { buildProfileFormValues } from "../src/lib/profile";
import { professionalAutofillFacts } from "../src/lib/extension-autofill";
import { applicationAnswerPlan } from "../src/lib/profile-application-answers";

const input = suggestionRequestSchema.parse({ url: "https://careers.fixture.example/apply", label: "Describe an AI project and how you validated its output", title: "Engineer", jobDescription: "Build AI tools", revision: new Date().toISOString() });
const sources = [{ id: "project-0", text: "Built a Python classifier. Validated predictions against manually labelled test examples." }];
const draft = { answer: "I built a Python classifier and compared predictions with manually labelled test examples.", evidence: [{ id: "project-0", quote: sources[0].text }], missing: "" };
const good = { grounded: true, relevant: true, complete: true, technicallyCorrect: true, missingJustified: true, feedback: "" };
const context = { signal: AbortSignal.timeout(2000), budgetSubject: "synthetic-test" };

test("explicit non-disclosure preferences accept indication wording, never a negative identity", () => {
  const plan = applicationAnswerPlan({ enabled: true, values: { gender: "Prefer not to answer", veteran: "I don't wish to answer", disability: "I do not want to answer" } },
    ["I identify my gender as:", "Veteran Status", "Disability Status"]);
  assert.equal(plan.answers.length, 3);
  for (const answer of plan.answers) {
    assert.ok(answer.alternatives?.includes("Prefer not to indicate"));
    assert.ok(!answer.alternatives?.includes("No"));
  }
});

test("current employment facts use one explicitly ongoing role, never an expired or ambiguous job", () => {
  const experience = { company: "Current Company", title: "Engineer", time: "Jan 2025 - Present" };
  const facts = (experiencesJson: unknown) => professionalAutofillFacts(buildProfileFormValues({ experiencesJson }));
  assert.deepEqual(facts([experience]), { currentCompany: "Current Company", currentTitle: "Engineer" });
  assert.deepEqual(facts([{ ...experience, time: "Jan 2025 - Aug 2025" }]), { currentCompany: "", currentTitle: "" });
  assert.deepEqual(facts([experience, { ...experience, company: "Second Company" }]), { currentCompany: "", currentTitle: "" });
});

test("every inserted draft receives separate semantic review with the full question and evidence", async () => {
  const calls: string[] = [];
  const result = await generateApplicationAnswer(input, sources, async request => {
    assert.equal(request.modelFlavor, "standard");
    assert.equal(request.budgetSubject, context.budgetSubject);
    const name = request.responseFormat!.json_schema.name;
    calls.push(name);
    const data = JSON.parse(request.messages[0].content);
    assert.equal(data.question, input.label);
    assert.deepEqual(data.evidence, sources);
    return JSON.stringify(name === "application_answer" ? draft : good);
  }, context);
  assert.deepEqual(result, draft);
  assert.deepEqual(calls, ["application_answer", "application_answer_quality"]);
  assert.match(answerReviewInstructions, /EVERY factual claim/);
});

for (const criterion of ["grounded", "relevant", "complete", "technicallyCorrect", "missingJustified"] as const) {
  test(`failed ${criterion} is repaired and reviewed again, not silently inserted`, async () => {
    let generations = 0, reviews = 0;
    await generateApplicationAnswer(input, sources, async request => {
      if (request.responseFormat!.json_schema.name === "application_answer") {
        generations++;
        if (generations === 2) assert.match(request.system!, new RegExp(criterion));
        return JSON.stringify(draft);
      }
      return JSON.stringify(++reviews === 1 ? { ...good, [criterion]: false, feedback: "Correct the unsupported or incomplete claim." } : good);
    }, context);
    assert.equal(generations, 2); assert.equal(reviews, 2);
  });
}

test("valid citations cannot bypass rejected unsupported claims", async () => {
  let calls = 0;
  await assert.rejects(() => generateApplicationAnswer(input, sources, async request => {
    calls++;
    return JSON.stringify(request.responseFormat!.json_schema.name === "application_answer"
      ? { ...draft, answer: "I reached 99% accuracy using cross-validation." }
      : { ...good, grounded: false, feedback: "Accuracy and cross-validation are not documented." });
  }, context), /answer-quality review/);
  assert.equal(calls, 4);
});

test("pure technical knowledge works without fabricated resume citations", async () => {
  const knowledge = { ...input, label: "How would you validate a classifier and avoid data leakage?" };
  assert.equal(questionAssistance(knowledge.label), "knowledge");
  const answer = { answer: "I would separate training and evaluation data before fitting preprocessing and check per-class precision and recall.", evidence: [], missing: "" };
  assert.deepEqual(await generateApplicationAnswer(knowledge, [], async request => JSON.stringify(request.responseFormat!.json_schema.name === "application_answer" ? answer : good), context), answer);
});

test("short skill evidence is quoted exactly rather than padded into a false citation", async () => {
  const source = [{ id: "skills", text: "Python" }];
  const answer = { answer: "I use Python.", evidence: [{ id: "skills", quote: "Python" }], missing: "" };
  assert.deepEqual(await generateApplicationAnswer({ ...input, label: "Describe your Python experience" }, source,
    async request => JSON.stringify(request.responseFormat!.json_schema.name === "application_answer" ? answer : good), context), answer);
});

test("limits, exact choices and conflicting missing facts remain hard validation gates", async () => {
  for (const invalid of [{ ...draft, evidence: [] }, { ...draft, missing: "Which project?" }, { ...draft, answer: "x".repeat(60) }]) {
    let reviews = 0;
    await assert.rejects(() => generateApplicationAnswer({ ...input, maxLength: 55 }, sources, async request => {
      if (request.responseFormat!.json_schema.name === "application_answer_quality") reviews++;
      return JSON.stringify(invalid);
    }, context));
    assert.equal(reviews, 0);
  }
});

test("relevant older evidence survives the prompt budget and contains documented date boundaries", () => {
  const profile = buildProfileFormValues({ experiencesJson: Array.from({ length: 24 }, (_, i) => ({ company: "Example", title: "Engineer", description: `Built ordinary reporting tool ${i}.`, time: "Jan - Aug 2025" })),
    projectsJson: [{ name: "Payments", description: "Implemented idempotency keys for payment retries." }] });
  const evidence = suggestionEvidence(profile, "", "Explain your payment idempotency approach");
  assert.ok(evidence.some(row => row.id === "project-0"));
  assert.match(evidence.find(row => row.id === "experience-0")!.text, /2025-01 to 2025-08/);
  assert.ok(evidence.length <= 14);
});

test("technical questions are routed across domains while mixed personal decisions stay protected", () => {
  for (const label of ["How would you design a distributed API?", "Explain SQL query optimization", "Compare caching strategies", "How would you implement OAuth authorization for an API using a framework?", "How would you test race conditions in a system?", "How would you design a high availability system?", "How would you design a job scheduler for a distributed system?", "How would you validate a financial forecast?", "Outline a marketing experiment", "Describe a time you resolved a stakeholder conflict"])
    assert.notEqual(questionAssistance(label), "personal", label);
  for (const label of ["Describe your race", "Explain your work authorization", "How would you design a database and are you a citizen?", "Explain your salary requirements"])
    assert.equal(questionAssistance(label), "personal", label);
});
