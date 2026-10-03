import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { createQuestionReview } from "../extensions/chrome/question-review.mjs";
import { questionAssistance } from "../extensions/chrome/question-policy.mjs";

const runtime = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const contact = { givenName: "Jordan", familyName: "Example", email: "jordan@example.test", phone: "4165550100", phoneCountry: "CA", city: "Toronto", region: "ON", country: "CA" };
const url = "https://job-boards.greenhouse.io/fixture/jobs/123";
const browser = await chromium.launch();
await mkdir("output/playwright", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  if (process.argv.includes("--live")) {
    for (const [name, link] of [
      ["klaviyo", "https://job-boards.greenhouse.io/klaviyocampus/jobs/7989324003"],
      ["vercel", "https://job-boards.greenhouse.io/vercel/jobs/6098390004"],
    ]) {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator("#first_name").waitFor({ timeout: 15_000 });
      await page.waitForLoadState("load");
      await page.waitForTimeout(800);
      await page.evaluate(source => {
        window.inspect = (0, eval)(source);
        document.addEventListener("submit", e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      }, runtime);
      const started = Date.now();
      const result = await inspect("autofill", { contact });
      for (const key of ["givenName", "familyName", "email", "phone", "phoneCountry", "city"]) {
        const field = result.fields?.find(f => f.profileKey === key);
        if (field) assert.equal(field.state, "filled", `${name}: ${key}: ${field.reason}`);
      }
      assert.ok(!result.fields.some(f => f.label === "Attach"));
      console.log(`PASS live ${name}: supported contact controls filled in ${Date.now() - started}ms; no resume upload or submission`);
      await page.locator("#first_name").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `output/playwright/extension-live-${name}.png` });
    }
  } else {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `
      <div class="job__description">Build reporting tools for finance teams.</div><h1>Engineer</h1><form>
      <label for="first_name">First Name*</label><input id="first_name"><label for="last_name">Last Name*</label><input id="last_name">
      <label for="email">Email*</label><input id="email" type="email">
      <fieldset class="phone-input"><legend>Phone</legend><label for="country">Country*</label>
      <div class="select__value-container"><input id="country" role="combobox" aria-expanded="false" aria-controls="countries"></div>
      <div role="listbox" id="countries" hidden><div role="option">Canada +1</div><div role="option">United States +1</div></div>
      <label for="phone">Phone*</label><input id="phone" type="tel"></fieldset>
      <label for="candidate-location">Location (City)*</label><div class="select__value-container"><input id="candidate-location" role="combobox" aria-expanded="false" aria-controls="cities"></div>
      <div role="listbox" id="cities" hidden></div><label>Attach<input type="file"></label>
      <label>Why do you want to join us?*<textarea id="why"></textarea></label>
      <label>What weekdays are you available?<textarea></textarea></label><button>Submit</button></form>
      <script>
      window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};
      const country=document.getElementById('country'),countries=document.getElementById('countries'),city=document.getElementById('candidate-location'),cities=document.getElementById('cities');
      country.onmousedown=()=>{countries.hidden=false;country.setAttribute('aria-expanded','true')};
      countries.onclick=e=>{const v=document.createElement('div');v.className='select__single-value';v.innerHTML='<div class="iti__flag iti__ca"></div><span>+1</span>';country.parentElement.append(v);country.value='';countries.hidden=true;country.setAttribute('aria-expanded','false')};
      city.onmousedown=()=>{cities.hidden=false;city.setAttribute('aria-expanded','true')};
      city.oninput=()=>{if(city.value==='Toronto')setTimeout(()=>{cities.replaceChildren(...(window.cityChoices||['Toronto, Ohio, United States','Toronto, Ontario, Canada']).map(x=>{const o=document.createElement('div');o.role='option';o.textContent=x;return o}))},90)};
      cities.onclick=e=>{const v=document.createElement('div');v.className='select__single-value';v.textContent=e.target.textContent;city.parentElement.append(v);city.value='';cities.hidden=true;city.setAttribute('aria-expanded','false')};
      for(const [input,list] of [[city,cities],[country,countries]])input.onkeydown=e=>{if(e.key==='Escape'){list.hidden=true;input.setAttribute('aria-expanded','false')}};
      document.getElementById('phone').oninput=e=>{if(e.target.value==='4165550100')e.target.value='(416) 555-0100'};
      </script>` }));
    const load = async () => { await page.goto(url); await page.evaluate(code => window.inspect = (0, eval)(code), runtime); };
    await load();
    let result = await inspect("autofill", { contact });
    for (const key of ["givenName", "familyName", "email", "phone", "phoneCountry", "city"]) assert.equal(result.fields.find(f => f.profileKey === key).state, "filled", key);
    assert.ok(!result.fields.some(f => f.label === "Attach"));
    assert.equal((await inspect("autofill-context")).jobDescription, "Build reporting tools for finance teams.");
    assert.equal((await inspect()).jobDescription, undefined, "No background job-text export");
    await load(); await page.evaluate(() => { window.cityChoices = ['Toronto, Ontario, Canada', 'Toronto, Ontario, Canada']; });
    await inspect("autofill", { contact });
    assert.equal(await page.locator("#candidate-location").inputValue(), "", "Ambiguous location search is cleared, not guessed");
    await load(); await page.locator("#candidate-location").fill("My own location");
    await inspect("autofill", { contact }); assert.equal(await page.locator("#candidate-location").inputValue(), "My own location");
    await load(); result = await inspect("autofill", { contact });
    const fields = result.fields;
    const review = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await review.setContent('<main id="review"></main>');
    await review.addStyleTag({ content: await readFile("extensions/chrome/popup.css", "utf8") });
    await review.evaluate(({ source, policy, fields }) => {
      const render = (0, eval)(`(${source})`) ((0, eval)(`(${policy})`));
      window.calls=[];
      render(document.getElementById('review'), fields, async message => { window.calls.push(message); });
      window.renderReview = data => render(document.getElementById('review'), data, async (type, payload) => {
        window.calls.push({type,...payload});
        if(type==='autofill-suggest')return {suggestion:{answer:'I enjoy building reporting tools, drawing on my experience developing a finance dashboard.',evidence:[{id:'summary',quote:'Built a finance dashboard.'}],missing:''}};
      });
      window.renderReview(fields);
    }, { source: createQuestionReview.toString(), policy: questionAssistance.toString(), fields });
    assert.equal(await review.getByText(/Remember for this employer/).count(), 0);
    await review.getByRole("button", { name: "Suggest answer", exact: true }).click();
    const answer = review.getByRole("textbox", { name: /^Answer: Why/ });
    assert.match(await answer.inputValue(), /reporting tools/);
    assert.equal(await page.locator("#why").inputValue(), "", "Drafts do not insert themselves");
    await answer.fill("My edited answer based on my profile.");
    await review.getByRole("button", { name: "Use answer" }).click();
    const call = await review.evaluate(() => window.calls.find(c => c.type === 'autofill-answer'));
    assert.equal(call.remember, false); assert.equal(call.answer, "My edited answer based on my profile.");
    await inspect("autofill-answer", call); assert.equal(await page.locator("#why").inputValue(), call.answer);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.ok(!await review.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await review.screenshot({ path: "output/playwright/extension-question-draft.png", fullPage: true });
    await review.setViewportSize({ width: 320, height: 640 });
    assert.ok(!await review.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await review.evaluate(fields => { window.renderReview([]); window.renderReview(fields); }, fields);
    assert.equal(await review.getByRole("textbox", { name: /^Answer: Why/ }).inputValue(), "", "Clearing an account's questions discards drafts before reconnecting");
    console.log("PASS real-shaped dropdowns, flag/phone readback, async city selection, ambiguity, preservation, compact editable draft workflow, privacy and no submission");
  }
} finally { await browser.close(); }
