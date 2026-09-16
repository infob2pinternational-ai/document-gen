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
