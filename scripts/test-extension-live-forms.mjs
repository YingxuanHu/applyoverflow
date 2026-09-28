import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { fillSavedDetails } from "../extensions/chrome/answer-runner.mjs";
const { applicationAnswerPlan } = createRequire(import.meta.url)("../src/lib/profile-application-answers.ts");

// Dedicated anonymous browser, synthetic facts, no uploads or application
// submission. Block writes before filling, including autosave and telemetry.
const urls = process.argv.slice(2);
assert.ok(urls.length && urls.every(url => applicationContext(url, true)), "Supply public application URLs");
const source = `(${createInspector.toString()})(${applicationContext.toString()},(${createHistoryInspector.toString()})(),(${createAutofillInspector.toString()})())`;
const contact = { givenName: "Jordan", familyName: "Example", fullName: "Jordan Example", preferredName: "Jordan",
  email: "jordan@example.test", phone: "4165550123", phoneCountry: "CA", country: "CA", city: "Toronto", region: "ON",
  pronouns: "they/them", currentCompany: "Example Analytics", currentTitle: "Software Engineer",
  linkedInUrl: "https://www.linkedin.com/in/example", professionalUrl: "https://www.linkedin.com/in/example",
  streetAddress: "123 Example Street", postalCode: "M5V 1A1", fullAddress: "123 Example Street, Toronto, ON, M5V 1A1, Canada" };
const saved = { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "No", sponsorshipCA: "No", sponsorshipUS: "Yes",
  over18: "Yes", smsUpdates: "No", emailUpdates: "Yes", jobSource: "ApplyOverflow", talentCommunity: "No", jobAlerts: "No", careerNewsletters: "No",
  usPerson: "No", gender: "Prefer not to answer", ethnicity: "Prefer not to answer", transgender: "Prefer not to answer",
  sexualOrientation: "Prefer not to answer", veteran: "I don't wish to answer", physicalDisability: "Prefer not to answer",
  limitingDisability: "Prefer not to answer", veteranOrActiveUS: "Prefer not to answer" },
  employers: [{ url: "https://job-boards.greenhouse.io/missionlane/jobs/8848599002", referral: "No", employeeRelationship: "No" }] };
const history = [{ kind: "education", entry: { school: "University of Waterloo, School of Computer Science", degree: "Bachelor of Computer Science", fieldOfStudy: "Computer Science",
  dates: { start: "2020-09", end: "2024-08", current: false } } }];
const browser = await chromium.launch();
const reports = [];
try {
  for (const url of urls) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    let blockWrites = false, blocked = 0;
    await context.route("**/*", route => {
      if (blockWrites && !["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { blocked++; return route.abort(); }
      return route.continue();
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator('input:not([type="hidden"]):not([type="file" i])').first().waitFor({ timeout: 20000 });
      blockWrites = true;
      await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
      const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
      const before = await inspect();
      if (before.error) throw new Error(before.error);
      const start = performance.now();
      const { result } = await fillSavedDetails({ scan: before, inspect,
        getPlan: async scan => {
          const common = applicationAnswerPlan(saved, scan.questions, url, scan.employmentCountry, scan.employmentLocation);
          return { contact, commonAnswers: common.answers, answerDetails: common.details, history, includeResume: false };
        }, progress: async () => {},
      });
      const filename = `${new URL(url).hostname}-${new URL(url).pathname.split('/').filter(Boolean).slice(-2).join('-')}`.replace(/[^a-z0-9-]/gi, "-");
      await mkdir("output/playwright/live-forms", { recursive: true });
      await page.screenshot({ path: `output/playwright/live-forms/${filename}.png`, fullPage: true });
      const fields = result.fields.map(({ label, state, reason, profileKey }) => ({ label, state, reason, profileKey }));
      // Assert actual employer controls, not just our own progress report.
      for (const [name, expected] of [[/^First name\s*\*?$/i, contact.givenName], [/^Last name\s*\*?$/i, contact.familyName], [/^Email\s*\*?$/i, contact.email]]) {
        const field = page.getByRole("textbox", { name });
        assert.equal(await field.count(), 1, `Expected one visible ${name} control`);
        assert.equal(await field.inputValue(), expected, `Actual ${name} value must match the profile`);
      }
      if (new URL(url).hostname === "job-boards.greenhouse.io") {
        for (const key of ["phoneCountry", "city", "linkedInUrl", "professionalUrl"])
          if (before.fields.some(field => field.profileKey === key))
            assert.ok(fields.some(field => field.profileKey === key && field.state === "filled"), `${key} must be accepted, not left as search text`);
      }
      if (new URL(url).hostname === "ats.rippling.com" && before.fields.some(field => /agreement to receive text message updates/.test(field.label))) {
        assert.equal(await page.getByRole("radio", { name: "No - I do not consent to receiving text messages", exact: true }).getAttribute("aria-checked"), "true",
          "The actual custom radio must reflect the profile's explicit application-SMS preference");
        assert.ok(fields.some(field => /agreement to receive text message updates/.test(field.label) && field.state === "filled"));
      }
      const report = { url, milliseconds: Math.round(performance.now() - start), employmentCountry: before.employmentCountry,
        filled: fields.filter(field => field.state === "filled").length, historyFilled: result.historyFilled || 0, fields, blockedWrites: blocked };
      reports.push(report);
      console.log(JSON.stringify(report));
    } catch (error) {
      const diagnostic = await page.evaluate(async () => window.inspect ? (await window.inspect("inspect", {}, location.href)).fields : undefined).catch(() => undefined);
      reports.push({ url, error: error.message, fields: diagnostic?.map(({ label, state, reason, canAnswer }) => ({ label, state, reason, canAnswer })) });
      console.log(JSON.stringify(reports.at(-1)));
    } finally { await context.close(); }
  }
  await mkdir("output/playwright/live-forms", { recursive: true });
  await writeFile("output/playwright/live-forms/report.json", JSON.stringify(reports, null, 2));
  if (reports.some(report => report.error)) process.exitCode = 1;
} finally { await browser.close(); }
