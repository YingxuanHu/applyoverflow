import assert from "node:assert/strict";
import test from "node:test";

import {
  formatJobDescriptionText,
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

test("prefers JobPosting schema description over leaked page title bullets", () => {
  const raw = `
    • Software Engineer @ Kong
    •
    {"@context":"https://schema.org/","@type":"JobPosting","title":"Software Engineer","description":" Are you ready to unlock intelligence?\\n\\nAbout the role\\nKong is looking for a Software Engineer to build reliable developer-facing systems.\\n\\nResponsibilities\\n- Build APIs and distributed services used by engineering teams.\\n- Partner with product and infrastructure teams to improve reliability.\\n\\nRequirements\\n- Experience with TypeScript, Go, or distributed systems. "}
  `;

  const formatted = formatJobDescriptionText(raw);

  assert.match(formatted, /^Are you ready to unlock intelligence\?/);
  assert.match(formatted, /About the role/);
  assert.match(formatted, /Build APIs and distributed services/);
  assert.doesNotMatch(formatted, /Software Engineer @ Kong/);
  assert.doesNotMatch(formatted, /"@context"/);
  assert.equal(isJobDescriptionSummaryUsable(formatted), true);
});

test("extracts JobPosting schema description from HTML script content", () => {
  const html = `
    <html>
      <head>
        <title>Software Engineer @ Kong</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Software Engineer",
            "description": "<p>About the role</p><p>Kong is looking for a Software Engineer to build reliable platform features for customers.</p><ul><li>Own backend services and APIs.</li><li>Improve observability and deployment safety.</li></ul><p>Requirements include TypeScript, Go, and distributed systems experience.</p>"
          }
        </script>
      </head>
      <body>
        <h1>Software Engineer @ Kong</h1>
      </body>
    </html>
  `;

  const formatted = formatJobDescriptionText(html);

  assert.match(formatted, /^About the role/);
  assert.match(formatted, /Own backend services and APIs/);
  assert.doesNotMatch(formatted, /application\/ld\+json/);
  assert.doesNotMatch(formatted, /"@type"/);
  assert.equal(isJobDescriptionSummaryUsable(formatted), true);
});
