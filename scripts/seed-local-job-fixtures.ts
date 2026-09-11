import {
  isLocalDevelopmentAuthEnabled,
  isLocalDevelopmentDatabaseUrl,
} from "../src/lib/local-development-auth";

const LOCAL_FIXTURE_SOURCE_NAME = "OfficialCompany:LocalFixture";
const LOCAL_FIXTURE_PREFIX = "local-fixture-";

const FIXTURES = [
  {
    slug: "senior-full-stack-engineer",
    title: "Senior Full-Stack Engineer",
    company: "Northstar Systems",
    location: "Toronto, ON",
    region: "CA" as const,
    workMode: "HYBRID" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Software Engineering",
    roleCategory: "SOFTWARE_ENGINEERING",
    experienceLevel: "SENIOR" as const,
    experienceGroup: "SENIOR_LEAD_STAFF",
    careerStage: "SENIOR",
    salaryMin: 138000,
    salaryMax: 168000,
  },
  {
    slug: "product-manager-growth",
    title: "Product Manager, Growth",
    company: "Orbit Commerce",
    location: "Remote, Canada",
    region: "CA" as const,
    workMode: "REMOTE" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Product Management",
    roleCategory: "PRODUCT_MANAGEMENT",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 112000,
    salaryMax: 138000,
  },
  {
    slug: "data-analyst-marketplace",
    title: "Data Analyst, Marketplace",
    company: "Maple Market Labs",
    location: "Vancouver, BC",
    region: "CA" as const,
    workMode: "HYBRID" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Data Analytics",
    roleCategory: "DATA_ANALYTICS",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 88000,
    salaryMax: 108000,
  },
  {
    slug: "machine-learning-engineer",
    title: "Machine Learning Engineer",
    company: "Signal Forge",
    location: "New York, NY",
    region: "US" as const,
    workMode: "FLEXIBLE" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Machine Learning",
    roleCategory: "AI_MACHINE_LEARNING",
    experienceLevel: "SENIOR" as const,
    experienceGroup: "SENIOR_LEAD_STAFF",
    careerStage: "SENIOR",
    salaryMin: 155000,
    salaryMax: 190000,
  },
  {
    slug: "financial-analyst-strategy",
    title: "Financial Analyst, Strategy",
    company: "Harbor Capital Partners",
    location: "Chicago, IL",
    region: "US" as const,
    workMode: "ONSITE" as const,
    industry: "FINANCE" as const,
    normalizedIndustry: "FINANCIAL_SERVICES",
    roleFamily: "Financial Analysis",
    roleCategory: "FINANCE_ACCOUNTING",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 95000,
    salaryMax: 125000,
  },
  {
    slug: "customer-success-manager",
    title: "Customer Success Manager",
    company: "Atlas Support Cloud",
    location: "Austin, TX",
    region: "US" as const,
    workMode: "REMOTE" as const,
    industry: "GENERAL" as const,
    normalizedIndustry: "CONSULTING_PROFESSIONAL_SERVICES",
    roleFamily: "Customer Success",
    roleCategory: "CUSTOMER_SUCCESS_SUPPORT",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 82000,
    salaryMax: 105000,
  },
  {
    slug: "growth-marketing-manager",
    title: "Growth Marketing Manager",
    company: "Brightline Media",
    location: "Montreal, QC",
    region: "CA" as const,
    workMode: "HYBRID" as const,
    industry: "GENERAL" as const,
    normalizedIndustry: "MEDIA_ENTERTAINMENT",
    roleFamily: "Marketing",
    roleCategory: "MARKETING",
    experienceLevel: "SENIOR" as const,
    experienceGroup: "SENIOR_LEAD_STAFF",
    careerStage: "SENIOR",
    salaryMin: 92000,
    salaryMax: 118000,
  },
  {
    slug: "operations-program-manager",
    title: "Operations Program Manager",
    company: "Civic Route",
    location: "Ottawa, ON",
    region: "CA" as const,
    workMode: "FLEXIBLE" as const,
    industry: "GENERAL" as const,
    normalizedIndustry: "GOVERNMENT_PUBLIC_SECTOR",
    roleFamily: "Operations",
    roleCategory: "OPERATIONS",
    experienceLevel: "SENIOR" as const,
    experienceGroup: "SENIOR_LEAD_STAFF",
    careerStage: "MANAGER",
    salaryMin: 98000,
    salaryMax: 122000,
  },
  {
    slug: "ux-designer-platform",
    title: "UX Designer, Platform",
    company: "Canvas North",
    location: "Seattle, WA",
    region: "US" as const,
    workMode: "REMOTE" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Design",
    roleCategory: "DESIGN_UX",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 106000,
    salaryMax: 132000,
  },
  {
    slug: "business-development-lead",
    title: "Business Development Lead",
    company: "Pioneer Grid",
    location: "Calgary, AB",
    region: "CA" as const,
    workMode: "ONSITE" as const,
    industry: "GENERAL" as const,
    normalizedIndustry: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    roleFamily: "Business Development",
    roleCategory: "BUSINESS_DEVELOPMENT",
    experienceLevel: "LEAD" as const,
    experienceGroup: "SENIOR_LEAD_STAFF",
    careerStage: "MANAGER",
    salaryMin: 105000,
    salaryMax: 140000,
  },
  {
    slug: "people-operations-specialist",
    title: "People Operations Specialist",
    company: "Evergreen Studio",
    location: "Remote, United States",
    region: "US" as const,
    workMode: "REMOTE" as const,
    industry: "GENERAL" as const,
    normalizedIndustry: "OTHER",
    roleFamily: "Human Resources",
    roleCategory: "HUMAN_RESOURCES_RECRUITING",
    experienceLevel: "ENTRY" as const,
    experienceGroup: "ENTRY_JUNIOR",
    careerStage: "ASSOCIATE_JUNIOR",
    salaryMin: 62000,
    salaryMax: 76000,
  },
  {
    slug: "cybersecurity-analyst",
    title: "Cybersecurity Analyst",
    company: "Keystone Security",
    location: "Boston, MA",
    region: "US" as const,
    workMode: "HYBRID" as const,
    industry: "TECH" as const,
    normalizedIndustry: "TECHNOLOGY",
    roleFamily: "Cybersecurity",
    roleCategory: "CYBERSECURITY",
    experienceLevel: "MID" as const,
    experienceGroup: "MID_EXPERIENCED",
    careerStage: "MID_LEVEL",
    salaryMin: 110000,
    salaryMax: 142000,
  },
] as const;

