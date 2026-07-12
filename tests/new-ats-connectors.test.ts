/**
 * Sanity tests for the new ATS connectors added in the aggressive expansion:
 * BreezyHR, Hireology, Paradox, HRSmart, Y Combinator Work at a Startup,
 * JSearch. Each test pins the connector key + sourceName shape and
 * validates the input contract — no network calls.
 */
import { describe, it } from "node:test";
import { strictEqual, throws } from "node:assert";

import { createBreezyHrConnector } from "../src/lib/ingestion/connectors/breezyhr";
import { createHireologyConnector } from "../src/lib/ingestion/connectors/hireology";
import {
  createParadoxConnector,
  createHrSmartConnector,
} from "../src/lib/ingestion/connectors/json-ld-board";
import { createWorkAtAStartupConnector } from "../src/lib/ingestion/connectors/workatastartup";

describe("createBreezyHrConnector", () => {
  it("encodes the company slug into key + sourceName", () => {
    const c = createBreezyHrConnector({ company: "acme" });
    strictEqual(c.key, "breezyhr:acme");
    strictEqual(c.sourceName, "BreezyHR:acme");
  });

  it("normalizes casing", () => {
    const c = createBreezyHrConnector({ company: "ACME-Corp" });
    strictEqual(c.key, "breezyhr:acme-corp");
  });

  it("rejects invalid slugs", () => {
    throws(() => createBreezyHrConnector({ company: "" }), /requires.*company/i);
    throws(
      () => createBreezyHrConnector({ company: "has space" }),
      /invalid company slug/i
    );
    throws(
      () => createBreezyHrConnector({ company: "has/slash" }),
      /invalid company slug/i
    );
  });
});

describe("createHireologyConnector", () => {
  it("encodes the slug into key + sourceName", () => {
    const c = createHireologyConnector({ slug: "acme" });
    strictEqual(c.key, "hireology:acme");
    strictEqual(c.sourceName, "Hireology:acme");
  });

  it("rejects invalid slugs", () => {
    throws(
      () => createHireologyConnector({ slug: "bad space" }),
      /invalid slug/i
    );
  });
});

describe("createParadoxConnector / createHrSmartConnector — generic JSON-LD board", () => {
  it("Paradox: requires a fully-qualified boardUrl", () => {
    throws(
      () =>
        createParadoxConnector({
          tenant: "acme",
          boardUrl: "not-a-url",
        }),
      /fully-qualified boardUrl/i
    );
  });

  it("Paradox: builds a connector with key encoding tenant", () => {
    const c = createParadoxConnector({
      tenant: "acme",
      boardUrl: "https://careers.acme.com/jobs",
    });
    strictEqual(c.key, "paradox:acme");
    strictEqual(c.sourceName, "Paradox:acme");
  });

  it("HRSmart: encodes tenant and accepts https boardUrl", () => {
    const c = createHrSmartConnector({
      tenant: "acme-corp",
      boardUrl: "https://acme-applications.hrsmart.com",
    });
    strictEqual(c.key, "hrsmart:acme-corp");
    strictEqual(c.sourceName, "Hrsmart:acme-corp");
  });
});

describe("createWorkAtAStartupConnector", () => {
  it("builds with a stable key", () => {
    const c = createWorkAtAStartupConnector();
    strictEqual(c.key, "workatastartup:feed");
    strictEqual(c.sourceName, "WorkAtAStartup:feed");
    strictEqual(c.sourceTier, "TIER_3");
  });
});

import { createJobBankLiveConnector } from "../src/lib/ingestion/connectors/jobbank-live";

describe("createJobBankLiveConnector", () => {
  it("builds with a stable key + Tier 1 (Canadian government source)", () => {
    const c = createJobBankLiveConnector();
    strictEqual(c.key, "jobbank-live:feed");
    strictEqual(c.sourceName, "JobBankLive:feed");
    strictEqual(c.sourceTier, "TIER_1");
  });
});
