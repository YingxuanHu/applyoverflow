import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";

let browser, page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route("**/*", route => route.abort());
});
after(async () => { await browser?.close(); });

const degrees = ["Bachelor's Degree", "Master's Degree", "Doctorate"];
const entry = (school, degree) => ({ kind: "education", automatic: true, entry: { school, degree } });
async function load(config = {}) {
  // about:blank only: no ATS, profile, API, extension UI or network access.
  await page.setContent('<form><section aria-label="Education" class="education--container"><button type="button">Add education</button></section><button type="submit">Submit</button></form>');
  await page.evaluate(({ config, degrees }) => {
    window.adds = 0; window.submissions = 0;
    const section = document.querySelector("section");
    const add = section.querySelector("button");
    document.querySelector("form").onsubmit = event => { event.preventDefault(); window.submissions++; };
    function appendRow(existing = {}) {
      const index = section.querySelectorAll("article").length;
      const row = document.createElement("article");
      row.className = "education--form";
      row.setAttribute("aria-label", `Education ${index + 1}`);
      if (!config.degreeOnly) {
        const label = document.createElement("label"); label.textContent = "School";
        const school = document.createElement("input"); school.setAttribute("aria-label", "School");
        school.value = existing.school || ""; school.required = true;
        label.append(school); row.append(label);
      }
      const wrapper = document.createElement("div");
      if (config.nestedDegree) wrapper.className = "education--form";
      row.append(wrapper);
      if (config.custom) {
        const container = document.createElement("div"); container.className = "select__value-container";
        const field = document.createElement("input"); field.setAttribute("role", "combobox");
        field.setAttribute("aria-label", "Degree"); field.setAttribute("aria-required", "true");
        field.setAttribute("aria-expanded", "false");
        const list = document.createElement("div"); list.id = `degrees-${index}`; list.setAttribute("role", "listbox"); list.hidden = true;
        field.setAttribute("aria-controls", list.id);
        const select = text => {
          container.querySelector(".select__single-value")?.remove();
          if (text) {
            const value = document.createElement("div"); value.className = "select__single-value"; value.textContent = text;
            container.prepend(value);
          }
          field.value = ""; field.setAttribute("aria-expanded", "false"); list.hidden = true;
          field.dispatchEvent(new Event("change", { bubbles: true }));
        };
        field.onclick = () => { list.hidden = false; field.setAttribute("aria-expanded", "true"); };
        field.onkeydown = event => { if (event.key === "Escape") { list.hidden = true; field.setAttribute("aria-expanded", "false"); } };
        for (const text of config.options || degrees) {
          const option = document.createElement("div"); option.setAttribute("role", "option"); option.textContent = text;
          option.onclick = () => { option.setAttribute("aria-selected", "true"); select(text); };
          list.append(option);
        }
        container.append(field); wrapper.append(container); document.body.append(list);
        select(existing.degree || "");
      } else {
        const field = document.createElement("select"); field.setAttribute("aria-label", "Degree"); field.required = true;
        field.add(new Option("Select", ""));
        for (const [index, text] of (config.options || degrees).entries()) field.add(new Option(text, String(index + 1)));
        const match = [...field.options].find(option => option.text === existing.degree);
        if (match) field.value = match.value;
        wrapper.append(field);
      }
      section.insertBefore(row, add);
    }
    add.onclick = () => { window.adds++; appendRow(); };
    for (const existing of config.rows || [{}]) appendRow(existing);
  }, { config, degrees });
  await freshInspector();
}
const freshInspector = () => page.evaluate(source => {
  window.inspectHistory = (0, eval)(`(${source})`)();
}, createHistoryInspector.toString());
const fill = payload => page.evaluate(payload => window.inspectHistory("fill-history", payload,
  document.querySelector("form"), field => field.getAttribute("aria-label") || "",
  field => field.isConnected && Boolean(field.getClientRects().length)), payload);
const state = () => page.evaluate(() => ({ adds: window.adds, submissions: window.submissions,
  rows: [...document.querySelectorAll("article")].map(row => {
    const degree = row.querySelector('[aria-label="Degree"]');
    return { school: row.querySelector('[aria-label="School"]')?.value || "",
      degree: degree instanceof HTMLSelectElement ? degree.value ? degree.selectedOptions[0].text : "" : degree.closest(".select__value-container").querySelector(".select__single-value")?.textContent || "" };
  }) }));

