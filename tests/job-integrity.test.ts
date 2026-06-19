import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNonJobPosting,
  isClearlyNonJobContentUrl,
} from "../src/lib/job-integrity";

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
    "https://www.epicor.com/en-us/products/kinect-platform/",
    "https://www.epicor.com/en-us/newsroom/",
    "https://careers.example.com/ai-guidelines/",
    "https://automattic.com/protect-yourself-from-job-scams/",
    "https://huggingface.co/datasets/sohaibdevv/Tech-Job-Scams-and-Predatory-Recruitment",
    "https://huggingface.co/models/company/career-advice-model",
    "https://www.cgi.com/en/media/video/role-compliance-banks-seek-move-saas-models",
    "https://www.nasuni.com/press-release/cloud-firm-nasuni-sees-plenty-jobs-coming-triangle-winters-kinder/",
    "https://spire.com/whitepaper/weather-climate/the-role-of-weather-data-in-vessel-performance/",
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

test("isClearlyNonJobContentUrl flags resource pages without blocking real job words", () => {
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://huggingface.co/datasets/sohaibdevv/Tech-Job-Scams-and-Predatory-Recruitment"
    ),
    true
  );
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://pae.wd1.myworkdayjobs.com/amentum_careers/job/US-TX-Houston/Spacesuit-Software-Engineer_R0159266"
    ),
    false
  );
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://www.google.com/about/careers/applications/jobs/results"
    ),
    false
  );
  assert.equal(
    isClearlyNonJobContentUrl("https://www.edc.ca/en/about-us/careers.html"),
    false
  );
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://www.atlassian.com/company/careers/resources/applying"
    ),
    true
  );
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://remotive.com/remote-jobs/product/staff-product-engineer-campinas-2090902"
    ),
    false
  );
  assert.equal(
    isClearlyNonJobContentUrl(
      "https://www.coopersurgical.com/product/insorb-absorbable-skin-stapler/"
    ),
    true
  );
});

test("classifyNonJobPosting rejects generic careers landing pages", () => {
  for (const input of [
    {
      title: "Join GitLab",
      description: "Explore open positions, benefits, and our company culture.",
      applyUrl: "https://about.gitlab.com/jobs/",
      reason: "generic_careers_url",
    },
    {
      title: "Search Jobs",
      description: "Search by keyword or location and create job alerts.",
      applyUrl: "https://jobs.citi.com/category/research-jobs/287/19623/1",
      reason: "non_job_title",
    },
    {
      title: "Job Listings",
      description: "Search by keyword or location and browse all available openings.",
      applyUrl: "https://careers-kinaxis.icims.com/jobs/search?hashed=-625890713",
      reason: "non_job_title",
    },
    {
      title: "Join the Hybrid Cloud Team",
      description:
        "Explore open roles. Widget title goes here. Meta text goes here. Learn more about careers and culture.",
      applyUrl: "https://careers.hpe.com/us/en/hybrid-cloud",
      reason: "non_job_title",
    },
    {
      title: "It starts with opportunity",
      description:
        "Explore opportunities. Search our open positions. Join a group of passionate professionals transforming industries.",
      applyUrl: "https://iongroup.com/careers/",
      reason: "non_job_title",
    },
  ]) {
    const result = classifyNonJobPosting(input);

    assert.equal(result.detected, true, input.applyUrl);
    assert.equal(result.reason, input.reason, input.applyUrl);
  }
});

test("classifyNonJobPosting rejects company-site fallback pages that are not jobs", () => {
  for (const input of [
    {
      title: "Will AI Replace Jobs?",
      description:
        "With the rise of artificial intelligence in the workplace, people are concerned about losing their jobs to AI. Try Agentforce and share the story.",
      applyUrl:
        "https://www.salesforce.com/ap/artificial-intelligence/will-ai-replace-jobs/",
      reason: "non_job_title",
    },
    {
      title: "Thanks for applying to Remote!",
      description:
        "While you wait to hear back from us, get ready for your next interview with interview prep tools and AI interview practice.",
      applyUrl: "https://www.notion.so/11ccb4dadab4805f80a7c73b6567bd8f?pvs=21",
      reason: "non_job_title",
    },
    {
      title: "Current Opening",
      description:
        "Faircent careers opportunities. How Faircent works. What Faircent does. Lender - Borrower Sample Agreement.",
      applyUrl: "https://www.faircent.com/personal-loan",
      reason: "non_job_title",
    },
    {
      title: "Please fill details and apply",
      description:
        "Faircent careers opportunities. Current opening. How it works. Lender - Borrower Sample Agreement.",
      applyUrl: "https://www.faircent.com/personal-loan",
      reason: "non_job_title",
    },
  ]) {
    const result = classifyNonJobPosting(input);
    assert.equal(result.detected, true, input.applyUrl);
    assert.equal(result.reason, input.reason, input.applyUrl);
  }
});

