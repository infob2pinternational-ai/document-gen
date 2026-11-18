-- =====================================================================
-- Field Sales: replace the Field Visit service catalogue with B2P's
-- actual services, from https://www.b2pinternational.com/
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- Business requirement: the "What do they need?" field on a field visit
-- offered a placeholder catalogue (Website, Billing Software, CRM,
-- Attendance Software, Other) that has nothing to do with what B2P
-- actually sells. The frontend picker now offers B2P's real services
-- (see REQUIREMENT_OPTIONS in src/services/fieldVisitService.ts); this
-- migration brings the two places the old catalogue was also hard-coded
-- on the server in line with it:
--   1. field_visits.requirements' CHECK constraint, which would otherwise
--      reject every new submission from the updated picker.
--   2. save_field_visit's own validation of the same list (belt and
--      braces - the CHECK constraint is not the only place this was
--      enforced).
--   3. convert_field_visit_to_lead's CASE expression that turns the
--      stored keys into the human-readable text saved onto the CRM
--      lead's service_required / notes fields.
--
-- Backward compatibility: a visit submitted before this change may still
-- carry 'website', 'billing_software', 'crm' or 'attendance_software' in
-- its requirements array. Those keys are kept valid everywhere below
-- (the CHECK constraint, save_field_visit's validation, and the label
-- CASE) rather than removed, for two reasons: existing rows must not be
-- made invalid by a later UPDATE of the same row (e.g. a status change),
-- and the office "correct and resubmit" flow resends a visit's existing
-- requirements array unchanged when the salesperson does not touch that
-- field. The frontend's equivalent fallback is
-- LEGACY_REQUIREMENT_LABELS / requirementLabel() in the same file.
--
-- Nothing here touches existing field_visits or leads rows. No data is
-- deleted, retyped or backfilled - old rows keep their old key values
-- and still display correctly through the fallback described above.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CHECK constraint on field_visits.requirements.
-- ---------------------------------------------------------------------
ALTER TABLE public.field_visits DROP CONSTRAINT IF EXISTS field_visits_requirements_check;
ALTER TABLE public.field_visits ADD CONSTRAINT field_visits_requirements_check
  CHECK (requirements <@ ARRAY[
    'mobile_led_van_advertising','led_wall_display_rental','lookwalker_advertising',
    'vehicle_branding_fleet_wraps','billboard_hoarding_advertising','event_roadshow_marketing',
    'graphic_designing','video_production_4k','event_video_coverage','acrylic_signage_3d',
    'shop_boards_signage','commercial_printing','digital_marketing','whatsapp_bulk_messaging',
    'brand_promotion','corporate_advertising','pr_media_strategy','other',
    -- legacy keys from before this catalogue existed - see note above.
    'website','billing_software','crm','attendance_software'
  ]::text[]);

-- ---------------------------------------------------------------------
-- 2. save_field_visit: identical to the version in
--    20261110000002_field_sales_data_collection.sql except for the
--    allowed-requirements array below.
-- ---------------------------------------------------------------------
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
  IF NOT (v_reqs <@ ARRAY[
    'mobile_led_van_advertising','led_wall_display_rental','lookwalker_advertising',
    'vehicle_branding_fleet_wraps','billboard_hoarding_advertising','event_roadshow_marketing',
    'graphic_designing','video_production_4k','event_video_coverage','acrylic_signage_3d',
    'shop_boards_signage','commercial_printing','digital_marketing','whatsapp_bulk_messaging',
    'brand_promotion','corporate_advertising','pr_media_strategy','other',
    'website','billing_software','crm','attendance_software'
  ]::text[]) THEN
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

-- ---------------------------------------------------------------------
-- 3. convert_field_visit_to_lead: identical to the version in
--    20261110000002_field_sales_data_collection.sql except for the
--    requirement-label CASE expression below. (Not currently called by
--    the frontend - review_field_visit now hands an approved visit to
--    Daily Calling instead, see 20261112000001_field_visit_daily_calling_
--    handoff.sql's convert_telecalling_entry_to_lead, which has the
--    matching CASE expression fixed directly in that file since it has
--    not shipped to production yet. This function stays correct too: it
--    remains a real, callable, SECURITY DEFINER RPC regardless of
--    whether the current UI happens to call it.)
-- ---------------------------------------------------------------------
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

    SELECT string_agg(CASE r
        WHEN 'mobile_led_van_advertising' THEN 'Mobile LED Van Advertising'
        WHEN 'led_wall_display_rental' THEN 'LED Wall Display Rental'
        WHEN 'lookwalker_advertising' THEN 'Lookwalker Advertising'
        WHEN 'vehicle_branding_fleet_wraps' THEN 'Vehicle Branding & Fleet Wraps'
        WHEN 'billboard_hoarding_advertising' THEN 'Billboard & Hoarding Advertising'
        WHEN 'event_roadshow_marketing' THEN 'Event & Roadshow Marketing'
        WHEN 'graphic_designing' THEN 'Graphic Designing'
        WHEN 'video_production_4k' THEN '4K Video Production'
        WHEN 'event_video_coverage' THEN 'Event Video Coverage'
        WHEN 'acrylic_signage_3d' THEN '3D Acrylic Signage'
        WHEN 'shop_boards_signage' THEN 'Shop Boards & Signage'
        WHEN 'commercial_printing' THEN 'Commercial Printing'
        WHEN 'digital_marketing' THEN 'Digital Marketing'
        WHEN 'whatsapp_bulk_messaging' THEN 'WhatsApp Bulk Messaging'
        WHEN 'brand_promotion' THEN 'Brand Promotion'
        WHEN 'corporate_advertising' THEN 'Corporate Advertising'
        WHEN 'pr_media_strategy' THEN 'PR & Media Strategy'
        -- legacy keys from before this catalogue existed - see note at the top of this file.
        WHEN 'website' THEN 'Website'
        WHEN 'billing_software' THEN 'Billing Software'
        WHEN 'crm' THEN 'CRM'
        WHEN 'attendance_software' THEN 'Attendance Software'
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
