import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { getAutofillPlan } from "../../src/lib/queries/extension-autofill";

type Scan = { error?: string; employmentCountry?: string; employmentLocation?: string; fields: { label: string; state: string; profileKey?: string; canAnswer: boolean }[] };

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.equal(process.env.DATABASE_URL_DO_PRIVATE || "", "");
  const email = `cross-platform-${randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { name: "Jordan Example", email, profile: { create: {
    name: "Jordan Example", email,
    contactJson: { givenName: "Jordan", familyName: "Example", email, phone: "4165550123", phoneCountry: "CA",
      city: "Toronto", region: "ON", country: "CA", linkedInUrl: "https://www.linkedin.com/in/example",
      applicationAnswers: { enabled: true, values: { authorizedCA: "Yes", authorizedUS: "No", sponsorshipCA: "No", sponsorshipUS: "Yes",
        jobSource: "ApplyOverflow", smsUpdates: "No", talentCommunity: "No", jobAlerts: "Yes", noticePeriod: "Two weeks", travel: "Yes" },
        commutes: [{ location: "Toronto, Ontario, Canada", willingness: "Yes" }] } },
  } } } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const url = "https://careers.custom-employer.example/jobs/analyst/apply";
    const labels = ["Are you legally authorized to work in the country where this job is located?", "Will you now or in the future require visa sponsorship?",
      "How did you hear about this job?", "If Other, please specify", "Would you like to join our talent community?",
      "Would you like to receive email job alerts?", "What is your notice period?", "Are you willing to travel?",
      "Are you willing to commute to the office?", "I certify this application is accurate"];
    const select = (label: string, choices: string[]) => `<label for="choice-${labels.indexOf(label)}">${label}</label><select id="choice-${labels.indexOf(label)}"><option value="">Choose</option>${choices.map(text => `<option>${text}</option>`).join("")}</select>`;
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `
      <script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", url, jobLocation: { "@type": "Place", address: { addressLocality: "Toronto", addressRegion: "Ontario", addressCountry: "CA" } } })}</script>
      <h1>Analyst application</h1><form><label>First name<input></label><label>Email<input type="email"></label>
      <label>LinkedIn profile<input></label>${labels.map(label => label === labels[2] ? select(label, ["Other", "Company careers website"])
        : [labels[3], labels[6]].includes(label) ? `<label>${label}<input></label>` : select(label, ["Yes", "No"])).join("")}
      <button>Submit application</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}</script>` }));
    await page.goto(url);
    const code = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { createInspector } from './extensions/chrome/adapter.mjs';
      import { createAutofillInspector } from './extensions/chrome/autofill.mjs';
      import { createHistoryInspector } from './extensions/chrome/history.mjs';
      import { applicationContext } from './extensions/chrome/sites.mjs';
      process.stdout.write('(' + createInspector + ')(' + applicationContext + ',(' + createHistoryInspector + ')(),(' + createAutofillInspector + ')())');
    `], { encoding: "utf8" });
    await page.evaluate(code => { (window as unknown as { inspect: unknown }).inspect = (0, eval)(code); }, code);
    const inspect = (mode = "inspect", payload: unknown = {}) => page.evaluate(({ mode, payload }) =>
      (window as unknown as { inspect: (mode: string, payload: unknown, url: string) => Promise<Scan> }).inspect(mode, payload, location.href), { mode, payload });
    const scan = await inspect();
    assert.equal(scan.error, undefined);
    assert.equal(scan.employmentCountry, "CA");
    const plan = await getAutofillPlan(user.id, { url, questions: labels, employmentCountry: scan.employmentCountry, employmentLocation: scan.employmentLocation });
    await inspect("autofill", plan);
    for (const [label, expected] of [["First name", "Jordan"], ["Email", email], ["LinkedIn profile", "https://www.linkedin.com/in/example"],
      [labels[0], "Yes"], [labels[1], "No"], [labels[2], "Other"], [labels[3], "ApplyOverflow"], [labels[4], "No"], [labels[5], "Yes"],
      [labels[6], "Two weeks"], [labels[7], "Yes"], [labels[8], "Yes"], [labels[9], ""]])
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), expected, label);
    assert.equal(await page.evaluate(() => (window as unknown as { submits: number }).submits), 0);
    const otherLocation = await getAutofillPlan(user.id, { url, questions: [labels[8]], employmentCountry: "CA", employmentLocation: "Vancouver, BC, CA" });
    assert.equal(otherLocation.commonAnswers.length, 0, "commute choices are not global willingness");
    const ambiguous = await getAutofillPlan(user.id, { url, questions: [labels[0], labels[1]] });
    assert.equal(ambiguous.commonAnswers.length, 0, "residence is not employment jurisdiction");
    console.log("PASS persisted shared profile -> posting context -> generic form: eligibility, source follow-up, consent preferences, notice, travel, scoped commute; no submission");
  } finally {
    await browser.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
void main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
