import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompanySlugCandidates,
  probeAtsSlugsForCompany,
  type FetchLike,
} from "@/lib/ingestion/discovery/ats-slug-probe";

test("slug candidates prefer the domain label and strip legal suffixes", () => {
  const slugs = buildCompanySlugCandidates({
    name: "Acme Robotics, Inc.",
    domain: "https://www.acmerobotics.com/careers",
  });

  assert.equal(slugs[0], "acmerobotics");
  // Suffix-stripped variants rank ahead of the raw-name fallbacks.
  assert.ok(
    slugs.indexOf("acme-robotics") < slugs.indexOf("acme-robotics-inc")
  );
});

test("slug candidates are deduped, bounded, and skip too-short values", () => {
  const slugs = buildCompanySlugCandidates({
    name: "GE",
    domain: "ge.com",
  });
  // "ge" is below the minimum slug length everywhere it appears.
  assert.deepEqual(slugs, []);

  const many = buildCompanySlugCandidates({
    name: "Very Long Company Name Holdings Corporation Inc",
    domain: "vlcn.com",
  });
  assert.ok(many.length <= 5);
  assert.equal(new Set(many).size, many.length);
});

function fakeFetch(
  responses: Record<string, { status: number; body?: unknown }>
): FetchLike {
  return async (url) => {
    const match = responses[url] ?? { status: 404 };
    return {
      status: match.status,
      json: async () => {
        if (match.body === undefined) throw new Error("no body");
        return match.body;
      },
    };
  };
}

test("probe reports hits with job counts and stops per platform at first hit", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }, { id: 2 }] },
    },
    "https://www.workable.com/api/accounts/acme": {
      status: 200,
      body: { name: "Acme", jobs: [{ id: "a" }] },
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse", "workable", "lever"],
    fetchImpl,
    minJobCount: 1,
  });

  const platforms = summary.hits.map((hit) => hit.platform).sort();
  assert.deepEqual(platforms, ["greenhouse", "workable"]);

  const greenhouse = summary.hits.find((hit) => hit.platform === "greenhouse");
  assert.equal(greenhouse?.jobCount, 2);
  assert.equal(greenhouse?.boardUrl, "https://boards.greenhouse.io/acme");

  const workable = summary.hits.find((hit) => hit.platform === "workable");
  assert.equal(workable?.companyNameHint, "Acme");
});

test("empty boards below minJobCount are not reported as hits", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: { jobs: [] },
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse"],
    fetchImpl,
    minJobCount: 1,
  });

  assert.deepEqual(summary.hits, []);
});

test("429/403 responses classify as blocked, not miss", async () => {
  const fetchImpl = fakeFetch({
    "https://api.lever.co/v0/postings/acme?mode=json": { status: 429 },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["lever"],
    fetchImpl,
  });

  assert.equal(summary.hits.length, 0);
  assert.equal(summary.blocked.length, 1);
  assert.equal(summary.blocked[0].platform, "lever");
});

test("network failures classify as errors and do not abort other platforms", async () => {
  const fetchImpl: FetchLike = async (url) => {
    if (url.includes("lever")) throw new Error("ECONNRESET");
    if (url === "https://boards-api.greenhouse.io/v1/boards/acme/jobs") {
      return { status: 200, json: async () => ({ jobs: [{ id: 1 }] }) };
    }
    return { status: 404, json: async () => ({}) };
  };

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["lever", "greenhouse"],
    fetchImpl,
  });

  assert.ok(summary.errors.length >= 1);
  assert.equal(summary.hits.length, 1);
  assert.equal(summary.hits[0].platform, "greenhouse");
});
