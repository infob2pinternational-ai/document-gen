-- READ ONLY. Run in the Supabase SQL Editor for the project's live app.
-- Returns one JSON value containing schema and policies, not customer records.
WITH target_tables(name) AS (
  VALUES ('profiles'), ('user_roles'), ('user_company_access'), ('staff'),
    ('documents'), ('document_items'), ('comparison_document_data'),
    ('leads'), ('lead_activities'), ('follow_ups'), ('crm_quotations'),
    ('resources'), ('bookings'), ('journal_entries'), ('journal_lines'),
    ('customer_receipts'), ('supplier_payments'), ('financial_period_locks')
)
SELECT jsonb_build_object(
  'tables', (SELECT jsonb_agg(jsonb_build_object(
    'table', t.name, 'exists', c.oid IS NOT NULL,
    'rls_enabled', c.relrowsecurity
  )) FROM target_tables t LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.name)),
  'columns', (SELECT jsonb_agg(to_jsonb(cols)) FROM (
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN (SELECT name FROM target_tables)
    ORDER BY table_name, ordinal_position
  ) cols),
  'policies', (SELECT jsonb_agg(to_jsonb(pol)) FROM (
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT name FROM target_tables)
  ) pol),
  'constraints', (SELECT jsonb_agg(to_jsonb(cons)) FROM (
    SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM target_tables)
  ) cons),
  'triggers', (SELECT jsonb_agg(to_jsonb(trig)) FROM (
    SELECT event_object_table, trigger_name, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public' AND event_object_table IN (SELECT name FROM target_tables)
  ) trig),
  'public_document_functions', (SELECT jsonb_agg(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_public_document', 'get_public_comparison_data')
      AND p.prokind = 'f')
) AS repair_schema_report;
