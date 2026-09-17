-- =====================================================================
-- B2P INTERNATIONAL ERP: ALL CONSOLIDATED DATABASE MIGRATIONS
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================================



-- =====================================================================
-- START OF: 20260824000000_base_document_generator_schema.sql
-- =====================================================================

-- =====================================================================
-- 20260824000000_base_document_generator_schema.sql
-- Base Document Generator Schema for Isolated Staging (xkgytoygtzmsszaogwxi)
-- =====================================================================

-- 0. Schema Permissions & Grants
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- 1. Profiles (Company entities)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    seal_url TEXT,
    gstin TEXT,
    pan TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    website TEXT,
    currency TEXT DEFAULT 'INR',
    bank_name TEXT,
    bank_account_no TEXT,
    bank_ifsc TEXT,
    bank_holder TEXT,
    bank_branch TEXT,
    default_terms TEXT,
    
    -- Column headings
    col_name_description TEXT DEFAULT 'Description',
    col_name_quantity TEXT DEFAULT 'Quantity',
    col_name_unit TEXT DEFAULT 'Unit',
    col_name_rate TEXT DEFAULT 'Rate',
    col_name_amount TEXT DEFAULT 'Amount',
    
    -- Sequencing settings
    invoice_prefix TEXT DEFAULT 'INV/',
    invoice_start_number INT DEFAULT 1001,
    proforma_prefix TEXT DEFAULT 'PI/',
    proforma_start_number INT DEFAULT 1001,
    quotation_prefix TEXT DEFAULT 'QTN/',
    quotation_start_number INT DEFAULT 1001,
    work_order_prefix TEXT DEFAULT 'WO/',
    work_order_start_number INT DEFAULT 1001,
    non_tax_prefix TEXT DEFAULT 'NT/',
    non_tax_start_number INT DEFAULT 1001,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Customers
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gstin TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Services
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    default_rate NUMERIC DEFAULT 0,
    unit TEXT DEFAULT 'nos',
    hsn_sac TEXT,
    gst_percentage NUMERIC DEFAULT 18,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. Documents (Invoices, Proforma Invoices, Quotations, Work Orders)
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('invoice', 'proforma_invoice', 'quotation', 'work_order')),
    document_number TEXT NOT NULL,
    sequence_number INT NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    customer_gstin TEXT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Custom Column Headings
    col_name_description TEXT NOT NULL DEFAULT 'Description',
    col_name_quantity TEXT NOT NULL DEFAULT 'Quantity',
    col_name_unit TEXT NOT NULL DEFAULT 'Unit',
    col_name_rate TEXT NOT NULL DEFAULT 'Rate',
    col_name_amount TEXT NOT NULL DEFAULT 'Amount',
    
    -- Calculations
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_total NUMERIC NOT NULL DEFAULT 0,
    discount_total NUMERIC NOT NULL DEFAULT 0,
    total NUMERIC NOT NULL DEFAULT 0,
    advance NUMERIC NOT NULL DEFAULT 0,
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    
    -- Uniqueness constraint to prevent duplicate numbering per company
    CONSTRAINT unique_company_doc_number UNIQUE (company_id, document_number)
);

-- 5. Document Line Items
CREATE TABLE IF NOT EXISTS public.document_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    days NUMERIC NOT NULL DEFAULT 1,
    rate NUMERIC NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'nos',
    hsn_sac TEXT,
    amount NUMERIC NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0
);

-- 6. Approver Devices (Push notification registrations)
CREATE TABLE IF NOT EXISTS public.approver_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_name TEXT,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 7. Indexes on Foreign Keys for Performance
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON public.customers(company_id);
CREATE INDEX IF NOT EXISTS idx_services_company_id ON public.services(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON public.documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON public.documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_document_items_document_id ON public.document_items(document_id);

-- 8. Table Level Grants (Security-scoped for PostgREST exposure)
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.services TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.customers, public.services, public.documents, public.document_items, public.approver_devices TO authenticated;

-- =====================================================================
-- 9. Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approver_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_update ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_delete ON public.profiles;

DROP POLICY IF EXISTS customers_auth_all ON public.customers;

DROP POLICY IF EXISTS services_auth_all ON public.services;
DROP POLICY IF EXISTS services_anon_read ON public.services;

DROP POLICY IF EXISTS documents_select_public ON public.documents;
DROP POLICY IF EXISTS documents_auth_insert ON public.documents;
DROP POLICY IF EXISTS documents_auth_update ON public.documents;
DROP POLICY IF EXISTS documents_auth_delete ON public.documents;

DROP POLICY IF EXISTS document_items_select_public ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_insert ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_update ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_delete ON public.document_items;

DROP POLICY IF EXISTS approver_devices_auth_all ON public.approver_devices;

-- Profiles
CREATE POLICY profiles_select_public ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_auth_insert ON public.profiles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_update ON public.profiles FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_delete ON public.profiles FOR DELETE USING (auth.role() = 'authenticated');

-- Customers
CREATE POLICY customers_auth_all ON public.customers FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Services
CREATE POLICY services_auth_all ON public.services FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY services_anon_read ON public.services FOR SELECT TO anon USING (true);

-- Documents
CREATE POLICY documents_auth_all ON public.documents FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Document Items
CREATE POLICY document_items_auth_all ON public.document_items FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Approver Devices
CREATE POLICY approver_devices_auth_all ON public.approver_devices FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- 10. get_public_document RPC Function (SECURITY DEFINER)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_public_document(p_id uuid DEFAULT NULL, p_document_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_items jsonb;
  v_profile jsonb;
  v_normalized_num text;
BEGIN
  -- Exactly one parameter must be supplied
  IF (p_id IS NULL AND p_document_number IS NULL) OR (p_id IS NOT NULL AND p_document_number IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_id;
  ELSE
    -- Normalize document number (alphanumeric only, lowercase)
    v_normalized_num := lower(regexp_replace(p_document_number, '[^a-zA-Z0-9]', '', 'g'));
    SELECT * INTO v_doc FROM public.documents 
    WHERE lower(regexp_replace(document_number, '[^a-zA-Z0-9]', '', 'g')) = v_normalized_num
    LIMIT 1;
  END IF;

  -- Safe record assignment check (prevents unassigned record exception)
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Whitelisted items
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'document_id', document_id,
      'description', description,
      'quantity', quantity,
      'days', days,
      'rate', rate,
      'unit', unit,
      'amount', amount
    ) ORDER BY sort_order ASC, id ASC
  ) INTO v_items
  FROM public.document_items
  WHERE document_id = v_doc.id;

  -- Whitelisted profile
  SELECT jsonb_build_object(
    'id', id,
    'name', name,
    'logo_url', logo_url,
    'seal_url', seal_url,
    'gstin', gstin,
    'email', email,
    'phone', phone,
    'address', address,
    'website', website,
    'bank_name', bank_name,
    'bank_account_no', bank_account_no,
    'bank_ifsc', bank_ifsc,
    'bank_holder', bank_holder,
    'bank_branch', bank_branch,
    'default_terms', default_terms
  ) INTO v_profile
  FROM public.profiles
  WHERE id = v_doc.company_id;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id,
      'company_id', v_doc.company_id,
      'document_type', v_doc.document_type,
      'document_number', v_doc.document_number,
      'customer_name', v_doc.customer_name,
      'customer_address', v_doc.customer_address,
      'customer_gstin', v_doc.customer_gstin,
      'date', v_doc.date,
      'col_name_description', v_doc.col_name_description,
      'col_name_quantity', v_doc.col_name_quantity,
      'col_name_unit', v_doc.col_name_unit,
      'col_name_rate', v_doc.col_name_rate,
      'col_name_amount', v_doc.col_name_amount,
      'subtotal', v_doc.subtotal,
      'tax_total', v_doc.tax_total,
      'discount_total', v_doc.discount_total,
      'total', v_doc.total,
      'advance', v_doc.advance,
      'notes', v_doc.notes,
      'terms', v_doc.terms
    ),
    'items', COALESCE(v_items, '[]'::jsonb),
    'profile', COALESCE(v_profile, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_document(uuid, text) TO anon, authenticated;

-- =====================================================================
-- 11. Synthetic Staging Seed Data (Safe Test Data Only)
-- =====================================================================

DO $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Check if profile already exists
  SELECT id INTO v_company_id FROM public.profiles WHERE name = 'B2P International (Staging)' LIMIT 1;
  
  IF v_company_id IS NULL THEN
    INSERT INTO public.profiles (
      name, email, phone, address, website,
      quotation_prefix, quotation_start_number,
      invoice_prefix, invoice_start_number
    ) VALUES (
      'B2P International (Staging)', 'staging@b2pinternational.com', '+919000000000',
      'Thrissur, Kerala, India', 'https://www.b2pinternational.com',
      'QTN/', 1001,
      'INV/', 1001
    ) RETURNING id INTO v_company_id;
  END IF;

  -- Seed 3 standard synthetic test services
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = '3 Side LED Van') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, '3 Side LED Van', 'Synthetic staging service: 3-side mobile LED van display advertising', 12000, 'day', 18);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = 'LED Wall Setup') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, 'LED Wall Setup', 'Synthetic staging service: Large format event visual setup', 35000, 'event', 18);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = 'Lookwalker') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, 'Lookwalker', 'Synthetic staging service: Mobile backpack display marketing', 3000, 'day', 18);
  END IF;
