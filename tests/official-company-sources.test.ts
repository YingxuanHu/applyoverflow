import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAmazonSearchUrl,
  buildAppleSearchUrl,
  buildGoogleSearchUrl,
  buildEightfoldDetailUrl,
  buildEightfoldSearchUrl,
  createOfficialCompanyConnector,
  extractAppleJobsFromHydration,
  extractGoogleJobsFromHtml,
  extractGoogleTotalRecords,
  parseOfficialCompanySourceToken,
} from "../src/lib/ingestion/connectors/official-company";
import { getSourceQualitySnapshot } from "../src/lib/ingestion/source-quality";
import { getSourceTrust, resolveJobLinks } from "../src/lib/job-links";

test("official company source quality outranks ATS/direct board and aggregators", () => {
  const official = getSourceQualitySnapshot({
    sourceName: "OfficialCompany:Amazon",
    sourceUrl: "https://www.amazon.jobs/en/jobs/123/example",
    applyUrl: "https://www.amazon.jobs/applicant/jobs/123/apply",
  });
  const ats = getSourceQualitySnapshot({
    sourceName: "Greenhouse:example",
    sourceUrl: "https://job-boards.greenhouse.io/example/jobs/123",
    applyUrl: "https://job-boards.greenhouse.io/example/jobs/123",
  });
  const aggregator = getSourceQualitySnapshot({
    sourceName: "Jooble",
    sourceUrl: "https://jooble.org/desc/123",
    applyUrl: "https://jooble.org/away/123",
  });
  const aggregatorWithDirectApplyUrl = getSourceQualitySnapshot({
    sourceName: "Jooble",
    sourceUrl: "https://jooble.org/desc/456",
    applyUrl: "https://job-boards.greenhouse.io/example/jobs/456",
  });
  const companyHtml = getSourceQualitySnapshot({
    sourceName: "CompanyHtml:example",
    sourceUrl: "https://example.com/careers/jobs/456",
    applyUrl: "https://example.com/careers/jobs/456",
  });

  assert.equal(official.kind, "FIRST_PARTY_COMPANY");
  assert.equal(ats.kind, "DIRECT_COMPANY");
  assert.equal(aggregator.kind, "AGGREGATOR_REDIRECT");
  assert.equal(aggregatorWithDirectApplyUrl.kind, "AGGREGATOR_REDIRECT");
  assert.equal(companyHtml.kind, "DIRECT_COMPANY");
  assert.ok(official.rank > ats.rank);
  assert.ok(ats.rank > aggregator.rank);
  assert.ok(companyHtml.rank > aggregatorWithDirectApplyUrl.rank);
});

