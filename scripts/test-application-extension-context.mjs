import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Synthetic standards-based fixtures, plus the Braze header observed publicly
// on 2026-09-28. All traffic is intercepted; no profile or employer submissions.
const source = `(${createInspector.toString()})(${applicationContext},undefined,(${createAutofillInspector})())`;
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtimePath ? `${await readFile(runtimePath, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` : `window.inspect=${source};`;
const generic = "https://careers.company.example/openings/123/apply";
const braze = "https://job-boards.greenhouse.io/braze/jobs/8222294";
const field = (label, attrs = "") => `<label>${label}<input ${attrs}></label>`;
const form = (extra = "") => `<form aria-label="Job application" class="ashby-application-form-container">
  ${field("First name", 'id="first_name" autocomplete="given-name"')}
  ${field("Email", 'id="email" type="email" autocomplete="email"')}${extra}
  <button>Submit application</button></form>`;
const json = data => `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
const place = (code = "CA", city = "Toronto", region = "ON") => ({ "@type": "Place", address: {
  "@type": "PostalAddress", addressCountry: code, addressLocality: city, addressRegion: region,
} });
const posting = (jobLocation = place(), extra = {}) => ({ "@context": "https://schema.org", "@type": "JobPosting", title: "Analyst", jobLocation, ...extra });
const header = value => `<header class="job-header"><h1>Analyst</h1><div data-job-location>${value}</div></header>`;
const contact = { givenName: "Jordan", email: "jordan@example.test", linkedInUrl: "https://www.linkedin.com/in/fixture", professionalUrl: "https://www.linkedin.com/in/fixture", portfolioUrl: "https://portfolio.example.test", country: "US" };
let count = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (body, url = generic) => {
    html = `<!doctype html><meta charset="utf-8"><title>Fixture</title>${body}
      <script>window.submissions=0;document.addEventListener('submit',e=>{e.preventDefault();window.submissions++})</script>`;
    await page.goto(url);
    await page.evaluate(code => { (0, eval)(code); }, installer);
  };
  const inspect = (mode = "inspect", plan = {}) => page.evaluate(({ mode, plan }) => window.inspect(mode, plan, location.href), { mode, plan });
  const countryCases = [
    ["single JSON-LD", json(posting()), "CA", "Toronto, ON, CA"],
    ["array JSON-LD", json([{ "@type": "Organization", address: { addressCountry: "US" } }, posting()]), "CA", "Toronto, ON, CA"],
    ["Country object", json(posting(place({ "@type": "Country", name: "Canada" }))), "CA", "Toronto, ON, CA"],
    ["graph references", json({ "@graph": [posting({ "@id": "#place" }), { "@id": "#place", address: { "@id": "#address" } },
      { "@id": "#address", addressCountry: { "@id": "#country" }, addressLocality: "Toronto", addressRegion: "ON" }, { "@id": "#country", name: "Canada" }] }), "CA", "Toronto, ON, CA"],
    ["same-country locations", json(posting([place(), place("CA", "Vancouver", "BC")])), "CA", undefined],
    ["two countries", json(posting([place(), place("US", "Austin", "TX")])), undefined, undefined],
    ["missing country among locations", json(posting([place(), { address: { addressLocality: "London" } }])), undefined, undefined],
    ["unsupported country", json(posting(place("GB", "London", "England"))), undefined, undefined],
    ["applicant-only geography", json(posting(undefined, { jobLocation: undefined, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { name: "Canada" } })), undefined, undefined],
    ["remote with physical country", json(posting(place(), { jobLocationType: "TELECOMMUTE" })), "CA", undefined],
    ["organization address", json(posting(undefined, { jobLocation: undefined, hiringOrganization: { address: { addressCountry: "CA" } } })), undefined, undefined],
    ["malformed JSON", '<script type="application/ld+json">{broken</script>' + header("Toronto, ON, Canada"), undefined, undefined],
    ["multiple postings", json([posting(), posting(place())]), undefined, undefined],
    ["select exact current posting", json([posting(place(), { url: generic }), posting(place("US"), { url: "/openings/other" })]), "CA", "Toronto, ON, CA"],
    ["stale job URL", json(posting(place(), { url: "/openings/other" })), undefined, undefined],
    ["conflicting matching postings", json([posting(place(), { url: generic }), posting(place("US"), { url: generic })]), undefined, undefined],
    ["cyclic graph", json({ "@graph": [posting({ "@id": "#place" }), { "@id": "#place", address: { "@id": "#address" } }, { "@id": "#address" }] }), undefined, undefined],
    ["explicit header", header("Toronto, ON, Canada"), "CA", "Toronto, ON, CA"],
    ["city and country header", header("Toronto, Canada"), "CA", "Toronto, CA"],
    ["ISO country with explicit Canadian region", header("Toronto, ON, CA"), "CA", "Toronto, ON, CA"],
    ["US header", header("Austin, TX, United States"), "US", "Austin, TX, US"],
    ["city only", header("Toronto"), undefined, undefined],
    ["state abbreviation is not country", header("San Francisco, CA"), undefined, undefined],
    ["two header countries", header("Toronto, Canada or United States"), undefined, undefined],
    ["unsupported plus supported header", header("France, Canada"), undefined, undefined],
    ["JSON/header conflict", json(posting()) + header("Austin, TX, United States"), undefined, undefined],
    ["JSON/city header", json(posting()) + header("Toronto"), "CA", "Toronto, ON, CA"],
    ["same country different city", json(posting()) + header("Vancouver, BC, Canada"), "CA", undefined],
    ["remote header", header("Toronto, ON, Canada (Remote)"), "CA", undefined],
    ["remote header overrides concrete JSON office", json(posting()) + header("Toronto, ON, Canada (Remote)"), "CA", undefined],
    ["country-only JSON", json(posting({ address: { addressCountry: "CA" } })), "CA", undefined],
    ["footer boilerplate", '<footer><div class="job-header"><div data-job-location>Toronto, ON, Canada</div></div></footer>', undefined, undefined],
    ["body prose", '<p>Our offices include Canada and the United States. Toronto, ON, Canada</p>', undefined, undefined],
    ["definition list header", '<header><h1>Analyst</h1><dl><dt>Job location</dt><dd>Toronto, ON, Canada</dd></dl></header>', "CA", "Toronto, ON, CA"],
    ["microdata", '<article itemscope itemtype="https://schema.org/JobPosting"><div itemprop="jobLocation"><div itemprop="address"><meta itemprop="addressCountry" content="CA"><span itemprop="addressLocality">Toronto</span><span itemprop="addressRegion">ON</span></div></div></article>', "CA", "Toronto, ON, CA"],
    ["microdata company address", '<article itemscope itemtype="https://schema.org/JobPosting"><div itemprop="hiringOrganization"><meta itemprop="addressCountry" content="CA"></div></article>', undefined, undefined],
    ["nested organization is not job address", '<article itemscope itemtype="https://schema.org/JobPosting"><div itemprop="jobLocation"><div itemprop="hiringOrganization"><div itemprop="address"><meta itemprop="addressCountry" content="CA"></div></div></div></article>', undefined, undefined],
  ];
  for (const url of [generic, braze, "https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-000000000000/application"]) {
    for (const [name, metadata, country, location] of countryCases) {
      const body = metadata.replaceAll(generic, url) + form(field("Country", 'value="United States"'));
      await load(body, url);
      const result = await inspect();
      assert.equal(result.error, undefined, `${url}: ${name}`);
      assert.equal(result.employmentCountry, country, `${url}: ${name}`);
      assert.equal(result.employmentLocation, location, `${url}: ${name}`);
      count++;
    }
  }
  await load('<div class="job__title"><h1>Software Engineer II, Data Lakehouse</h1><div class="job__location"><div>Toronto</div></div></div>' +
    '<p>For candidates based in Canada, the pay range...</p>' + form(field("Country", 'value="Canada"')), braze);
  assert.equal((await inspect()).employmentCountry, undefined, "observed Braze city does not imply country");
  assert.equal((await inspect()).employmentLocation, undefined);
  count++;

  const controls = `<span id="first">First</span><span id="name">name</span><input id="split" aria-labelledby="first name">
    ${field("Please provide a link to your LinkedIn, GitHub, portfolio or similar professional profile or website.", 'id="choice"')}
    ${field("Portfolio or website URL", 'id="portfolio"')}
    <div role="group" aria-labelledby="reference-title"><h3 id="reference-title">Reference details</h3>${field("LinkedIn profile URL", 'id="reference"')}</div>
    <fieldset aria-labelledby="emergency-title"><span id="emergency-title">Emergency contact</span>${field("Email", 'id="emergency"')}</fieldset>
    ${field("Do not provide LinkedIn or GitHub profile URL", 'id="negated"')}
    ${field("LinkedIn and GitHub URL", 'id="both"')}
    ${field("LinkedIn, GitHub URL", 'id="list"')}
    ${field("Employer LinkedIn or portfolio URL", 'id="employer"')}
    ${field("First name", 'id="conflict" aria-label="Reference first name"')}
    ${field("Email", 'id="duplicate" aria-labelledby="dupe"')}<span id="dupe">Email</span><span id="dupe">Email</span>
    <label for="many">Email</label><label for="many">Employer email</label><input id="many">
    <input id="placeholder" placeholder="Email" autocomplete="email">`;
  await load(form(controls).replace(field("First name", 'id="first_name" autocomplete="given-name"'), ""));
  const result = await inspect("autofill", { contact });
  assert.equal(result.error, undefined);
  assert.equal(await page.locator("#split").inputValue(), contact.givenName);
  assert.equal(await page.locator("#choice").inputValue(), contact.professionalUrl);
  assert.equal(await page.locator("#portfolio").inputValue(), contact.portfolioUrl);
  for (const id of ["reference", "emergency", "negated", "both", "list", "employer", "conflict", "duplicate", "many", "placeholder"])
    assert.equal(await page.locator(`#${id}`).inputValue(), "", id);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  count++;

  for (const label of ["Current company", "Current employer", "Company you currently work for"]) {
    await load(form(field(label, 'id="company"') + field("Current job title", 'id="title"') +
      '<fieldset><legend>Previous employment</legend>' + field("Current company", 'id="history"') + '</fieldset>' +
      field("Previous employer", 'id="previous"') + field("Desired company", 'id="desired"')));
    await inspect("autofill", { contact: { ...contact, currentCompany: "Current Only Ltd", currentTitle: "Analyst" } });
    assert.equal(await page.locator("#company").inputValue(), "Current Only Ltd", label);
    assert.equal(await page.locator("#title").inputValue(), "Analyst");
    for (const id of ["history", "previous", "desired"]) assert.equal(await page.locator(`#${id}`).inputValue(), "");
    count++;
  }
  await load(form(field("Current employer", 'id="company"')));
  await inspect("autofill", { contact, history: [{ kind: "experience", entry: { company: "Previous Co", dates: { current: false } } }] });
  assert.equal(await page.locator("#company").inputValue(), "", "no employment is inferred by detection");
  count++;

  await load(form('<section><h3 id="current-label">Current employer</h3><input id="current-question" aria-labelledby="current-label"></section>' +
    '<fieldset><legend>Previous employment</legend><section><h3 id="old-label">Current employer</h3><input id="old-question" aria-labelledby="old-label"></section></fieldset>'));
  const grouped = await inspect();
  assert.equal(grouped.fields.find(field => field.label === "Current employer" && field.profileKey === "currentCompany")?.profileKey, "currentCompany");
  await inspect("autofill", { contact: { ...contact, currentCompany: "Current Only Ltd" } });
  assert.equal(await page.locator("#current-question").inputValue(), "Current Only Ltd", "single current-employer question heading is not history");
  assert.equal(await page.locator("#old-question").inputValue(), "", "outer history still excludes current-employer label");
  count++;

  const searchWidgets = `<input role="combobox" aria-label="Search" value="Existing choice">
    <div role="listbox"><label>Nested answer<input aria-label="Email"></label></div>
    <input type="search" aria-label="Search countries">
    <span id="pronouns-label">Pronouns</span><input role="combobox" aria-label="Search" aria-labelledby="pronouns-label">
    <div data-testid="phone_number-code"><input role="combobox" data-input="select-search-input" data-testid="input-select-search-input" aria-haspopup="listbox" aria-label="Search" value="+1 US"></div>`;
  for (const url of [generic, "https://ats.rippling.com/fixture/jobs/00000000-0000-4000-8000-000000000000/apply"]) {
    await load(form(searchWidgets), url);
    const scan = await inspect();
    assert.equal(scan.fields.some(field => /^Search/.test(field.label)), false);
    assert.equal(scan.questions.some(label => /^Search/.test(label)), false);
    assert.equal(scan.fields.filter(field => field.profileKey === "email").length, 1, "popup controls are not answers");
    assert.ok(scan.fields.some(field => field.profileKey === "pronouns"), "real ARIA label overrides Search fallback");
    assert.equal(scan.fields.some(field => field.profileKey === "phoneCountry"), url.includes("rippling"));
    count++;
  }

  const genericCases = [
    ["local form name", form(), true],
    ["preceding heading", '<h1>Apply for this job</h1>' + form().replace('aria-label="Job application"', "").replace("Submit application", "Submit"), true],
    ["resume evidence without heading", form(field("Resume", 'type="file"')).replace('aria-label="Job application"', "").replace("Submit application", "Submit"), true],
    ["anonymous PDF upload", form(field("Attachment", 'type="file" accept="application/pdf"')).replace('aria-label="Job application"', "").replace("Submit application", "Submit"), false],
    ["newsletter under apply heading", '<h1>Apply for this job</h1><form><h2>Subscribe</h2>' + field("Email") + '</form>', false],
    ["contact beside jobs", '<h1>Apply for this job</h1><section><h2>Contact us</h2><form>' + field("First name") + field("Email") + '</form></section>', false],
    ["loan application", '<h1>Loan application</h1><form>' + field("First name") + field("Email") + '</form>', false],
    ["login", form(field("Password", 'type="password"')), false],
    ["multiple application forms", form() + form(), false],
    ["application plus unrelated newsletter", form() + '<form aria-label="Newsletter">' + field("Email") + '</form>', true],
    ["formless application", '<section><h2>Job application</h2>' + field("First name") + field("Email") + field("Resume", 'type="file"') + '</section>', true],
  ];
  for (const [name, body, expected] of genericCases) {
    await load(body);
    assert.equal(!(await inspect()).error, expected, name);
    count++;
  }
  await load('<span id="email">Reference email in document</span><div id="host"></div>');
  await page.evaluate(body => { document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML = body; },
    form().replace(field("Email", 'id="email" type="email" autocomplete="email"'), '<span id="email">Email</span><input aria-labelledby="email" type="email">'));
  assert.equal((await inspect("autofill", { contact })).error, undefined);
  assert.equal(await page.locator("#host input[type=email]").inputValue(), contact.email);
  assert.equal(await page.locator("#host #first_name").inputValue(), contact.givenName);
  await page.locator("#host").evaluate(host => host.setAttribute("inert", ""));
  assert.ok((await inspect()).error, "inert shadow host is not an application");
  count++;
  await load(form('<div id="host"></div>'));
  await page.evaluate(() => { document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML = '<label>Email<input></label>'; });
  assert.match((await inspect()).error, /split across shadow roots/);
  count++;

  await load(json(posting()) + form(field("Start date", 'type="date"')));
  for (const mode of ["inspect", "autofill-context", "autofill", "autofill-inspect"]) {
    const scan = await inspect(mode, { contact });
    assert.equal(scan.employmentCountry, "CA", `${mode} retains country`);
    assert.equal(scan.employmentLocation, "Toronto, ON, CA", `${mode} retains location`);
  }
  await page.locator('input[type="date"]').fill("2026-10-01");
  assert.equal((await inspect()).employmentCountry, "CA", "date change refresh retains job context");
  await page.evaluate(() => document.querySelector('script[type="application/ld+json"]').remove());
  assert.equal((await inspect()).employmentCountry, undefined, "removed metadata does not leave stale context");
  count++;
  for (const body of [form('<input>'.repeat(501)), '<div></div>'.repeat(12001) + form()]) {
    await load(body);
    assert.match((await inspect()).error, /too large/);
    count++;
  }
  for (const metadata of [json(posting(place(), { description: "x".repeat(140000) })), json(posting()).repeat(17)]) {
    await load(metadata + form());
    assert.equal((await inspect()).employmentCountry, undefined);
    count++;
  }
  console.log(JSON.stringify({ pass: true, cases: count, scope: "Cross-site context, labels, groups, links, generic forms, open shadow roots, bounds and refreshes", submissions: 0 }));
} finally {
  await browser.close();
}
