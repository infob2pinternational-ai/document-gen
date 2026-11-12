-- =====================================================================
-- FEATURE ROLLBACK for 20261110000002_field_sales_data_collection.sql
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- DO NOT RUN WITHOUT REVIEW. See database/FIELD_SALES_DEPLOYMENT.md, part C.
-- For a temporary stop use the off-switch described there instead.
--
-- Removes the field-sales feature ONLY.
--
-- It does NOT touch the security hardening: the nineteen office_roles_only
-- policies, and the registry that tracks them, stay exactly as they are.
-- Removing those is a different decision with its own script and approval
-- (part D of the deployment guide).
--
-- What this does
--   * Copies field_visits, field_visit_events and field_sales_members into
--     the private schema field_sales_archive (kept; never dropped here).
--     The copies are made with CREATE TABLE ... AS: they hold every row and
--     column value, but NOT the original constraints, indexes, triggers,
--     policies, grants or identity sequence. They are for inspection and
--     export. Reloading them into a reinstalled feature is a manual step.
--   * Removes every object the feature migration created.
--   * Restores app_members_role_check to owner/admin/staff.
-- Leads
--   * No lead row is modified or deleted. Leads created from field visits
--     stay as they are, including lead_source = 'field_visit'.
--   * If any such lead exists, leads_lead_source_check is left in its
--     extended form so those rows stay valid. It is restored to the original
--     nine values only when no lead uses 'field_visit'.
-- What it refuses to do
--   * It stops while any app_members row has role 'sales'. Remove those
--     accounts first (deployment guide, "Removing a salesperson").
--   * It stops if an object it is about to drop is not the one the feature
--     migration created.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  IF to_regprocedure('b2p_migration_internal.assert_unmodified(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Feature rollback stopped: the migration registry is missing. Nothing was changed.';
  END IF;
  SELECT count(*) INTO n FROM public.app_members WHERE role = 'sales';
  IF n > 0 THEN
    RAISE EXCEPTION 'Feature rollback stopped: % app_members row(s) still have role sales. Remove those accounts first.', n;
  END IF;
END $$;

-- Only drop what the feature migration created, unmodified.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT kind, ident FROM b2p_migration_internal.object_registry
           WHERE migration = 'field_sales' AND kind <> 'constraint' LOOP
    PERFORM b2p_migration_internal.assert_unmodified(r.kind, r.ident);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 1. Archive feature data (no grants: reachable only by the administrator)
--    Row data only: constraints, indexes, triggers, policies and grants are not copied.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS field_sales_archive;
REVOKE ALL ON SCHEMA field_sales_archive FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text; suffix text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS_US');
BEGIN
  FOREACH t IN ARRAY ARRAY['field_visits', 'field_visit_events', 'field_sales_members'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE TABLE field_sales_archive.%I AS TABLE public.%I', t || '_' || suffix, t);
      EXECUTE format('REVOKE ALL ON field_sales_archive.%I FROM PUBLIC, anon, authenticated', t || '_' || suffix);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Remove guard triggers from the two existing tables
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_company_members;
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_members;

-- ---------------------------------------------------------------------
-- 3. Remove API functions, then tables, then helpers and their schema
--    (this session has no request role, so the audit guard allows the drop)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time);
DROP FUNCTION IF EXISTS public.review_field_visit(uuid, text, text);
DROP FUNCTION IF EXISTS public.save_field_visit(jsonb);
DROP FUNCTION IF EXISTS public.field_visit_assignees(uuid);
DROP FUNCTION IF EXISTS public.my_field_sales_companies();

DROP TABLE IF EXISTS public.field_visit_events;
DROP TABLE IF EXISTS public.field_visits;
DROP TABLE IF EXISTS public.field_sales_members;

DROP FUNCTION IF EXISTS field_sales_internal.audit_guard();
DROP FUNCTION IF EXISTS field_sales_internal.guard_membership();
DROP FUNCTION IF EXISTS field_sales_internal.assignee_ok(uuid, text);
DROP FUNCTION IF EXISTS field_sales_internal.can_review(uuid);
DROP FUNCTION IF EXISTS field_sales_internal.can_submit(uuid);
DROP FUNCTION IF EXISTS field_sales_internal.normalize_phone(text);
DROP SCHEMA IF EXISTS field_sales_internal;      -- no CASCADE: fails if anything unexpected is inside

-- ---------------------------------------------------------------------
-- 4. Constraints
-- ---------------------------------------------------------------------
-- Role: back to the original three values (no sales rows exist; checked above).
ALTER TABLE public.app_members DROP CONSTRAINT IF EXISTS app_members_role_check;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]));

-- Lead source: never rewrite lead data. Keep 'field_visit' valid while any lead uses it.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.leads WHERE lead_source = 'field_visit';
  IF n = 0 THEN
    ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;
    ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check
      CHECK (lead_source = ANY (ARRAY['facebook'::text, 'instagram'::text, 'whatsapp_bulk'::text, 'website'::text,
        'bulk_email'::text, 'existing_customer'::text, 'phone'::text, 'referral'::text, 'other'::text]));
    RAISE NOTICE 'leads_lead_source_check restored to the original nine values.';
  ELSE
    RAISE NOTICE 'leads_lead_source_check left extended: % lead(s) use lead_source = field_visit and remain valid.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Forget the feature's objects. Security-hardening records are kept.
-- ---------------------------------------------------------------------
DELETE FROM b2p_migration_internal.object_registry WHERE migration = 'field_sales';

NOTIFY pgrst, 'reload schema';
COMMIT;
