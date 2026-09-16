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
