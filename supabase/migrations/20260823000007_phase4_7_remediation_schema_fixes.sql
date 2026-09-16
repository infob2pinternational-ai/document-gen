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
