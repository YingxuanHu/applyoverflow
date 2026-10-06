import assert from "node:assert/strict";
import { test } from "node:test";
import { oracleKey, oracleMatches } from "../scripts/lib/autofill-benchmark-oracle.mjs";

test("benchmark oracle includes Unicode required markers but excludes declarations", () => {
  assert.equal(oracleKey({ label: "Full name\u2731" }), "fullName");
  assert.equal(oracleKey({ label: "Email\u2731" }), "email");
  assert.equal(oracleKey({ label: "Name", name: "eeo[disabilitySignature]" }), undefined);
  assert.equal(oracleKey({ label: "Name", context: "Voluntary self-identification of disability" }), undefined);
  assert.equal(oracleKey({ label: "Email", context: "Reference details" }), undefined);
});

test("benchmark oracle requires the correct city geography and phone identity", () => {
  const contact = { city: "Richmond", region: "VA", country: "US", phone: "2025550148" };
  for (const value of ["Richmond", "Richmond, VA, USA", "Richmond, Virginia, United States"])
    assert.equal(oracleMatches(contact, "city", value), true);
  for (const value of ["Richmond, CA, USA", "Richmond, United Kingdom", "Richmond Hill"])
    assert.equal(oracleMatches(contact, "city", value), false);
  assert.equal(oracleMatches(contact, "phone", "+1 (202) 555-0148"), true);
  assert.equal(oracleMatches(contact, "phone", "+44 2025550148"), false);
});
