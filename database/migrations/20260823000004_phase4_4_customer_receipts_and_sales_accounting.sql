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