END $$;

-- 12. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';



-- =====================================================================
-- START OF: 20260823000001_phase4_1_core_accounting.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.1 CORE ACCOUNTING ENGINE MIGRATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- REMEDIATION (2026-08-24, follow-up pass): account_groups.id,
-- account_heads.id and financial_period_locks.id (and every column that
-- references them) were originally UUID. financeService.ts's built-in
-- standard chart of accounts and the single pre-seeded FY 2025-26 period
-- lock are compile-time constants with deliberately human-readable ids
-- ('ah-1001', 'ag-1', 'lock-1', ...) - dozens of call sites across
-- financeService.ts match against these literal ids directly (e.g. the
-- Retained Earnings transfer in performYearEndClosing always targets
-- 'ah-3002'). Renaming every one of those references to real UUIDs to
-- satisfy the column type, across a file this size, would trade a
-- schema nicety for real regression risk. Widening these three id
-- columns (and their FK columns below) from UUID to TEXT costs nothing -
-- a TEXT column accepts crypto.randomUUID() output exactly as before for
-- every row created through the app's own save flows - and makes the
-- column actually match what the application layer has always treated
-- `id` as (`id: string` in types.ts, never a strict UUID). Without this,
-- the very first cloud-mode edit/deactivate/toggle of any seeded default
-- account or the seeded period lock would fail outright with a Postgres
-- "invalid input syntax for type uuid" error.
-- =====================================================================

-- 1. Account Groups
CREATE TABLE IF NOT EXISTS account_groups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  code TEXT NOT NULL,
  parent_group_id TEXT REFERENCES account_groups(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Account Heads (Chart of Accounts)
CREATE TABLE IF NOT EXISTS account_heads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  group_id TEXT REFERENCES account_groups(id) ON DELETE RESTRICT,
  group_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  nature TEXT NOT NULL DEFAULT 'debit' CHECK (nature IN ('debit', 'credit')),
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  opening_balance_date DATE DEFAULT CURRENT_DATE,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  gst_applicable BOOLEAN DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_account_code_per_company UNIQUE (company_id, code)
);

-- 3. Journal Entries (Vouchers Header)
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  voucher_number TEXT NOT NULL,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN (
    'journal', 'payment', 'receipt', 'contra', 'expense', 
    'sales', 'purchase', 'credit_note', 'debit_note', 'reversal'
  )),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  narration TEXT NOT NULL,
  total_debit NUMERIC NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit NUMERIC NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  reference_type TEXT,
  reference_id UUID,
  reference_number TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  financial_year TEXT NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  created_by_email TEXT NOT NULL,
  posted_by_email TEXT,
  posted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_voucher_per_company UNIQUE (company_id, voucher_number)
);

-- 4. Journal Lines (Vouchers Detail)
CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  debit NUMERIC NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC NOT NULL DEFAULT 0 CHECK (credit >= 0),
  narration TEXT,
  CONSTRAINT check_not_both_debit_and_credit CHECK (NOT (debit > 0 AND credit > 0))
);

-- 5. Financial Period Locks
CREATE TABLE IF NOT EXISTS financial_period_locks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  period_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMP WITH TIME ZONE,
  locked_by_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 6. Financial Audit Logs
CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  user_email TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);

