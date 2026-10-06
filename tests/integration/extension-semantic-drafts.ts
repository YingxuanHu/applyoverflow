import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { suggestApplicationAnswer } from "../../src/lib/queries/extension-suggestions";
import { getAutofillPlan } from "../../src/lib/queries/extension-autofill";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "");
  const liveAI = process.argv.includes("--live-ai");
  const liveForm = process.argv.includes("--live-form");
  const originalFetch = globalThis.fetch;
  if (!liveAI) process.env.OPENAI_API_KEY ||= "test-only-no-network";
  const summary = "Built a document classifier in Python. Validated predictions against manually labelled test examples.";
  const email = `semantic-${randomBytes(8).toString("hex")}@example.test`;
  const user = await prisma.user.create({ data: {
    name: "Semantic Test", email,
    profile: { create: { name: "Semantic Test", email, summary,
      projectsJson: [{ name: "Document classifier", description: summary }],
      skillsJson: [{ name: "Python" }],
      phone: "4165550123", linkedinUrl: "https://www.linkedin.com/in/example-test",
      contactJson: { givenName: "Semantic", familyName: "Test", preferredName: "Test", city: "Toronto", region: "ON", country: "CA" },
      experiencesJson: [{ title: "Engineer", company: "Synthetic Fixture", dates: { start: "2020-01-02", end: "2021-02-03", current: false } }],
      educationsJson: [{ school: "Fixture University", degree: "BSc", fieldOfStudy: "Computer Science", dates: { start: "2016-09-01", end: "2020-06-01", current: false } }],
    } },
  }, include: { profile: true } });
  const url = "https://synpulse.careers.hibob.com/jobs/fdf3f02f-4c3b-472d-bf53-305dc0296650/apply";
  const label = "Tell me about an AI project you've worked on. What was the AI actually doing and how did you validate its output?";
  const request = { url, label, title: "Software Engineer", jobDescription: "Build software and validate AI outputs.", revision: user.profile!.updatedAt.toISOString(), maxWords: 40, maxLength: 400 };
  let browser;
  const aiResponses: string[] = [];
  let invalidResponses = 0, generatedCalls = 0;
  try {
    if (liveAI) globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (address.startsWith("https://api.openai.com/")) aiResponses.push(await response.clone().text());
      return response;
    };
    if (!liveAI) globalThis.fetch = async (input, init) => {
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!address.startsWith("https://api.openai.com/")) return originalFetch(input, init);
      const body = JSON.parse(String(init?.body));
      if (body.response_format?.json_schema?.name === "application_answer_quality") return Response.json({ choices: [{ message: { content: JSON.stringify({
        grounded: true, relevant: true, complete: true, technicallyCorrect: true, missingJustified: true, feedback: "",
      }) } }] });
      assert.match(body.messages[0].content, /at most 400 characters and 40 words/);
      generatedCalls++;
      const quote = invalidResponses > 0 ? "This statement does not exist in the saved evidence." : summary;
      invalidResponses = Math.max(0, invalidResponses - 1);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        answer: "I built a document classifier in Python and validated its predictions against manually labelled test examples.",
        evidence: [{ id: "summary", quote }], missing: "",
      }) } }] });
    };
    const started = Date.now();
    const result = await suggestApplicationAnswer(user.id, request);
    assert.ok(result.suggestion.answer);
    assert.ok(result.suggestion.answer.split(/\s+/).length <= 40);
    assert.ok(result.suggestion.answer.length <= 400);
    assert.doesNotMatch(result.suggestion.answer, /held[- ]out|cross[- ]validation|accuracy|train[-/ ]test split/i, "Do not invent a validation method absent from this synthetic profile");
    const preference = "If AI coding tools were unavailable tomorrow, how comfortable would you be building an application yourself and what would you build?";
    const proposed = await suggestApplicationAnswer(user.id, { ...request, label: preference });
    assert.ok(proposed.suggestion.answer, "Professional hypotheticals can be proposed from documented projects");
    const technology = "Which programming language and framework are you most confident in (e.g., Python, Java, C#, React, TypeScript)? Describe a feature or application you built using that technology.";
    if (!liveAI) invalidResponses = 1;
    const beforeRetry = generatedCalls;
    const technologyAnswer = await suggestApplicationAnswer(user.id, { ...request, label: technology });
    assert.ok(technologyAnswer.suggestion.answer);
    if (!liveAI) assert.equal(generatedCalls - beforeRetry, 2, "Invalid evidence is regenerated once, then revalidated");
    if (!liveAI) {
      invalidResponses = 2;
      const beforeRejected = generatedCalls;
      await assert.rejects(() => suggestApplicationAnswer(user.id, request), /Could not prepare a supported draft/);
      assert.equal(generatedCalls - beforeRejected, 2, "Unverified output stays rejected after the bounded retry");
    }
    await assert.rejects(() => suggestApplicationAnswer(user.id, { ...request, label: "Why are you interested in part-time employment?" }), /personal circumstance/);
    const withNote = await suggestApplicationAnswer(user.id, { ...request, label: preference, note: "I am comfortable building Python applications without AI tools. I would build a document classifier." });
    assert.ok(withNote.suggestion.answer);

    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    if (liveForm) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.locator('input[name="/candidate/email"]').waitFor();
      // Block every outbound request BEFORE inserting disposable profile facts.
      await page.route("**/*", route => route.abort());
      await page.routeWebSocket("**/*", socket => socket.close());
    } else {
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body:
        `<h1>Job application</h1><form><label>Email<input></label><label>First name<input></label><label>${label}<textarea maxlength="400"></textarea></label><label>${preference}<textarea></textarea></label><button>Apply</button></form>` }));
      await page.goto("https://careers.fixture.example/jobs/123/apply");
    }
    await page.evaluate(() => {
      (window as unknown as { submits: number }).submits = 0;
      document.addEventListener("submit", event => { event.preventDefault(); (window as unknown as { submits: number }).submits++; }, true);
    });
    // Serialize untransformed extension code, as Chrome does. tsx adds helper
    // references that cannot travel with Function.toString() across contexts.
    const inspectorCode = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { createInspector } from './extensions/chrome/adapter.mjs';
      import { createAutofillInspector } from './extensions/chrome/autofill.mjs';
      import { createHistoryInspector } from './extensions/chrome/history.mjs';
      import { applicationContext } from './extensions/chrome/sites.mjs';
      process.stdout.write('(' + createInspector + ')(' + applicationContext + ',(' + createHistoryInspector + ')(),(' + createAutofillInspector + ')())');
    `], { encoding: "utf8" });
    await page.evaluate(code => { (window as unknown as { inspect: unknown }).inspect = (0, eval)(code); }, inspectorCode);
    const plan = await getAutofillPlan(user.id, { url: page.url(), questions: [label, preference], history: liveForm });
    const filled = await page.evaluate(async plan => (window as unknown as { inspect: (mode: string, plan: unknown, url: string) => Promise<{ historyFilled: number }> }).inspect("autofill", plan, location.href), plan);
    if (liveForm) {
      assert.equal(await page.locator('input[name="/candidate/email"]').inputValue(), email);
      assert.equal(await page.locator('input[name="/candidate/socialMediaLinkedIn"]').inputValue(), "https://www.linkedin.com/in/example-test");
      assert.equal(await page.locator('input[name="/candidate/phone"]').inputValue(), "4165550123");
      assert.equal(filled.historyFilled, 9);
      assert.equal(await page.locator('[name="extendedConsent"]').isChecked(), false);
    }
    for (const [question, answer] of [[label, result.suggestion.answer], [preference, withNote.suggestion.answer]]) {
      const inserted = await page.evaluate(async ({ label, answer }) => {
      const inspect = (window as unknown as { inspect: (mode: string, plan: unknown, url: string) => Promise<{ fields: Array<{ id: string; label: string; state: string }> }> }).inspect;
      const scan = await inspect("inspect", {}, location.href);
      const field = scan.fields.find(field => field.label === label)!;
      return inspect("autofill-answer", { id: field.id, label, answer }, location.href);
      }, { label: question, answer });
      assert.equal(inserted.fields.find(field => field.label === question)?.state, "filled");
      assert.equal(await page.getByLabel(question, { exact: true }).inputValue(), answer);
    }
    assert.equal(await page.evaluate(() => (window as unknown as { submits: number }).submits), 0);
    console.log(`PASS ${liveAI ? "live AI" : "mocked AI"}, ${liveForm ? "live HiBob with outbound requests blocked" : "fixture form"}: database profile autofill, technical answer, 40-word/400-character limit, preference note, reviewed DOM insertion, no submission (${Date.now() - started}ms)`);
  } catch (error) {
    // This test sends synthetic professional facts only, never an account's
    // resume or contact details. Keep model validation failures diagnosable.
    if (liveAI) console.error("Synthetic AI test responses:", aiResponses);
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
    await browser?.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
void main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
