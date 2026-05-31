CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_searchText_fts_idx"
  ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("searchText", '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_title_fts_idx"
  ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("title", '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_company_fts_idx"
  ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("company", '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_location_fts_idx"
  ON "JobFeedIndex" USING GIN (to_tsvector('english', coalesce("location", '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_roleFamily_trgm_idx"
  ON "JobFeedIndex" USING GIN ("roleFamily" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobFeedIndex_lowerCompany_status_rankingScore_postedAt_idx"
  ON "JobFeedIndex"(lower("company"), "status", "rankingScore" DESC, "postedAt" DESC);
