-- =====================================================================
-- Field Sales Data Collection
-- Target: Supabase project rqovkmjsdwzggebvwvdk (verified read-only 2026-11-10).
--
-- DO NOT RUN WITHOUT REVIEW. Read database/FIELD_SALES_DEPLOYMENT.md first
-- (backup checklist, verification queries, rollback).
--
-- Standalone and additive: written against the LIVE schema, not against the
-- other files in this folder (they no longer reproduce production).
-- Safe to re-run: every statement is idempotent.
--
-- New objects
--   tables     field_sales_members, field_visits, field_visit_events
--   functions  field_visit_normalize_phone, field_sales_can_submit,
--              field_visit_can_review, field_visit_assignee_ok,
--              field_sales_guard_membership (trigger),
--              my_field_sales_companies, field_visit_assignees,
--              save_field_visit, review_field_visit, convert_field_visit_to_lead
-- Changes to existing objects (all reversible, see the rollback script)
--   1. app_members_role_check        gains 'sales'
--   2. leads_lead_source_check       gains 'field_visit'
--   3. app_members, app_company_members   one guard trigger each
--   4. 19 previously open tables     one RESTRICTIVE policy each (office_roles_only)
-- No existing policy, function, trigger or row is edited or removed.
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
END $$;

-- ---------------------------------------------------------------------
-- 1. Restricted "sales" role
-- ---------------------------------------------------------------------
ALTER TABLE public.app_members DROP CONSTRAINT IF EXISTS app_members_role_check;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text, 'sales'::text]));

-- ---------------------------------------------------------------------
-- 2. "field_visit" lead source (the nine existing values are unchanged)
-- ---------------------------------------------------------------------
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check
  CHECK (lead_source = ANY (ARRAY['facebook'::text, 'instagram'::text, 'whatsapp_bulk'::text, 'website'::text,
    'bulk_email'::text, 'existing_customer'::text, 'phone'::text, 'referral'::text, 'other'::text, 'field_visit'::text]));

