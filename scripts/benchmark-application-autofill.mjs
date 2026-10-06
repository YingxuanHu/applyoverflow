import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import * as applicationAnswersModule from "../src/lib/profile-application-answers.ts";
import * as historyModule from "../src/lib/profile-history.ts";
const { applicationAnswerPlan } = applicationAnswersModule.default || applicationAnswersModule;
const { autofillHistoryDates } = historyModule.default || historyModule;

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const output = resolve(option("--output", "output/playwright/autofill-benchmark"));
const limit = Number(option("--limit", "350"));
const concurrency = Number(option("--concurrency", "3"));
const minForms = Number(option("--min-forms", "0"));
const minRetention = Number(option("--min-retention", "0"));
const minPlannedRetention = Number(option("--min-planned-retention", "0"));
assert.ok(limit >= 1 && limit <= 2000 && concurrency >= 1 && concurrency <= 6);
assert.ok(Number.isInteger(limit) && Number.isInteger(concurrency) && Number.isInteger(minForms) && minForms >= 0 && minRetention >= 0 && minRetention <= 1);
assert.ok(minPlannedRetention >= 0 && minPlannedRetention <= 1);
const run = option("--run", "run");
assert.match(run, /^[a-zA-Z0-9_-]+$/, "Run names must not contain paths");
const wait = ms => new Promise(r => setTimeout(r, ms));
await mkdir(output, { recursive: true });

// The same deterministic profile is used on every site. No private accounts,
// database access, resume uploads, or AI service calls are needed for this run.
const contact = { givenName: "Jordan", familyName: "Example", fullName: "Jordan Example", preferredName: "Jordan",
  email: "jordan@example.test", phone: "2025550148", phoneCountry: "US", phoneType: "Mobile", country: "US", city: "Richmond", cityRegion: "Richmond, VA", region: "VA",
  postalCode: "23220", streetAddress: "123 Example Street", addressLine2: "Unit 2",
  fullAddress: "123 Example Street, Unit 2, Richmond, VA, 23220, United States",
  linkedInUrl: "https://www.linkedin.com/in/example-test", githubUrl: "https://github.com/example-test",
  portfolioUrl: "https://example.test", portfolioGithubUrl: "https://example.test", professionalUrl: "https://www.linkedin.com/in/example-test" };
const preferences = { enabled: true, values: { jobSource: "ApplyOverflow", sourceDetails: "ApplyOverflow", startDate: "2026-10-15",
  authorizedUS: "Yes", authorizedCA: "No", sponsorshipUS: "No", sponsorshipCA: "Yes", relocation: "Yes", over18: "Yes",
  smsUpdates: "No", emailUpdates: "No", gender: "Prefer not to answer", ethnicity: "Prefer not to answer",
  veteran: "I don't wish to answer", disability: "I do not want to answer", desiredPay: "USD 80,000 per year" } };
