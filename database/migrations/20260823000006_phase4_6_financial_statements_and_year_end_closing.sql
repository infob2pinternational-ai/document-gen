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
