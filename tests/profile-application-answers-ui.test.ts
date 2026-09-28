import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DomUtils, parseDocument } from "htmlparser2";
import { ApplicationAnswersFields } from "../src/components/profile/application-answers-fields";
import { applicationAnswerFields, applicationTextFields, type ProfileApplicationAnswers } from "../src/lib/profile-application-answers";

function render(value: ProfileApplicationAnswers) {
  return parseDocument(renderToStaticMarkup(createElement(ApplicationAnswersFields, { value, onChange: () => {} })));
}

test("optional answer UI exposes every saved value and starts with all choices unset", () => {
  const document = render({ enabled: false, values: {} });
  const labels = DomUtils.getElementsByTagName("label", document.children);
  for (const field of [...applicationAnswerFields, ...applicationTextFields]) {
    assert.ok(labels.some(label => DomUtils.textContent(label).includes(field.label)), field.key);
  }
  const checkboxes = DomUtils.getElementsByTagName("input", document.children).filter(input => input.attribs.type === "checkbox");
  assert.equal(checkboxes.length, 1);
  assert.equal(checkboxes[0].attribs.checked, undefined);
  const selects = DomUtils.getElementsByTagName("select", document.children);
  assert.equal(selects.length, applicationAnswerFields.length);
  for (const select of selects) {
    const selected = DomUtils.getElementsByTagName("option", select.children).filter(option => Object.hasOwn(option.attribs, "selected"));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].attribs.value, "");
    assert.equal(DomUtils.textContent(selected[0]), "Not provided");
  }
});

test("UI retains independent saved consent values and exact commute rows", () => {
  const values = { smsUpdates: "No", emailUpdates: "Yes", talentCommunity: "Yes", jobAlerts: "No", careerNewsletters: "No", noticePeriod: "2 weeks" };
  const document = render({ enabled: true, values, commutes: [{ location: "Toronto, ON, CA", willingness: "Yes" }, { location: "New York, NY, US" }] });
  const labels = DomUtils.getElementsByTagName("label", document.children);
  for (const [key, value] of Object.entries(values)) {
    const field = [...applicationAnswerFields, ...applicationTextFields].find(field => field.key === key)!;
    const label = labels.find(label => DomUtils.textContent(label).includes(field.label))!;
    const select = DomUtils.getElementsByTagName("select", label.children)[0];
    if (select) {
      const selected = DomUtils.getElementsByTagName("option", select.children).find(option => Object.hasOwn(option.attribs, "selected"))!;
      assert.equal(selected.attribs.value ?? DomUtils.textContent(selected), value, key);
    } else assert.equal(DomUtils.getElementsByTagName("input", label.children)[0].attribs.value, value, key);
  }
  const commuteLabels = labels.filter(label => DomUtils.textContent(label).includes("Commute location (city"));
  assert.deepEqual(commuteLabels.map(label => DomUtils.getElementsByTagName("input", label.children)[0].attribs.value), ["Toronto, ON, CA", "New York, NY, US"]);
  const willingness = labels.filter(label => DomUtils.textContent(label).includes("Willing and able to regularly commute"));
  assert.deepEqual(willingness.map(label => DomUtils.textContent(DomUtils.getElementsByTagName("option", label.children).find(option => Object.hasOwn(option.attribs, "selected"))!)), ["Yes", "Not provided"]);
  const removeButtons = DomUtils.getElementsByTagName("button", document.children).filter(button => button.attribs["aria-label"]?.startsWith("Remove commute location"));
  assert.equal(removeButtons.length, 2);
});

test("commute row count is bounded by the shared schema limit in the UI", () => {
  const document = render({ enabled: false, values: {}, commutes: Array.from({ length: 12 }, () => ({ location: "" })) });
  const add = DomUtils.getElementsByTagName("button", document.children).find(button => DomUtils.textContent(button).includes("Add commute location"))!;
  assert.equal(Object.hasOwn(add.attribs, "disabled"), true);
});

test("commute UI gives usable examples and associates invalid locations with inline errors", () => {
  const document = render({ enabled: true, values: {}, commutes: [{ location: "Toronto", willingness: "Yes" }, { location: "Toronto, Ontario, Canada", willingness: "No" }, { location: "" }] });
  const inputs = DomUtils.getElementsByTagName("input", document.children).filter(input => input.attribs.placeholder === "Toronto, Ontario, Canada");
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].attribs["aria-invalid"], "true");
  const error = DomUtils.getElementById(inputs[0].attribs["aria-describedby"], document.children)!;
  assert.match(DomUtils.textContent(error), /one city.*Canada or United States/);
  for (const input of inputs.slice(1)) assert.equal(input.attribs["aria-invalid"], undefined);
});

test("profile form preserves invalid optional-answer drafts until server-side save validation", () => {
  const form = readFileSync(new URL("../src/components/profile/profile-form.tsx", import.meta.url), "utf8");
  assert.match(form, /<ApplicationAnswersFields value=\{contact\.applicationAnswers \?\?/);
  assert.doesNotMatch(form, /normalizeApplicationAnswers\(contact\.applicationAnswers\)/);
  assert.match(form, /applicationAnswers: contact\.applicationAnswers/);
  const action = readFileSync(new URL("../src/app/profile/actions.ts", import.meta.url), "utf8");
  assert.match(action, /!profileApplicationAnswersSchema\.safeParse\(rawContact\.applicationAnswers\)\.success/);
});
