import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const education = (school = "Northbridge University - Department of Computer Science") => ({
  kind: "education",
  entry: { school, degree: "Bachelor of Science", fieldOfStudy: "Computer Science", dates: { start: "2016-09", end: "2020-06", current: false } },
});
const experience = (company = "First Company", current = false) => ({
  kind: "experience",
  entry: { title: "Analyst", company, dates: { start: "2020-02", end: current ? "" : "2021-06", current } },
});

// Deliberately no ATS element names, row labels, or provider-specific IDs.
// The server search replaces a portalled listbox after a debounce and request.
function mount(config) {
  window.records = []; window.searches = []; window.adds = 0; window.saves = 0; window.submissions = 0;
  document.querySelector("form").onsubmit = event => { event.preventDefault(); window.submissions++; };
  document.querySelector("#final-save").onclick = () => window.submissions++;
  for (const section of document.querySelectorAll("section")) {
    const kind = section.id;
    const add = section.querySelector("button");
    add.onclick = () => {
      window.adds++;
      add.disabled = !config.inline;
      if (config.badAdd) { add.disabled = false; return; }
      const row = document.createElement(config.rowTag || "article");
      if (config.greenhouse) row.className = "education--form";
      section.insertBefore(row, add);
      let count = 0;
      function input(label, type = "text", required = true) {
        const element = document.createElement("input");
        const wrapper = document.createElement("label");
        wrapper.textContent = label; wrapper.append(element); row.append(wrapper);
        element.id = `${kind}-${window.adds}-${count++}`;
        element.type = type; element.required = required;
        return element;
      }
      if (kind === "education") {
        const school = input("School");
        if (config.native) {
          const schoolLabel = school.parentElement; schoolLabel.htmlFor = school.id;
          const select = document.createElement("select");
          select.id = school.id; select.required = true;
          for (const [value, text] of [["", "Select a school"], ["north", "Northbridge University"], ["south", "Southbridge University"]]) select.add(new Option(text, value));
          if (config.ambiguous) select.add(new Option("Northbridge University", "duplicate"));
          school.replaceWith(select);
          schoolLabel.after(select);
          if (config.rejectNative) select.onchange = () => { select.value = ""; };
        } else {
          school.setAttribute("role", "combobox"); school.setAttribute("aria-autocomplete", "list");
          school.setAttribute("aria-expanded", "false"); school.required = false; school.setAttribute("aria-required", "true");
          const schoolLabel = school.parentElement; schoolLabel.htmlFor = school.id;
          const valueContainer = document.createElement("div"); valueContainer.className = "select__value-container";
          school.replaceWith(valueContainer); valueContainer.append(school);
          schoolLabel.after(valueContainer);
          let generation = 0;
          const listId = `${school.id}-options`;
          const list = () => document.getElementById(listId);
          function open() {
            school.setAttribute("aria-expanded", "true");
            if (!config.unlinked) school.setAttribute("aria-controls", listId);
            if (!list()) {
              const node = document.createElement("div"); node.id = listId; node.setAttribute("role", "listbox");
              document.body.append(node);
            }
            list().hidden = false;
          }
          school.onclick = open;
          school.onkeydown = event => { if (event.key === "Escape") { if (list()) list().hidden = true; school.setAttribute("aria-expanded", "false"); } };
          school.oninput = () => {
            const token = ++generation;
            const query = school.value;
            if (!query) { if (list()) list().replaceChildren(); return; }
            window.searches.push(query); open(); list().setAttribute("aria-busy", "true");
            if (config.change) setTimeout(() => { row.querySelector('input[aria-label="Field of study"]').value = "User correction"; }, 60);
            setTimeout(() => {
              if (generation !== token || !school.isConnected) return;
              const replacement = document.createElement("div"); replacement.id = listId; replacement.setAttribute("role", "listbox");
              if (config.busy) replacement.setAttribute("aria-busy", "true");
              list().replaceWith(replacement);
              const labels = config.campus ? ["Northbridge University - West Campus"] : [query];
              if (config.ambiguous) labels.push(query);
              for (const text of labels) {
                const option = document.createElement("div"); option.setAttribute("role", "option"); option.textContent = text;
                if (config.disabled) option.setAttribute("aria-disabled", "true");
                option.onclick = () => {
                  if (config.noCommit) return;
                  const value = document.createElement("div"); value.className = "select__single-value"; value.textContent = text;
                  valueContainer.prepend(value); school.value = ""; school.setAttribute("aria-expanded", "false");
                  replacement.hidden = true;
                  school.dispatchEvent(new Event("change", { bubbles: true }));
                };
                replacement.append(option);
              }
            }, config.delay || 300);
          };
        }
        const degree = input("Degree");
        const select = document.createElement("select"); select.id = degree.id; select.required = true;
        select.add(new Option("Select", "")); select.add(new Option("Bachelor's Degree", "bachelor"));
        degree.replaceWith(select);
        if (config.partial) select.value = "bachelor";
        input("Field of study").setAttribute("aria-label", "Field of study");
      } else {
        input("Position title"); input("Employer");
        const current = input("I currently work here", "checkbox", false);
        current.onchange = () => { const end = row.querySelector('[data-end]'); end.disabled = current.checked; };
      }
      if (config.splitDates) {
        const group = document.createElement("fieldset"); group.innerHTML = "<legend>Start date</legend>";
        const month = input("Month", "number"); month.min = "1"; month.max = "12";
        const year = input("Year", "number"); year.min = "1900"; year.max = "2100";
        group.append(month.parentElement, year.parentElement); row.append(group);
      } else input("Start date", "date");
      input("End date", "date").setAttribute("data-end", "");
      if (config.consent) input("I agree to the terms", "checkbox");
      if (config.unknownRequired) input("Student identifier");
      if (!config.inline) {
        const footer = document.createElement("footer"); row.append(footer);
        const save = document.createElement("button"); save.type = config.submitSave ? "submit" : "button";
        save.textContent = "Save record"; footer.append(save);
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; footer.append(cancel);
        save.onclick = () => {
          window.saves++;
          if (config.failSave) return;
          const values = [...row.querySelectorAll("input,select")].map(field => field.type === "checkbox" ? field.checked :
            field.closest('.select__value-container')?.querySelector('.select__single-value')?.textContent ||
            (field instanceof HTMLSelectElement ? field.selectedOptions[0].text : field.value));
          setTimeout(() => {
            window.records.push({ kind, values });
            if (!config.noSummary) { const summary = document.createElement("article"); summary.textContent = values.join(" | "); row.after(summary); }
            row.remove(); add.disabled = false;
          }, 50);
        };
      }
    };
  }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let fixture = "";
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
  async function load(config = {}, url = "https://careers.fixture.example/application/123") {
    fixture = `<!doctype html><title>Analyst application</title><h1>Analyst application</h1><form>
      <label>First name<input autocomplete="given-name"></label><label>Last name<input autocomplete="family-name"></label><label>Email<input type="email" autocomplete="email"></label>
      <section id="education" aria-labelledby="education-heading"><header><h2 id="education-heading">Education history</h2></header><button type="button">Add another education</button></section>
      <section id="experience" aria-labelledby="experience-heading"><header><h2 id="experience-heading">Employment history</h2></header><button type="button">Add another experience</button></section>
      <button id="final-save" type="button">Save application</button><button type="submit">Submit application</button></form>
      <script>(${mount})(${JSON.stringify(config)})</script>`;
    await page.goto(url);
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  }
  const fill = history => page.evaluate(history => window.inspect("autofill", { contact: {}, history }, location.href), history);
  const state = () => page.evaluate(() => ({ records: window.records, searches: window.searches, adds: window.adds, saves: window.saves, submissions: window.submissions }));

  for (const rowTag of ["article", "div", "fieldset"]) {
    await load({ rowTag });
    const entries = [experience(), experience("Second Company", true), education(), education("Southbridge University, Cheriton School of Computing")];
    const result = await fill(entries);
    assert.equal(result.historySaved, 4, JSON.stringify({ rowTag, result, state: await state() }));
    const data = await state();
    assert.deepEqual(data.searches, ["Northbridge University", "Southbridge University"]);
    assert.deepEqual(data.records[0].values, ["Analyst", "First Company", false, "2020-02-01", "2021-06-30"]);
    assert.deepEqual(data.records[1].values, ["Analyst", "Second Company", true, "2020-02-01", ""]);
    assert.deepEqual(data.records[2].values, ["Northbridge University", "Bachelor's Degree", "Computer Science", "2016-09-01", "2020-06-30"]);
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
    await fill(entries);
    assert.equal((await state()).records.length, 4, "reload must not duplicate summaries");
    assert.equal((await state()).submissions, 0);
  }
  console.log("PASS generic article/div/fieldset editors, all saved work/education, dates, major, current role, reload deduplication");

  for (const native of [false, true]) {
    await load({ native, inline: true, partial: true });
    await page.locator("#education > button").click();
    const result = await fill([education(), education("Southbridge University (School of Computing)")]);
    assert.equal(result.historyFilled, 8, JSON.stringify(result));
    assert.equal((await state()).adds, 2, "complete existing degree-only row before Add another");
    assert.deepEqual(await page.locator("#education select").evaluateAll(nodes => nodes.filter(n => n.value === "bachelor").map(n => n.value)), ["bachelor", "bachelor"]);
    assert.equal((await state()).submissions, 0);
  }
  console.log("PASS degree-only partial rows with native and async schools, canonical suffixes and Add another");

  // Public Braze DOM: a React Select Degree is already committed but School
  // remains empty. A fresh inspector must resume it without reselecting Degree.
  await load({ inline: true, partial: true, greenhouse: true }, "https://job-boards.greenhouse.io/braze/jobs/8222294");
  await page.locator("#education > button").click();
  await page.locator("#education").evaluate(section => {
    section.className = "education--container"; section.removeAttribute("aria-labelledby"); section.querySelector("header").remove();
    const row = section.querySelector("article"); row.className = "education--form";
    const degree = row.querySelector("select");
    const wrapper = document.createElement("div"); wrapper.className = "select__value-container";
    const selected = document.createElement("div"); selected.className = "select__single-value"; selected.textContent = "Bachelor's Degree";
    const input = document.createElement("input"); input.id = degree.id; input.setAttribute("role", "combobox"); input.setAttribute("aria-expanded", "false");
    const label = document.createElement("label"); label.htmlFor = input.id; label.id = `${input.id}-label`; label.textContent = "Degree";
    input.setAttribute("aria-labelledby", label.id);
    wrapper.append(selected, input); degree.parentElement.replaceWith(label, wrapper);
  });
  const braze = await fill([education(), education("Southbridge University")]);
  assert.equal(braze.historyFilled, 8, JSON.stringify(braze));
  assert.equal((await state()).adds, 2);
  assert.equal(await page.locator(".education--form").first().locator(".select__single-value").first().textContent(), "Northbridge University");
  assert.equal(await page.locator(".education--form").first().locator(".select__single-value").last().textContent(), "Bachelor's Degree");
  assert.equal((await state()).submissions, 0);
  console.log("PASS observed Braze/Greenhouse degree-only React Select row resumes school without changing existing degree");

  await load({ splitDates: true });
  assert.equal((await fill([education()])).historySaved, 1);
  assert.deepEqual((await state()).records[0].values.slice(-3), ["09", "2016", "2020-06-30"]);
  console.log("PASS structurally scoped split month/year date controls");

  for (const failure of ["ambiguous", "campus", "disabled", "unlinked", "noCommit", "busy", "change", "failSave", "noSummary", "consent", "unknownRequired", "submitSave", "badAdd"]) {
    await load({ [failure]: true });
    const result = await fill([education(), education("Southbridge University")]);
    const data = await state();
    assert.equal(result.historySaved, 0, `${failure}: ${JSON.stringify(result)}`);
    assert.equal(data.adds, 1, `${failure}: blocked record must not Add another`);
    assert.equal(data.submissions, 0, failure);
    assert.equal(data.saves, ["failSave", "noSummary"].includes(failure) ? 1 : 0, `${failure}: no unsafe Save`);
    if (failure === "change") assert.equal(await page.getByLabel("Field of study").inputValue(), "User correction");
    if (["ambiguous", "campus", "disabled", "unlinked", "noCommit", "busy"].includes(failure)) {
      assert.equal(await page.getByLabel("School", { exact: true }).inputValue(), "", `${failure}: search text is not a selection`);
    }
  }
  console.log("PASS ambiguity, wrong campus, disabled/unlinked/busy search, rejected selection, mid-search edits, failed Save, consent and submit safety");

  for (const failure of ["ambiguous", "rejectNative"]) {
    await load({ native: true, [failure]: true });
    const result = await fill([education(), education("Southbridge University")]);
    assert.equal(result.historySaved, 0, failure);
    assert.equal((await state()).adds, 1, failure);
    assert.equal(await page.getByLabel("School", { exact: true }).inputValue(), "");
  }
  for (const missing of ["fieldOfStudy", "start", "end"]) {
    await load();
    const entry = education();
    if (missing === "fieldOfStudy") delete entry.entry.fieldOfStudy;
    else entry.entry.dates[missing] = "2020";
    const result = await fill([entry, education("Southbridge University")]);
    assert.equal(result.historySaved, 0, missing);
    assert.equal((await state()).adds, 1, missing);
    assert.match(result.historyWarnings.join(" "), /missing|month|incomplete|review/i);
  }
  console.log("PASS native duplicate/rejected choices and required major/date precision block Save/Add");

  await load({ inline: true, partial: true });
  await page.locator("#education > button").click();
  await page.getByLabel("Field of study").fill("User-selected subject");
  const conflict = await fill([education()]);
  assert.equal(conflict.historyFilled, 0);
  assert.equal(await page.getByLabel("Field of study").inputValue(), "User-selected subject");
  assert.equal((await state()).adds, 1);
  console.log("PASS pre-existing conflicting user data blocks partial-row recovery without overwrite or Add");
} finally {
  await browser.close();
}
