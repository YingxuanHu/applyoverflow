import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAndScoreJobTitle,
  extractJobTitle,
  extractTitleFromUrl,
} from "../src/lib/ingestion/extraction/title-extractor";
import { extractNormalizedJobFacts } from "../src/lib/ingestion/extraction/quality-gates";
import { extractAndScoreLocation } from "../src/lib/ingestion/extraction/location-extractor";
import { extractSalaryV2 } from "../src/lib/ingestion/extraction/salary-extractor-v2";
import { extractAndScoreDescription } from "../src/lib/ingestion/extraction/description-extractor";
import {
  employmentTypeToGroup,
  extractJobMetadata,
} from "../src/lib/ingestion/extraction/job-metadata-extractor";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";

function buildJob(overrides: Partial<SourceConnectorJob>): SourceConnectorJob {
  return {
    sourceId: "test-1",
    sourceUrl: "https://example.com/jobs/software-engineer",
    title: "Software Engineer",
    company: "Example",
    location: "Toronto, ON",
    description:
      "About the role. Responsibilities include building reliable systems. Requirements include production engineering experience.",
    applyUrl: "https://example.com/jobs/software-engineer/apply",
    postedAt: null,
    deadline: null,
    employmentType: null,
    workMode: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {},
    ...overrides,
  };
}

test("title extractor accepts clean role titles", () => {
  const goodTitles = [
    "Software Engineer",
    "Senior Data Analyst",
    "Product Manager, Payments",
    "Frontend Engineer II",
    "Machine Learning Engineer, Ads Ranking",
    "C++ Developer",
    "Manager - Risk & Compliance",
    "Nurse Practitioner - Emergency Department",
    "Account Executive, Mid-Market",
    "Software Engineer Intern",
  ];

  for (const title of goodTitles) {
    const selected = extractAndScoreJobTitle(buildJob({ title }), {
      company: "Example",
      urls: ["https://example.com/jobs/software-engineer"],
    });
    assert.notEqual(selected.status, "rejected", title);
    assert.ok(selected.confidence >= 0.6, `${title} confidence ${selected.confidence}`);
    assert.equal(selected.value, title);
  }
});

test("title extractor rejects page chrome, location-only titles, and polluted titles", () => {
  const badTitles = [
    "Careers",
    "Jobs",
    "Join Our Team",
    "Open Positions",
    "Search Results",
    "Apply Now",
    "Toronto",
    "Montreal",
    "Remote",
    "Canada",
    "Privacy Policy",
    "Company Careers - Jobs",
    "Life at Company",
  ];

  for (const title of badTitles) {
    const selected = extractAndScoreJobTitle(buildJob({
      title,
      sourceUrl: "https://example.com/careers",
      applyUrl: "https://example.com/careers",
    }), {
      company: "Company",
      urls: ["https://example.com/careers"],
    });
    assert.ok(
      ["missing", "rejected", "quarantine"].includes(selected.status),
      `${title} selected as ${selected.value} with ${selected.status}`
    );
  }

  const cleaned = extractAndScoreJobTitle(
    buildJob({
      title: "Software Engineer - Toronto, ON - Apply Now - Company Careers",
    }),
    { company: "Company", urls: ["https://company.example/jobs/software-engineer"] }
  );
  assert.equal(cleaned.value, "Software Engineer");
  assert.ok(["verified", "confident"].includes(cleaned.status));
});

test("URL title recovery produces useful candidates without trusting generic ATS URLs", () => {
  assert.equal(
    extractTitleFromUrl("https://example.com/jobs/12345-senior-software-engineer-backend"),
    "Senior Software Engineer Backend"
  );
  assert.equal(
    extractTitleFromUrl("https://example.com/job/senior-product-manager-payments"),
    "Senior Product Manager Payments"
  );
  assert.equal(
    extractTitleFromUrl("https://boards.greenhouse.io/company/careers/job?gh_jid=1234567"),
    null
  );
  assert.equal(
    extractTitleFromUrl("https://example.com/en/jobs/software-engineer-ii-toronto"),
    "Software Engineer II"
  );
  assert.equal(
    extractTitleFromUrl("https://example.com/positions/abc123-machine-learning-engineer"),
    "Machine Learning Engineer"
  );
});

