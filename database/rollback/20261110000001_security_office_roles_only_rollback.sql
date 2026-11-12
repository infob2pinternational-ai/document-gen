-- =====================================================================
-- SECURITY-POLICY ROLLBACK for 20261110000001_security_office_roles_only.sql
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- THIS RE-OPENS NINETEEN TABLES TO EVERY SIGNED-IN ACCOUNT.
-- It is NOT part of the field-sales feature rollback and must never be run
-- as a routine step. It needs its own written approval from the owner.
-- See database/FIELD_SALES_DEPLOYMENT.md, part D.
--
-- After this script, any account that can sign in - including one with no
-- office role - can again read, change and delete rows in the finance,
-- booking, resource and Google-sync tables of every company.
--
-- Safeguards
--   * Does nothing unless the operator first states the consequence in the
--     same session:
--       SET b2p.confirm_reopen_office_tables = 'I accept that all signed-in accounts regain access';
--   * Stops while the field-sales feature is installed or any sales account
--     exists (roll the feature back first, part C).
--   * Stops if a policy it is about to drop is not the one the hardening
--     migration created.
-- =====================================================================
BEGIN;

DO $$
DECLARE n int;
BEGIN
  IF coalesce(current_setting('b2p.confirm_reopen_office_tables', true), '')
     <> 'I accept that all signed-in accounts regain access' THEN
    RAISE EXCEPTION 'Security-policy rollback stopped: confirmation setting not provided. Nothing was changed. Read the header of this script.';
  END IF;
  IF to_regprocedure('b2p_migration_internal.assert_unmodified(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Security-policy rollback stopped: the migration registry is missing. Nothing was changed.';
  END IF;
  IF to_regclass('public.field_visits') IS NOT NULL OR to_regclass('public.field_sales_members') IS NOT NULL THEN
    RAISE EXCEPTION 'Security-policy rollback stopped: the field-sales feature is still installed. Roll it back first.';
  END IF;
  SELECT count(*) INTO n FROM public.app_members WHERE role NOT IN ('owner', 'admin', 'staff');
  IF n > 0 THEN
    RAISE EXCEPTION 'Security-policy rollback stopped: % account(s) hold a role other than owner, admin or staff.', n;
  END IF;
END $$;

DO $$
DECLARE r record; t text;
BEGIN
  FOR r IN SELECT ident FROM b2p_migration_internal.object_registry
           WHERE migration = 'security_office_roles_only' AND kind = 'policy' ORDER BY ident LOOP
    -- Raises if the policy was changed since it was created; false if already gone.
    IF b2p_migration_internal.assert_unmodified('policy', r.ident) THEN
      t := split_part(split_part(r.ident, '/', 1), '.', 2);
      EXECUTE format('DROP POLICY office_roles_only ON public.%I', t);
    END IF;
  END LOOP;
  DELETE FROM b2p_migration_internal.object_registry WHERE migration = 'security_office_roles_only';
END $$;

-- Remove the registry only if nothing else is recorded in it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM b2p_migration_internal.object_registry) THEN
    DROP FUNCTION b2p_migration_internal.record_object(text, text, text);
    DROP FUNCTION b2p_migration_internal.assert_unmodified(text, text);
    DROP FUNCTION b2p_migration_internal.object_definition(text, text);
    DROP TABLE b2p_migration_internal.object_registry;
    DROP SCHEMA b2p_migration_internal;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