for (const custom of [false, true]) {
  const widget = custom ? "React-style combobox" : "native select";
  test(`${widget}: explicit degree levels and abbreviations, without cross-subject inference`, async () => {
    for (const [saved, expected] of [
      ["BASc", "Bachelor's Degree"], ["B.A.Sc.", "Bachelor's Degree"],
      ["MEng", "Master's Degree"], ["M.Eng.", "Master's Degree"], ["MASc", "Master's Degree"],
      ["Bachelor of Applied Science", "Bachelor's Degree"], ["Master of Engineering", "Master's Degree"],
      ["Bachelor of Computer Science & BBA (Finance)", "Bachelor's Degree"],
      ["Master of Engineering, Emphasis in Computer Engineering", "Master's Degree"],
      ["BA / Master of Science", ""], ["Bachelor of Science / MEng", ""], ["Master of Engineering / BASc", ""],
      ["Engineering", ""], ["Graduate certificate", ""], ["MEng candidate", ""],
    ]) {
      await load({ custom });
      const result = await fill(entry("University of Toronto", saved));
      assert.equal((await state()).rows[0].degree, expected, `${widget}: ${saved}; ${JSON.stringify(result)}`);
      assert.equal((await state()).submissions, 0);
    }
  });

  test(`${widget}: four schools and repeated degree levels stay distinct across nested wrappers and reload`, async () => {
    const records = [entry("University of Waterloo", "BASc"), entry("University of Toronto", "MEng"),
      entry("Northbridge University", "BSc"), entry("Southbridge University", "MASc")];
    await load({ custom, nestedDegree: true, rows: [{ degree: "Bachelor's Degree" }] });
    let filled = 0;
    for (const record of records) {
      const result = await fill(record);
      assert.ok(!result.error && !result.warning, JSON.stringify(result));
      filled += result.filled;
    }
    const expected = { adds: 3, submissions: 0, rows: records.map((record, index) => ({ school: record.entry.school, degree: degrees[index % 2] })) };
    assert.equal(filled, 7, "preserve the existing degree and fill exactly the other seven fields");
    assert.deepEqual(await state(), expected);
    await freshInspector();
    for (const record of records) assert.match((await fill(record)).error, /already be present/);
    assert.deepEqual(await state(), expected, "fresh-inspector retries cannot add duplicate rows");
  });

  test(`${widget}: degree alone cannot identify a school; conflicts and ambiguous choices stay untouched`, async () => {
    await load({ custom, degreeOnly: true, rows: [{ degree: "Master's Degree" }] });
    const isolated = await fill(entry("University of Toronto", "MEng"));
    assert.equal(isolated.filled || 0, 0);
    assert.doesNotMatch(isolated.error || isolated.warning || "", /already be present/, "a degree is not a saved school identity");
    assert.equal((await state()).adds, 0, "do not add beside an unidentifiable school-less row");

    await load({ custom, rows: [{ school: "University of Waterloo", degree: "Bachelor's Degree" }, {}] });
    await fill(entry("University of Toronto", "MEng"));
    assert.deepEqual((await state()).rows, [{ school: "University of Waterloo", degree: "Bachelor's Degree" }, { school: "University of Toronto", degree: "Master's Degree" }]);

    await load({ custom, rows: [{ school: "University of Toronto", degree: "Bachelor's Degree" }] });
    const conflict = await fill(entry("University of Toronto", "MEng"));
    assert.equal((await state()).rows[0].degree, "Bachelor's Degree", JSON.stringify(conflict));

    for (const options of [["Master's Degree", "Master's Degree"], ["Master's Degree", "Masters Degree"], ["Master of Science", "Master of Arts"]]) {
      await load({ custom, options });
      await fill(entry("University of Toronto", "MEng"));
      assert.equal((await state()).rows[0].degree, "", `ambiguous or subject-specific options: ${options}`);
      assert.equal((await state()).submissions, 0);
    }
  });

  test(`${widget}: four resume records with two unique school/degree identities create only two rows`, async () => {
    await load({ custom, nestedDegree: true });
    const records = [entry("University of Waterloo", "Bachelor of Computer Science & BBA (Finance)"),
      entry("University of Toronto", "Master of Engineering, Emphasis in Computer Engineering")];
    for (const record of records) assert.equal((await fill(record)).filled, 2);
    for (const record of records) assert.match((await fill(record)).error, /already be present/);
    await freshInspector();
    for (const record of [entry("University of Waterloo", "BCS"), entry("University of Toronto", "MEng")])
      assert.match((await fill(record)).error, /already be present/);
    assert.deepEqual(await state(), { adds: 1, submissions: 0, rows: [
      { school: "University of Waterloo", degree: "Bachelor's Degree" },
      { school: "University of Toronto", degree: "Master's Degree" },
    ] });
  });
}
