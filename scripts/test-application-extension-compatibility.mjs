import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Synthetic HTML semantics, not claims of verified proprietary ATS adapters.
// Every request is intercepted; no personal profile or employer writes.
const source = `(${createInspector.toString()})(${applicationContext.toString()})`;
const profile = { givenName: "Jordan", familyName: "Example", email: "jordan@example.test",
  phone: "+14165550100", streetAddress: "123 Example Street\nUnit 4" };
const html = () => `<!doctype html><title>Application</title><h1>Job application</h1><form>
  <label>First name<input id="first" autocomplete="section-applicant given-name"></label>
  <label>Surname<input id="last" autocomplete="SECTION-APPLICANT FAMILY-NAME"></label>
  <label>E-mail address<input id="email" autocomplete="section-applicant home email" type="email"></label>
  <label>Telephone<input id="phone" autocomplete="section-applicant mobile tel" type="tel"></label>
  <label>Street address<textarea id="address" autocomplete="section-applicant street-address"></textarea></label>
  <fieldset><legend>Reference details</legend><label>Email<input id="reference" autocomplete="email"></label></fieldset>
  <label>First name<input id="referral" autocomplete="section-reference given-name"></label>
  <label>Street address<textarea id="billing" autocomplete="billing street-address"></textarea></label>
  <label>Describe your experience<textarea id="answer" autocomplete="street-address"></textarea></label>
  <button type="button" id="next">Next</button><button>Submit</button></form>
  <script>window.steps=0;document.addEventListener('submit',e=>{e.preventDefault();window.steps++});
  document.querySelector('#next').onclick=()=>window.steps++;</script>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let fixture = html();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
  const reset = async () => {
    fixture = html();
    await page.goto("https://careers.example.test/application/123");
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  };
  const inspect = (mode = "inspect", contact = profile) => page.evaluate(
    ({mode,contact}) => window.inspect(mode, contact, location.href), {mode,contact});
  await reset();
  const timings = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    assert.equal((await inspect()).available, 5);
    timings.push(performance.now() - start);
  }
  const start = performance.now();
  assert.equal((await inspect("fill")).filled, 5);
  const fillMs = performance.now() - start;
  for (const id of ["reference", "referral", "billing", "answer"])
    assert.equal(await page.locator(`#${id}`).inputValue(), "", id);
  assert.equal(await page.locator("#address").inputValue(), profile.streetAddress);
  await page.locator("#address").fill("User correction");
  assert.equal((await inspect("undo")).undone, 4);
  assert.equal(await page.locator("#address").inputValue(), "User correction");
  await reset();
  assert.equal((await inspect("fill")).filled, 5);
  assert.equal((await inspect("undo")).undone, 5);
  assert.equal(await page.locator("#address").inputValue(), "");
  await reset();
  const missing = await inspect("fill", { email: profile.email });
  assert.equal(missing.filled, 1);
  assert.deepEqual(missing.missingFields, ["givenName", "familyName", "phone", "streetAddress"]);
  assert.equal(JSON.stringify(missing).includes(profile.email), false);
  for (const token of ["shipping given-name", "billing given-name", "section-emergency given-name",
    "given-name family-name", "section-applicant work given-name", "given-name webauthn", "off", "on"]) {
    await reset();
    await page.locator("#first").evaluate((field, token) => field.autocomplete = token, token);
    assert.equal((await inspect("fill")).filled, 4, token);
    assert.equal(await page.locator("#first").inputValue(), "", token);
  }
  for (const change of ["disabled", "readonly", "hidden", "replace", "reference", "ambiguous", "password", "move", "navigate"]) {
    await reset();
    await page.evaluate(change => {
      document.querySelector("#first").addEventListener("input", () => {
        const field = document.querySelector("#last");
        if (change === "replace") field.replaceWith(field.cloneNode(true));
        else if (change === "reference") field.parentElement.firstChild.textContent = "Reference surname";
        else if (change === "ambiguous") field.parentElement.after(field.parentElement.cloneNode(true));
        else if (change === "password") field.type = "password";
        else if (change === "move") document.querySelector("fieldset").append(field.parentElement);
        else if (change === "navigate") history.pushState({}, "", "/application/456");
        else field.setAttribute(change, "");
      }, {once:true});
    }, change);
    await inspect("fill");
    assert.equal(await page.locator("#last").first().inputValue(), "", change);
    assert.equal(await page.evaluate(() => window.steps), 0);
  }
  // Undo must also revalidate fields after preceding input events mutate the DOM.
  await reset();
  await inspect("fill");
  await page.locator("#first").evaluate(field => field.addEventListener("input", () => {
    document.querySelector("#last").readOnly = true;
  }, {once:true}));
  assert.equal((await inspect("undo")).undone, 4);
  assert.equal(await page.locator("#last").inputValue(), profile.familyName);
  // Live-observed Workable identifiers, tested only on intercepted synthetic HTML.
  fixture = `<!doctype html><h1>Software Engineer</h1><form data-ui="application-form">
    <h2>Personal information</h2>
    ${[["First name","firstname"],["Last name","lastname"],["Email","email"]].map(([label,id]) =>
      `<label><span id="${id}_label">*${label}</span><input id="${id}" name="${id}" data-ui="${id}" aria-labelledby="${id}_label"></label>`).join("")}
    <label>Phone<span role="combobox" aria-label="Telephone country code">+1</span><input name="phone" type="tel"></label>
    <label>Address<input id="address" name="address" data-ui="address" value="Toronto, Canada"></label>
    <label>Email<input id="QA_reference" name="QA_reference" data-ui="QA_reference"></label>
    <label>Resume<input id="resume" type="file" data-ui="resume"></label>
    <label>Photo<input id="photo" type="file" data-ui="avatar"></label>
    <label>Cover letter<textarea id="cover_letter"></textarea></label>
    <button>Submit application</button></form>`;
  const workableUrl = "https://apply.workable.com/fixture/j/CFA264B77A/apply/";
  await page.goto(workableUrl);
  await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  const workable = await inspect();
  assert.equal(workable.available, 3);
  assert.equal(workable.resumeAvailable, false);
  assert.equal((await inspect("fill")).filled, 3);
  assert.equal(await page.locator("#QA_reference").inputValue(), "");
  assert.equal(await page.locator('[name="phone"]').inputValue(), "");
  assert.equal(await page.locator("#address").inputValue(), "Toronto, Canada");
  assert.equal(await page.locator("#cover_letter").inputValue(), "");
  assert.equal((await inspect("undo")).undone, 3);
  for (const attribute of ["id", "name", "data-ui"]) {
    await page.goto(workableUrl);
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
    await page.locator("#firstname").evaluate((field, attribute) => field.setAttribute(attribute, "QA_custom"), attribute);
    assert.equal((await inspect("fill")).filled, 2, attribute);
  }
  const p95 = [...timings].sort((a,b)=>a-b)[18];
  assert.ok(p95 < 1000, `Detection regression: ${p95}ms`);
  assert.ok(fillMs < 1500, `Fill regression: ${fillMs}ms`);
  console.log(JSON.stringify({pass:true, scanSamples:20, scanP95Ms:Math.round(p95), fillMs:Math.round(fillMs),
    scope:"Synthetic generic HTML forms; no network latency", unsafeWrites:0, submissions:0}));
} finally {
  await browser.close();
}
