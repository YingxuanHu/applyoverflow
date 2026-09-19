import assert from "node:assert/strict";
import test from "node:test";
import { createIcimsConnector, validateIcimsPortal } from "../src/lib/ingestion/connectors/icims";
import { readConnectorFetchError } from "../src/lib/ingestion/source-fetch-quality";

const now = new Date("2026-09-19T12:00:00Z");
const connector = () => createIcimsConnector({ portalSubdomain: "careers-example", companyName: "Example" });
const listing = (ids: number[], pagination = "") => `<main>${ids.map((id) =>
  `<a href="/jobs/${id}/policy-analyst/job"><h2>Policy Analyst</h2></a>`).join("")}${pagination}</main>`;
const detail = () => `<script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting", title: "Policy Analyst", hiringOrganization: { name: "Example" },
  description: "Research policy and prepare reports.",
  jobLocation: [{ address: { addressLocality: "Arlington", addressRegion: "VA", addressCountry: "US" } }],
})}</script>`;

test("iCIMS div-based public listings validate without legacy table classes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(listing([1])));
  assert.equal((await validateIcimsPortal("careers-example")).valid, true);
});

test("iCIMS distinguishes authoritative empty results from HTTP failures and unexpected pages", async (t) => {
  for (const response of [
    () => new Response("Rate limited", { status: 429 }),
    () => new Response("<h1>Sign in</h1><input type='password'>"),
    () => new Response("<h1>Verify you are human</h1>"),
  ]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => response());
    const result = await connector().fetchJobs({ now });
    assert.equal(result.exhausted, false);
    assert.ok(readConnectorFetchError(result.metadata));
    assert.equal(result.jobs.length, 0);
    fetch.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response('<div class="iCIMS_InfoMsg">There are currently no jobs available.</div>'));
  const result = await connector().fetchJobs({ now });
  assert.equal(result.exhausted, true);
  assert.equal(readConnectorFetchError(result.metadata), null);
});

test("iCIMS keeps partial results but cannot expire jobs after a later listing failure", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("pr=0")) return new Response(listing([1], "Page 1 of 2"));
    if (url.includes("pr=1")) return new Response("Unavailable", { status: 503 });
    return new Response(detail());
  });
  const result = await connector().fetchJobs({ now });
  assert.deepEqual(result.jobs.map((job) => job.sourceId), ["1"]);
  assert.equal(result.exhausted, false);
  assert.equal(readConnectorFetchError(result.metadata)?.partial, true);
  assert.match(readConnectorFetchError(result.metadata)!.message, /503/);
});

test("iCIMS rejects incomplete detail snapshots, including disguised login pages", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/search")) return new Response(listing([1, 2, 3]));
    if (url.includes("/jobs/1/")) return new Response(detail());
    if (url.includes("/jobs/2/")) return new Response("Gone", { status: 410 });
    return new Response("<h1>Sign in</h1>");
  });
  const result = await connector().fetchJobs({ now });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.exhausted, false);
  assert.match(readConnectorFetchError(result.metadata)!.message, /2 job detail/);
});

test("iCIMS honors encoded pagination, deduplicates overlap, and marks complete snapshots", async (t) => {
  const details: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("pr=0")) return new Response(listing([1], '<a href="?in_iframe=1&amp;pr=1">Next</a>'));
    if (url.includes("pr=1")) return new Response(listing([1, 2], "Page 2 of 2"));
    details.push(url);
    return new Response(detail());
  });
  const result = await connector().fetchJobs({ now });
  assert.deepEqual(result.jobs.map((job) => job.sourceId), ["1", "2"]);
  assert.equal(details.length, 2);
  assert.equal(result.exhausted, true);
  assert.equal(readConnectorFetchError(result.metadata), null);
});

test("iCIMS detects ignored page parameters instead of repeatedly fetching duplicates", async (t) => {
  let pages = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/search")) {
      pages++;
      return new Response(listing([1], "Page 1 of 4"));
    }
    return new Response(detail());
  });
  const result = await connector().fetchJobs({ now });
  assert.equal(pages, 2);
  assert.equal(result.exhausted, false);
  assert.match(readConnectorFetchError(result.metadata)!.message, /repeated/);
});

test("bounded iCIMS previews are never authoritative snapshots", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) =>
    new Response(url.includes("/search") ? listing([1, 2]) : detail()));
  const result = await connector().fetchJobs({ now, limit: 1 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.exhausted, false);
  assert.equal(readConnectorFetchError(result.metadata), null);
});

test("iCIMS propagates cancellation instead of converting it to an empty success", async (t) => {
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/search")) return new Response(listing([1]));
    abort.abort(new Error("Cancelled by operator"));
    throw abort.signal.reason;
  });
  await assert.rejects(connector().fetchJobs({ now, signal: abort.signal }), /Cancelled/);
});

test("iCIMS preserves country evidence without publishing placeholder locations or inventing remote work", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("/search")) return new Response(listing([1]));
    return new Response(`<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting", title: "Policy Analyst", description: "Research policy.",
      jobLocation: { address: { addressLocality: "UNAVAILABLE", addressRegion: "UNAVAILABLE", addressCountry: { name: "US" } } },
    })}</script>`);
  });
  const result = await connector().fetchJobs({ now });
  assert.equal(result.jobs[0]?.location, "US");
  assert.equal(result.jobs[0]?.workMode, null);
  assert.equal(result.exhausted, true);
});
