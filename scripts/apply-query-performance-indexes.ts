import "dotenv/config";

import { prisma } from "@/lib/db";

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_searchVector_idx"
    ON "JobCanonical" USING GIN ("searchVector")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_title_trgm_idx"
    ON "JobCanonical" USING GIN ("title" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_company_trgm_idx"
    ON "JobCanonical" USING GIN ("company" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_location_trgm_idx"
    ON "JobCanonical" USING GIN ("location" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_roleFamily_trgm_idx"
    ON "JobCanonical" USING GIN ("roleFamily" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_title_fts_idx"
    ON "JobCanonical" USING GIN (to_tsvector('english', coalesce("title", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_company_fts_idx"
    ON "JobCanonical" USING GIN (to_tsvector('english', coalesce("company", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_location_fts_idx"
    ON "JobCanonical" USING GIN (to_tsvector('english', coalesce("location", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_searchText_trgm_idx"
    ON "JobFeedIndex" USING GIN ("searchText" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_title_trgm_idx"
    ON "JobFeedIndex" USING GIN ("title" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_company_trgm_idx"
    ON "JobFeedIndex" USING GIN ("company" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_location_trgm_idx"
    ON "JobFeedIndex" USING GIN ("location" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_roleFamily_trgm_idx"
    ON "JobFeedIndex" USING GIN ("roleFamily" gin_trgm_ops)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_lowerCompany_status_rankingScore_postedAt_idx"
    ON "JobFeedIndex"(lower("company"), "status", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_searchText_fts_idx"
    ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("searchText", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_title_fts_idx"
    ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("title", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_company_fts_idx"
    ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("company", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_location_fts_idx"
    ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("location", '')))`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_postedAt_idx"
    ON "JobFeedIndex"("status", "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_deadline_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "deadline", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_workMode_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "workMode", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_normalizedEmploymentType_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "normalizedEmploymentType", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_normalizedCareerStage_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "normalizedCareerStage", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_normalizedIndustry_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "normalizedIndustry", "rankingScore" DESC, "postedAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_status_normalizedRoleCategory_rankingScore_postedAt_idx"
    ON "JobFeedIndex"("status", "normalizedRoleCategory", "rankingScore" DESC, "postedAt" DESC)`,
];

async function main() {
  const startedAt = Date.now();

  for (const statement of statements) {
    const label = statement.split("\n")[0].replace(/\s+/g, " ").trim();
    const statementStartedAt = Date.now();
    await prisma.$executeRawUnsafe(statement);
    console.log(
      `[query-performance-indexes] ${label} (${Date.now() - statementStartedAt}ms)`
    );
  }

  console.log(
    `[query-performance-indexes] complete in ${Date.now() - startedAt}ms`
  );
}

main()
  .catch((error) => {
    console.error("[query-performance-indexes] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
