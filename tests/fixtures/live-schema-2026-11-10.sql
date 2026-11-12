-- Live schema fixture for Supabase project rqovkmjsdwzggebvwvdk.
-- Captured read-only from pg_catalog on 2026-11-10 with the query in
-- database/verification/field_sales_schema_capture.sql. Schema only: no rows.
-- Used by tests/field-sales-db.test.mjs and tests/field-sales-concurrency.test.mjs.
-- Do not edit the LIVE sections by hand; re-capture instead.
--
-- This file has two clearly separated kinds of content:
--
--   TEST STUB  Things Supabase provides outside the public schema, written by
--              hand so the fixture can run on a plain Postgres:
--                * roles anon, authenticated, service_role
--                * schema auth with a minimal auth.users table
--                * auth.uid(), auth.role(): bodies verbatim from production
--                * auth.jwt(): standard Supabase body (not captured)
--                * Supabase's default privileges for new objects in public
--              Every stub is marked "TEST STUB" below.
--
--   LIVE       Everything in schema public and followup_audit_internal,
--              generated from the production catalog without modification:
--              all 44 tables with every column, default and NOT NULL; all
--              primary-key, unique, check and foreign-key constraints; indexes;
--              all 20 functions with their privileges; all 8 triggers;
--              row-level security flags; all 55 policies; table privileges.
--
-- Not captured (see database/FIELD_SALES_DEPLOYMENT.md, "Limits"): table and
-- function ownership (everything here is owned by the role that loads the
-- file; in production it is "postgres", which is not a superuser but has
-- BYPASSRLS), column-level privileges, PostgREST's exposed-schema setting,
-- Realtime publications, and the real auth schema.

-- ===========================================================================
-- TEST STUB: roles
-- ===========================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ===========================================================================
-- TEST STUB: auth schema. Identity comes from the request.jwt.claims setting,
-- exactly as PostgREST supplies it in production.
-- ===========================================================================
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
-- Body verbatim from production.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
-- Body verbatim from production.
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
-- Standard Supabase body; the production definition was not captured.
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$function$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- Functions below reference each other and tables in any order.
SET check_function_bodies = off;
CREATE SCHEMA followup_audit_internal;