test("title extractor uses cross-source evidence over bad raw title", () => {
  const productManager = extractAndScoreJobTitle(
    buildJob({
      title: "Careers",
      sourceUrl: "https://example.com/jobs/senior-product-manager",
      metadata: { h1: "Senior Product Manager" },
    }),
    { company: "Example", urls: ["https://example.com/jobs/senior-product-manager"] }
  );
  assert.equal(productManager.value, "Senior Product Manager");
  assert.ok(["verified", "confident"].includes(productManager.status));

  const softwareEngineer = extractAndScoreJobTitle(
    buildJob({
      title: "Toronto",
      metadata: { jsonLd: { title: "Software Engineer" } },
    }),
    { company: "Example", urls: ["https://example.com/jobs/software-engineer"] }
  );
  assert.equal(softwareEngineer.value, "Software Engineer");
  assert.ok(["verified", "confident"].includes(softwareEngineer.status));

  const agreed = extractAndScoreJobTitle(
    buildJob({ title: "Software Engineer" }),
    { company: "Example", urls: ["https://example.com/jobs/software-engineer"] }
  );
  assert.equal(agreed.value, "Software Engineer");
  assert.ok(agreed.confidence >= 0.85);
});

test("title extractor parses messy header blocks into title plus metadata", () => {
  const cases: Array<{
    raw: string;
    title: string;
    workMode?: string;
    location?: string;
    employmentType?: string;
  }> = [
    {
      raw: "Attorney: Property Casualty/1st Party Property | Fully Remote\nDallas, TX",
      title: "Attorney: Property Casualty/1st Party Property",
      workMode: "REMOTE",
      location: "Dallas, TX",
    },
    {
      raw: "Licenced Audiologists - AI Training - Boston, US\nRemote",
      title: "Licenced Audiologists - AI Training",
      workMode: "REMOTE",
      location: "Boston, US",
    },
    {
      raw: "Vice President Contracting - Remote in California",
      title: "Vice President Contracting",
      workMode: "REMOTE",
      location: "California",
    },
    {
      raw: "Senior Software Engineer (Remote)",
      title: "Senior Software Engineer",
      workMode: "REMOTE",
    },
    {
      raw: "Remote - Senior Software Engineer",
      title: "Senior Software Engineer",
      workMode: "REMOTE",
    },
    {
      raw: "Hybrid / Toronto - Product Designer",
      title: "Product Designer",
      workMode: "HYBRID",
      location: "Toronto",
    },
    {
      raw: "Product Manager | New York, NY | Full-time",
      title: "Product Manager",
      location: "New York, NY",
      employmentType: "FULL_TIME",
    },
    {
      raw: "Data Analyst • Toronto • Hybrid",
      title: "Data Analyst",
      location: "Toronto",
      workMode: "HYBRID",
    },
    {
      raw: "Frontend Developer - Contract - Remote",
      title: "Frontend Developer",
      employmentType: "CONTRACT",
      workMode: "REMOTE",
    },
    {
      raw: "Software Engineer Intern - Summer 2026 - Toronto",
      title: "Software Engineer Intern",
      location: "Toronto",
    },
    {
      raw: "Nurse Practitioner or Physician Assistant (Hayes Valley) - Sign-On Bonus Available",
      title: "Nurse Practitioner or Physician Assistant (Hayes Valley)",
    },
    {
      raw: "Nurse Practitioner or Physician Assistant - $10,000 Sign-On Bonus Available",
      title: "Nurse Practitioner or Physician Assistant",
    },
    {
      raw: "Software Engineer - Signing Bonus Available",
      title: "Software Engineer",
    },
    {
      raw: "Outside Sales Representative - $3,000 Sign-On Bonus",
      title: "Outside Sales Representative",
    },
    {
      raw: "Class B Delivery Driver $4000 Sign on Bonus",
      title: "Class B Delivery Driver",
    },
  ];

  for (const entry of cases) {
    const result = extractJobTitle(buildJob({ title: entry.raw }), {
      company: "Example",
      urls: ["https://example.com/jobs/software-engineer"],
    });
    assert.equal(result.title.value, entry.title, entry.raw);
    assert.ok(
      ["verified", "confident", "usable_review"].includes(result.title.status),
      `${entry.raw} status ${result.title.status}`
    );
    if (entry.workMode) assert.equal(result.extractedMetadata?.workMode, entry.workMode, entry.raw);
    if (entry.location) assert.equal(result.extractedMetadata?.location, entry.location, entry.raw);
    if (entry.employmentType) {
      assert.equal(result.extractedMetadata?.employmentType, entry.employmentType, entry.raw);
    }
  }
});