test("classifyNonJobPosting rejects thank-you and lead-capture pages", () => {
  for (const input of [
    {
      title: "Job seeker didn’t know to send thank you note after interview, people came to the rescue",
      description: "I hate etiquette.",
      applyUrl: "https://www.upworthy.com/thank-you-note-after-interview",
      reason: "non_job_title",
    },
    {
      title: "THANK YOU",
      description:
        "Your information has been submitted to our team, and someone will reach out to you shortly.",
      applyUrl: "https://www.tunein.com/thank-you",
      reason: "non_job_title",
    },
    {
      title: "Thank you!",
      description:
        "Challenges and Opportunities in Cloud-Based Simulation - An Engineer's Perspective TY!",
      applyUrl: "https://www.rescale.com/webinars/thank-you",
      reason: "non_job_title",
    },
    {
      title: "Be positioned for Growth with InsurePay Reconciliation Thank You",
      description: "Thank you for requesting a copy of this whitepaper.",
      applyUrl: "https://www.duckcreek.com/whitepaper/insurepay-reconciliation-thank-you",
      reason: "thank_you_confirmation_page",
    },
  ]) {
    const result = classifyNonJobPosting(input);
    assert.equal(result.detected, true, input.title);
    assert.equal(result.reason, input.reason, input.title);
  }
});

test("classifyNonJobPosting allows real jobs with thank-you-adjacent wording", () => {
  const result = classifyNonJobPosting({
    title: "Customer Success Manager",
    description:
      "About the role. Responsibilities include improving customer onboarding and post-sale communication. Requirements include SaaS customer success experience.",
    applyUrl: "https://jobs.example.com/customer-success-manager-123",
  });

  assert.equal(result.detected, false);
});

test("classifyNonJobPosting rejects generic ATS board pages even when a scraped title looks real", () => {
  for (const applyUrl of [
    "https://jobs.lever.co/buckmason/?workplaceType=remote",
    "https://boards.greenhouse.io/example",
    "https://jobs.ashbyhq.com/example",
    "https://apply.workable.com/example/",
  ]) {
    const result = classifyNonJobPosting({
      title: "Associate Raw Material Sourcing CONTRACTOR (PT/FT)",
      description: "Location type All On-site Hybrid Remote. Department Apparel Design and Production.",
      applyUrl,
    });

    assert.equal(result.detected, true, applyUrl);
    assert.equal(result.reason, "generic_careers_url", applyUrl);
  }
});

test("classifyNonJobPosting rejects department-only titles", () => {
  for (const title of ["Software Engineering", "Product Management", "Customer Success"]) {
    const result = classifyNonJobPosting({
      title,
      description: "Explore opportunities across this team.",
      applyUrl: "https://example.com/careers",
    });

    assert.equal(result.detected, true, title);
    assert.equal(result.reason, "generic_department_url", title);
  }
});

test("classifyNonJobPosting rejects redirect and region-only title rows", () => {
  for (const title of ["redirect", "APAC", "EMEA"]) {
    const result = classifyNonJobPosting({
      title,
      description: "Beginning of the main content section.",
      applyUrl: "https://example.taleo.net/careersection/jobdetail.ftl?job=123",
    });

    assert.equal(result.detected, true, title);
  }
});

test("classifyNonJobPosting rejects malformed scraped page titles", () => {
  for (const title of [
    "MassCareers",
    "CSS Annonce FR.pdf",
    "Job Title",
    "Bewerbung",
    "Initiativbewerbung",
    "Stellen",
    "搜索结果： \"\".",
    "We apologize for the inconvenience...",
    "K1 Speed Careers",
    "Customer Service Jobs",
    "Open Your Own Indoor Go Kart Franchise",
    "About AasaanJobs",
  ]) {
    const result = classifyNonJobPosting({
      title,
      description: "Search by keyword, location, and department.",
      applyUrl: "https://example.com/careers/search",
    });

    assert.equal(result.detected, true, title);
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
    {
      title: "Business Operations",
      description:
        "About the role. Responsibilities include solving business problems, working across product and go-to-market teams, and improving operating metrics. Requirements include experience in analytical business operations.",
      applyUrl: "https://boards.greenhouse.io/figma/jobs/5786381004?gh_jid=5786381004",
    },
    {
      title: "AI Account Strategist, Early Career",
      description:
        "About the role. Responsibilities include working with customers on account strategy and AI adoption.",
      applyUrl: "https://jobs.ashbyhq.com/nectar-social/53bed905-b75d-43e6-8581-7802f9852ddf",
    },
    {
      title: "Business Development Representative (Japanese and English speaking)",
      description:
        "About the role. Responsibilities include outbound prospecting and building pipeline.",
      applyUrl: "https://www.relexsolutions.com/careers/jobs/?gh_jid=6675540003",
    },
    {
      title: "Senior Software Engineer - Risk",
      description:
        "About the role. Responsibilities include building secure services and collaborating with product teams. Requirements include professional software engineering experience.",
      applyUrl: "https://job-boards.greenhouse.io/tenableinc/jobs/5099269008",
    },
  ]) {
    const result = classifyNonJobPosting(input);
    assert.equal(result.detected, false, input.applyUrl);
  }
});
