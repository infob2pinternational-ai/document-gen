-- READ ONLY. Run in project rqovkmjsdwzggebvwvdk (the live document app).
-- Shows CRM table existence, row security, and the policies affecting access.
WITH expected(table_name) AS (
  VALUES ('leads'), ('lead_activities'), ('follow_ups'), ('crm_quotations')
)
SELECT e.table_name,
       c.oid IS NOT NULL AS table_exists,
       c.relrowsecurity AS rls_enabled,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'name', p.policyname, 'roles', p.roles, 'command', p.cmd,
           'using', p.qual, 'with_check', p.with_check
         ))
         FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = e.table_name
       ), '[]'::jsonb) AS policies
FROM expected e
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.table_name)
ORDER BY e.table_name;