test("title extractor preserves real titles containing metadata-looking words", () => {
  const titles = [
    "Remote Sensing Scientist",
    "Remote Operations Manager",
    "Director of Remote Infrastructure",
    "Hybrid Cloud Engineer",
    "Hybrid Mobile Developer",
    "Onsite Support Technician",
    "Onsite Services Manager",
    "Field Service Engineer",
    "Field Marketing Manager",
    "Distributed Systems Engineer",
    "US Tax Manager",
    "Canada Payroll Specialist",
    "Americas Partner Manager",
    "California Privacy Counsel",
    "Regional Manager, Western Canada",
    "Global Mobility Specialist",
    "Contract Manager",
    "Contract Specialist",
    "Contract Lifecycle Manager",
    "Volunteer Coordinator",
    "Volunteer Program Manager",
    "Temporary Works Engineer",
    "Intern Program Manager",
    "Freelance Marketplace Manager",
    "Partnership Manager",
    "Full Stack Engineer",
  ];

  for (const title of titles) {
    const result = extractJobTitle(buildJob({ title }), {
      company: "Example",
      urls: ["https://example.com/jobs/role"],
    });
    assert.equal(result.title.value, title, title);
    assert.deepEqual(result.extractedMetadata, {}, title);
    assert.ok(["verified", "confident"].includes(result.title.status), title);
  }
});

test("title extractor hard-rejects metadata-only and page-chrome fragments", () => {
  const badFragments = [
    "Why Work For Us",
    "Job Description",
    "Apply Now",
    "Posted 2 days ago",
    "Req ID 12345",
    "Engineering",
    "Remote",
    "Fully Remote",
    "Boston",
    "Dallas, TX",
    "Remote in California",
    "Full-time",
  ];

  for (const title of badFragments) {
    const result = extractJobTitle(
      buildJob({
        title,
        sourceUrl: "https://example.com/careers",
        applyUrl: "https://example.com/careers",
      }),
      { company: "Example", urls: ["https://example.com/careers"] }
    );
    assert.ok(
      ["missing", "rejected", "quarantine"].includes(result.title.status),
      `${title} selected as ${result.title.value} (${result.title.status})`
    );
    assert.ok(
      result.rejectedFragments.some((fragment) => fragment.value === title),
      `${title} was not captured as rejected evidence`
    );
  }
});

