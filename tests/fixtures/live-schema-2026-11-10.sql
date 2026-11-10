-- Live-shaped schema fixture for project rqovkmjsdwzggebvwvdk, captured read-only on 2026-11-10.
-- Synthetic data only. Used by tests/field-sales-db.test.mjs.
--
-- Why a second fixture: tests/fixtures/production-document-schema.sql is an older
-- snapshot that other suites build on by replaying repository migrations. The
-- repository migrations no longer reproduce production (see
-- database/FIELD_SALES_DEPLOYMENT.md, "Schema drift"), so this file reproduces the
-- live objects the field-sales migration depends on directly from the live catalog.
--
-- FULL COLUMNS (verbatim from the live catalog): profiles, customers, services,
--   leads, lead_activities, follow_ups, app_members, app_company_members,
--   lead_number_counters, followup_review_state, followup_review_events,
--   telecalling_entries, lead_activity.
-- REDUCED COLUMNS (id, company_id only; policies and grants verbatim): documents,
--   crm_quotations, comparison_templates, telecalling_google_sync_queue,
--   whatsapp_conversations and the 18 remaining "open" tables. These exist only to
--   prove who can and cannot reach them, which depends on policies and grants, not
--   on their business columns.
-- Functions, triggers, constraints and policies below are verbatim from live.

CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase default privileges: every new table, sequence and function in public is
-- granted to anon and authenticated unless a migration revokes it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth stand-ins (test.uid / test.role are set by the test helper)
-- ---------------------------------------------------------------------------
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object('role', auth.role(), 'email', (SELECT email FROM auth.users WHERE id = auth.uid())) $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables with full live columns
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles(id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, name text NOT NULL, logo_url text, seal_url text, gstin text, pan text, email text, phone text, address text, website text, currency text DEFAULT 'INR'::text, bank_name text, bank_account_no text, bank_ifsc text, bank_holder text, bank_branch text, default_terms text, col_name_description text DEFAULT 'Description'::text, col_name_quantity text DEFAULT 'Quantity'::text, col_name_unit text DEFAULT 'Unit'::text, col_name_rate text DEFAULT 'Rate'::text, col_name_amount text DEFAULT 'Amount'::text, invoice_prefix text DEFAULT 'INV/'::text, invoice_start_number integer DEFAULT 1001, proforma_prefix text DEFAULT 'PI/'::text, proforma_start_number integer DEFAULT 1001, quotation_prefix text DEFAULT 'QTN/'::text, quotation_start_number integer DEFAULT 1001, work_order_prefix text DEFAULT 'WO/'::text, work_order_start_number integer DEFAULT 1001, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), google_sheets_url text, show_bank_details boolean DEFAULT true, approver_email text, non_tax_prefix text DEFAULT 'NT/'::text, non_tax_start_number integer DEFAULT 1001);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE public.customers(id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, company_id uuid, name text NOT NULL, gstin text, email text, phone text, address text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), location text, lead_status text NOT NULL DEFAULT 'warm'::text, tags text[] NOT NULL DEFAULT '{}'::text[], notes text, assigned_staff_email text, last_contacted_at timestamp with time zone, archived boolean NOT NULL DEFAULT false, whatsapp_number text, last_whatsapp_message text, last_whatsapp_message_at timestamp with time zone, unread_whatsapp_count integer NOT NULL DEFAULT 0);
ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE public.customers ADD CONSTRAINT customers_lead_status_check CHECK ((lead_status = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text, 'old'::text])));
ALTER TABLE public.customers ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.customers ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE public.services(id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, company_id uuid, name text NOT NULL, description text, default_rate numeric DEFAULT 0, unit text DEFAULT 'nos'::text, hsn_sac text, gst_percentage numeric DEFAULT 18, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
ALTER TABLE public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
ALTER TABLE public.services ADD CONSTRAINT services_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT services_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE public.leads(id uuid NOT NULL DEFAULT gen_random_uuid(), company_id uuid NOT NULL, customer_id uuid, customer_name text NOT NULL, company_name text, phone text, whatsapp_number text, address text, location text, business_type text, lead_source text NOT NULL DEFAULT 'other'::text, source_details text, service_required text, vehicle_service_type text, required_date date, campaign_location text, number_of_days integer, priority text NOT NULL DEFAULT 'warm'::text, assigned_telecaller_email text, status text NOT NULL DEFAULT 'new'::text, next_follow_up_at timestamp with time zone, notes text, remarks text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), sub_district text, lead_number text);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK ((lead_source = ANY (ARRAY['facebook'::text, 'instagram'::text, 'whatsapp_bulk'::text, 'website'::text, 'bulk_email'::text, 'existing_customer'::text, 'phone'::text, 'referral'::text, 'other'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_priority_check CHECK ((priority = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'telecaller_working'::text, 'requirement_collected'::text, 'sent_to_admin'::text, 'quotation_preparing'::text, 'waiting_owner_approval'::text, 'quotation_sent'::text, 'follow_up'::text, 'confirmed'::text, 'lost'::text, 'future'::text, 'owner_handover'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX unique_lead_number_per_company ON public.leads USING btree (company_id, lead_number);

CREATE TABLE public.lead_activities(id uuid NOT NULL DEFAULT gen_random_uuid(), company_id uuid, lead_id uuid, type text NOT NULL, notes text NOT NULL, performed_by text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

CREATE TABLE public.follow_ups(id uuid NOT NULL DEFAULT gen_random_uuid(), company_id uuid NOT NULL, customer_id uuid, follow_up_date date NOT NULL, follow_up_time time without time zone, notes text, assigned_staff_email text, status text NOT NULL DEFAULT 'pending'::text, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now(), lead_id uuid, lead_number text, customer_name text, company_name text, phone text, reason text, created_by_email text, completed_at timestamp with time zone, completion_note text, reschedule_reason text, follow_up_outcome text, follow_up_action_id uuid);
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_pkey PRIMARY KEY (id);
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text, 'snoozed'::text, 'overdue'::text])));
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE TABLE public.app_members(user_id uuid NOT NULL, role text NOT NULL, active boolean NOT NULL DEFAULT true);
ALTER TABLE public.app_members ADD CONSTRAINT app_members_pkey PRIMARY KEY (user_id);
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])));
ALTER TABLE public.app_members ADD CONSTRAINT app_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE TABLE public.app_company_members(user_id uuid NOT NULL, company_id uuid NOT NULL);
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_pkey PRIMARY KEY (user_id, company_id);
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_members(user_id) ON DELETE CASCADE;
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE TABLE public.lead_number_counters(company_id uuid NOT NULL, last_number bigint NOT NULL);
ALTER TABLE public.lead_number_counters ADD CONSTRAINT lead_number_counters_pkey PRIMARY KEY (company_id);
ALTER TABLE public.lead_number_counters ADD CONSTRAINT lead_number_counters_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id);