const history = [
  { kind: "experience", entry: { title: "Software Engineer", company: "Example Test Company", location: "Richmond, VA", description: "Built Python reporting tools.", time: "Jan - Aug 2025" } },
  { kind: "experience", entry: { title: "Data Analyst", company: "Second Test Company", location: "Richmond, VA", time: "Sep 2023 - Dec 2024" } },
  { kind: "education", entry: { school: "University of Toronto", degree: "Master of Engineering", fieldOfStudy: "Computer Engineering", time: "Sep 2025 - Present" } },
  { kind: "education", entry: { school: "University of Waterloo", degree: "Bachelor of Science", fieldOfStudy: "Computer Science", time: "Sep 2020 - Aug 2025" } },
].map(row => ({ ...row, entry: { ...row.entry, dates: autofillHistoryDates(row.entry) } }));
const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const sourceHash = createHash("sha256").update(source).update(await readFile("src/lib/profile-application-answers.ts")).digest("hex");
const harnessHash = createHash("sha256").update(await readFile(new URL(import.meta.url))).update(await readFile("src/lib/profile-history.ts")).digest("hex");
const audit = nodes => nodes.filter(n => n.getClientRects().length && !n.closest('[hidden],[inert],[aria-hidden="true"]')).map(n => {
  const labels = n.id ? [...document.querySelectorAll(`label[for="${CSS.escape(n.id)}"]`)] : [];
  const copy = (n.labels?.[0] || (labels.length === 1 ? labels[0] : null))?.cloneNode(true);
  copy?.querySelectorAll('input,select,textarea,button').forEach(e => e.remove());
  for (const e of copy?.querySelectorAll('*') || []) if (/^(required|optional)[.*:]?$/i.test(e.textContent.trim())) e.remove();
  const context = n.closest('fieldset,section,[role="group"]');
  const container = n.closest('.select__value-container');
  return { label: copy?.textContent?.trim() || (n.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(" ") || n.getAttribute("aria-label") || "",
    context: context?.querySelector('legend,h2,h3,h4')?.textContent || context?.getAttribute('aria-label') || "",
    type: n.type || n.getAttribute("role"), autocomplete: n.autocomplete,
    value: n.type === "checkbox" || n.type === "radio" ? String(n.checked) : n instanceof HTMLSelectElement ? n.selectedOptions[0]?.textContent : container?.querySelector('.select__single-value')?.textContent || n.value || (n instanceof HTMLButtonElement ? n.textContent?.trim() : ""),
    id: n.id, name: n.name, required: n.required || n.getAttribute("aria-required") === "true" };
});
const oracleKey = field => {
  if (/reference|emergency|employ|education|supervisor|billing|shipping/i.test(field.context)) return;
  const label = field.label.replace(/[*:]|\(required\)|\(optional\)/gi, "").trim().toLowerCase();
  return { 'first name': 'givenName', 'last name': 'familyName', 'full name': 'fullName', name: 'fullName',
    'email': 'email', 'email address': 'email', phone: 'phone', 'phone number': 'phone',
    'city': 'city', 'location': 'city', 'location (city)': 'city', 'postal code': 'postalCode', 'zip': 'postalCode', 'zip code': 'postalCode',
    'address line 1': 'streetAddress', 'street address': 'streetAddress', 'linkedin url': 'linkedInUrl', 'linkedin profile': 'linkedInUrl' }[label];
};
const oracleMatches = (key, value) => {
  if (key === "phone") return value?.replace(/\D/g, "").endsWith(contact.phone);
  if (key === "city" && value?.trim() === "Richmond, Virginia, United States") return true;
  return value?.trim() === contact[key];
};
const fetchJson = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "ApplyOverflow-Compatibility-Benchmark/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const pool = async (rows, size, fn) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, rows.length) }, async () => {
    while (next < rows.length) { const index = next++; await fn(rows[index], index); }
  }));
};