-- ---------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------
-- Which companies a salesperson may submit visits for. Deliberately separate
-- from app_company_members: a row here grants nothing on any existing table.
CREATE TABLE IF NOT EXISTS public.field_sales_members (
  user_id    uuid NOT NULL REFERENCES public.app_members(user_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active     boolean NOT NULL DEFAULT true,
  note       text,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.field_visits (
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
CREATE INDEX IF NOT EXISTS idx_field_visits_company_status ON public.field_visits (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_visits_salesperson ON public.field_visits (salesperson_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_visits_company_phone ON public.field_visits (company_id, phone_normalized);

-- Append-only audit history. Rows are written only by the functions below.
CREATE TABLE IF NOT EXISTS public.field_visit_events (
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
CREATE INDEX IF NOT EXISTS idx_field_visit_events_visit ON public.field_visit_events (visit_id, id);

-- ---------------------------------------------------------------------
-- 4. Helper functions
-- ---------------------------------------------------------------------
-- Digits only; drops a leading 91 (12 digits) or 0 (11 digits). Mirrors the
-- client normalisation used for telecalling conversion.
CREATE OR REPLACE FUNCTION public.field_visit_normalize_phone(p_phone text) RETURNS text
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
CREATE OR REPLACE FUNCTION public.field_sales_can_submit(p_company_id uuid) RETURNS boolean
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
CREATE OR REPLACE FUNCTION public.field_visit_can_review(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.current_app_role() IN ('owner','admin'), false)
     AND public.can_access_company(p_company_id)
$$;

-- Is this e-mail an active owner/admin/staff member with access to the company?
-- Internal: never callable by app users.
CREATE OR REPLACE FUNCTION public.field_visit_assignee_ok(p_company_id uuid, p_email text) RETURNS boolean
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
CREATE OR REPLACE FUNCTION public.field_sales_guard_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'app_company_members' THEN
    IF EXISTS (SELECT 1 FROM public.app_members m WHERE m.user_id = NEW.user_id AND m.role = 'sales') THEN
      RAISE EXCEPTION 'A sales user cannot be given normal company membership. Use field_sales_members.';
    END IF;
  ELSIF TG_TABLE_NAME = 'app_members' THEN
    IF NEW.role = 'sales' AND EXISTS (SELECT 1 FROM public.app_company_members c WHERE c.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Remove this user''s app_company_members rows before assigning the sales role.';
    END IF;
  ELSIF TG_TABLE_NAME = 'field_sales_members' THEN
    IF NOT EXISTS (SELECT 1 FROM public.app_members m WHERE m.user_id = NEW.user_id AND m.role = 'sales') THEN
      RAISE EXCEPTION 'field_sales_members is only for users whose app_members role is sales.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_company_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE ON public.app_company_members
  FOR EACH ROW EXECUTE FUNCTION public.field_sales_guard_membership();
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.app_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE OF role ON public.app_members
  FOR EACH ROW EXECUTE FUNCTION public.field_sales_guard_membership();
DROP TRIGGER IF EXISTS field_sales_guard_membership ON public.field_sales_members;
CREATE TRIGGER field_sales_guard_membership BEFORE INSERT OR UPDATE ON public.field_sales_members
  FOR EACH ROW EXECUTE FUNCTION public.field_sales_guard_membership();

-- ---------------------------------------------------------------------
-- 6. Row-level security and grants for the new tables
--    (Supabase grants new tables to anon/authenticated by default: revoke first.)
-- ---------------------------------------------------------------------
ALTER TABLE public.field_sales_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_visit_events  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.field_sales_members, public.field_visits, public.field_visit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.field_visit_events_id_seq FROM PUBLIC, anon, authenticated;
-- Read-only for signed-in users; every write goes through the functions in section 7.
GRANT SELECT ON public.field_visits, public.field_visit_events TO authenticated;

DROP POLICY IF EXISTS field_visits_read ON public.field_visits;
CREATE POLICY field_visits_read ON public.field_visits FOR SELECT TO authenticated
  USING ((salesperson_id = auth.uid() AND public.field_sales_can_submit(company_id))
         OR public.field_visit_can_review(company_id));

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
  WHERE public.field_sales_can_submit(p.id)
  ORDER BY p.name
$$;

-- Staff a reviewer may assign the converted lead to.
CREATE OR REPLACE FUNCTION public.field_visit_assignees(p_company_id uuid) RETURNS TABLE (email text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(public.field_visit_can_review(p_company_id), false) THEN
    RAISE EXCEPTION 'Field visit access denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT lower(u.email)::text, m.role::text
    FROM public.app_members m JOIN auth.users u ON u.id = m.user_id
    WHERE public.field_visit_assignee_ok(p_company_id, u.email)
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
  v_phone_norm := public.field_visit_normalize_phone(v_phone);
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
    IF v_old.salesperson_id IS DISTINCT FROM v_uid OR NOT public.field_sales_can_submit(v_old.company_id) THEN
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
    IF v_company IS NULL OR NOT coalesce(public.field_sales_can_submit(v_company), false) THEN
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
  IF NOT FOUND OR NOT public.field_visit_can_review(v.company_id) THEN
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
  IF NOT FOUND OR NOT public.field_visit_can_review(v.company_id) THEN
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
  IF v_assignee = '' OR NOT public.field_visit_assignee_ok(v.company_id, v_assignee) THEN
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
      AND v.phone_normalized IN (public.field_visit_normalize_phone(l.phone), public.field_visit_normalize_phone(l.whatsapp_number));

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
--    (Supabase grants EXECUTE on new functions to anon/authenticated by default.)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.field_visit_normalize_phone(text),
  public.field_sales_can_submit(uuid),
  public.field_visit_can_review(uuid),
  public.field_visit_assignee_ok(uuid, text),
  public.field_sales_guard_membership(),
  public.my_field_sales_companies(),
  public.field_visit_assignees(uuid),
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.field_sales_can_submit(uuid),       -- needed by the field_visits_read policy; reveals only the caller's own access
  public.field_visit_can_review(uuid),       -- same
  public.my_field_sales_companies(),
  public.field_visit_assignees(uuid),
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
TO authenticated;

-- ---------------------------------------------------------------------
-- 9. Close the 19 tables that were open to every signed-in account.
--    A RESTRICTIVE policy is AND-ed with the existing permissive ones, so the
--    existing policies stay exactly as they are. Owner, admin and staff keep
--    their current access; sales users and accounts with no role get none.
--    The service role bypasses row-level security and is unaffected.
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
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Field sales: expected table public.% not found', t;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS office_roles_only ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY office_roles_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.current_app_role()) IN (''owner'',''admin'',''staff'')) '
      || 'WITH CHECK ((SELECT public.current_app_role()) IN (''owner'',''admin'',''staff''))', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
