import test from "node:test";
import assert from "node:assert/strict";
import { questionAssistance, parseSuggestion, suggestionEvidence, suggestionRequestSchema } from "../src/lib/extension-suggestions";
import { buildProfileFormValues } from "../src/lib/profile";
import { zodResponseFormat } from "openai/helpers/zod";
import { generatedSuggestionSchema } from "../src/lib/extension-suggestions";

test("question assistance distinguishes grounded drafts from personal decisions", () => {
  for (const question of ["Why do you want to join Figma?", "Tell us about a project you built", "Describe your relevant experience", "What interests you in this role?"])
    assert.equal(questionAssistance(question), "draft", question);
  assert.equal(questionAssistance("Please explain why you are interested in part time employment."), "context");
  for (const question of ["How long do you anticipate working in a part time role?", "What weekdays are you available?", "This schedule includes Saturdays. Does this work?", "Please indicate desired starting pay", "Were you referred by an employee?", "Do you have a family member here?", "Are you 18 or older?", "Why are you interested and can you prove eligibility?", "Describe your disability", "Have you ever been employed with this company?", "I agree to receive messages"])
    assert.equal(questionAssistance(question), "personal", question);
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

test("draft generation uses the same bounded schema as response validation", () => {
  const format = zodResponseFormat(generatedSuggestionSchema, "application_answer");
  assert.equal(format.json_schema.strict, true);
  assert.deepEqual(format.json_schema.schema?.required, ["answer", "evidence", "missing"]);
  assert.equal(format.json_schema.schema?.additionalProperties, false);
  const result = { answer: "A draft", evidence: [], missing: "" };
  assert.equal(generatedSuggestionSchema.safeParse({ ...result, missing: null }).success, false);
  assert.equal(generatedSuggestionSchema.safeParse({ ...result, evidence: [{ id: "summary", quote: "x".repeat(301) }] }).success, false);
});
