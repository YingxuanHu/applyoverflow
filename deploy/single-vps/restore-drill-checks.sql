\set ON_ERROR_STOP on
SET statement_timeout = '10min';
SET lock_timeout = '5s';
CREATE TEMP TABLE drill_counts (table_name text PRIMARY KEY, row_count bigint);
CREATE TEMP TABLE drill_check_results (schema_name text, table_name text, constraint_name text, violations bigint);
DO $$
DECLARE table_name text; row_count bigint; constraint_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User', 'UserProfile', 'Document', 'ApplicationSubmission', 'TrackedApplication', 'JobCanonical', 'JobSourceMapping', '_prisma_migrations'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required restored table missing: %', table_name;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    INSERT INTO drill_counts VALUES (table_name, row_count);
  END LOOP;
  FOR constraint_row IN
    SELECT n.nspname, r.relname, c.conname, pg_get_expr(c.conbin, c.conrelid) AS expression
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='c' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'ao_restore_drill_guard') AND n.nspname NOT LIKE 'pg_toast%'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE NOT (%s)', constraint_row.nspname, constraint_row.relname, constraint_row.expression) INTO row_count;
    INSERT INTO drill_check_results VALUES (constraint_row.nspname, constraint_row.relname, constraint_row.conname, row_count);
  END LOOP;
END $$;
SELECT jsonb_build_object(
  'database', current_database(),
  'databaseSizeBytes', pg_database_size(current_database()),
  'schemaPresent', EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='public'),
  'sentinelPresent', (SELECT count(*)=1 FROM ao_restore_drill_guard.sentinel),
  'exactCounts', (SELECT jsonb_object_agg(table_name, row_count) FROM drill_counts),
  'schemas', (SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),
  'tables', (SELECT jsonb_agg(jsonb_build_object('schema', table_schema, 'table', table_name, 'column', column_name, 'type', udt_name, 'nullable', is_nullable) ORDER BY table_schema, table_name, ordinal_position)
    FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'ao_restore_drill_guard') AND table_schema NOT LIKE 'pg_%'),
  'constraints', (SELECT jsonb_agg(jsonb_build_object('schema', n.nspname, 'table', r.relname, 'name', c.conname, 'type', c.contype, 'validated', c.convalidated, 'definition', pg_get_constraintdef(c.oid)) ORDER BY n.nspname, r.relname, c.conname)
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'),
  'unvalidatedConstraints', (SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND NOT c.convalidated),
  'invalidIndexes', (SELECT count(*) FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)),
  'checkConstraints', (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM drill_check_results c),
  'checkConstraintViolations', (SELECT coalesce(sum(violations),0) FROM drill_check_results)
);
