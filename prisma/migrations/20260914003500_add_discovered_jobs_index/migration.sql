-- Build without blocking ingestion or job-board reads.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "JobCanonical_status_firstSeenAt_idx"
ON "JobCanonical" ("status", "firstSeenAt" DESC);
