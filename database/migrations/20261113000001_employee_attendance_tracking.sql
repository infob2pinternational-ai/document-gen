-- =====================================================================
-- B2P CRM: Staff Attendance & Working Hours tracking (+ login/logout GPS)
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- Business requirement: track Field Sales staff ("sales" role) working
-- time from their existing CRM login/logout activity, visible to Owner
-- and IT Admin only. Field Sales and Office Telecalling accounts must
-- never see attendance data, and must not be able to read or alter it
-- through the Supabase client even if the frontend were bypassed.
--
-- Reuses the existing identity and role system - no new identity table,
-- no new role. "Owner" = app_members.role = 'owner' (unchanged). "IT
-- Admin" = app_members.role = 'admin' (unchanged; already labelled "IT
-- Admin" in the UI - see App.tsx's isItAdmin). "Office Telecalling" =
-- 'staff'. "Field Sales" = 'sales' (added to the role check below if not
-- already present - the Field Sales feature that first introduced this
-- role lives on a separate, not-yet-merged branch at the time this was
-- written; this migration must stand on its own against `main`, and is
-- a harmless no-op re-assertion of the same end state if that branch's
-- own identical change lands first or after).
--
-- Every table here has NO grant to anon or authenticated at all - the
-- same "database administrator only" pattern already used for
-- field_sales_members (20261110000002). The only way to reach this data
-- is through the SECURITY DEFINER functions below, each of which
-- re-checks the caller's role itself via current_app_role() - never the
-- frontend's say-so.
--
-- New objects
--   tables     public.employee_attendance_sessions,
--              public.employee_attendance_corrections (immutable audit),
--              public.attendance_settings (singleton, Owner/IT Admin configurable)
--   functions  public.record_attendance_login, public.record_attendance_logout,
--              public.list_attendance_sessions, public.attendance_summary,
--              public.correct_attendance_session,
--              public.get_attendance_settings, public.set_attendance_settings
-- Changes to existing objects
--   app_members_role_check   gains 'sales' if not already present (see above)
-- No existing policy, function, trigger or row is edited or removed.
--
-- Re-running this file is safe: every CREATE TABLE is existence-guarded,
-- every function is CREATE OR REPLACE of a function this migration alone
-- owns, and the role-check change recomputes to the same end state.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. app_members_role_check: ensure 'sales' is allowed (see header note).
-- ---------------------------------------------------------------------
ALTER TABLE public.app_members DROP CONSTRAINT IF EXISTS app_members_role_check;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check
  CHECK (role = ANY (ARRAY['owner','admin','staff','sales']::text[]));

-- ---------------------------------------------------------------------
-- 1. employee_attendance_sessions
-- ---------------------------------------------------------------------
DO $create$
BEGIN
  IF to_regclass('public.employee_attendance_sessions') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.employee_attendance_sessions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The existing identity record IS the employee record - no separate
    -- "employee" table or id, same as field_visits.salesperson_id.
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- The Supabase auth session identifier (decoded client-side from the
    -- access token's own "session_id" claim - never trusted for identity,
    -- only used as an idempotency key). Stable across a token refresh,
    -- so a refresh can never create a second row for the same sign-in.
    session_id              text NOT NULL UNIQUE,
    login_at                timestamptz NOT NULL,        -- server now(), never client-supplied
    logout_at               timestamptz,
    duration_seconds        integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    session_status          text NOT NULL DEFAULT 'active'
                            CHECK (session_status IN ('active', 'completed', 'incomplete', 'admin_corrected')),
    login_lat               numeric(9,6),
    login_lng               numeric(9,6),
    login_accuracy_m        numeric(10,2),
    login_location_status   text NOT NULL DEFAULT 'not_attempted'
                            CHECK (login_location_status IN
                              ('captured', 'permission_denied', 'unavailable', 'timeout', 'unsupported', 'not_attempted')),
    logout_lat              numeric(9,6),
    logout_lng              numeric(9,6),
    logout_accuracy_m       numeric(10,2),
    logout_location_status  text NOT NULL DEFAULT 'not_attempted'
                            CHECK (logout_location_status IN
                              ('captured', 'permission_denied', 'unavailable', 'timeout', 'unsupported', 'not_attempted')),
    -- Correction audit summary on the row itself (the full before/after
    -- detail lives in employee_attendance_corrections, immutably).
    correction_reason       text CHECK (correction_reason IS NULL OR char_length(correction_reason) <= 1000),
    corrected_by            uuid REFERENCES auth.users(id),
    corrected_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (logout_at IS NULL OR logout_at >= login_at)
  );
  CREATE INDEX employee_attendance_sessions_user_login_idx ON public.employee_attendance_sessions (user_id, login_at DESC);
  CREATE INDEX employee_attendance_sessions_status_idx ON public.employee_attendance_sessions (session_status);
  -- At most one session may be "active" per employee at a time - enforced
  -- here as well as by record_attendance_login's own logic (defense in depth).
  CREATE UNIQUE INDEX employee_attendance_sessions_one_active_idx
    ON public.employee_attendance_sessions (user_id) WHERE session_status = 'active';
