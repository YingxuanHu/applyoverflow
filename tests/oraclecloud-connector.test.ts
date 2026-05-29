/**
 * Sanity tests for the Oracle Cloud HCM connector — locks in the URL pattern,
 * tenant validation, and the connector key shape.
 *
 * Oracle Cloud HCM is the single biggest ATS we did NOT poll directly until
 * this connector was added. Major NA employers (retailers, healthcare
 * systems, universities, governments, manufacturers) use it. If any of these
 * basics regress, all those tenants silently stop producing jobs.
 */
import { describe, it } from "node:test";
import { strictEqual, throws } from "node:assert";

import { createOracleCloudConnector } from "../src/lib/ingestion/connectors/oraclecloud";

describe("createOracleCloudConnector — sanity", () => {
  it("builds a connector with key + sourceName encoding the tenant", () => {
    const connector = createOracleCloudConnector({
      tenant: "ejov.fa.ca2.oraclecloud.com",
    });
    strictEqual(connector.key, "oraclecloud:ejov.fa.ca2:cx");
    strictEqual(connector.sourceName, "OracleCloud:ejov.fa.ca2");
    strictEqual(connector.sourceTier, "TIER_2");
  });

  it("respects a custom site identifier", () => {
    const connector = createOracleCloudConnector({
      tenant: "fa-exhh-saasfaprod1.fa.ocs.oraclecloud.com",
      site: "CX_2",
    });
    strictEqual(
      connector.key,
      "oraclecloud:fa-exhh-saasfaprod1.fa.ocs:cx_2"
    );
  });

  it("rejects non-oraclecloud.com tenants", () => {
    throws(
      () =>
        createOracleCloudConnector({
          // Looks plausible but wrong domain
          tenant: "ejov.fa.ca2.example.com",
        }),
      /invalid tenant host/i
    );
  });

  it("rejects empty / whitespace tenants", () => {
    throws(
      () => createOracleCloudConnector({ tenant: "" }),
      /requires a `tenant` host/i
    );
    throws(
      () => createOracleCloudConnector({ tenant: "   " }),
      /requires a `tenant` host/i
    );
  });

  it("normalizes tenant casing for the connector key", () => {
    const connector = createOracleCloudConnector({
      tenant: "EJOV.fa.CA2.oraclecloud.com",
    });
    strictEqual(connector.key, "oraclecloud:ejov.fa.ca2:cx");
  });
});
