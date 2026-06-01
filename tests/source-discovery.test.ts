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
