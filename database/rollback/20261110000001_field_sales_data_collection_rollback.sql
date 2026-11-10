-- =====================================================================
-- ROLLBACK for 20261110000001_field_sales_data_collection.sql
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- DO NOT RUN WITHOUT REVIEW. Read database/FIELD_SALES_DEPLOYMENT.md
-- ("Rollback") first. For a temporary stop, use the off-switch described
-- there instead: it disables the feature without removing anything.
--
-- What this does
--   * Copies field_visits, field_visit_events and field_sales_members into
--     the private schema field_sales_archive (kept, never dropped here).
--   * Removes every object the migration created.
--   * Restores the two original CHECK constraints.
-- What it changes in existing data (only if the feature was used)
--   * Leads created from field visits keep existing as ordinary leads, but
--     their lead_source becomes 'other'. The origin stays readable in
--     source_details ("Field visit by ... [field-visit:<id>]").
-- What it refuses to do
--   * It stops if any app_members row still has role 'sales'. Remove those
--     accounts first with the documented removal procedure.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Refuse to continue while sales accounts exist
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.app_members WHERE role = 'sales';
  IF n > 0 THEN
    RAISE EXCEPTION 'Rollback stopped: % app_members row(s) still have role sales. Remove those accounts first.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Archive feature data (no grants: reachable only by the administrator)
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS field_sales_archive;
REVOKE ALL ON SCHEMA field_sales_archive FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text; suffix text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
BEGIN
  FOREACH t IN ARRAY ARRAY['field_visits', 'field_visit_events', 'field_sales_members'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE TABLE field_sales_archive.%I AS TABLE public.%I', t || '_' || suffix, t);
      EXECUTE format('REVOKE ALL ON field_sales_archive.%I FROM PUBLIC, anon, authenticated', t || '_' || suffix);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Remove the restrictive policies from the 19 tables
--    (their original permissive policies were never touched)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
    'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings',
    'lead_activity'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS office_roles_only ON public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Remove guard triggers from the two existing tables
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_company_members;
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_members;

-- ---------------------------------------------------------------------
-- 4. Remove workflow functions, then tables, then helper functions
--    (the read policies depend on the helpers, so tables go first)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time);
DROP FUNCTION IF EXISTS public.review_field_visit(uuid, text, text);
DROP FUNCTION IF EXISTS public.save_field_visit(jsonb);
DROP FUNCTION IF EXISTS public.field_visit_assignees(uuid);
DROP FUNCTION IF EXISTS public.my_field_sales_companies();

DROP TABLE IF EXISTS public.field_visit_events;
DROP TABLE IF EXISTS public.field_visits;
DROP TABLE IF EXISTS public.field_sales_members;

DROP FUNCTION IF EXISTS public.field_sales_guard_membership();
DROP FUNCTION IF EXISTS public.field_visit_assignee_ok(uuid, text);
DROP FUNCTION IF EXISTS public.field_visit_can_review(uuid);
DROP FUNCTION IF EXISTS public.field_sales_can_submit(uuid);
DROP FUNCTION IF EXISTS public.field_visit_normalize_phone(text);

-- ---------------------------------------------------------------------
-- 5. Restore the original lead-source constraint
--    Converted leads stay; only their source label changes.
-- ---------------------------------------------------------------------
UPDATE public.leads SET lead_source = 'other' WHERE lead_source = 'field_visit';
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check
  CHECK (lead_source = ANY (ARRAY['facebook'::text, 'instagram'::text, 'whatsapp_bulk'::text, 'website'::text,
    'bulk_email'::text, 'existing_customer'::text, 'phone'::text, 'referral'::text, 'other'::text]));

-- ---------------------------------------------------------------------
-- 6. Restore the original role constraint
-- ---------------------------------------------------------------------
ALTER TABLE public.app_members DROP CONSTRAINT IF EXISTS app_members_role_check;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text]));

NOTIFY pgrst, 'reload schema';
COMMIT;
