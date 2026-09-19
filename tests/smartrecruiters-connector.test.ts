import assert from "node:assert/strict";
import test from "node:test";
import { createSmartRecruitersConnector } from "../src/lib/ingestion/connectors/smartrecruiters";

const now = new Date("2026-09-12T12:00:00Z");
const connector = createSmartRecruitersConnector({ companyIdentifier: "fixture", companyName: "Fixture" });
const listing = (id: string, name = "Marketing Manager", country = "CA") => ({
  id, name, company: { name: "Fixture" }, location: { city: "Toronto", region: "ON", country },
  postingUrl: `https://jobs.smartrecruiters.com/fixture/${id}`, releasedDate: now.toISOString(),
});
const detail = (row: ReturnType<typeof listing>) => ({
  ...row,
  jobAd: { sections: { jobDescription: { title: "Responsibilities", text: "<ul><li>Lead campaigns</li><li>Measure results &amp; improve</li></ul>" } } },
});
const json = (value: unknown) => Response.json(value);

test("SmartRecruiters fetches structured descriptions across GENERAL roles and uppercase NA countries", async (t) => {
  const titles = ["Marketing Manager", "Account Executive", "Human Resources Manager", "Legal Counsel", "Customer Success Manager", "Operations Analyst"];
  const rows = titles.map((title, index) => listing(String(index), title, index % 2 ? "US" : "CA"));
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    requests.push(input);
    const url = new URL(input);
    return url.search ? json({ content: rows, totalFound: rows.length }) : json(detail(rows.find((row) => url.pathname.endsWith(`/${row.id}`))!));
  });
  const result = await connector.fetchJobs({ now });
  assert.equal(result.jobs.length, titles.length);
  assert.equal(requests.length, 1 + titles.length);
  assert.equal(result.exhausted, true);
  for (const job of result.jobs) {
    assert.match(job.description, /Responsibilities\n/);
    assert.match(job.description, /- Lead campaigns\n+- Measure results & improve/);
  }
});

test("SmartRecruiters avoids detail requests for excluded roles and explicit foreign countries", async (t) => {
  const rows = [listing("retail", "Cashier"), { ...listing("foreign", "Marketing Manager", "GB"), location: { country: "GB", remote: true } }];
  const fetchMock = t.mock.method(globalThis, "fetch", async () => json({ content: rows, totalFound: 2 }));
  await connector.fetchJobs({ now });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("one missing SmartRecruiters detail preserves other rows but is not an authoritative snapshot", async (t) => {
  const rows = Array.from({ length: 10 }, (_, i) => listing(String(i)));
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.search) return json({ content: rows, totalFound: rows.length });
    const row = rows.find((row) => url.pathname.endsWith(`/${row.id}`))!;
    return row.id === "0" ? new Response(null, { status: 404 }) : json(detail(row));
  });
  const result = await connector.fetchJobs({ now });
  assert.equal(result.jobs.length, 9);
  assert.equal(result.exhausted, false);
  assert.equal((result.metadata as Record<string, unknown>).failedDetailCount, 1);
  assert.equal((result.metadata as Record<string, unknown>).partial, true);
});

test("SmartRecruiters stops new detail batches after throttling", async (t) => {
  const rows = Array.from({ length: 20 }, (_, i) => listing(String(i)));
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.search) return json({ content: rows, totalFound: rows.length });
    const row = rows.find((row) => url.pathname.endsWith(`/${row.id}`))!;
    return row.id === "0" ? new Response(null, { status: 429 }) : json(detail(row));
  });
  const result = await connector.fetchJobs({ now });
  assert.equal(result.jobs.length, 7);
  assert.equal(fetchMock.mock.callCount(), 9, "one listing request plus only one eight-detail batch");
  assert.equal(result.exhausted, false);
});

test("SmartRecruiters retains an earlier page after a later malformed listing response", async (t) => {
  const row = listing("1");
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (!url.search) return json(detail(row));
    return url.searchParams.get("offset") === "0" ? json({ content: [row], totalFound: 2 }) : json({ content: null });
  });
  const result = await connector.fetchJobs({ now });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.exhausted, false);
  assert.match(String((result.metadata as Record<string, unknown>).error), /invalid listing/);
});

test("SmartRecruiters detects non-advancing pages and honors limits", async (t) => {
  const row = listing("1");
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: string) => new URL(input).search
    ? json({ content: [row], totalFound: 100 }) : json(detail(row)));
  const partial = await connector.fetchJobs({ now });
  assert.equal(partial.jobs.length, 1);
  assert.equal(partial.exhausted, false);
  assert.equal(fetchMock.mock.callCount(), 3);
  const limited = await connector.fetchJobs({ now, limit: 1 });
  assert.equal(limited.jobs.length, 1);
  assert.equal(limited.exhausted, false);
});

test("SmartRecruiters does not swallow cancellation or mismatched detail identity", async (t) => {
  const row = listing("1");
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (new URL(input).search) return json({ content: [row], totalFound: 1 });
    return json(detail(listing("wrong")));
  });
  const result = await connector.fetchJobs({ now });
  assert.equal(result.jobs.length, 0);
  assert.equal(result.exhausted, false);
  controller.abort(new Error("cancel fixture"));
  await assert.rejects(connector.fetchJobs({ now, signal: controller.signal }), /cancel fixture/);
});

test("large boards resume a bounded batch without revisiting or skipping offsets", async (t) => {
  const rows = Array.from({ length: 215 }, (_, i) => listing(String(i), "Marketing Manager", "GB"));
  const offsets: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const offset = Number(new URL(input).searchParams.get("offset"));
    offsets.push(offset);
    return json({ content: rows.slice(offset, offset + 100), totalFound: rows.length });
  });
  const first = await connector.fetchJobs({ now });
  const second = await connector.fetchJobs({ now, checkpoint: first.checkpoint });
  const third = await connector.fetchJobs({ now, checkpoint: second.checkpoint });
  assert.deepEqual(offsets, [0, 100, 200]);
  assert.deepEqual(first.checkpoint, { offset: 100 });
  assert.deepEqual(second.checkpoint, { offset: 200 });
  assert.equal(third.checkpoint, null);
  assert.equal(third.exhausted, true);
  assert.equal(new Set([...first.jobs, ...second.jobs, ...third.jobs].map((job) => job.sourceId)).size, 215);
});
