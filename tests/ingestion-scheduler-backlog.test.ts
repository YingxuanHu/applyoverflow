import test from "node:test";
import assert from "node:assert/strict";

import { shouldDeferLegacySources } from "../src/lib/ingestion/scheduled-source-backlog-policy";

test("legacy sources are not starved by source-validation work", () => {
  assert.equal(
    shouldDeferLegacySources({ connectorPoll: 0, rediscovery: 0 }),
    false
  );
});

test("legacy sources continue while the actionable source backlog is small", () => {
  assert.equal(
    shouldDeferLegacySources({ connectorPoll: 19, rediscovery: 20 }),
    false
  );
});

test("connector-family capped residual work does not starve broad feeds", () => {
  assert.equal(
    shouldDeferLegacySources({ connectorPoll: 686, rediscovery: 9 }),
    false
  );
});

test("legacy sources defer for a truly large actionable source backlog", () => {
  assert.equal(
    shouldDeferLegacySources({ connectorPoll: 980, rediscovery: 20 }),
    true
  );
});
