import assert from "node:assert/strict";
import test from "node:test";
import { selectMatchingSourceDescription } from "../src/lib/jobs/description-source";
import { recoverJobDescription, descriptionFromSourceSnapshot } from "../src/lib/jobs/description-recovery";
import { needsDescriptionRepair } from "../src/lib/jobs/description-quality";
import { fetchFormattedJobDescriptionFromUrl } from "../src/lib/job-description-fetch";
import type { FetchGuardDeps } from "../src/lib/ingestion/net/ssrf-guard";

const identity = { title: "Software Engineer", company: "Acme" };
const url = "https://jobs.example.com/engineer";
const description = "<h2>About the role</h2><p>We are looking for a Software Engineer to build reliable systems for financial services and improve release safety across our platform.</p><h2>Responsibilities</h2><ul><li>Build and maintain APIs used by customer-facing workflows and internal operations teams.</li><li>Document decisions and work closely with security teams to improve reliability.</li></ul><h2>Required qualifications</h2><ul><li>Three years of TypeScript experience and authorization to work in Canada.</li></ul>";
const posting = { "@type": "JobPosting", title: identity.title, hiringOrganization: { name: "Acme Inc." }, url, description };
const html = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const now = new Date("2026-09-12T12:00:00Z");
const source = { sourceName: "Lever:acme", sourceUrl: url, rawJob: { fetchedAt: now, rawPayload: { ...identity, description: "Old teaser", metadata: { description, lists: [{ text: "Benefits", content: "<li>Paid leave and extended health coverage.</li>" }] } } } };

test("repair selects the matching JobPosting, not the first or longest related vacancy", () => {
  const page = html({ "@graph": [{ ...posting, title: "Finance Director", url: "https://jobs.example.com/director", description: "Wrong role ".repeat(150) }, posting] });
  assert.equal(selectMatchingSourceDescription(page, url, identity), description);
});

test("repair rejects another employer, title mismatches and generic site descriptions", () => {
  for (const entry of [{ ...posting, hiringOrganization: { name: "Another Company" } }, { ...posting, title: "Senior Software Engineer" }, { "@type": "WebSite", description }]) assert.equal(selectMatchingSourceDescription(html(entry), url, identity), null);
});

test("an explicit different vacancy URL cannot be overridden by a matching generic job title", () => {
  assert.equal(selectMatchingSourceDescription(html({ ...posting, url: "https://jobs.example.com/another-engineer" }), url, identity), null);
});

test("repair rejects ambiguous same-title postings unless their URL identifies the vacancy", () => {
  const one = { ...posting, url: "https://jobs.example.com/one" };
  const two = { ...posting, url: "https://jobs.example.com/two", description: `${description}<p>A different location.</p>` };
  assert.equal(selectMatchingSourceDescription(html([one, two]), url, identity), null);
  assert.equal(selectMatchingSourceDescription(html([one, two]), two.url, identity), two.description);
});

test("DOM fallback requires the correct title and a scoped description container", () => {
  assert.equal(selectMatchingSourceDescription(`<h1>Software Engineer</h1><div class="job-description">${description}</div>`, url, identity), `<div class="job-description">${description}</div>`);
  assert.equal(selectMatchingSourceDescription(`<h1>All jobs</h1><div class="job-description">${description}</div>`, url, identity), null);
  assert.equal(selectMatchingSourceDescription(`<h1>Software Engineer</h1><main>${description}</main>`, url, identity), null);
});

test("known legacy Lever omissions are queued even when the introduction is substantial", () => {
  const plain = "We are looking for a Software Engineer to build reliable financial platforms. ".repeat(20);
  assert.equal(needsDescriptionRepair({ description: plain, sourceMappings: [{ sourceName: "Lever:acme" }] }), true);
  assert.equal(needsDescriptionRepair({ description: `## About the role\n${plain}`, sourceMappings: [{ sourceName: "Lever:acme" }] }), false);
});

test("repair recovers missing Lever lists from a fresh, identity-matched source payload", async () => {
  const result = await recoverJobDescription({ ...identity, applyUrl: `${url}/apply`, description: "Old teaser", sourceMappings: [source] }, { now, fetchDescription: async () => { assert.fail("fresh provider evidence should not need another HTTP request"); } });
  assert.equal(result?.method, "source_snapshot");
  assert.match(result!.description, /Paid leave and extended health coverage/);
  assert.equal(result?.observedAt, now);
});

test("source snapshots do not cross job identities or trust malformed metadata", () => {
  assert.equal(descriptionFromSourceSnapshot(source, { ...identity, title: "Accountant" }), null);
  assert.equal(descriptionFromSourceSnapshot({ ...source, rawJob: { ...source.rawJob, rawPayload: { ...identity, metadata: { lists: [null, 123, { content: {} }] } } } }, identity), null);
});

test("a long company introduction is not accepted as a complete source description", () => {
  const marketing = "Acme builds software that helps organizations deliver great outcomes for their customers. ".repeat(20);
  assert.equal(needsDescriptionRepair({ description: marketing }), true);
  assert.equal(descriptionFromSourceSnapshot({ ...source, sourceName: "OfficialCompany:acme", rawJob: { ...source.rawJob, rawPayload: { ...identity, description: marketing } } }, identity), null);
});

test("old snapshots fall back to mapped sources before the apply URL, with a three-URL bound", async () => {
  const seen: string[] = [];
  const sources = Array.from({ length: 5 }, (_, index) => ({ ...source, sourceUrl: `${url}/${index}`, rawJob: { ...source.rawJob, fetchedAt: new Date(0) } }));
  const result = await recoverJobDescription({ ...identity, description: "", applyUrl: `${url}/apply`, sourceMappings: sources }, { now, fetchDescription: async (candidate) => { seen.push(candidate); return null; } });
  assert.equal(result, null);
  assert.deepEqual(seen, [0, 1, 2].map((index) => `${url}/${index}`));
});

test("a blocked source does not prevent trying the next mapped source", async () => {
  const seen: string[] = [];
  const result = await recoverJobDescription({ ...identity, description: "", applyUrl: `${url}/apply`, sourceMappings: [{ ...source, rawJob: { ...source.rawJob, fetchedAt: new Date(0) } }] }, { now, fetchDescription: async (candidate) => { seen.push(candidate); return candidate.endsWith("/apply") ? description : null; } });
  assert.equal(result?.method, "source_page");
  assert.equal(seen.length, 2);
});

test("fetch rejects oversized responses instead of saving an apparently complete prefix", async () => {
  const deps: FetchGuardDeps = { resolve: async () => [{ address: "93.184.216.34", family: 4 }], fetchImpl: (async () => new Response(`${html(posting)}${" ".repeat(5_000_001)}`, { headers: { "content-type": "text/html" } })) as typeof fetch };
  assert.equal(await fetchFormattedJobDescriptionFromUrl(url, deps, identity), null);
});

test("fetch with expected identity never falls back to the wrong embedded posting", async () => {
  const deps: FetchGuardDeps = { resolve: async () => [{ address: "93.184.216.34", family: 4 }], fetchImpl: (async () => new Response(html([{ ...posting, title: "Director" }, posting]), { headers: { "content-type": "text/html" } })) as typeof fetch };
  const result = await fetchFormattedJobDescriptionFromUrl(url, deps, identity);
  assert.ok(result?.includes("Three years of TypeScript"));
  assert.ok(!result?.includes("Director"));
});
