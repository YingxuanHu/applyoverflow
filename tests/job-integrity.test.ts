import assert from "node:assert/strict";
import test from "node:test";

import { classifyNonJobPosting } from "../src/lib/job-integrity";

test("classifyNonJobPosting rejects location-only titles", () => {
  const result = classifyNonJobPosting({
    title: "Montreal",
    description: "Responsibilities include supporting customers and partners.",
    applyUrl: "https://example.com/careers/software-engineer-123",
  });

  assert.equal(result.detected, true);
  assert.equal(result.reason, "location_only_title");
});

test("classifyNonJobPosting rejects article and resource URLs", () => {
  for (const applyUrl of [
    "https://www.chef.io/blog/push-jobs-server-1-1-5-and-future-improvements",
    "https://www.uplers.com/blog/wordpress-developer-job-description/",
    "https://www.atlassian.com/company/careers/resources/applying",
  ]) {
    const result = classifyNonJobPosting({
      title: "Software Developer Job Description",
      description: "This guide explains hiring, benefits, and interview steps.",
      applyUrl,
    });

    assert.equal(result.detected, true, applyUrl);
    assert.equal(result.reason, "article_or_docs_url", applyUrl);
  }
});

test("classifyNonJobPosting rejects generic careers landing pages", () => {
  const result = classifyNonJobPosting({
    title: "Join GitLab",
    description: "Explore open positions, benefits, and our company culture.",
    applyUrl: "https://about.gitlab.com/jobs/",
  });

  assert.equal(result.detected, true);
  assert.equal(result.reason, "generic_careers_url");
});

test("classifyNonJobPosting rejects department-only titles", () => {
  for (const title of ["Software Engineering", "Product Management", "Customer Success"]) {
    const result = classifyNonJobPosting({
      title,
      description: "Explore opportunities across this team.",
      applyUrl: "https://example.com/careers/open-positions?gh_jid=123456",
    });

    assert.equal(result.detected, true, title);
    assert.equal(result.reason, "non_job_title", title);
  }
});

test("classifyNonJobPosting rejects talent-pipeline placeholders", () => {
  for (const title of [
    "Principal Data Architect - Not an Active Opening, Building Talent Pipeline",
    "Portfolio Administrator – Evergreen / Future Opportunities",
    "[PIPELINE] Community Manager - One Year Contract",
    "General Application",
    "Expression of Interest - Engineering",
    "Join our Talent Community",
  ]) {
    const result = classifyNonJobPosting({
      title,
      description: "This is not an active opening. We are building a talent pipeline.",
      applyUrl: "https://example.com/careers/open-positions?gh_jid=123456",
    });

    assert.equal(result.detected, true, title);
    assert.equal(result.reason, "non_job_title", title);
  }
});

test("classifyNonJobPosting allows concrete job postings", () => {
  for (const input of [
    {
      title: "Engineering Manager",
      description:
        "About the role. Responsibilities include leading engineers. Requirements include experience managing software teams.",
      applyUrl: "https://manifesto.co.uk/careers/engineering-manager",
    },
    {
      title: "Software Development Engineer",
      description:
        "DESCRIPTION The team is looking for a Software Development Engineer. BASIC QUALIFICATIONS include professional software development experience.",
      applyUrl: "https://www.amazon.jobs/en/jobs/123456/software-development-engineer",
    },
  ]) {
    const result = classifyNonJobPosting(input);
    assert.equal(result.detected, false, input.applyUrl);
  }
});
