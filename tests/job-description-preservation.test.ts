import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createLeverConnector } from "../src/lib/ingestion/connectors/lever";
import { buildDescription as buildAshbyDescription } from "../src/lib/ingestion/connectors/ashby";
import { buildLeverDescription } from "../src/lib/ingestion/connectors/lever-description";
import { descriptionHtmlToText } from "../src/lib/jobs/description-html";
import { sanitizeJobDescriptionText } from "../src/lib/job-cleanup";
import { getCleanJobDescriptionDisplayBlocks } from "../src/lib/job-description-format";
import { buildDescriptionPresentation } from "../src/lib/jobs/description-presentation";

const lever = {
  id: "engineer-1", text: "Software Engineer", description: "<p>We build reliable tools for public services.</p>",
  openingPlain: "We build reliable tools for public services.",
  lists: [
    { text: "Responsibilities", content: "<li>Build APIs for case management.</li><li>Document release decisions.</li>" },
    { text: "Required qualifications", content: "<li>Three years of TypeScript experience.</li><li>Professional fluency in French.</li>" },
    { text: "Preferred qualifications", content: "<li>Experience with PostgreSQL is preferred, not required.</li>" },
    { text: "Benefits", content: "<li>Four weeks of paid vacation.</li>" },
  ],
  additional: "<p>Applicants must be authorized to work in Canada. No sponsorship is available.</p>",
  salaryDescription: "<p>CAD 110,000 - 145,000 annually, plus a discretionary bonus.</p>",
  hostedUrl: "https://jobs.lever.co/example/engineer-1", applyUrl: "https://jobs.lever.co/example/engineer-1/apply",
};

test("Lever connector retains every provider section without duplicating its opening", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify([lever])));
  const result = await createLeverConnector({ siteToken: "example", companyName: "Example" }).fetchJobs({ now: new Date() });
  const description = result.jobs[0].description;
  assert.equal(description.split(lever.openingPlain).length - 1, 1);
  for (const expected of ["Responsibilities", "Document release decisions.", "Professional fluency in French.", "preferred, not required", "Four weeks", "No sponsorship", "110,000 - 145,000"]) assert.ok(description.includes(expected), expected);
});

test("Lever handles body-only and plain-text fields without requiring HTML", () => {
  assert.equal(buildLeverDescription({ openingPlain: "Opening", descriptionBodyPlain: "Body", additionalPlain: "Closing" }), "Opening\n\nBody\n\nClosing");
});

test("Ashby preserves source HTML, including HTML-only descriptions", () => {
  const html = "<h2>Responsibilities</h2><ul><li>Build reliable services.</li></ul>";
  const listing = { id: "example", title: "Engineer" };
  assert.equal(buildAshbyDescription(listing, { id: "example", descriptionHtml: html, descriptionPlainText: "Flattened snippet" }), html);
  assert.equal(buildAshbyDescription(listing, { id: "example", descriptionHtml: html }), html);
  assert.equal(buildAshbyDescription(listing, { id: "example", descriptionPlainText: "Plain fallback" }), "Plain fallback");
});

test("HTML structure and ordered step numbers survive normalization and rendering", () => {
  const source = '<h2>Interview process</h2><ol start="3"><li><p>Technical discussion</p></li><li value="6">Reference check</li></ol><h3>Pay transparency</h3><table><tr><td>Ontario</td><td>CAD 120,000</td></tr></table>';
  const formatted = JSON.stringify(getCleanJobDescriptionDisplayBlocks(sanitizeJobDescriptionText(source)));
  for (const expected of ["Interview process", "3. Technical discussion", "6. Reference check", "Pay transparency", "Ontario | CAD 120,000"]) assert.ok(formatted.includes(expected), expected);
});

test("source markup is inert and encoded comparisons remain readable", () => {
  assert.equal(descriptionHtmlToText('<p>Use List&lt;T&gt; and values &lt; 5 &amp; &gt; 1.</p><script>alert("bad")</script><style>body{color:red}</style>'), "Use List<T> and values < 5 & > 1.");
  assert.equal(descriptionHtmlToText("Use List<T> with C++ and values < 5."), "Use List<T> with C++ and values < 5.");
});

test("standalone bold source headings retain hierarchy without promoting inline emphasis", () => {
  const html = "<p><strong>Your first 90 days</strong></p><p>Learn the system and <strong>document decisions</strong> with your team.</p>";
  assert.equal(descriptionHtmlToText(html), "## Your first 90 days\n\nLearn the system and document decisions with your team.");
});

