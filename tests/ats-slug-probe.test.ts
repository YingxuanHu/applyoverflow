import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_HOST_SLUG_BLOCKLIST,
  buildCompanySlugCandidates,
  classifyIdentity,
  computeCompanyNameSimilarity,
  createProbeRunContext,
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
    requestDelayMs: 0,
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
    requestDelayMs: 0,
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
    requestDelayMs: 0,
  });

  assert.equal(summary.hits.length, 0);
  assert.equal(summary.blocked.length, 1);
  assert.equal(summary.blocked[0].platform, "lever");
});

test("name similarity: containment, suffix noise, and zero overlap", () => {
  assert.equal(computeCompanyNameSimilarity("Acme", "Acme Robotics, Inc."), 1);
  assert.equal(
    computeCompanyNameSimilarity("Acme Robotics", "ACME ROBOTICS LLC"),
    1
  );
  assert.equal(computeCompanyNameSimilarity("Setpoint", "Blue Origin"), 0);
  assert.ok(
    computeCompanyNameSimilarity("Acme Widgets", "Acme Rockets") > 0 &&
      computeCompanyNameSimilarity("Acme Widgets", "Acme Rockets") < 1
  );
});

test("identity classification: match, mismatch, unverified", () => {
  assert.equal(classifyIdentity("Acme", "Acme, Inc.").verdict, "match");
  assert.equal(classifyIdentity("Setpoint", "Blue Origin").verdict, "mismatch");
  assert.equal(classifyIdentity("Acme", null).verdict, "unverified");
  assert.equal(classifyIdentity(null, "Acme").verdict, "unverified");
});

test("greenhouse hits verify identity via the board meta endpoint", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }] },
    },
    "https://boards-api.greenhouse.io/v1/boards/acme": {
      status: 200,
      body: { name: "Acme Robotics" },
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.equal(summary.hits.length, 1);
  assert.equal(summary.hits[0].identityVerdict, "match");
  assert.equal(summary.hits[0].companyNameHint, "Acme Robotics");
});

test("slug collisions are segregated as identity mismatches, not hits", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/setpoint/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }, { id: 2 }] },
    },
    "https://boards-api.greenhouse.io/v1/boards/setpoint": {
      status: 200,
      body: { name: "Completely Different Corp" },
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Setpoint",
    domain: "setpoint.io",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.equal(summary.hits.length, 0);
  assert.equal(summary.identityMismatches.length, 1);
  assert.equal(summary.identityMismatches[0].identityVerdict, "mismatch");
});

test("identity endpoint failure degrades to unverified, hit is kept", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }] },
    },
    // identity URL not mocked -> 404 -> reported name unavailable
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.equal(summary.hits.length, 1);
  assert.equal(summary.hits[0].identityVerdict, "unverified");
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
    requestDelayMs: 0,
  });

  assert.ok(summary.errors.length >= 1);
  assert.equal(summary.hits.length, 1);
  assert.equal(summary.hits[0].platform, "greenhouse");
});

test("shared-host domain labels never derive a slug (name path still applies)", () => {
  // Zepto's recorded domain is its incubator's page — probing
  // ashby:ycombinator would "hit" Y Combinator's own board.
  const slugs = buildCompanySlugCandidates({
    name: "Zepto",
    domain: "ycombinator.com",
  });
  assert.ok(!slugs.includes("ycombinator"));
  assert.ok(slugs.includes("zepto"));

  // Jobvite-hosted careers domain must not yield lever:jobvite.
  const hosted = buildCompanySlugCandidates({
    name: "Northerntool",
    domain: "northerntool.jobvite.com",
  });
  assert.ok(!hosted.includes("jobvite"));
  assert.ok(hosted.includes("northerntool"));

  assert.ok(SHARED_HOST_SLUG_BLOCKLIST.has("ycombinator"));
  assert.ok(SHARED_HOST_SLUG_BLOCKLIST.has("jobvite"));
});

test("blocklisted-slug hits without identity match are segregated", async () => {
  // Lever exposes no organization name, so this hit stays "unverified" — the
  // blocklist guard must still keep the shared-host slug out of `hits` even
  // when it arrives via the name path.
  const fetchImpl = fakeFetch({
    "https://api.lever.co/v0/postings/jobvite?mode=json": {
      status: 200,
      body: [{ id: 1 }, { id: 2 }],
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Jobvite",
    platforms: ["lever"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.deepEqual(summary.hits, []);
  assert.equal(summary.identityMismatches.length, 1);
  assert.equal(summary.identityMismatches[0].slug, "jobvite");
});

test("blocklisted-slug hits WITH identity match are kept", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/jobvite/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }] },
    },
    "https://boards-api.greenhouse.io/v1/boards/jobvite": {
      status: 200,
      body: { name: "Jobvite" },
    },
  });

  const summary = await probeAtsSlugsForCompany({
    name: "Jobvite",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.equal(summary.hits.length, 1);
  assert.equal(summary.hits[0].slug, "jobvite");
  assert.equal(summary.hits[0].identityVerdict, "match");
  assert.deepEqual(summary.identityMismatches, []);
});

test("a blocked platform is benched for subsequent companies in the run", async () => {
  const benchedEvents: string[] = [];
  const runContext = createProbeRunContext({
    onPlatformBenched: (platform) => benchedEvents.push(platform),
  });

  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes("lever")) return { status: 429, json: async () => ({}) };
    return { status: 404, json: async () => ({}) };
  };

  const first = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["lever", "greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
    runContext,
  });
  assert.equal(first.blocked.length, 1);
  assert.deepEqual(first.skippedPlatforms, []);
  assert.deepEqual(benchedEvents, ["lever"]);
  const leverCallsAfterFirstCompany = calls.filter((url) =>
    url.includes("lever")
  ).length;
  assert.ok(leverCallsAfterFirstCompany >= 1);

  const second = await probeAtsSlugsForCompany({
    name: "Globex",
    domain: "globex.com",
    platforms: ["lever", "greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
    runContext,
  });

  // Second company must not hit the benched platform again...
  assert.equal(
    calls.filter((url) => url.includes("lever")).length,
    leverCallsAfterFirstCompany
  );
  // ...the skip is counted, and the bench callback did not re-fire.
  assert.deepEqual(second.skippedPlatforms, ["lever"]);
  assert.deepEqual(benchedEvents, ["lever"]);
  // Non-benched platforms are still probed.
  assert.ok(calls.some((url) => url.includes("greenhouse.io/v1/boards/globex")));
});

test("probe requests carry a browser-ish user-agent plus the accept header", async () => {
  let seenHeaders: Record<string, string> | undefined;
  const fetchImpl: FetchLike = async (_url, init) => {
    seenHeaders = init.headers;
    return { status: 404, json: async () => ({}) };
  };

  await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });

  assert.equal(seenHeaders?.accept, "application/json");
  assert.match(seenHeaders?.["user-agent"] ?? "", /^Mozilla\/5\.0 /);
});

test("requestDelayMs pacing option is accepted (0 disables, small delays work)", async () => {
  const fetchImpl = fakeFetch({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
      status: 200,
      body: { jobs: [{ id: 1 }] },
    },
  });

  const unpaced = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse"],
    fetchImpl,
    requestDelayMs: 0,
  });
  assert.equal(unpaced.hits.length, 1);

  const paced = await probeAtsSlugsForCompany({
    name: "Acme",
    domain: "acme.com",
    platforms: ["greenhouse", "lever"],
    fetchImpl,
    requestDelayMs: 1,
  });
  assert.equal(paced.hits.length, 1);
  assert.ok(paced.attempts >= 2);
});