-- ===========================================================================
-- LIVE: generated from the production catalog. Do not edit by hand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- LIVE: sequences
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- LIVE: tables (every column, type, default and NOT NULL as in production)
-- ---------------------------------------------------------------------------
CREATE TABLE public.account_groups (id text DEFAULT (gen_random_uuid())::text NOT NULL, company_id uuid, name text NOT NULL, type text NOT NULL, code text NOT NULL, parent_group_id text, description text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.account_heads (id text DEFAULT (gen_random_uuid())::text NOT NULL, company_id uuid, code text NOT NULL, name text NOT NULL, group_id text, group_name text NOT NULL, type text NOT NULL, nature text DEFAULT 'debit'::text NOT NULL, opening_balance numeric DEFAULT 0 NOT NULL, opening_balance_date date DEFAULT CURRENT_DATE, current_balance numeric DEFAULT 0 NOT NULL, is_system boolean DEFAULT false NOT NULL, is_active boolean DEFAULT true NOT NULL, gst_applicable boolean DEFAULT false, description text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.app_company_members (user_id uuid NOT NULL, company_id uuid NOT NULL);
CREATE TABLE public.app_members (user_id uuid NOT NULL, role text NOT NULL, active boolean DEFAULT true NOT NULL);
CREATE TABLE public.approver_devices (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, token text NOT NULL, device_name text, last_active timestamp with time zone DEFAULT timezone('utc'::text, now()), created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.bank_accounts (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, account_name text NOT NULL, account_number text NOT NULL, bank_name text NOT NULL, ifsc_code text NOT NULL, branch_name text, account_type text NOT NULL, linked_account_head_id text, opening_balance numeric DEFAULT 0 NOT NULL, current_balance numeric DEFAULT 0 NOT NULL, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.bank_reconciliation_statements (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, bank_account_id uuid, period_start date NOT NULL, period_end date NOT NULL, statement_closing_balance numeric NOT NULL, book_closing_balance numeric NOT NULL, reconciled_balance numeric NOT NULL, difference numeric DEFAULT 0 NOT NULL, status text DEFAULT 'draft'::text NOT NULL, reconciled_by text, reconciled_at timestamp with time zone DEFAULT timezone('utc'::text, now()), created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.bookings (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, resource_id uuid, resource_name text, lead_id uuid, lead_title text, customer_name text, start_date date NOT NULL, end_date date NOT NULL, status text DEFAULT 'CONFIRMED'::text NOT NULL, notes text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.comparison_document_data (id uuid DEFAULT gen_random_uuid() NOT NULL, document_id uuid, options_data jsonb NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.comparison_templates (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, company_id uuid, name text NOT NULL, template_config jsonb NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.crm_quotations (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, lead_id uuid, quotation_number text NOT NULL, date date NOT NULL, valid_until date, customer_name text NOT NULL, company_name text, phone text NOT NULL, whatsapp_number text, location text, service_summary text NOT NULL, items jsonb DEFAULT '[]'::jsonb NOT NULL, subtotal numeric DEFAULT 0 NOT NULL, cgst numeric DEFAULT 0 NOT NULL, sgst numeric DEFAULT 0 NOT NULL, igst numeric DEFAULT 0 NOT NULL, total numeric DEFAULT 0 NOT NULL, status text DEFAULT 'DRAFT'::text NOT NULL, approval_status text DEFAULT 'DRAFT'::text NOT NULL, approval_token text, approver_name text, approver_notes text, approved_at timestamp with time zone, rejected_at timestamp with time zone, rejection_reason text, sent_to_customer_at timestamp with time zone, created_by text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()), lead_number text, customer_address text, service_required text, vehicle_service_type text, campaign_location text, required_date date, number_of_days integer, tax_total numeric DEFAULT 0 NOT NULL, discount_total numeric DEFAULT 0 NOT NULL, notes text, terms text, sent_by_email text);
CREATE TABLE public.customer_receipts (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, receipt_number text NOT NULL, customer_id uuid, customer_name text NOT NULL, date date NOT NULL, amount_received numeric NOT NULL, payment_mode text NOT NULL, deposit_account_head_id text, reference_number text, notes text, invoice_allocations jsonb DEFAULT '[]'::jsonb NOT NULL, journal_entry_id uuid, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.customers (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, company_id uuid, name text NOT NULL, gstin text, email text, phone text, address text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), location text, lead_status text DEFAULT 'warm'::text NOT NULL, tags text[] DEFAULT '{}'::text[] NOT NULL, notes text, assigned_staff_email text, last_contacted_at timestamp with time zone, archived boolean DEFAULT false NOT NULL, whatsapp_number text, last_whatsapp_message text, last_whatsapp_message_at timestamp with time zone, unread_whatsapp_count integer DEFAULT 0 NOT NULL);
CREATE TABLE public.document_items (id uuid DEFAULT gen_random_uuid() NOT NULL, document_id uuid, service_id uuid, description text NOT NULL, quantity numeric DEFAULT 1 NOT NULL, days numeric DEFAULT 1 NOT NULL, rate numeric DEFAULT 0 NOT NULL, unit text DEFAULT 'nos'::text, hsn_sac text, amount numeric DEFAULT 0 NOT NULL, sort_order integer DEFAULT 0 NOT NULL, gst_percentage numeric DEFAULT 0 NOT NULL);
CREATE TABLE public.documents (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, company_id uuid, document_type text NOT NULL, document_number text NOT NULL, sequence_number integer NOT NULL, customer_id uuid, customer_name text NOT NULL, customer_email text, customer_phone text, customer_address text, customer_gstin text, date date DEFAULT CURRENT_DATE NOT NULL, col_name_description text DEFAULT 'Description'::text NOT NULL, col_name_quantity text DEFAULT 'Quantity'::text NOT NULL, col_name_unit text DEFAULT 'Unit'::text NOT NULL, col_name_rate text DEFAULT 'Rate'::text NOT NULL, col_name_amount text DEFAULT 'Amount'::text NOT NULL, subtotal numeric DEFAULT 0 NOT NULL, tax_total numeric DEFAULT 0 NOT NULL, discount_total numeric DEFAULT 0 NOT NULL, total numeric DEFAULT 0 NOT NULL, notes text, terms text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), created_by_email text, whatsapp_sent_by_email text, whatsapp_sent_at timestamp with time zone, status text DEFAULT 'pending_approval'::text, approved_by_email text, approved_at timestamp with time zone, advance numeric DEFAULT 0 NOT NULL);
CREATE TABLE public.expenses (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, expense_number text NOT NULL, date date NOT NULL, expense_account_head_id text, payment_account_head_id text, amount numeric NOT NULL, gst_applicable boolean DEFAULT false, gst_rate numeric DEFAULT 0, gst_amount numeric DEFAULT 0, vendor_name text, vendor_gstin text, invoice_ref text, notes text, journal_entry_id uuid, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.financial_audit_logs (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, entity_type text NOT NULL, entity_id text NOT NULL, action text NOT NULL, performed_by text NOT NULL, details jsonb, "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.financial_period_locks (id text DEFAULT (gen_random_uuid())::text NOT NULL, company_id uuid, period_name text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, is_locked boolean DEFAULT true NOT NULL, locked_by text NOT NULL, locked_at timestamp with time zone DEFAULT timezone('utc'::text, now()), unlock_reason text);
CREATE TABLE public.financial_year_closures (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, financial_year text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, net_profit_or_loss numeric NOT NULL, retained_earnings_transferred numeric NOT NULL, closing_journal_entry_id uuid, closed_by text NOT NULL, closed_at timestamp with time zone DEFAULT timezone('utc'::text, now()), notes text);
CREATE TABLE public.follow_ups (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, customer_id uuid, follow_up_date date NOT NULL, follow_up_time time without time zone, notes text, assigned_staff_email text, status text DEFAULT 'pending'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, lead_id uuid, lead_number text, customer_name text, company_name text, phone text, reason text, created_by_email text, completed_at timestamp with time zone, completion_note text, reschedule_reason text, follow_up_outcome text, follow_up_action_id uuid);
CREATE TABLE public.followup_review_events (id bigint GENERATED ALWAYS AS IDENTITY NOT NULL, follow_up_id uuid NOT NULL, company_id uuid NOT NULL, actor_email text NOT NULL, action_id uuid, event_type text NOT NULL, previous_due timestamp without time zone, new_due timestamp without time zone, reason text, outcome text, created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.followup_review_state (follow_up_id uuid NOT NULL, company_id uuid NOT NULL, customer_name text, assigned_staff_email text, original_due timestamp without time zone NOT NULL, original_due_verified boolean NOT NULL, current_due timestamp without time zone NOT NULL, current_status text NOT NULL, postponement_count integer DEFAULT 0 NOT NULL, consecutive_without_contact integer DEFAULT 0 NOT NULL, last_reason text, last_outcome text, deleted boolean DEFAULT false NOT NULL);
CREATE TABLE public.google_sync_log (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, document_id uuid, document_number text, action text NOT NULL, payload_version integer DEFAULT 1 NOT NULL, status text NOT NULL, attempt_number integer NOT NULL, error_message text, started_at timestamp with time zone, completed_at timestamp with time zone, duration_ms integer, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.google_sync_queue (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, document_id uuid, action text NOT NULL, payload jsonb NOT NULL, payload_version integer DEFAULT 1 NOT NULL, status text DEFAULT 'pending'::text NOT NULL, attempts integer DEFAULT 0 NOT NULL, max_attempts integer DEFAULT 8 NOT NULL, failed_permanently boolean DEFAULT false NOT NULL, next_attempt_at timestamp with time zone DEFAULT now() NOT NULL, last_error text, locked_at timestamp with time zone, locked_by text, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.google_sync_settings (company_id uuid NOT NULL, webhook_url text, enabled boolean DEFAULT true NOT NULL, last_full_resync_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.journal_entries (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, entry_number text NOT NULL, date date NOT NULL, reference_type text NOT NULL, reference_id text, reference_number text, narration text NOT NULL, total_debit numeric NOT NULL, total_credit numeric NOT NULL, is_posted boolean DEFAULT true NOT NULL, is_system boolean DEFAULT false NOT NULL, items jsonb DEFAULT '[]'::jsonb NOT NULL, created_by text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.lead_activities (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, lead_id uuid, type text NOT NULL, notes text NOT NULL, performed_by text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.lead_activity (id uuid DEFAULT gen_random_uuid() NOT NULL, lead_id uuid NOT NULL, company_id uuid NOT NULL, user_email text NOT NULL, action text NOT NULL, previous_status text, new_status text, note text, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.lead_number_counters (company_id uuid NOT NULL, last_number bigint NOT NULL);
CREATE TABLE public.lead_number_repairs (lead_id uuid NOT NULL, old_number text, new_number text NOT NULL, repaired_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.leads (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, customer_id uuid, customer_name text NOT NULL, company_name text, phone text, whatsapp_number text, address text, location text, business_type text, lead_source text DEFAULT 'other'::text NOT NULL, source_details text, service_required text, vehicle_service_type text, required_date date, campaign_location text, number_of_days integer, priority text DEFAULT 'warm'::text NOT NULL, assigned_telecaller_email text, status text DEFAULT 'new'::text NOT NULL, next_follow_up_at timestamp with time zone, notes text, remarks text, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, sub_district text, lead_number text);
CREATE TABLE public.owner_report_dispatches (id text NOT NULL, report_type text DEFAULT 'detailed_staff_report'::text NOT NULL, staff_email text NOT NULL, report_date date NOT NULL, recipient text NOT NULL, status text DEFAULT 'in_progress'::text NOT NULL, sent_at timestamp with time zone, sent_count integer DEFAULT 0, message_ids jsonb DEFAULT '[]'::jsonb, message_results jsonb DEFAULT '[]'::jsonb, summary jsonb DEFAULT '{}'::jsonb, owner_attention jsonb DEFAULT '[]'::jsonb, error text, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, name text NOT NULL, logo_url text, seal_url text, gstin text, pan text, email text, phone text, address text, website text, currency text DEFAULT 'INR'::text, bank_name text, bank_account_no text, bank_ifsc text, bank_holder text, bank_branch text, default_terms text, col_name_description text DEFAULT 'Description'::text, col_name_quantity text DEFAULT 'Quantity'::text, col_name_unit text DEFAULT 'Unit'::text, col_name_rate text DEFAULT 'Rate'::text, col_name_amount text DEFAULT 'Amount'::text, invoice_prefix text DEFAULT 'INV/'::text, invoice_start_number integer DEFAULT 1001, proforma_prefix text DEFAULT 'PI/'::text, proforma_start_number integer DEFAULT 1001, quotation_prefix text DEFAULT 'QTN/'::text, quotation_start_number integer DEFAULT 1001, work_order_prefix text DEFAULT 'WO/'::text, work_order_start_number integer DEFAULT 1001, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), google_sheets_url text, show_bank_details boolean DEFAULT true, approver_email text, non_tax_prefix text DEFAULT 'NT/'::text, non_tax_start_number integer DEFAULT 1001);
CREATE TABLE public.purchase_bills (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, bill_number text NOT NULL, supplier_id uuid, supplier_name text NOT NULL, supplier_gstin text, date date NOT NULL, due_date date, place_of_supply text, items jsonb DEFAULT '[]'::jsonb NOT NULL, subtotal numeric DEFAULT 0 NOT NULL, cgst_total numeric DEFAULT 0 NOT NULL, sgst_total numeric DEFAULT 0 NOT NULL, igst_total numeric DEFAULT 0 NOT NULL, total_gst numeric DEFAULT 0 NOT NULL, grand_total numeric DEFAULT 0 NOT NULL, paid_amount numeric DEFAULT 0 NOT NULL, balance_due numeric DEFAULT 0 NOT NULL, status text DEFAULT 'unpaid'::text NOT NULL, journal_entry_id uuid, notes text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.resources (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, name text NOT NULL, type text NOT NULL, description text, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.services (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, company_id uuid, name text NOT NULL, description text, default_rate numeric DEFAULT 0, unit text DEFAULT 'nos'::text, hsn_sac text, gst_percentage numeric DEFAULT 18, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.supplier_payments (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, payment_number text NOT NULL, supplier_id uuid, supplier_name text NOT NULL, date date NOT NULL, amount_paid numeric NOT NULL, payment_mode text NOT NULL, bank_account_head_id text, reference_number text, notes text, bill_allocations jsonb DEFAULT '[]'::jsonb NOT NULL, journal_entry_id uuid, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.suppliers (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, name text NOT NULL, gstin text, pan text, state text, state_code text, contact_person text, email text, phone text, address text, account_head_id text, payment_terms_days integer DEFAULT 30, current_balance numeric DEFAULT 0, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.telecalling_entries (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, entry_date date DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'::text))::date NOT NULL, company_name text NOT NULL, contact_person text, phone text NOT NULL, other_phone text, location text, email text, call_status text NOT NULL, feedback text, created_by uuid, created_by_email text, created_by_name text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL);
CREATE TABLE public.telecalling_google_sync_queue (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid NOT NULL, telecalling_entry_id uuid NOT NULL, action text DEFAULT 'save_telecalling_entry'::text NOT NULL, payload jsonb NOT NULL, status text DEFAULT 'pending'::text NOT NULL, attempts integer DEFAULT 0 NOT NULL, max_attempts integer DEFAULT 5 NOT NULL, failed_permanently boolean DEFAULT false NOT NULL, next_attempt_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, last_error text, locked_at timestamp with time zone, locked_by text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL);
CREATE TABLE public.whatsapp_conversations (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, customer_id uuid, lead_id uuid, lead_number text, customer_name text NOT NULL, company_name text, phone text NOT NULL, last_message text DEFAULT ''::text, last_message_at timestamp with time zone DEFAULT timezone('utc'::text, now()), unread_count integer DEFAULT 0 NOT NULL, assigned_staff_email text, status text DEFAULT 'open'::text NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()), updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.whatsapp_messages (id uuid DEFAULT gen_random_uuid() NOT NULL, conversation_id uuid, company_id uuid, wa_message_id text, sender_type text NOT NULL, sender_name text NOT NULL, sender_email text, message_type text DEFAULT 'text'::text NOT NULL, text text DEFAULT ''::text NOT NULL, "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now()), status text DEFAULT 'sent'::text NOT NULL, attachment_url text, attachment_type text, attachment_name text, error_message text, raw_payload jsonb, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.whatsapp_templates (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, template_name text NOT NULL, language text DEFAULT 'en'::text NOT NULL, category text DEFAULT 'UTILITY'::text NOT NULL, meta_status text DEFAULT 'APPROVED'::text NOT NULL, header_type text DEFAULT 'NONE'::text, body_text text NOT NULL, variables jsonb DEFAULT '[]'::jsonb, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));
CREATE TABLE public.whatsapp_webhooks_log (id uuid DEFAULT gen_random_uuid() NOT NULL, company_id uuid, event_type text NOT NULL, payload jsonb NOT NULL, processed boolean DEFAULT false NOT NULL, error_message text, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()));

-- ---------------------------------------------------------------------------
-- LIVE: primary keys, unique and check constraints
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_groups ADD CONSTRAINT account_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.account_heads ADD CONSTRAINT account_heads_pkey PRIMARY KEY (id);
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_pkey PRIMARY KEY (user_id, company_id);
ALTER TABLE public.app_members ADD CONSTRAINT app_members_pkey PRIMARY KEY (user_id);
ALTER TABLE public.approver_devices ADD CONSTRAINT approver_devices_pkey PRIMARY KEY (id);
ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);
ALTER TABLE public.bank_reconciliation_statements ADD CONSTRAINT bank_reconciliation_statements_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.comparison_document_data ADD CONSTRAINT comparison_document_data_pkey PRIMARY KEY (id);
ALTER TABLE public.comparison_templates ADD CONSTRAINT comparison_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_quotations ADD CONSTRAINT crm_quotations_pkey PRIMARY KEY (id);
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_pkey PRIMARY KEY (id);
ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE public.document_items ADD CONSTRAINT document_items_pkey PRIMARY KEY (id);
ALTER TABLE public.documents ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE public.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE public.financial_audit_logs ADD CONSTRAINT financial_audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.financial_period_locks ADD CONSTRAINT financial_period_locks_pkey PRIMARY KEY (id);
ALTER TABLE public.financial_year_closures ADD CONSTRAINT financial_year_closures_pkey PRIMARY KEY (id);
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_pkey PRIMARY KEY (id);
ALTER TABLE public.followup_review_events ADD CONSTRAINT followup_review_events_pkey PRIMARY KEY (id);
ALTER TABLE public.followup_review_state ADD CONSTRAINT followup_review_state_pkey PRIMARY KEY (follow_up_id);
ALTER TABLE public.google_sync_log ADD CONSTRAINT google_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.google_sync_settings ADD CONSTRAINT google_sync_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_number_counters ADD CONSTRAINT lead_number_counters_pkey PRIMARY KEY (company_id);
ALTER TABLE public.lead_number_repairs ADD CONSTRAINT lead_number_repairs_pkey PRIMARY KEY (lead_id);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.owner_report_dispatches ADD CONSTRAINT owner_report_dispatches_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_bills ADD CONSTRAINT purchase_bills_pkey PRIMARY KEY (id);
ALTER TABLE public.resources ADD CONSTRAINT resources_pkey PRIMARY KEY (id);
ALTER TABLE public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE public.telecalling_entries ADD CONSTRAINT telecalling_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.telecalling_google_sync_queue ADD CONSTRAINT telecalling_google_sync_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_webhooks_log ADD CONSTRAINT whatsapp_webhooks_log_pkey PRIMARY KEY (id);
ALTER TABLE public.account_heads ADD CONSTRAINT unique_account_code_per_company UNIQUE (company_id, code);
ALTER TABLE public.approver_devices ADD CONSTRAINT approver_devices_company_id_key UNIQUE (company_id);
ALTER TABLE public.comparison_document_data ADD CONSTRAINT comparison_document_data_document_id_key UNIQUE (document_id);
ALTER TABLE public.documents ADD CONSTRAINT documents_company_number_unique UNIQUE (company_id, document_number);
ALTER TABLE public.followup_review_events ADD CONSTRAINT followup_review_events_follow_up_id_action_id_key UNIQUE (follow_up_id, action_id);
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_document_id_key UNIQUE (document_id);
ALTER TABLE public.telecalling_google_sync_queue ADD CONSTRAINT telecalling_google_sync_queue_entry_unique UNIQUE (telecalling_entry_id);
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT unique_conv_phone_per_company UNIQUE (company_id, phone);
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT unique_template_name_per_company UNIQUE (company_id, template_name);
ALTER TABLE public.account_groups ADD CONSTRAINT account_groups_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text, 'income'::text, 'expense'::text])));
ALTER TABLE public.account_heads ADD CONSTRAINT account_heads_nature_check CHECK ((nature = ANY (ARRAY['debit'::text, 'credit'::text])));
ALTER TABLE public.account_heads ADD CONSTRAINT account_heads_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text, 'income'::text, 'expense'::text])));
ALTER TABLE public.app_members ADD CONSTRAINT app_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])));
ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_account_type_check CHECK ((account_type = ANY (ARRAY['current'::text, 'savings'::text, 'overdraft'::text, 'cash_credit'::text])));
ALTER TABLE public.bank_reconciliation_statements ADD CONSTRAINT bank_reconciliation_statements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'reconciled'::text, 'locked'::text])));
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_amount_received_check CHECK ((amount_received > (0)::numeric));
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['bank_transfer'::text, 'cheque'::text, 'upi'::text, 'cash'::text, 'card'::text])));
ALTER TABLE public.customers ADD CONSTRAINT customers_lead_status_check CHECK ((lead_status = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text, 'old'::text])));
ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.financial_audit_logs ADD CONSTRAINT financial_audit_logs_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text, 'posted'::text, 'voided'::text, 'reconciled'::text, 'locked'::text, 'closed'::text])));
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text, 'snoozed'::text, 'overdue'::text])));
ALTER TABLE public.google_sync_log ADD CONSTRAINT google_sync_log_status_check CHECK ((status = ANY (ARRAY['synced'::text, 'failed'::text])));
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_action_check CHECK ((action = ANY (ARRAY['save_document'::text, 'delete_document'::text])));
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'syncing'::text, 'synced'::text, 'failed'::text])));
ALTER TABLE public.journal_entries ADD CONSTRAINT balanced_entry_check CHECK ((abs((total_debit - total_credit)) < 0.01));
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check CHECK ((reference_type = ANY (ARRAY['invoice'::text, 'payment_receipt'::text, 'bill_payment'::text, 'expense'::text, 'manual_journal'::text, 'year_end_closing'::text, 'opening_balance'::text])));
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_total_credit_check CHECK ((total_credit >= (0)::numeric));
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_total_debit_check CHECK ((total_debit >= (0)::numeric));
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK ((lead_source = ANY (ARRAY['facebook'::text, 'instagram'::text, 'whatsapp_bulk'::text, 'website'::text, 'bulk_email'::text, 'existing_customer'::text, 'phone'::text, 'referral'::text, 'other'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_priority_check CHECK ((priority = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text])));
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'telecaller_working'::text, 'requirement_collected'::text, 'sent_to_admin'::text, 'quotation_preparing'::text, 'waiting_owner_approval'::text, 'quotation_sent'::text, 'follow_up'::text, 'confirmed'::text, 'lost'::text, 'future'::text, 'owner_handover'::text])));
ALTER TABLE public.owner_report_dispatches ADD CONSTRAINT owner_report_dispatches_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'partially_sent'::text, 'skipped'::text, 'requires_manual_review'::text])));
ALTER TABLE public.purchase_bills ADD CONSTRAINT purchase_bills_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'partially_paid'::text, 'paid'::text, 'overdue'::text, 'void'::text])));
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_amount_paid_check CHECK ((amount_paid > (0)::numeric));
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['bank_transfer'::text, 'cheque'::text, 'upi'::text, 'cash'::text, 'card'::text])));
ALTER TABLE public.telecalling_google_sync_queue ADD CONSTRAINT telecalling_google_sync_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'syncing'::text, 'synced'::text, 'failed'::text])));
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'pending'::text])));
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_attachment_type_check CHECK ((attachment_type = ANY (ARRAY['pdf'::text, 'image'::text, 'route_map'::text, 'document'::text])));
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'template'::text, 'document'::text, 'image'::text, 'location'::text, 'interactive'::text])));
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['customer'::text, 'staff'::text, 'system'::text])));
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_category_check CHECK ((category = ANY (ARRAY['UTILITY'::text, 'MARKETING'::text, 'AUTHENTICATION'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_meta_status_check CHECK ((meta_status = ANY (ARRAY['APPROVED'::text, 'PENDING'::text, 'REJECTED'::text])));

-- ---------------------------------------------------------------------------
-- LIVE: foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_groups ADD CONSTRAINT account_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.account_groups ADD CONSTRAINT account_groups_parent_group_id_fkey FOREIGN KEY (parent_group_id) REFERENCES account_groups(id) ON DELETE SET NULL;
ALTER TABLE public.account_heads ADD CONSTRAINT account_heads_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.account_heads ADD CONSTRAINT account_heads_group_id_fkey FOREIGN KEY (group_id) REFERENCES account_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.app_company_members ADD CONSTRAINT app_company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_members(user_id) ON DELETE CASCADE;
ALTER TABLE public.app_members ADD CONSTRAINT app_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.approver_devices ADD CONSTRAINT approver_devices_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bank_accounts ADD CONSTRAINT bank_accounts_linked_account_head_id_fkey FOREIGN KEY (linked_account_head_id) REFERENCES account_heads(id) ON DELETE RESTRICT;
ALTER TABLE public.bank_reconciliation_statements ADD CONSTRAINT bank_reconciliation_statements_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.bank_reconciliation_statements ADD CONSTRAINT bank_reconciliation_statements_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
ALTER TABLE public.comparison_document_data ADD CONSTRAINT comparison_document_data_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE public.comparison_templates ADD CONSTRAINT comparison_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.comparison_templates ADD CONSTRAINT comparison_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.crm_quotations ADD CONSTRAINT crm_quotations_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.crm_quotations ADD CONSTRAINT crm_quotations_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_deposit_account_head_id_fkey FOREIGN KEY (deposit_account_head_id) REFERENCES account_heads(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_receipts ADD CONSTRAINT customer_receipts_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.customers ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.customers ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.document_items ADD CONSTRAINT document_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE public.document_items ADD CONSTRAINT document_items_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD CONSTRAINT documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.documents ADD CONSTRAINT documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_account_head_id_fkey FOREIGN KEY (expense_account_head_id) REFERENCES account_heads(id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_account_head_id_fkey FOREIGN KEY (payment_account_head_id) REFERENCES account_heads(id) ON DELETE RESTRICT;
ALTER TABLE public.financial_audit_logs ADD CONSTRAINT financial_audit_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.financial_period_locks ADD CONSTRAINT financial_period_locks_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.financial_year_closures ADD CONSTRAINT financial_year_closures_closing_journal_entry_id_fkey FOREIGN KEY (closing_journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.financial_year_closures ADD CONSTRAINT financial_year_closures_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.google_sync_log ADD CONSTRAINT google_sync_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.google_sync_log ADD CONSTRAINT google_sync_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.google_sync_queue ADD CONSTRAINT google_sync_queue_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE public.google_sync_settings ADD CONSTRAINT google_sync_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.lead_number_counters ADD CONSTRAINT lead_number_counters_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id);
ALTER TABLE public.leads ADD CONSTRAINT leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_bills ADD CONSTRAINT purchase_bills_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_bills ADD CONSTRAINT purchase_bills_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_bills ADD CONSTRAINT purchase_bills_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE public.resources ADD CONSTRAINT resources_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT services_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.services ADD CONSTRAINT services_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_bank_account_head_id_fkey FOREIGN KEY (bank_account_head_id) REFERENCES account_heads(id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_account_head_id_fkey FOREIGN KEY (account_head_id) REFERENCES account_heads(id) ON DELETE SET NULL;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.telecalling_entries ADD CONSTRAINT telecalling_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.telecalling_entries ADD CONSTRAINT telecalling_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.telecalling_google_sync_queue ADD CONSTRAINT telecalling_google_sync_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.telecalling_google_sync_queue ADD CONSTRAINT telecalling_google_sync_queue_telecalling_entry_id_fkey FOREIGN KEY (telecalling_entry_id) REFERENCES telecalling_entries(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_conversations ADD CONSTRAINT whatsapp_conversations_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_webhooks_log ADD CONSTRAINT whatsapp_webhooks_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- LIVE: indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_customers_archived ON public.customers USING btree (archived);
CREATE INDEX idx_customers_lead_status ON public.customers USING btree (lead_status);
CREATE INDEX idx_follow_ups_company ON public.follow_ups USING btree (company_id);
CREATE INDEX idx_follow_ups_customer ON public.follow_ups USING btree (customer_id);
CREATE INDEX idx_follow_ups_date_status ON public.follow_ups USING btree (follow_up_date, status);
CREATE INDEX followup_review_events_company_day ON public.followup_review_events USING btree (company_id, created_at, id);
CREATE INDEX followup_review_state_company ON public.followup_review_state USING btree (company_id, follow_up_id);
CREATE INDEX idx_sync_log_company_created ON public.google_sync_log USING btree (company_id, created_at DESC);
CREATE INDEX idx_sync_log_document ON public.google_sync_log USING btree (document_id);
CREATE INDEX idx_sync_queue_company ON public.google_sync_queue USING btree (company_id);
CREATE INDEX idx_sync_queue_next_attempt ON public.google_sync_queue USING btree (next_attempt_at) WHERE ((status = ANY (ARRAY['pending'::text, 'failed'::text])) AND (failed_permanently = false));
CREATE INDEX idx_sync_queue_status ON public.google_sync_queue USING btree (status);
CREATE INDEX idx_lead_activity_company_id ON public.lead_activity USING btree (company_id);
CREATE INDEX idx_lead_activity_lead_id ON public.lead_activity USING btree (lead_id, created_at);
CREATE INDEX idx_leads_assigned_telecaller ON public.leads USING btree (assigned_telecaller_email);
CREATE INDEX idx_leads_company_id ON public.leads USING btree (company_id);
CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);
CREATE INDEX idx_leads_next_follow_up ON public.leads USING btree (next_follow_up_at) WHERE (next_follow_up_at IS NOT NULL);
CREATE INDEX idx_leads_status ON public.leads USING btree (status);
CREATE UNIQUE INDEX unique_lead_number_per_company ON public.leads USING btree (company_id, lead_number);
CREATE INDEX idx_owner_report_dispatches_lookup ON public.owner_report_dispatches USING btree (report_type, staff_email, report_date, status);
CREATE INDEX idx_owner_report_dispatches_updated ON public.owner_report_dispatches USING btree (updated_at DESC);
CREATE INDEX idx_telecalling_entries_call_status ON public.telecalling_entries USING btree (company_id, call_status);
CREATE INDEX idx_telecalling_entries_company_date ON public.telecalling_entries USING btree (company_id, entry_date DESC);
CREATE INDEX idx_telecalling_entries_created_by ON public.telecalling_entries USING btree (company_id, created_by);
CREATE INDEX idx_telecalling_entries_phone ON public.telecalling_entries USING btree (phone);
CREATE INDEX idx_telecalling_sync_queue_claim ON public.telecalling_google_sync_queue USING btree (company_id, status, next_attempt_at) WHERE (failed_permanently = false);

-- ---------------------------------------------------------------------------
-- LIVE: functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION followup_audit_internal.record_followup_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.assign_lead_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION public.can_access_company(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.current_app_role() IS NOT NULL AND
 (public.current_app_role() IN ('owner','admin') OR EXISTS(
 SELECT 1 FROM public.app_company_members WHERE user_id=auth.uid() AND company_id=p_company_id))
$function$
;
CREATE OR REPLACE FUNCTION public.claim_owner_report_dispatch(p_id text, p_staff_email text, p_report_date date, p_recipient text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_existing RECORD;
  v_claimed RECORD;
BEGIN
  -- Row-level lock on existing dispatch row
  SELECT * INTO v_existing FROM public.owner_report_dispatches WHERE id = p_id FOR UPDATE;

  IF FOUND THEN
    -- If already sent or delivered and not force, claim rejected
    IF v_existing.status IN ('sent', 'delivered') AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'already_sent',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- If flagged for manual review and not force, claim rejected to protect against automatic duplicates
    IF v_existing.status = 'requires_manual_review' AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'manual_review_required',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- If in_progress and updated within last 5 minutes and not force, active lock exists
    IF v_existing.status = 'in_progress' AND v_existing.updated_at > (TIMEZONE('utc', NOW()) - INTERVAL '5 minutes') AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'in_progress_locked',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- Update to in_progress to atomically claim (for failed, partially_sent, expired or forced)
    UPDATE public.owner_report_dispatches
    SET status = 'in_progress',
        recipient = p_recipient,
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = p_id
    RETURNING * INTO v_claimed;

    RETURN jsonb_build_object(
      'acquired', true,
      'reason', 'reclaimed',
      'dispatch', to_jsonb(v_claimed)
    );
  ELSE
    -- Row does not exist: perform atomic insert
    INSERT INTO public.owner_report_dispatches (
      id, report_type, staff_email, report_date, recipient, status, created_at, updated_at
    ) VALUES (
      p_id, 'detailed_staff_report', p_staff_email, p_report_date, p_recipient, 'in_progress', TIMEZONE('utc', NOW()), TIMEZONE('utc', NOW())
    ) RETURNING * INTO v_claimed;

    RETURN jsonb_build_object(
      'acquired', true,
      'reason', 'new_claim',
      'dispatch', to_jsonb(v_claimed)
    );
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    -- If concurrent insert collided at the same microsecond:
    SELECT * INTO v_existing FROM public.owner_report_dispatches WHERE id = p_id;
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'conflict_lost',
      'dispatch', to_jsonb(v_existing)
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_sync_queue_rows(p_worker_id text, p_limit integer DEFAULT 10)
 RETURNS SETOF google_sync_queue
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  UPDATE google_sync_queue q
  SET status = 'syncing', locked_at = now(), locked_by = p_worker_id, updated_at = now()
  FROM (
    SELECT id FROM google_sync_queue
    WHERE status IN ('pending', 'failed', 'syncing')
      AND failed_permanently = false
      AND next_attempt_at <= now()
      AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ) claimable
  WHERE q.id = claimable.id
  RETURNING q.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_telecalling_sync_queue_rows(p_worker_id text, p_limit integer DEFAULT 10)
 RETURNS SETOF telecalling_google_sync_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM public.telecalling_google_sync_queue
    WHERE status IN ('pending', 'failed')
      AND failed_permanently = false
      AND next_attempt_at <= now()
      AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.telecalling_google_sync_queue q
  SET status = 'syncing',
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.current_app_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT m.role FROM public.app_members m JOIN auth.users u ON u.id=m.user_id
 WHERE m.user_id=auth.uid() AND m.active AND u.deleted_at IS NULL
 AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
$function$
;
CREATE OR REPLACE FUNCTION public.delete_document_bundle(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.documents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_access_company(d.company_id) OR public.current_app_role() NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Document deletion denied'; END IF;
 DELETE FROM public.comparison_document_data WHERE document_id=p_id;
 DELETE FROM public.document_items WHERE document_id=p_id;
 DELETE FROM public.documents WHERE id=p_id; RETURN p_id;
END $function$
;
CREATE OR REPLACE FUNCTION public.followup_accountability_version()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT 1 $function$
;
CREATE OR REPLACE FUNCTION public.followup_timeline_version()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT 1 $function$
;
CREATE OR REPLACE FUNCTION public.get_public_comparison_data(p_document_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT jsonb_build_object('comparison',c.options_data,'currency',p.currency)
 FROM public.documents d JOIN public.comparison_document_data c ON c.document_id=d.id
 JOIN public.profiles p ON p.id=d.company_id
 WHERE d.id::text=p_document_id AND d.status='approved'
 AND d.document_type IN ('comparison_quotation','comparison_invoice')
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_document(p_id uuid DEFAULT NULL::uuid, p_document_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc documents%ROWTYPE;
  v_items jsonb;
  v_profile jsonb;
BEGIN
  -- The random UUID is the bearer share link. Predictable document numbers are not public credentials.
  IF p_id IS NULL OR p_document_number IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_doc FROM public.documents WHERE id=p_id AND status='approved';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', di.id,
      'description', di.description,
      'quantity', di.quantity,
      'days', di.days,
      'rate', di.rate,
      'unit', di.unit,
      'amount', di.amount,
      'gst_percentage', di.gst_percentage
    ) ORDER BY di.sort_order
  ), '[]'::jsonb)
  INTO v_items
  FROM document_items di
  WHERE di.document_id = v_doc.id;

  SELECT jsonb_build_object(
    'name', p.name,
    'address', p.address,
    'logo_url', p.logo_url,
    'email', p.email,
    'gstin', p.gstin,
    'phone', p.phone,
    'website', p.website,
    'bank_account_no', p.bank_account_no,
    'bank_holder', p.bank_holder,
    'bank_ifsc', p.bank_ifsc,
    'bank_name', p.bank_name,
    'default_terms', p.default_terms,
    'seal_url', p.seal_url, 'currency', p.currency
  )
  INTO v_profile
  FROM profiles p
  WHERE p.id = v_doc.company_id;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id,
      'company_id', v_doc.company_id,
      'document_type', v_doc.document_type,
      'document_number', v_doc.document_number,
      'customer_name', v_doc.customer_name,
      'customer_phone', v_doc.customer_phone,
      'customer_address', v_doc.customer_address,
      'customer_gstin', v_doc.customer_gstin,
      'date', v_doc.date,
      'col_name_description', v_doc.col_name_description,
      'col_name_quantity', v_doc.col_name_quantity,
      'col_name_unit', v_doc.col_name_unit,
      'col_name_rate', v_doc.col_name_rate,
      'col_name_amount', v_doc.col_name_amount,
      'subtotal', v_doc.subtotal, 'tax_total', v_doc.tax_total, 'advance', v_doc.advance,
      'discount_total', v_doc.discount_total,
      'notes', v_doc.notes,
      'terms', v_doc.terms,
      'total', v_doc.total,
      'status', v_doc.status
    ),
    'items', v_items,
    'profile', v_profile,
    'comparison', (SELECT options_data FROM public.comparison_document_data WHERE document_id=v_doc.id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_crm_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.approval_status IN ('APPROVED','SENT','REJECTED') AND public.current_app_role() IS DISTINCT FROM 'owner' THEN
   RAISE EXCEPTION 'Only the owner can approve quotations'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['updated_at','approval_status','status','approver_name','approver_notes','approved_at','rejected_at','rejection_reason','sent_to_customer_at','sent_by_email'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','approval_status','status','approver_name','approver_notes','approved_at','rejected_at','rejection_reason','sent_to_customer_at','sent_by_email']) THEN
    NEW.approval_status:='WAITING_APPROVAL'; NEW.status:='WAITING_APPROVAL'; NEW.approved_at:=NULL; NEW.approver_name:=NULL;
  ELSIF (NEW.approval_status IS DISTINCT FROM OLD.approval_status OR NEW.approver_name IS DISTINCT FROM OLD.approver_name
   OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approver_notes IS DISTINCT FROM OLD.approver_notes)
   AND public.current_app_role() IS DISTINCT FROM 'owner' THEN
    IF NOT (OLD.approval_status='APPROVED' AND NEW.approval_status='SENT' AND NEW.approver_name IS NOT DISTINCT FROM OLD.approver_name
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND NEW.approver_notes IS NOT DISTINCT FROM OLD.approver_notes)
     AND NEW.approval_status NOT IN ('DRAFT','WAITING_APPROVAL') THEN RAISE EXCEPTION 'Only the owner can approve quotations'; END IF;
  END IF;
 END IF;
 IF NEW.approval_status='APPROVED' AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM 'APPROVED') THEN
  NEW.approver_name:=auth.jwt()->>'email'; NEW.approved_at:=now(); END IF;
 NEW.status:=NEW.approval_status;
 RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.guard_followup_completion_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF lower(coalesce(to_jsonb(NEW)->>'type', to_jsonb(NEW)->>'action', '')) = 'follow-up completed'
    AND pg_trigger_depth() = 1 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.log_document_send(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 UPDATE public.documents SET whatsapp_sent_by_email=(SELECT email FROM auth.users WHERE id=auth.uid()),whatsapp_sent_at=now()
 WHERE id=p_id AND public.can_access_company(company_id) AND status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'Approved document not found'; END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.log_followup_timeline_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.preserve_followup_completion_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF lower(OLD.status) = 'completed' AND lower(NEW.status) = 'completed' THEN
    NEW.completed_at := OLD.completed_at;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.review_document(p_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.documents%ROWTYPE;
BEGIN
 IF public.current_app_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Only the owner can approve or reject quotations and invoices'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
 IF p_approve AND d.document_type IN ('comparison_quotation','comparison_invoice') AND NOT EXISTS(
  SELECT 1 FROM public.comparison_document_data WHERE document_id=p_id AND jsonb_typeof(options_data->'options')='array'
  AND jsonb_array_length(options_data->'options')>0) THEN RAISE EXCEPTION 'Save the complete comparison before approval'; END IF;
 UPDATE public.documents SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
 approved_by_email=(SELECT email FROM auth.users WHERE id=auth.uid()),approved_at=now() WHERE id=p_id RETURNING * INTO d;
 RETURN to_jsonb(d);
END $function$
;
CREATE OR REPLACE FUNCTION public.save_document_bundle(p_document jsonb, p_items jsonb, p_comparison jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d public.documents%ROWTYPE; previous public.documents%ROWTYPE; it jsonb; allowed jsonb;
BEGIN
 IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid document payload'; END IF;
 IF NOT public.can_access_company((p_document->>'company_id')::uuid) THEN RAISE EXCEPTION 'Company access denied'; END IF;
 -- Serialize saves for the same ID, including two concurrent initial creates.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_document->>'id',0));
 SELECT * INTO previous FROM public.documents WHERE id=(p_document->>'id')::uuid FOR UPDATE;
 IF FOUND AND (previous.company_id IS DISTINCT FROM (p_document->>'company_id')::uuid) THEN
  RAISE EXCEPTION 'A document cannot be moved to another company'; END IF;
 -- Only these fields are writable: clients cannot supply approver identity or audit fields.
 SELECT jsonb_object_agg(key,value) INTO allowed FROM jsonb_each(p_document) WHERE key=ANY(ARRAY[
 'id','company_id','document_type','document_number','sequence_number','customer_id','customer_name',
 'customer_email','customer_phone','customer_address','customer_gstin','date','col_name_description',
 'col_name_quantity','col_name_unit','col_name_rate','col_name_amount','subtotal','tax_total','discount_total',
 'total','advance','notes','terms']);
 d := jsonb_populate_record(previous,allowed);
 IF d.id IS NULL OR d.document_number IS NULL OR d.customer_name IS NULL THEN RAISE EXCEPTION 'Document details are required'; END IF;
 IF d.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=d.customer_id AND company_id=d.company_id) THEN
  RAISE EXCEPTION 'Customer belongs to another company'; END IF;
 IF d.document_type IN ('comparison_quotation','comparison_invoice') AND
 (jsonb_typeof(p_comparison) IS DISTINCT FROM 'object' OR jsonb_typeof(p_comparison->'options') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_comparison->'options')=0) THEN RAISE EXCEPTION 'Comparison options must be saved with the document'; END IF;
 d.status := 'pending_approval'; d.approved_by_email := NULL; d.approved_at := NULL;
 d.user_id := coalesce(previous.user_id,auth.uid());
 d.created_by_email := coalesce(previous.created_by_email,(SELECT email FROM auth.users WHERE id=auth.uid()));
 d.created_at := coalesce(previous.created_at,now()); d.date := coalesce(d.date,current_date);
 d.col_name_description := coalesce(d.col_name_description,'Description');
 d.col_name_quantity := coalesce(d.col_name_quantity,'Quantity'); d.col_name_unit := coalesce(d.col_name_unit,'Unit');
 d.col_name_rate := coalesce(d.col_name_rate,'Rate'); d.col_name_amount := coalesce(d.col_name_amount,'Amount');
 d.subtotal := coalesce(d.subtotal,0); d.tax_total := coalesce(d.tax_total,0);
 d.discount_total := coalesce(d.discount_total,0); d.total := coalesce(d.total,0); d.advance := coalesce(d.advance,0);
 IF previous.id IS NULL THEN INSERT INTO public.documents SELECT d.*;
 ELSE UPDATE public.documents SET
 document_type=d.document_type,document_number=d.document_number,sequence_number=d.sequence_number,
 customer_id=d.customer_id,customer_name=d.customer_name,customer_email=d.customer_email,
 customer_phone=d.customer_phone,customer_address=d.customer_address,customer_gstin=d.customer_gstin,
 date=d.date,col_name_description=d.col_name_description,col_name_quantity=d.col_name_quantity,
 col_name_unit=d.col_name_unit,col_name_rate=d.col_name_rate,col_name_amount=d.col_name_amount,
 subtotal=d.subtotal,tax_total=d.tax_total,discount_total=d.discount_total,total=d.total,advance=d.advance,
 notes=d.notes,terms=d.terms,status=d.status,approved_by_email=NULL,approved_at=NULL WHERE id=d.id;
 END IF;
 DELETE FROM public.document_items WHERE document_id=d.id;
 FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF nullif(it->>'service_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.services
   WHERE id=(it->>'service_id')::uuid AND company_id=d.company_id) THEN RAISE EXCEPTION 'Invalid service'; END IF;
  INSERT INTO public.document_items(id,document_id,service_id,description,quantity,days,rate,unit,hsn_sac,gst_percentage,amount,sort_order)
  VALUES(coalesce((it->>'id')::uuid,gen_random_uuid()),d.id,nullif(it->>'service_id','')::uuid,it->>'description',
   (it->>'quantity')::numeric,coalesce((it->>'days')::numeric,1),(it->>'rate')::numeric,it->>'unit',it->>'hsn_sac',
   coalesce((it->>'gst_percentage')::numeric,0),(it->>'amount')::numeric,coalesce((it->>'sort_order')::int,0));
 END LOOP;
 IF d.document_type IN ('comparison_quotation','comparison_invoice') THEN
  INSERT INTO public.comparison_document_data(document_id,options_data) VALUES(d.id,p_comparison)
  ON CONFLICT(document_id) DO UPDATE SET options_data=excluded.options_data;
 ELSE DELETE FROM public.comparison_document_data WHERE document_id=d.id; END IF;
 RETURN to_jsonb(d);
END $function$
;
CREATE OR REPLACE FUNCTION public.whatsapp_rls_guard_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE parent_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_conversations' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='WhatsApp company reassignment is not allowed';
    END IF;
  ELSE
    IF NEW.company_id IS NULL OR NEW.conversation_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='WhatsApp message requires a company and matching conversation';
    END IF;
    IF TG_OP='UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='WhatsApp company reassignment is not allowed';
    END IF;
    SELECT c.company_id INTO parent_company FROM public.whatsapp_conversations c
      WHERE c.id=NEW.conversation_id FOR KEY SHARE;
    IF NOT FOUND OR parent_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='WhatsApp message requires a company and matching conversation';
    END IF;
  END IF;
  RETURN NEW;
END
$function$
;

-- ---------------------------------------------------------------------------
-- LIVE: function privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION followup_audit_internal.record_followup_review() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_lead_number() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.assign_lead_number() TO service_role;
REVOKE ALL ON FUNCTION public.can_access_company(p_company_id uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.can_access_company(p_company_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_owner_report_dispatch(p_id text, p_staff_email text, p_report_date date, p_recipient text, p_force boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.claim_owner_report_dispatch(p_id text, p_staff_email text, p_report_date date, p_recipient text, p_force boolean) TO service_role;
REVOKE ALL ON FUNCTION public.claim_sync_queue_rows(p_worker_id text, p_limit integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.claim_sync_queue_rows(p_worker_id text, p_limit integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_telecalling_sync_queue_rows(p_worker_id text, p_limit integer) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.claim_telecalling_sync_queue_rows(p_worker_id text, p_limit integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_document_bundle(p_id uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.delete_document_bundle(p_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.followup_accountability_version() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.followup_accountability_version() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.followup_timeline_version() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.followup_timeline_version() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_comparison_data(p_document_id text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.get_public_comparison_data(p_document_id text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_document(p_id uuid, p_document_number text) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.get_public_document(p_id uuid, p_document_number text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_crm_approval() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.guard_crm_approval() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_followup_completion_activity() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.guard_followup_completion_activity() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_document_send(p_id uuid) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.log_document_send(p_id uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_followup_timeline_activity() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.log_followup_timeline_activity() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preserve_followup_completion_time() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.preserve_followup_completion_time() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.review_document(p_id uuid, p_approve boolean) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.review_document(p_id uuid, p_approve boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_document_bundle(p_document jsonb, p_items jsonb, p_comparison jsonb) FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.save_document_bundle(p_document jsonb, p_items jsonb, p_comparison jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.whatsapp_rls_guard_company() FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION public.whatsapp_rls_guard_company() TO service_role;

-- ---------------------------------------------------------------------------
-- LIVE: triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER guard_crm_approval BEFORE INSERT OR UPDATE ON public.crm_quotations FOR EACH ROW EXECUTE FUNCTION guard_crm_approval();
CREATE TRIGGER followup_timeline_activity AFTER INSERT OR UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION log_followup_timeline_activity();
CREATE TRIGGER preserve_followup_completion_time BEFORE UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION preserve_followup_completion_time();
CREATE TRIGGER record_followup_review AFTER INSERT OR DELETE OR UPDATE ON public.follow_ups FOR EACH ROW EXECUTE FUNCTION followup_audit_internal.record_followup_review();
CREATE TRIGGER guard_followup_completion_activity BEFORE INSERT ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION guard_followup_completion_activity();
CREATE TRIGGER assign_lead_number BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION assign_lead_number();
CREATE TRIGGER whatsapp_rls_conversation_company_immutable BEFORE UPDATE OF company_id ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION whatsapp_rls_guard_company();
CREATE TRIGGER whatsapp_rls_message_company_match BEFORE INSERT OR UPDATE ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION whatsapp_rls_guard_company();

-- ---------------------------------------------------------------------------
-- LIVE: row-level security flags
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approver_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_document_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_year_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_review_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_number_repairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_report_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telecalling_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telecalling_google_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhooks_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- LIVE: policies
-- ---------------------------------------------------------------------------
CREATE POLICY account_groups_authenticated_all ON public.account_groups AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY account_heads_authenticated_all ON public.account_heads AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.approver_devices AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.approver_devices AS PERMISSIVE FOR ALL TO authenticated USING ((can_access_company(company_id) AND (current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) WITH CHECK ((can_access_company(company_id) AND (current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
CREATE POLICY bank_accounts_authenticated_all ON public.bank_accounts AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY bank_reconciliation_statements_authenticated_all ON public.bank_reconciliation_statements AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY bookings_authenticated_all ON public.bookings AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.comparison_document_data AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.id = comparison_document_data.document_id) AND can_access_company(d.company_id)))));
CREATE POLICY office_read ON public.comparison_templates AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.comparison_templates AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY office_read ON public.crm_quotations AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.crm_quotations AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY customer_receipts_authenticated_all ON public.customer_receipts AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.customers AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.customers AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY office_read ON public.document_items AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.id = document_items.document_id) AND can_access_company(d.company_id)))));
CREATE POLICY office_read ON public.documents AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY expenses_authenticated_all ON public.expenses AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY financial_audit_logs_authenticated_all ON public.financial_audit_logs AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY financial_period_locks_authenticated_all ON public.financial_period_locks AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY financial_year_closures_authenticated_all ON public.financial_year_closures AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.follow_ups AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.follow_ups AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY google_sync_log_auth_all ON public.google_sync_log AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY google_sync_queue_auth_all ON public.google_sync_queue AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY google_sync_settings_auth_all ON public.google_sync_settings AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY journal_entries_authenticated_all ON public.journal_entries AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.lead_activities AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.lead_activities AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY lead_activity_auth_all ON public.lead_activity AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY office_read ON public.leads AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.leads AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY owner_report_dispatches_insert ON public.owner_report_dispatches AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((current_app_role() = 'owner'::text) OR (lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['sarathjohnpanengadan@gmail.com'::text, 'sarathjohnpanegdan@gmail.com'::text, 'owner@b2p.com'::text]))));
CREATE POLICY owner_report_dispatches_select ON public.owner_report_dispatches AS PERMISSIVE FOR SELECT TO authenticated USING (((current_app_role() = 'owner'::text) OR (lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['sarathjohnpanengadan@gmail.com'::text, 'sarathjohnpanegdan@gmail.com'::text, 'owner@b2p.com'::text]))));
CREATE POLICY owner_report_dispatches_update ON public.owner_report_dispatches AS PERMISSIVE FOR UPDATE TO authenticated USING (((current_app_role() = 'owner'::text) OR (lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['sarathjohnpanengadan@gmail.com'::text, 'sarathjohnpanegdan@gmail.com'::text, 'owner@b2p.com'::text])))) WITH CHECK (((current_app_role() = 'owner'::text) OR (lower((auth.jwt() ->> 'email'::text)) = ANY (ARRAY['sarathjohnpanengadan@gmail.com'::text, 'sarathjohnpanegdan@gmail.com'::text, 'owner@b2p.com'::text]))));
CREATE POLICY office_read ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(id));
CREATE POLICY office_write ON public.profiles AS PERMISSIVE FOR ALL TO authenticated USING ((current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) WITH CHECK ((current_app_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY purchase_bills_authenticated_all ON public.purchase_bills AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY resources_authenticated_all ON public.resources AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY office_read ON public.services AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY office_write ON public.services AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY supplier_payments_authenticated_all ON public.supplier_payments AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY suppliers_authenticated_all ON public.suppliers AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY telecalling_read ON public.telecalling_entries AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY telecalling_write ON public.telecalling_entries AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY telecalling_sync_read ON public.telecalling_google_sync_queue AS PERMISSIVE FOR SELECT TO authenticated USING (can_access_company(company_id));
CREATE POLICY telecalling_sync_write ON public.telecalling_google_sync_queue AS PERMISSIVE FOR ALL TO authenticated USING (can_access_company(company_id)) WITH CHECK (can_access_company(company_id));
CREATE POLICY whatsapp_conversations_auth_all ON public.whatsapp_conversations AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY whatsapp_rls_conversations_company ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated USING (((company_id IS NOT NULL) AND can_access_company(company_id))) WITH CHECK (((company_id IS NOT NULL) AND can_access_company(company_id)));
CREATE POLICY whatsapp_messages_auth_all ON public.whatsapp_messages AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY whatsapp_rls_messages_company ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated USING (((company_id IS NOT NULL) AND can_access_company(company_id) AND (EXISTS ( SELECT 1
   FROM whatsapp_conversations c
  WHERE ((c.id = whatsapp_messages.conversation_id) AND (c.company_id = whatsapp_messages.company_id)))))) WITH CHECK (((company_id IS NOT NULL) AND can_access_company(company_id) AND (EXISTS ( SELECT 1
   FROM whatsapp_conversations c
  WHERE ((c.id = whatsapp_messages.conversation_id) AND (c.company_id = whatsapp_messages.company_id))))));
CREATE POLICY whatsapp_rls_templates_company ON public.whatsapp_templates AS RESTRICTIVE FOR ALL TO authenticated USING (((company_id IS NOT NULL) AND can_access_company(company_id))) WITH CHECK (((company_id IS NOT NULL) AND can_access_company(company_id)));
CREATE POLICY whatsapp_templates_auth_all ON public.whatsapp_templates AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY whatsapp_rls_logs_server_only ON public.whatsapp_webhooks_log AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_webhooks_log_auth_all ON public.whatsapp_webhooks_log AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));

-- ---------------------------------------------------------------------------
-- LIVE: table privileges for anon, authenticated and service_role
-- ---------------------------------------------------------------------------
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_groups TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_groups TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_groups TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_heads TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_heads TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.account_heads TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_company_members TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_members TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.approver_devices TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.approver_devices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.approver_devices TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_accounts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_accounts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_accounts TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_reconciliation_statements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_reconciliation_statements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bank_reconciliation_statements TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bookings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bookings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.bookings TO service_role;
GRANT SELECT ON public.comparison_document_data TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.comparison_document_data TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.comparison_templates TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.comparison_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.comparison_templates TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.crm_quotations TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.crm_quotations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.crm_quotations TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_receipts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_receipts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customer_receipts TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.customers TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.customers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.customers TO service_role;
GRANT SELECT ON public.document_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.document_items TO service_role;
GRANT SELECT ON public.documents TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.documents TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.expenses TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_audit_logs TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_audit_logs TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_audit_logs TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_period_locks TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_period_locks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_period_locks TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_year_closures TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_year_closures TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.financial_year_closures TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.follow_ups TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.follow_ups TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.follow_ups TO service_role;
GRANT SELECT ON public.followup_review_events TO service_role;
GRANT SELECT ON public.followup_review_state TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_log TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_log TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_queue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_queue TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_settings TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_settings TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.google_sync_settings TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.journal_entries TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lead_activities TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.lead_activities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_activities TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_activity TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_activity TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_activity TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_number_counters TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lead_number_repairs TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leads TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leads TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leads TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.owner_report_dispatches TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.owner_report_dispatches TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.owner_report_dispatches TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profiles TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_bills TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_bills TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.purchase_bills TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.resources TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.resources TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.resources TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.services TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.services TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.services TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.supplier_payments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.supplier_payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.supplier_payments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_entries TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_entries TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_google_sync_queue TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_google_sync_queue TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.telecalling_google_sync_queue TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.whatsapp_conversations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.whatsapp_conversations TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.whatsapp_messages TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.whatsapp_messages TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.whatsapp_templates TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.whatsapp_templates TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.whatsapp_webhooks_log TO service_role;

-- ===========================================================================
-- TEST STUB: Supabase default privileges. In production every table, sequence
-- and function created in public from now on is granted to anon,
-- authenticated and service_role unless a migration revokes it. Declared after
-- the LIVE section so it affects only objects the migrations under test create.
-- ===========================================================================
RESET check_function_bodies;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
