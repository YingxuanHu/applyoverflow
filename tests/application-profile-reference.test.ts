import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileReference } from "../src/components/applications/profile-reference";
import { buildApplicationProfileReference } from "../src/lib/application-profile-reference";

test("application reference preserves factual values, repeated roles and date precision", () => {
  const reference = buildApplicationProfileReference({
    contactJson: { givenName: "Ada", country: "CA", city: "Toronto", workAuthorization: "private", password: "private" },
    experiencesJson: [
      { title: "Analyst", company: "Example", time: "legacy dates", dates: { start: "2020", end: "2021", current: false }, description: "Reviewed reports." },
      { title: "Analyst", company: "Example", time: "", dates: { start: "2024-03", end: "", current: true } },
      { title: "Researcher", time: "Summer 2018" },
    ],
    educationsJson: [{ school: "Example University", degree: "BA", time: "2016 - 2020" }],
  });
  assert.deepEqual(reference.contact, [{ label: "Given name", value: "Ada" }, { label: "City", value: "Toronto" }, { label: "Country", value: "Canada" }]);
  assert.equal(reference.experience.length, 3);
  assert.equal(reference.experience[0].fields.find(f => f.label === "Start date")?.value, "2020");
  assert.equal(reference.experience[1].fields.find(f => f.label === "End date")?.value, "Present");
  assert.equal(reference.experience[2].dates, "Summer 2018");
  assert.equal(reference.education[0].fields.find(f => f.label === "Dates")?.value, "2016 - 2020");
  assert.equal(JSON.stringify(reference).includes("private"), false);
  assert.equal(JSON.stringify(reference).includes("2020-01"), false);
});

test("reference omits unknowns and bounds malformed profile data", () => {
  assert.deepEqual(buildApplicationProfileReference(null), { contact: [], experience: [], education: [] });
  const reference = buildApplicationProfileReference({
    contactJson: { email: false },
    experiencesJson: [null, {}, ...Array.from({ length: 30 }, () => ({ title: "A", description: "x".repeat(5000) }))],
    educationsJson: "not an array",
  });
  assert.equal(reference.experience.length, 25);
  assert.equal(reference.experience[0].fields.find(f => f.label === "Description")?.value.length, 3000);
  assert.deepEqual(reference.contact, []);
  assert.deepEqual(reference.education, []);
});

test("profile reference text is server rendered but script-dependent actions wait for hydration", () => {
  const html = renderToStaticMarkup(createElement(ProfileReference, {
    reference: { contact: [{ label: "Email", value: "fixture@example.test" }], experience: [], education: [] },
  }));
  assert.match(html, /fixture@example\.test/);
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  const tabs = buttons.filter(button => button.includes('role="tab"'));
  assert.equal(tabs.length, 3);
  for (const button of tabs) assert.match(button, /disabled=""|aria-disabled="true"/);
  const copy = buttons.find(button => button.includes('aria-label="Copy email"'));
  assert.ok(copy);
  assert.match(copy, /disabled=""|aria-disabled="true"/);
});
