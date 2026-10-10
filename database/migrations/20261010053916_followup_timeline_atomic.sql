-- Follow-up remarks and completion activities share the task transaction.
-- Invoker privileges retain the existing company RLS on both tables.
CREATE OR REPLACE FUNCTION public.log_followup_timeline_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  activity_type text;
  activity_note text;
  actor text;
  previous_row jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN previous_row := to_jsonb(OLD); END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Follow-up lead is unavailable or belongs to another company';
  END IF;
  actor := coalesce(nullif(auth.jwt()->>'email', ''), 'Staff');
  IF lower(NEW.status) = 'completed' AND lower(coalesce(previous_row->>'status', '')) <> 'completed' THEN
    activity_type := 'Follow-up Completed';
    activity_note := 'Completed follow-up: "' || coalesce(NEW.reason, '') || '". Note: '
      || coalesce(nullif(btrim(NEW.completion_note), ''), nullif(btrim(NEW.notes), ''), 'No completion remarks.');
  ELSIF TG_OP = 'UPDATE' AND nullif(btrim(NEW.notes), '') IS NOT NULL
    AND NEW.notes IS DISTINCT FROM previous_row->>'notes' THEN
    activity_type := 'Follow-up Call Remarks';
    activity_note := btrim(NEW.notes);
  ELSE
    RETURN NEW;
  END IF;
  -- The deployed schema uses type/notes/performed_by; older installations use
  -- action/note/user_email. populate_record ignores keys absent from the row type.
  INSERT INTO public.lead_activities
  SELECT (jsonb_populate_record(NULL::public.lead_activities, jsonb_build_object(
    'id', gen_random_uuid(), 'company_id', NEW.company_id, 'lead_id', NEW.lead_id,
    'type', activity_type, 'action', activity_type,
    'notes', activity_note, 'note', activity_note,
    'performed_by', actor, 'user_email', actor, 'created_at', now()
  ))).*;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_followup_timeline_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_followup_timeline_activity() TO authenticated, service_role;
DROP TRIGGER IF EXISTS followup_timeline_activity ON public.follow_ups;
CREATE TRIGGER followup_timeline_activity AFTER INSERT OR UPDATE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION public.log_followup_timeline_activity();

-- Old clients generate a second completion activity after saving the task.
-- Reserve this activity type for the atomic task trigger. Its nested insert
-- reaches this guard at depth 2; an API upsert reaches it at depth 1. Returning
-- NULL skips that obsolete insert (including ON CONFLICT) without an error in
-- the old client's best-effort upsert. No text/time heuristic or row deletion.
CREATE OR REPLACE FUNCTION public.guard_followup_completion_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF lower(coalesce(to_jsonb(NEW)->>'type', to_jsonb(NEW)->>'action', '')) = 'follow-up completed'
    AND pg_trigger_depth() = 1 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_followup_completion_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_followup_completion_activity() TO authenticated, service_role;
DROP TRIGGER IF EXISTS guard_followup_completion_activity ON public.lead_activities;
CREATE TRIGGER guard_followup_completion_activity BEFORE INSERT ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.guard_followup_completion_activity();

CREATE OR REPLACE FUNCTION public.preserve_followup_completion_time()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF lower(OLD.status) = 'completed' AND lower(NEW.status) = 'completed' THEN
    NEW.completed_at := OLD.completed_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_followup_completion_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preserve_followup_completion_time() TO authenticated, service_role;
DROP TRIGGER IF EXISTS preserve_followup_completion_time ON public.follow_ups;
CREATE TRIGGER preserve_followup_completion_time BEFORE UPDATE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION public.preserve_followup_completion_time();

-- The client checks this before writing, so a missing migration cannot silently
-- accept a task without its timeline activity.
CREATE OR REPLACE FUNCTION public.followup_timeline_version()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.followup_timeline_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.followup_timeline_version() TO authenticated, service_role;