function descriptionFor(title: string, company: string) {
  return `This is a local development fixture for the ${title} role at ${company}. It is deliberately fictional and exists only to exercise ApplyOverflow's search, filters, master-detail job view, saved jobs, and application workflow.\n\nIn this role, you will work with a cross-functional team to turn well-defined customer and business problems into clear, measurable outcomes. You will contribute to planning, delivery, analysis, and continuous improvement while communicating progress with collaborators across the organization.\n\nWhat you will do\n- Own a focused set of initiatives from discovery through launch.\n- Partner with engineering, design, operations, and leadership on practical decisions.\n- Use qualitative and quantitative feedback to improve the customer experience.\n- Document decisions, share progress, and support a thoughtful team culture.\n\nWhat you bring\n- Strong written communication and sound judgment.\n- Relevant experience working with modern tools and cross-functional teams.\n- A bias toward learning, iteration, and responsible execution.\n\nThis posting is not real and must not be used for an external application.`;
}

async function main() {
  if (
    process.env.LOCAL_DEVELOPMENT_FIXTURE_SEED !== "1" ||
    !isLocalDevelopmentAuthEnabled() ||
    !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)
  ) {
    console.log(
      "[local-fixtures] Skipped: a localhost app, a loopback PostgreSQL database on port 5432, and LOCAL_DEVELOPMENT_FIXTURE_SEED=1 are required."
    );
    return;
  }

  const [{ prisma }, { upsertJobFeedIndex }, { buildDefaultCanonicalVisibilityWhere }] =
    await Promise.all([
      import("../src/lib/db"),
      import("../src/lib/ingestion/search-index"),
      import("../src/lib/jobs/visibility"),
    ]);

  const now = new Date();

  try {
    for (const [index, fixture] of FIXTURES.entries()) {
      const canonicalJobId = `${LOCAL_FIXTURE_PREFIX}${fixture.slug}`;
      const rawJobId = `${LOCAL_FIXTURE_PREFIX}raw-${fixture.slug}`;
      const postedAt = new Date(now.getTime() - (index + 1) * 3_600_000);
      const applyUrl = `https://example.test/apply/${fixture.slug}`;
      const description = descriptionFor(fixture.title, fixture.company);
      const shortSummary = `Fictional local fixture: ${fixture.company} is testing the ${fixture.title} job experience.`;

      await prisma.$transaction(async (tx) => {
        await tx.jobRaw.upsert({
          where: {
            sourceName_sourceId: {
              sourceName: LOCAL_FIXTURE_SOURCE_NAME,
              sourceId: fixture.slug,
            },
          },
          create: {
            id: rawJobId,
            sourceId: fixture.slug,
            sourceName: LOCAL_FIXTURE_SOURCE_NAME,
            sourceTier: "TIER_1",
            rawPayload: {
              isLocalFixture: true,
              title: fixture.title,
              company: fixture.company,
              location: fixture.location,
            },
            fetchedAt: now,
          },
          update: {
            rawPayload: {
              isLocalFixture: true,
              title: fixture.title,
              company: fixture.company,
              location: fixture.location,
            },
            fetchedAt: now,
          },
        });

        await tx.jobCanonical.upsert({
          where: { id: canonicalJobId },
          create: {
            id: canonicalJobId,
            title: fixture.title,
            displayTitle: fixture.title,
            titleConfidence: 1,
            titleStatus: "verified",
            titleSource: "local_fixture",
            company: fixture.company,
            companyKey: fixture.company.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            titleKey: fixture.title.toLowerCase(),
            titleCoreKey: fixture.slug,
            descriptionFingerprint: `local-fixture:${fixture.slug}`,
            location: fixture.location,
            locationConfidence: 1,
            locationStatus: "verified",
            locationSource: "local_fixture",
            region: fixture.region,
            workMode: fixture.workMode,
            workModeConfidence: 1,
            workModeStatus: "verified",
            workModeSource: "local_fixture",
            salaryMin: fixture.salaryMin,
            salaryMax: fixture.salaryMax,
            salaryCurrency: "USD",
            salaryStatus: "verified",
            salaryPeriod: "YEARLY",
            salaryRawText: `$${fixture.salaryMin.toLocaleString()}-$${fixture.salaryMax.toLocaleString()} USD yearly`,
            salaryConfidence: 1,
            salarySource: "local_fixture",
            employmentType: "FULL_TIME",
            employmentTypeGroup: "FULL_TIME",
            employmentTypeConfidence: 1,
            employmentTypeStatus: "verified",
            employmentTypeSource: "local_fixture",
            experienceLevel: fixture.experienceLevel,
            experienceLevelGroup: fixture.experienceGroup,
            experienceLevelSource: "local_fixture",
            experienceLevelEvidenceJson: [fixture.careerStage],
            description,
            descriptionStatus: "strong",
            descriptionConfidence: 1,
            descriptionWordCount: description.split(/\s+/).length,
            shortSummary,
            industry: fixture.industry,
            roleFamily: fixture.roleFamily,
            normalizedEmploymentType: "FULL_TIME",
            normalizedEmploymentTypeConfidence: 1,
            normalizedCareerStage: fixture.careerStage,
            normalizedCareerStageConfidence: 1,
            normalizedIndustry: fixture.normalizedIndustry,
            normalizedIndustries: [fixture.normalizedIndustry],
            normalizedIndustryConfidence: 1,
            normalizedRoleCategory: fixture.roleCategory,
            normalizedRoleCategoryConfidence: 1,
            normalizedRoleCategoryGroup: fixture.roleCategory,
            normalizedRoleCategoryStatus: "CONFIDENT",
            normalizedRoleCategorySource: "local_fixture",
            classificationStatus: "CONFIDENT",
            applyUrl,
            applyUrlKey: `local-fixture:${fixture.slug}`,
            postedAt,
            datePostedConfidence: 1,
            datePostedStatus: "verified",
            datePostedSource: "local_fixture",
            status: "LIVE",
            firstSeenAt: now,
            lastSeenAt: now,
            lastSourceSeenAt: now,
            lastConfirmedAliveAt: now,
            applyUrlValidatedAt: now,
            applyUrlValidationStatus: "VALID",
            finalResolvedApplyUrl: applyUrl,
            availabilityScore: 100,
            qualityScore: 95,
            freshnessScore: 100,
          },
          update: {
            displayTitle: fixture.title,
            location: fixture.location,
            region: fixture.region,
            workMode: fixture.workMode,
            salaryMin: fixture.salaryMin,
            salaryMax: fixture.salaryMax,
            experienceLevel: fixture.experienceLevel,
            experienceLevelGroup: fixture.experienceGroup,
            description,
            descriptionWordCount: description.split(/\s+/).length,
            shortSummary,
            industry: fixture.industry,
            roleFamily: fixture.roleFamily,
            normalizedCareerStage: fixture.careerStage,
            normalizedIndustry: fixture.normalizedIndustry,
            normalizedIndustries: [fixture.normalizedIndustry],
            normalizedRoleCategory: fixture.roleCategory,
            applyUrl,
            postedAt,
            status: "LIVE",
            lastSeenAt: now,
            lastSourceSeenAt: now,
            lastConfirmedAliveAt: now,
            applyUrlValidatedAt: now,
            applyUrlValidationStatus: "VALID",
            finalResolvedApplyUrl: applyUrl,
            availabilityScore: 100,
            qualityScore: 95,
            freshnessScore: 100,
          },
        });

        await tx.jobEligibility.upsert({
          where: { canonicalJobId },
          create: {
            canonicalJobId,
            submissionCategory: index % 4 === 0 ? "REVIEW_REQUIRED" : "READY_TO_APPLY",
            reasonCode: "local_fixture",
            reasonDescription: "Fictional local fixture for product testing.",
            jobValidityConfidence: 1,
            applicationFlowConfidence: 1,
            packageFitConfidence: 0.8,
            submissionQualityConfidence: 0.9,
            customizationLevel: index % 4 === 0 ? 2 : 1,
            evaluatedAt: now,
          },
          update: {
            submissionCategory: index % 4 === 0 ? "REVIEW_REQUIRED" : "READY_TO_APPLY",
            evaluatedAt: now,
          },
        });

        await tx.jobSourceMapping.deleteMany({
          where: {
            canonicalJobId,
            sourceName: LOCAL_FIXTURE_SOURCE_NAME,
          },
        });
        await tx.jobSourceMapping.create({
          data: {
            canonicalJobId,
            rawJobId,
            sourceName: LOCAL_FIXTURE_SOURCE_NAME,
            sourceUrl: applyUrl,
            applyUrlKey: `local-fixture:${fixture.slug}`,
            sourceUrlKey: applyUrl,
            postingIdKey: fixture.slug,
            sourceQualityKind: "DIRECT_COMPANY",
            sourceQualityRank: 100,
            sourceType: "COMPANY_JSON",
            sourceReliability: 1,
            isFullSnapshot: true,
            pollPattern: "LOCAL_FIXTURE",
            isPrimary: true,
            lastSeenAt: now,
          },
        });
      });

      await upsertJobFeedIndex(canonicalJobId);
    }

    const visibleWhere = buildDefaultCanonicalVisibilityWhere(now);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const [liveJobCount, addedTodayCount] = await Promise.all([
      prisma.jobFeedIndex.count({
        where: {
          status: "LIVE",
          canonicalJob: { is: visibleWhere },
        },
      }),
      prisma.jobFeedIndex.count({
        where: {
          status: "LIVE",
          canonicalJob: {
            is: {
              AND: [visibleWhere, { firstSeenAt: { gte: startOfToday } }],
            },
          },
        },
      }),
    ]);

    await prisma.$transaction([
      prisma.jobFeedSummaryCache.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          liveJobCount,
          addedTodayCount,
          expiredTodayCount: 0,
          removedTodayCount: 0,
        },
        update: {
          liveJobCount,
          addedTodayCount,
          expiredTodayCount: 0,
          removedTodayCount: 0,
        },
      }),
      prisma.ingestionRun.create({
        data: {
          connectorKey: "local-fixtures",
          sourceName: LOCAL_FIXTURE_SOURCE_NAME,
          sourceTier: "TIER_1",
          status: "SUCCESS",
          startedAt: now,
          endedAt: now,
          fetchedCount: FIXTURES.length,
          acceptedCount: FIXTURES.length,
          canonicalCreatedCount: FIXTURES.length,
          liveCount: liveJobCount,
          runOptions: { isLocalFixture: true },
        },
      }),
    ]);

    console.log(
      `[local-fixtures] Ready: ${FIXTURES.length} local fixture jobs seeded; public feed summary=${liveJobCount}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[local-fixtures] Unable to prepare local fixture jobs:", error);
  process.exitCode = 1;
});