test("title extractor recovers canonical titles from marketing and SEO pages", () => {
  const cases: Array<{
    raw: string;
    title: string;
    displayTitle: string;
    location: string;
    pageType: string;
  }> = [
    {
      raw: "Earn Money Driving Your Box Truck, Cargo Van, Pickup Truck, SUV, Car in Boston",
      title: "Driver",
      displayTitle: "Driver Jobs in Boston",
      location: "Boston",
      pageType: "gig_signup_page",
    },
    {
      raw: "Driver Jobs in Boston, MA",
      title: "Driver",
      displayTitle: "Driver Jobs in Boston, MA",
      location: "Boston, MA",
      pageType: "seo_category_page",
    },
    {
      raw: "Make Money Delivering in Toronto",
      title: "Delivery Driver",
      displayTitle: "Delivery Driver Jobs in Toronto",
      location: "Toronto",
      pageType: "gig_signup_page",
    },
    {
      raw: "Become a Courier in Vancouver",
      title: "Courier",
      displayTitle: "Courier Jobs in Vancouver",
      location: "Vancouver",
      pageType: "gig_signup_page",
    },
    {
      raw: "Drive With Us in Chicago",
      title: "Driver",
      displayTitle: "Driver Jobs in Chicago",
      location: "Chicago",
      pageType: "gig_signup_page",
    },
    {
      raw: "Moving Jobs in Los Angeles",
      title: "Mover",
      displayTitle: "Mover Jobs in Los Angeles",
      location: "Los Angeles",
      pageType: "seo_category_page",
    },
  ];

  for (const entry of cases) {
    const result = extractJobTitle(buildJob({ title: entry.raw }), {
      company: "Example",
      urls: ["https://example.com/jobs/driver-boston"],
    });
    assert.equal(result.title.value, entry.title, entry.raw);
    assert.equal(result.displayTitle, entry.displayTitle, entry.raw);
    assert.equal(result.extractedMetadata?.location, entry.location, entry.raw);
    assert.equal(result.jobPageType, entry.pageType, entry.raw);
    assert.ok(["verified", "confident", "usable_review"].includes(result.title.status), entry.raw);
  }
});

test("title extractor does not overcorrect marketing false positives", () => {
  const titles = [
    "Earned Value Analyst",
    "Revenue Operations Manager",
    "Growth Marketing Manager",
    "Driver Manager",
    "Delivery Operations Manager",
    "Money Movement Product Manager",
    "Payments Risk Analyst",
    "Truck Mechanic",
    "Fleet Operations Manager",
    "Logistics Coordinator",
  ];

  for (const title of titles) {
    const result = extractJobTitle(buildJob({ title }), {
      company: "Example",
      urls: ["https://example.com/jobs/role"],
    });
    assert.equal(result.title.value, title, title);
    assert.equal(result.jobPageType, "unknown", title);
    assert.ok(["verified", "confident"].includes(result.title.status), title);
  }
});

test("quality gate prevents bad title jobs from entering the feed path", () => {
  const facts = extractNormalizedJobFacts(
    buildJob({
      title: "Careers",
      sourceUrl: "https://example.com/careers",
      applyUrl: "https://example.com/careers",
    }),
    { company: "Example", urls: ["https://example.com/careers"] }
  );

  assert.equal(facts.quality.shouldIndex, false);
  assert.ok(facts.quality.rejectionReasons.includes("TITLE_GENERIC_PAGE"));
});

test("location extraction is conservative and avoids long sentence locations", () => {
  const toronto = extractAndScoreLocation(buildJob({ location: "Toronto, ON" }));
  assert.equal(toronto?.value, "Toronto, ON");
  assert.equal(toronto?.status, "confident");

  const remoteCanada = extractAndScoreLocation(buildJob({ location: "Remote - Canada" }));
  assert.equal(remoteCanada?.value, "Remote - Canada");
  assert.equal(remoteCanada?.status, "confident");

  const multiple = extractAndScoreLocation(buildJob({ location: "Multiple Locations" }));
  assert.equal(multiple?.value, "Multiple Locations");
  assert.equal(multiple?.status, "usable_review");

  const sentence = extractAndScoreLocation(
    buildJob({
      location:
        "This role may be based in Toronto, Vancouver, or Calgary depending on business needs",
    })
  );
  assert.equal(sentence?.value, "Toronto, Vancouver, Calgary");
  assert.notEqual(sentence?.value, "This role may be based in Toronto, Vancouver, or Calgary depending on business needs");

  const chrome = extractAndScoreLocation(buildJob({ location: "Apply now" }));
  assert.equal(chrome, null);
});

