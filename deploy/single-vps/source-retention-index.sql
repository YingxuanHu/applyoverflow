-- Run with psql outside a transaction, during a low-load window. This focused
-- partial index avoids scanning all historical task payloads for the report.
-- Production: -v source_index_tablespace=applyoverflow_volume, after checking
-- the attached mount and its backup reserve. Local tests: pg_default.
\set ON_ERROR_STOP on
\if :{?source_index_tablespace}
\else
  DO $$ BEGIN RAISE EXCEPTION 'Set source_index_tablespace explicitly; no fallback to the root disk.'; END $$;
\endif
SET lock_timeout = '1s';
SET statement_timeout = '5min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SourceTask_successfulPoll_finishedAt_idx"
  ON "SourceTask" ("finishedAt" DESC)
  TABLESPACE :"source_index_tablespace"
  WHERE "kind" = 'CONNECTOR_POLL' AND "status" = 'SUCCESS';
SELECT COALESCE((SELECT indisvalid AND indisready FROM pg_index
  WHERE indexrelid = '"SourceTask_successfulPoll_finishedAt_idx"'::regclass), false) AS source_index_valid \gset
\if :source_index_valid
  \echo 'Source retention index is valid.'
\else
  DO $$ BEGIN RAISE EXCEPTION 'Index is invalid, possibly from an interrupted build. Review and remove only that invalid index concurrently before retrying.'; END $$;
\endif
