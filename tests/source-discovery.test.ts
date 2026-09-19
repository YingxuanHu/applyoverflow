import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/applyoverflow_test";

test("verified Cadmus seed resolves to its direct iCIMS board", async () => {
  const { ENTERPRISE_DISCOVERY_COMPANIES } = await import("../src/lib/ingestion/discovery/enterprise-catalog");
  const { extractSourceCandidateFromUrl } = await import("../src/lib/ingestion/discovery/sources");
  const company = ENTERPRISE_DISCOVERY_COMPANIES.find((row) => row.name === "Cadmus")!;
  assert.ok(company);
  const candidate = extractSourceCandidateFromUrl(company.seedPageUrls![0])!;
  assert.equal(candidate.connectorName, "icims");
  assert.equal(candidate.token, "careers-cadmusgroup");
  assert.equal(candidate.boardUrl, "https://careers-cadmusgroup.icims.com/jobs/search");
});

test("source previews fetch one snapshot and preserve limits and upstream errors", async () => {
  const { previewSourceConnector } = await import("../src/lib/ingestion/discovery/sources");
  let calls = 0;
  let failing = false;
  const connector: import("../src/lib/ingestion/types").SourceConnector = {
    key: "greenhouse:preview-fixture", sourceName: "Greenhouse:preview-fixture",
    sourceTier: "TIER_2", freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(options) {
      calls++;
      assert.equal(options.limit, 5);
      assert.ok(options.now instanceof Date);
      assert.equal(typeof options.log, "function");
      return { jobs: [], exhausted: !failing, metadata: failing ? { error: "HTTP 429" } : { snapshot: calls } };
    },
  };
  const result = await previewSourceConnector(connector, 5);
  assert.equal(calls, 1);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.summary.fetchMetadata, { snapshot: 1 });
  failing = true;
  await assert.rejects(previewSourceConnector(connector, 5), /429/);
  assert.equal(calls, 2, "a failed preview must not immediately fetch again");
});

test("discovers Oracle Cloud HCM company sources from candidate URLs", async () => {
  const { discoverSourceCandidatesFromUrls } = await import(
    "../src/lib/ingestion/discovery/sources"
  );

  const result = await discoverSourceCandidatesFromUrls([
    "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/requisitions",
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.connectorName, "oraclecloud");
  assert.equal(result.candidates[0]?.token, "eeho.fa.us2.oraclecloud.com|jobsearch");
  assert.equal(result.candidates[0]?.sourceName, "OracleCloud:eeho.fa.us2");
});

test("detects Oracle Cloud HCM as a direct connector source", async () => {
  const { detectDirectSourceFromUrl } = await import(
    "../src/lib/ingestion/discovery/ats-tenant-detector"
  );

  assert.deepEqual(
    detectDirectSourceFromUrl(
      "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions"
    ),
    {
      connectorName: "oraclecloud",
      tenantKey: "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com|cx",
      normalizedBoardUrl:
        "https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/cx/requisitions",
      rootHost: "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com",
    }
  );
});
