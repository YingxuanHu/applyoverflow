import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { aiComplete } from "../src/lib/ai/provider";
import { prisma } from "../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../src/lib/local-development-auth";
import { buildProfileFormValues } from "../src/lib/profile";
import { generateApplicationAnswer } from "../src/lib/application-answer-generation";
import { questionAssistance, suggestionEvidence, suggestionRequestSchema } from "../src/lib/extension-suggestions";

async function main() {
  assert.ok(process.argv.includes("--live"));
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "");
  const output = resolve("output/evaluations/live-application-answers");
  await mkdir(output, { recursive: true });
  const subject = `synthetic-live-answer-${randomUUID()}`;
  const profile = buildProfileFormValues({ summary: "Software engineer building Python and TypeScript tools.", skillsJson: [{ name: "Python" }, { name: "TypeScript" }],
    projectsJson: [{ name: "Document classifier", description: "Built a document classifier in Python. Compared predictions with manually labelled test examples." }],
    experiencesJson: [{ title: "Engineer", company: "Example Tools", description: "Built PostgreSQL reporting APIs and added indexes after examining query plans. Measured report latency improving from 900 ms to 200 ms in a repeatable local benchmark." }] });
  const cases = [
    { platform: "greenhouse", url: "https://job-boards.greenhouse.io/dataiku/jobs/5420293004", prompt: /describe your relevant experience/i },
    { platform: "lever", url: "https://jobs.lever.co/mujininc/623399ba-3b39-49d0-b4b9-09f9dc23ff77/apply", prompt: /what interests you about/i },
    { platform: "ashby", url: "https://jobs.ashbyhq.com/northwoodspace/8ee46696-7cb9-4c3c-a189-07824509d851/application", prompt: /share a project/i },
    { platform: "rippling", url: "https://ats.rippling.com/nestogroup/jobs/712bf815-2963-4bdf-81f6-7a5e3686a618/apply?step=application", prompt: /why are you interested/i },
  ];
  const source = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { createInspector } from './extensions/chrome/adapter.mjs';
    import { createAutofillInspector } from './extensions/chrome/autofill.mjs';
    import { createHistoryInspector } from './extensions/chrome/history.mjs';
    import { applicationContext } from './extensions/chrome/sites.mjs';
    process.stdout.write('(' + createInspector + ')(' + applicationContext + ',(' + createHistoryInspector + ')(),(' + createAutofillInspector + ')())');
  `], { encoding: "utf8" });
  const browser = await chromium.launch();
  const results: unknown[] = [];
  let failures = 0;
  try {
    for (const row of cases) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      try {
        await page.goto(row.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.getByText(row.prompt).first().waitFor({ state: "visible", timeout: 20000 });
        // No private information, uploads or autosave mutations leave the browser.
        await context.route("**/*", route => route.abort());
        await context.routeWebSocket("**/*", socket => socket.close());
        await page.evaluate(code => {
          (window as unknown as { inspect: unknown }).inspect = (0, eval)(code);
          (window as unknown as { submits: number }).submits = 0;
          document.addEventListener("submit", e => { e.preventDefault(); e.stopImmediatePropagation(); (window as unknown as { submits: number }).submits++; }, true);
        }, source);
        type Scan = { error?: string; fields: Array<{ id: string; label: string; kind: string; canAnswer: boolean; aiRestricted?: boolean; state: string; maxLength?: number; maxWords?: number }> };
        const inspect = (mode = "inspect", payload: unknown = {}) => page.evaluate(({ mode, payload }) =>
          (window as unknown as { inspect: (mode: string, payload: unknown, url: string) => Promise<Scan> }).inspect(mode, payload, location.href), { mode, payload });
        const scan = await inspect();
        assert.equal(scan.error, undefined);
        const field = scan.fields.find(field => row.prompt.test(field.label));
        assert.ok(field?.canAnswer && !field.aiRestricted && field.kind === "text", "Professional answer control is not safely writable");
        assert.notEqual(questionAssistance(field.label), "personal");
        const input = suggestionRequestSchema.parse({ url: page.url(), label: field.label, title: await page.title(), jobDescription: "", revision: new Date().toISOString(),
          maxLength: Math.min(1200, field.maxLength || 1200), maxWords: Math.min(120, field.maxWords || 120) });
        const draft = await generateApplicationAnswer(input, suggestionEvidence(profile, "", field.label), aiComplete, { signal: AbortSignal.timeout(26000), budgetSubject: subject });
        assert.ok(draft.answer);
        const filled = await inspect("autofill-answer", { id: field.id, label: field.label, answer: draft.answer });
        assert.equal(filled.fields.find(item => item.id === field.id)?.state, "filled");
        const values = await page.locator("textarea,input").evaluateAll(fields => fields.map(field => (field as HTMLInputElement).value));
        assert.ok(values.includes(draft.answer), "Answer must exist in the actual employer control, not just extension state");
        assert.equal((await inspect()).fields.find(item => item.id === field.id)?.state, "filled");
        assert.equal(await page.evaluate(() => (window as unknown as { submits: number }).submits), 0);
        await page.screenshot({ path: resolve(output, `${row.platform}.png`), fullPage: true });
        results.push({ ...row, prompt: String(row.prompt), passed: true, question: field.label, answer: draft.answer });
        console.log(`PASS live ${row.platform}: generated, reviewed, inserted and retained: ${field.label}`);
      } catch (error) {
        failures++;
        results.push({ ...row, prompt: String(row.prompt), passed: false, error: error instanceof Error ? error.message : "UnknownError" });
        console.log(`FAIL live ${row.platform}: ${error instanceof Error ? error.message : "UnknownError"}`);
      } finally { await context.close(); }
    }
    await writeFile(resolve(output, "latest.json"), JSON.stringify({ createdAt: new Date().toISOString(), synthetic: true, cases: cases.length, failures, results }, null, 2));
    assert.equal(failures, 0);
  } finally {
    await browser.close();
    await prisma.resourceBudget.deleteMany({ where: { key: `ai:user:${subject}` } });
    await prisma.$disconnect();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