-- =====================================================================
-- Row Level Security (RLS) Policies
--
-- REMEDIATION NOTE (audit follow-up, 2026-08-24): the original draft of
-- this file scoped every policy to `company_id IN (SELECT id FROM
-- profiles WHERE user_id = auth.uid())` - i.e. only the single auth user
-- who happens to be the *creator* of a given company profile could ever
-- see that company's finance data. That directly contradicts this app's
-- actual, documented architecture (see PROJECT_DOCUMENTATION.md section
-- 7 and db.ts's own policies): B2P International is a single
-- organization where every authenticated staff member is intended to
-- share access to every company profile's data - `profiles`,
-- `customers`, `services`, and `documents` are all already
-- `auth.role() = 'authenticated'` with no per-row ownership check.
-- Finance is scoped the same way here for consistency: any authenticated
-- staff member can manage any company's books, matching the rest of the
-- app. (Genuine multi-tenant, per-owner isolation between UNRELATED
-- organizations is explicitly flagged as future work in
-- PROJECT_DOCUMENTATION.md and is out of scope for this pass.)
--
-- Also switched from a single combined `FOR ALL` policy to the same
-- named per-operation shape used elsewhere in this schema so future
-- auditing/diffing is consistent.
-- =====================================================================

ALTER TABLE account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_groups_auth_all" ON account_groups
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "account_heads_auth_all" ON account_heads
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "journal_entries_auth_all" ON journal_entries
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "journal_lines_auth_all" ON journal_lines
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "period_locks_auth_all" ON financial_period_locks
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "audit_logs_auth_all" ON financial_audit_logs
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Indexes (foreign keys have none by default in Postgres; flagged as a
-- deferred item in PROJECT_DOCUMENTATION.md section 7 - added here for
-- every new finance table since it's zero-risk and cheap while young).
CREATE INDEX IF NOT EXISTS idx_account_groups_company ON account_groups(company_id);
CREATE INDEX IF NOT EXISTS idx_account_heads_company ON account_heads(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company ON journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_period_locks_company ON financial_period_locks(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON financial_audit_logs(company_id);



-- =====================================================================
-- START OF: 20260823000002_phase4_2_authoritative_gst_engine.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.2 AUTHORITATIVE GST ENGINE MIGRATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
-- =====================================================================

-- 1. GST Compliance & Tax Rules Master
CREATE TABLE IF NOT EXISTS gst_tax_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  hsn_sac TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  gst_rate NUMERIC NOT NULL CHECK (gst_rate >= 0),
  cess_rate NUMERIC DEFAULT 0 CHECK (cess_rate >= 0),
  effective_from DATE NOT NULL DEFAULT '2017-07-01',
  effective_to DATE,
  version TEXT NOT NULL DEFAULT '1.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_gst_rule_per_company UNIQUE (company_id, rule_code)
);

-- 2. GSTR Return Summary Filings & Workspaces
CREATE TABLE IF NOT EXISTS gstr_return_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  return_type TEXT NOT NULL CHECK (return_type IN ('GSTR-1', 'GSTR-3B', 'GSTR-2B', 'GSTR-9')),
  financial_year TEXT NOT NULL,
  period TEXT NOT NULL, -- e.g. '04-2026'
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'ready_for_filing', 'filed')),
  taxable_total NUMERIC NOT NULL DEFAULT 0,
  cgst_total NUMERIC NOT NULL DEFAULT 0,
  sgst_total NUMERIC NOT NULL DEFAULT 0,
  igst_total NUMERIC NOT NULL DEFAULT 0,
  cess_total NUMERIC NOT NULL DEFAULT 0,
  total_tax NUMERIC NOT NULL DEFAULT 0,
  summary_payload JSONB,
  validation_errors TEXT[],
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_return_period_per_company UNIQUE (company_id, return_type, financial_year, period)
);

-- 3. GSTR-2B Purchase Reconciliation Items
CREATE TABLE IF NOT EXISTS gstr2b_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  supplier_gstin TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  invoice_value NUMERIC NOT NULL DEFAULT 0,
  taxable_value NUMERIC NOT NULL DEFAULT 0,
  igst NUMERIC NOT NULL DEFAULT 0,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,
  cess NUMERIC NOT NULL DEFAULT 0,
  source_in_books BOOLEAN NOT NULL DEFAULT FALSE,
  source_in_gstr2b BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_status TEXT NOT NULL DEFAULT 'MATCHED' CHECK (
    reconciliation_status IN ('MATCHED', 'MISMATCH_TAX', 'MISMATCH_GSTIN', 'MISSING_IN_2B', 'MISSING_IN_BOOKS')
  ),
  is_eligible_itc BOOLEAN NOT NULL DEFAULT TRUE,
  matched_purchase_id UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- REMEDIATION NOTE (2026-08-24): aligned to the shared-staff,
-- `auth.role() = 'authenticated'` model used throughout this schema -
-- see the note in 20260823000001_phase4_1_core_accounting.sql.
-- =====================================================================

ALTER TABLE gst_tax_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gstr_return_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE gstr2b_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_rules_auth_all" ON gst_tax_rules
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "gstr_workspaces_auth_all" ON gstr_return_workspaces
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "gstr2b_reconciliation_auth_all" ON gstr2b_reconciliation_items
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_gst_tax_rules_company ON gst_tax_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_gstr_workspaces_company ON gstr_return_workspaces(company_id);
CREATE INDEX IF NOT EXISTS idx_gstr2b_recon_company ON gstr2b_reconciliation_items(company_id);



-- =====================================================================
-- START OF: 20260823000003_phase4_3_purchases_and_payables.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.3 PURCHASES, SUPPLIERS & ACCOUNTS PAYABLE
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
-- =====================================================================

-- 1. Suppliers / Vendors Master Table
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  company_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  billing_address TEXT,
  gstin TEXT,
  pan TEXT,
  state TEXT NOT NULL DEFAULT 'Kerala',
  state_code TEXT NOT NULL DEFAULT '32',
  place_of_supply TEXT NOT NULL DEFAULT 'Kerala',
  payment_terms TEXT DEFAULT '30 Days Net',
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_supplier_name_per_company UNIQUE (company_id, name)
);

-- 2. Purchase Bills Header Table
CREATE TABLE IF NOT EXISTS purchase_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_number TEXT NOT NULL, -- e.g. BILL-2026-0001
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name TEXT NOT NULL,
  supplier_company TEXT,
  supplier_gstin TEXT,
  supplier_invoice_number TEXT NOT NULL,
  supplier_invoice_date DATE,
  purchase_date DATE NOT NULL,
  due_date DATE NOT NULL,
  place_of_supply TEXT NOT NULL DEFAULT 'Kerala',
  payment_terms TEXT DEFAULT '30 Days Net',
  taxable_value NUMERIC NOT NULL DEFAULT 0,
  total_cgst NUMERIC NOT NULL DEFAULT 0,
  total_sgst NUMERIC NOT NULL DEFAULT 0,
  total_igst NUMERIC NOT NULL DEFAULT 0,
  total_cess NUMERIC NOT NULL DEFAULT 0,
  total_gst NUMERIC NOT NULL DEFAULT 0,
  round_off NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  balance_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'posted', 'recorded', 'partially_paid', 'paid', 'overdue', 'cancelled')
  ),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_purchase_number_per_company UNIQUE (company_id, purchase_number),
  CONSTRAINT unique_supplier_bill_per_company UNIQUE (company_id, supplier_id, supplier_invoice_number)
);

-- 3. Purchase Bill Line Items Table
CREATE TABLE IF NOT EXISTS purchase_bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT, -- REMEDIATION (2026-08-24): was chart_of_accounts, a table that is never created anywhere; account_heads is Phase 4.1's actual chart-of-accounts table. Widened UUID->TEXT in the follow-up pass (see the note in phase4_1) to match account_heads.id.
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  description TEXT NOT NULL,
  hsn_sac TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'units',
  rate NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  taxable_amount NUMERIC NOT NULL DEFAULT 0,
  gst_percentage NUMERIC NOT NULL DEFAULT 18,
  cgst NUMERIC NOT NULL DEFAULT 0,
  sgst NUMERIC NOT NULL DEFAULT 0,
  igst NUMERIC NOT NULL DEFAULT 0,
  cess NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. Supplier Payments Table
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  payment_number TEXT NOT NULL, -- e.g. VPY-2026-0001
  purchase_id UUID REFERENCES purchase_bills(id) ON DELETE SET NULL,
  purchase_number TEXT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name TEXT NOT NULL,
  payment_date DATE NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL CHECK (
    payment_mode IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')
  ),
  reference_number TEXT,
  bank_cash_account TEXT NOT NULL,
  bank_cash_account_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT, -- REMEDIATION (2026-08-24): was chart_of_accounts (never created); account_heads is the real table. Widened UUID->TEXT in the follow-up pass (see the note in phase4_1) to match account_heads.id.
  is_advance BOOLEAN NOT NULL DEFAULT FALSE,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_payment_number_per_company UNIQUE (company_id, payment_number)
);

