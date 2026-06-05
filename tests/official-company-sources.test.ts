import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAmazonSearchUrl,
  buildAppleSearchUrl,
  buildBankOfAmericaSearchUrl,
  buildHomeDepotSearchUrl,
  buildGoogleSearchUrl,
  buildEightfoldDetailUrl,
  buildEightfoldSearchUrl,
  buildNetflixDetailUrl,
  buildNetflixSearchUrl,
  createOfficialCompanyConnector,
  extractBankOfAmericaJobDetailFromHtml,
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
  const companyJsonHtmlFallback = getSourceQualitySnapshot({
    sourceName: "CompanyJson:example",
    sourceUrl: "https://example.com/careers/article-about-jobs",
    applyUrl: "https://example.com/careers/article-about-jobs",
    metadata: { source: "company-site", route: "html" },
  });
  const companyJsonStructured = getSourceQualitySnapshot({
    sourceName: "CompanyJson:example",
    sourceUrl: "https://example.com/careers/jobs/456",
    applyUrl: "https://example.com/careers/jobs/456",
    metadata: { source: "company-site", route: "structured" },
  });

  assert.equal(official.kind, "FIRST_PARTY_COMPANY");
  assert.equal(ats.kind, "DIRECT_COMPANY");
  assert.equal(aggregator.kind, "AGGREGATOR_REDIRECT");
  assert.equal(aggregatorWithDirectApplyUrl.kind, "AGGREGATOR_REDIRECT");
  assert.equal(companyHtml.kind, "WEAK_SCRAPED_COPY");
  assert.equal(companyJsonHtmlFallback.kind, "WEAK_SCRAPED_COPY");
  assert.equal(companyJsonStructured.kind, "DIRECT_COMPANY");
  assert.ok(official.rank > ats.rank);
  assert.ok(ats.rank > aggregator.rank);
  assert.ok(companyJsonStructured.rank > companyJsonHtmlFallback.rank);
  assert.ok(companyHtml.rank > aggregator.rank);
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
  assert.deepEqual(parseOfficialCompanySourceToken("bankofamerica"), {
    company: "bankofamerica",
    market: "global",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("google:global"), {
    company: "google",
    market: "global",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("homedepot:global"), {
    company: "homedepot",
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
  assert.deepEqual(parseOfficialCompanySourceToken("netflix:global"), {
    company: "netflix",
    market: "global",
  });
  assert.deepEqual(parseOfficialCompanySourceToken("starbucks:north-america"), {
    company: "starbucks",
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

test("Bank of America official connector uses first-party search servlet", () => {
  const connector = createOfficialCompanyConnector({
    company: "bankofamerica",
    market: "global",
  });

  assert.equal(connector.key, "official-company:bankofamerica:global");
  assert.equal(connector.sourceName, "OfficialCompany:Bank of America");
  assert.equal(connector.sourceTier, "TIER_1");
  assert.equal(connector.freshnessMode, "FULL_SNAPSHOT");
  assert.equal(
    buildBankOfAmericaSearchUrl({ offset: 100, limit: 50 }),
    "https://careers.bankofamerica.com/services/jobssearchservlet?start=100&rows=150&search=getAllJobs"
  );
});

test("Home Depot official connector uses the corporate CWS jobs API", () => {
  const connector = createOfficialCompanyConnector({
    company: "homedepot",
    market: "global",
  });

  assert.equal(connector.key, "official-company:homedepot:global");
  assert.equal(connector.sourceName, "OfficialCompany:Home Depot");
  assert.equal(connector.sourceTier, "TIER_1");
  assert.equal(connector.freshnessMode, "FULL_SNAPSHOT");

  const url = new URL(buildHomeDepotSearchUrl({ offset: 101, limit: 50 }));
  assert.equal(url.origin + url.pathname, "https://jobsapi-internal.m-cloud.io/api/job");
  assert.equal(url.searchParams.get("Organization"), "1814");
  assert.equal(url.searchParams.get("Limit"), "50");
  assert.equal(url.searchParams.get("offset"), "101");
  assert.equal(url.searchParams.get("facet"), "parent_category:Corporate");
  assert.equal(url.searchParams.get("callback"), "CWS.jobs.jobCallback");
});

test("Home Depot official connector maps corporate CWS jobs", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(
      `CWS.jobs.jobCallback(${JSON.stringify({
        totalHits: 2,
        queryResult: [
          {
            id: 23464632,
            ref: "Req181933",
            entity_status: "Open",
            title: "Data Scientist - Network Strategy",
            company_name: "Home Depot / THD",
            primary_city: "Atlanta",
            primary_state: "GA",
            primary_country: "US",
            parent_category: "Corporate",
            primary_category: "Supply Chain",
            location_type: "Multisite",
            ats_portalid: "Workday",
            open_date: "2026-06-04T18:11:18.630Z",
            url: "https://careers.homedepot.com/job/23464632/data-scientist-network-strategy-atlanta-ga/",
            description:
              '<div data-field="description"><b>Position Purpose:</b><p>Build data science initiatives.</p></div>',
          },
        ],
      })})`,
      { status: 200, headers: { "content-type": "application/javascript" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "homedepot",
      market: "global",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 1 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.sourceId, "homedepot:Req181933");
    assert.equal(result.jobs[0]?.company, "Home Depot");
    assert.equal(result.jobs[0]?.location, "Atlanta, GA, US");
    assert.equal(result.jobs[0]?.workMode, "HYBRID");
    assert.equal(
      result.jobs[0]?.applyUrl,
      "https://careers.homedepot.com/job/23464632/data-scientist-network-strategy-atlanta-ga/"
    );
    assert.match(result.jobs[0]?.description ?? "", /Position Purpose: Build data science/);
    assert.deepEqual(result.checkpoint, {
      kind: "home-depot-official",
      offset: 2,
    });
    assert.ok(calls[0]?.includes("parent_category%3ACorporate"));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Bank of America official connector continues when totalMatches is a string", async () => {
  const originalFetch = globalThis.fetch;
  const originalFetchDetails = process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS;
  const fetchedUrls: string[] = [];
  process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS = "0";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        totalMatches: "1,588",
        jobsList: [
          {
            postingTitle: "Credit Officer II",
            jobRequisitionId: "26017431",
            jcrURL:
              "/en-us/job-detail/26017431/credit-officer-ii-boston-massachusetts-united-states",
            city: "Boston",
            state: "Massachusetts",
            country: "United States",
            postedDate: "06/04/2026",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "bankofamerica",
      market: "global",
    });
    const result = await connector.fetchJobs({
      now: new Date("2026-06-04T00:00:00.000Z"),
      limit: 1,
      log: () => undefined,
    });

    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "bank-of-america-official",
      offset: 1,
    });
    assert.equal(result.jobs.length, 1);
    assert.equal(fetchedUrls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFetchDetails == null) {
      delete process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS;
    } else {
      process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS = originalFetchDetails;
    }
  }
});

test("Bank of America official connector pages with servlet end-index rows", async () => {
  const originalFetch = globalThis.fetch;
  const originalFetchDetails = process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS;
  const fetchedUrls: string[] = [];
  process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS = "0";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    fetchedUrls.push(url.toString());
    const start = Number(url.searchParams.get("start") ?? "0");
    const jobsList = Array.from({ length: start === 0 ? 100 : 50 }, (_, index) => {
      const id = start + index + 1;
      return {
        postingTitle: `Banking role ${id}`,
        jobRequisitionId: String(26000000 + id),
        jcrURL: `/en-us/job-detail/${26000000 + id}/banking-role-${id}`,
        city: "Charlotte",
        state: "North Carolina",
        country: "United States",
        postedDate: "06/04/2026",
      };
    });

    return new Response(JSON.stringify({ totalMatches: "1,588", jobsList }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "bankofamerica",
      market: "global",
    });
    const result = await connector.fetchJobs({
      now: new Date("2026-06-04T00:00:00.000Z"),
      limit: 150,
      log: () => undefined,
    });

    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "bank-of-america-official",
      offset: 150,
    });
    assert.equal(result.jobs.length, 150);
    assert.equal(
      fetchedUrls[0],
      "https://careers.bankofamerica.com/services/jobssearchservlet?start=0&rows=100&search=getAllJobs"
    );
    assert.equal(
      fetchedUrls[1],
      "https://careers.bankofamerica.com/services/jobssearchservlet?start=100&rows=150&search=getAllJobs"
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFetchDetails == null) {
      delete process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS;
    } else {
      process.env.OFFICIAL_COMPANY_BANK_OF_AMERICA_FETCH_DETAILS = originalFetchDetails;
    }
  }
});

test("Bank of America detail parser extracts job-specific apply and metadata", () => {
  const detail = extractBankOfAmericaJobDetailFromHtml(`
    <div class="job-description-body js-job-description-body"
      data-jobTimeType="Full time"
      data-jobTitle="CFO Valuation Specialist"
      data-jobSaveLocation="New York, NY"></div>
    <a href="https://ghr.wd1.myworkdayjobs.com/Lateral-US/job/New-York/CFO-Valuation-Specialist_26002591">Acknowledge</a>
    <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "JobPosting",
        "datePosted": "2026-03-24",
        "employmentType": "Full time",
        "title": "CFO Valuation Specialist",
        "description": "<p>Job Description:</p><p>Build valuation controls.</p>"
      }
    </script>
  `);

  assert.equal(detail.title, "CFO Valuation Specialist");
  assert.equal(detail.location, "New York, NY");
  assert.equal(detail.employmentType, "Full time");
  assert.equal(
    detail.applyUrl,
    "https://ghr.wd1.myworkdayjobs.com/Lateral-US/job/New-York/CFO-Valuation-Specialist_26002591"
  );
  assert.equal(detail.description, "Job Description: Build valuation controls.");
  assert.equal(detail.postedAt?.toISOString().slice(0, 10), "2026-03-24");
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
    "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&num=100&start=0&sort_by=relevance&location=Canada"
  );
  const starbucksConfig = {
    company: "starbucks" as const,
    displayName: "Starbucks" as const,
    domain: "starbucks.com" as const,
    baseUrl: "https://apply.starbucks.com" as const,
  };
  assert.equal(
    buildEightfoldSearchUrl({
      config: starbucksConfig,
      location: "US",
      jobCategory: "technology",
      offset: 0,
      limit: 50,
    }),
    "https://apply.starbucks.com/api/pcsx/search?domain=starbucks.com&num=50&start=0&sort_by=relevance&location=US&filter_job_category=technology"
  );
  assert.equal(
    buildEightfoldDetailUrl({ config: microsoftConfig, positionId: "1970393556753318" }),
    "https://apply.careers.microsoft.com/api/pcsx/position_details?domain=microsoft.com&position_id=1970393556753318"
  );
  assert.equal(
    buildNetflixSearchUrl({ offset: 100, limit: 50 }),
    "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&start=100&num=50"
  );
  assert.equal(
    buildNetflixDetailUrl({ positionId: "790316087198" }),
    "https://explore.jobs.netflix.net/api/apply/v2/jobs/790316087198?domain=netflix.com"
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

test("Starbucks official connector shards Eightfold office categories", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/api/pcsx/search")) {
      const parsed = new URL(url);
      const category = parsed.searchParams.get("filter_job_category");
      const positions =
        category === "technology"
          ? [
              {
                id: 481032940,
                displayJobId: "260032940",
                name: "software quality assurance analyst sr- ST; Nashville TN",
                locations: ["US", "Nashville, Tennessee, United States"],
                standardizedLocations: ["US", "Nashville, TN, US"],
                postedTs: 1780435529,
                department: "Quality Assurance",
                workLocationOption: "hybrid",
                atsJobId: "260032940",
              },
            ]
          : [];

      return new Response(
        JSON.stringify({
          status: 200,
          data: {
            count: positions.length,
            positions,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 200,
        data: {
          id: 481032940,
          displayJobId: "260032940",
          name: "software quality assurance analyst sr- ST; Nashville TN",
          locations: ["US", "Nashville, Tennessee, United States"],
          standardizedLocations: ["US", "Nashville, TN, US"],
          postedTs: 1780435529,
          department: "Quality Assurance",
          workLocationOption: "hybrid",
          atsJobId: "260032940",
          jobDescription: "<p>Validate Starbucks technology systems.</p>",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "starbucks",
      market: "us",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 5 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.sourceId, "starbucks:260032940");
    assert.equal(result.jobs[0]?.company, "Starbucks");
    assert.equal(result.jobs[0]?.workMode, "HYBRID");
    assert.match(result.jobs[0]?.description ?? "", /Validate Starbucks technology systems/);
    assert.ok(calls.some((url) => url.includes("filter_job_category=technology")));
    assert.ok(!calls.some((url) => url.includes("filter_job_category=retail+stores")));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Netflix official connector maps official apply API jobs", async () => {
  const previousFetch = globalThis.fetch;
  const previousDetailFlag = process.env.OFFICIAL_COMPANY_NETFLIX_FETCH_DETAILS;
  process.env.OFFICIAL_COMPANY_NETFLIX_FETCH_DETAILS = "true";
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/api/apply/v2/jobs/790316087198")) {
      return new Response(
        JSON.stringify({
          id: 790316087198,
          name: "Ad Sales Learning Enablement Manager (UCAN)",
          posting_name: "Ad Sales Learning Enablement Manager (UCAN)",
          locations: ["New York,New York,United States of America"],
          department: "Talent",
          business_unit: "Streaming",
          t_create: 1779926400,
          t_update: 1779926400,
          ats_job_id: "JR40835",
          display_job_id: "JR40835",
          job_description: "<p>Build learning programs for Netflix Ads.</p>",
          canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790316087198",
          work_location_option: "onsite",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        count: 1,
        positions: [
          {
            id: 790316087198,
            name: "Ad Sales Learning Enablement Manager (UCAN)",
            posting_name: "Ad Sales Learning Enablement Manager (UCAN)",
            location: "New York,New York,United States of America",
            locations: ["New York,New York,United States of America"],
            department: "Talent",
            business_unit: "Streaming",
            t_create: 1779926400,
            ats_job_id: "JR40835",
            display_job_id: "JR40835",
            canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790316087198",
            work_location_option: "onsite",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "netflix",
      market: "global",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 5 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.sourceId, "netflix:JR40835");
    assert.equal(result.jobs[0]?.company, "Netflix");
    assert.equal(result.jobs[0]?.workMode, "ONSITE");
    assert.equal(
      result.jobs[0]?.applyUrl,
      "https://explore.jobs.netflix.net/careers/job/790316087198"
    );
    assert.match(result.jobs[0]?.description ?? "", /Build learning programs/);
    assert.ok(calls.some((url) => url.includes("/api/apply/v2/jobs?")));
    assert.ok(calls.some((url) => url.includes("/api/apply/v2/jobs/790316087198")));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDetailFlag == null) {
      delete process.env.OFFICIAL_COMPANY_NETFLIX_FETCH_DETAILS;
    } else {
      process.env.OFFICIAL_COMPANY_NETFLIX_FETCH_DETAILS = previousDetailFlag;
    }
  }
});

test("Netflix official connector returns an offset resume checkpoint", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/api/apply/v2/jobs/790316087198")) {
      return new Response(
        JSON.stringify({
          id: 790316087198,
          name: "Remote Studio Engineer",
          locations: ["USA - Remote"],
          display_job_id: "JR40835",
          job_description: "Support global production tooling.",
          canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790316087198",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        count: 2,
        positions: [
          {
            id: 790316087198,
            name: "Remote Studio Engineer",
            locations: ["USA - Remote"],
            display_job_id: "JR40835",
            canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790316087198",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const connector = createOfficialCompanyConnector({
      company: "netflix",
      market: "global",
    });
    const result = await connector.fetchJobs({ now: new Date(), limit: 1 });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.workMode, "REMOTE");
    assert.equal(
      result.jobs[0]?.description,
      "Locations: USA - Remote."
    );
    assert.equal(result.exhausted, false);
    assert.deepEqual(result.checkpoint, {
      kind: "netflix-official",
      offset: 1,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