test("description extraction grades role content and page chrome", () => {
  const strongText = [
    "About the role",
    "Responsibilities include designing services, reviewing architecture, partnering with product, and improving reliability.",
    "Requirements include several years of software engineering experience, strong communication skills, and production ownership.",
    "Preferred qualifications include cloud experience, observability, incident response, mentoring, and scalable system design.",
    "What you will do is build customer-facing systems, improve deployment quality, and collaborate with data and product teams.",
    "Benefits include health coverage, time off, and professional development support.",
  ].join(" ");
  const strong = extractAndScoreDescription(buildJob({ description: strongText }));
  assert.ok(["strong", "usable"].includes(strong.status));
  assert.ok(strong.wordCount >= 50);

  const chrome = extractAndScoreDescription(
    buildJob({ description: "Skip to main content. Search jobs. Apply now. Cookie policy. Privacy policy." })
  );
  assert.equal(chrome.status, "page_chrome");

  const missing = extractAndScoreDescription(buildJob({ description: "" }));
  assert.equal(missing.status, "missing");

  const short = extractAndScoreDescription(buildJob({ description: "Build reporting dashboards for finance teams." }));
  assert.equal(short.status, "short");
});

test("salary extraction preserves status, source, period, and annualized values", () => {
  const annual = extractSalaryV2({
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    description: "Compensation: $80,000 - $100,000 per year.",
    regionHint: "US",
  });
  assert.equal(annual.status, "present");
  assert.equal(annual.period, "year");
  assert.equal(annual.annualizedMin, 80_000);
  assert.equal(annual.annualizedMax, 100_000);

  const hourly = extractSalaryV2({
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    description: "The pay range is CAD 45/hr - 55/hr for this position.",
    regionHint: "CA",
  });
  assert.equal(hourly.status, "present");
  assert.equal(hourly.period, "hour");
  assert.equal(hourly.currency, "CAD");
  assert.equal(hourly.min, 45);
  assert.equal(hourly.max, 55);

  assert.equal(
    extractSalaryV2({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      description: "Requires 3-5 years of experience.",
      regionHint: "US",
    }).status,
    "not_found"
  );
  assert.equal(
    extractSalaryV2({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      description: "Benefits include 401k matching.",
      regionHint: "US",
    }).status,
    "not_found"
  );
  assert.equal(
    extractSalaryV2({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      description: "Salary not disclosed.",
      regionHint: "US",
    }).status,
    "not_disclosed"
  );
});

test("work mode extraction uses candidate confidence and handles conflicts", () => {
  const fetchedAt = new Date("2026-06-01T12:00:00.000Z");
  const cases: Array<{
    location?: string;
    description?: string;
    expected: "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE" | "UNKNOWN";
  }> = [
    { location: "Remote - Canada", expected: "REMOTE" },
    { location: "Fully Remote", expected: "REMOTE" },
    { location: "Hybrid - Toronto, ON", expected: "HYBRID" },
    { description: "This role is 2 days in office and 3 days remote.", expected: "HYBRID" },
    { location: "On-site - Mississauga", expected: "ONSITE" },
    { description: "This is an office-based role.", expected: "ONSITE" },
    { description: "Remote or hybrid work arrangements are available.", expected: "FLEXIBLE" },
    { description: "No remote work available. This role is onsite only.", expected: "ONSITE" },
  ];

  for (const entry of cases) {
    const job = buildJob({
      location: entry.location ?? "Toronto, ON",
      description: entry.description ?? "",
    });
    const result = extractJobMetadata(job, {
      company: job.company,
      title: job.title,
      location: job.location,
      description: job.description,
      urls: [job.applyUrl, job.sourceUrl],
      fetchedAt,
    });
    assert.equal(result.workMode.value, entry.expected, JSON.stringify(entry));
    assert.ok(result.workMode.confidence >= 0.6, `${entry.expected} confidence too low`);
  }

  const remoteWithBaseRequirement = buildJob({
    location: "Ontario",
    description: "Candidates must be based in Ontario but may work remotely.",
  });
  const result = extractJobMetadata(remoteWithBaseRequirement, {
    company: remoteWithBaseRequirement.company,
    title: remoteWithBaseRequirement.title,
    location: remoteWithBaseRequirement.location,
    description: remoteWithBaseRequirement.description,
    urls: [remoteWithBaseRequirement.applyUrl, remoteWithBaseRequirement.sourceUrl],
    fetchedAt,
  });
  assert.ok(["REMOTE", "FLEXIBLE"].includes(result.workMode.value));
});