test("official company token parser supports company and market", () => {
  assert.deepEqual(parseOfficialCompanySourceToken("amazon:ca"), {
    company: "amazon",
    market: "ca",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("apple"), {
    company: "apple",
    market: "global",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("google:global"), {
    company: "google",
    market: "global",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("microsoft:us"), {
    company: "microsoft",
    market: "us",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("nvidia:north-america"), {
    company: "nvidia",
    market: "north-america",
  });
  assert.throws(() => parseOfficialCompanySourceToken("meta"), /Unsupported/);
});

test("official company connector exposes full-snapshot tier-one sources", () => {
  const connector = createOfficialCompanyConnector({
    company: "amazon",
    market: "ca",
  });

  assert.equal(connector.key, "official-company:amazon:ca");
  assert.equal(connector.sourceName, "OfficialCompany:Amazon");
  assert.equal(connector.sourceTier, "TIER_1");
  assert.equal(connector.freshnessMode, "FULL_SNAPSHOT");
});

test("official company postings are trusted outbound sources", () => {
  const trust = getSourceTrust(
    "OfficialCompany:Amazon",
    "https://www.amazon.jobs/en/jobs/10425510/software-development-engineer"
  );

  assert.equal(trust.level, "TRUSTED");

  const links = resolveJobLinks({
    applyUrl: "https://www.amazon.jobs/applicant/jobs/10425510/apply",
    sourceMappings: [
      {
        sourceName: "Jooble",
        sourceUrl: "https://jooble.org/desc/amazon-copy",
        isPrimary: false,
      },
      {
        sourceName: "OfficialCompany:Amazon",
        sourceUrl: "https://www.amazon.jobs/en/jobs/10425510/software-development-engineer",
        isPrimary: true,
      },
    ],
  });

  assert.equal(links.linkTrust.level, "TRUSTED");
  assert.equal(links.primaryExternalLink?.href, "https://www.amazon.jobs/applicant/jobs/10425510/apply");
  assert.equal(links.primaryExternalLink?.sourceName, "OfficialCompany:Amazon");
  assert.equal(
    links.sourcePostingLink?.href,
    "https://www.amazon.jobs/en/jobs/10425510/software-development-engineer"
  );
});

test("ongoing-until-filled wording is not treated as a dead posting", async () => {
  process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";
  const { detectDeadSignal } = await import("../src/lib/ingestion/normalize");
  const signal = detectDeadSignal({
    title: "Principal Researcher - Artificial Specialized Intelligence - Microsoft Research",
    description:
      "This position will be open for a minimum of 5 days, with applications accepted on an ongoing basis until the position is filled.",
    deadline: null,
    fetchedAt: new Date("2026-05-27T16:16:03.884Z"),
  });

  assert.equal(signal.detected, false);
});

test("official company URL builders use official career surfaces", () => {
  assert.equal(
    buildAmazonSearchUrl({ country: "CAN", offset: 0, limit: 100 }),
    "https://www.amazon.jobs/en/search.json?offset=0&result_limit=100&country=CAN"
  );
  assert.equal(
    buildAmazonSearchUrl({
      country: "USA",
      category: "Software Development",
      offset: 200,
      limit: 50,
    }),
    "https://www.amazon.jobs/en/search.json?offset=200&result_limit=50&country=USA&category%5B%5D=Software+Development"
  );
  assert.equal(
    buildAmazonSearchUrl({ offset: 0, limit: 100 }),
    "https://www.amazon.jobs/en/search.json?offset=0&result_limit=100"
  );
  assert.equal(
    buildGoogleSearchUrl({ page: 2 }),
    "https://www.google.com/about/careers/applications/jobs/results/?page=2"
  );
  assert.equal(
    buildAppleSearchUrl({ market: "ca", page: 1 }),
    "https://jobs.apple.com/en-us/search?sort=relevance&location=canada-CANC"
  );
  const microsoftConfig = {
    company: "microsoft" as const,
    displayName: "Microsoft" as const,
    domain: "microsoft.com" as const,
    baseUrl: "https://apply.careers.microsoft.com" as const,
  };
  assert.equal(
    buildEightfoldSearchUrl({
      config: microsoftConfig,
      location: "Canada",
      offset: 0,
      limit: 100,
    }),
    "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&num=100&start=0&location=Canada"
  );
  assert.equal(
    buildEightfoldDetailUrl({ config: microsoftConfig, positionId: "1970393556753318" }),
    "https://apply.careers.microsoft.com/api/pcsx/position_details?domain=microsoft.com&position_id=1970393556753318"
  );
});

test("Google official parser extracts embedded jobs from server-rendered payloads", () => {
  const html = `
    <script>
      AF_initDataCallback({data:[[
        ["123456789012345678","Software Engineer, Maps","https://www.google.com/about/careers/applications/signin?jobId=abc",
          [null,"<ul><li>Build mapping systems.</li></ul>"],
          [null,"<h3>Minimum qualifications:</h3><ul><li>Bachelor's degree.</li></ul>"],
          "projects/gweb-careers-proto/tenants/example",null,"Google","en-US",
          [["Warsaw, Poland",["Warsaw, Poland"],"Warsaw",null,null,"PL"]],
          [null,"<p>Work on Google Maps products for users worldwide.</p>"],
          [2],[1778142684,3000000]
        ]
      ],null,4219,20]});
    </script>
  `;

  const jobs = extractGoogleJobsFromHtml(html);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.[0], "123456789012345678");
  assert.equal(extractGoogleTotalRecords(html), 4219);
});

test("Apple hydration parser extracts structured job results", () => {
  const payload = {
    loaderData: {
      "routes/search": {
        search: {
          totalRecords: 1,
          searchResults: [
            {
              positionId: "200663294",
              postingTitle: "Full Stack Software Engineer, Productivity Apps",
              transformedPostingTitle: "full-stack-software-engineer-productivity-apps",
              postDateInGMT: "2026-05-14T15:57:07.586Z",
              jobSummary: "Build connected services.",
              locations: [{ name: "Vancouver", countryName: "Canada" }],
              team: { teamName: "Software and Services" },
              standardWeeklyHours: 37.5,
            },
          ],
        },
      },
    },
  };
  const encoded = JSON.stringify(JSON.stringify(payload)).slice(1, -1);
  const html = `<script>window.__staticRouterHydrationData = JSON.parse("${encoded}");</script>`;

  assert.deepEqual(extractAppleJobsFromHydration(html), [
    payload.loaderData["routes/search"].search.searchResults[0],
  ]);
});

test("Apple official connector returns an item-level resume checkpoint", async () => {
  const previousFetch = globalThis.fetch;
  const payload = {
    loaderData: {
      "routes/search": {
        search: {
          totalRecords: 2,
          searchResults: [
            {
              positionId: "200663294",
              postingTitle: "Full Stack Software Engineer",
              transformedPostingTitle: "full-stack-software-engineer",
              postDateInGMT: "2026-05-14T15:57:07.586Z",
              jobSummary: "Build connected services.",
              locations: [{ name: "Vancouver", countryName: "Canada" }],
            },
            {
              positionId: "200663295",
              postingTitle: "Backend Software Engineer",
              transformedPostingTitle: "backend-software-engineer",
              postDateInGMT: "2026-05-15T15:57:07.586Z",
              jobSummary: "Build backend services.",
              locations: [{ name: "Toronto", countryName: "Canada" }],
            },
          ],
        },
      },
    },
  };
  const encoded = JSON.stringify(JSON.stringify(payload)).slice(1, -1);
  globalThis.fetch = (async () =>
    new Response(
      `<script>window.__staticRouterHydrationData = JSON.parse("${encoded}");</script>`,
      { status: 200, headers: { "content-type": "text/html" } }
    )) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "apple",
      market: "ca",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 1 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "apple-official",
      market: "ca",
      marketIndex: 0,
      page: 1,
      itemIndex: 1,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Amazon connector maps official JSON jobs to direct official apply URLs", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        hits: 1,
        jobs: [
          {
            id: "raw-id",
            id_icims: "10425510",
            title: "Software Development Engineer",
            company_name: "Amazon Development Centre Canada ULC",
            location: "CA, BC, Vancouver",
            description: "Build customer-facing systems.",
            job_path: "/en/jobs/10425510/software-development-engineer",
            job_schedule_type: "full-time",
            locations: [
              JSON.stringify({
                normalizedLocation: "Vancouver, British Columbia, CAN",
              }),
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "amazon",
      market: "ca",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 5 });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.sourceId, "amazon:10425510");
    assert.equal(
      result.jobs[0]?.applyUrl,
      "https://www.amazon.jobs/applicant/jobs/10425510/apply"
    );
    assert.equal(result.jobs[0]?.company, "Amazon Development Centre Canada ULC");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Amazon US connector shards by category and returns a resume checkpoint", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    const category = parsed.searchParams.get("category[]") ?? "unknown";
    const offset = Number(parsed.searchParams.get("offset") ?? "0");
    const limit = Number(parsed.searchParams.get("result_limit") ?? "100");

    return new Response(
      JSON.stringify({
        hits: 3,
        jobs: Array.from({ length: limit }, (_, index) => ({
          id: `${category}-${offset + index}`,
          id_icims: `${category}-${offset + index}`,
          title: `${category} Engineer ${offset + index}`,
          company_name: "Amazon",
          location: "US, WA, Seattle",
          description: "Build customer-facing systems.",
          job_path: `/en/jobs/${category}-${offset + index}/engineer`,
          job_schedule_type: "full-time",
          posted_date: "2026-05-20T00:00:00Z",
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "amazon",
      market: "us",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 2 });

    assert.equal(result.jobs.length, 2);
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "amazon-official",
      market: "us",
      shardIndex: 0,
      offset: 2,
    });
    assert.ok(calls[0]?.includes("category%5B%5D=Software+Development"));
    assert.ok(calls[0]?.includes("result_limit=2"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Amazon global connector starts with the unfiltered official feed", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset") ?? "0");
    const limit = Number(parsed.searchParams.get("result_limit") ?? "100");

    return new Response(
      JSON.stringify({
        hits: 10_000,
        jobs: Array.from({ length: limit }, (_, index) => ({
          id: `global-${offset + index}`,
          id_icims: `global-${offset + index}`,
          title: `Global Role ${offset + index}`,
          company_name: "Amazon",
          location: "DE, BE, Berlin",
          description: "Build global systems.",
          job_path: `/en/jobs/global-${offset + index}/global-role`,
          job_schedule_type: "full-time",
          posted_date: "2026-05-20T00:00:00Z",
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "amazon",
      market: "global",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 2 });

    assert.equal(result.jobs.length, 2);
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "amazon-official",
      market: "global",
      shardIndex: 0,
      offset: 2,
      shardMode: "global-unfiltered-first-v2",
    });
    assert.ok(calls[0]?.includes("search.json?offset=0&result_limit=2"));
    assert.ok(!calls[0]?.includes("category%5B%5D="));
    assert.ok(!calls[0]?.includes("country="));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Eightfold official connector maps Microsoft and NVIDIA PCSX jobs", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/api/pcsx/search")) {
      return new Response(
        JSON.stringify({
          status: 200,
          data: {
            count: 1,
            positions: [
              {
                id: 1970393556753318,
                displayJobId: "200026494",
                name: "Software Engineer II-Backend Software",
                locations: ["Canada, British Columbia, Vancouver"],
                standardizedLocations: ["Vancouver, BC, CA"],
                postedTs: 1779844245,
                department: "Software Engineering",
                workLocationOption: "hybrid",
                atsJobId: "200026494",
                positionUrl: "/careers/job/1970393556753318",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 200,
        data: {
          id: 1970393556753318,
          displayJobId: "200026494",
          name: "Software Engineer II-Backend Software",
          locations: ["Canada, British Columbia, Vancouver"],
          standardizedLocations: ["Vancouver, BC, CA"],
          postedTs: 1779844245,
          department: "Software Engineering",
          workLocationOption: "hybrid",
          atsJobId: "200026494",
          jobDescription: "<p>Build backend services for Microsoft Cloud.</p>",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "microsoft",
      market: "ca",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 5 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.sourceId, "microsoft:200026494");
    assert.equal(result.jobs[0]?.company, "Microsoft");
    assert.equal(result.jobs[0]?.workMode, "HYBRID");
    assert.equal(
      result.jobs[0]?.applyUrl,
      "https://apply.careers.microsoft.com/careers/job/1970393556753318"
    );
    assert.match(result.jobs[0]?.description ?? "", /Build backend services/);
    assert.ok(calls.some((url) => url.includes("/api/pcsx/search")));
    assert.ok(calls.some((url) => url.includes("/api/pcsx/position_details")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Eightfold official connector returns an offset resume checkpoint", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url.includes("/api/pcsx/search")) {
      return new Response(
        JSON.stringify({
          status: 200,
          data: {
            count: 2,
            positions: [
              {
                id: 1970393556753318,
                displayJobId: "200026494",
                name: "Software Engineer II-Backend Software",
                locations: ["Canada, British Columbia, Vancouver"],
                standardizedLocations: ["Vancouver, BC, CA"],
                postedTs: 1779844245,
                department: "Software Engineering",
                workLocationOption: "hybrid",
                atsJobId: "200026494",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 200,
        data: {
          id: 1970393556753318,
          displayJobId: "200026494",
          name: "Software Engineer II-Backend Software",
          locations: ["Canada, British Columbia, Vancouver"],
          standardizedLocations: ["Vancouver, BC, CA"],
          postedTs: 1779844245,
          department: "Software Engineering",
          workLocationOption: "hybrid",
          atsJobId: "200026494",
          jobDescription: "<p>Build backend services for Microsoft Cloud.</p>",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "microsoft",
      market: "ca",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 1 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "eightfold-official",
      company: "microsoft",
      market: "ca",
      locationIndex: 0,
      offset: 1,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
