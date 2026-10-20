-- Review and apply before deploying the client.
-- Requires deployed follow_ups.follow_up_date / follow_up_time and timeline version 1.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA IF NOT EXISTS followup_audit_internal;
REVOKE ALL ON SCHEMA followup_audit_internal FROM PUBLIC, anon, authenticated, service_role;
LOCK TABLE public.follow_ups IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF public.followup_timeline_version() <> 1 THEN RAISE EXCEPTION 'Timeline setup version 1 required'; END IF;
  IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='follow_up_date')
    OR NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='follow_up_time') THEN
    RAISE EXCEPTION 'Expected deployed follow_up_date / follow_up_time columns; do not rename automatically';
  END IF;
END $$;
ALTER TABLE public.follow_ups ADD COLUMN IF NOT EXISTS reschedule_reason text,
  ADD COLUMN IF NOT EXISTS follow_up_outcome text, ADD COLUMN IF NOT EXISTS follow_up_action_id uuid;
CREATE TABLE IF NOT EXISTS public.followup_review_state (
  follow_up_id uuid PRIMARY KEY, company_id uuid NOT NULL, customer_name text,
  assigned_staff_email text, original_due timestamp NOT NULL, original_due_verified boolean NOT NULL,
  current_due timestamp NOT NULL, current_status text NOT NULL,
  postponement_count integer NOT NULL DEFAULT 0, consecutive_without_contact integer NOT NULL DEFAULT 0,
  last_reason text, last_outcome text, deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.followup_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, follow_up_id uuid NOT NULL,
  company_id uuid NOT NULL, actor_email text NOT NULL, action_id uuid,
  event_type text NOT NULL, previous_due timestamp, new_due timestamp,
  reason text, outcome text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(follow_up_id, action_id)
);
CREATE INDEX IF NOT EXISTS followup_review_events_company_day ON public.followup_review_events(company_id,created_at,id);
CREATE INDEX IF NOT EXISTS followup_review_state_company ON public.followup_review_state(company_id,follow_up_id);
ALTER TABLE public.followup_review_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.followup_review_state, public.followup_review_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.followup_review_state, public.followup_review_events TO service_role;
-- Baseline only: no fabricated historical counts.
INSERT INTO public.followup_review_state(follow_up_id,company_id,customer_name,assigned_staff_email,
  original_due,original_due_verified,current_due,current_status)
SELECT id,company_id,customer_name,assigned_staff_email,
  follow_up_date::date + coalesce(nullif(follow_up_time::text,''),'11:00')::time,false,
  follow_up_date::date + coalesce(nullif(follow_up_time::text,''),'11:00')::time,status
FROM public.follow_ups ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION followup_audit_internal.record_followup_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  previous_due timestamp; next_due timestamp; changed boolean := false;
  completing boolean := false; later boolean := false; actor text; kind text;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'Authenticated follow-up action required';
  END IF;
  actor := coalesce(nullif(auth.jwt()->>'email',''),'System');
  IF TG_OP='DELETE' THEN
    UPDATE public.followup_review_state SET deleted=true WHERE follow_up_id=OLD.id;
    INSERT INTO public.followup_review_events(follow_up_id,company_id,actor_email,event_type)
    VALUES(OLD.id,OLD.company_id,actor,'deleted');
    RETURN OLD;
  END IF;
  next_due := NEW.follow_up_date::date + coalesce(nullif(NEW.follow_up_time::text,''),'11:00')::time;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Follow-up identity and company cannot change';
    END IF;
    previous_due := OLD.follow_up_date::date + coalesce(nullif(OLD.follow_up_time::text,''),'11:00')::time;
    changed := next_due IS DISTINCT FROM previous_due;
    later := next_due > previous_due;
    completing := lower(NEW.status)='completed' AND lower(OLD.status)<>'completed';
  ELSE
    completing := lower(NEW.status)='completed';
  END IF;
  IF changed OR completing THEN
    IF NEW.follow_up_action_id IS NULL OR (TG_OP='UPDATE' AND NEW.follow_up_action_id IS NOT DISTINCT FROM OLD.follow_up_action_id) THEN
      RAISE EXCEPTION 'A fresh follow-up action is required';
    END IF;
    IF changed AND (nullif(btrim(NEW.reschedule_reason),'') IS NULL OR coalesce(NEW.follow_up_outcome,'') NOT IN ('customer_callback','no_answer','not_contacted')) THEN
      RAISE EXCEPTION 'Contact outcome and reschedule reason required';
    END IF;
    IF completing AND nullif(btrim(NEW.completion_note),'') IS NULL THEN
      RAISE EXCEPTION 'Completion remarks required';
    END IF;
  END IF;
  INSERT INTO public.followup_review_state(follow_up_id,company_id,customer_name,assigned_staff_email,
    original_due,original_due_verified,current_due,current_status)
  VALUES(NEW.id,NEW.company_id,NEW.customer_name,NEW.assigned_staff_email,next_due,true,next_due,NEW.status)
  ON CONFLICT DO NOTHING;
  UPDATE public.followup_review_state SET customer_name=NEW.customer_name,
    assigned_staff_email=NEW.assigned_staff_email,current_due=next_due,current_status=NEW.status,
    postponement_count=postponement_count + CASE WHEN later THEN 1 ELSE 0 END,
    consecutive_without_contact=CASE WHEN completing OR (changed AND NEW.follow_up_outcome='customer_callback') THEN 0
      WHEN later THEN consecutive_without_contact+1 ELSE consecutive_without_contact END,
    last_reason=CASE WHEN changed THEN NEW.reschedule_reason WHEN completing THEN NEW.completion_note ELSE last_reason END,
    last_outcome=CASE WHEN completing THEN 'completed' WHEN changed THEN NEW.follow_up_outcome ELSE last_outcome END
  WHERE follow_up_id=NEW.id;
  -- A completion and reschedule in one write remain separate daily actions.
  IF changed THEN
    kind := CASE WHEN later THEN 'postponed' ELSE 'rescheduled' END;
    INSERT INTO public.followup_review_events(follow_up_id,company_id,actor_email,action_id,event_type,previous_due,new_due,reason,outcome)
    VALUES(NEW.id,NEW.company_id,actor,NEW.follow_up_action_id,kind,previous_due,next_due,NEW.reschedule_reason,NEW.follow_up_outcome);
  END IF;
  IF completing THEN
    INSERT INTO public.followup_review_events(follow_up_id,company_id,actor_email,action_id,event_type,new_due,reason,outcome)
    VALUES(NEW.id,NEW.company_id,actor,CASE WHEN changed THEN NULL ELSE NEW.follow_up_action_id END,'completed',next_due,NEW.completion_note,'completed');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION followup_audit_internal.record_followup_review() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS record_followup_review ON public.follow_ups;
CREATE TRIGGER record_followup_review AFTER INSERT OR UPDATE OR DELETE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION followup_audit_internal.record_followup_review();
CREATE OR REPLACE FUNCTION public.followup_accountability_version()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.followup_accountability_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.followup_accountability_version() TO authenticated, service_role;
COMMIT;
