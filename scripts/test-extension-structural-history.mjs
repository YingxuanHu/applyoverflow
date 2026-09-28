import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtimePath ? `${await readFile(runtimePath, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` : `window.inspect=${source};`;
const history = [
  { kind: "education", entry: { school: "University of Waterloo, School of Computer Science", fieldOfStudy: "Computer Science" } },
  { kind: "education", entry: { school: "University of Toronto", fieldOfStudy: "Computer Engineering" } },
];
const browser = await chromium.launch();
try {
  async function fixture(config, run) {
    const page = await browser.newPage();
    try {
      const ashby = config.provider === "ashby";
      const url = ashby ? "https://jobs.ashbyhq.com/example/00000000-0000-4000-8000-000000000000/application" : "https://careers.example.test/jobs/engineer/apply";
      const tag = ashby ? "div" : "form";
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<h1>Job application</h1>
        <${tag} class="ashby-application-form-container" id="application">
        <label>Name<input aria-label="Full name"></label><label>Email<input type="email"></label>
        <div id="education"><label>Education History*</label><div id="rows"></div><button ${config.unsafeAdd || ashby ? "" : 'type="button"'} id="add">+ Add Education</button></div>
        <div><label>What is your graduation date?<input type="date" id="graduation" value="2026-09-01"></label></div>
        <div><div><p>Would you like to receive text messages about your application?</p></div><div>
        <label><input type="radio" name="sms" value="yes">Yes - I consent to receiving text messages</label>
        <label><input type="radio" name="sms" value="no">No - I do not consent to receiving text messages</label></div></div>
        <button type="submit">Submit application</button></${tag}>` }));
      await page.goto(url);
      await page.evaluate(config => {
        window.adds = 0; window.submissions = 0;
        document.addEventListener("submit", event => { event.preventDefault(); window.submissions++; });
        function row() {
          const root = document.createElement("div"); root.className = "record";
          root.innerHTML = '<div><span>Education</span><button type="button" disabled>Delete</button></div><div class="values"><div><label>School*</label><div><input placeholder="Search schools..." role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false"><button type="button" aria-label="Open schools"></button></div></div><div><label>Field of Study<input placeholder="e.g. Computer Science"></label></div></div>';
          const input = root.querySelector('[role="combobox"]');
          const list = document.createElement("div"); list.id = `schools-${document.querySelectorAll('.record').length}`;
          list.setAttribute("role", "listbox"); list.hidden = true; document.body.append(list);
          input.oninput = () => {
            input.setAttribute("aria-controls", list.id); input.setAttribute("aria-expanded", "true");
            list.hidden = false; list.replaceChildren(); list.setAttribute("aria-busy", "true");
            setTimeout(() => {
              const names = config.duplicate ? ["University of Waterloo", "University of Waterloo"] : ["University of Waterloo", "University of Toronto"];
              for (const name of names) {
                const option = document.createElement("div"); option.setAttribute("role", "option");
                option.innerHTML = `<div><div><span>${name}</span><span>${config.campus ? 'Scarborough campus' : config.country || 'Canada'}</span></div><span>university.example</span></div>`;
                option.onclick = () => {
                  if (config.reject) return;
                  input.value = name; input.setAttribute("aria-expanded", "false"); list.hidden = true;
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                };
                list.append(option);
              }
              list.setAttribute("aria-busy", "false");
            }, config.delayed ? 650 : 0);
          };
          input.onkeydown = event => { if (event.key === "Escape") { list.hidden = true; input.setAttribute("aria-expanded", "false"); } };
          document.querySelector("#rows").append(root);
        }
        row(); document.querySelector("#add").onclick = () => { window.adds++; row(); };
      }, config);
      await page.evaluate(source => { (0, eval)(source); }, installer);
      const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
      await run(page, inspect);
      assert.equal(await page.evaluate(() => window.submissions), 0);
    } finally { await page.close(); }
  }

  for (const provider of ["ashby", "generic"]) await test(`${provider}: structural records fill both schools and majors, with lazy rich options`, async () => {
    await fixture({ provider, delayed: true }, async (page, inspect) => {
      assert.equal((await inspect()).historyAvailable, true);
      const result = await inspect("autofill", { history });
      assert.equal(result.historyFilled, 4, JSON.stringify(result.historyWarnings));
      assert.equal(await page.evaluate(() => window.adds), 1);
      assert.deepEqual(await page.locator('.record input[role="combobox"]').evaluateAll(nodes => nodes.map(n => n.value)), ["University of Waterloo", "University of Toronto"]);
      assert.deepEqual(await page.locator('.record input:not([role])').evaluateAll(nodes => nodes.map(n => n.value)), ["Computer Science", "Computer Engineering"]);
      assert.equal(await page.locator('#graduation').inputValue(), "2026-09-01");
      const again = await inspect("autofill", { history });
      assert.equal(again.historyFilled, 0);
      assert.equal(await page.evaluate(() => window.adds), 1, "retry must not add duplicate schools");
      const report = await inspect();
      const sms = report.fields.filter(f => /text messages about your application/.test(f.label));
      assert.equal(sms.length, 1, "options belong to one question");
      assert.equal(sms[0].kind, "radio");
      await inspect("autofill", { commonAnswers: [{ label: sms[0].label, answerKey: "smsUpdates", answer: "No", alternatives: ["No - I do not consent to receiving text messages"] }] });
      assert.equal(await page.locator('input[name="sms"]:checked').getAttribute("value"), "no");
      assert.equal((await inspect()).fields.find(f => f.label === sms[0].label).state, "filled");
    });
  });
  for (const name of ["duplicate", "campus", "reject"]) await test(`school selection rejects ${name} without reporting a successful school write`, async () => {
    await fixture({ [name]: true }, async (page, inspect) => {
      const result = await inspect("autofill", { history: [history[0]] });
      assert.equal(await page.locator('[role="combobox"]').inputValue(), "", JSON.stringify(result));
      assert.equal(result.historyFilled, 1, "only the independent major is filled");
      assert.ok(result.historyWarnings.length);
      assert.equal(await page.evaluate(() => window.adds), 0);
    });
  });
  await test("rich school metadata supports internationally educated applicants", async () => {
    for (const country of ["India", "China", "France", "Brazil"]) await fixture({ country }, async (page, inspect) => {
      assert.equal((await inspect("autofill", { history: [history[0]] })).historyFilled, 2, country);
      assert.equal(await page.locator('[role="combobox"]').inputValue(), "University of Waterloo");
    });
  });
  await test("a missing button type inside a real form cannot be used to add history", async () => {
    await fixture({ unsafeAdd: true }, async (page, inspect) => {
      await inspect("autofill", { history });
      assert.equal(await page.evaluate(() => window.adds), 0);
      assert.equal(await page.locator('.record').count(), 1);
    });
  });
  await test("existing user-selected radio and education values are preserved", async () => {
    await fixture({}, async (page, inspect) => {
      await page.locator('input[name="sms"][value="yes"]').check();
      await page.locator('.record input:not([role])').fill("User's chosen major");
      await inspect("autofill", { history, commonAnswers: [{ label: "Would you like to receive text messages about your application?", answerKey: "smsUpdates", answer: "No" }] });
      assert.equal(await page.locator('input[name="sms"]:checked').getAttribute("value"), "yes");
      assert.equal(await page.locator('.record input:not([role])').inputValue(), "User's chosen major");
      assert.equal(await page.evaluate(() => window.adds), 0);
    });
  });
  await test("structural work rows retain sibling dates beyond the inner identity wrapper", async () => {
    await fixture({}, async (page, inspect) => {
      await page.locator('#education').evaluate(node => {
        node.innerHTML = '<h3>Work experience</h3><div><div><label>Job title<input></label><label>Company<input></label></div><div><label>Start date<input type="date" required></label><label>End date<input type="date"></label></div></div><button type="button">Add experience</button>';
      });
      const result = await inspect("autofill", { history: [{ kind: "experience", entry: { title: "Engineer", company: "Example", dates: { start: "2024-01", end: "2024-08", current: false } } }] });
      assert.equal(result.historyFilled, 4, JSON.stringify(result));
      assert.deepEqual(await page.locator('#education input').evaluateAll(nodes => nodes.map(n => n.value)), ["Engineer", "Example", "2024-01-01", "2024-08-31"]);
      assert.equal(await page.locator('#graduation').inputValue(), "2026-09-01");
    });
  });
} finally { await browser.close(); }
