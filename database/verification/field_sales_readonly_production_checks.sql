-- =====================================================================
-- READ-ONLY production verification for the security hardening and the
-- Field Sales feature. Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- This script cannot change anything: it runs inside a READ ONLY transaction
-- that is rolled back at the end, and it contains only SELECT statements.
-- If a write were attempted, Postgres would refuse it with
-- "cannot execute ... in a read-only transaction".
--
-- How to use
--   * Run it BEFORE applying anything and save the output (the baseline).
--   * Run it again AFTER each step in database/FIELD_SALES_DEPLOYMENT.md and
--     compare with the expectations written above each query.
--   * The Supabase SQL editor shows only the last result. Run one numbered
--     section at a time (select it, then Run), each time together with the
--     BEGIN line below and the ROLLBACK line at the bottom.
--   * Section 9 needs the migration registry. Run it only after part B.
--
-- The automated tests never run this file against production and never
-- connect to production at all.
-- =====================================================================
BEGIN TRANSACTION READ ONLY;

-- ---------------------------------------------------------------------
-- 0. Where am I?  Expect: database of project rqovkmjsdwzggebvwvdk,
--    current_user "postgres", transaction_read_only "on".
-- ---------------------------------------------------------------------
SELECT current_database() AS database, current_user, session_user, version() AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls;

-- ---------------------------------------------------------------------
-- 1. Every table in public: owner and row-level security.
--    Expect: rls_enabled = true on every row.
-- ---------------------------------------------------------------------
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
ORDER BY 1;

-- ---------------------------------------------------------------------
-- 2. Every policy in public, in full.
--    Baseline: 55 policies. After part B: 74 (19 new, all named
--    office_roles_only, all RESTRICTIVE). After part A: 76 (field_visits_read,
--    field_visit_events_read). No existing policy may differ from the baseline.
-- ---------------------------------------------------------------------
SELECT tablename AS table_name, policyname AS policy, permissive AS mode, cmd AS command,
       array_to_string(roles, ', ') AS roles, qual AS using_expression, with_check AS check_expression
FROM pg_policies WHERE schemaname = 'public'
ORDER BY 1, 2;

-- ---------------------------------------------------------------------
-- 3. Table privileges of the API roles on every table in public.
--    After part A expect exactly: field_visits -> authenticated: SELECT;
--    field_visit_events -> authenticated: SELECT; field_sales_members -> no
--    row at all; nothing for anon or PUBLIC on any of the three.
-- ---------------------------------------------------------------------
SELECT g.table_name, g.grantee, string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type) AS privileges
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public' AND g.grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
GROUP BY 1, 2 ORDER BY 1, 2;

-- Sequences reachable by anon or authenticated. After part A expect no
-- sequence belonging to a field_* table in this list.
SELECT c.relname AS sequence_name,
       has_sequence_privilege('anon', c.oid, 'USAGE') AS anon_usage,
       has_sequence_privilege('authenticated', c.oid, 'USAGE') AS authenticated_usage
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
ORDER BY 1;

-- ---------------------------------------------------------------------
-- 4. Every trigger on public tables, with its enabled state ('O' = enabled).
--    Baseline: 8 triggers. After part A: 15 (3 x field_sales_guard_membership,
--    field_visit_events_append_only, field_visit_events_no_truncate,
--    field_visits_no_delete, field_visits_no_truncate). All enabled.
-- ---------------------------------------------------------------------
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
ORDER BY 1, 2;

-- ---------------------------------------------------------------------
-- 5. Every foreign key in public.
--    After part A expect these new ones and no change to existing ones:
--      field_sales_members.user_id    -> app_members(user_id)  ON DELETE CASCADE
--      field_sales_members.company_id -> profiles(id)          ON DELETE CASCADE
--      field_visits.company_id        -> profiles(id)          ON DELETE CASCADE
--      field_visits.salesperson_id    -> auth.users(id)        ON DELETE SET NULL
--      field_visits.lead_id           -> leads(id)             ON DELETE SET NULL
--      field_visits.follow_up_id      -> follow_ups(id)        ON DELETE SET NULL
--      field_visit_events.visit_id    -> field_visits(id)      ON DELETE CASCADE
-- ---------------------------------------------------------------------
SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'f'
ORDER BY 1, 2;

-- The two CHECK constraints the feature migration changes.
-- Baseline: role = owner/admin/staff; lead_source = nine values.
-- After part A: role also allows sales; lead_source also allows field_visit.
SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition, convalidated AS validated
FROM pg_constraint WHERE conname IN ('app_members_role_check', 'leads_lead_source_check');

-- ---------------------------------------------------------------------
-- 6. Every function in the application schemas: owner, SECURITY DEFINER,
--    fixed settings, and who may execute it.
--    After part A expect, for every field_sales_internal.* and
--    public.*field_visit* / *field_sales* function:
--      owner = postgres; settings = search_path=""; anon = false; public = false
--      authenticated = true only for: my_field_sales_companies,
--        field_visit_assignees, save_field_visit, review_field_visit,
--        convert_field_visit_to_lead, field_sales_internal.can_submit,
--        field_sales_internal.can_review
--    b2p_migration_internal.*: nobody but the owner.
-- ---------------------------------------------------------------------
SELECT n.nspname AS schema, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       coalesce(array_to_string(p.proconfig, '; '), '(none)') AS settings,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'followup_audit_internal', 'field_sales_internal', 'b2p_migration_internal')
ORDER BY 1, 2, 3;