test("employment type extraction is contextual and grouped for filters", () => {
  const fetchedAt = new Date("2026-06-01T12:00:00.000Z");
  const cases: Array<{
    title: string;
    expected: string;
    minConfidence?: number;
  }> = [
    { title: "Software Engineer", expected: "UNKNOWN", minConfidence: 0 },
    { title: "Software Engineer Intern", expected: "INTERNSHIP" },
    { title: "Data Analyst Co-op", expected: "CO_OP" },
    { title: "Frontend Developer - 12 Month Contract", expected: "CONTRACT" },
    { title: "Independent Contractor", expected: "CONTRACT" },
    { title: "Part-time Sales Associate", expected: "PART_TIME" },
    { title: "Seasonal Warehouse Associate", expected: "SEASONAL" },
    { title: "Freelance Designer", expected: "FREELANCE" },
    { title: "Apprentice Technician", expected: "APPRENTICESHIP" },
  ];

  for (const entry of cases) {
    const job = buildJob({ title: entry.title });
    const result = extractJobMetadata(job, {
      company: job.company,
      title: job.title,
      location: job.location,
      description: job.description,
      urls: [job.applyUrl, job.sourceUrl],
      fetchedAt,
    });
    assert.equal(result.employmentType.value, entry.expected, entry.title);
    assert.ok(
      result.employmentType.confidence >= (entry.minConfidence ?? 0.6),
      `${entry.title} confidence ${result.employmentType.confidence}`
    );
  }

  for (const title of ["Contract Manager", "Product Manager, Contract Lifecycle Management"]) {
    const job = buildJob({ title });
    const result = extractJobMetadata(job, {
      company: job.company,
      title: job.title,
      location: job.location,
      description: job.description,
      urls: [job.applyUrl, job.sourceUrl],
      fetchedAt,
    });
    assert.notEqual(result.employmentType.value, "CONTRACT", title);
  }

  const volunteer = extractJobMetadata(buildJob({ title: "Volunteer Coordinator" }), {
    company: "Example",
    title: "Volunteer Coordinator",
    location: "Toronto, ON",
    description: "",
    urls: ["https://example.com/jobs/volunteer-coordinator"],
    fetchedAt,
  });
  assert.ok(
    volunteer.employmentType.value === "UNKNOWN" || volunteer.employmentType.confidence < 0.6
  );

  assert.equal(employmentTypeToGroup("INTERNSHIP"), "INTERNSHIP_COOP");
  assert.equal(employmentTypeToGroup("CO_OP"), "INTERNSHIP_COOP");
  assert.equal(employmentTypeToGroup("APPRENTICESHIP"), "INTERNSHIP_COOP");
  assert.equal(employmentTypeToGroup("TEMPORARY"), "TEMPORARY_SEASONAL");
  assert.equal(employmentTypeToGroup("SEASONAL"), "TEMPORARY_SEASONAL");
});