-- 5. Supplier Payment Allocations (for multi-bill disbursements)
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE RESTRICT,
  purchase_number TEXT NOT NULL,
  supplier_invoice_number TEXT NOT NULL,
  allocated_amount NUMERIC NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Indexes
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_suppliers_company_id ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_gstin ON suppliers(gstin);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_company_id ON purchase_bills(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier_id ON purchase_bills(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_status ON purchase_bills(status);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_due_date ON purchase_bills(due_date);
CREATE INDEX IF NOT EXISTS idx_purchase_bill_items_purchase_id ON purchase_bill_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_id ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON supplier_payments(supplier_id);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- REMEDIATION NOTE (2026-08-24): aligned to the shared-staff,
-- `auth.role() = 'authenticated'` model used throughout this schema -
-- see the note in 20260823000001_phase4_1_core_accounting.sql.
-- =====================================================================

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_auth_all" ON suppliers
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "purchase_bills_auth_all" ON purchase_bills
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "purchase_bill_items_auth_all" ON purchase_bill_items
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "supplier_payments_auth_all" ON supplier_payments
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "supplier_payment_allocations_auth_all" ON supplier_payment_allocations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');



-- =====================================================================
-- START OF: 20260823000004_phase4_4_customer_receipts_and_sales_accounting.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.4 SALES ACCOUNTING & CUSTOMER RECEIPTS
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
-- =====================================================================

-- 1. Customer Receipts Table (Payments Received)
CREATE TABLE IF NOT EXISTS customer_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  payment_number TEXT NOT NULL, -- e.g. RCPT-2026-0001
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  document_number TEXT,
  payment_date DATE NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_mode TEXT NOT NULL CHECK (
    payment_mode IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')
  ),
  reference_number TEXT,
  bank_cash_account TEXT NOT NULL,
  bank_cash_account_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT, -- REMEDIATION (2026-08-24): was chart_of_accounts (never created); account_heads is the real table. Widened UUID->TEXT in the follow-up pass (see the note in phase4_1) to match account_heads.id.
  is_advance BOOLEAN NOT NULL DEFAULT FALSE,
  advance_amount NUMERIC NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_customer_receipt_number_per_company UNIQUE (company_id, payment_number)
);

-- 2. Customer Receipt Allocations (Multi-Invoice Settlement)
CREATE TABLE IF NOT EXISTS customer_receipt_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES customer_receipts(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_number TEXT NOT NULL,
  allocated_amount NUMERIC NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customer_receipts_company ON customer_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_receipts_customer ON customer_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_receipts_date ON customer_receipts(payment_date);
CREATE INDEX IF NOT EXISTS idx_customer_receipt_allocations_receipt ON customer_receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_customer_receipt_allocations_doc ON customer_receipt_allocations(document_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_receipt_allocations ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- REMEDIATION NOTE (2026-08-24): aligned to the shared-staff,
-- `auth.role() = 'authenticated'` model used throughout this schema -
-- see the note in 20260823000001_phase4_1_core_accounting.sql (the
-- original per-`profiles.user_id`-owner policy here would have blocked
-- every staff member except whichever one happened to create the
-- company profile row).
CREATE POLICY "customer_receipts_auth_all"
  ON customer_receipts
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "customer_receipt_allocations_auth_all"
  ON customer_receipt_allocations
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');



-- =====================================================================
-- START OF: 20260823000005_phase4_5_banking_and_reconciliation.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.5 BANKING & BANK RECONCILIATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- REMEDIATION NOTE (2026-08-24): this phase originally shipped as TWO
-- conflicting files sharing the same 20260823000005 timestamp prefix:
--   - 20260823000005_phase4_5_banking_and_reconciliation.sql
--   - 20260823000005_phase4_5_banking_cash_and_reconciliation.sql
-- They diverged on real schema decisions (account_head_id FK target,
-- company_id FK target, RLS policy shape) and applying both was
-- filename-order-dependent. This file is the single canonical result of
-- merging them: table/column set from the "_cash_and_reconciliation"
-- variant (richer - is_active, more account_type options, a dedicated
-- bank_reconciliation_items child table), with two corrections:
--   1. company_id now references profiles(id), the table that actually
--      exists (the merged-away variant referenced a non-existent
--      public.companies table, which would have failed on apply).
--   2. RLS uses the same auth.role() = 'authenticated' shared-staff
--      model as every other table in this schema, not the
--      current_setting('app.current_company_id') session-variable
--      pattern (which the Supabase JS client this app uses never sets,
--      so those policies would have silently denied every request).
-- The other "_cash_and_reconciliation" file has been deleted - nothing
-- in the app ever referenced these migration files directly (they are
-- consumed only by Supabase itself), so removing the duplicate is safe.
-- =====================================================================

-- 1. Bank Accounts Table
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  account_head_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT, -- REMEDIATION (2026-08-24, follow-up pass): widened UUID->TEXT to match account_heads.id (see the note in phase4_1).
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc_code TEXT,
  branch TEXT,
  account_type TEXT NOT NULL DEFAULT 'current' CHECK (account_type IN ('current', 'savings', 'cash', 'overdraft')),
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_account_number_per_company UNIQUE (company_id, account_number)
);

-- 2. Bank Reconciliation Statements Table
CREATE TABLE IF NOT EXISTS bank_reconciliation_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  bank_account_name TEXT NOT NULL,
  as_of_date DATE NOT NULL,
  statement_balance NUMERIC NOT NULL DEFAULT 0,
  book_balance NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  cleared_balance NUMERIC NOT NULL DEFAULT 0,
  unreconciled_balance NUMERIC NOT NULL DEFAULT 0,
  reconciled_by_email TEXT NOT NULL,
  reconciled_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Bank Reconciliation Items Table (individual statement lines matched/cleared/exception)
CREATE TABLE IF NOT EXISTS bank_reconciliation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id UUID REFERENCES bank_reconciliation_statements(id) ON DELETE CASCADE,
  statement_date DATE NOT NULL,
  reference_number TEXT,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  matched_voucher_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  matched_voucher_number TEXT,
  status TEXT NOT NULL DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'matched', 'cleared', 'exception')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliation_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_accounts_auth_all" ON bank_accounts
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "bank_recon_statements_auth_all" ON bank_reconciliation_statements
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "bank_recon_items_auth_all" ON bank_reconciliation_items
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_statements_company_date ON bank_reconciliation_statements(company_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_bank_recon_items_statement ON bank_reconciliation_items(statement_id);



-- =====================================================================
-- START OF: 20260823000006_phase4_6_financial_statements_and_year_end_closing.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.6 FINANCIAL STATEMENTS & YEAR-END CLOSING
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- REMEDIATION NOTE (2026-08-24): this phase originally shipped as TWO
-- conflicting files sharing the same 20260823000006 timestamp prefix:
--   - 20260823000006_phase4_6_financial_statements_and_year_end_closing.sql
--   - 20260823000006_phase4_6_financial_statements_and_yearend.sql
-- This file is the single canonical merge: financial_year_closures
-- keeps its original name/shape (matches financeService.ts's existing
-- YEAR_END_CLOSURES data shape) with `chart_of_accounts` corrected to
-- `account_heads` (the table that actually exists) and a
-- `trial_balance_total` column pulled in from the merged-away variant;
-- financial_statement_snapshots is pulled in from the merged-away
-- variant too (company_id corrected from the non-existent
-- public.companies to profiles(id)). RLS uses the same
-- auth.role() = 'authenticated' shared-staff model as every other table
-- in this schema rather than either the per-profile-owner or the
-- current_setting()-based session-variable pattern the two originals
-- used (see the note in 20260823000001_phase4_1_core_accounting.sql).
-- The other "_yearend" file has been deleted - nothing in the app ever
-- referenced these migration files directly, so removing the duplicate
-- is safe.
-- =====================================================================

-- 1. Financial Year Closures Table
CREATE TABLE IF NOT EXISTS financial_year_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  next_financial_year TEXT,
  closing_date DATE NOT NULL,
  closing_journal_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  closing_voucher_number TEXT NOT NULL,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  total_expenses NUMERIC NOT NULL DEFAULT 0,
  net_profit_transferred NUMERIC NOT NULL DEFAULT 0,
  trial_balance_total NUMERIC NOT NULL DEFAULT 0,
  retained_earnings_head_id TEXT REFERENCES account_heads(id), -- REMEDIATION (2026-08-24, follow-up pass): widened UUID->TEXT to match account_heads.id (see the note in phase4_1).
  closed_by_email TEXT NOT NULL,
  closed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_closure_per_fy_company UNIQUE (company_id, financial_year)
);

-- 2. Financial Statements Archive Table (point-in-time snapshots for audit trail)
CREATE TABLE IF NOT EXISTS financial_statement_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year TEXT NOT NULL,
  statement_type TEXT NOT NULL CHECK (statement_type IN ('trial_balance', 'profit_and_loss', 'balance_sheet', 'cash_flow')),
  as_of_date DATE NOT NULL,
  data JSONB NOT NULL,
  is_audited BOOLEAN NOT NULL DEFAULT FALSE,
  archived_by_email TEXT NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE financial_year_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_statement_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "financial_year_closures_auth_all" ON financial_year_closures
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "financial_statement_snapshots_auth_all" ON financial_statement_snapshots
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_fy_closures_company ON financial_year_closures(company_id);
CREATE INDEX IF NOT EXISTS idx_fy_closures_fy ON financial_year_closures(financial_year);
CREATE INDEX IF NOT EXISTS idx_stmt_snapshots_company_fy ON financial_statement_snapshots(company_id, financial_year, statement_type);



-- =====================================================================
-- START OF: 20260823000007_phase4_7_remediation_schema_fixes.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.7 — REMEDIATION SCHEMA FIXES
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Follow-up to the 2026-08-24 finance audit remediation. Three gaps
-- found while wiring financeService.ts to Supabase as the authoritative
-- persistence layer (P0.1 of the remediation plan):
--
-- 1. `expenses` was never created by ANY Phase 4 migration at all, even
--    though Expenses.tsx/ExpenseModal.tsx/financeService.ts have managed
--    expense records (in localStorage) since Phase 4 shipped. Added
--    here, plus reversal-tracking columns (see #3).
-- 2. `purchase_bills` and `journal_entries` need to carry their line
--    items / journal lines. Phase 4.1/4.3 also modeled these
--    relationally (`journal_lines`, `purchase_bill_items` child
--    tables), but embedding them as JSONB on the parent row matches the
--    shape financeService.ts's Purchase/JournalEntry types already use
--    (`items: PurchaseItem[]`, `lines: JournalLineItem[]`) and avoids
--    introducing multi-statement transactional writes across two tables
--    through the Supabase JS client (which has no local Postgres/branch
--    available in this environment to verify against). The child tables
--    are left in place, unused for now, rather than dropped - a future
--    pass can migrate to them once there's a way to verify multi-table
--    writes end-to-end.
-- 3. Expenses previously had no way to preserve a posted expense's audit
--    trail on "deletion" - deleteExpense() unconditionally erased the
--    row. Per the remediation plan (P1 item 10), posted expenses are
--    now reversed (a balancing reversing journal entry posted, the
--    original row kept and flagged) rather than deleted. These columns
--    record that.
-- =====================================================================

-- 1. Expenses Table (previously existed only in localStorage, never in Supabase)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  gst_amount NUMERIC NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')),
  reference_number TEXT,
  bank_cash_account TEXT,
  bank_cash_account_id TEXT REFERENCES account_heads(id) ON DELETE RESTRICT, -- REMEDIATION (2026-08-24, follow-up pass): widened UUID->TEXT to match account_heads.id (see the note in phase4_1).
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at TIMESTAMP WITH TIME ZONE,
  reversed_by_email TEXT,
  reversal_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversal_reason TEXT,
  notes TEXT,
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_auth_all" ON expenses
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_expenses_company ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(company_id, expense_date);

-- 2. Embedded line-item / journal-line / allocation JSONB columns (see
--    note #2 above). customer_receipts.allocations and
--    supplier_payments.allocations get the same treatment as
--    purchase_bills.items and journal_entries.lines, for the same
--    reason - their dedicated child tables (customer_receipt_allocations,
--    supplier_payment_allocations) are left in place, unused for now.
ALTER TABLE purchase_bills ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS lines JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE customer_receipts ADD COLUMN IF NOT EXISTS allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS allocations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Reversal-tracking columns are on `expenses` already (see above);
--    supplier_payments/customer_receipts already support reversal via
--    their existing journal_entry_id + createReversingJournalEntry().



-- =====================================================================
-- START OF: 20260823000008_phase4_8_followup_remediation.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 4.8 — FOLLOW-UP REMEDIATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Second remediation pass (2026-08-24, same day as Phase 4.7). None of
-- phase4_1 through phase4_7 have ever been applied anywhere, so the
-- id/FK type corrections described below were made IN PLACE in
-- 20260823000001_phase4_1_core_accounting.sql (and the downstream FK
-- columns in phase4_3/4_4/4_5/4_6/4_7) rather than layered on top as an
-- ALTER COLUMN here - see the comment block at the top of phase4_1 for
-- the full explanation. This file only adds what genuinely needs to be
-- additive: a column that didn't exist before.
--
-- 1. bank_reconciliation_statements previously had no column to hold
--    its line items - financeService.ts's BankReconciliationStatement
--    type already carries `items: BankReconciliationItem[]`, and this
--    was the one Phase 4.5 entity never wired to Supabase in the first
--    remediation pass (saveBankReconciliationStatement() was
--    localStorage-only). It's now wired the same way, and follows the
--    same embedded-JSONB precedent already used for
--    purchase_bills.items / journal_entries.lines (see the note in
--    phase4_7) rather than writing through the separate
--    bank_reconciliation_items child table.
-- =====================================================================

ALTER TABLE bank_reconciliation_statements ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;



-- =====================================================================
-- START OF: 20260824000001_phase5_unified_quotations.sql
-- =====================================================================

-- 20260824000001_phase5_unified_quotations.sql

-- 1. Create resources table
CREATE TABLE IF NOT EXISTS public.resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL, -- Ensure compatibility
    name TEXT NOT NULL,       -- e.g., "3 Side LED Van - Van 01"
    category TEXT NOT NULL,   -- e.g., "LED_VAN"
    specs JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY resources_auth_all ON public.resources FOR ALL TO authenticated USING (true);
-- Restricted catalog retrieval for the frontend instead of full table access.

-- 2. Create bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('HOLD', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_auth_all ON public.bookings FOR ALL TO authenticated USING (true);

-- 3. Modify documents
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual_staff';

-- 4. Secure Read-Only RPC for frontend resource listing
CREATE OR REPLACE FUNCTION public.get_public_catalog()
RETURNS TABLE (
    service_id UUID,
    service_name TEXT,
    resource_id UUID,
    resource_name TEXT,
    default_rate NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.name, r.id, r.name, s.default_rate
    FROM public.services s
    JOIN public.resources r ON r.service_id = s.id
    WHERE s.company_id = (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1);
END;
$$;

-- 5. The core RPC
CREATE OR REPLACE FUNCTION public.request_automated_quotation(
    p_customer_name TEXT,
    p_customer_email TEXT,
    p_customer_phone TEXT,
    p_resource_id UUID,
    p_service_id UUID,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_notes TEXT
) RETURNS UUID 
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
    v_email TEXT;
    v_phone TEXT;
    v_customer_id UUID;
    v_service_rate NUMERIC;
    v_service_name TEXT;
    v_gst_percentage NUMERIC;
    v_hsn_sac TEXT;
    v_unit TEXT;
    v_seq_num INT;
    v_prefix TEXT;
    v_doc_number TEXT;
    v_doc_id UUID;
    v_subtotal NUMERIC;
    v_tax_total NUMERIC;
    v_total NUMERIC;
    v_mapped_service_id UUID;
BEGIN
    -- Resolve company
    SELECT id INTO v_company_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;

    -- Validate Resource <-> Service Compatibility
    SELECT service_id INTO v_mapped_service_id FROM public.resources WHERE id = p_resource_id;
    IF v_mapped_service_id IS NULL OR v_mapped_service_id != p_service_id THEN
        RAISE EXCEPTION 'Resource is not compatible with the requested service.';
    END IF;

    -- Concurrency Protection for Resource (Prevents Overlap Race Conditions)
    PERFORM id FROM public.resources WHERE id = p_resource_id FOR UPDATE;

    -- Overlap Check
    IF EXISTS (
        SELECT 1 FROM public.bookings
        WHERE resource_id = p_resource_id
        AND status IN ('HOLD', 'CONFIRMED')
        AND (start_time < p_end_time AND end_time > p_start_time)
        AND (status = 'CONFIRMED' OR created_at >= NOW() - INTERVAL '24 hours')
    ) THEN
        RAISE EXCEPTION 'Resource is unavailable for the selected time.';
    END IF;

    -- Pricing Resolution
    SELECT default_rate, name, gst_percentage, hsn_sac, unit
    INTO v_service_rate, v_service_name, v_gst_percentage, v_hsn_sac, v_unit
    FROM public.services 
    WHERE id = p_service_id AND company_id = v_company_id;

    IF v_service_rate IS NULL THEN
        RAISE EXCEPTION 'Invalid service.';
    END IF;

    -- Customer Matching (Normalized)
    v_email := LOWER(TRIM(COALESCE(p_customer_email, '')));
    v_phone := REGEXP_REPLACE(COALESCE(p_customer_phone, ''), '\D', '', 'g');
    
    SELECT id INTO v_customer_id FROM public.customers 
    WHERE company_id = v_company_id 
    AND ( (email = v_email AND v_email <> '') OR (phone = v_phone AND v_phone <> '') )
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (company_id, name, email, phone)
        VALUES (v_company_id, TRIM(p_customer_name), v_email, v_phone)
        RETURNING id INTO v_customer_id;
    END IF;

    -- Safe Sequence Generation (Handles Concurrency Loop)
    SELECT COALESCE(quotation_prefix, 'QT/'), COALESCE(quotation_start_number, 1001)
    INTO v_prefix, v_seq_num
    FROM public.profiles WHERE id = v_company_id;

    <<seq_loop>>
    LOOP
        SELECT COALESCE(MAX(sequence_number), v_seq_num - 1) + 1 INTO v_seq_num
        FROM public.documents
        WHERE company_id = v_company_id AND document_type = 'quotation';
        
        v_doc_number := v_prefix || v_seq_num;
        
        BEGIN
            v_subtotal := v_service_rate * 1; 
            v_tax_total := v_subtotal * (v_gst_percentage / 100.0);
            v_total := v_subtotal + v_tax_total;

            INSERT INTO public.documents (
                company_id, document_type, document_number, sequence_number,
                customer_id, customer_name, customer_email, customer_phone,
                date, subtotal, tax_total, total, source, notes
            ) VALUES (
                v_company_id, 'quotation', v_doc_number, v_seq_num,
                v_customer_id, TRIM(p_customer_name), v_email, v_phone,
                CURRENT_DATE, v_subtotal, v_tax_total, v_total, 'website_auto', p_notes
            ) RETURNING id INTO v_doc_id;

            EXIT seq_loop; -- Success! Break out of the loop.
        EXCEPTION WHEN unique_violation THEN
            -- Another transaction grabbed this sequence number first! 
            -- The loop will repeat and calculate the next max sequence_number safely.
        END;
    END LOOP;

    -- Insert Items & Booking
    INSERT INTO public.document_items (document_id, service_id, description, quantity, rate, amount, hsn_sac, unit)
    VALUES (v_doc_id, p_service_id, v_service_name, 1, v_service_rate, v_subtotal, v_hsn_sac, v_unit);

    INSERT INTO public.bookings (company_id, document_id, resource_id, start_time, end_time, status)
    VALUES (v_company_id, v_doc_id, p_resource_id, p_start_time, p_end_time, 'HOLD');

    RETURN v_doc_id;
END;
$$;



-- =====================================================================
-- START OF: 20260824000002_minimum_permissions_fix.sql
-- =====================================================================

-- =====================================================================
-- 20260824000002_minimum_permissions_fix.sql
-- Minimal Hardened Grants for Isolated Staging (xkgytoygtzmsszaogwxi)
--
-- REMEDIATION (2026-08-24, full-project audit pass): originally shared
-- the identical 20260824000000 timestamp prefix with
-- base_document_generator_schema.sql - the exact same
-- filename-order-dependent hazard already found and fixed once in this
-- repo for the phase4.5/4.6 pair (see the note in phase4_5). This file's
-- GRANT EXECUTE on public.get_public_document (below) requires that
-- function to already exist, and base_document_generator_schema.sql is
-- what creates it - applying this file first would fail outright.
-- Renumbered to a strictly later timestamp so the dependency is
-- explicit and no longer relies on "base" happening to sort before
-- "minimum" alphabetically. Also worth noting: base_document_generator_
-- schema.sql already grants EXECUTE on this same function itself (see
-- its own final GRANT statement) - the GRANT below is a harmless
-- no-op re-grant, not a conflict, kept as-is since re-running GRANT is
-- idempotent in Postgres.
-- =====================================================================

-- 1. Schema USAGE
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Anonymous Access: SELECT only on profiles and services (public branding & catalog)
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.services TO anon;

-- Explicitly revoke direct anon access on private/sensitive tables
REVOKE ALL ON public.customers FROM anon;
REVOKE ALL ON public.documents FROM anon;
REVOKE ALL ON public.document_items FROM anon;
REVOKE ALL ON public.approver_devices FROM anon;

-- 3. Authenticated Access: Full app access governed by RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.customers, public.services, public.documents, public.document_items, public.approver_devices TO authenticated;

-- 4. RPC Execution: Allow get_public_document (SECURITY DEFINER handles document read)
GRANT EXECUTE ON FUNCTION public.get_public_document(uuid, text) TO anon, authenticated;

-- 5. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';



-- =====================================================================
-- START OF: 20260824000003_phase6_crm_leads_followups_quotations.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 6 — CRM CLOUD PERSISTENCE
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Full-project audit follow-up (2026-08-24, third pass). Until now,
-- leadService.ts and officeService.ts (leads, lead activities,
-- follow-ups, the CRM quotation-approval workflow, and the internal
-- booking calendar) were 100% localStorage - every browser/device had
-- its own independent CRM with no sync, unlike documents/customers/
-- finance which are already Supabase-backed. This migration adds the
-- missing tables, following the exact same conventions already
-- established across the Phase 4 finance migrations:
--   - company_id REFERENCES profiles(id), never a non-existent
--     "companies" table.
--   - RLS: auth.role() = 'authenticated' shared-staff model, matching
--     every other table in this schema (see the note in
--     20260823000001_phase4_1_core_accounting.sql for why - this is a
--     single organization with shared staff access, not multi-tenant).
--   - Line items / approval fields embedded as JSONB where a child
--     table would need an unverified multi-statement transaction
--     through the Supabase JS client (crm_quotations.items), matching
--     the precedent in phase4_7/phase4_8.
--   - All new primary keys are genuine UUID - unlike the finance
--     module's hardcoded default chart of accounts, nothing here ships
--     as a compile-time seed with a human-readable id, so there is no
--     UUID/TEXT mismatch risk to widen against (see the note in
--     phase4_1 for that specific, unrelated defect).
--
-- WhatsApp conversations/messages (Phase 6 as originally labelled in
-- types.ts) and the Notification Center (Phase 7) are deliberately NOT
-- included here. WhatsAppInbox.tsx is an explicitly local/simulated
-- conversation log (see its own `handleSendSimulatedAttachment` name),
-- not a real WhatsApp Business API integration - cloud-syncing a
-- simulated inbox would not make it a real integration and was judged
-- not worth the added risk/complexity in this pass. Notifications are
-- inherently per-device/ephemeral (browser notification center); kept
-- local-only.
-- =====================================================================

-- 1. Leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  whatsapp_number TEXT,
  address TEXT,
  location TEXT,
  business_type TEXT,
  lead_source TEXT NOT NULL DEFAULT 'other',
  source_details TEXT,
  service_required TEXT,
  vehicle_service_type TEXT,
  required_date DATE,
  campaign_location TEXT,
  number_of_days INT,
  priority TEXT NOT NULL DEFAULT 'WARM',
  assigned_telecaller_email TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  next_follow_up_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_lead_number_per_company UNIQUE (company_id, lead_number)
);

-- 2. Lead Activities (audit trail of status transitions / notes)
CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Follow-ups
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  assigned_staff_email TEXT NOT NULL,
  due_date DATE NOT NULL,
  due_time TEXT NOT NULL DEFAULT '10:00',
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'SNOOZED', 'CANCELLED', 'OVERDUE')),
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_note TEXT,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  next_follow_up_id UUID
);

-- 4. CRM Quotation Approval Workflow (pre-Document staging/approval -
--    distinct in purpose from the real `documents` table: this is the
--    Admin-drafts / Owner-approves step BEFORE a formal quotation
--    Document is generated, not a duplicate of Document itself).
CREATE TABLE IF NOT EXISTS crm_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT NOT NULL,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  service_required TEXT NOT NULL,
  vehicle_service_type TEXT,
  campaign_location TEXT NOT NULL,
  required_date DATE NOT NULL,
  number_of_days INT NOT NULL DEFAULT 1,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  terms TEXT,
  approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'REVISED')),
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  approved_by_email TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  owner_remarks TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_by_email TEXT,
  CONSTRAINT unique_crm_quotation_number_per_company UNIQUE (company_id, quotation_number)
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_auth_all" ON leads
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "lead_activities_auth_all" ON lead_activities
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "follow_ups_auth_all" ON follow_ups
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "crm_quotations_auth_all" ON crm_quotations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(company_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_company ON lead_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_company ON follow_ups(company_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_quotations_company ON crm_quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_quotations_lead ON crm_quotations(lead_id);

-- =====================================================================
-- 5. Booking Calendar cloud-completion: the real `resources`/`bookings`
--    tables already existed (20260824000001_phase5_unified_quotations.sql)
--    but were built ONLY for the public-website automated-quotation RPC
--    - the internal staff BookingCalendar.tsx UI read from a completely
--    separate, disconnected local officeService store instead, so a
--    website-originated booking hold was invisible to staff and vice
--    versa. Additive-only ALTERs below let BOTH paths share one real
--    table without touching the existing RPC (which only ever sets the
--    original columns - the new ones are nullable and simply blank for
--    RPC-created rows unless/until the internal UI enriches them).
-- =====================================================================

-- 5a. resources.id was UUID but is a UUID-generated table already (no
--     compile-time hardcoded ids reference it outside this project's
--     own SEED_RESOURCES fleet-inventory defaults, which - like the
--     finance module's default chart of accounts - use human-readable
--     ids ('res-van-1', etc). Widened to TEXT for the same reason
--     account_heads/account_groups were (see phase4_1's note) so those
--     defaults can be synced without an id-type mismatch.
ALTER TABLE public.resources ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.resources ALTER COLUMN id TYPE TEXT;
ALTER TABLE public.resources ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.bookings ALTER COLUMN resource_id TYPE TEXT;

-- 5a-2. The internal calendar books whole days via start_date/end_date
--       (added below), not the RPC's precise start_time/end_time - both
--       NOT NULL in the original schema, which would reject every
--       internal-UI insert outright. Relaxed to nullable; a CHECK
--       constraint's NULL operands are treated as satisfied by Postgres
--       (neither TRUE nor FALSE), so leaving them unset for
--       internal-UI-created rows doesn't trip valid_time_range either.
--       The automated RPC is unaffected - it always supplies both.
ALTER TABLE public.bookings ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN end_time DROP NOT NULL;

-- 5b. Denormalized display columns the internal calendar UI needs
--     (booking_number, customer contact info, lead/quotation linkage,
--     resource_name cache, free-text location, staffing, notes) that
--     the original minimal automated-RPC schema never carried. All
--     nullable - the RPC path is completely unaffected.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES crm_quotations(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quotation_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS resource_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS assigned_staff_email TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_or_operator TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW());
-- The internal UI books whole days (start_date/end_date), while the
-- automated RPC books precise slots (start_time/end_time) - both kept,
-- neither forced into the other's semantics.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS end_date DATE;
-- The internal calendar's local BookingStatus vocabulary ('TENTATIVE',
-- 'COMPLETED') differs from the automated RPC's ('HOLD', 'EXPIRED') -
-- widened rather than forcing one path to adopt the other's semantics.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('HOLD', 'TENTATIVE', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

CREATE INDEX IF NOT EXISTS idx_bookings_lead ON public.bookings(lead_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON public.bookings(company_id, start_date, end_date);



-- =====================================================================
-- START OF: 20260824000004_whatsapp_business_integration.sql
-- =====================================================================

-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 6+ — WHATSAPP BUSINESS API INTEGRATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Replaces the Phase 6 local-storage WhatsAppInbox prototype with real
-- cloud-persisted tables supporting:
--   1. Meta Cloud API inbound webhooks (customer replies & status receipts)
--   2. Real-time multi-agent shared team inbox (Supabase Realtime)
--   3. Outbound transactional document/PDF & template dispatch
--   4. CRM auto-lead generation from inbound inquiries
--
-- Follows established schema conventions:
--   - company_id REFERENCES profiles(id) ON DELETE CASCADE
--   - Shared authenticated RLS policies
--   - Genuine UUID primary keys
--   - Realtime publication registration
-- =====================================================================

-- 1. WhatsApp Conversations
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  last_message TEXT DEFAULT '',
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  unread_count INT NOT NULL DEFAULT 0,
  assigned_staff_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_conv_phone_per_company UNIQUE (company_id, phone)
);

-- 2. WhatsApp Messages
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  wa_message_id TEXT, -- Meta message ID (wamid.HBg...)
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'staff', 'system')),
  sender_name TEXT NOT NULL,
  sender_email TEXT,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'template', 'document', 'image', 'location', 'interactive')),
  text TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  attachment_url TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('pdf', 'image', 'route_map', 'document')),
  attachment_name TEXT,
  error_message TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. WhatsApp Templates (Meta Pre-approved Templates)
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'UTILITY' CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  meta_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (meta_status IN ('APPROVED', 'PENDING', 'REJECTED')),
  header_type TEXT DEFAULT 'NONE',
  body_text TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_template_name_per_company UNIQUE (company_id, template_name)
);

