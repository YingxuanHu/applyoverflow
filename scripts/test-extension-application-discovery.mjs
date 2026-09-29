import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { installIndicator } from "../extensions/chrome/indicator.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtimePath ? `${await readFile(runtimePath, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` : `window.inspect=${source};`;
const field = (label, id, attrs = "") => `<label for="${id}">${label}</label><input id="${id}" ${attrs}>`;
const select = (label, id) => `<label for="${id}">${label}</label><select id="${id}"><option value="">Choose</option><option>Yes</option><option>No</option></select>`;
const contact = { fullName: "Jordan Example", givenName: "Jordan", email: "jordan@example.test", phone: "4165550100", linkedInUrl: "https://www.linkedin.com/in/example" };
const identity = `${field("Full name", "name")}${field("Email", "email", 'type="email"')}`;
const questions = `${select("Are you authorized to work in Canada?", "auth")}${select("Do you require visa sponsorship?", "sponsor")}`;
const plan = { contact, commonAnswers: [
  { label: "Are you authorized to work in Canada?", answer: "Yes", answerKey: "authorizedCA" },
  { label: "Do you require visa sponsorship?", answer: "No", answerKey: "sponsorshipCA" },
] };
const custom = "https://careers.custom-employer.example/jobs/42/apply";
const browser = await chromium.launch();
let count = 0;
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (body, url = custom) => {
    html = `<!doctype html><meta charset="utf-8"><title>Fixture</title>${body}<script>
      window.submissions=0;document.addEventListener('submit',e=>{e.preventDefault();window.submissions++});
      document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>window.submissions++));</script>`;
    await page.goto(url);
    await page.evaluate(code => { (0, eval)(code); }, installer);
  };
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const check = async (name, body, expected, url = custom) => {
    await load(body, url);
    const started = performance.now();
    const result = await inspect("autofill", plan);
    assert.equal(!result.error, expected, `${name}: ${result.error}`);
    if (expected) {
      for (const [id, value] of [["name", contact.fullName], ["email", contact.email], ["phone", contact.phone], ["auth", "Yes"], ["sponsor", "No"]]) {
        if (await page.locator(`#${id}`).count()) assert.equal(await page.locator(`#${id}`).inputValue(), value, `${name}: ${id}`);
      }
    } else {
      assert.equal(await page.locator('input:not([type=file]),textarea,select').evaluateAll(fields => fields.some(field => field.value)), false, `${name}: no writes`);
    }
    assert.equal(await page.evaluate(() => window.submissions), 0, `${name}: no navigation/submission`);
    assert.ok(performance.now() - started < 2000, `${name}: bounded detection/fill`);
    console.log(`PASS ${name}`); count++;
    return result;
  };
  for (const tag of ["form", 'div role="form"', "section", "main"]) {
    await check(`contact without upload: ${tag}`, `<${tag}><h2>Job application</h2>${identity}<button>Submit application</button></${tag.split(" ")[0]}>`, true);
    await check(`question-only step: ${tag}`, `<${tag}><h2>Application questions</h2>${questions}<button>Continue</button></${tag.split(" ")[0]}>`, true);
  }
  await check("name and phone without email", `<form aria-label="Employment application">${field("Full name", "name")}${field("Phone number", "phone")}</form>`, true);
  await check("numbered application step", `<form><h2>Application questions (2 of 4)</h2>${questions}</form>`, true);
  await check("custom container includes sibling questions", `<main><h2>Job application</h2><div>${identity}</div><div>${questions}</div><button>Submit application</button></main>`, true);
  for (const url of [
    "https://jobs.ashbyhq.com/fixture.example/00000000-0000-4000-8000-000000000000/application",
    "https://apply.workable.com/fixture/j/ABCD123456/apply/",
    "https://fixture.careers.hibob.com/jobs/00000000-0000-4000-8000-000000000000/apply",
    "https://jobs.lever.co/fixture/00000000-0000-4000-8000-000000000000/apply",
  ]) await check(`provider-independent fallback: ${new URL(url).hostname}`, `<section><h2>Job application</h2>${identity}${questions}<button>Submit application</button></section>`, true, url);
  await check("credit analyst is a job, not a loan", `<h1>Credit analyst application</h1><form>${identity}</form>`, true);
  await check("structural question labels", `<main><h2>Job application</h2>
    <div><span>Full name</span><div><input id="name"></div></div>
    <div><p>Email</p><input id="email" type="email"></div>
    <div><div>Phone number</div><input id="phone"></div>
    <div><span>Please provide your LinkedIn profile URL</span><input id="linkedin"></div></main>`, true);
  assert.equal(await page.locator("#linkedin").inputValue(), contact.linkedInUrl);
  await check("structural labels with separate help", `<main><h2>Job application</h2>${identity}<div><p>Phone number</p><input id="phone" aria-describedby="phone-help"><p id="phone-help">Include your country code.</p></div></main>`, true);
  for (const [name, body] of [
    ["newsletter beside careers", `<h1>Apply for this job</h1><section><h2>Newsletter</h2>${identity}</section>`],
    ["contact form", `<h1>Job application</h1><section><h2>Contact us</h2>${identity}</section>`],
    ["loan application", `<form><h2>Loan application</h2>${identity}</form>`],
    ["payment form", `<form><h2>Job application</h2>${identity}${field("Card number", "card", 'autocomplete="cc-number"')}</form>`],
    ["login", `<form><h2>Job application</h2>${identity}${field("Password", "password", 'type="password"')}</form>`],
    ["application headline alone", `<section><h2>Job application</h2>${field("Favorite color", "color")}</section>`],
    ["job questions without application context", `<section>${questions}</section>`],
    ["placeholder-only controls", '<section><h2>Job application</h2><input placeholder="Full name"><input placeholder="Email"></section>'],
    ["reference subtree cannot borrow application context", `<main><h2>Job application</h2><div><h3>Reference details</h3><div><h4>Contact information</h4>${identity}</div></div></main>`],
    ["two independent custom applications", `<main><section><h2>Job application</h2>${identity}<button>Submit application</button></section><section><h2>Job application</h2>${field("Full name", "other-name")}${field("Email", "other-email")}<button>Submit application</button></section></main>`],
  ]) await check(name, body, false);
  await check("unrelated newsletter is isolated", `<form aria-label="Newsletter">${field("Email", "newsletter")}</form><main><h2>Job application</h2>${identity}</main>`, true);
  assert.equal(await page.locator("#newsletter").inputValue(), "");

  await load(`<form aria-label="Job application">${identity}
    <div><h3>Reference details</h3><div><span>Phone number</span><input id="reference"></div></div>
    <div><label for="email">Email</label><input id="borrowed"></div>
    <div><span>Phone number</span><span>Emergency phone</span><input id="ambiguous"></div>
    <div><span>Phone number</span><input id="invalid-aria" aria-labelledby="missing"></div>
    <div><span>Phone number</span><input id="conflict" autocomplete="email"></div>
    <div><h3>Education</h3><div><span>Email</span><input id="school-contact"></div></div>
    </form>`);
  await inspect("autofill", plan);
  for (const id of ["reference", "borrowed", "ambiguous", "invalid-aria", "conflict", "school-contact"])
    assert.equal(await page.locator(`#${id}`).inputValue(), "", `protected ${id}`);
  count++; console.log("PASS structural labels do not override explicit conflicts, borrow other labels or fill third-party contacts");

  await load(`<main><h2>Application questions</h2><fieldset><legend>Education</legend>
    ${field("School", "school")}${field("Degree", "degree")}${field("Field of study", "major")}${field("Start date", "start", 'type="date"')}</fieldset></main>`);
  const education = await inspect("autofill", { history: [{ kind: "education", entry: {
    school: "Fixture University", degree: "Bachelor of Science", fieldOfStudy: "Computer Science", dates: { start: "2020-09", end: "2024-06", current: false },
  } }] });
  assert.equal(education.error, undefined);
  for (const [id, value] of [["school", "Fixture University"], ["degree", "Bachelor of Science"], ["major", "Computer Science"], ["start", "2020-09-01"]])
    assert.equal(await page.locator(`#${id}`).inputValue(), value);
  count++; console.log("PASS education-only step reads back school, degree, field of study and start date");
  await load(`<main><h2>Application questions</h2><fieldset><legend>Work experience</legend>
    ${field("Company", "company")}${field("Job title", "title")}${field("Start date", "start", 'type="date"')}</fieldset></main>`);
  const experience = await inspect("autofill", { history: [{ kind: "experience", entry: {
    company: "Fixture Company", title: "Engineer", dates: { start: "2023-01", end: "2024-08", current: false },
  } }] });
  assert.equal(experience.error, undefined);
  for (const [id, value] of [["company", "Fixture Company"], ["title", "Engineer"], ["start", "2023-01-01"]])
    assert.equal(await page.locator(`#${id}`).inputValue(), value);
  count++; console.log("PASS experience-only step reads back company, title and start date");

  await load(`<main id="root"></main>`);
  assert.ok((await inspect()).error);
  await page.locator("#root").evaluate((root, body) => { root.innerHTML = body; }, `<h2>Application questions</h2>${questions}`);
  assert.equal((await inspect("autofill", plan)).error, undefined);
  assert.equal(await page.locator("#auth").inputValue(), "Yes");
  await page.locator("#root").evaluate(root => { root.innerHTML = '<h2>Newsletter</h2><label>Email<input id="newsletter"></label>'; });
  assert.ok((await inspect("autofill", plan)).error);
  assert.equal(await page.locator("#newsletter").inputValue(), "");
  count++; console.log("PASS dynamic step discovery does not retain stale application context");
  await load('<main><h2 id="heading">Job application</h2><input id="name"><input id="email"></main>');
  await page.evaluate(code => {
    window.chrome = { runtime: { id: "discovery-fixture", onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async () => ({ enabled: true, connected: true }) } };
    globalThis.__applyOverflowInspect = window.inspect;
    (0, eval)(`(${code})("fixture", null)`);
  }, installIndicator.toString());
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#applyoverflow-assistant").count(), 0);
  await page.evaluate(() => {
    document.querySelector("#name").setAttribute("aria-label", "Full name");
    document.querySelector("#email").setAttribute("aria-label", "Email");
  });
  await page.getByRole("button", { name: "Application help available", exact: true }).waitFor({ timeout: 2000 });
  await page.locator("#heading").evaluate(node => { node.firstChild.data = "Newsletter"; });
  await page.locator("#applyoverflow-assistant").waitFor({ state: "detached", timeout: 2000 });
  await page.evaluate(() => globalThis.__applyOverflowIndicator.stop());
  count++; console.log("PASS on-page assistant reacts to hydrated ARIA labels and changing heading text");
  console.log(JSON.stringify({ cases: count, scope: "Network-isolated custom application discovery and actual field readback", submissions: 0 }));
} finally { await browser.close(); }
