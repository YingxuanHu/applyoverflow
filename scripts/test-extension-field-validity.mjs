import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createFieldValidity } from "../extensions/chrome/field-validity.mjs";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Exact public pattern observed on the Achievers/Lever application. Its unescaped
// braces and hyphen are invalid under HTML's Unicode Sets (v) regex grammar.
const leverPattern = "[a-zA-Z0-9.#$%&'*+\\/=?^_`{|}~][a-zA-Z0-9.!#$%&'*+\\/=?^_`{|}~-]*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*";
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const runtime = runtimePath ? await readFile(runtimePath, "utf8") :
  `globalThis.__applyOverflowInspect=(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})());`;
const browser = await chromium.launch();
try {
  async function fixture(markup, run) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><h1>Job application</h1>${markup}` }));
      await page.goto("https://jobs.lever.co/fixture/00000000-0000-4000-8000-000000000000/apply");
      await page.evaluate(source => { window.fieldValid = (0, eval)(source)(); }, `(${createFieldValidity})`);
      await run(page, errors);
    } finally { await page.close(); }
  }

  await test("reproduce the employer pattern diagnostic from native validity.valid", async () => {
    await fixture('<input id="email" type="email">', async (page, errors) => {
      await page.evaluate(pattern => {
        const field = document.querySelector('input'); field.value = 'fixture@example.test'; field.pattern = pattern;
        window.nativeResult = field.validity.valid;
      }, leverPattern);
      assert.equal(await page.evaluate(() => window.nativeResult), true, "HTML does not enforce malformed patterns");
      assert.ok(errors.some(message => /not a valid regular expression|Invalid regular expression/i.test(message)), JSON.stringify(errors));
    });
  });

  await test("malformed patterns stay untouched and all other native constraints still apply", async () => {
    await fixture('<input id="target">', async (page, errors) => {
      for (const [attrs, value, customError, expected] of [
        [{ type: "email", pattern: leverPattern, required: "" }, "fixture@example.test", "", true],
        [{ type: "email", pattern: leverPattern, required: "" }, "not-an-email", "", false],
        [{ type: "email", pattern: leverPattern, required: "" }, "", "", false],
        [{ type: "email", pattern: leverPattern }, "fixture@example.test", "Employer rejected this email", false],
        [{ type: "text", pattern: "[a-z-]+" }, "example", "", true],
        [{ type: "text", pattern: "[A-Z]+" }, "example", "", false],
        [{ type: "text", pattern: "[A-Z]+" }, "EXAMPLE", "", true],
        [{ type: "text", pattern: "[\\p{Letter}&&\\p{ASCII}]+" }, "Example", "", true],
        [{ type: "text", pattern: "[\\p{Letter}&&\\p{ASCII}]+" }, "123", "", false],
        [{ type: "text", pattern: "" }, "example", "", false],
        [{ type: "number", min: "2", max: "10", step: "2" }, "1", "", false],
        [{ type: "number", min: "2", max: "10", step: "2" }, "12", "", false],
        [{ type: "number", min: "2", max: "10", step: "2" }, "3", "", false],
        [{ type: "number", min: "2", max: "10", step: "2" }, "4", "", true],
      ]) {
        const actual = await page.evaluate(({ attrs, value, customError }) => {
          const field = document.querySelector('input');
          for (const attribute of [...field.attributes]) if (attribute.name !== 'id') field.removeAttribute(attribute.name);
          for (const [name, value] of Object.entries(attrs)) field.setAttribute(name, value);
          field.value = value; field.setCustomValidity(customError);
          const before = field.outerHTML;
          const observer = new MutationObserver(() => {}); observer.observe(field, { attributes: true });
          const valid = window.fieldValid(field);
          const mutations = observer.takeRecords().length; observer.disconnect();
          return { valid, unchanged: field.outerHTML === before, mutations };
        }, { attrs, value, customError });
        assert.deepEqual(actual, { valid: expected, unchanged: true, mutations: 0 }, JSON.stringify({ attrs, value }));
      }
      assert.deepEqual(errors, []);
    });
  });

  await test("user-entered length and bad-input errors are not lost through a cloned field", async () => {
    await fixture('<input id="short" minlength="3"><input id="long" maxlength="5"><input id="number" type="number">', async (page, errors) => {
      await page.evaluate(() => { for (const id of ['short', 'long']) document.getElementById(id).pattern = '[a-z-]+'; });
      await page.locator('#short').pressSequentially('a');
      await page.locator('#long').pressSequentially('abcde');
      await page.evaluate(() => { document.getElementById('long').maxLength = 3; });
      await page.locator('#number').pressSequentially('-');
      assert.deepEqual(await page.evaluate(() => ['short', 'long', 'number'].map(id => window.fieldValid(document.getElementById(id)))), [false, false, false]);
      assert.deepEqual(errors, []);
    });
  });

  await test("a throwing validity getter is isolated and custom controls remain supported", async () => {
    await fixture('<input id="broken"><input id="healthy"><div role="combobox" id="custom"></div>', async (page, errors) => {
      assert.deepEqual(await page.evaluate(() => {
        Object.defineProperty(document.getElementById('broken'), 'validity', { get() { throw new Error('Broken getter'); } });
        return ['broken', 'healthy', 'custom'].map(id => window.fieldValid(document.getElementById(id)));
      }), [false, true, true]);
      assert.deepEqual(errors, []);
    });
  });

  for (const rejected of [false, true]) await test(`autofill ${rejected ? "rejects real email errors without aborting other fields" : "fills and inspects the Lever email without regex diagnostics"}`, async () => {
    await fixture('<form><label for="email">Email</label><input id="email" type="email" required><label for="phone">Phone</label><input id="phone" type="tel"><button type="submit">Submit application</button></form>', async (page, errors) => {
      await page.evaluate(({ runtime, pattern, rejected }) => {
        document.getElementById('email').pattern = pattern;
        if (rejected) document.getElementById('email').setCustomValidity('Email rejected');
        window.submissions = 0;
        document.querySelector('form').onsubmit = event => { event.preventDefault(); window.submissions++; };
        (0, eval)(runtime);
      }, { runtime, pattern: leverPattern, rejected });
      const result = await page.evaluate(() => window.__applyOverflowInspect('autofill', { contact: { email: 'fixture@example.test', phone: '4165550100' } }, location.href));
      assert.equal(result.error, undefined);
      assert.equal(await page.locator('#email').inputValue(), rejected ? '' : 'fixture@example.test');
      assert.equal(await page.locator('#phone').inputValue(), '4165550100');
      assert.equal(result.fields.find(field => field.profileKey === 'email')?.state, rejected ? 'needed' : 'filled');
      await page.evaluate(() => window.__applyOverflowInspect('inspect', {}, location.href));
      assert.equal(await page.locator('#email').getAttribute('pattern'), leverPattern);
      assert.equal(await page.evaluate(() => window.submissions), 0);
      assert.deepEqual(errors, []);
    });
  });
} finally { await browser.close(); }