END $create$;

-- ---------------------------------------------------------------------
-- 2. employee_attendance_corrections - immutable audit trail. No
--    function ever UPDATEs or DELETEs a row here; only INSERTs.
-- ---------------------------------------------------------------------
DO $create$
BEGIN
  IF to_regclass('public.employee_attendance_corrections') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.employee_attendance_corrections (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id           uuid NOT NULL REFERENCES public.employee_attendance_sessions(id) ON DELETE CASCADE,
    old_login_at         timestamptz NOT NULL,
    old_logout_at        timestamptz,
    old_duration_seconds integer,
    old_session_status   text NOT NULL,
    new_login_at         timestamptz NOT NULL,
    new_logout_at        timestamptz,
    new_duration_seconds integer,
    new_session_status   text NOT NULL,
    reason               text NOT NULL CHECK (char_length(btrim(reason)) > 0),
    corrected_by         uuid NOT NULL REFERENCES auth.users(id),
    corrected_at         timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX employee_attendance_corrections_session_idx ON public.employee_attendance_corrections (session_id);
END $create$;

-- ---------------------------------------------------------------------
-- 3. attendance_settings - singleton row, Owner/IT Admin configurable.
--    Never invented: a dashboard reading this must treat an absent row
--    as "no office hours configured" rather than assuming a default.
-- ---------------------------------------------------------------------
DO $create$
BEGIN
  IF to_regclass('public.attendance_settings') IS NOT NULL THEN RETURN; END IF;
  CREATE TABLE public.attendance_settings (
    id                   integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    expected_start_time  time,
    expected_end_time    time,
    late_after_minutes   integer CHECK (late_after_minutes IS NULL OR late_after_minutes >= 0),
    updated_by           uuid REFERENCES auth.users(id),
    updated_at           timestamptz NOT NULL DEFAULT now()
  );
END $create$;

-- ---------------------------------------------------------------------
-- 4. record_attendance_login
--    Called on every SIGNED_IN auth event (never on TOKEN_REFRESHED or
--    INITIAL_SESSION - the frontend is responsible for that gating; this
--    function is additionally idempotent on session_id regardless).
--    Silently a no-op for anyone who is not "sales" - the frontend does
--    not need to know the caller's role before calling this.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_attendance_login(
  p_session_id text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_status text DEFAULT 'not_attempted'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.employee_attendance_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('result', 'not_signed_in'); END IF;
  IF public.current_app_role() IS DISTINCT FROM 'sales' THEN
    RETURN jsonb_build_object('result', 'not_applicable');  -- attendance tracking only applies to Field Sales accounts
  END IF;
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'A session identifier is required';
  END IF;
  IF coalesce(p_location_status, 'not_attempted') NOT IN
     ('captured', 'permission_denied', 'unavailable', 'timeout', 'unsupported', 'not_attempted') THEN
    RAISE EXCEPTION 'Invalid location status';
  END IF;

  -- A session from an earlier sign-in that was never explicitly closed
  -- (browser closed, connection lost) is now reviewable, not silently
  -- dropped or assumed complete. Its original timestamps are untouched.
  UPDATE public.employee_attendance_sessions
     SET session_status = 'incomplete', updated_at = now()
   WHERE user_id = v_uid AND session_status = 'active' AND session_id <> p_session_id;

  INSERT INTO public.employee_attendance_sessions (
    id, user_id, session_id, login_at, session_status,
    login_lat, login_lng, login_accuracy_m, login_location_status
  ) VALUES (
    gen_random_uuid(), v_uid, p_session_id, now(), 'active',
    p_lat, p_lng, p_accuracy_m, coalesce(p_location_status, 'not_attempted')
  )
  ON CONFLICT (session_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- Idempotent: a token refresh or a retried call for the same Supabase
    -- auth session must never create, or appear to create, a second row.
    SELECT * INTO v_row FROM public.employee_attendance_sessions WHERE session_id = p_session_id;
    RETURN jsonb_build_object('result', 'already_recorded', 'session', to_jsonb(v_row));
  END IF;
  RETURN jsonb_build_object('result', 'recorded', 'session', to_jsonb(v_row));
END $$;

-- ---------------------------------------------------------------------
-- 5. record_attendance_logout
--    Called by the explicit "Sign out" action, before supabase.auth.
--    signOut() invalidates the session - never from a SIGNED_OUT auth
--    event (which also fires for reasons that are not an explicit logout).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_attendance_logout(
  p_session_id text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_location_status text DEFAULT 'not_attempted'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.employee_attendance_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('result', 'not_signed_in'); END IF;
  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RAISE EXCEPTION 'A session identifier is required';
  END IF;
  IF coalesce(p_location_status, 'not_attempted') NOT IN
     ('captured', 'permission_denied', 'unavailable', 'timeout', 'unsupported', 'not_attempted') THEN
    RAISE EXCEPTION 'Invalid location status';
  END IF;

  SELECT * INTO v_row FROM public.employee_attendance_sessions
   WHERE session_id = p_session_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    -- Not an error: e.g. a non-"sales" account (which never got a login row), or a
    -- session that was never recorded for some other benign reason. Logout must
    -- always still succeed from the caller's point of view.
    RETURN jsonb_build_object('result', 'no_matching_session');
  END IF;
  IF v_row.session_status <> 'active' THEN
    -- Idempotent: a duplicate/retried logout call changes nothing and reports what's there.
    RETURN jsonb_build_object('result', 'already_recorded', 'session', to_jsonb(v_row));
  END IF;

  UPDATE public.employee_attendance_sessions SET
    logout_at = now(),
    session_status = 'completed',
    duration_seconds = extract(epoch FROM (now() - v_row.login_at))::integer,
    logout_lat = p_lat, logout_lng = p_lng, logout_accuracy_m = p_accuracy_m,
    logout_location_status = coalesce(p_location_status, 'not_attempted'),
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('result', 'recorded', 'session', to_jsonb(v_row));
END $$;

-- ---------------------------------------------------------------------
-- 6. list_attendance_sessions - Owner / IT Admin only.
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
  IF public.current_app_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Attendance access denied' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Invalid date range'; END IF;

  RETURN QUERY
  SELECT s.id, s.user_id, u.email, s.session_id, s.login_at, s.logout_at, s.duration_seconds, s.session_status,
    s.login_lat, s.login_lng, s.login_accuracy_m, s.login_location_status,
    s.logout_lat, s.logout_lng, s.logout_accuracy_m, s.logout_location_status,
    s.correction_reason, cu.email, s.corrected_at, s.created_at
  FROM public.employee_attendance_sessions s
  JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN auth.users cu ON cu.id = s.corrected_by
  WHERE (s.login_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
  ORDER BY s.login_at DESC;
END $$;

-- ---------------------------------------------------------------------
-- 7. attendance_summary - Owner / IT Admin only. Dashboard headline counts.
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
  IF public.current_app_role() NOT IN ('owner', 'admin') THEN
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
-- 8. correct_attendance_session - Owner / IT Admin only. Mandatory
--    reason, writes an immutable audit row before updating the session.
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
  IF public.current_app_role() NOT IN ('owner', 'admin') THEN
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
-- 9. Office hours configuration - Owner / IT Admin only, optional.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.attendance_settings%ROWTYPE;
BEGIN
  IF public.current_app_role() NOT IN ('owner', 'admin') THEN
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
  IF public.current_app_role() NOT IN ('owner', 'admin') THEN
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
-- 10. Grants. No table here is ever granted to anon or authenticated -
--     the functions above are the only way in, and each checks the
--     caller's role itself.
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
