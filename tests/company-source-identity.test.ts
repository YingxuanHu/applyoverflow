import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceId } from "../src/lib/ingestion/connectors/company-site";

test("long career URLs with a common prefix have distinct source IDs", () => {
  const prefix = "https://www.builtinboston.com/job/";
  const first = `${prefix}machine-learning-engineer/123456`;
  const second = `${prefix}machine-learning-engineer/789012`;
  assert.equal(Buffer.from(`${first}|Engineer`).toString("base64url").slice(0, 48), Buffer.from(`${second}|Engineer`).toString("base64url").slice(0, 48));
  assert.notEqual(buildSourceId(null, first, "Engineer"), buildSourceId(null, second, "Engineer"));
});

test("tracking is ignored, shared-page titles and employer requisitions remain distinct", () => {
  const url = "https://careers.example.com/jobs/software-engineer/123456";
  assert.equal(buildSourceId(null, url, "Engineer"), buildSourceId(null, `${url}?utm_source=feed`, "Engineer"));
  assert.equal(buildSourceId("5396389008", url, "Engineer"), "company:5396389008");
  assert.notEqual(buildSourceId("5396389008", url, "Engineer"), buildSourceId("5396402008", url, "Engineer"));
  assert.notEqual(buildSourceId(null, `${url}?vacancy=one`, "Engineer"), buildSourceId(null, `${url}?vacancy=two`, "Engineer"));
  assert.notEqual(buildSourceId(null, url, "Engineer"), buildSourceId(null, url, "Designer"));
});
