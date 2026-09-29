import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const runtime = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtime ? `${await readFile(runtime, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` :
  `window.inspect=(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})());`;
const contact = { fullName: "Jordan Example", email: "jordan@example.test", city: "Toronto", region: "ON", country: "CA",
  linkedInUrl: "https://linkedin.com/in/example", githubUrl: "https://github.com/example", portfolioUrl: "https://example.test" };
const field = (label, control = '<input id="target">') => `<div><label for="target">${label}</label>${control}</div>`;
const option = text => `<option value="${text}">${text}</option>`;
const browser = await chromium.launch();
let assertions = 0;
try {
  async function fixture(body, run, url = "https://careers.example.test/application", tag = "form") {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Job application</title>
        <h1>Engineer application</h1><${tag}><label for="name">Full name</label><input id="name">
        <label for="email">Email</label><input id="email" type="email">${body}
        <button type="submit">Submit application</button></${tag.split(' ')[0]}><script>
        window.submissions=0;document.addEventListener('submit',e=>{e.preventDefault();window.submissions++});</script>` }));
      await page.goto(url);
      await page.evaluate(code => { (0, eval)(code); }, installer);
      const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
      await run(page, inspect);
      assert.equal(await page.evaluate(() => window.submissions), 0);
      assertions++;
    } finally { await context.close(); }
  }
  const hosts = ["https://careers.example.test/application", "https://jobs.ashbyhq.com/example/00000000-0000-4000-8000-000000000000/application",
    "https://jobs.lever.co/example/00000000-0000-4000-8000-000000000000/apply", "https://job-boards.greenhouse.io/example/jobs/12345"];
  for (const url of hosts) for (const [label, expected, saved] of [
    ["Location", "Toronto, ON, Canada", contact],
    ["Portfolio, GitHub, or Personal Site", contact.githubUrl, { ...contact, portfolioUrl: "" }],
  ]) await test(`${new URL(url).hostname}: ${label} uses facts without platform IDs`, async () => {
    await fixture(field(label), async (page, inspect) => {
      await inspect();
      await page.locator('#target').click();
      await page.locator('#target').press('Tab');
      const result = await inspect("autofill", { contact: saved });
      assert.equal(await page.locator('#target').inputValue(), expected);
      assert.equal(result.fields.find(item => item.label === label)?.state, "filled", JSON.stringify(result));
      assert.equal(result.fields.find(item => item.label === label)?.canRemember, false);
    }, url);
  });
  for (const [label, expected] of [
    ["Where are you currently based?", "Toronto, ON, Canada"],
    ["Please provide your current location", "Toronto, ON, Canada"],
    ["City / Province / Country", "Toronto, ON, Canada"],
    ["City, Country", "Toronto, Canada"],
    ["Please share your GitHub or personal website URL", contact.githubUrl],
    ["Portfolio / GitHub", contact.portfolioUrl],
    ["A link to your LinkedIn, GitHub, portfolio or similar professional profile or website.", contact.linkedInUrl],
  ]) await test(`composed intent: ${label}`, async () => {
    await fixture(field(label, '<textarea id="target"></textarea>'), async (page, inspect) => {
      await inspect("autofill", { contact });
      assert.equal(await page.locator('#target').inputValue(), expected);
    });
  });
  for (const label of ["Preferred work location", "Where would you like to be based?", "Employer location", "Location of birth",
    "LinkedIn and GitHub", "Describe your GitHub experience", "Reference website", "Relocation preferences"])
    await test(`do not reinterpret: ${label}`, async () => {
      await fixture(field(label), async (page, inspect) => {
        await inspect("autofill", { contact });
        assert.equal(await page.locator('#target').inputValue(), "");
      });
    });
  await test("alternative links cannot fall back to a source the question does not allow", async () => {
    await fixture(field("Portfolio, GitHub, or Personal Site"), async (page, inspect) => {
      await inspect("autofill", { contact: { ...contact, githubUrl: "", portfolioUrl: "", professionalUrl: contact.linkedInUrl } });
      assert.equal(await page.locator('#target').inputValue(), "");
    });
  });
  for (const control of ['<input id="target" type="search">', '<div id="target" role="textbox" aria-label="Location" contenteditable="true" style="min-height:30px"></div>'])
    await test(`semantic facts in ${control.startsWith('<input') ? 'search input' : 'plain-text editable control'}`, async () => {
      await fixture(field("Location", control), async (page, inspect) => {
        const result = await inspect('autofill', { contact });
        assert.equal(await page.locator('#target').evaluate(node => node.value ?? node.textContent), 'Toronto, ON, Canada');
        assert.equal(result.fields.find(item => item.label === 'Location')?.state, 'filled');
        await inspect('autofill-undo');
        assert.equal(await page.locator('#target').evaluate(node => node.value ?? node.textContent), '');
      });
    });
  for (const attributes of ['aria-readonly="true"', 'aria-disabled="true"']) await test(`editable control respects ${attributes}`, async () => {
    await fixture(`<div role="textbox" id="target" aria-label="Location" contenteditable="true" ${attributes} style="min-height:30px"></div>`, async (page, inspect) => {
      await inspect('autofill', { contact });
      assert.equal(await page.locator('#target').textContent(), '');
    });
  });
  for (const control of [
    `<select id="target"><option value="" disabled selected>Select</option>${option("Toronto, Ohio, United States")}${option("Toronto, Ontario, Canada")}</select>`,
    `<input id="target" list="locations"><datalist id="locations">${option("Toronto, Ontario, Canada")}</datalist>`,
  ]) await test(`geographic consistency in ${control.startsWith('<select') ? 'select' : 'datalist'}`, async () => {
    await fixture(field("Location", control), async (page, inspect) => {
      const result = await inspect("autofill", { contact });
      assert.equal(await page.locator('#target').inputValue(), "Toronto, Ontario, Canada");
      assert.equal(result.fields.find(item => item.label === "Location")?.state, "filled");
    });
  });
  for (const options of [["Toronto, Ohio, United States"], ["Toronto, ON, Canada", "Toronto, Ontario, Canada"]])
    await test(`reject incompatible or duplicate geographic choices: ${options.length}`, async () => {
      await fixture(field("Location", `<select id="target"><option value="" disabled selected>Select</option>${options.map(option).join('')}</select>`), async (page, inspect) => {
        await inspect("autofill", { contact });
        assert.equal(await page.locator('#target').inputValue(), "");
      });
    });
  const combo = (binding = "", extra = "") => field("Location", `<input id="target" role="combobox" aria-expanded="false" ${binding}>
    ${extra}<ul id="choices" role="listbox" hidden><li role="option">Toronto, Ontario, Canada</li></ul>`);
  for (const binding of ["", 'aria-controls="choices"']) await test(`custom dropdown readback with ${binding || 'structural ownership'}`, async () => {
    await fixture(combo(binding), async (page, inspect) => {
      await page.evaluate(() => {
        const input = document.querySelector('#target'), list = document.querySelector('#choices');
        input.onclick = () => { input.setAttribute('aria-expanded', 'true'); list.hidden = false; };
        list.firstElementChild.onclick = () => { input.value = list.textContent.trim(); list.hidden = true;
          input.setAttribute('aria-expanded', 'false'); input.dispatchEvent(new Event('change', { bubbles: true })); };
      });
      const result = await inspect("autofill", { contact });
      assert.equal(await page.locator('#target').inputValue(), "Toronto, Ontario, Canada");
      assert.equal(result.fields.find(item => item.label === "Location")?.state, "filled");
    });
  });
  for (const [binding, extra] of [['aria-controls="missing"', ""], ["", '<input aria-label="Unrelated search">']])
    await test(`do not borrow a list when ownership conflicts: ${binding || 'second control'}`, async () => {
      await fixture(combo(binding, extra), async (page, inspect) => {
        await page.evaluate(() => { document.querySelector('#target').onclick = () => {
          document.querySelector('#target').setAttribute('aria-expanded', 'true'); document.querySelector('#choices').hidden = false;
        }; });
        await inspect("autofill", { contact });
        assert.equal(await page.locator('#target').inputValue(), "");
      });
    });
  await test("search text without a committed dropdown choice is never called filled", async () => {
    await fixture(combo(), async (page, inspect) => {
      await page.evaluate(() => { document.querySelector('#target').onclick = () => {
        document.querySelector('#target').setAttribute('aria-expanded', 'true'); document.querySelector('#choices').hidden = false;
      }; });
      const result = await inspect("autofill", { contact });
      assert.equal(await page.locator('#target').inputValue(), "");
      assert.equal(result.fields.find(item => item.label === "Location")?.state, "needed");
    });
  });
  for (const initiallyFilled of [false, true]) await test(`actual user clear survives Autofill and Undo (autofilled=${initiallyFilled})`, async () => {
    await fixture(field("Portfolio, GitHub, or Personal Site"), async (page, inspect) => {
      await inspect(initiallyFilled ? 'autofill' : 'inspect', { contact });
      await page.locator('#target').fill('https://my-site.test');
      await page.locator('#target').fill('');
      const result = await inspect('autofill', { contact });
      assert.equal(await page.locator('#target').inputValue(), '');
      assert.match(result.fields.find(item => item.label.startsWith('Portfolio'))?.reason, /You edited/);
      await inspect('autofill-undo');
      assert.equal(await page.locator('#target').inputValue(), '');
    });
  });
  await test("focus and selection do not prevent Undo of our value", async () => {
    await fixture(field("Portfolio, GitHub, or Personal Site"), async (page, inspect) => {
      await inspect('autofill', { contact });
      await page.locator('#target').click();
      await page.locator('#target').press('Home');
      await page.locator('#target').press('Shift+End');
      await page.locator('#target').press('Tab');
      const result = await inspect();
      assert.equal(result.fields.find(item => item.label.startsWith('Portfolio'))?.state, 'filled');
      await inspect('autofill-undo');
      assert.equal(await page.locator('#target').inputValue(), '');
    });
  });
  for (const [tag, attributes, allowed] of [['div role="form"', '', true], ['form', '', false],
    ['div role="form"', 'type="submit"', false], ['div role="form"', 'form="external-form"', false]]) {
    await test(`pressed choices use actual submit capability (${tag}, ${attributes || 'default type'})`, async () => {
      const label = 'Receive text messages about my application';
      await fixture(`<div><p>${label}</p><div id="choices"><button ${attributes} aria-pressed="false">Yes</button>
        <button ${attributes} aria-pressed="false">No</button></div></div>`, async (page, inspect) => {
        await page.locator('#choices button').evaluateAll(buttons => {
          for (const button of buttons) button.onclick = () => {
            for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
          };
        });
        const result = await inspect('autofill', { commonAnswers: [{ label, answer: 'No', answerKey: 'smsUpdates' }] });
        assert.equal(await page.locator('#choices button[aria-pressed="true"]').count(), allowed ? 1 : 0);
        if (allowed) {
          assert.equal(await page.locator('#choices button[aria-pressed="true"]').textContent(), 'No');
          assert.equal(result.fields.find(item => item.label === label)?.state, 'filled');
        }
      }, undefined, tag);
    });
  }
  console.log(`PASS ${assertions} isolated field-intent scenarios, actual DOM values verified; no applications submitted`);
} finally { await browser.close(); }
