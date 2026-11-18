-- =====================================================================
-- ROLLBACK: 20261112000001_field_visit_daily_calling_handoff.sql
--
-- Restores review_field_visit to its pre-handoff body (approve only sets
-- status; no telecalling_entries row is inserted). Drops the new
-- convert_telecalling_entry_to_lead function. Leaves the new
-- telecalling_entries columns and the unique index in place: they are
-- nullable and additive, and dropping them would delete the field-visit
-- linkage and conversion history of any Daily Calling entries created
-- while this migration was active. Drop them by hand only if you are
-- certain nothing references them.
--
-- For deliberate, approved use only.
-- =====================================================================
BEGIN;

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
    RETURN jsonb_build_object('result', 'unchanged', 'visit', to_jsonb(v));
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

DROP FUNCTION IF EXISTS public.convert_telecalling_entry_to_lead(uuid, text, date, time, uuid, boolean);

COMMIT;
