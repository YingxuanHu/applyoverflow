import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceCandidateUrlIdentityKey as normalize } from "@/lib/ingestion/discovery/candidate-url-identity";
import { normalizeUrlIdentityKey } from "@/lib/ingestion/source-quality";

const board = "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html";

test("ADP employer and career-center identities survive discovery normalization", () => {
  assert.notEqual(normalize(`${board}?cid=employer-a&ccId=1`), normalize(`${board}?cid=employer-b&ccId=1`));
  assert.notEqual(normalize(`${board}?cid=employer-a&ccId=1`), normalize(`${board}?cid=employer-a&ccId=2`));
  assert.equal(normalize(`${board}?cid=EMPLOYER-A&ccId=1&utm_source=search&type=JS&lang=en_US`), normalize(`${board}?ccId=1&cid=employer-a&type=MP`));
  assert.notEqual(normalize(`${board}?cid=a&jobId=123`), normalize(`${board}?cid=b&jobId=123`));
  assert.notEqual(normalize(`${board}?cid=a&jobId=123`), normalize(`${board}?cid=a&jobId=456`));
  assert.match(normalize(board.replace("workforcenow.adp", "workforcenow.cloud.adp") + "?cid=employer-a")!, /cid=employer-a$/);
});

test("discovery does not alter canonical URL keys, unrelated hosts, or generic pages", () => {
  assert.equal(normalizeUrlIdentityKey(`${board}?cid=a`), normalizeUrlIdentityKey(`${board}?cid=b`));
  for (const url of [
    "https://boards.greenhouse.io/acme/jobs/123?utm_source=search",
    "https://example.com/jobs?cid=tracking&jobid=123",
    board.replace("adp.com", "adp.com.example.test") + "?cid=a",
    "https://workforcenow.adp.com/careers?cid=a",
    board,
  ]) assert.equal(normalize(url), normalizeUrlIdentityKey(url), url);
  assert.equal(normalize("not a URL"), null);
});