-- 4. WhatsApp Webhooks Log (Audit trail for incoming Meta webhooks)
CREATE TABLE IF NOT EXISTS public.whatsapp_webhooks_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhooks_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_conversations_auth_all" ON public.whatsapp_conversations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_messages_auth_all" ON public.whatsapp_messages
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_templates_auth_all" ON public.whatsapp_templates
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_webhooks_log_auth_all" ON public.whatsapp_webhooks_log
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_wa_conv_company ON public.whatsapp_conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON public.whatsapp_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_wa_conv_lead ON public.whatsapp_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_customer ON public.whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_updated ON public.whatsapp_conversations(company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_msg_conversation ON public.whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_company ON public.whatsapp_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_wa_id ON public.whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_created ON public.whatsapp_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_wa_templates_company ON public.whatsapp_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_webhooks_log_processed ON public.whatsapp_webhooks_log(processed, created_at);

-- =====================================================================
-- Realtime Publications
-- =====================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;

-- =====================================================================
-- B2P INTERNATIONAL ERP: TELECALLING OPERATIONS & CRM TABLES (2026-09-17)
-- =====================================================================

-- 0. Ensure base CRM tables exist (standalone and decoupled from specific profiles/customers tables)
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  lead_number TEXT,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  whatsapp_number TEXT,
  address TEXT,
  location TEXT,
  business_type TEXT,
  lead_source TEXT NOT NULL DEFAULT 'other',
  source_details TEXT,
  service_required TEXT,
  vehicle_service_type TEXT,
  required_date DATE,
  campaign_location TEXT,
  number_of_days INT,
  priority TEXT NOT NULL DEFAULT 'WARM',
  assigned_telecaller_email TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  next_follow_up_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  assigned_staff_email TEXT NOT NULL,
  due_date DATE NOT NULL,
  due_time TEXT NOT NULL DEFAULT '10:00',
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'SNOOZED', 'CANCELLED', 'OVERDUE')),
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_note TEXT,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  next_follow_up_id UUID
);

