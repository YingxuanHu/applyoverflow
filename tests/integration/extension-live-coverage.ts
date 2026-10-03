import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { getAutofillPlan } from "../../src/lib/queries/extension-autofill";

type Field = { id: string; label: string; profileKey?: string; kind: string; state: string; canAnswer: boolean; reason: string; options?: string[] };
type Report = { error?: string; fields: Field[]; historyAvailable?: boolean; historyFilled?: number; historySaved?: number; employmentCountry?: "CA" | "US"; url: string };

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Disposable local database required");
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "");
  const urls = process.argv.slice(2);
  assert.ok(urls.length, "Supply live application URLs. Writes are isolated from the network.");
  const email = `autofill-coverage-${randomBytes(6).toString("hex")}@example.test`;
  const user = await prisma.user.create({ data: { name: "Jordan Example", email, profile: { create: {
    name: "Jordan Example", email, summary: "Built Python reporting applications for finance teams and validated reports against reference data.",
    phone: "2025550148", linkedinUrl: "https://www.linkedin.com/in/example-test", githubUrl: "https://github.com/example-test",
    contactJson: { givenName: "Jordan", familyName: "Example", preferredName: "Jordan", phoneCountry: "US", country: "US", city: "Richmond", region: "VA", postalCode: "23220", streetAddress: "123 Example Street", autofillResume: false,
      applicationAnswers: { enabled: true, values: { gender: "Prefer not to answer", ethnicity: "Prefer not to answer", hispanicLatino: "Prefer not to answer", veteran: "I don't wish to answer", disability: "I do not want to answer", transgender: "Prefer not to answer", sexualOrientation: "Prefer not to answer", limitingDisability: "Prefer not to answer", physicalDisability: "Prefer not to answer", veteranOrActiveUS: "Prefer not to answer", over18: "Yes", authorizedUS: "Yes", authorizedCA: "No", sponsorshipUS: "No", sponsorshipCA: "Yes", usPerson: "Yes", smsUpdates: "No", jobSource: "ApplyOverflow", startDate: "2026-10-15", availability: "Monday through Friday, 9am to 5pm", desiredPay: "USD 80,000 per year", partTimeReason: "I am seeking a reduced schedule while studying.", partTimeDuration: "One year" },
        employers: urls.map(url => ({ url, employeeRelationship: "No", referral: "No", previousEmployment: "No" })) } },
    skillsJson: [{ name: "Python" }, { name: "SQL" }],
    experiencesJson: [
      { title: "Analyst", company: "Synthetic Fixture", description: "Built reporting tools.", time: "Jan - Aug 2025" },
      { title: "Engineer", company: "Second Fixture", time: "Sep - Dec 2023" },
      { title: "Developer", company: "Third Fixture", time: "Jan - Apr 2023" },
    ],
    educationsJson: [
      { school: "Fixture University, School of Computer Science", degree: "Bachelor of Computer Science & BBA (Finance, Other University)", time: "Aug 2020 - Oct 2025" },
      { school: "Second University", degree: "Master of Engineering, Emphasis in Computer Engineering", time: "Sep 2025 - Present" },
    ],
  } } } });
  const source = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import {createInspector} from './extensions/chrome/adapter.mjs';
    import {createAutofillInspector} from './extensions/chrome/autofill.mjs';
    import {createHistoryInspector} from './extensions/chrome/history.mjs';
    import {applicationContext} from './extensions/chrome/sites.mjs';
    process.stdout.write('('+createInspector+')('+applicationContext+',('+createHistoryInspector+')(),('+createAutofillInspector+')())');
  `], { encoding: "utf8" });
  const browser = await chromium.launch();
  const reports: unknown[] = [];
  try {
    await mkdir("output/playwright/coverage", { recursive: true });
    for (const [index, url] of urls.entries()) {
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1050 } });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: 45000 });
        await page.locator('input:not([type="hidden"])').filter({ visible: true }).first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(1800);
        // Only public education option catalogs may load after filling starts.
        // All application writes, uploads, navigation and telemetry are blocked.
        await context.route("**/*", route => {
          const request = route.request(), target = new URL(request.url());
          const board = new URL(page.url()).pathname.split("/")[1];
          const catalog = target.hostname === "boards.greenhouse.io" &&
            target.pathname.startsWith(`/v1/boards/${board}/education/`) &&
            /\/(?:degrees|schools|disciplines)$/.test(target.pathname);
          return request.method() === "GET" && catalog ? route.continue() : route.abort();
        });
        await context.routeWebSocket("**/*", socket => socket.close());
        await page.evaluate(code => {
          (window as unknown as { inspect: unknown; submits: number }).inspect = (0, eval)(code);
          (window as unknown as { submits: number }).submits = 0;
          document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); (window as unknown as { submits: number }).submits++; }, true);
        }, source);
        const scan = (mode = "inspect", plan: unknown = {}) => page.evaluate(({ mode, plan }) => (window as unknown as { inspect: (mode: string, plan: unknown, url: string) => Promise<Report> }).inspect(mode, plan, location.href), { mode, plan });
        const before = await scan();
        assert.equal(before.error, undefined, `${url}: ${before.error}`);
        const questions = before.fields.filter(f => !f.profileKey && f.canAnswer && f.state === "needed").map(f => f.label).slice(0, 40);
        const plan = await getAutofillPlan(user.id, { url: page.url(), questions, history: before.historyAvailable === true, employmentCountry: before.employmentCountry });
        const start = Date.now();
        const result = await scan("autofill", plan);
        const domValues = await page.locator('input,textarea,select,b-single-select > [role="button"]').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && node.getAttribute("aria-hidden") !== "true").map(node => {
          const input = node as HTMLInputElement;
          const label = input.labels?.[0]?.textContent?.trim() || (input.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(" ") || input.getAttribute("aria-label");
          return { label, value: input.closest('.select__value-container')?.querySelector('.select__single-value')?.textContent ||
            (input instanceof HTMLSelectElement ? input.selectedOptions[0]?.textContent : input.matches('b-single-select > [role="button"]') ? input.textContent?.trim() : input.value) };
        }));
        const filled = result.fields.filter(f => f.state === "filled");
        await writeFile(`output/playwright/coverage/${index + 1}-fields.json`, JSON.stringify({ plan, fields: result.fields, domValues }, null, 2));
        for (const answer of plan.commonAnswers) {
          const field = result.fields.find(f => f.label === answer.label);
          if (field?.state !== "filled") {
            const choices = field?.kind === "combobox" ? (await scan("autofill-options", { id: field.id, label: field.label })).fields.find(f => f.id === field.id)?.options : field?.options;
            console.log("UNFILLED SAVED ANSWER", new URL(url).pathname, answer.answerKey, field?.reason, choices);
          }
        }
        if (url.includes("careers.hibob.com")) {
          assert.equal(result.historySaved, 5, "all three jobs and both education entries saved");
          assert.equal(await page.locator('careers-ui-experience-edit-item').count(), 0, "no blocked editors remain");
          const educationText = await page.locator('[data-testid="efc-education"]').innerText();
          assert.match(educationText, /Fixture University/);
          assert.match(educationText, /Second University/);
          assert.equal(plan.history.filter(entry => entry.kind === "education").every(({ entry }) => "fieldOfStudy" in entry && Boolean(entry.fieldOfStudy)), true);
          assert.equal(before.employmentCountry, "CA");
          for (const key of ["jobSource", "authorizedCA", "sponsorshipCA"]) {
            const answer = plan.commonAnswers.find(a => a.answerKey === key);
            assert.ok(answer, `HiBob plan: ${key}`);
            const actual = domValues.find(row => row.label?.trim() === answer.label.trim());
            assert.equal(actual?.value, key === "jobSource" ? "Other" : answer.answer, `HiBob actual visible selection: ${key}`);
            assert.equal(result.fields.find(f => f.label === answer.label)?.state, "filled");
          }
          assert.equal(await page.locator('b-currency-value-select input').inputValue(), "80,000");
          assert.equal((await page.locator('b-currency-value-select b-single-select > [role="button"]').innerText()).trim(), "USD $");
          assert.equal(result.fields.find(f=>f.label==='Desired salary (amount)')?.state, "filled");
        }
        if (url.includes("missionlane")) {
          for (const key of ["givenName", "familyName", "email", "phone", "phoneCountry", "professionalUrl", "region"])
            assert.equal(result.fields.find(f => f.profileKey === key)?.state, "filled", `Mission Lane ${key}`);
          for (const key of ["jobSource", "sourceDetails", "employeeRelationship", "usPerson", "sponsorshipUS", "smsUpdates"]) {
            const answer = plan.commonAnswers.find(a => a.answerKey === key);
            assert.ok(answer, `Mission Lane plan: ${key}`);
            assert.equal(result.fields.find(f => f.label === answer.label)?.state, "filled", `Mission Lane actual widget: ${key}`);
          }
          const link = domValues.find(row => row.label?.includes("similar professional profile"));
          assert.equal(link?.value, "https://www.linkedin.com/in/example-test");
          assert.ok(result.fields.filter(f => /certify|Privacy Act/.test(f.label)).every(f => f.state === "needed"));
        }
        assert.ok(filled.length >= 3, `${url}: unexpectedly low fill count`);
        assert.equal(await page.evaluate(() => (window as unknown as { submits: number }).submits), 0);
        const again = await scan("autofill", plan);
        assert.equal(again.historyFilled || 0, 0, "Repeated fill must not duplicate history");
        await page.screenshot({ path: `output/playwright/coverage/${index + 1}.png`, fullPage: true });
        const report = { url, elapsedMs: Date.now() - start, filled: filled.length, total: result.fields.length, historyFilled: result.historyFilled || 0,
          fields: result.fields, domValues, submitted: false };
        reports.push(report);
        console.log(JSON.stringify({ url, filled: filled.length, historyFilled: result.historyFilled || 0, total: result.fields.length, elapsedMs: report.elapsedMs }));
      } catch (error) {
        reports.push({ url, error: String(error) });
        await page.screenshot({ path: `output/playwright/coverage/${index + 1}-failure.png`, fullPage: true }).catch(() => {});
        console.error(url, String(error)); process.exitCode = 1;
      } finally { await context.close(); }
    }
    await writeFile("output/playwright/coverage/report.json", JSON.stringify(reports, null, 2));
  } finally { await browser.close(); await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect(); }
}
void main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
