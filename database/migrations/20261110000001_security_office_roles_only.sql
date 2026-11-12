-- =====================================================================
-- SECURITY HARDENING: office_roles_only
-- Target: Supabase project rqovkmjsdwzggebvwvdk (inspected read-only 2026-11-10).
--
-- DO NOT RUN WITHOUT REVIEW. See database/FIELD_SALES_DEPLOYMENT.md, part B.
--
-- Independent of the field-sales feature. Apply it first; it stays in place
-- even if the feature is later rolled back.
--
-- What it does
--   Nineteen tables are currently readable and writable by ANY signed-in
--   account, in any company, with or without an office role. This adds one
--   RESTRICTIVE policy to each so that only owner, admin and staff keep access.
--   A RESTRICTIVE policy is AND-ed with the existing permissive policies, so
--   no existing policy is edited, replaced or dropped.
--   The service role bypasses row-level security and is unaffected.
--
-- Re-running
--   Every object this script creates is recorded with a fingerprint of its
--   definition. On a re-run the script only proceeds past an existing object
--   if it is byte-for-byte what this script last created. An object with the
--   same name that this script did not create, or that was changed afterwards,
--   stops the script with an error instead of being overwritten.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------
DO $$
DECLARE missing text;
BEGIN
  IF to_regprocedure('public.current_app_role()') IS NULL THEN
    RAISE EXCEPTION 'Security hardening: public.current_app_role() not found. Wrong database?';
  END IF;
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Security hardening: run as the database owner role (it must be able to bypass row-level security).';
  END IF;
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY[
    'account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
    'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings',
    'lead_activity']) t
  WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Security hardening: expected tables missing: %', missing; END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Migration object registry (private; no application role can reach it)
--    Shared by this script and the field-sales feature migration.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS b2p_migration_internal;
REVOKE ALL ON SCHEMA b2p_migration_internal FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('b2p_migration_internal.object_registry') IS NULL THEN
    CREATE TABLE b2p_migration_internal.object_registry (
      kind           text NOT NULL CHECK (kind IN ('table','function','policy','trigger','constraint')),
      ident          text NOT NULL,
      migration      text NOT NULL,
      definition_md5 text NOT NULL,
      recorded_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, ident)
    );
  ELSIF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)
         FROM pg_attribute a
         WHERE a.attrelid = 'b2p_migration_internal.object_registry'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM 'kind:text,ident:text,migration:text,definition_md5:text,recorded_at:timestamp with time zone' THEN
    RAISE EXCEPTION 'b2p_migration_internal.object_registry exists with an unexpected structure';
  END IF;
END $$;
ALTER TABLE b2p_migration_internal.object_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON b2p_migration_internal.object_registry FROM PUBLIC;

-- Current definition of an object as text, or NULL when it does not exist.
--   table      ident = schema.table              columns, constraints, indexes, RLS flag
--   function   ident = schema.name(arg types)    full source and attributes
--   policy     ident = schema.table/policy       mode, command, roles, USING, WITH CHECK
--   trigger    ident = schema.table/trigger      full definition
--   constraint ident = schema.table/constraint   full definition
CREATE OR REPLACE FUNCTION b2p_migration_internal.object_definition(p_kind text, p_ident text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_rel  oid;
  v_name text := split_part(p_ident, '/', 2);
  v_def  text;
BEGIN
  IF p_kind = 'function' THEN
    RETURN (SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(p_ident));
  END IF;
  v_rel := pg_catalog.to_regclass(split_part(p_ident, '/', 1));
  IF v_rel IS NULL THEN RETURN NULL; END IF;
  IF p_kind = 'table' THEN
    SELECT 'columns: ' || string_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
             || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
             || CASE WHEN a.attidentity <> '' THEN ' identity' ELSE '' END
             || coalesce(' default ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), '; ' ORDER BY a.attnum)
      INTO v_def
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped;
    RETURN v_def
      || E'\nconstraints: ' || coalesce((SELECT string_agg(c.conname || ' ' || pg_catalog.pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname)
                                         FROM pg_catalog.pg_constraint c WHERE c.conrelid = v_rel), '')
      || E'\nindexes: ' || coalesce((SELECT string_agg(pg_catalog.pg_get_indexdef(i.indexrelid), '; ' ORDER BY i.indexrelid::regclass::text)
                                     FROM pg_catalog.pg_index i WHERE i.indrelid = v_rel), '')
      || E'\nrow security: ' || (SELECT c.relrowsecurity::text FROM pg_catalog.pg_class c WHERE c.oid = v_rel);
  ELSIF p_kind = 'policy' THEN
    RETURN (SELECT concat_ws(' | ', CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END, p.polcmd::text,
                     (SELECT string_agg(CASE WHEN r = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r) END, ',' ORDER BY r) FROM unnest(p.polroles) r),
                     'USING ' || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '-'),
                     'CHECK ' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '-'))
            FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel AND p.polname = v_name);
  ELSIF p_kind = 'trigger' THEN
    RETURN (SELECT pg_catalog.pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text
            FROM pg_catalog.pg_trigger t WHERE t.tgrelid = v_rel AND t.tgname = v_name AND NOT t.tgisinternal);
  ELSIF p_kind = 'constraint' THEN
    RETURN (SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c WHERE c.conrelid = v_rel AND c.conname = v_name);
  END IF;
  RAISE EXCEPTION 'object_definition: unknown kind %', p_kind;
