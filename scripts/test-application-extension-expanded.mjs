import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector.toString()})(${applicationContext.toString()}, (${createHistoryInspector.toString()})())`;
const urls = {
  workday:
    "https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Analyst_R123/apply/myInformation",
  icims: "https://careers-fixture.icims.com/jobs/123/analyst/job?mode=apply",
  generic: "https://careers.fixture.example/application/123",
};
const html = (provider, extra = "") => {
  const contact =
    provider === "workday"
      ? '<label>First name<input data-automation-id="legalNameSection_firstName" id="first"></label><label>Last name<input data-automation-id="legalNameSection_lastName" id="last"></label><label>Email<input data-automation-id="email" id="email" type="email"></label>'
      : provider === "icims"
        ? '<label>First name<input name="PersonProfileFields.FirstName" id="first"></label><label>Last name<input name="PersonProfileFields.LastName" id="last"></label><label>Email<input name="PersonProfileFields.Email" id="email" type="email"></label>'
        : '<label>First name<input autocomplete="given-name" id="first"></label><label>Last name<input autocomplete="family-name" id="last"></label><label>Email<input autocomplete="email" id="email" type="email"></label>';
  return `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Analyst application</title><style>body{font:16px system-ui;margin:24px;max-width:640px}label{display:block;margin:10px 0}input,textarea,select{display:block;padding:8px;max-width:100%}fieldset{margin:20px 0}</style><h1>Analyst application</h1><form>${contact}${extra}<fieldset><legend>Reference details</legend><label>Email<input autocomplete="email" id="reference"></label></fieldset><label>Employee referral<input id="referral" autocomplete="given-name"></label><button type="button">Next</button><button>Submit</button></form><script>window.clicks=0;document.addEventListener('submit',e=>e.preventDefault());document.addEventListener('click',e=>{if(e.target.tagName==='BUTTON')window.clicks++})</script></html>`;
};
const work =
  '<fieldset id="work"><legend>Work experience 1</legend><label>Job title<input id="title"></label><label>Company<input id="company"></label><label>Start date<input id="start" type="month"></label><label>End date<input id="end" type="month"></label><label>Role description<textarea id="description"></textarea></label></fieldset>';
const education =
  '<fieldset id="education"><legend>Education</legend><label>School<input id="school"></label><label>Degree<select id="degree"><option value="">Choose</option><option value="bsc">Bachelor of Science</option><option value="msc">Master of Science</option></select></label><label>Start year<input id="startYear" type="number"></label><label>End year<input id="endYear" type="number"></label></fieldset>';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  let fixture;
  await page.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  const load = async (provider, extra = "") => {
    fixture = html(provider, extra);
    await page.goto(urls[provider]);
    await page.evaluate((code) => {
      window.inspect = (0, eval)(code);
    }, source);
  };
  const inspect = (mode = "inspect", payload = {}) =>
    page.evaluate(
      async ({ mode, payload }) => window.inspect(mode, payload, location.href),
      { mode, payload },
    );
  for (const provider of Object.keys(urls)) {
    await load(provider);
    const scan = await inspect();
    assert.equal(scan.available, 3, provider);
    const result = await inspect("fill", {
      givenName: "Jordan",
      familyName: "Example",
      email: "jordan@example.test",
    });
    assert.equal(result.filled, 3, provider);
    assert.equal(await page.locator("#reference").inputValue(), "");
    assert.equal(await page.locator("#referral").inputValue(), "");
    assert.equal((await inspect("fill", { givenName: "Changed" })).filled, 0);
    await page.locator("#last").fill("User edit");
    const undone = await inspect("undo");
    assert.equal(undone.undone, 2);
    assert.equal(await page.locator("#last").inputValue(), "User edit");
    await load(provider, '<label>Password<input type="password"></label>');
    assert.match((await inspect()).error, /single application/);
  }
  // Public Workday applyManually structure observed on Colliers. Only inspect
  // the live form; mutations are exercised on this synthetic copy.
  fixture =
    '<h1>Colliers Careers</h1><h2>Analyst</h2><div data-automation-id="applyFlowPage"><h3>My Information</h3>' +
    [
      ["First Name", "name--legalName--firstName", "legalName--firstName"],
      ["Last Name", "name--legalName--lastName", "legalName--lastName"],
      ["Email", "emailAddress--emailAddress", "emailAddress"],
      ["Address Line 1", "address--addressLine1", "addressLine1"],
      ["City", "address--city", "city"],
      ["Postal Code", "address--postalCode", "postalCode"],
      ["Phone Number", "phoneNumber--phoneNumber", "phoneNumber"],
    ]
      .map(
        ([label, id, name]) =>
          `<label for="${id}">${label}*</label><input id="${id}" name="${name}">`,
      )
      .join("") +
    "</div>";
  await page.goto(urls.workday);
  await page.evaluate((code) => {
    window.inspect = (0, eval)(code);
  }, source);
  assert.equal(
    (await inspect()).available,
    7,
    "live-observed Workday identifiers are detected",
  );
  assert.equal(
    (
      await inspect("fill", {
        givenName: "Jordan",
        familyName: "Example",
        email: "synthetic@example.test",
        streetAddress: "123 Example",
        city: "Toronto",
        postalCode: "M5V 1A1",
        phone: "4165550100",
      })
    ).filled,
    7,
  );
  await load("generic");
  await page
    .locator("#first")
    .evaluate((field) => field.removeAttribute("autocomplete"));
  assert.equal(
    (await inspect()).available,
    2,
    "generic labels alone do not establish applicant identity",
  );
  const selected = {
    kind: "experience",
    entry: {
      title: "Analyst",
      company: "Example",
      description: "Reviewed profile text",
      dates: { start: "2021-06", end: "2023-08", current: false },
    },
  };
  for (const provider of Object.keys(urls)) {
    await load(provider, work + education);
    assert.equal((await inspect()).historyAvailable, true);
    assert.equal((await inspect("fill-history", selected)).filled, 5);
    assert.equal(await page.locator("#start").inputValue(), "2021-06");
    assert.match(
      (await inspect("fill-history", selected)).error,
      /already be present/,
    );
    await page.locator("#company").fill("User correction");
    assert.equal((await inspect("undo-history")).undone, 4);
    assert.equal(
      await page.locator("#company").inputValue(),
      "User correction",
    );
    assert.match((await inspect("fill-history", selected)).error, /empty work/);
    const educationResult = await inspect("fill-history", {
      kind: "education",
      entry: {
        school: "Example University",
        degree: "Bachelor of Science",
        dates: { start: "2017", end: "2021", current: false },
      },
    });
    assert.equal(
      educationResult.filled,
      4,
      JSON.stringify({
        provider,
        educationResult,
        values: await page
          .locator("#education input,#education select")
          .evaluateAll((fields) =>
            fields.map((field) => ({
              id: field.id,
              value: field.value,
              valid: field.validity.valid,
            })),
          ),
      }),
    );
    assert.equal(await page.locator("#degree").inputValue(), "bsc");
    assert.equal(await page.evaluate(() => window.clicks), 0);
  }
  await load("workday", work);
  await inspect("fill-history", {
    ...selected,
    entry: {
      ...selected.entry,
      dates: { start: "2021", end: "", current: true },
    },
  });
  assert.equal(
    await page.locator("#start").inputValue(),
    "",
    "year-only precision never becomes January",
  );
  assert.equal(await page.locator("#end").inputValue(), "");
  await load("workday", work);
  await page
    .locator("#work")
    .evaluate((group) => group.after(group.cloneNode(true)));
  assert.match(
    (await inspect("fill-history", selected)).error,
    /focus the row/,
  );
  await page.locator("#title").nth(1).focus();
  assert.equal((await inspect("fill-history", selected)).filled, 5);
  assert.equal(await page.locator("#title").first().inputValue(), "");
  await load("generic", work);
  await page
    .locator("#work")
    .evaluate((group) =>
      group.insertAdjacentHTML(
        "beforeend",
        '<label>Supervisor<input value="Already entered"></label>',
      ),
    );
  assert.match((await inspect("fill-history", selected)).error, /empty work/);
  await load("workday", work);
  await page
    .locator("#work")
    .evaluate((group) =>
      group.insertAdjacentHTML(
        "beforeend",
        '<label>Currently employed<input type="checkbox" checked></label>',
      ),
    );
  assert.match((await inspect("fill-history", selected)).error, /empty work/);
  await load("workday", work);
  await page
    .locator("#title")
    .evaluate((field) =>
      field.addEventListener("input", () =>
        document.querySelector("#work").remove(),
      ),
    );
  const removed = await inspect("fill-history", selected);
  assert.equal(removed.filled, 0);
  await load("workday", work);
  await page
    .locator("#title")
    .evaluate((field) =>
      field.addEventListener("input", () =>
        history.pushState({}, "", "/different"),
      ),
    );
  const navigated = await inspect("fill-history", selected);
  assert.equal(navigated.filled, 0);
  await load("generic", work + education);
  await page.locator("#degree").evaluate((field) => (field.multiple = true));
  await inspect("fill-history", {
    kind: "education",
    entry: { school: "Example University", degree: "Bachelor of Science" },
  });
  assert.equal(
    await page.locator("#degree").inputValue(),
    "",
    "multiple-selection widgets are never rewritten",
  );
  const customEducation = `<fieldset id="education"><legend>Education</legend>
    <label>School<input id="school"></label><label for="degree">Degree</label>
    <button id="degree" type="button" role="combobox" aria-haspopup="listbox" aria-controls="degrees" aria-expanded="false" value="">Select One</button>
    <div id="degrees" role="listbox" hidden><div role="option" data-value="">Select One</div>
    <div role="option" data-value="bsc">Bachelor of Science</div><div role="option" data-value="msc">Master of Science</div></div></fieldset>
    <script>degree.onclick=()=>{degrees.hidden=!degrees.hidden;degree.setAttribute('aria-expanded',String(!degrees.hidden))};
    degrees.onclick=e=>{if(!e.target.matches('[role=option]'))return;degree.value=e.target.dataset.value;degree.textContent=e.target.textContent;degrees.hidden=true;degree.setAttribute('aria-expanded','false')};</script>`;
  const degreePayload = { kind: "education", entry: { school: "Example University", degree: "Bachelor of Science" } };
  for (const provider of Object.keys(urls)) {
    await load(provider, customEducation);
    assert.equal((await inspect("fill-history", degreePayload)).filled, 2, provider);
    assert.equal(await page.locator("#degree").textContent(), "Bachelor of Science");
    assert.equal((await inspect("undo-history")).undone, 2);
    assert.equal(await page.locator("#degree").textContent(), "Select One");
  }
  for (const mutation of ["ambiguous", "disabled", "unlinked", "multiple", "irreversible", "submit-button"]) {
    await load("generic", customEducation);
    await page.evaluate((mutation) => {
      const list = document.getElementById("degrees");
      if (mutation === "ambiguous") list.append(list.children[1].cloneNode(true));
      if (mutation === "disabled") list.children[1].setAttribute("aria-disabled", "true");
      if (mutation === "unlinked") document.getElementById("degree").removeAttribute("aria-controls");
      if (mutation === "multiple") list.setAttribute("aria-multiselectable", "true");
      if (mutation === "irreversible") list.children[0].setAttribute("aria-disabled", "true");
      if (mutation === "submit-button") document.getElementById("degree").type = "submit";
    }, mutation);
    assert.equal((await inspect("fill-history", degreePayload)).filled, 1, mutation);
    assert.equal(await page.locator("#degree").textContent(), "Select One", mutation);
  }
  await load("generic", customEducation);
  await page.locator("#education").evaluate((group) => group.insertAdjacentHTML("beforeend", '<label>Field of study<button type="button" aria-haspopup="listbox" value="existing">Already selected</button></label>'));
  assert.match((await inspect("fill-history", degreePayload)).error, /empty work/);
  assert.equal(await page.locator("#school").inputValue(), "", "a populated custom field makes this an existing row");
  await load("generic", customEducation);
  await inspect("fill-history", degreePayload);
  await page.locator("#degree").click();
  await page.getByRole("option", { name: "Master of Science", exact: true }).click();
  assert.equal((await inspect("undo-history")).undone, 1);
  assert.equal(await page.locator("#degree").textContent(), "Master of Science", "preserve user edits");
  await load("generic", work + education);
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({
    path: "output/playwright/assistant-expanded-mobile.png",
    fullPage: true,
  });
  console.log(
    "PASS: Workday/iCIMS/generic contact, privacy, selected history, native and reversible ARIA selects, disabled/ambiguous/irreversible/submit-button exclusions, user-edit preservation, Undo, dates, DOM/navigation races, mobile, zero Next/Submit clicks",
  );
  // The native popup layout is rendered separately; runtime behavior is covered
  // by the MV3 and backend suites, not this screenshot.
  const popup = await readFile("extensions/chrome/popup.html", "utf8");
  fixture = popup
    .replace('src="icon.png"', `src="data:image/png;base64,${(await readFile("public/brand/applyoverflow-favicon.png")).toString("base64")}"`)
    .replace(
      '<link rel="stylesheet" href="popup.css" />',
      `<style>${await readFile("extensions/chrome/popup.css", "utf8")}</style>`,
    )
    .replace('<script type="module" src="popup.mjs"></script>', "");
  await page.goto("https://fixture.example/popup");
  await page.evaluate(() => {
    document.querySelector("#actions").hidden = false;
    document.querySelector("#connect").hidden = true;
    document.querySelector("#status").textContent = "Ready";
    document.querySelector("#more-actions").open = true;
  });
  await page.screenshot({
    path: "output/playwright/assistant-expanded-popup-layout.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
