import assert from "node:assert/strict";
import test from "node:test";

import {
  getCleanJobDescriptionDisplayBlocks,
  isJobDescriptionSummaryUsable,
  isLowQualityJobDescription,
} from "../src/lib/job-description-format";

test("cleans source chrome and preserves useful job sections", () => {
  const raw = `
    Skip to main content
    Search
    Saved

    Job Description
    About the role:
    We are looking for a Network Engineer to design, operate, and improve resilient network infrastructure across offices and cloud environments.

    Responsibilities:
    • Own routing, switching, firewall, and wireless changes through planning, implementation, and validation.
    • Partner with security and infrastructure teams to troubleshoot incidents and reduce repeat operational issues.
    • Maintain clear network diagrams and runbooks for support handoffs.

    Similar jobs
    Create alert
  `;

  const blocks = getCleanJobDescriptionDisplayBlocks(raw);
  const rendered = JSON.stringify(blocks);

  assert.equal(isLowQualityJobDescription(raw), false);
  assert.equal(isJobDescriptionSummaryUsable(raw), true);
  assert.match(rendered, /About the role/);
  assert.match(rendered, /Network Engineer/);
  assert.match(rendered, /routing, switching/);
  assert.doesNotMatch(rendered, /Skip to main content/);
  assert.doesNotMatch(rendered, /Similar jobs/);
});

test("marks short aggregator snippets as unusable instead of rendering them as descriptions", () => {
  const raw =
    "Company Description Mindlance is a national recruiting company which partners with many of the leading employers in the Life Sciences, IT, and Financial Services sectors, feel free to check us out at Job Description J";

  assert.equal(isLowQualityJobDescription(raw), true);
  assert.equal(isJobDescriptionSummaryUsable(raw), false);
});

test("deduplicates repeated bullets and caps noisy lists", () => {
  const raw = `
    Responsibilities:
    - Build reliable application services used by internal operations teams.
    - Build reliable application services used by internal operations teams.
    - Partner with product managers to clarify scope and reduce delivery risk.
    - Improve observability with useful logs, metrics, and alerts.
    - Review code and help maintain practical engineering standards.
    - Document operational decisions for future support.
    - Coordinate releases with QA and customer support teams.
    - Remove stale processes that slow down delivery.
  `;

  const listBlock = getCleanJobDescriptionDisplayBlocks(raw).find(
    (block) => block.kind === "list"
  );

  assert.ok(listBlock);
  assert.equal(listBlock.items.length <= 6, true);
  assert.equal(listBlock.items.length >= 3, true);
  assert.equal(
    listBlock.items.filter((item) =>
      item.includes("Build reliable application services")
    ).length,
    1
  );
});

test("rejects metadata-only descriptions", () => {
  const raw = "Team: Security Department: Technical Infrastructure";

  assert.equal(isLowQualityJobDescription(raw), true);
  assert.equal(isJobDescriptionSummaryUsable(raw), false);
  assert.deepEqual(getCleanJobDescriptionDisplayBlocks(raw), []);
});

test("rejects short location or authorization notes as full descriptions", () => {
  const raw =
    "Job Description À noter : Quiconque pose sa candidature doit disposer d’une autorisation de travail au Canada. On-site expectation.";

  assert.equal(isLowQualityJobDescription(raw), true);
  assert.equal(isJobDescriptionSummaryUsable(raw), false);
});
