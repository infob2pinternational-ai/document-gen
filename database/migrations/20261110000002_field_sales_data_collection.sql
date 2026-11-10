-- =====================================================================
-- FEATURE: Field Sales Data Collection
-- Target: Supabase project rqovkmjsdwzggebvwvdk (inspected read-only 2026-11-10).
--
-- DO NOT RUN WITHOUT REVIEW. See database/FIELD_SALES_DEPLOYMENT.md, part A.
--
-- Requires 20261110000001_security_office_roles_only.sql to be applied first.
-- This script stops if it is not.
--
-- Standalone and additive: written against the LIVE schema, not against the
-- older files in this folder (they no longer reproduce production).
--
-- New objects
--   schema     field_sales_internal (helpers; not reachable through the API)
--   tables     public.field_sales_members, public.field_visits, public.field_visit_events
--   API        public.my_field_sales_companies, public.field_visit_assignees,
--              public.save_field_visit, public.review_field_visit,
--              public.convert_field_visit_to_lead
--   internal   field_sales_internal.normalize_phone, can_submit, can_review,
--              assignee_ok, guard_membership (trigger), audit_guard (trigger)
-- Changes to existing objects (reversed by the feature rollback script)
--   1. app_members_role_check      gains 'sales'
--   2. leads_lead_source_check     gains 'field_visit'
--   3. app_members, app_company_members   one guard trigger each
-- No existing policy, function, trigger or row is edited or removed.
--
-- Re-running
--   CREATE TABLE IF NOT EXISTS and CREATE OR REPLACE FUNCTION are NOT treated
--   as proof that a re-run is safe: on their own they would silently keep a
--   wrong table or overwrite someone else's function. Instead, section 1
--   checks every table, function, policy and trigger this script owns BEFORE
--   anything is changed. Each must be either absent, or exactly what this
--   script last created (compared by a recorded fingerprint of its
--   definition). Anything else stops the script with nothing changed.
--   Tables are never dropped or rewritten, so existing visits survive a re-run.
--   The whole script is one transaction: any error rolls all of it back.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preconditions: stop before changing anything if live is not as inspected.
-- ---------------------------------------------------------------------
DO $$
DECLARE missing text;
BEGIN
  IF to_regprocedure('public.current_app_role()') IS NULL
     OR to_regprocedure('public.can_access_company(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Field sales: current_app_role()/can_access_company(uuid) not found. Wrong database?';
  END IF;

  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['profiles','app_members','app_company_members','leads','lead_activities','follow_ups']) t
  WHERE to_regclass('public.' || t) IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Field sales: required tables missing: %', missing; END IF;

  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY[
    'lead_activities.type','lead_activities.notes','lead_activities.performed_by',
    'follow_ups.follow_up_date','follow_ups.follow_up_time','follow_ups.lead_id','follow_ups.lead_number',
    'follow_ups.customer_name','follow_ups.company_name','follow_ups.phone','follow_ups.reason',
    'follow_ups.assigned_staff_email','follow_ups.created_by_email',
    'leads.lead_number','leads.assigned_telecaller_email','leads.next_follow_up_at','leads.source_details',
    'leads.service_required','leads.whatsapp_number','leads.remarks'
  ]) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = split_part(c, '.', 1) AND column_name = split_part(c, '.', 2));
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Field sales: expected live columns missing: %', missing; END IF;

  IF EXISTS (SELECT 1 FROM public.app_members WHERE role NOT IN ('owner','admin','staff','sales')) THEN
    RAISE EXCEPTION 'Field sales: app_members contains an unexpected role';
  END IF;

  -- Functions below are SECURITY DEFINER and are owned by whoever runs this
  -- script. That role must bypass row-level security (in production: postgres).
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Field sales: run as the database owner role (it must be able to bypass row-level security).';
  END IF;

  -- The security hardening must already be in place: a sales account must
  -- never exist while the nineteen tables are open to every signed-in user.
  IF to_regprocedure('b2p_migration_internal.assert_unmodified(text,text)') IS NULL
     OR to_regprocedure('b2p_migration_internal.object_definition(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Field sales: apply 20261110000001_security_office_roles_only.sql first.';
  END IF;
  IF to_regclass('b2p_migration_internal.object_registry') IS NULL THEN
    RAISE EXCEPTION 'Field sales: the migration registry is missing. Apply 20261110000001_security_office_roles_only.sql first.';
  END IF;
END $$;

-- Every one of the 19 security policies must be present, must be recorded as
-- created by the security migration, and must still have exactly the
-- definition that migration created (mode, command, roles and both
-- expressions, compared by fingerprint). A policy that merely has the right
-- name, or the right name and RESTRICTIVE mode, is not enough.
DO $$
DECLARE
  t text; v_ident text; v_owner text;
  problems text[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
    'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings',
    'lead_activity'
  ] LOOP
    v_ident := 'public.' || t || '/office_roles_only';
    SELECT r.migration INTO v_owner FROM b2p_migration_internal.object_registry r WHERE r.kind = 'policy' AND r.ident = v_ident;
    IF b2p_migration_internal.object_definition('policy', v_ident) IS NULL THEN
      problems := problems || (t || ' (missing)');
    ELSIF v_owner IS DISTINCT FROM 'security_office_roles_only' THEN
      problems := problems || (t || ' (not recorded as created by the security migration)');
    ELSE
      BEGIN
        PERFORM b2p_migration_internal.assert_unmodified('policy', v_ident);
      EXCEPTION WHEN raise_exception THEN
        problems := problems || (t || ' (modified since the security migration created it)');
      END;
    END IF;
  END LOOP;
  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'Field sales: security hardening is not intact on: %. Nothing was changed. Restore it with 20261110000001_security_office_roles_only.sql (or investigate) before installing the feature.',
      array_to_string(problems, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Definition checks: nothing below may overwrite an unexpected object.
--    Each object must be absent or exactly as this script last created it.
-- ---------------------------------------------------------------------
DO $$
DECLARE obj text[];
BEGIN
  FOREACH obj SLICE 1 IN ARRAY ARRAY[
    ['table',    'public.field_sales_members'],
    ['table',    'public.field_visits'],
    ['table',    'public.field_visit_events'],
    ['function', 'field_sales_internal.normalize_phone(text)'],
    ['function', 'field_sales_internal.can_submit(uuid)'],
    ['function', 'field_sales_internal.can_review(uuid)'],
    ['function', 'field_sales_internal.assignee_ok(uuid,text)'],
    ['function', 'field_sales_internal.guard_membership()'],
    ['function', 'field_sales_internal.audit_guard()'],
    ['function', 'public.my_field_sales_companies()'],
    ['function', 'public.field_visit_assignees(uuid)'],
    ['function', 'public.save_field_visit(jsonb)'],
    ['function', 'public.review_field_visit(uuid,text,text)'],
    ['function', 'public.convert_field_visit_to_lead(uuid,text,uuid,boolean,date,time without time zone)'],
    ['policy',   'public.field_visits/field_visits_read'],
    ['policy',   'public.field_visit_events/field_visit_events_read'],
    ['trigger',  'public.app_company_members/field_sales_guard_membership'],
    ['trigger',  'public.app_members/field_sales_guard_membership'],
    ['trigger',  'public.field_sales_members/field_sales_guard_membership'],
    ['trigger',  'public.field_visit_events/field_visit_events_append_only'],
    ['trigger',  'public.field_visit_events/field_visit_events_no_truncate'],
    ['trigger',  'public.field_visits/field_visits_no_delete'],
    ['trigger',  'public.field_visits/field_visits_no_truncate']
  ] LOOP
    PERFORM b2p_migration_internal.assert_unmodified(obj[1], obj[2]);
  END LOOP;
END $$;

-- The helper schema must be absent or ours (it is ours if the checks above found our functions in it).
DO $$
BEGIN
  IF to_regnamespace('field_sales_internal') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM b2p_migration_internal.object_registry r WHERE r.migration = 'field_sales' AND r.ident LIKE 'field_sales_internal.%') THEN
    RAISE EXCEPTION 'Migration stopped: schema field_sales_internal already exists but was not created by these migrations.';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS field_sales_internal;

-- ---------------------------------------------------------------------
-- 2. The two existing CHECK constraints
--    Each is replaced only if it is exactly the definition inspected in
--    production. If it already has the new definition nothing is done. Any
--    other definition stops the script.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  spec record;
  v_current text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('app_members', 'app_members_role_check',
     'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''staff''::text])))',
     'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''staff''::text, ''sales''::text])))'),
    ('leads', 'leads_lead_source_check',
     'CHECK ((lead_source = ANY (ARRAY[''facebook''::text, ''instagram''::text, ''whatsapp_bulk''::text, ''website''::text, ''bulk_email''::text, ''existing_customer''::text, ''phone''::text, ''referral''::text, ''other''::text])))',
     'CHECK ((lead_source = ANY (ARRAY[''facebook''::text, ''instagram''::text, ''whatsapp_bulk''::text, ''website''::text, ''bulk_email''::text, ''existing_customer''::text, ''phone''::text, ''referral''::text, ''other''::text, ''field_visit''::text])))')
  ) AS v(tbl, con, original_def, new_def) LOOP
    v_current := b2p_migration_internal.object_definition('constraint', 'public.' || spec.tbl || '/' || spec.con);
    IF v_current = spec.new_def THEN
      NULL;                                             -- already applied
    ELSIF v_current = spec.original_def THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', spec.tbl, spec.con);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', spec.tbl, spec.con, spec.new_def);
    ELSE
      RAISE EXCEPTION 'Migration stopped: constraint %.% is not the definition inspected in production (found: %). Nothing was changed.',
        spec.tbl, spec.con, coalesce(v_current, 'missing');
    END IF;
    PERFORM b2p_migration_internal.record_object('field_sales', 'constraint', 'public.' || spec.tbl || '/' || spec.con);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Tables
