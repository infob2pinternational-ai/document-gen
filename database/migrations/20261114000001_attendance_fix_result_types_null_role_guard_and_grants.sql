-- =====================================================================
-- B2P CRM Attendance: production fix for 20261113000001.
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- Found on the live project after 20261113000001 was applied:
--
-- 1. list_attendance_sessions failed with "structure of query does not
--    match function result type" (Returned type character varying(255)
--    does not match expected type text in column 3). auth.users.email is
--    varchar(255) on Supabase; the function declared text and a plpgsql
--    RETURN QUERY requires an exact type match. Fixed with explicit ::text
--    casts. Signature and result columns are unchanged.
--
-- 2. The Owner/IT Admin guard was `current_app_role() NOT IN ('owner',
--    'admin')`. current_app_role() returns NULL for anon callers and for a
--    signed-in user with no active app_members row, and NULL NOT IN (...)
--    is NULL, so `IF` did not raise and the guard let them through. The
--    guard is now null-safe: coalesce(current_app_role(), '') NOT IN (...).
--
-- 3. get_attendance_settings / set_attendance_settings were never created
--    on the live project (the original apply was interrupted), so the
--    Office hours settings panel failed too. Created here.
--
-- 4. The REVOKE / GRANT section of the original migration never ran, so
--    the three tables kept Supabase's default privileges for anon and
--    authenticated (RLS is not enabled on them by design) and the
--    functions stayed executable by anon. Re-applied here: no table
--    privileges for anon/authenticated/PUBLIC, functions executable by
--    authenticated only.
--
-- No table is created, altered or dropped and no attendance row is read
-- or changed. Every statement is idempotent (CREATE OR REPLACE / REVOKE /
-- GRANT), so re-running this file is safe. The service_role privileges
-- are not touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 + 2. list_attendance_sessions: ::text casts and null-safe guard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_attendance_sessions(
  p_from date, p_to date, p_user_id uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid, user_id uuid, employee_email text, session_id text,
  login_at timestamptz, logout_at timestamptz, duration_seconds integer, session_status text,
  login_lat numeric, login_lng numeric, login_accuracy_m numeric, login_location_status text,
  logout_lat numeric, logout_lng numeric, logout_accuracy_m numeric, logout_location_status text,
  correction_reason text, corrected_by_email text, corrected_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(public.current_app_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Invalid date range'; END IF;

  RETURN QUERY
  SELECT s.id, s.user_id, u.email::text, s.session_id, s.login_at, s.logout_at, s.duration_seconds, s.session_status,
    s.login_lat, s.login_lng, s.login_accuracy_m, s.login_location_status,
    s.logout_lat, s.logout_lng, s.logout_accuracy_m, s.logout_location_status,
    s.correction_reason, cu.email::text, s.corrected_at, s.created_at
  FROM public.employee_attendance_sessions s
  JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN auth.users cu ON cu.id = s.corrected_by
  WHERE (s.login_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
  ORDER BY s.login_at DESC;
END $$;

-- ---------------------------------------------------------------------
-- 2. attendance_summary: null-safe guard (body otherwise unchanged).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_summary(p_date date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_date date := coalesce(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_total_sales integer;
  v_present integer;
  v_active integer;
  v_incomplete integer;
  v_avg_seconds numeric;
  v_late integer;
  v_settings public.attendance_settings%ROWTYPE;
BEGIN
  IF coalesce(public.current_app_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total_sales FROM public.app_members WHERE role = 'sales' AND active;
  SELECT count(DISTINCT user_id) INTO v_present FROM public.employee_attendance_sessions
   WHERE (login_at AT TIME ZONE 'Asia/Kolkata')::date = v_date;
  SELECT count(*) INTO v_active FROM public.employee_attendance_sessions WHERE session_status = 'active';
  SELECT count(*) INTO v_incomplete FROM public.employee_attendance_sessions WHERE session_status = 'incomplete';
  SELECT avg(duration_seconds) INTO v_avg_seconds FROM public.employee_attendance_sessions
   WHERE session_status IN ('completed', 'admin_corrected') AND (login_at AT TIME ZONE 'Asia/Kolkata')::date = v_date;

  SELECT * INTO v_settings FROM public.attendance_settings LIMIT 1;
  IF FOUND AND v_settings.expected_start_time IS NOT NULL THEN
    SELECT count(*) INTO v_late FROM public.employee_attendance_sessions
     WHERE (login_at AT TIME ZONE 'Asia/Kolkata')::date = v_date
       AND (login_at AT TIME ZONE 'Asia/Kolkata')::time >
           (v_settings.expected_start_time + make_interval(mins => coalesce(v_settings.late_after_minutes, 0)));
  ELSE
    v_late := NULL;  -- no office hours configured - never invented
  END IF;

  RETURN jsonb_build_object(
    'date', v_date, 'total_field_sales', v_total_sales, 'present_today', v_present,
    'not_logged_in', greatest(v_total_sales - v_present, 0),
    'active_sessions', v_active, 'incomplete_sessions', v_incomplete,
    'average_session_seconds', v_avg_seconds, 'late_arrivals', v_late
  );
END $$;

-- ---------------------------------------------------------------------
-- 2. correct_attendance_session: null-safe guard (body otherwise unchanged).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_attendance_session(
  p_session_id uuid, p_new_login_at timestamptz, p_new_logout_at timestamptz, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.employee_attendance_sessions%ROWTYPE;
  v_new public.employee_attendance_sessions%ROWTYPE;
BEGIN
  IF coalesce(public.current_app_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'A correction reason is required'; END IF;
  IF p_new_login_at IS NULL THEN RAISE EXCEPTION 'A login time is required'; END IF;
  IF p_new_logout_at IS NOT NULL AND p_new_logout_at <= p_new_login_at THEN
    RAISE EXCEPTION 'Logout time must be after login time';
  END IF;
  IF p_new_login_at > now() OR p_new_logout_at > now() THEN
    RAISE EXCEPTION 'Corrected times cannot be in the future';
  END IF;

  SELECT * INTO v_old FROM public.employee_attendance_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance session not found'; END IF;

  UPDATE public.employee_attendance_sessions SET
    login_at = p_new_login_at, logout_at = p_new_logout_at,
    duration_seconds = CASE WHEN p_new_logout_at IS NOT NULL
      THEN extract(epoch FROM (p_new_logout_at - p_new_login_at))::integer END,
    session_status = CASE WHEN p_new_logout_at IS NOT NULL THEN 'admin_corrected' ELSE 'incomplete' END,
    correction_reason = p_reason, corrected_by = v_uid, corrected_at = now(), updated_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_new;

  INSERT INTO public.employee_attendance_corrections (
    id, session_id, old_login_at, old_logout_at, old_duration_seconds, old_session_status,
    new_login_at, new_logout_at, new_duration_seconds, new_session_status, reason, corrected_by, corrected_at
  ) VALUES (
    gen_random_uuid(), p_session_id, v_old.login_at, v_old.logout_at, v_old.duration_seconds, v_old.session_status,
    v_new.login_at, v_new.logout_at, v_new.duration_seconds, v_new.session_status, p_reason, v_uid, v_new.corrected_at
  );

  RETURN jsonb_build_object('result', 'corrected', 'session', to_jsonb(v_new));
END $$;

-- ---------------------------------------------------------------------
-- 2 + 3. Office hours configuration: created if missing, null-safe guard.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.attendance_settings%ROWTYPE;
BEGIN
  IF coalesce(public.current_app_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attendance_settings LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('configured', false); END IF;
  RETURN jsonb_build_object('configured', true, 'expected_start_time', v_row.expected_start_time,
    'expected_end_time', v_row.expected_end_time, 'late_after_minutes', v_row.late_after_minutes);
END $$;

CREATE OR REPLACE FUNCTION public.set_attendance_settings(
  p_expected_start_time time, p_expected_end_time time, p_late_after_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.attendance_settings%ROWTYPE;
BEGIN
  IF coalesce(public.current_app_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;
  IF p_late_after_minutes IS NOT NULL AND p_late_after_minutes < 0 THEN
    RAISE EXCEPTION 'late_after_minutes must not be negative';
  END IF;

  DELETE FROM public.attendance_settings;
  INSERT INTO public.attendance_settings (id, expected_start_time, expected_end_time, late_after_minutes, updated_by, updated_at)
  VALUES (1, p_expected_start_time, p_expected_end_time, p_late_after_minutes, v_uid, now())
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('configured', true, 'expected_start_time', v_row.expected_start_time,
    'expected_end_time', v_row.expected_end_time, 'late_after_minutes', v_row.late_after_minutes);
END $$;

-- ---------------------------------------------------------------------
-- 4. Grants: same end state the original migration was meant to produce.
-- ---------------------------------------------------------------------
REVOKE ALL ON public.employee_attendance_sessions, public.employee_attendance_corrections, public.attendance_settings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.record_attendance_login(text, numeric, numeric, numeric, text),
  public.record_attendance_logout(text, numeric, numeric, numeric, text),
  public.list_attendance_sessions(date, date, uuid),
  public.attendance_summary(date),
  public.correct_attendance_session(uuid, timestamptz, timestamptz, text),
  public.get_attendance_settings(),
  public.set_attendance_settings(time, time, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.record_attendance_login(text, numeric, numeric, numeric, text),
  public.record_attendance_logout(text, numeric, numeric, numeric, text),
  public.list_attendance_sessions(date, date, uuid),
  public.attendance_summary(date),
  public.correct_attendance_session(uuid, timestamptz, timestamptz, text),
  public.get_attendance_settings(),
  public.set_attendance_settings(time, time, integer)
TO authenticated;
