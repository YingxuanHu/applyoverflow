import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatJobDescriptionText, getCleanJobDescriptionDisplayBlocks } from "../src/lib/job-description-format";
import { sanitizeJobDescriptionText } from "../src/lib/job-cleanup";
import { buildDescriptionPresentation } from "../src/lib/jobs/description-presentation";
import { repairDescriptionTextStructure, stripCareerPageNavigation } from "../src/lib/jobs/description-text-structure";
import { extractDescriptionFromHtml } from "../src/lib/ingestion/html-description";
import { createSuccessFactorsConnector } from "../src/lib/ingestion/connectors/successfactors";

const messy = readFileSync(new URL("./fixtures/descriptions/career-page-with-navigation.txt", import.meta.url), "utf8");

test("the reported career-page extract loses menus and retains its actual source sections", () => {
  const view = buildDescriptionPresentation(messy);
  const rendered = JSON.stringify(view.sections);
  assert.doesNotMatch(rendered, /WORKING HERE|Search All Jobs|PowerPathway|Create Account|Nearest Major Market/);
  for (const heading of ["Position Summary", "Job Responsibilities", "Qualifications", "Minimum", "Desired", "Purpose, Virtues and Stands"]) {
    assert.equal(view.sections.filter((section) => section.heading === heading).length, 1, heading);
  }
  const list = (heading: string) => view.sections.find((section) => section.heading === heading)!.blocks.flatMap((block) => block.kind === "list" ? block.items : []);
  assert.equal(list("Job Responsibilities").length, 12);
  assert.equal(list("Minimum").length, 2);
  assert.equal(list("Desired").length, 7);
  assert.match(list("Job Responsibilities")[1], /Project Managers and Gas Operation Supervisors/);
  assert.ok(list("Desired").includes("Demonstrated knowledge in Gas Transmission Construction."));
  assert.ok(list("Desired").includes("Gas Transmission material / construction / welding standards."));
  assert.equal(view.sections.find((section) => section.heading === "Desired")?.category, "preferred");
  assert.match(rendered, /Work Type: Onsite/);
  assert.match(rendered, /This position is hybrid/);
  assert.match(rendered, /Our work shall create prosperity for all customers and investors/);
  const salary = view.highlights.find((highlight) => /salary/.test(highlight.label))!;
  for (const value of ["Bay Area Minimum", "126,000", "200,000", "California", "120,000.00", "190,000.00", "Or"]) assert.ok(salary.text.includes(value), value);
});

test("every source body word survives, in order, without rewriting contradictions or legal text", () => {
  const actualBody = messy.slice(messy.lastIndexOf("Construction Manager, Expert"));
  const words = (text: string) => text.replace(/\u200b/g, "").match(/[\p{L}\p{N}]+/gu);
  const rendered = getCleanJobDescriptionDisplayBlocks(messy).map((block) => block.kind === "list" ? block.items.join(" ") : block.text).join(" ");
  assert.deepEqual(words(rendered), words(actualBody));
});

test("ingestion sanitation and repeated display cleanup keep the repair stable", () => {
  const formatted = formatJobDescriptionText(messy);
  assert.equal(formatJobDescriptionText(formatted), formatted);
  const sanitized = sanitizeJobDescriptionText(messy);
  assert.doesNotMatch(sanitized, /WORKING HERE|PowerPathway/);
  assert.match(sanitized, /Project Managers and Gas Operation Supervisors/);
  assert.equal(buildDescriptionPresentation(sanitized).sections.find((section) => section.heading === "Desired")?.category, "preferred");
});

