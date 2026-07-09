import assert from "node:assert/strict";
import test from "node:test";

import {
  REDISCOVERY_PROBE_MIN_CONSECUTIVE_FAILURES,
  shouldProbeOnRediscovery,
} from "@/lib/ingestion/rediscovery-probe-policy";

test("never probes without a company identity to derive slugs from", () => {
  assert.equal(
    shouldProbeOnRediscovery({
      hasCompanyIdentity: false,
      connectorName: "greenhouse",
      consecutiveFailures: 12,
    }),
    false
  );
});

test("never probes for sources below the failure threshold", () => {
  assert.equal(
    shouldProbeOnRediscovery({
      hasCompanyIdentity: true,
      connectorName: "lever",
      consecutiveFailures: 0,
    }),
    false
  );
  assert.equal(
    shouldProbeOnRediscovery({
      hasCompanyIdentity: true,
      connectorName: "lever",
      consecutiveFailures: REDISCOVERY_PROBE_MIN_CONSECUTIVE_FAILURES - 1,
    }),
    false
  );
});

test("probes persistently failing sources with a company identity", () => {
  assert.equal(
    shouldProbeOnRediscovery({
      hasCompanyIdentity: true,
      connectorName: "company-site",
      consecutiveFailures: REDISCOVERY_PROBE_MIN_CONSECUTIVE_FAILURES,
    }),
    true
  );
  assert.equal(
    shouldProbeOnRediscovery({
      hasCompanyIdentity: true,
      connectorName: "workday",
      consecutiveFailures: 9,
    }),
    true
  );
});
