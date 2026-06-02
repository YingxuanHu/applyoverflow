import assert from "node:assert/strict";
import test from "node:test";

import { inspectCompanySiteRoute } from "../src/lib/ingestion/connectors/company-site";
import { assessJobDataQuality } from "../src/lib/ingestion/job-data-quality";

test("rejects generic company pages that leaked into company-site ingestion", () => {
  const assessment = assessJobDataQuality({
    title: "Epicor",
    company: "Epicor",
    description: "Explore our products, newsroom, partners, and resources.",
    applyUrl: "https://www.epicor.com/en-us/products/kinect-platform/",
  });

  assert.equal(assessment.severity, "reject");
  assert.ok(assessment.issues.includes("suspicious_title"));
  assert.ok(assessment.issues.includes("generic_non_job_url"));
});

test("rejects non-job content pages from company-site fallback crawls", () => {
  const assessment = assessJobDataQuality({
    title: "Datasets: sohaibdevv / Tech-Job-Scams-and-Predatory-Recruitment like 1",
    company: "Hugging Face",
    description:
      "Dataset Viewer Auto-converted to Parquet API Embed Duplicate Data Studio with rows about fake job scams and phishing examples.",
    applyUrl:
      "https://huggingface.co/datasets/sohaibdevv/Tech-Job-Scams-and-Predatory-Recruitment",
  });

  assert.equal(assessment.severity, "reject");
  assert.ok(assessment.issues.includes("suspicious_title"));
  assert.ok(assessment.issues.includes("generic_non_job_url"));
});

test("company-site inspection rejects known content URLs before fetching", async () => {
  const inspection = await inspectCompanySiteRoute(
    "https://huggingface.co/datasets/sohaibdevv/Tech-Job-Scams-and-Predatory-Recruitment"
  );

  assert.equal(inspection.extractionRoute, "UNKNOWN");
  assert.equal(inspection.metadata.notAJobSourceReason, "non-job-content-url");
});

test("rejects generic job-listing and media pages from fallback crawls", () => {
  for (const input of [
    {
      title: "Job Listings",
      company: "Kinaxis",
      applyUrl: "https://careers-kinaxis.icims.com/jobs/search?hashed=-625890713",
      description: "Search all jobs by keyword, category, and location.",
    },
    {
      title: "The role of compliance as banks seek to move to SaaS models",
      company: "CGI",
      applyUrl:
        "https://www.cgi.com/en/media/video/role-compliance-banks-seek-move-saas-models",
      description: "Watch this video about compliance and SaaS operating models.",
    },
    {
      title: "Cloud firm sees plenty of jobs coming to Triangle",
      company: "Nasuni",
      applyUrl:
        "https://www.nasuni.com/press-release/cloud-firm-nasuni-sees-plenty-jobs-coming-triangle-winters-kinder/",
      description: "Press release about hiring plans and office expansion.",
    },
  ]) {
    const assessment = assessJobDataQuality(input);
    assert.equal(assessment.severity, "reject", input.applyUrl);
  }
});

test("rejects ATS platform names when the employer is unresolved", () => {
  const assessment = assessJobDataQuality({
    title: "Server",
    company: "Paylocity",
    description: "Serve guests and support restaurant operations.",
    applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/12345",
  });

  assert.equal(assessment.severity, "reject");
  assert.equal(assessment.primaryIssue, "generic_platform_company");
});

test("keeps concrete sparse structured jobs for review instead of rejection", () => {
  const assessment = assessJobDataQuality({
    title: "Process Engineer II Dairy",
    company: "Chobani",
    description: "Responsible for production process improvement.",
    applyUrl: "https://jobs.chobani.com/job/12345/process-engineer-ii-dairy",
  });

  assert.equal(assessment.severity, "review");
  assert.equal(assessment.primaryIssue, "short_description");
});

test("accepts complete concrete job postings", () => {
  const assessment = assessJobDataQuality({
    title: "Senior Software Engineer",
    company: "Amazon",
    description:
      "About the role. Responsibilities include designing distributed systems, writing production code, and collaborating with product teams. Requirements include professional software development experience.",
    applyUrl: "https://www.amazon.jobs/en/jobs/123456/senior-software-engineer",
  });

  assert.equal(assessment.severity, "accept");
});

test("does not reject real roles that contain the word career", () => {
  const assessment = assessJobDataQuality({
    title: "Early Career Recruiter",
    company: "Figma",
    description:
      "The recruiter will own early career hiring programs, partner with hiring managers, and manage candidate pipelines across university recruiting.",
    applyUrl: "https://boards.greenhouse.io/figma/jobs/5828494004?gh_jid=5828494004",
  });

  assert.notEqual(assessment.severity, "reject");
});

test("does not reject real roles whose title contains content namespace words", () => {
  const assessment = assessJobDataQuality({
    title: "Spacesuit Software Engineer",
    company: "Amentum",
    description:
      "About the role. Responsibilities include developing spacesuit software systems, testing embedded control software, and collaborating with aerospace engineering teams.",
    applyUrl:
      "https://pae.wd1.myworkdayjobs.com/amentum_careers/job/US-TX-Houston/Spacesuit-Software-Engineer_R0159266",
  });

  assert.notEqual(assessment.severity, "reject");
});