-- 1. Additive columns on public.leads for current calling state
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS alternate_phone TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_outcome TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_remark TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS call_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_contacted_by_email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_telecalling_lead BOOLEAN NOT NULL DEFAULT true;

-- 2. Additive columns on public.lead_activities for immutable call audit trail
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'call';
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS call_outcome TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS phone_used TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW());

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_telecaller ON public.leads(assigned_telecaller_email);
CREATE INDEX IF NOT EXISTS idx_leads_last_call ON public.leads(company_id, last_call_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);
CREATE INDEX IF NOT EXISTS idx_lead_activities_outcome ON public.lead_activities(company_id, call_outcome);
CREATE INDEX IF NOT EXISTS idx_lead_activities_user_created ON public.lead_activities(user_email, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created ON public.lead_activities(company_id, created_at);

-- 4. Error & Operational Diagnostics Logging Table
CREATE TABLE IF NOT EXISTS public.app_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  user_email TEXT NOT NULL,
  lead_id UUID,
  operation TEXT NOT NULL,
  screen TEXT,
  error_message TEXT NOT NULL,
  error_code TEXT,
  metadata JSONB,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.app_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON public.app_error_logs(user_email, created_at DESC);

-- 5. Enable Row Level Security (RLS) & Standard Authenticated Policies
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_error_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_auth_all') THEN
    CREATE POLICY "leads_auth_all" ON public.leads FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lead_activities' AND policyname = 'lead_activities_auth_all') THEN
    CREATE POLICY "lead_activities_auth_all" ON public.lead_activities FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'follow_ups' AND policyname = 'follow_ups_auth_all') THEN
    CREATE POLICY "follow_ups_auth_all" ON public.follow_ups FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_error_logs' AND policyname = 'error_logs_auth_all') THEN
    CREATE POLICY "error_logs_auth_all" ON public.app_error_logs FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

