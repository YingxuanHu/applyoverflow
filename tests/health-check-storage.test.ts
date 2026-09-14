import assert from "node:assert/strict";
import test from "node:test";
import { healthCheckStorageSnippet, SUCCESS_HEALTH_SNIPPET_LENGTH } from "../src/lib/ingestion/health-check-storage";

test("healthy URL-check storage keeps a short excerpt, not another description copy", () => {
  assert.equal(healthCheckStorageSnippet("ALIVE", "a".repeat(1200))?.length, SUCCESS_HEALTH_SNIPPET_LENGTH);
  assert.equal(healthCheckStorageSnippet("ALIVE", "Short evidence"), "Short evidence");
  assert.equal(healthCheckStorageSnippet("ALIVE", null), null);
});

test("unhealthy and uncertain outcomes retain their full diagnostics", () => {
  for (const result of ["DEAD", "SUSPECT", "ERROR", "BLOCKED"] as const) {
    const snippet = "Evidence ".repeat(200);
    assert.equal(healthCheckStorageSnippet(result, snippet), snippet);
  }
});
