import test from "node:test";
import assert from "node:assert/strict";
import { questionAssistance, parseSuggestion, suggestionEvidence, suggestionRequestSchema, suggestionTask, suggestionTaskInstructions } from "../src/lib/extension-suggestions";
import { buildProfileFormValues } from "../src/lib/profile";
import { zodResponseFormat } from "openai/helpers/zod";
import { generatedSuggestionSchema } from "../src/lib/extension-suggestions";

test("question assistance distinguishes grounded drafts from personal decisions", () => {
  for (const question of ["Why do you want to join Figma?", "Tell us about a project you built", "Describe your relevant experience", "What interests you in this role?"])
    assert.equal(questionAssistance(question), "draft", question);
  assert.equal(questionAssistance("Please explain why you are interested in part time employment."), "context");
  assert.equal(questionAssistance("If AI coding tools were unavailable tomorrow, how comfortable would you be building an application yourself and what would you build?"), "context");
  assert.equal(questionAssistance("Which programming language are you most confident in? Describe a feature you built."), "context");
  assert.equal(questionAssistance("How comfortable are you disclosing your disability?"), "personal");
  for (const question of ["How long do you anticipate working in a part time role?", "What weekdays are you available?", "This schedule includes Saturdays. Does this work?", "Please indicate desired starting pay", "Were you referred by an employee?", "Do you have a family member here?", "Are you 18 or older?", "Why are you interested and can you prove eligibility?", "Describe your disability", "Have you ever been employed with this company?", "I agree to receive messages"])
    assert.equal(questionAssistance(question), "personal", question);
});

test("employer word and character limits apply to both requests and generated answers", () => {
  const sources = [{ id: "project", text: "Built an analytics application" }];
  const result = { answer: "I built an analytics application.", evidence: [{ id: "project", quote: sources[0].text }], missing: "" };
  assert.equal(parseSuggestion(JSON.stringify(result), sources, { maxWords: 5, maxLength: 40 }).answer, result.answer);
  assert.throws(() => parseSuggestion(JSON.stringify(result), sources, { maxWords: 4 }), /limit/);
  assert.throws(() => parseSuggestion(JSON.stringify(result), sources, { maxLength: 10 }), /limit/);
  const input = { url: "https://careers.fixture.example/job/apply", title: "Engineer", label: "Describe a project", jobDescription: "", revision: new Date().toISOString(), maxWords: 25, maxLength: 200 };
  assert.equal(suggestionRequestSchema.safeParse(input).success, true);
  assert.equal(suggestionRequestSchema.safeParse({ ...input, maxWords: 0 }).success, false);
  assert.equal(suggestionRequestSchema.safeParse({ ...input, maxLength: 3001 }).success, false);
});
test("draft evidence excludes contact, eligibility and demographics", () => {
  const profile = buildProfileFormValues({ summary: "Built a reporting application", contactJson: { email: "private@example.test", phone: "5559991234", streetAddress: "Private address", applicationAnswers: { enabled: true, values: { gender: "Woman" } } }, workAuthorization: "Private eligibility" });
  const evidence = suggestionEvidence(profile, "I want to develop reporting tools.");
  const json = JSON.stringify(evidence);
  for (const privateText of ["private@example.test", "5559991234", "Private address", "Woman", "Private eligibility"]) assert.ok(!json.includes(privateText));
  assert.equal(evidence.find(e => e.id === "your-note")?.text, "I want to develop reporting tools.");
});
test("draft output must reference exact existing evidence; malformed or fabricated citations fail", () => {
  const sources = [{ id: "summary", text: "Built a reporting application for finance teams." }];
  const output = { answer: "I built a reporting application.", evidence: [{ id: "summary", quote: "Built a reporting application" }], missing: "" };
  assert.equal(parseSuggestion(JSON.stringify(output), sources).answer, output.answer);
  assert.throws(() => parseSuggestion(JSON.stringify({ ...output, evidence: [] }), sources));
  assert.throws(() => parseSuggestion(JSON.stringify({ ...output, evidence: [{ id: "summary", quote: "Led a hundred engineers" }] }), sources));
  assert.throws(() => parseSuggestion("not json", sources));
  assert.equal(parseSuggestion(JSON.stringify({ answer: "", evidence: [], missing: "Which project would you like to discuss?" }), sources).answer, "");
});
test("suggestion requests are bounded, job scoped and reject extra form answers", () => {
  const input = { url: "https://job-boards.greenhouse.io/fixture/jobs/123", title: "Engineer", label: "Why this role?", jobDescription: "Build tools", revision: new Date().toISOString() };
  assert.equal(suggestionRequestSchema.safeParse(input).success, true);
  assert.equal(suggestionRequestSchema.safeParse({ ...input, answers: ["private"] }).success, false);
  assert.equal(suggestionRequestSchema.safeParse({ ...input, jobDescription: "x".repeat(8001) }).success, false);
  assert.equal(suggestionRequestSchema.safeParse({ ...input, url: "http://localhost/private" }).success, false);
});

test("professional qualification drafts require exact offered choices; personal questions remain protected", () => {
  assert.equal(questionAssistance("Do you have at least 3 years of experience directly managing a team in customer operations, risk, or fraud, including hiring, coaching, and developing direct reports?"), "qualification");
  assert.equal(questionAssistance("(Optional) Is there anything about your experience that may not be apparent on your resume but would help us evaluate your fit for this role?"), "draft");
  assert.equal(questionAssistance("Do you have experience and authorization to work in Canada?"), "personal");
  const sources = [{ id: "summary", text: "I have five years of Python experience." }];
  const output = { answer: "Yes", evidence: [{ id: "summary", quote: sources[0].text }], missing: "" };
  assert.equal(parseSuggestion(JSON.stringify(output), sources, { options: ["Yes", "No"] }).answer, "Yes");
  assert.throws(() => parseSuggestion(JSON.stringify({ ...output, answer: "Yes, five years" }), sources, { options: ["Yes", "No"] }), /choice/);
});

test("open-ended overviews do not inherit the qualification gate", () => {
  const label = "(Optional) Is there anything about your experience that may not be apparent on your resume but would help us evaluate your fit for this role?";
  assert.equal(suggestionTask(label), "overview");
  assert.match(suggestionTaskInstructions(label), /NOT a qualification test/);
  assert.match(suggestionTaskInstructions(label), /transferable/);
  assert.doesNotMatch(suggestionTaskInstructions(label), /Every condition/);
  assert.match(suggestionTaskInstructions("Do you have 3 years of experience managing fraud teams?"), /Missing evidence is NOT evidence of No/);
  assert.equal(suggestionTask("Describe your disability and fit"), "personal");
});

test("draft generation uses the same bounded schema as response validation", () => {
  const format = zodResponseFormat(generatedSuggestionSchema, "application_answer");
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(format.json_schema.schema?.required, ["answer", "evidence", "missing"]);
  assert.equal(format.json_schema.schema?.additionalProperties, false);
  const result = { answer: "A draft", evidence: [], missing: "" };
  assert.equal(generatedSuggestionSchema.safeParse({ ...result, missing: null }).success, false);
  assert.equal(generatedSuggestionSchema.safeParse({ ...result, evidence: [{ id: "summary", quote: "x".repeat(301) }] }).success, false);
});
