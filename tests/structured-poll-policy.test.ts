import assert from "node:assert/strict";
import test from "node:test";
import { isApprovedStructuredPollSource } from "../src/lib/ingestion/structured-poll-policy";

test("structured polling opt-in is source-specific, recently validated and excludes HTML fallback", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const source = { id: "verified", connectorName: "company-site", sourceType: "COMPANY_JSON",
    extractionRoute: "STRUCTURED_API", validationState: "VALIDATED", lastValidatedAt: now };
  assert.equal(isApprovedStructuredPollSource(source, now, ""), false);
  assert.equal(isApprovedStructuredPollSource(source, now, "other"), false);
  assert.equal(isApprovedStructuredPollSource(source, now, "other, verified"), true);
  for (const change of [
    { sourceType: "COMPANY_HTML" }, { extractionRoute: "HTML_FALLBACK" },
    { validationState: "INVALID" }, { lastValidatedAt: null },
    { lastValidatedAt: new Date(now.getTime() - 8 * 86400_000) },
    { lastValidatedAt: new Date(now.getTime() + 1000) },
  ]) assert.equal(isApprovedStructuredPollSource({ ...source, ...change }, now, "verified"), false);
});