test("posted date extraction separates exact, relative, vague, and invalid values", () => {
  const fetchedAt = new Date("2026-06-01T12:00:00.000Z");
  const jsonLd = buildJob({ metadata: { jsonLd: { datePosted: "2026-05-31" } } });
  const jsonLdResult = extractJobMetadata(jsonLd, {
    company: jsonLd.company,
    title: jsonLd.title,
    location: jsonLd.location,
    description: jsonLd.description,
    urls: [jsonLd.applyUrl, jsonLd.sourceUrl],
    fetchedAt,
  });
  assert.equal(jsonLdResult.datePosted.status, "verified");
  assert.equal(jsonLdResult.datePosted.value?.toISOString().slice(0, 10), "2026-05-31");

  const absolute = buildJob({ description: "Posted May 31, 2026" });
  assert.equal(
    extractJobMetadata(absolute, {
      company: absolute.company,
      title: absolute.title,
      location: absolute.location,
      description: absolute.description,
      urls: [absolute.applyUrl, absolute.sourceUrl],
      fetchedAt,
    }).datePosted.value?.toISOString().slice(0, 10),
    "2026-05-31"
  );

  const twoDaysAgo = buildJob({ description: "Posted 2 days ago" });
  assert.equal(
    extractJobMetadata(twoDaysAgo, {
      company: twoDaysAgo.company,
      title: twoDaysAgo.title,
      location: twoDaysAgo.location,
      description: twoDaysAgo.description,
      urls: [twoDaysAgo.applyUrl, twoDaysAgo.sourceUrl],
      fetchedAt,
    }).datePosted.value?.toISOString().slice(0, 10),
    "2026-05-30"
  );

  const today = buildJob({ description: "Posted today" });
  assert.equal(
    extractJobMetadata(today, {
      company: today.company,
      title: today.title,
      location: today.location,
      description: today.description,
      urls: [today.applyUrl, today.sourceUrl],
      fetchedAt,
    }).datePosted.value?.toISOString().slice(0, 10),
    "2026-06-01"
  );

  const vague = buildJob({ description: "Recently posted" });
  assert.equal(
    extractJobMetadata(vague, {
      company: vague.company,
      title: vague.title,
      location: vague.location,
      description: vague.description,
      urls: [vague.applyUrl, vague.sourceUrl],
      fetchedAt,
    }).datePosted.status,
    "ambiguous"
  );

  const future = buildJob({ metadata: { datePosted: "2026-07-01" } });
  assert.equal(
    extractJobMetadata(future, {
      company: future.company,
      title: future.title,
      location: future.location,
      description: future.description,
      urls: [future.applyUrl, future.sourceUrl],
      fetchedAt,
    }).datePosted.status,
    "invalid"
  );
});

test("deadline extraction avoids posted, start, and ID dates", () => {
  const fetchedAt = new Date("2026-06-01T12:00:00.000Z");
  const jsonLd = buildJob({ metadata: { jsonLd: { validThrough: "2026-07-01" } } });
  assert.equal(
    extractJobMetadata(jsonLd, {
      company: jsonLd.company,
      title: jsonLd.title,
      location: jsonLd.location,
      description: jsonLd.description,
      urls: [jsonLd.applyUrl, jsonLd.sourceUrl],
      fetchedAt,
    }).applicationDeadline.status,
    "verified"
  );

  const applyBy = buildJob({ description: "Apply by June 15, 2026." });
  assert.equal(
    extractJobMetadata(applyBy, {
      company: applyBy.company,
      title: applyBy.title,
      location: applyBy.location,
      description: applyBy.description,
      urls: [applyBy.applyUrl, applyBy.sourceUrl],
      fetchedAt,
    }).applicationDeadline.value?.toISOString().slice(0, 10),
    "2026-06-15"
  );

  const close = buildJob({ description: "Applications close on June 30, 2026." });
  assert.equal(
    extractJobMetadata(close, {
      company: close.company,
      title: close.title,
      location: close.location,
      description: close.description,
      urls: [close.applyUrl, close.sourceUrl],
      fetchedAt,
    }).applicationDeadline.value?.toISOString().slice(0, 10),
    "2026-06-30"
  );

  for (const description of [
    "Expected start date June 30, 2026.",
    "Posted on June 1, 2026.",
    "Job ID 20260601.",
  ]) {
    const job = buildJob({ description });
    assert.equal(
      extractJobMetadata(job, {
        company: job.company,
        title: job.title,
        location: job.location,
        description: job.description,
        urls: [job.applyUrl, job.sourceUrl],
        fetchedAt,
      }).applicationDeadline.status,
      "missing",
      description
    );
  }

  const beforePosted = buildJob({
    metadata: {
      datePosted: "2026-06-10",
      validThrough: "2026-06-01",
    },
  });
  assert.ok(
    ["ambiguous", "invalid"].includes(
      extractJobMetadata(beforePosted, {
        company: beforePosted.company,
        title: beforePosted.title,
        location: beforePosted.location,
        description: beforePosted.description,
        urls: [beforePosted.applyUrl, beforePosted.sourceUrl],
        fetchedAt: new Date("2026-06-15T12:00:00.000Z"),
      }).applicationDeadline.status
    )
  );
});
