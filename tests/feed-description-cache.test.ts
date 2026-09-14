import assert from "node:assert/strict";
import test from "node:test";
import { needsDescriptionRepair, resolveFeedDescription } from "../src/lib/jobs/description-quality";

const fullText = `## About the role
We are looking for a Software Engineer to build reliable systems for financial services and improve release safety across our platform.

## Responsibilities
- Build and maintain APIs used by customer-facing workflows and internal operations teams.
- Document decisions and work closely with security teams to improve reliability.

## Required qualifications
- Three years of TypeScript experience and authorization to work in Canada.`;

test("reselecting a preview-only job keeps its fetched full description", () => {
  const job = { description: "Design software with our team." };
  assert.equal(needsDescriptionRepair(job), true);
  assert.equal(resolveFeedDescription(job, fullText), fullText);
  assert.equal(resolveFeedDescription(job), job.description);
});

test("a complete updated job description takes precedence over old fetched text", () => {
  assert.equal(needsDescriptionRepair({ description: fullText }), false);
  assert.equal(resolveFeedDescription({ description: fullText }, "Older text"), fullText);
});

test("empty results and not-yet-loaded descriptions remain distinct", () => {
  assert.equal(resolveFeedDescription({ description: "" }), null);
  assert.equal(resolveFeedDescription({ description: "" }, ""), "");
  assert.equal(resolveFeedDescription({ description: "Short preview" }, ""), "");
});

test("incomplete Lever introductions do not displace repaired lists", () => {
  const job = {
    description: fullText.replace(/^## .*$/gm, ""),
    sourceMappings: [{ sourceName: "Lever: example" }],
  };
  assert.equal(needsDescriptionRepair(job), true);
  assert.equal(resolveFeedDescription(job, fullText), fullText);
});
