import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/applyoverflow_test";

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
