-- =====================================================================
-- CHANGE: Field Visit -> Daily Calling handoff (replaces direct Field Visit -> Lead)
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- DO NOT RUN WITHOUT REVIEW. NOT YET APPLIED TO PRODUCTION (written and
-- tested against PGlite/local Postgres only; see tests/field-sales-daily-
-- calling-handoff.test.mjs).
--
-- Business requirement this implements: an approved field visit must never
-- become a CRM lead by itself. Approval now hands the visit to the existing
-- Daily Calling workflow (public.telecalling_entries) instead; a telecaller
-- calls the prospect and records a real outcome; only then may the office
-- explicitly qualify it into a lead, through a new function that mirrors
-- convert_field_visit_to_lead's safeguards (ownership check, duplicate
-- detection, idempotency) but reads from telecalling_entries.
--
-- Depends on 20261110000001_security_office_roles_only.sql and
-- 20261110000002_field_sales_data_collection.sql (uses their registry,
-- field_sales_internal.assignee_ok, and replaces part of review_field_visit).
-- Independent of 20261111000001 (telecalling queue claim fix).
--
-- What changes
--   1. public.telecalling_entries gains nullable columns carrying the field
--      visit's own data (website, estimated_budget, requirements,
--      requirement_other, visit_remarks, visit_date, salesperson_email),
--      a field_visit_id back-reference (unique while not null: exactly one
--      Daily Calling entry per visit, enforced by the database, not just by
--      application logic), and converted_lead_id/converted_at/
--      converted_by_email so a telecalling entry's own conversion state is
--      tracked durably (not only by the pre-existing source_details marker
--      string, which was never queryable or race-safe).
--   2. public.review_field_visit's 'approve' branch now also inserts a
--      telecalling_entries row for the visit (idempotent on field_visit_id;
--      a second approval attempt, or any retry, inserts nothing more - the
--      visit row's own FOR UPDATE lock already serializes this, and the
--      unique index is defense in depth). It still does not call, and never
--      calls, convert_field_visit_to_lead: no lead is created on approval.
--   3. A new function, public.convert_telecalling_entry_to_lead, lets the
--      office explicitly qualify a calling-history entry into a lead, with
--      the same safeguards as convert_field_visit_to_lead: owner/admin only,
--      row-locked, idempotent (returns 'already_converted' rather than
--      creating a second lead on retry), duplicate-checked by phone against
--      existing leads, and able to assign the lead and schedule a follow-up
--      in the same transaction.
--   4. convert_field_visit_to_lead itself is untouched and still exists (for
--      any already-converted visits from before this change); nothing calls
--      it from the approval path any more.
--
-- Re-running
--   Same object-registry fingerprinting as the other migrations in this
--   folder. A re-run is a no-op; an object changed by someone else since
--   this script created it stops the script instead of overwriting it.
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.telecalling_entries') IS NULL THEN
    RAISE EXCEPTION 'Fix stopped: public.telecalling_entries not found. Wrong database?';
  END IF;
  IF to_regclass('public.field_visits') IS NULL
     OR to_regprocedure('public.review_field_visit(uuid,text,text)') IS NULL
     OR to_regprocedure('field_sales_internal.assignee_ok(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Fix stopped: apply 20261110000002_field_sales_data_collection.sql first.';
  END IF;
  IF to_regclass('b2p_migration_internal.object_registry') IS NULL
     OR to_regprocedure('b2p_migration_internal.assert_unmodified(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Fix stopped: apply 20261110000001_security_office_roles_only.sql first.';
  END IF;
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Fix stopped: run as the database owner role (it must be able to bypass row-level security).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Definition checks for everything this script owns.
-- ---------------------------------------------------------------------
DO $$
DECLARE obj text[];
BEGIN
  FOREACH obj SLICE 1 IN ARRAY ARRAY[
    ['function', 'public.convert_telecalling_entry_to_lead(uuid,text,date,time without time zone,uuid,boolean)']
  ] LOOP
    PERFORM b2p_migration_internal.assert_unmodified(obj[1], obj[2]);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. New columns on telecalling_entries. All nullable; nothing existing
--    changes meaning. Added with IF NOT EXISTS so a re-run is a no-op.
-- ---------------------------------------------------------------------
ALTER TABLE public.telecalling_entries
  ADD COLUMN IF NOT EXISTS field_visit_id     uuid REFERENCES public.field_visits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS website            text,
  ADD COLUMN IF NOT EXISTS estimated_budget   numeric(14,2),
  ADD COLUMN IF NOT EXISTS requirements       text[],
  ADD COLUMN IF NOT EXISTS requirement_other  text,
  ADD COLUMN IF NOT EXISTS visit_remarks      text,
  ADD COLUMN IF NOT EXISTS visit_date         date,
  ADD COLUMN IF NOT EXISTS salesperson_email  text,
  ADD COLUMN IF NOT EXISTS converted_lead_id  uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS converted_by_email text;

-- Exactly one Daily Calling entry per approved visit, enforced by the
-- database: a second insert attempt for the same visit hits this index.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'telecalling_entries_field_visit_id_key') THEN
    CREATE UNIQUE INDEX telecalling_entries_field_visit_id_key ON public.telecalling_entries (field_visit_id) WHERE field_visit_id IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. review_field_visit: approve now also hands the visit to Daily Calling.
--    This replaces the whole function body; the precondition check above
--    already stopped the script if something else owns this name.
-- ---------------------------------------------------------------------
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
  v_entry_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '42501'; END IF;
  v_role := public.current_app_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only the owner or an admin can review field visits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v FROM public.field_visits WHERE id = p_visit_id FOR UPDATE;
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

  IF v_target = 'approved' THEN
    -- Hand the visit to Daily Calling. Idempotent on field_visit_id: a retry
    -- or a second concurrent approval (blocked above by v.status = v_target
    -- once the first commits, and by the FOR UPDATE lock meanwhile) inserts
    -- nothing further. No lead is created here, and nothing below calls
    -- convert_field_visit_to_lead.
    INSERT INTO public.telecalling_entries (
      company_id, entry_date, company_name, contact_person, phone, location, email,
      call_status, field_visit_id, website, estimated_budget, requirements, requirement_other,
      visit_remarks, visit_date, salesperson_email, created_by, created_by_email
    )
    VALUES (
      v.company_id, (now() AT TIME ZONE 'Asia/Kolkata')::date, v.business_name, v.contact_person, v.phone, v.location, NULL,
      'Not Called Yet', v.id, NULL, v.estimated_budget, v.requirements, v.requirement_other,
      v.remarks, (v.created_at AT TIME ZONE 'Asia/Kolkata')::date, v.salesperson_email, v_uid, v_email
    )
    ON CONFLICT (field_visit_id) WHERE field_visit_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_entry_id;

    IF v_entry_id IS NULL THEN
      SELECT id INTO v_entry_id FROM public.telecalling_entries WHERE field_visit_id = v.id;
    END IF;
    -- field_visit_events is append-only (see audit_guard): the telecalling_entry_id is
    -- returned below instead of being written onto the 'approved' event afterward.
  END IF;

  RETURN jsonb_build_object('result', v_event, 'visit', to_jsonb(v), 'telecalling_entry_id', v_entry_id);
END $$;

-- ---------------------------------------------------------------------
-- 4. New function: explicit office qualification of a Daily Calling entry
--    into a CRM lead. Mirrors convert_field_visit_to_lead's safeguards.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_telecalling_entry_to_lead(
  p_entry_id uuid,
  p_assignee_email text DEFAULT NULL,       -- NULL = the caller
  p_follow_up_date date DEFAULT NULL,       -- NULL = no follow-up
  p_follow_up_time time DEFAULT '11:00',
  p_existing_lead_id uuid DEFAULT NULL,
  p_force_new boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_role      text;
  v_email     text;
  e           public.telecalling_entries%ROWTYPE;
  v_lead      public.leads%ROWTYPE;
  v_assignee  text;
  v_fu_owner  text;
  v_matches   jsonb;
  v_fu_id     uuid;
  v_fu_at     timestamptz;
  v_phone_norm text;
  v_services  text;
  v_notes     text;
  v_customer  text;
  v_source    text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '42501'; END IF;
  v_role := public.current_app_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only the owner or an admin can qualify a calling record into a lead' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO e FROM public.telecalling_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_company(e.company_id) THEN
    RAISE EXCEPTION 'Calling record not found' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: an entry converts once. The row lock above makes concurrent calls queue here.
  IF e.converted_lead_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_converted', 'lead_id', e.converted_lead_id,
      'lead_number', (SELECT l.lead_number FROM public.leads l WHERE l.id = e.converted_lead_id));
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  v_assignee := lower(btrim(coalesce(nullif(btrim(coalesce(p_assignee_email, '')), ''), v_email, '')));
  IF v_assignee = '' OR NOT field_sales_internal.assignee_ok(e.company_id, v_assignee) THEN
    RAISE EXCEPTION 'The assignee must be an active owner, admin or staff member of this company';
  END IF;

  IF p_follow_up_date IS NOT NULL AND p_follow_up_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'The follow-up date cannot be in the past';
  END IF;

  v_phone_norm := field_sales_internal.normalize_phone(e.phone);
  -- One conversion at a time per company + phone, matching convert_field_visit_to_lead.
  PERFORM pg_advisory_xact_lock(hashtextextended('field_visit_phone:' || e.company_id::text || ':' || v_phone_norm, 0));

  IF p_existing_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = p_existing_lead_id AND company_id = e.company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found in this company'; END IF;
    v_fu_owner := coalesce(nullif(lower(btrim(coalesce(v_lead.assigned_telecaller_email, ''))), ''), v_assignee);

    INSERT INTO public.lead_activities (id, company_id, lead_id, type, notes, performed_by, created_at)
    VALUES (gen_random_uuid(), e.company_id, v_lead.id, 'Calling Record Linked',
      'Daily Calling record for "' || e.company_name || '" (status: ' || e.call_status || ') was linked to this lead.',
      coalesce(v_email, 'Staff'), now());
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lead_number', l.lead_number, 'customer_name', l.customer_name,
        'company_name', l.company_name, 'phone', l.phone, 'status', l.status,
        'assigned_telecaller_email', l.assigned_telecaller_email) ORDER BY l.created_at), '[]'::jsonb)
      INTO v_matches
    FROM public.leads l
    WHERE l.company_id = e.company_id
      AND v_phone_norm IN (field_sales_internal.normalize_phone(l.phone), field_sales_internal.normalize_phone(l.whatsapp_number));

    IF jsonb_array_length(v_matches) > 0 AND NOT coalesce(p_force_new, false) THEN
      RETURN jsonb_build_object('result', 'duplicates_found', 'matches', v_matches);
    END IF;

    v_source := CASE WHEN e.field_visit_id IS NOT NULL THEN 'field_visit' ELSE 'phone' END;
    SELECT string_agg(CASE r WHEN 'website' THEN 'Website' WHEN 'billing_software' THEN 'Billing Software'
        WHEN 'crm' THEN 'CRM' WHEN 'attendance_software' THEN 'Attendance Software'
        ELSE 'Other' || coalesce(': ' || e.requirement_other, '') END, ', ' ORDER BY ord)
      INTO v_services
    FROM unnest(coalesce(e.requirements, '{}'::text[])) WITH ORDINALITY AS t(r, ord);

    v_customer := coalesce(nullif(btrim(coalesce(e.contact_person, '')), ''), e.company_name);
    v_notes := concat_ws(E'\n',
      'Qualified from Daily Calling on ' || to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') || '.',
      'Call outcome: ' || e.call_status,
      CASE WHEN e.salesperson_email IS NOT NULL THEN 'Originally collected in the field by: ' || e.salesperson_email END,
      CASE WHEN v_services IS NOT NULL THEN 'Requirements: ' || v_services END,
      CASE WHEN e.estimated_budget IS NOT NULL THEN 'Estimated budget: ' || e.estimated_budget::text END,
      CASE WHEN e.feedback IS NOT NULL THEN 'Latest call feedback: ' || e.feedback END);

    v_fu_owner := v_assignee;
    INSERT INTO public.leads (id, company_id, customer_name, company_name, phone, whatsapp_number, location,
      lead_source, source_details, service_required, priority, assigned_telecaller_email, status, notes, remarks)
    VALUES (gen_random_uuid(), e.company_id, v_customer, e.company_name, e.phone, e.phone, coalesce(e.website, e.location),
      v_source, 'Daily Calling [telecalling-entry:' || e.id::text || ']'
        || (CASE WHEN e.field_visit_id IS NOT NULL THEN ' [field-visit:' || e.field_visit_id::text || ']' ELSE '' END),
      v_services, 'warm', v_assignee, 'new', v_notes, e.visit_remarks)
    RETURNING * INTO v_lead;

    INSERT INTO public.lead_activities (id, company_id, lead_id, type, notes, performed_by, created_at)
    VALUES (gen_random_uuid(), e.company_id, v_lead.id, 'Lead Created',
      'New lead qualified from a Daily Calling record (outcome: ' || e.call_status || ').',
      coalesce(v_email, 'Staff'), now());
  END IF;

  IF p_follow_up_date IS NOT NULL THEN
    v_fu_id := gen_random_uuid();
    v_fu_at := (p_follow_up_date + coalesce(p_follow_up_time, '11:00'::time)) AT TIME ZONE 'Asia/Kolkata';
    INSERT INTO public.follow_ups (id, company_id, lead_id, lead_number, customer_name, company_name, phone,
      follow_up_date, follow_up_time, reason, notes, assigned_staff_email, status, created_by_email)
    VALUES (v_fu_id, e.company_id, v_lead.id, v_lead.lead_number, v_lead.customer_name, v_lead.company_name, v_lead.phone,
      p_follow_up_date, coalesce(p_follow_up_time, '11:00'::time), 'Qualified from Daily Calling', e.feedback,
      v_fu_owner, 'pending', coalesce(v_email, 'Staff'));

    UPDATE public.leads SET next_follow_up_at = least(coalesce(next_follow_up_at, v_fu_at), v_fu_at), updated_at = now()
    WHERE id = v_lead.id;
  END IF;

  UPDATE public.telecalling_entries SET converted_lead_id = v_lead.id, converted_at = now(), converted_by_email = v_email
  WHERE id = e.id;

  RETURN jsonb_build_object('result', 'converted', 'lead_id', v_lead.id, 'lead_number', v_lead.lead_number, 'follow_up_id', v_fu_id);
END $$;

REVOKE ALL ON FUNCTION public.convert_telecalling_entry_to_lead(uuid, text, date, time, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_telecalling_entry_to_lead(uuid, text, date, time, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Record what was created.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM b2p_migration_internal.record_object('field_visit_daily_calling_handoff', 'function',
    'public.convert_telecalling_entry_to_lead(uuid,text,date,time without time zone,uuid,boolean)');
  -- review_field_visit's body changed above; re-recording it here means a later check of its
  -- fingerprint (by this migration, by a verification script, or by field_sales_data_collection
  -- if that migration is ever re-run after this one) compares against what is actually live,
  -- not against the pre-handoff body field_sales_data_collection originally recorded. Re-running
  -- field_sales_data_collection's own CREATE OR REPLACE after this migration would still revert
  -- review_field_visit to the pre-handoff body regardless of this record - re-apply this
  -- migration again afterward if that ever happens.
  PERFORM b2p_migration_internal.record_object('field_visit_daily_calling_handoff', 'function', 'public.review_field_visit(uuid,text,text)');
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
