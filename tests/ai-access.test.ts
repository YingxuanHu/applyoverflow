import assert from "node:assert/strict";
import test from "node:test";

import { isAiFeatureAllowed, parseAiAllowedEmails } from "../src/lib/ai-access";

test("ai allowlist parses comma and newline separated emails", () => {
  const emails = parseAiAllowedEmails(" AI@Example.com,ai2@example.com\nthird@example.com ");

  assert.deepEqual([...emails], [
    "ai@example.com",
    "ai2@example.com",
    "third@example.com",
  ]);
});

test("email present in AI_ALLOWED_EMAILS is allowed", () => {
  assert.equal(
    isAiFeatureAllowed("user@example.com", {
      aiAllowlist: "user@example.com,other@example.com",
      opsAllowlist: "",
    }),
    true
  );
});

test("email absent from a non-empty AI_ALLOWED_EMAILS is denied (even if ops-listed)", () => {
  assert.equal(
    isAiFeatureAllowed("nobody@example.com", {
      aiAllowlist: "user@example.com",
      opsAllowlist: "nobody@example.com",
    }),
    false
  );
});

test("falls back to OPS_ADMIN_EMAILS when AI_ALLOWED_EMAILS is empty", () => {
  assert.equal(
    isAiFeatureAllowed("owner@example.com", {
      aiAllowlist: "",
      opsAllowlist: "owner@example.com",
    }),
    true
  );

  assert.equal(
    isAiFeatureAllowed("user@example.com", {
      aiAllowlist: "",
      opsAllowlist: "owner@example.com",
    }),
    false
  );
});

test("both allowlists empty denies everyone (cost-safe default)", () => {
  assert.equal(
    isAiFeatureAllowed("owner@example.com", { aiAllowlist: "", opsAllowlist: "" }),
    false
  );
});

test("null or blank email is always denied", () => {
  assert.equal(
    isAiFeatureAllowed(null, { aiAllowlist: "owner@example.com", opsAllowlist: "" }),
    false
  );
  assert.equal(
    isAiFeatureAllowed("   ", { aiAllowlist: "owner@example.com", opsAllowlist: "" }),
    false
  );
});

test("email checks are case-insensitive for both allowlists", () => {
  assert.equal(
    isAiFeatureAllowed("USER@Example.com", { aiAllowlist: "user@example.com", opsAllowlist: "" }),
    true
  );
  assert.equal(
    isAiFeatureAllowed("Owner@Example.com", { aiAllowlist: "", opsAllowlist: "OWNER@example.com" }),
    true
  );
});
