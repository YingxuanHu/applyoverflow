import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Observed Rippling identifiers, with synthetic profile/file data and no network.
const url = "https://ats.rippling.com/example/jobs/d522f490-bd87-43a0-9383-b81c4bc91c44/apply";
const textField = (id, key, label) => `<span id="${id}-label">${label}</span><input id="${id}" data-input="${key}" data-testid="input-${key}" aria-labelledby="${id}-label" autocomplete="off">`;
const fixture = `<h4>Application: Engineer</h4><form>
  <span id="resume-label">R\u00e9sum\u00e9 *</span><span id="files">Total 0 file selected</span>
  <label data-testid="resume" aria-labelledby="files resume-label"><input type="file" data-testid="input-resume" accept=".doc,.docx,.pdf"><button type="button">Select resume</button></label>
  ${textField("first", "first_name", "First name *")}${textField("last", "last_name", "Last name *")}
  ${textField("email", "email", "Email *")}${textField("phone", "phone_number", "Phone number *")}
  <span id="city-label">Location *</span><input id="city" data-testid="input-undefined" aria-labelledby="city-label" aria-autocomplete="list" aria-haspopup="listbox" autocomplete="off">
  <ul role="listbox" id="cities" hidden></ul>
  <span id="cover-label">Cover letter</span><label aria-labelledby="cover-label"><input type="file" data-testid="input-cover_letter" accept=".pdf"></label>
  <fieldset><legend>Reference details</legend>${textField("reference", "first_name", "First name")}</fieldset>
  <button>Apply</button></form><script>
  window.submissions=0; document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
  const city=document.getElementById('city'), list=document.getElementById('cities');
  city.oninput=()=>{if(city.value==='Toronto')setTimeout(()=>{city.setAttribute('aria-controls','cities');list.hidden=false;
    list.innerHTML='<li role="option">Toronto, OH, USA</li><li role="option">Toronto, ON, Canada</li>';},90)};
  list.onclick=e=>{city.value=e.target.textContent;list.hidden=true;document.body.dataset.place='confirmed'};
  </script>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }));
  const load = async (link = url) => {
    await page.goto(link);
    await page.evaluate(`window.inspect=(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`);
  };
  const inspect = (mode, payload = {}) => page.evaluate(({mode,payload}) => window.inspect(mode,payload,location.href), {mode,payload});
  const contact = { givenName: "Jordan", familyName: "Example", email: "jordan@example.test", phone: "4165550100", city: "Toronto", region: "ON", country: "CA" };
  await load();
  const scan = await inspect("inspect");
  assert.equal(scan.available, 4); assert.equal(scan.resumeAvailable, true);
  const filled = await inspect("autofill", { contact });
  for (const key of ["givenName","familyName","email","phone","city"]) assert.equal(filled.fields.find(field => field.profileKey === key)?.state, "filled", key);
  assert.equal(await page.locator("#city").inputValue(), "Toronto, ON, Canada");
  assert.equal(await page.locator("body").getAttribute("data-place"), "confirmed");
  assert.equal(await page.locator("#reference").inputValue(), "");
  const ready = await inspect("prepare-resume");
  await page.locator('[data-testid="input-resume"]').evaluate(field => {
    field.addEventListener("change", () => setTimeout(() => {
      document.getElementById("first").value = "Imported nickname";
      document.getElementById("last").value = "Imported surname";
      document.getElementById("phone").value = "416-555-0100";
    }, 200));
  });
  await page.locator("#last").fill("User surname");
  const bytes = Buffer.from("%PDF-1.4 synthetic resume fixture");
  const attached = await inspect("attach-resume", { resumeToken: ready.resumeToken, name: "fixture.pdf", mimeType: "application/pdf", size: bytes.length, base64: bytes.toString("base64") });
  assert.equal(attached.resumeSelected, true);
  assert.equal(attached.resumeParserReview, true);
  assert.equal(await page.locator("#first").inputValue(), "Jordan", "Restore a profile field overwritten by the employer parser");
  assert.equal(await page.locator("#last").inputValue(), "Imported surname", "Do not intervene once the user has edited a field");
  assert.equal(await page.locator("#phone").inputValue(), "416-555-0100", "Preserve equivalent employer formatting");
  assert.equal(await page.locator('[data-testid="input-cover_letter"]').evaluate(field => field.files.length), 0);
  assert.equal((await inspect("inspect")).resumeAvailable, false);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  await page.locator("#first").fill("User edit");
  await inspect("autofill", { contact }); assert.equal(await page.locator("#first").inputValue(), "User edit");
  await load();
  await page.locator("#first").evaluate(field => field.setAttribute("data-testid", "custom-first"));
  await inspect("autofill", { contact }); assert.equal(await page.locator("#first").inputValue(), "");
  await load("https://unknown.fixture/application");
  await inspect("autofill", { contact }); assert.equal(await page.locator("#first").inputValue(), "", "Provider-specific IDs do not relax generic-site rules");
  console.log("PASS Rippling paired identifiers, exact asynchronous location, unlabeled-ID resume widget, preservation, reference exclusion and zero submissions");
} finally { await browser.close(); }
