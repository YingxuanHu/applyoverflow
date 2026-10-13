import { test } from "node:test";
import assert from "node:assert/strict";
import { issueWorkspaceToken, verifyWorkspaceToken } from "../src/lib/applications/workspace-token";
import { evaluateRequirements, requirementsSchema, parseRequirements } from "../src/lib/top-picks/requirements";
import { trustedWorkMode } from "../src/lib/job-metadata";

test("uncertain work arrangements cannot silently satisfy remote-only or no-relocation requirements", () => {
  const rules = requirementsSchema.parse({ workModes: ["REMOTE"], relocation: "NO" });
  const job = { location: "Vancouver, Canada", workMode: "REMOTE", workModeConfidence: 0.3 };
  assert.equal(trustedWorkMode(job), "UNKNOWN");
  assert.deepEqual(evaluateRequirements(rules, job, "Toronto, Canada").unknown, ["Commute or relocation location", "Work arrangement"]);
  assert.equal(evaluateRequirements({ ...rules, unknownPolicy: "exclude" }, job, "Toronto, Canada").passed, false);
  assert.deepEqual(evaluateRequirements(rules, { ...job, workModeConfidence: 1 }, "Toronto, Canada").unknown, []);
  assert.equal(trustedWorkMode({ ...job, workModeConfidence: 1, workModeStatus: "rejected" }), "UNKNOWN");
});

test("legacy relocation preferences remain effective until explicitly changed", () => {
  assert.equal(parseRequirements(null, "No").relocation, "NO");
  assert.equal(parseRequirements('{}', "Yes").relocation, "YES");
  assert.equal(parseRequirements('{"relocation":"UNSPECIFIED"}', "Yes").relocation, "UNSPECIFIED");
  assert.equal(parseRequirements('null', "No").relocation, "UNSPECIFIED");
});

test("workspace capabilities bind account, application, URL, purpose and expiry", () => {
  const now = Date.now(), secret = "isolated-fixture-secret";
  const input = { userId: "alice", applicationId: "app-1", url: "https://careers.example/jobs/1/apply" };
  const issued = issueWorkspaceToken(input, secret, now);
  assert.equal(verifyWorkspaceToken(issued.token, secret, "alice", now)?.applicationId, input.applicationId);
  assert.equal(verifyWorkspaceToken(issued.token, secret, "bob", now), null);
  assert.equal(verifyWorkspaceToken(issued.token, "other-secret", "alice", now), null);
  assert.equal(verifyWorkspaceToken(issued.token, secret, "alice", issued.expires), null);
  const [payload, signature] = issued.token.split(".");
  const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
  changed.url = "https://different.example/apply";
  assert.equal(verifyWorkspaceToken(`${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`, secret, "alice", now), null);
  for (const value of ["", "bad", `${issued.token}.extra`, "x".repeat(6001)]) assert.equal(verifyWorkspaceToken(value, secret, "alice", now), null);
  assert.notEqual(issueWorkspaceToken(input, secret, now).token, issued.token, "each workspace opening has a fresh nonce");
});

test("no relocation requires the current city for onsite/hybrid but does not exclude remote jobs", () => {
  const rules = requirementsSchema.parse({ relocation: "NO", country: "CA" });
  const home = "Toronto, Ontario, Canada";
  assert.equal(evaluateRequirements(rules, { location: home, workMode: "ONSITE" }, home).passed, true);
  assert.equal(evaluateRequirements(rules, { location: "Vancouver, Canada", workMode: "HYBRID" }, home).passed, false);
  assert.equal(evaluateRequirements(rules, { location: "Vancouver, Canada", workMode: "REMOTE" }, home).passed, true);
  assert.equal(evaluateRequirements(rules, { location: "Remote, United States", workMode: "REMOTE" }, home).passed, false);
  assert.equal(evaluateRequirements(rules, { location: "Toronto, Ohio, United States", workMode: "ONSITE" }, home).passed, false);
  const unknown = evaluateRequirements(rules, { location: "Canada", workMode: "HYBRID" }, home);
  assert.deepEqual(unknown.unknown, ["Commute or relocation location"]);
  assert.equal(evaluateRequirements({ ...rules, unknownPolicy: "exclude" }, { location: "Canada", workMode: "HYBRID" }, home).passed, false);
});

test("selected relocation destinations are OR alternatives; current residence is retained", () => {
  const rules = requirementsSchema.parse({ relocation: "YES", relocationLocations: ["Seattle", "British Columbia"] });
  const home = "Toronto, Canada";
  for (const location of [home, "Seattle, Washington, United States", "Vancouver, BC, Canada"])
    assert.equal(evaluateRequirements(rules, { location, workMode: "ONSITE" }, home).passed, true, location);
  assert.equal(evaluateRequirements(rules, { location: "Boston, Massachusetts", workMode: "ONSITE" }, home).passed, false);
  assert.equal(evaluateRequirements(requirementsSchema.parse({ relocation: "YES" }), { location: "Boston", workMode: "ONSITE" }, home).passed, true);
  assert.equal(evaluateRequirements(requirementsSchema.parse({ relocation: "NO" }), { location: "Toronto", workMode: "ONSITE" }).unknown.length, 1);
  assert.equal(evaluateRequirements(requirementsSchema.parse({ relocation: "NO" }), { location: "Toronto", workMode: "ONSITE" }, "Ontario, Canada").unknown.length, 1, "province-only residence is not a commute radius");
  assert.equal(evaluateRequirements(requirementsSchema.parse({ country: "CA" }), { location: "British Columbia", workMode: "REMOTE" }).passed, true);
});