test("a source paragraph after a list does not become another requirement bullet", () => {
  const blocks = getCleanJobDescriptionDisplayBlocks("<h2>Requirements</h2><ul><li>TypeScript</li><li>SQL</li></ul><p>We are an equal opportunity employer.</p>");
  assert.deepEqual(blocks.at(-1), { kind: "paragraph", text: "We are an equal opportunity employer." });
});

test("ordinary sentences about requirements do not manufacture headings", () => {
  const text = "Requirements include TypeScript and sound judgment. Benefits depend on your location.";
  assert.deepEqual(getCleanJobDescriptionDisplayBlocks(text), [{ kind: "paragraph", text }]);
});

test("introductory compensation and inline About the job content are not discarded", () => {
  const result = JSON.stringify(getCleanJobDescriptionDisplayBlocks("About the job We offer CAD 100000 - 150000 annually. About the role Build platforms that support the finance team."));
  assert.match(result, /100000 - 150000 annually/);
  assert.match(result, /Build platforms/);
});

test("ordinary references to similar jobs and privacy notices do not truncate the posting", () => {
  const source = `${"We are hiring an analyst to improve our systems. ".repeat(8)} Experience in similar jobs is useful. Read our privacy notice before applying. Final requirement: work authorization in Canada.`;
  const result = JSON.stringify(getCleanJobDescriptionDisplayBlocks(sanitizeJobDescriptionText(source)));
  assert.match(result, /Final requirement: work authorization in Canada/);
  assert.match(result, /similar jobs is useful/);
});

test("long prose retains decimals, versions, abbreviations and final sentences", () => {
  const source = `${"We are looking for an engineer familiar with Node.js, .NET 8.0 and the U.S. market. ".repeat(12)} Pay starts at $120.50 per hour. No sponsorship is available.`;
  const blocks = getCleanJobDescriptionDisplayBlocks(source);
  const paragraphs = blocks.filter((block) => block.kind === "paragraph").map((block) => block.text).join(" ");
  assert.equal(paragraphs, source.replace(/\s+/g, " "));
});

test("parent headings, country names, quotes and section-specific repeated requirements survive", () => {
  const raw = '## Location\nCanada\n## Qualifications\n## Required skills\n- Research\n## Preferred skills\n- Research\n## Our culture\n"Clear communication; mutual respect; careful decisions" is our standard.';
  const result = getCleanJobDescriptionDisplayBlocks(raw);
  assert.equal(result.filter((block) => block.kind === "list").flatMap((block) => block.items).filter((item) => item === "Research").length, 2);
  for (const text of ["Location", "Canada", "Qualifications", "Preferred skills", "Clear communication; mutual respect; careful decisions"]) assert.ok(JSON.stringify(result).includes(text));
});

test("at-a-glance excerpts retain exact source wording and preferred qualifications stay distinct", () => {
  const description = buildLeverDescription(lever);
  const view = buildDescriptionPresentation(description);
  assert.equal(view.highlights.length, 3);
  for (const highlight of view.highlights) assert.ok(description.includes(highlight.text));
  assert.ok(view.sections.some((section) => section.category === "preferred" && JSON.stringify(section).includes("not required")));
  assert.ok(JSON.stringify(view.sections).includes("No sponsorship is available"));
});

test("long source sections are retained but never shortened into misleading highlights", () => {
  const long = `You must ${"demonstrate a distinct ability and ".repeat(14)} have work authorization.`;
  const view = buildDescriptionPresentation(`## Requirements\n- ${long}\n## Responsibilities\n- Build APIs.\n## Benefits\n- Paid leave.`);
  assert.ok(JSON.stringify(view.sections).includes(long.replace(/\s+/g, " ")));
  assert.ok(!view.highlights.some((highlight) => highlight.label === "Requirements"));
});

test("formatting a large posting remains bounded and preserves its last requirement", () => {
  const source = `<h2>Requirements</h2><ul>${Array.from({ length: 350 }, (_, index) => `<li>Requirement ${index}: demonstrate experience with reliable financial platforms and operational processes.</li>`).join("")}</ul>`;
  const start = performance.now();
  const view = buildDescriptionPresentation(source);
  assert.ok(JSON.stringify(view).includes("Requirement 349"));
  assert.ok(performance.now() - start < 1000, "35 KB description should format in under one second, even on CI");
});