-- ---------------------------------------------------------------------
-- 7. Schema privileges of the API roles.
--    After part A expect: field_sales_internal -> authenticated USAGE only
--    (no CREATE), anon nothing; b2p_migration_internal and field_sales_archive
--    -> nothing for anon or authenticated.
--    NOTE: whether a schema is reachable through the HTTP API is decided by
--    the project's "Exposed schemas" setting (Dashboard -> Settings -> API),
--    which is not visible from SQL. Confirm there that only "public" and
--    "graphql_public" are listed.
-- ---------------------------------------------------------------------
SELECT n.nspname AS schema,
       has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
       has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_usage,
       has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1;

-- ---------------------------------------------------------------------
-- 8. Focused findings (each row is something to look at)
-- ---------------------------------------------------------------------
-- 8a. Tables that any signed-in account can reach regardless of office role:
--     a permissive policy that is simply true or "is authenticated", with no
--     restrictive policy on the same table.
--     Baseline: the 19 tables. After part B: expect NO rows.
SELECT p.tablename AS table_name, p.policyname AS open_policy, p.cmd AS command, p.qual AS using_expression
FROM pg_policies p
WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
  AND (p.qual IN ('true', '(auth.role() = ''authenticated''::text)') OR p.with_check IN ('true', '(auth.role() = ''authenticated''::text)'))
  AND NOT EXISTS (SELECT 1 FROM pg_policies r WHERE r.schemaname = 'public' AND r.tablename = p.tablename AND r.permissive = 'RESTRICTIVE')
ORDER BY 1, 2;

-- 8b. The 19 tables and whether each has the hardening policy.
--     After part B: has_office_roles_only = true and is_restrictive = true on all 19.
SELECT t.table_name,
       EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.table_name AND p.policyname = 'office_roles_only') AS has_office_roles_only,
       EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.table_name AND p.policyname = 'office_roles_only' AND p.permissive = 'RESTRICTIVE'
                 AND p.qual = '(( SELECT current_app_role() AS current_app_role) = ANY (ARRAY[''owner''::text, ''admin''::text, ''staff''::text]))') AS is_restrictive_and_as_expected
FROM unnest(ARRAY['account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
  'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills','supplier_payments',
  'suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings','lead_activity']) AS t(table_name)
ORDER BY 1;

-- 8c. SECURITY DEFINER functions that an anonymous caller may execute.
--     Known and tracked separately (NOT fixed by this work):
--       claim_telecalling_sync_queue_rows  - no identity or company check (security patch A)
--     Intentionally public: get_public_document, get_public_comparison_data.
--     The document functions listed here check access inside the function.
--     Expect no field-sales function in this list, ever.
SELECT n.nspname AS schema, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments,
       coalesce(array_to_string(p.proconfig, '; '), '(no fixed search_path)') AS settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND n.nspname IN ('public', 'followup_audit_internal', 'field_sales_internal', 'b2p_migration_internal')
ORDER BY 1, 2;

-- 8d. Accounts by role and membership. No personal data: counts only.
--     Expect sales_with_normal_membership = 0 always.
SELECT m.role, m.active, count(*) AS accounts,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.app_company_members c WHERE c.user_id = m.user_id)) AS with_normal_membership,
       count(*) FILTER (WHERE m.role = 'sales' AND EXISTS (SELECT 1 FROM public.app_company_members c WHERE c.user_id = m.user_id)) AS sales_with_normal_membership
FROM public.app_members m GROUP BY 1, 2 ORDER BY 1, 2;

-- 8e. Leads by source (counts only). Converted field visits appear as field_visit.
SELECT lead_source, count(*) AS leads FROM public.leads GROUP BY 1 ORDER BY 1;

-- ---------------------------------------------------------------------
-- 9. Drift check. RUN ONLY AFTER PART B (needs the migration registry).
--    Every object the migrations created, compared with what was recorded.
--    Expect state = 'unchanged' on every row. 'MODIFIED' or 'MISSING' means
--    someone changed or removed it after the migration ran.
-- ---------------------------------------------------------------------
SELECT r.migration, r.kind, r.ident, r.recorded_at,
       CASE WHEN d.definition IS NULL THEN 'MISSING'
            WHEN md5(d.definition) = r.definition_md5 THEN 'unchanged'
            ELSE 'MODIFIED' END AS state
FROM b2p_migration_internal.object_registry r
CROSS JOIN LATERAL (SELECT b2p_migration_internal.object_definition(r.kind, r.ident) AS definition) d
ORDER BY (CASE WHEN d.definition IS NULL OR md5(d.definition) <> r.definition_md5 THEN 0 ELSE 1 END), 1, 2, 3;

ROLLBACK;