CREATE TABLE public.followup_review_state(follow_up_id uuid NOT NULL, company_id uuid NOT NULL, customer_name text, assigned_staff_email text, original_due timestamp without time zone NOT NULL, original_due_verified boolean NOT NULL, current_due timestamp without time zone NOT NULL, current_status text NOT NULL, postponement_count integer NOT NULL DEFAULT 0, consecutive_without_contact integer NOT NULL DEFAULT 0, last_reason text, last_outcome text, deleted boolean NOT NULL DEFAULT false);
ALTER TABLE public.followup_review_state ADD CONSTRAINT followup_review_state_pkey PRIMARY KEY (follow_up_id);
CREATE TABLE public.followup_review_events(id bigint GENERATED ALWAYS AS IDENTITY, follow_up_id uuid NOT NULL, company_id uuid NOT NULL, actor_email text NOT NULL, action_id uuid, event_type text NOT NULL, previous_due timestamp without time zone, new_due timestamp without time zone, reason text, outcome text, created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.followup_review_events ADD CONSTRAINT followup_review_events_pkey PRIMARY KEY (id);
ALTER TABLE public.followup_review_events ADD CONSTRAINT followup_review_events_follow_up_id_action_id_key UNIQUE (follow_up_id, action_id);

CREATE TABLE public.telecalling_entries(id uuid NOT NULL DEFAULT gen_random_uuid(), company_id uuid NOT NULL, entry_date date NOT NULL DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'::text))::date, company_name text NOT NULL, contact_person text, phone text NOT NULL, other_phone text, location text, email text, call_status text NOT NULL, feedback text, created_by uuid, created_by_email text, created_by_name text, created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()));
ALTER TABLE public.telecalling_entries ADD CONSTRAINT telecalling_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.telecalling_entries ADD CONSTRAINT telecalling_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Legacy singular table: present in live with 0 rows, absent from the repository.
CREATE TABLE public.lead_activity(id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid NOT NULL, lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE, user_email text NOT NULL, action text NOT NULL, previous_status text, new_status text, note text, created_at timestamp with time zone NOT NULL DEFAULT now());

-- ---------------------------------------------------------------------------
-- Tables with reduced columns
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'documents','crm_quotations','comparison_templates','telecalling_google_sync_queue','whatsapp_conversations',
    'account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts','expenses',
    'financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources','google_sync_log','google_sync_queue','google_sync_settings'
  ] LOOP
    EXECUTE format('CREATE TABLE public.%I(id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Functions (verbatim from live)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
 SELECT m.role FROM public.app_members m JOIN auth.users u ON u.id=m.user_id
 WHERE m.user_id=auth.uid() AND m.active AND u.deleted_at IS NULL
 AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
$function$;

CREATE OR REPLACE FUNCTION public.can_access_company(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
 SELECT public.current_app_role() IS NOT NULL AND
 (public.current_app_role() IN ('owner','admin') OR EXISTS(
 SELECT 1 FROM public.app_company_members WHERE user_id=auth.uid() AND company_id=p_company_id))
$function$;
REVOKE ALL ON FUNCTION public.current_app_role(), public.can_access_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_role(), public.can_access_company(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_lead_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE existing public.leads%ROWTYPE; seq bigint;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'A lead cannot be moved between companies'; END IF;
  NEW.lead_number:=OLD.lead_number;
  RETURN NEW;
 END IF;
 -- Upsert of an existing lead keeps its ID, even if another browser supplied an obsolete number.
 SELECT * INTO existing FROM public.leads WHERE id=NEW.id;
 IF FOUND THEN
  IF NEW.company_id IS DISTINCT FROM existing.company_id THEN RAISE EXCEPTION 'A lead cannot be moved between companies'; END IF;
  NEW.lead_number:=existing.lead_number; RETURN NEW;
 END IF;
 INSERT INTO public.lead_number_counters(company_id,last_number) VALUES(NEW.company_id,1001)
 ON CONFLICT(company_id) DO UPDATE SET last_number=lead_number_counters.last_number+1 RETURNING last_number INTO seq;
 NEW.lead_number:='B2P-LD-'||seq;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.assign_lead_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER assign_lead_number BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.assign_lead_number();

CREATE OR REPLACE FUNCTION public.log_followup_timeline_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
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
$function$;
CREATE TRIGGER followup_timeline_activity AFTER INSERT OR UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION public.log_followup_timeline_activity();

CREATE OR REPLACE FUNCTION public.guard_followup_completion_activity() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF lower(coalesce(to_jsonb(NEW)->>'type', to_jsonb(NEW)->>'action', '')) = 'follow-up completed'
    AND pg_trigger_depth() = 1 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER guard_followup_completion_activity BEFORE INSERT ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.guard_followup_completion_activity();

CREATE OR REPLACE FUNCTION public.preserve_followup_completion_time() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  IF lower(OLD.status) = 'completed' AND lower(NEW.status) = 'completed' THEN
    NEW.completed_at := OLD.completed_at;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER preserve_followup_completion_time BEFORE UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION public.preserve_followup_completion_time();

CREATE SCHEMA followup_audit_internal;
CREATE OR REPLACE FUNCTION followup_audit_internal.record_followup_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
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
END $function$;
CREATE TRIGGER record_followup_review AFTER INSERT OR DELETE OR UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION followup_audit_internal.record_followup_review();

-- ---------------------------------------------------------------------------
-- Row-level security, policies and grants (verbatim from live)
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Company-scoped CRM tables: office_read + office_write, CRUD granted to anon and authenticated.
  FOREACH t IN ARRAY ARRAY['customers','services','leads','lead_activities','follow_ups','crm_quotations','comparison_templates'] LOOP
    EXECUTE format('CREATE POLICY office_read ON public.%I FOR SELECT TO authenticated USING (public.can_access_company(company_id))', t);
    EXECUTE format('CREATE POLICY office_write ON public.%I FOR ALL TO authenticated USING (public.can_access_company(company_id)) WITH CHECK (public.can_access_company(company_id))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  END LOOP;

  -- Finance, bookings and resources: open to every authenticated account.
  FOREACH t IN ARRAY ARRAY['account_groups','account_heads','bank_accounts','bank_reconciliation_statements','customer_receipts',
    'expenses','financial_audit_logs','financial_period_locks','financial_year_closures','journal_entries','purchase_bills',
    'supplier_payments','suppliers','bookings','resources'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_authenticated_all', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
  END LOOP;

  -- Sync tables and the legacy activity table: open to every authenticated account.
  FOREACH t IN ARRAY ARRAY['google_sync_log','google_sync_queue','google_sync_settings','lead_activity'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO public USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', t || '_auth_all', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

CREATE POLICY office_read ON public.profiles FOR SELECT TO authenticated USING (public.can_access_company(id));
CREATE POLICY office_write ON public.profiles FOR ALL TO authenticated
  USING (public.current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (public.current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text]));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon, authenticated;

CREATE POLICY office_read ON public.documents FOR SELECT TO authenticated USING (public.can_access_company(company_id));
GRANT SELECT ON public.documents TO authenticated;

CREATE POLICY telecalling_read ON public.telecalling_entries FOR SELECT TO authenticated USING (public.can_access_company(company_id));
CREATE POLICY telecalling_write ON public.telecalling_entries FOR ALL TO authenticated USING (public.can_access_company(company_id)) WITH CHECK (public.can_access_company(company_id));
GRANT ALL ON public.telecalling_entries TO anon, authenticated;
CREATE POLICY telecalling_sync_read ON public.telecalling_google_sync_queue FOR SELECT TO authenticated USING (public.can_access_company(company_id));
CREATE POLICY telecalling_sync_write ON public.telecalling_google_sync_queue FOR ALL TO authenticated USING (public.can_access_company(company_id)) WITH CHECK (public.can_access_company(company_id));
GRANT ALL ON public.telecalling_google_sync_queue TO anon, authenticated;

CREATE POLICY whatsapp_conversations_auth_all ON public.whatsapp_conversations FOR ALL TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY whatsapp_rls_conversations_company ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((company_id IS NOT NULL) AND public.can_access_company(company_id))
  WITH CHECK ((company_id IS NOT NULL) AND public.can_access_company(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations TO authenticated;

-- app_members, app_company_members, lead_number_counters, followup_review_state and
-- followup_review_events have RLS enabled, no policies and no grants in live.
