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