--    A table is created only when it does not exist. When it does exist,
--    section 1 has already proved it is exactly the table this script created,
--    so it is left alone and its rows are kept. Indexes are created with the
--    table and without IF NOT EXISTS: a name that is already taken by
--    something else is an error, not something to skip silently.
-- ---------------------------------------------------------------------
-- Which companies a salesperson may submit visits for. Deliberately separate
-- from app_company_members: a row here grants nothing on any existing table.
DO $create$
BEGIN
  IF to_regclass('public.field_sales_members') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.field_sales_members (
    user_id    uuid NOT NULL REFERENCES public.app_members(user_id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    active     boolean NOT NULL DEFAULT true,
    note       text,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, company_id)
  );
END $create$;

DO $create$
BEGIN
  IF to_regclass('public.field_visits') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.field_visits (
    id                 uuid PRIMARY KEY,                       -- generated on the device: the idempotency key
    company_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    salesperson_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    salesperson_email  text NOT NULL,                          -- snapshot; survives account removal
    business_name      text NOT NULL CHECK (btrim(business_name) <> '' AND char_length(business_name) <= 200),
    phone              text NOT NULL CHECK (char_length(phone) <= 40),
    phone_normalized   text NOT NULL CHECK (phone_normalized ~ '^[0-9]{6,15}$'),
    location           text CHECK (location IS NULL OR char_length(location) <= 300),
    contact_person     text CHECK (contact_person IS NULL OR char_length(contact_person) <= 200),
    requirements       text[] NOT NULL DEFAULT '{}'
                       CHECK (requirements <@ ARRAY['website','billing_software','crm','attendance_software','other']::text[]),
    requirement_other  text CHECK (requirement_other IS NULL OR char_length(requirement_other) <= 300),
    estimated_budget   numeric(14,2) CHECK (estimated_budget IS NULL OR estimated_budget >= 0),
    remarks            text CHECK (remarks IS NULL OR char_length(remarks) <= 2000),
    follow_up_date     date,
    status             text NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','needs_correction','approved','rejected','converted')),
    review_note        text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    reviewed_by        uuid,
    reviewed_by_email  text,
    reviewed_at        timestamptz,
    lead_id            uuid REFERENCES public.leads(id) ON DELETE SET NULL,
    follow_up_id       uuid REFERENCES public.follow_ups(id) ON DELETE SET NULL,
    conversion_mode    text CHECK (conversion_mode IS NULL OR conversion_mode IN ('new_lead','linked_existing')),
    converted_by       uuid,
    converted_by_email text,
    converted_at       timestamptz,
    client_created_at  timestamptz,                            -- device clock; informational only
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_field_visits_company_status ON public.field_visits (company_id, status, created_at DESC);
  CREATE INDEX idx_field_visits_salesperson ON public.field_visits (salesperson_id, created_at DESC);
  CREATE INDEX idx_field_visits_company_phone ON public.field_visits (company_id, phone_normalized);
END $create$;

-- Append-only audit history. Rows are written only by the functions below.
DO $create$
BEGIN
  IF to_regclass('public.field_visit_events') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.field_visit_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    visit_id    uuid NOT NULL REFERENCES public.field_visits(id) ON DELETE CASCADE,
    company_id  uuid NOT NULL,
    action      text NOT NULL CHECK (action IN ('submitted','updated','resubmitted','approved','rejected',
                  'correction_requested','converted_new_lead','converted_linked_lead')),
    from_status text,
    to_status   text NOT NULL,
    actor_id    uuid,
    actor_email text NOT NULL,
    actor_role  text NOT NULL,
    self_review boolean NOT NULL DEFAULT false,               -- reviewer acted on their own submission
    note        text,
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX idx_field_visit_events_visit ON public.field_visit_events (visit_id, id);
END $create$;

-- ---------------------------------------------------------------------
-- 4. Helper functions (schema field_sales_internal)
--    The API only exposes schema public, so none of these can be called by an
--    app user directly. can_submit and can_review are still granted to
--    "authenticated" because the read policy on field_visits evaluates them
--    with the caller's privileges; they reveal only the caller's own access.
-- ---------------------------------------------------------------------
-- Digits only; drops a leading 91 (12 digits) or 0 (11 digits). Mirrors the
-- client normalisation used for telecalling conversion.
CREATE OR REPLACE FUNCTION field_sales_internal.normalize_phone(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN d ~ '^91[0-9]{10}$' THEN substr(d, 3)
    WHEN d ~ '^0[0-9]{10}$'  THEN substr(d, 2)
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d) s
$$;

-- May the CALLER submit field visits for this company?
--   sales        : active field_sales_members row, and (fail closed) no normal company membership
--   owner, admin : whatever can_access_company already allows
--   anyone else  : no
CREATE OR REPLACE FUNCTION field_sales_internal.can_submit(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE public.current_app_role()
    WHEN 'sales' THEN
      EXISTS (SELECT 1 FROM public.field_sales_members f
              WHERE f.user_id = auth.uid() AND f.company_id = p_company_id AND f.active)
      AND NOT EXISTS (SELECT 1 FROM public.app_company_members c WHERE c.user_id = auth.uid())
    WHEN 'owner' THEN public.can_access_company(p_company_id)
    WHEN 'admin' THEN public.can_access_company(p_company_id)
    ELSE false END
$$;

-- May the CALLER review and convert field visits of this company?
CREATE OR REPLACE FUNCTION field_sales_internal.can_review(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.current_app_role() IN ('owner','admin'), false)
     AND public.can_access_company(p_company_id)
$$;

-- Is this e-mail an active owner/admin/staff member with access to the company?
-- Not granted to any application role.
CREATE OR REPLACE FUNCTION field_sales_internal.assignee_ok(p_company_id uuid, p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_members m JOIN auth.users u ON u.id = m.user_id
    WHERE lower(u.email) = lower(btrim(p_email))
      AND m.active AND m.role IN ('owner','admin','staff')
      AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND (m.role IN ('owner','admin') OR EXISTS (
        SELECT 1 FROM public.app_company_members c WHERE c.user_id = m.user_id AND c.company_id = p_company_id)))
$$;

-- ---------------------------------------------------------------------
-- 5. Keep the sales role and normal company membership mutually exclusive
-- ---------------------------------------------------------------------
-- Invariant: a user with role "sales" never has an app_company_members row,
-- and only a user with role "sales" has field_sales_members rows.
--
-- Each trigger checks a DIFFERENT table from the one being written, so two
-- transactions working on the same user at the same moment could each pass
-- their check before either commits. To prevent that, every path through this
-- function first takes ONE lock per user, always the same one:
--
--     pg_advisory_xact_lock( hash('field_sales_membership:' || user_id) )
--
--   * It is the first thing the function does, before any check, on all three
--     tables, so all membership changes for one user run one after another.
--   * It is held until the transaction ends, so the second transaction waits
--     for the first to commit or roll back and then checks again. Under READ
--     COMMITTED every statement in this function sees the newest committed
--     data, so the second transaction sees what the first one did.
--   * REPEATABLE READ and SERIALIZABLE transactions keep an old snapshot and
--     would NOT see it, so membership changes are refused in those modes.
--   * An advisory lock is used rather than a row lock on auth.users because it
--     needs no privilege on the auth schema (owned by Supabase, not by us) and
--     cannot interfere with sign-in or with other tables' foreign keys.
--   * One lock per user and one acquisition point means there is no lock-order
--     cycle within a user. A statement that touches several users in an order
--     opposite to another transaction can still deadlock; Postgres detects
--     that and aborts one of them, which keeps the invariant.
CREATE OR REPLACE FUNCTION field_sales_internal.guard_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Membership changes must run in a READ COMMITTED transaction (found: %).', current_setting('transaction_isolation');
  END IF;
  -- Serialise every membership change for this user. Must stay the first action.
  PERFORM pg_advisory_xact_lock(hashtextextended('field_sales_membership:' || NEW.user_id::text, 0));

  IF TG_TABLE_NAME = 'app_company_members' THEN
    IF EXISTS (SELECT 1 FROM public.app_members m WHERE m.user_id = NEW.user_id AND m.role = 'sales') THEN
      RAISE EXCEPTION 'A sales user cannot be given normal company membership. Use field_sales_members.';
    END IF;
  ELSIF TG_TABLE_NAME = 'app_members' THEN
    IF NEW.role = 'sales' AND EXISTS (SELECT 1 FROM public.app_company_members c WHERE c.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Remove this user''s app_company_members rows before assigning the sales role.';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.role = 'sales' AND NEW.role <> 'sales'
       AND EXISTS (SELECT 1 FROM public.field_sales_members f WHERE f.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Remove this user''s field_sales_members rows before changing their role from sales.';
    END IF;
  ELSIF TG_TABLE_NAME = 'field_sales_members' THEN
    IF NOT EXISTS (SELECT 1 FROM public.app_members m WHERE m.user_id = NEW.user_id AND m.role = 'sales') THEN
      RAISE EXCEPTION 'field_sales_members is only for users whose app_members role is sales.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Section 1 has already verified that any existing trigger or policy of these
-- names is exactly ours, so dropping and re-creating them cannot remove anything else.
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_company_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE ON public.app_company_members
  FOR EACH ROW EXECUTE FUNCTION field_sales_internal.guard_membership();
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE OF role ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION field_sales_internal.guard_membership();
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.field_sales_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE ON public.field_sales_members
  FOR EACH ROW EXECUTE FUNCTION field_sales_internal.guard_membership();

-- ---------------------------------------------------------------------
-- 5b. Audit integrity: field_visit_events is append-only, and visits are never deleted
--
--     Application roles hold no UPDATE/DELETE/TRUNCATE privilege on these
--     tables (section 6). These triggers add a second barrier that privileges
--     alone cannot give: they also stop SECURITY DEFINER functions, which run
--     with the owner's privileges, from changing history on behalf of a caller.
--
--     Rule: any statement that arrives through the API carries a request role
--     (anon, authenticated or service_role) and is refused. Only a direct
--     database session with no request role (the SQL editor or a direct
--     connection as the database owner) may update or delete. That is the
--     single, deliberate administrator exception; it is needed for rollback
--     and for legally required erasure.
--
--     Consequence: a company profile that has field visits cannot be deleted
--     from the app, because the cascade would delete audit history.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION field_sales_internal.audit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF nullif(auth.role(), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Field visit history is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_LEVEL = 'STATEMENT' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS field_visit_events_append_only ON public.field_visit_events;
CREATE TRIGGER field_visit_events_append_only BEFORE UPDATE OR DELETE ON public.field_visit_events
  FOR EACH ROW EXECUTE FUNCTION field_sales_internal.audit_guard();
DROP TRIGGER IF EXISTS field_visit_events_no_truncate ON public.field_visit_events;
CREATE TRIGGER field_visit_events_no_truncate BEFORE TRUNCATE ON public.field_visit_events
  FOR EACH STATEMENT EXECUTE FUNCTION field_sales_internal.audit_guard();
DROP TRIGGER IF EXISTS field_visits_no_delete ON public.field_visits;
CREATE TRIGGER field_visits_no_delete BEFORE DELETE ON public.field_visits
  FOR EACH ROW EXECUTE FUNCTION field_sales_internal.audit_guard();
DROP TRIGGER IF EXISTS field_visits_no_truncate ON public.field_visits;
CREATE TRIGGER field_visits_no_truncate BEFORE TRUNCATE ON public.field_visits
  FOR EACH STATEMENT EXECUTE FUNCTION field_sales_internal.audit_guard();

-- ---------------------------------------------------------------------
-- 6. Row-level security and grants for the new tables
--    (Supabase grants new tables to anon/authenticated by default: revoke first.)
--    No application role receives INSERT, UPDATE, DELETE or TRUNCATE on any of them.
-- ---------------------------------------------------------------------
ALTER TABLE public.field_sales_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visit_events  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.field_sales_members, public.field_visits, public.field_visit_events FROM PUBLIC, anon, authenticated;
-- The identity sequence is looked up, not assumed by name.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
    pg_get_serial_sequence('public.field_visit_events', 'id'));
END $$;
-- Read-only for signed-in users; every write goes through the functions in section 7.
GRANT SELECT ON public.field_visits, public.field_visit_events TO authenticated;

DROP POLICY IF EXISTS field_visits_read ON public.field_visits;
CREATE POLICY field_visits_read ON public.field_visits FOR SELECT TO authenticated
  USING ((salesperson_id = auth.uid() AND field_sales_internal.can_submit(company_id))
         OR field_sales_internal.can_review(company_id));

-- An event is visible exactly when its visit is (the subquery is itself subject to field_visits_read).
DROP POLICY IF EXISTS field_visit_events_read ON public.field_visit_events;
CREATE POLICY field_visit_events_read ON public.field_visit_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.field_visits v WHERE v.id = field_visit_events.visit_id));

-- field_sales_members: no policy and no grant. Managed only by the database administrator.

-- ---------------------------------------------------------------------
-- 7. Workflow functions
--    Identity always comes from auth.uid(); a company supplied by the client
--    is only ever a claim that is checked, and is ignored once a visit exists.
-- ---------------------------------------------------------------------

-- Companies the caller may submit visits for (sales users cannot read profiles).
CREATE OR REPLACE FUNCTION public.my_field_sales_companies() RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.name FROM public.profiles p
  WHERE field_sales_internal.can_submit(p.id)
  ORDER BY p.name
$$;

-- Staff a reviewer may assign the converted lead to.
CREATE OR REPLACE FUNCTION public.field_visit_assignees(p_company_id uuid) RETURNS TABLE (email text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(field_sales_internal.can_review(p_company_id), false) THEN
    RAISE EXCEPTION 'Field visit access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT lower(u.email)::text, m.role::text
    FROM public.app_members m JOIN auth.users u ON u.id = m.user_id
    WHERE field_sales_internal.assignee_ok(p_company_id, u.email)
    ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, lower(u.email);
END $$;

-- Create a visit, or apply a correction to one the caller owns.
-- Idempotent on the device-generated id: replaying the same payload changes nothing.
CREATE OR REPLACE FUNCTION public.save_field_visit(p_visit jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_role     text;
  v_email    text;
  v_id       uuid;
  v_company  uuid;
  v_old      public.field_visits%ROWTYPE;
  v_new      public.field_visits%ROWTYPE;
  v_business text; v_phone text; v_phone_norm text; v_location text; v_contact text;
  v_reqs     text[]; v_req_other text; v_budget numeric; v_remarks text;
  v_follow   date; v_client_ts timestamptz;
  v_action   text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '42501'; END IF;
  v_role := public.current_app_role();
  IF v_role IS NULL THEN RAISE EXCEPTION 'Field visit access denied' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_visit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid field visit'; END IF;

  -- Parse and validate. Anything not read here (status, salesperson, reviewer,
  -- lead, timestamps ...) is ignored no matter what the client sends.
  BEGIN
    v_id        := nullif(p_visit->>'id', '')::uuid;
    v_company   := nullif(p_visit->>'company_id', '')::uuid;
    v_budget    := nullif(btrim(p_visit->>'estimated_budget'), '')::numeric;
    v_follow    := nullif(btrim(p_visit->>'follow_up_date'), '')::date;
    v_client_ts := nullif(btrim(p_visit->>'client_created_at'), '')::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid field visit';
  END;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Invalid field visit'; END IF;
  -- Postgres would also accept words such as 'tomorrow'; only a plain calendar date is allowed.
  IF v_follow IS NOT NULL AND btrim(p_visit->>'follow_up_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid field visit';
  END IF;

  v_business  := btrim(coalesce(p_visit->>'business_name', ''));
  v_phone      := btrim(coalesce(p_visit->>'phone', ''));
  v_phone_norm := field_sales_internal.normalize_phone(v_phone);
  v_location   := nullif(btrim(coalesce(p_visit->>'location', '')), '');
  v_contact    := nullif(btrim(coalesce(p_visit->>'contact_person', '')), '');
  v_req_other  := nullif(btrim(coalesce(p_visit->>'requirement_other', '')), '');
  v_remarks    := nullif(btrim(coalesce(p_visit->>'remarks', '')), '');

  IF v_business = '' OR char_length(v_business) > 200 THEN RAISE EXCEPTION 'Business name is required (up to 200 characters)'; END IF;
  IF char_length(v_phone) > 40 OR v_phone_norm !~ '^[0-9]{6,15}$' THEN RAISE EXCEPTION 'A valid phone number is required'; END IF;
  IF char_length(coalesce(v_location, '')) > 300 OR char_length(coalesce(v_contact, '')) > 200
     OR char_length(coalesce(v_req_other, '')) > 300 OR char_length(coalesce(v_remarks, '')) > 2000 THEN
    RAISE EXCEPTION 'One of the text fields is too long';
  END IF;
  IF v_budget IS NOT NULL AND (v_budget < 0 OR v_budget >= 1000000000000) THEN RAISE EXCEPTION 'Estimated budget is out of range'; END IF;

  IF p_visit ? 'requirements' AND jsonb_typeof(p_visit->'requirements') NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'Requirements must be a list';
  END IF;
  SELECT coalesce(array_agg(DISTINCT r ORDER BY r), '{}') INTO v_reqs
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_visit->'requirements') = 'array'
                                      THEN p_visit->'requirements' ELSE '[]'::jsonb END) r;
  IF NOT (v_reqs <@ ARRAY['website','billing_software','crm','attendance_software','other']::text[]) THEN
    RAISE EXCEPTION 'Unknown requirement category';
  END IF;

  -- Serialise concurrent saves of the same id (including two first-time creates).
  PERFORM pg_advisory_xact_lock(hashtextextended('field_visit:' || v_id::text, 0));
  SELECT * INTO v_old FROM public.field_visits WHERE id = v_id FOR UPDATE;

  IF FOUND THEN
    -- Existing visit: only its owner, and only while they still have access. The
    -- company comes from the stored row; a different company in the payload is refused.
    IF v_old.salesperson_id IS DISTINCT FROM v_uid OR NOT field_sales_internal.can_submit(v_old.company_id) THEN
      RAISE EXCEPTION 'Field visit access denied' USING ERRCODE = '42501';
    END IF;
    IF v_company IS NOT NULL AND v_company IS DISTINCT FROM v_old.company_id THEN
      RAISE EXCEPTION 'A field visit cannot be moved to another company';
    END IF;
    IF v_old.status NOT IN ('submitted', 'needs_correction') THEN
      RETURN jsonb_build_object('result', 'locked', 'visit', to_jsonb(v_old));
    END IF;
    IF v_old.status = 'submitted'
       AND v_old.business_name = v_business AND v_old.phone = v_phone
       AND v_old.location IS NOT DISTINCT FROM v_location
       AND v_old.contact_person IS NOT DISTINCT FROM v_contact
       AND v_old.requirements = v_reqs
       AND v_old.requirement_other IS NOT DISTINCT FROM v_req_other
       AND v_old.estimated_budget IS NOT DISTINCT FROM v_budget
       AND v_old.remarks IS NOT DISTINCT FROM v_remarks
       AND v_old.follow_up_date IS NOT DISTINCT FROM v_follow THEN
      RETURN jsonb_build_object('result', 'unchanged', 'visit', to_jsonb(v_old));  -- safe retry
    END IF;

    v_action := CASE WHEN v_old.status = 'needs_correction' THEN 'resubmitted' ELSE 'updated' END;
    UPDATE public.field_visits SET
      business_name = v_business, phone = v_phone, phone_normalized = v_phone_norm,
      location = v_location, contact_person = v_contact, requirements = v_reqs,
      requirement_other = v_req_other, estimated_budget = v_budget, remarks = v_remarks,
      follow_up_date = v_follow, status = 'submitted', updated_at = now()
    WHERE id = v_id RETURNING * INTO v_new;
  ELSE
    IF v_company IS NULL OR NOT coalesce(field_sales_internal.can_submit(v_company), false) THEN
      RAISE EXCEPTION 'Field visit access denied' USING ERRCODE = '42501';
    END IF;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    v_action := 'submitted';
    INSERT INTO public.field_visits (id, company_id, salesperson_id, salesperson_email, business_name, phone,
      phone_normalized, location, contact_person, requirements, requirement_other, estimated_budget, remarks,
      follow_up_date, status, client_created_at)
    VALUES (v_id, v_company, v_uid, coalesce(v_email, ''), v_business, v_phone, v_phone_norm, v_location, v_contact,
      v_reqs, v_req_other, v_budget, v_remarks, v_follow, 'submitted', v_client_ts)
    RETURNING * INTO v_new;
  END IF;

  IF v_email IS NULL THEN SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid; END IF;
  INSERT INTO public.field_visit_events (visit_id, company_id, action, from_status, to_status, actor_id, actor_email, actor_role)
  VALUES (v_new.id, v_new.company_id, v_action, v_old.status, v_new.status, v_uid, coalesce(v_email, ''), v_role);

  RETURN jsonb_build_object('result', v_action, 'visit', to_jsonb(v_new));
END $$;

-- Approve, reject or send back for correction. Owner and admin only.
CREATE OR REPLACE FUNCTION public.review_field_visit(p_visit_id uuid, p_action text, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_email  text;
  v        public.field_visits%ROWTYPE;
  v_target text;
  v_event  text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '42501'; END IF;
  v_role := public.current_app_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only the owner or an admin can review field visits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v FROM public.field_visits WHERE id = p_visit_id FOR UPDATE;
  -- Same message whether the visit is missing or belongs to a company the caller cannot review.
  IF NOT FOUND OR NOT field_sales_internal.can_review(v.company_id) THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'approve'            THEN v_target := 'approved';         v_event := 'approved';
    WHEN 'reject'             THEN v_target := 'rejected';         v_event := 'rejected';
    WHEN 'request_correction' THEN v_target := 'needs_correction'; v_event := 'correction_requested';
    ELSE RAISE EXCEPTION 'Unknown review action';
  END CASE;

  IF v.status = v_target THEN
    RETURN jsonb_build_object('result', 'unchanged', 'visit', to_jsonb(v));        -- safe retry
  END IF;
  IF v.status = 'converted' THEN RAISE EXCEPTION 'A converted field visit can no longer be reviewed'; END IF;
  IF v.status = 'rejected' THEN RAISE EXCEPTION 'A rejected field visit is closed'; END IF;
  IF v_target = 'approved' AND v.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted field visit can be approved';
  END IF;
  IF v_target IN ('rejected', 'needs_correction') AND v_note IS NULL THEN
    RAISE EXCEPTION 'A note is required when rejecting or requesting a correction';
  END IF;
  IF char_length(coalesce(v_note, '')) > 1000 THEN RAISE EXCEPTION 'The review note is too long'; END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  INSERT INTO public.field_visit_events (visit_id, company_id, action, from_status, to_status, actor_id, actor_email,
    actor_role, self_review, note)
  VALUES (v.id, v.company_id, v_event, v.status, v_target, v_uid, coalesce(v_email, ''), v_role,
    v.salesperson_id IS NOT DISTINCT FROM v_uid, v_note);

  UPDATE public.field_visits SET status = v_target, review_note = v_note, reviewed_by = v_uid,
    reviewed_by_email = v_email, reviewed_at = now(), updated_at = now()
  WHERE id = v.id RETURNING * INTO v;

  RETURN jsonb_build_object('result', v_event, 'visit', to_jsonb(v));
END $$;

-- Turn an approved visit into a CRM lead (or link it to an existing one), with an
-- optional follow-up, in ONE transaction. Owner and admin only.
--   result = 'converted'         lead (and follow-up) created or linked
--   result = 'already_converted' nothing done; the earlier outcome is returned
--   result = 'duplicates_found'  nothing done; matching leads returned so the
--                                reviewer can link one or repeat with p_force_new
CREATE OR REPLACE FUNCTION public.convert_field_visit_to_lead(
  p_visit_id uuid,
  p_assignee_email text DEFAULT NULL,       -- NULL = the reviewer
  p_existing_lead_id uuid DEFAULT NULL,
  p_force_new boolean DEFAULT false,
  p_follow_up_date date DEFAULT NULL,       -- NULL = no follow-up
  p_follow_up_time time DEFAULT '11:00'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_role      text;
  v_email     text;
  v           public.field_visits%ROWTYPE;
  v_lead      public.leads%ROWTYPE;
  v_assignee  text;
  v_fu_owner  text;
  v_matches   jsonb;
  v_mode      text;
  v_fu_id     uuid;
  v_fu_at     timestamptz;
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_services  text;
  v_notes     text;
  v_customer  text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '42501'; END IF;
  v_role := public.current_app_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only the owner or an admin can convert field visits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v FROM public.field_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND OR NOT field_sales_internal.can_review(v.company_id) THEN
    RAISE EXCEPTION 'Field visit not found' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: a visit converts once. The row lock above makes concurrent calls queue here.
  IF v.status = 'converted' THEN
    RETURN jsonb_build_object('result', 'already_converted', 'visit', to_jsonb(v), 'lead_id', v.lead_id,
      'lead_number', (SELECT l.lead_number FROM public.leads l WHERE l.id = v.lead_id), 'follow_up_id', v.follow_up_id);
  END IF;
  IF v.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved field visit can be converted'; END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  -- Assignee: the reviewer unless another eligible staff member is chosen. The
  -- salesperson is never used automatically, and a sales account is never eligible.
  v_assignee := lower(btrim(coalesce(nullif(btrim(coalesce(p_assignee_email, '')), ''), v_email, '')));
  IF v_assignee = '' OR NOT field_sales_internal.assignee_ok(v.company_id, v_assignee) THEN
    RAISE EXCEPTION 'The assignee must be an active owner, admin or staff member of this company';
  END IF;

  IF p_follow_up_date IS NOT NULL AND p_follow_up_date < v_today THEN
    RAISE EXCEPTION 'The follow-up date cannot be in the past';
  END IF;

  -- One conversion at a time per company + phone, so two visits to the same
  -- business cannot both miss each other in the duplicate check below.
  PERFORM pg_advisory_xact_lock(hashtextextended('field_visit_phone:' || v.company_id::text || ':' || v.phone_normalized, 0));

  IF p_existing_lead_id IS NOT NULL THEN
    -- Link to an existing lead of the SAME company only.
    SELECT * INTO v_lead FROM public.leads WHERE id = p_existing_lead_id AND company_id = v.company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found in this company'; END IF;
    v_mode := 'linked_existing';
    v_fu_owner := coalesce(nullif(lower(btrim(coalesce(v_lead.assigned_telecaller_email, ''))), ''), v_assignee);

    INSERT INTO public.lead_activities (id, company_id, lead_id, type, notes, performed_by, created_at)
    VALUES (gen_random_uuid(), v.company_id, v_lead.id, 'Field Visit Linked',
      'Field visit to "' || v.business_name || '" by ' || v.salesperson_email
        || ' was linked to this lead. Remarks: ' || coalesce(v.remarks, 'none') || '.',
      coalesce(v_email, 'Staff'), now());
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lead_number', l.lead_number, 'customer_name', l.customer_name,
        'company_name', l.company_name, 'phone', l.phone, 'status', l.status,
        'assigned_telecaller_email', l.assigned_telecaller_email) ORDER BY l.created_at), '[]'::jsonb)
      INTO v_matches
    FROM public.leads l
    WHERE l.company_id = v.company_id
      AND v.phone_normalized IN (field_sales_internal.normalize_phone(l.phone), field_sales_internal.normalize_phone(l.whatsapp_number));

    IF jsonb_array_length(v_matches) > 0 AND NOT coalesce(p_force_new, false) THEN
      RETURN jsonb_build_object('result', 'duplicates_found', 'visit', to_jsonb(v), 'matches', v_matches);
    END IF;

    SELECT string_agg(CASE r WHEN 'website' THEN 'Website' WHEN 'billing_software' THEN 'Billing Software'
        WHEN 'crm' THEN 'CRM' WHEN 'attendance_software' THEN 'Attendance Software'
        ELSE 'Other' || coalesce(': ' || v.requirement_other, '') END, ', ' ORDER BY ord)
      INTO v_services
    FROM unnest(v.requirements) WITH ORDINALITY AS t(r, ord);

    v_customer := coalesce(nullif(btrim(coalesce(v.contact_person, '')), ''), v.business_name);
    v_notes := concat_ws(E'\n',
      'Converted from a field visit on ' || to_char(v_today, 'YYYY-MM-DD') || '.',
      'Collected by: ' || v.salesperson_email,
      'Requirements: ' || coalesce(v_services, 'not specified'),
      CASE WHEN v.estimated_budget IS NOT NULL THEN 'Estimated budget: ' || v.estimated_budget::text END);

    v_mode := 'new_lead';
    v_fu_owner := v_assignee;
    -- lead_number is assigned by the existing assign_lead_number trigger.
    INSERT INTO public.leads (id, company_id, customer_name, company_name, phone, whatsapp_number, location,
      lead_source, source_details, service_required, priority, assigned_telecaller_email, status, notes, remarks)
    VALUES (gen_random_uuid(), v.company_id, v_customer, v.business_name, v.phone, v.phone, v.location,
      'field_visit', 'Field visit by ' || v.salesperson_email || ' [field-visit:' || v.id::text || ']',
      v_services, 'warm', v_assignee, 'new', v_notes, v.remarks)
    RETURNING * INTO v_lead;

    INSERT INTO public.lead_activities (id, company_id, lead_id, type, notes, performed_by, created_at)
    VALUES (gen_random_uuid(), v.company_id, v_lead.id, 'Lead Created',
      'New lead created from a field visit collected by ' || v.salesperson_email || '.',
      coalesce(v_email, 'Staff'), now());
  END IF;

  IF p_follow_up_date IS NOT NULL THEN
    v_fu_id := gen_random_uuid();
    v_fu_at := (p_follow_up_date + coalesce(p_follow_up_time, '11:00'::time)) AT TIME ZONE 'Asia/Kolkata';
    -- Existing follow_ups triggers run here; if any of them raises, everything above rolls back.
    INSERT INTO public.follow_ups (id, company_id, lead_id, lead_number, customer_name, company_name, phone,
      follow_up_date, follow_up_time, reason, notes, assigned_staff_email, status, created_by_email)
    VALUES (v_fu_id, v.company_id, v_lead.id, v_lead.lead_number, v_lead.customer_name, v_lead.company_name, v_lead.phone,
      p_follow_up_date, coalesce(p_follow_up_time, '11:00'::time), 'Field visit follow-up', v.remarks,
      v_fu_owner, 'pending', coalesce(v_email, 'Staff'));

    UPDATE public.leads SET next_follow_up_at = least(coalesce(next_follow_up_at, v_fu_at), v_fu_at), updated_at = now()
    WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (id, company_id, lead_id, type, notes, performed_by, created_at)
    VALUES (gen_random_uuid(), v.company_id, v_lead.id, 'Follow-up Scheduled',
      'Follow-up scheduled for ' || to_char(p_follow_up_date, 'YYYY-MM-DD') || ' (Field visit follow-up), assigned to '
        || v_fu_owner || '.', coalesce(v_email, 'Staff'), now());
  END IF;

  UPDATE public.field_visits SET status = 'converted', lead_id = v_lead.id, follow_up_id = v_fu_id,
    conversion_mode = v_mode, converted_by = v_uid, converted_by_email = v_email, converted_at = now(), updated_at = now()
  WHERE id = v.id RETURNING * INTO v;

  INSERT INTO public.field_visit_events (visit_id, company_id, action, from_status, to_status, actor_id, actor_email,
    actor_role, self_review, details)
  VALUES (v.id, v.company_id, CASE v_mode WHEN 'new_lead' THEN 'converted_new_lead' ELSE 'converted_linked_lead' END,
    'approved', 'converted', v_uid, coalesce(v_email, ''), v_role, v.salesperson_id IS NOT DISTINCT FROM v_uid,
    jsonb_build_object('lead_id', v_lead.id, 'lead_number', v_lead.lead_number, 'lead_assignee', v_assignee,
      'follow_up_id', v_fu_id, 'follow_up_owner', v_fu_owner,
      'forced_new_despite_matches', CASE WHEN v_mode = 'new_lead' THEN coalesce(v_matches, '[]'::jsonb) ELSE '[]'::jsonb END));

  RETURN jsonb_build_object('result', 'converted', 'mode', v_mode, 'visit', to_jsonb(v), 'lead_id', v_lead.id,
    'lead_number', v_lead.lead_number, 'follow_up_id', v_fu_id);
END $$;

-- ---------------------------------------------------------------------
-- 8. Function privileges
--    Supabase grants EXECUTE on new functions to PUBLIC, anon and
--    authenticated by default, so everything is revoked first and then
--    granted back narrowly. anon gets nothing.
--
--    SECURITY DEFINER functions (all owned by the role running this script,
--    all with search_path = ''):
--      can_submit, can_review, assignee_ok          internal
--      my_field_sales_companies, field_visit_assignees,
--      save_field_visit, review_field_visit,
--      convert_field_visit_to_lead                  API
--    SECURITY INVOKER: normalize_phone (pure), guard_membership and
--    audit_guard (triggers).
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA field_sales_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  field_sales_internal.normalize_phone(text),
  field_sales_internal.can_submit(uuid),
  field_sales_internal.can_review(uuid),
  field_sales_internal.assignee_ok(uuid, text),
  field_sales_internal.guard_membership(),
  field_sales_internal.audit_guard(),
  public.my_field_sales_companies(),
  public.field_visit_assignees(uuid),
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
FROM PUBLIC, anon, authenticated;

-- Needed only so the field_visits_read policy can be evaluated for a signed-in user.
GRANT USAGE ON SCHEMA field_sales_internal TO authenticated;
GRANT EXECUTE ON FUNCTION
  field_sales_internal.can_submit(uuid),
  field_sales_internal.can_review(uuid)
TO authenticated;

-- The five API entry points.
GRANT EXECUTE ON FUNCTION
  public.my_field_sales_companies(),
  public.field_visit_assignees(uuid),
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Record what was created, so a later run can tell ours from anything else
-- ---------------------------------------------------------------------
DO $$
DECLARE obj text[];
BEGIN
  FOREACH obj SLICE 1 IN ARRAY ARRAY[
    ['table',    'public.field_sales_members'],
    ['table',    'public.field_visits'],
    ['table',    'public.field_visit_events'],
    ['function', 'field_sales_internal.normalize_phone(text)'],
    ['function', 'field_sales_internal.can_submit(uuid)'],
    ['function', 'field_sales_internal.can_review(uuid)'],
    ['function', 'field_sales_internal.assignee_ok(uuid,text)'],
    ['function', 'field_sales_internal.guard_membership()'],
    ['function', 'field_sales_internal.audit_guard()'],
    ['function', 'public.my_field_sales_companies()'],
    ['function', 'public.field_visit_assignees(uuid)'],
    ['function', 'public.save_field_visit(jsonb)'],
    ['function', 'public.review_field_visit(uuid,text,text)'],
    ['function', 'public.convert_field_visit_to_lead(uuid,text,uuid,boolean,date,time without time zone)'],
    ['policy',   'public.field_visits/field_visits_read'],
    ['policy',   'public.field_visit_events/field_visit_events_read'],
    ['trigger',  'public.app_company_members/field_sales_guard_membership'],
    ['trigger',  'public.app_members/field_sales_guard_membership'],
    ['trigger',  'public.field_sales_members/field_sales_guard_membership'],
    ['trigger',  'public.field_visit_events/field_visit_events_append_only'],
    ['trigger',  'public.field_visit_events/field_visit_events_no_truncate'],
    ['trigger',  'public.field_visits/field_visits_no_delete'],
    ['trigger',  'public.field_visits/field_visits_no_truncate']
  ] LOOP
    PERFORM b2p_migration_internal.record_object('field_sales', obj[1], obj[2]);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