END $$;

-- Stop unless the object is absent, or is exactly what a migration last recorded.
-- Returns true when the object already exists (and is unmodified).
CREATE OR REPLACE FUNCTION b2p_migration_internal.assert_unmodified(p_kind text, p_ident text) RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_current text := b2p_migration_internal.object_definition(p_kind, p_ident);
  v_md5     text;
BEGIN
  IF v_current IS NULL THEN RETURN false; END IF;
  SELECT r.definition_md5 INTO v_md5 FROM b2p_migration_internal.object_registry r WHERE r.kind = p_kind AND r.ident = p_ident;
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'Migration stopped: % % already exists but was not created by these migrations. Nothing was changed.', p_kind, p_ident;
  END IF;
  IF v_md5 <> md5(v_current) THEN
    RAISE EXCEPTION 'Migration stopped: % % was modified after it was created by these migrations. Nothing was changed.', p_kind, p_ident;
  END IF;
  RETURN true;
END $$;

-- Record the object's current definition as the expected one.
CREATE OR REPLACE FUNCTION b2p_migration_internal.record_object(p_migration text, p_kind text, p_ident text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_current text := b2p_migration_internal.object_definition(p_kind, p_ident);
BEGIN
  IF v_current IS NULL THEN RAISE EXCEPTION 'record_object: % % does not exist', p_kind, p_ident; END IF;
  INSERT INTO b2p_migration_internal.object_registry (kind, ident, migration, definition_md5)
  VALUES (p_kind, p_ident, p_migration, md5(v_current))
  ON CONFLICT (kind, ident) DO UPDATE
    SET migration = excluded.migration, definition_md5 = excluded.definition_md5, recorded_at = now();
END $$;

REVOKE ALL ON FUNCTION
  b2p_migration_internal.object_definition(text, text),
  b2p_migration_internal.assert_unmodified(text, text),
  b2p_migration_internal.record_object(text, text, text)
FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 2. One RESTRICTIVE policy per table
-- ---------------------------------------------------------------------
DO $$
DECLARE t text; ident text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
    'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings',
    'lead_activity'
  ] LOOP
    ident := 'public.' || t || '/office_roles_only';
    -- Raises if a policy of this name exists that this script did not create or that was changed.
    IF b2p_migration_internal.assert_unmodified('policy', ident) THEN CONTINUE; END IF;

    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION 'Security hardening: row-level security is not enabled on public.%; expected it to be.', t;
    END IF;
    EXECUTE format(
      'CREATE POLICY office_roles_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.current_app_role()) IN (''owner'',''admin'',''staff'')) '
      || 'WITH CHECK ((SELECT public.current_app_role()) IN (''owner'',''admin'',''staff''))', t);
    PERFORM b2p_migration_internal.record_object('security_office_roles_only', 'policy', ident);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
