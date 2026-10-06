import assert from "node:assert/strict";
import test from "node:test";
import { discoverWorkdayBenchmarkJobs, workdayBenchmarkStage, workdayBenchmarkTarget } from "../scripts/lib/workday-benchmark.mjs";

test("Workday discovery accepts only public tenant tokens", () => {
  assert.deepEqual(workdayBenchmarkTarget("example.wd103.myworkdayjobs.com|example|External"),
    { host: "example.wd103.myworkdayjobs.com", tenant: "example", site: "External" });
  for (const token of ["localhost|test|jobs", "example.wd1.myworkdayjobs.com|test|jobs/../../login",
    "example.wd1.myworkdayjobs.com|test|jobs|extra", "example.wd1.myworkdayjobs.com.evil.test|test|jobs"])
    assert.throws(() => workdayBenchmarkTarget(token));
});

test("Workday discovery uses read-only job searches and never candidate endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const jobs = await discoverWorkdayBenchmarkJobs("example.wd1.myworkdayjobs.com|example|External", async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(requests.length === 1 ? {} : { total: 1, jobPostings: [
      { title: "Engineer", externalPath: "/job/Toronto-CAN/Engineer_R1", locationsText: "Toronto" },
      { title: "Invalid", externalPath: "https://evil.test/application" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://example.wd1.myworkdayjobs.com/en-US/External/job/Toronto-CAN/Engineer_R1/apply");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://example.wd1.myworkdayjobs.com/wday/cxs/example/External/jobs");
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { appliedFacets: {}, limit: 20, offset: 0, searchText: "" });
});

test("Workday gates and active steps are separate from fill success", () => {
  assert.equal(workdayBenchmarkStage({ headings: ["My Experience"], body: "Review Save and Continue" }), "history");
  assert.equal(workdayBenchmarkStage({ headings: ["My Information"], password: true }), "sign-in");
  assert.equal(workdayBenchmarkStage({ headings: ["My Information"], body: "Something went wrong Error Code: VPS|123" }), "server-error");
  assert.equal(workdayBenchmarkStage({ headings: ["Application Questions"] }), "questions");
  assert.equal(workdayBenchmarkStage({ headings: ["Voluntary Disclosures"] }), "disclosures");
  assert.equal(workdayBenchmarkStage({ headings: ["Review"] }), "review");
});