test("navigation cleanup needs a repeated title and posting identity, not incidental career wording", () => {
  const authentic = "About us\nWe support career programs for our community.\nWORKING HERE\nSearch All Jobs\nCreate Account / Sign In\nQualifications\n- Work authorization in Canada.";
  assert.equal(stripCareerPageNavigation(authentic), authentic);
  const leadingProse = `Critical employment condition: ${"Applicants must have work authorization. ".repeat(8)}\n${messy}`;
  assert.equal(stripCareerPageNavigation(leadingProse), leadingProse);
  const noIdentity = messy.replace(/Requisition ID # 174044/, "Current opening");
  assert.equal(stripCareerPageNavigation(noIdentity), noIdentity);
});

test("spaceless bullets repair without merging adjacent bullets or independent closing paragraphs", () => {
  const raw = "## Requirements\n•TypeScript\n•SQL.\n•Clear communication.\n\napplicants must be authorized to work in Canada.\n## Preferred qualifications\n▪Go\n◦Rust";
  const blocks = getCleanJobDescriptionDisplayBlocks(raw);
  assert.deepEqual(blocks.filter((block) => block.kind === "list").flatMap((block) => block.items), ["TypeScript", "SQL.", "Clear communication.", "Go", "Rust"]);
  assert.ok(blocks.some((block) => block.kind === "paragraph" && block.text.startsWith("applicants")));
  assert.equal(repairDescriptionTextStructure("Job Category\nPosition Summary\nA substantive role."), "Job Category\nPosition Summary\nA substantive role.");
  const start = performance.now();
  const blankHeavy = repairDescriptionTextStructure(`•Work with team leads${"\n".repeat(25_000)}and managers.\n•Write clear plans.`);
  assert.match(blankHeavy, /team leads and managers/);
  assert.ok(performance.now() - start < 1000, "excessive blank lines must not cause quadratic scans");
});

test("already structured descriptions keep clean headings, lists and paragraph boundaries", () => {
  const raw = "<h2>Who we are</h2><p>The real world is the next frontier.</p><p>We build tools for our members.</p><h2>Who you are</h2><ul><li>A thoughtful engineer.</li></ul><h2>What you'll do</h2><ul><li>Build reliable tools.</li></ul>";
  const view = buildDescriptionPresentation(raw);
  assert.deepEqual(view.sections.map((section) => section.heading), ["Who we are", "Who you are", "What you'll do"]);
  assert.equal(view.sections[0].blocks.length, 2);
  assert.deepEqual(getCleanJobDescriptionDisplayBlocks("<nav><a>Search jobs</a></nav><h2>Responsibilities</h2><p>Deliver useful work.</p>"), [{ kind: "header", text: "Responsibilities" }, { kind: "paragraph", text: "Deliver useful work." }]);
  const separate = "<ul><li>TypeScript</li></ul><p>Go.</p><ul><li>SQL</li></ul>";
  const rendered = getCleanJobDescriptionDisplayBlocks(formatJobDescriptionText(separate));
  assert.ok(rendered.some((block) => block.kind === "paragraph" && block.text === "Go."));
});

const sourceBody = `<h2>Position Summary</h2><p>${"We are hiring an engineer to build reliable systems. ".repeat(8)}</p><h2>Job Responsibilities</h2><ul><li>Build APIs.</li><li>Review changes.</li></ul><h2>Qualifications</h2><p>No sponsorship is available.</p>`;

test("a large navigation-heavy body cannot outscore an explicit SuccessFactors description", () => {
  const chrome = "<h2>Career Areas</h2><p>Search All Jobs</p><p>University Programs</p>".repeat(70);
  for (const container of [`<span class='jobdescription rich-text'>${sourceBody}</span>`, `<section itemprop='description'>${sourceBody}</section>`]) {
    const result = extractDescriptionFromHtml(`<html><body>${chrome}${container}${chrome}</body></html>`);
    assert.doesNotMatch(result, /Career Areas|University Programs/);
    assert.match(result, /## Position Summary/);
    assert.match(result, /- Review changes/);
    assert.match(result, /No sponsorship/);
  }
});

test("SuccessFactors detail ingestion preserves source headings and lists for span and div wrappers", async (t) => {
  let tag = "span";
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => new Response(String(url).includes("/job/")
    ? `<h1>Engineer</h1><${tag} data-test="description" ${tag === "span" ? "class='jobdescription rich-text'" : "itemprop='description'"}>${sourceBody}<${tag}><p>Final source condition.</p></${tag}></${tag}><p>Outside description</p>`
    : '<table><tr class="data-row"><a href="/job/engineer/123" class="jobTitle-link">Engineer</a><span class="jobLocation">Toronto, ON, CA</span></tr></table>'));
  for (tag of ["span", "div"]) {
    const connector = createSuccessFactorsConnector({ host: "careers.example.test", companyName: "Example" });
    const result = await connector.fetchJobs({ now: new Date(), limit: 1 });
    assert.equal(result.jobs.length, 1);
    const description = result.jobs[0].description;
    assert.match(description, /## Position Summary/);
    assert.match(description, /- Build APIs/);
    assert.match(description, /- Review changes/);
    assert.match(description, /Final source condition/);
    assert.doesNotMatch(description, /Outside description/);
  }
});
