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
