\set ON_ERROR_STOP on
\pset pager off
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '1s';

\echo 'Database size and statistics age (not a filesystem total)'
SELECT now() AS observed_at, current_database() AS database,
       pg_database_size(current_database()) AS database_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS database_size,
       stats_reset
FROM pg_stat_database WHERE datname = current_database();

\echo 'Largest tables: allocated heap / TOAST / indexes; row counts are estimates, not public jobs'
SELECT s.relname AS table_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes,
       CASE WHEN c.reltoastrelid = 0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END AS toast_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       s.n_live_tup AS estimated_rows, s.n_dead_tup AS estimated_dead_rows,
       s.n_tup_upd AS updates, s.n_tup_hot_upd AS hot_updates,
       s.last_autovacuum, s.last_autoanalyze
FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
WHERE s.schemaname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 30;

\echo 'Largest indexes: zero scans is NOT proof an index can be dropped'
SELECT s.relname AS table_name, s.indexrelname AS index_name,
       pg_relation_size(s.indexrelid) AS index_bytes,
       s.idx_scan, s.idx_tup_read, i.indisunique, i.indisprimary, i.indisvalid,
       coalesce(t.spcname, 'database default') AS tablespace
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
JOIN pg_class c ON c.oid = s.indexrelid
LEFT JOIN pg_tablespace t ON t.oid = c.reltablespace
WHERE s.schemaname = 'public'
ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 40;

\echo 'Exact-definition duplicate index candidates: operator review only, no DROP statements'
SELECT a.indrelid::regclass AS table_name,
       a.indexrelid::regclass AS first_index, b.indexrelid::regclass AS second_index,
       pg_relation_size(b.indexrelid) AS second_index_bytes
FROM pg_index a JOIN pg_index b ON a.indrelid = b.indrelid AND a.indexrelid < b.indexrelid
JOIN pg_class ca ON ca.oid = a.indexrelid
JOIN pg_class cb ON cb.oid = b.indexrelid
WHERE ca.relnamespace = 'public'::regnamespace
  AND ca.relam = cb.relam AND a.indkey = b.indkey
  AND a.indclass = b.indclass AND a.indcollation = b.indcollation
  AND a.indoption = b.indoption AND a.indnkeyatts = b.indnkeyatts
  AND a.indnatts = b.indnatts AND a.indisunique = b.indisunique
  AND a.indnullsnotdistinct = b.indnullsnotdistinct
  AND a.indisvalid AND b.indisvalid
  AND a.indisready AND b.indisready
  AND a.indexprs::text IS NOT DISTINCT FROM b.indexprs::text
  AND a.indpred::text IS NOT DISTINCT FROM b.indpred::text
ORDER BY pg_relation_size(b.indexrelid) DESC LIMIT 40;

\echo 'Wide-column compression settings (settings do not rewrite existing values)'
SELECT c.relname AS table_name, a.attname AS column_name, a.attstorage,
       CASE a.attcompression WHEN 'l' THEN 'lz4' WHEN 'p' THEN 'pglz' ELSE 'default' END AS compression
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND c.relname IN ('JobRaw', 'NormalizedJobRecord', 'JobCanonical', 'JobFeedIndex')
  AND a.attnum > 0 AND NOT a.attisdropped AND a.attstorage <> 'p'
ORDER BY c.relname, a.attname;

\echo 'WAL generation (cumulative since stats_reset, not retained WAL size)'
SELECT wal_records, wal_fpi, wal_bytes, stats_reset FROM pg_stat_wal;
\echo 'Replication retention: inactive slots can pin WAL; investigate before changing'
SELECT slot_name, slot_type, active, wal_status, safe_wal_size,
       CASE WHEN NOT pg_is_in_recovery() THEN pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) END AS retained_bytes
FROM pg_replication_slots;

\echo 'Storage-related settings'
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('autovacuum', 'autovacuum_vacuum_scale_factor', 'autovacuum_vacuum_threshold',
               'default_toast_compression', 'wal_compression', 'max_wal_size', 'min_wal_size',
               'max_slot_wal_keep_size', 'archive_mode', 'temp_file_limit', 'log_destination',
               'logging_collector', 'log_rotation_age', 'log_rotation_size')
ORDER BY name;
COMMIT;