async function discover() {
  const baseInventory = JSON.parse(await readFile("data/discovery/ats-tenant-inventory.json", "utf8")).entries;
  const extraInventory = JSON.parse(await readFile("data/discovery/source-candidates.json", "utf8")).entries;
  const inventory = [...new Map([...baseInventory, ...extraInventory].map(row => [`${row.connectorName}:${row.token}`, row])).values()];
  const selected = args.includes("--extend") ? JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8")) : [];
  const discoveries = [];
  const quotas = { greenhouse: Math.ceil(limit * .3), lever: Math.ceil(limit * .25), ashby: Math.ceil(limit * .25),
    smartrecruiters: Math.ceil(limit * .12), teamtailor: Math.ceil(limit * .04), jobvite: Math.ceil(limit * .04),
    workable: 8, recruitee: 8, rippling: 20 };
  for (const [platform, quota] of Object.entries(quotas)) {
    if (args.includes("--extend") && selected.some(row => row.platform === platform)) continue;
    let accepted = 0;
    const tenants = inventory.filter(row => row.connectorName === platform);
    // Sort by a stable hash rather than popularity: avoid measuring only large,
    // familiar employers or changing the sample on every run.
    tenants.sort((a, b) => createHash("sha256").update(a.token).digest("hex").localeCompare(createHash("sha256").update(b.token).digest("hex")));
    for (let start = 0; start < tenants.length && accepted < quota; start += 4) {
      await pool(tenants.slice(start, start + 4), 4, async tenant => {
        try {
          let jobs = [];
          if (platform === "greenhouse") jobs = (await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${tenant.token}/jobs`)).jobs.map(j => ({ url: j.absolute_url, title: j.title, location: j.location?.name }));
          if (platform === "lever") jobs = (await fetchJson(`https://api.lever.co/v0/postings/${tenant.token}?mode=json`)).map(j => ({ url: j.applyUrl, title: j.text, location: j.categories?.location }));
          if (platform === "ashby") jobs = (await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${tenant.token}`)).jobs.map(j => ({ url: j.applyUrl, title: j.title, location: j.location }));
          if (platform === "smartrecruiters") jobs = (await fetchJson(`https://api.smartrecruiters.com/v1/companies/${tenant.token}/postings?limit=100`)).content.map(j => ({ url: `https://jobs.smartrecruiters.com/${tenant.token}/${j.id}-${j.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title: j.name, location: `${j.location?.city || ""}, ${j.location?.country || ""}` }));
          if (platform === "workable") jobs = (await fetchJson(`https://www.workable.com/api/accounts/${tenant.token}`)).jobs.map(j => ({ url: j.application_url || `https://apply.workable.com/${tenant.token}/j/${j.shortcode}/apply/`, title: j.title, location: j.location?.location_str }));
          if (platform === "recruitee") jobs = (await fetchJson(`https://${tenant.token}.recruitee.com/api/offers/`)).offers.map(j => ({ url: j.careers_apply_url || j.careers_url, title: j.title, location: j.location || j.city }));
          if (platform === "rippling") {
            const payload = await fetchJson(`https://api.rippling.com/platform/api/ats/v1/board/${tenant.token}/jobs`);
            jobs = (Array.isArray(payload) ? payload : payload.jobs || []).map(j => ({ url: `${j.url || `https://ats.rippling.com/${tenant.token}/jobs/${j.uuid}`}/apply`, title: j.name || j.title, location: j.workLocation?.label }));
          }
          if (["teamtailor", "jobvite"].includes(platform)) {
            const url = tenant.boardUrl || tenant.careersUrl;
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            const html = await response.text();
            jobs = [...html.matchAll(/href=["']([^"']*(?:\/jobs\/\d+[^"']*|\/job\/[^"']+))["']/gi)].map(m => ({ url: new URL(m[1].replaceAll("&amp;", "&"), url).href }));
          }
          const office = jobs.filter(j => /engineer|software|analyst|manager|marketing|account|research|design|finance|sales|legal|consult/i.test(j.title || ""));
          const northAmerican = office.filter(j => /canada|united states|\busa?\b|\bca\b|\bus\b|toronto|vancouver|new york|san francisco|seattle|boston|austin|chicago|remote/i.test(j.location || ""));
          const job = (northAmerican.length ? northAmerican : office.length ? office : jobs)[0];
          if (job && accepted < quota) {
            let url = job.url;
            if (platform === "teamtailor") url = url.replace(/\/$/, "") + "/applications/new";
            if (platform === "jobvite") url = url.replace(/\/$/, "") + "/apply";
            if (!selected.some(row => row.url === url)) selected.push({ platform, company: tenant.companyName || tenant.token, tenant: tenant.token, ...job, url }); accepted++;
          }
          discoveries.push({ platform, tenant: tenant.token, jobs: jobs.length, selected: !!job });
        } catch (error) { discoveries.push({ platform, tenant: tenant.token, error: String(error) }); }
      });
      await wait(200);
    }
    console.log(`Discovered ${accepted} ${platform} employers`);
  }
  // Enterprise login gates are part of compatibility, even though the bulk run
  // must never create accounts or reuse private credentials.
  for (const row of inventory.filter(row => row.connectorName === "icims").slice(0, 15)) {
    const url = row.careersUrl || row.boardUrl;
    if (!selected.some(item => item.url === url)) selected.push({ platform: "icims", company: row.companyName || row.token, url });
  }
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(selected, null, 2));
  await writeFile(resolve(output, "discovery.json"), JSON.stringify(discoveries, null, 2));
  return selected;
}

const manifest = args.includes("--discover") || args.includes("--extend") ? await discover() : JSON.parse(await readFile(resolve(option("--manifest", resolve(output, "manifest.json"))), "utf8"));
if (args.includes("--discover-only")) process.exit(0);
const reports = [];
const reportFile = resolve(output, `${run}.jsonl`);
if (args.includes("--resume")) {
  const saved = (await readFile(reportFile, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  assert.ok(saved.every(row => row.sourceHash === sourceHash), "Changed source cannot resume an older benchmark; choose a new run name");
  assert.ok(saved.every(row => row.harnessHash === harnessHash), "Changed harness cannot resume an older benchmark; choose a new run name");
  assert.equal(new Set(saved.map(row => row.url)).size, saved.length, "Duplicate reports cannot be resumed");
  reports.push(...saved);
} else await writeFile(reportFile, "", { flag: "wx" });
const finished = new Set(reports.map(r => r.url));
const sample = [...new Map(manifest.map(row => [row.url, row])).values()].slice(0, limit);
assert.ok(reports.every(row => sample.some(item => item.url === row.url)), "Resume with the same sample and limit");
const cases = sample.filter(row => !finished.has(row.url));
const browser = await chromium.launch({ headless: true });
let completed = reports.length;
async function summarize() {
  const platforms = {};
  for (const report of reports) {
    const counts = platforms[report.platform] ||= { attempted: 0, detected: 0, eligible: 0, retained: 0, oracleEligible: 0, oracleRetained: 0, reportedFilled: 0, gated: 0, errors: 0 };
    counts.attempted++;
    counts.detected += Number(report.detected || false);
    counts.eligible += report.eligible || 0;
    counts.retained += report.retained || 0;
    counts.oracleEligible += report.oracleEligible || 0;
    counts.oracleRetained += report.oracleRetained || 0;
    counts.reportedFilled += report.filled || 0;
    counts.gated += Number(report.status === "gated");
    counts.errors += Number(!!report.error);
  }
  const summary = { sourceHash, harnessHash, createdAt: new Date().toISOString(), attempted: reports.length,
    detected: reports.filter(r => r.detected).length, employers: new Set(reports.map(r => r.company)).size,
    platforms, submissionAttempts: reports.reduce((n, r) => n + (r.submissions || 0), 0),
    oracleRetention: reports.reduce((n, r) => n + (r.oracleRetained || 0), 0) / (reports.reduce((n, r) => n + (r.oracleEligible || 0), 0) || 1),
    plannedRetention: reports.reduce((n, r) => n + (r.retained || 0), 0) / (reports.reduce((n, r) => n + (r.eligible || 0), 0) || 1),
    safety: "Synthetic profile; only read-only catalog GETs allowed during filling; no uploads, account creation or application submissions" };
  await writeFile(resolve(output, `${run}-summary.json`), JSON.stringify(summary, null, 2));
  return summary;
}
try {
  await pool(cases, concurrency, async (test, index) => {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1360, height: 960 } });
    const page = await context.newPage();
    const report = { ...test, sourceHash, harnessHash, startedAt: new Date().toISOString(), detected: false, status: "unavailable", submissions: 0 };
    const start = Date.now();
    try {
      await page.goto(test.url, { waitUntil: "domcontentloaded", timeout: 25000 });
      if (test.platform === "jobvite" && !/\/apply\/?$/.test(new URL(page.url()).pathname)) {
        const apply = page.getByRole("link", { name: /^apply(?: now)?$/i }).first();
        if (await apply.count()) { const href = await apply.getAttribute("href"); if (href) await page.goto(new URL(href, page.url()).href, { waitUntil: "domcontentloaded", timeout: 25000 }); }
      }
      if (test.platform === "smartrecruiters") {
        const apply = page.getByRole("link", { name: /^apply(?: now)?$|^i.?m interested$/i }).first();
        if (await apply.count()) {
          const href = await apply.getAttribute("href");
          if (href) await page.goto(new URL(href, page.url()).href, { waitUntil: "domcontentloaded", timeout: 25000 });
        }
      }
      await page.locator('input:not([type="hidden"]),textarea,[role="combobox"]').first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      report.actualUrl = page.url();
      const text = await page.locator("body").innerText({ timeout: 5000 });
      if (await page.locator('input[type="password"]').count() || /verify you are human|access denied|checking your browser|sign in to apply|create an account to apply/i.test(text) ||
        page.frames().some(frame => /captcha-delivery\.com|challenges\.cloudflare\.com/.test(frame.url()))) report.status = "gated";
      // Catalog lookups are read-only. Every other request is blocked before
      // writing even the first synthetic character into an employer field.
      await context.route("**/*", route => {
        const request = route.request(), target = new URL(request.url());
        const catalog = /\/education\/(?:schools|degrees|disciplines)$|\/(?:autocomplete|search|locations|countries|cities|states|regions)(?:\/|$)/i.test(target.pathname) ||
          (target.hostname === "my.greenhouse.io" && target.pathname === "/users/self") ||
          (target.hostname === "maps.googleapis.com" && /^\/maps(?:-api-v3)?\//.test(target.pathname));
        return request.method() === "GET" && !request.isNavigationRequest() && catalog ? route.continue() : route.abort();
      });
      await context.routeWebSocket("**/*", socket => socket.close());
      await page.evaluate(code => {
        window.benchmarkInspect = (0, eval)(code); window.benchmarkSubmissions = 0;
        document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); window.benchmarkSubmissions++; }, true);
      }, source);
      const scan = (mode, payload = {}) => page.evaluate(({ mode, payload }) => window.benchmarkInspect(mode, payload, location.href), { mode, payload });
      let before = await scan("inspect");
      let target = page;
      if (before.error) {
        // Embedded applications are scanned in their own origin, exactly as
        // the extension's frame routing does. Never read another frame's DOM.
        for (const frame of page.frames().filter(f => f !== page.mainFrame() && applicationContext(f.url(), true))) {
          await frame.evaluate(code => { window.benchmarkInspect = (0, eval)(code); window.benchmarkSubmissions = 0;
            document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); window.benchmarkSubmissions++; }, true);
          }, source);
          const candidate = await frame.evaluate(() => window.benchmarkInspect("inspect", {}, location.href));
          if (!candidate.error) { before = candidate; target = frame; report.frameUrl = frame.url(); break; }
        }
      }
      const auditSelector = 'input,textarea,select,[role="combobox"],button[aria-haspopup]';
      report.beforeDom = await target.locator(auditSelector).evaluateAll(audit);
      const oracleExpected = report.beforeDom.filter(f => !f.value && oracleKey(f) && contact[oracleKey(f)]);
      report.oracleEligible = oracleExpected.length;
      if (before.error) { report.error = before.error; return; }
      report.detected = true; report.status = "form";
      const inspectTarget = (mode, payload = {}) => target.evaluate(({ mode, payload }) => window.benchmarkInspect(mode, payload, location.href), { mode, payload });
      const common = applicationAnswerPlan(preferences, (before.fields || []).map(f => f.label), target.url(), before.employmentCountry);
      const plan = { contact, revision: "benchmark-v1", includeResume: false, skills: ["Python", "SQL"],
        commonAnswers: common.answers, answerDetails: common.details, answers: [], history: before.historyAvailable ? history : [] };
      const expected = (before.fields || []).filter(f => f.state === "needed" &&
        (contact[f.profileKey] || common.answers.some(a => a.label === f.label)));
      const result = await inspectTarget("autofill", plan);
      await page.waitForTimeout(600);
      const after = await inspectTarget("inspect");
      report.fields = result.fields; report.after = after.fields;
      report.eligible = expected.length;
      report.retained = expected.filter(f => after.fields?.some(a => a.id === f.id && ["filled", "kept"].includes(a.state))).length;
      report.filled = result.fields?.filter(f => f.state === "filled").length || 0;
      report.historyFilled = result.historyFilled || 0; report.historyWarnings = result.historyWarnings;
      // Independent DOM audit catches omitted controls, rather than letting the
      // detector define its own success denominator.
      report.dom = await target.locator(auditSelector).evaluateAll(audit);
      report.oracleRetained = oracleExpected.filter(f => report.dom.some(a => a.id === f.id && a.name === f.name && a.label === f.label &&
        oracleMatches(oracleKey(f), a.value))).length;
      report.submissions = await target.evaluate(() => window.benchmarkSubmissions);
      assert.equal(report.submissions, 0, "Autofill must never submit");
      if (index < 30 && (report.retained < report.eligible || !report.filled)) await page.screenshot({ path: resolve(output, `${run}-${index}-failure.png`), fullPage: true });
    } catch (error) { report.error = String(error); }
    finally {
      report.elapsedMs = Date.now() - start;
      reports.push(report);
      await appendFile(reportFile, JSON.stringify(report) + "\n");
      completed++;
      console.log(`${completed}/${sample.length} ${test.platform} ${test.company}: ${report.status}; ${report.retained || 0}/${report.eligible || 0} retained; ${report.error || ""}`);
      if (completed % 20 === 0) await summarize();
      await context.close();
    }
  });
} finally { await browser.close(); console.log(JSON.stringify(await summarize(), null, 2)); }
const summary = await summarize();
assert.ok(summary.detected >= minForms, `Only ${summary.detected} forms detected; expected at least ${minForms}`);
assert.ok(summary.oracleRetention >= minRetention, `DOM-verified known-contact retention ${summary.oracleRetention.toFixed(3)} below ${minRetention}`);
assert.ok(summary.plannedRetention >= minPlannedRetention, `Profile-backed planned retention ${summary.plannedRetention.toFixed(3)} below ${minPlannedRetention}`);
assert.equal(summary.submissionAttempts, 0);
