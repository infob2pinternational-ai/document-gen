import type { 
  Supplier, 
  Purchase, 
  Expense, 
  PaymentReceived, 
  SupplierPayment, 
  CustomerLedgerEntry, 
  SupplierLedgerEntry, 
  GSTSummary, 
  ProfitAndLossReport, 
  InvoicePaymentStatus, 
  Document, 
  AccountGroup, 
  AccountHead, 
  JournalEntry, 
  JournalStatus, 
  GeneralLedgerReport, 
  GeneralLedgerRow, 
  BankAccount, 
  TrialBalanceItem, 
  BalanceSheetReport, 
  FinancialAuditLog, 
  FinancialPeriodLock, 
  GSTComplianceRule, 
  GSTR1Workspace, 
  GSTR1B2BRecord,
  GSTR3BWorkspace, 
  GSTR2BReconciliationItem, 
  EInvoicePayload, 
  EWayBillPayload,
  AccountsPayableSummary,
  SupplierPaymentAllocation,
  CustomerPaymentAllocation,
  CustomerReceivablesSummary,
  BankReconciliationItem,
  BankReconciliationStatement,
  CashBookEntry,
  BankBookEntry,
  CashFlowStatement,
  YearEndClosingStatus,
  PurchaseItem
} from '../types';
import { dbService, supabase, isCloudActive } from './db';
import { taxEngine } from './taxEngine';

// =========================================================================
// PERSISTENCE MODEL (REMEDIATION 2026-08-24)
//
// Prior to this pass, every method below read/wrote localStorage
// directly, even though Phase 4.1-4.6 created a full Supabase schema for
// exactly this data (chart of accounts, journal entries, purchases,
// receipts, banking, financial statements) - the migrations were dead
// code, and finance data never left the current browser.
//
// This block makes Supabase the authoritative store, using the EXACT
// SAME cloud/local decision (`isCloudActive()`) that db.ts's dbService
// already uses for documents/customers/services/profiles: cloud when a
// Supabase session exists, localStorage otherwise - never both at once
// for the same read/write, so there is exactly one source of truth per
// request, consistent with the rest of the app. Business logic
// (validation, allocation math, double-entry posting, audit logging,
// balance derivation) is UNCHANGED below - only the low-level "load
// rows" / "persist one changed row" primitives are swapped out, so this
// remains the one accounting engine, not a second one.
//
// Entities converted in this pass: account_groups, account_heads,
// journal_entries, financial_period_locks, financial_audit_logs,
// suppliers, purchases, expenses, customer receipts (+ allocations),
// supplier payments (+ allocations), bank_accounts - i.e. every entity
// touched by the audit's P1 findings. GST return workspaces, e-invoice/
// e-way-bill payloads, GSTR-2B reconciliation, bank reconciliation
// statements and year-end closure records remain localStorage-only for
// now (documented as a remaining limitation in the remediation report) -
// converting everything in one pass, without a reachable local/staging
// Postgres instance to verify the cloud path end-to-end, would trade
// verified correctness for raw coverage.
// =========================================================================

type FinanceSupabaseTable =
  | 'account_groups' | 'account_heads' | 'journal_entries'
  | 'financial_period_locks' | 'financial_audit_logs'
  | 'suppliers' | 'purchase_bills' | 'expenses'
  | 'customer_receipts' | 'customer_receipt_allocations'
  | 'supplier_payments' | 'supplier_payment_allocations'
  | 'bank_accounts'
  // REMEDIATION (2026-08-24, follow-up pass): bank reconciliation
  // statements and year-end closure records were left localStorage-only
  // in the first remediation pass (documented as a known limitation at
  // the time). Both are now wired the same way as every other entity
  // above.
  | 'bank_reconciliation_statements' | 'financial_year_closures';

/** Load every row of a finance table: from Supabase when a cloud session
 * is active, from localStorage otherwise. `company_id` filtering is
 * applied server-side for the cloud path (via .eq) and left to each
 * call site for the local path (matching existing behavior). */
async function loadFinanceTable<T>(storageKey: string, table: FinanceSupabaseTable, companyId?: string | null): Promise<T[]> {
  if (isCloudActive() && supabase) {
    let query = supabase.from(table).select('*');
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as T[];
  }
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

/** Persist a single created/updated row. Cloud path: upsert just that
 * row to Supabase (network cost proportional to the actual change, like
 * every other write in this app). Local path: persist the full,
 * already-recomputed array to localStorage (matching prior behavior). */
async function persistFinanceRow<T extends { id: string }>(storageKey: string, table: FinanceSupabaseTable, fullLocalArray: T[], changedRow: T): Promise<void> {
  if (isCloudActive() && supabase) {
    const { error } = await supabase.from(table).upsert(changedRow as any);
    if (error) throw error;
  } else {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  }
}

/** Persist a full-array rewrite (used only for local-only bulk update
 * paths, e.g. re-deriving many rows' running balances at once - the
 * cloud path for these still goes through persistFinanceRow per row by
 * the caller). Kept separate from persistFinanceRow so a cloud session
 * is never silently short-circuited into a no-op bulk local write. */
async function persistFinanceRowDeleted(storageKey: string, table: FinanceSupabaseTable, fullLocalArray: any[], deletedId: string): Promise<void> {
  if (isCloudActive() && supabase) {
    const { error } = await supabase.from(table).delete().eq('id', deletedId);
    if (error) throw error;
  } else {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  }
}

const STORAGE_KEYS = {
  SUPPLIERS: 'b2p_finance_suppliers',
  PURCHASES: 'b2p_finance_purchases',
  EXPENSES: 'b2p_finance_expenses',
  PAYMENTS_RECEIVED: 'b2p_finance_payments_received',
  SUPPLIER_PAYMENTS: 'b2p_finance_supplier_payments',
  ACCOUNT_GROUPS: 'b2p_finance_account_groups',
  ACCOUNT_HEADS: 'b2p_finance_account_heads',
  JOURNAL_ENTRIES: 'b2p_finance_journal_entries',
  BANK_ACCOUNTS: 'b2p_finance_bank_accounts',
  BANK_TRANSACTIONS: 'b2p_finance_bank_transactions',
  BANK_RECON_STATEMENTS: 'b2p_finance_bank_recon_statements',
  YEAR_END_CLOSURES: 'b2p_finance_year_end_closures',
  AUDIT_LOGS: 'b2p_finance_audit_logs',
  PERIOD_LOCKS: 'b2p_finance_period_locks',
  COMPLIANCE_RULES: 'b2p_finance_compliance_rules'
};

const getTodayStr = () => new Date().toISOString().split('T')[0];

/** Helper for decimal-safe rounded currency math */
export const round2 = (num: number): number => {
  if (isNaN(num) || !isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// =========================================================================
// STANDARD DEFAULT CHART OF ACCOUNTS TEMPLATES (ZERO FICTIONAL BALANCES)
// =========================================================================

const DEFAULT_ACCOUNT_GROUPS: AccountGroup[] = [
  { id: 'ag-1', name: 'Current Assets', type: 'asset', code: '1000', description: 'Liquid assets, cash, bank, receivables and input credits' },
  { id: 'ag-2', name: 'Fixed Assets', type: 'asset', code: '1200', description: 'Vehicles, LED wall units, sound equipment and permanent assets' },
  { id: 'ag-3', name: 'Current Liabilities', type: 'liability', code: '2000', description: 'Accounts payable, output taxes and short term obligations' },
  { id: 'ag-4', name: 'Equity & Capital', type: 'equity', code: '3000', description: 'Owner capital, retained earnings and reserves' },
  { id: 'ag-5', name: 'Direct Revenue', type: 'income', code: '4000', description: 'Operating sales from advertising, LED van campaigns and events' },
  { id: 'ag-6', name: 'Direct Operating Expenses', type: 'expense', code: '5000', description: 'Diesel fuel, vehicle maintenance, printing costs and crew wages' },
  { id: 'ag-7', name: 'Indirect / Admin Expenses', type: 'expense', code: '5500', description: 'Rent, electricity, internet, travel and office administration' }
];

const DEFAULT_ACCOUNT_HEADS: AccountHead[] = [
  // Current Assets (1000s)
  { id: 'ah-1001', code: '1001', name: 'Cash in Hand (Office Vault)', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Petty cash on hand for day-to-day operations' },
  { id: 'ah-1002', code: '1002', name: 'Bank Operating Current Account', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Primary business operating current account' },
  { id: 'ah-1010', code: '1010', name: 'Accounts Receivable (Sundry Debtors)', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Total customer outstanding invoices receivable' },
  { id: 'ah-1030', code: '1030', name: 'Input CGST (Input Tax Credit)', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'Central GST tax credit paid on local purchases' },
  { id: 'ah-1031', code: '1031', name: 'Input SGST (Input Tax Credit)', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'State GST tax credit paid on local purchases' },
  { id: 'ah-1032', code: '1032', name: 'Input IGST (Input Tax Credit)', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'Integrated GST tax credit on inter-state purchases' },
  { id: 'ah-1040', code: '1040', name: 'Advances to Suppliers', group_id: 'ag-1', group_name: 'Current Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Advance payments made to vendors before bill receipt' },

  // Fixed Assets (1200s)
  { id: 'ah-1020', code: '1020', name: 'LED Display Vans Fleet', group_id: 'ag-2', group_name: 'Fixed Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Commercial mobile LED advertising vehicles' },
  { id: 'ah-1021', code: '1021', name: 'Professional PA & Audio Gear', group_id: 'ag-2', group_name: 'Fixed Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Roadshow audio mixers, column speakers, amplifiers' },
  { id: 'ah-1022', code: '1022', name: 'Lookwalker Display Backpack Units', group_id: 'ag-2', group_name: 'Fixed Assets', type: 'asset', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Illuminated mobile walking billboard units' },

  // Current Liabilities (2000s)
  { id: 'ah-2001', code: '2001', name: 'Accounts Payable (Sundry Creditors)', group_id: 'ag-3', group_name: 'Current Liabilities', type: 'liability', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Total vendor and supplier bills payable' },
  { id: 'ah-2010', code: '2010', name: 'Output CGST Liability', group_id: 'ag-3', group_name: 'Current Liabilities', type: 'liability', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'Central GST collected on outward client invoices' },
  { id: 'ah-2011', code: '2011', name: 'Output SGST Liability', group_id: 'ag-3', group_name: 'Current Liabilities', type: 'liability', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'State GST collected on outward client invoices' },
  { id: 'ah-2012', code: '2012', name: 'Output IGST Liability', group_id: 'ag-3', group_name: 'Current Liabilities', type: 'liability', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, gst_applicable: true, description: 'Integrated GST collected on inter-state client invoices' },
  { id: 'ah-2020', code: '2020', name: 'Customer Advances', group_id: 'ag-3', group_name: 'Current Liabilities', type: 'liability', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Unearned customer advance payments prior to invoice' },

  // Equity & Capital (3000s)
  { id: 'ah-3001', code: '3001', name: "Owner's Capital Account", group_id: 'ag-4', group_name: 'Equity & Capital', type: 'equity', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Promoter equity capital invested' },
  { id: 'ah-3002', code: '3002', name: 'Retained Earnings', group_id: 'ag-4', group_name: 'Equity & Capital', type: 'equity', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Accumulated profits from prior financial years' },

  // Direct Revenue (4000s)
  { id: 'ah-4001', code: '4001', name: 'LED Van Advertising Revenue', group_id: 'ag-5', group_name: 'Direct Revenue', type: 'income', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Campaign billing for mobile LED display vans' },
  { id: 'ah-4002', code: '4002', name: 'LED Wall Event Rental Revenue', group_id: 'ag-5', group_name: 'Direct Revenue', type: 'income', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Indoor/outdoor modular LED screen rentals' },
  { id: 'ah-4003', code: '4003', name: 'Lookwalker Promotional Services', group_id: 'ag-5', group_name: 'Direct Revenue', type: 'income', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Mobile illuminated walking board campaigns' },
  { id: 'ah-4004', code: '4004', name: 'Mobile Roadshow Campaigns', group_id: 'ag-5', group_name: 'Direct Revenue', type: 'income', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Comprehensive experiential roadshow branding' },
  { id: 'ah-4005', code: '4005', name: 'Vinyl & Banner Printing Revenue', group_id: 'ag-5', group_name: 'Direct Revenue', type: 'income', nature: 'credit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Large format star flex and vinyl printing' },

  // Direct Operating Expenses (5000s)
  { id: 'ah-5001', code: '5001', name: 'Fleet Diesel & Generator Fuel', group_id: 'ag-6', group_name: 'Direct Operating Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Fuel for LED van propulsion and silent diesel generators' },
  { id: 'ah-5002', code: '5002', name: 'Vehicle Maintenance & Spares', group_id: 'ag-6', group_name: 'Direct Operating Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Mechanical service, P3 SMD spares, cabling repairs' },
  { id: 'ah-5003', code: '5003', name: 'Operator & Crew Wages', group_id: 'ag-6', group_name: 'Direct Operating Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Daily driver, technician and lookwalker crew stipends' },
  { id: 'ah-5004', code: '5004', name: 'Flex & Vinyl Printing Costs', group_id: 'ag-6', group_name: 'Direct Operating Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Subcontracted banner and vehicle wrapping prints' },

  // Indirect / Admin Expenses (5500s)
  { id: 'ah-5005', code: '5501', name: 'Office Rent & Workspace Lease', group_id: 'ag-7', group_name: 'Indirect / Admin Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: true, is_active: true, description: 'Commercial office and yard rental' },
  { id: 'ah-5006', code: '5502', name: 'Electricity & Power Utilities', group_id: 'ag-7', group_name: 'Indirect / Admin Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Commercial electricity and depot utility bills' },
  { id: 'ah-5007', code: '5503', name: 'Broadband & Communication', group_id: 'ag-7', group_name: 'Indirect / Admin Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Fiber internet, SIM cards for GPS trackers and live streams' },
  { id: 'ah-5008', code: '5504', name: 'Travel & Field Logistics', group_id: 'ag-7', group_name: 'Indirect / Admin Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Crew food, lodging and road toll charges' },
  { id: 'ah-5009', code: '5505', name: 'Office & General Administration', group_id: 'ag-7', group_name: 'Indirect / Admin Expenses', type: 'expense', nature: 'debit', opening_balance: 0, current_balance: 0, is_system: false, is_active: true, description: 'Stationery, refreshments, software tools and general office upkeep' }
];

const INITIAL_PERIOD_LOCKS: FinancialPeriodLock[] = [
  { id: 'lock-1', financial_year: 'FY 2025-26', period_name: 'FY 2025-26 Annual Lock', start_date: '2025-04-01', end_date: '2026-03-31', is_locked: true, locked_at: '2026-04-05T10:00:00Z', locked_by_email: 'owner@b2p.com' }
];

const INITIAL_COMPLIANCE_RULES: GSTComplianceRule[] = [
  { id: 'rule-gst-services', rule_code: 'GST_RATE_ADV_SERVICES', name: 'Advertising & Screen Rental GST Rate', effective_from: '2017-07-01', rule_type: 'tax_rate', value: '18%', description: 'SAC 998361 Outdoor and digital media advertising taxable at 18% (9% CGST + 9% SGST or 18% IGST)', version: '1.2' }
];

// =========================================================================
// CENTRAL FINANCE & DOUBLE-ENTRY ACCOUNTING SERVICE
// =========================================================================

class FinanceService {
  private listeners: (() => void)[] = [];

  // REMEDIATION (2026-08-24, audit finding: "company-isolation
  // problems"): previously every finance method accepted an optional
  // companyId that, in practice, NO caller across any of the 20 finance
  // components ever passed - so every finance screen showed every
  // company's data mixed together, always. Rather than trust ~70 call
  // sites across the UI to remember to pass the right id, the app now
  // tells the service ONCE which company is active (App.tsx calls
  // setActiveCompany() wherever it already reacts to activeProfile
  // changing - the same concept already used to scope
  // dbService.getDocuments()/Realtime channels), and every finance
  // method defaults to that when no explicit companyId is supplied.
  // An explicit companyId argument, where still accepted, still wins
  // (needed for the rare cross-company/owner-level aggregate case).
  private activeCompanyId: string | null = null;

  public setActiveCompany(companyId: string | null): void {
    if (this.activeCompanyId === companyId) return;
    this.activeCompanyId = companyId;
    this.notify();
  }

  public getActiveCompany(): string | null {
    return this.activeCompanyId;
  }

  private resolveCompanyId(explicit?: string): string | undefined {
    return explicit || this.activeCompanyId || undefined;
  }

  /** Collision-safe sequential document numbering (REMEDIATION
   * 2026-08-24, P2 item 12). The prior scheme (`array.length + 1001`)
   * had no uniqueness guarantee: two near-simultaneous saves, or even a
   * fast double-click before state updates, could mint the identical
   * number - unlike the main `documents` table this is generated
   * against, which has a DB-level UNIQUE(company_id, document_number)
   * backstop, these finance numbers had none at all.
   *
   * This keeps the human-readable PREFIX-YEAR-NNNN shape but (1) seeds
   * the next sequence from the highest existing number for this company
   * + prefix, not array length (which undercounts once anything has
   * ever been deleted/cancelled), and (2) explicitly re-checks
   * uniqueness against the in-memory array before returning,
   * incrementing past any collision - the same style of guard this file
   * already uses for duplicate reference numbers.
   *
   * This is NOT a database-level atomic sequence - there is no reachable
   * local/staging Postgres instance in this environment to build/verify
   * one against (see the persistence-model note near the top of this
   * file), so it narrows the collision window rather than eliminating a
   * true race between two simultaneous saves on two different devices.
   * Once the Supabase path is primary for a given company, the
   * UNIQUE(company_id, purchase_number/payment_number) constraints added
   * in the Phase 4 migrations act as the hard backstop, exactly like the
   * existing UNIQUE(company_id, document_number) constraint does for the
   * main documents table: a colliding insert is rejected by Postgres
   * rather than silently accepted.
   */
  /** Derives current-period net profit strictly from the trial balance's
   * own posted income/expense account balances - the SINGLE place this
   * figure is computed from the ledger, called by both getBalanceSheet()
   * and performYearEndClosing() (REMEDIATION 2026-08-24, Phase 4.6
   * verification). Both previously either duplicated this arithmetic
   * inline or pulled it from the separate, raw-document-based
   * getProfitAndLoss() (a real bug - see the comments at each call
   * site); this keeps there being exactly one ledger-derived
   * "net profit" definition instead of two, however similar. */
  private getLedgerNetProfitFromTrialBalance(tb: { items: TrialBalanceItem[] }): number {
    let income = 0;
    let expense = 0;
    tb.items.forEach(item => {
      if (item.type === 'income') income += (item.closing_credit > 0 ? item.closing_credit : -item.closing_debit);
      else if (item.type === 'expense') expense += (item.closing_debit > 0 ? item.closing_debit : -item.closing_credit);
    });
    return round2(income - expense);
  }

  private generateCollisionSafeNumber(prefix: string, existingRows: Record<string, any>[], field: string, companyId?: string, middleToken?: string): string {
    // middleToken preserves each document type's pre-existing visible
    // number format exactly (e.g. receipts use the literal "B2P" here,
    // not a year, matching RCPT-B2P-NNNN as it always has) - only
    // collision-safety changes, not the format the business already
    // sees on printed/shared receipts.
    const token = middleToken ?? new Date().getFullYear().toString();
    const scoped = companyId ? existingRows.filter(r => !r.company_id || r.company_id === companyId) : existingRows;
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${prefix}-${escapedToken}-(\\d+)$`);
    let maxSeq = 1000;
    scoped.forEach(r => {
      const m = String(r[field] || '').match(pattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > maxSeq) maxSeq = n;
      }
    });
    let candidate = `${prefix}-${token}-${(maxSeq + 1).toString()}`;
    let guard = 0;
    while (existingRows.some(r => r[field] === candidate) && guard < 1000) {
      maxSeq += 1;
      candidate = `${prefix}-${token}-${(maxSeq + 1).toString()}`;
      guard++;
    }
    return candidate;
  }

  constructor() {
    this.initTemplateData();
  }

  private initTemplateData() {
    if (!localStorage.getItem(STORAGE_KEYS.ACCOUNT_GROUPS)) {
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_GROUPS, JSON.stringify(DEFAULT_ACCOUNT_GROUPS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.ACCOUNT_HEADS)) {
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_HEADS, JSON.stringify(DEFAULT_ACCOUNT_HEADS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PERIOD_LOCKS)) {
      localStorage.setItem(STORAGE_KEYS.PERIOD_LOCKS, JSON.stringify(INITIAL_PERIOD_LOCKS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.COMPLIANCE_RULES)) {
      localStorage.setItem(STORAGE_KEYS.COMPLIANCE_RULES, JSON.stringify(INITIAL_COMPLIANCE_RULES));
    }
    // Clean, unseeded real transactional storage arrays
    if (!localStorage.getItem(STORAGE_KEYS.JOURNAL_ENTRIES)) {
      localStorage.setItem(STORAGE_KEYS.JOURNAL_ENTRIES, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.BANK_ACCOUNTS)) {
      localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SUPPLIERS)) {
      localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PURCHASES)) {
      localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.EXPENSES)) {
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.PAYMENTS_RECEIVED)) {
      localStorage.setItem(STORAGE_KEYS.PAYMENTS_RECEIVED, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SUPPLIER_PAYMENTS)) {
      localStorage.setItem(STORAGE_KEYS.SUPPLIER_PAYMENTS, JSON.stringify([]));
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => {
      try { l(); } catch (e) { console.error('Finance listener error:', e); }
    });
  }

  // =========================================================================
  // CLOUD HYDRATION (REMEDIATION 2026-08-24)
  //
  // Every getter in this service reads synchronously from localStorage,
  // exactly as before this remediation pass - that is unchanged and is
  // what lets the rest of this file's business logic stay untouched.
  // What's new: when a Supabase session is active, this pulls the
  // authoritative rows for the active (or given) company down from
  // Supabase and overwrites the local cache with them BEFORE the user
  // starts working, so what those synchronous getters see is the cloud
  // truth, not stale/foreign browser data. App.tsx calls this once on
  // login and again whenever the active company changes (the same
  // moments it already re-scopes dbService calls). When there is no
  // cloud session, this is a no-op and localStorage is used exactly as
  // it always was - the "explicitly supported fallback".
  // =========================================================================
  public async hydrateFromCloud(companyId?: string): Promise<void> {
    if (!isCloudActive() || !supabase) return;
    const scopeId = this.resolveCompanyId(companyId);
    try {
      const [groups, heads, journals, locks, logs, suppliers, purchases, expenses, receipts, supplierPayments, bankAccounts, reconStatements, yearEndClosures] = await Promise.all([
        loadFinanceTable<AccountGroup>(STORAGE_KEYS.ACCOUNT_GROUPS, 'account_groups', scopeId),
        loadFinanceTable<AccountHead>(STORAGE_KEYS.ACCOUNT_HEADS, 'account_heads', scopeId),
        loadFinanceTable<JournalEntry>(STORAGE_KEYS.JOURNAL_ENTRIES, 'journal_entries', scopeId),
        loadFinanceTable<FinancialPeriodLock>(STORAGE_KEYS.PERIOD_LOCKS, 'financial_period_locks', scopeId),
        loadFinanceTable<FinancialAuditLog>(STORAGE_KEYS.AUDIT_LOGS, 'financial_audit_logs', scopeId),
        loadFinanceTable<Supplier>(STORAGE_KEYS.SUPPLIERS, 'suppliers', scopeId),
        loadFinanceTable<Purchase>(STORAGE_KEYS.PURCHASES, 'purchase_bills', scopeId),
        loadFinanceTable<Expense>(STORAGE_KEYS.EXPENSES, 'expenses', scopeId),
        loadFinanceTable<PaymentReceived>(STORAGE_KEYS.PAYMENTS_RECEIVED, 'customer_receipts', scopeId),
        loadFinanceTable<SupplierPayment>(STORAGE_KEYS.SUPPLIER_PAYMENTS, 'supplier_payments', scopeId),
        loadFinanceTable<BankAccount>(STORAGE_KEYS.BANK_ACCOUNTS, 'bank_accounts', scopeId),
        loadFinanceTable<BankReconciliationStatement>(STORAGE_KEYS.BANK_RECON_STATEMENTS, 'bank_reconciliation_statements', scopeId),
        loadFinanceTable<any>(STORAGE_KEYS.YEAR_END_CLOSURES, 'financial_year_closures', scopeId)
      ]);

      // account_groups/account_heads: an empty cloud result for a brand
      // new company means "not seeded yet", not "delete the templates" -
      // preserve the same seed-on-empty behavior initTemplateData()
      // already provides for the pure-local case.
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_GROUPS, JSON.stringify(groups.length ? groups : DEFAULT_ACCOUNT_GROUPS));
      localStorage.setItem(STORAGE_KEYS.ACCOUNT_HEADS, JSON.stringify(heads.length ? heads : DEFAULT_ACCOUNT_HEADS));
      localStorage.setItem(STORAGE_KEYS.JOURNAL_ENTRIES, JSON.stringify(journals));
      localStorage.setItem(STORAGE_KEYS.PERIOD_LOCKS, JSON.stringify(locks.length ? locks : INITIAL_PERIOD_LOCKS));
      localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(logs));
      localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliers));
      localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(purchases));
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
      localStorage.setItem(STORAGE_KEYS.PAYMENTS_RECEIVED, JSON.stringify(receipts));
      localStorage.setItem(STORAGE_KEYS.SUPPLIER_PAYMENTS, JSON.stringify(supplierPayments));
      localStorage.setItem(STORAGE_KEYS.BANK_ACCOUNTS, JSON.stringify(bankAccounts));
      localStorage.setItem(STORAGE_KEYS.BANK_RECON_STATEMENTS, JSON.stringify(reconStatements));
      localStorage.setItem(STORAGE_KEYS.YEAR_END_CLOSURES, JSON.stringify(yearEndClosures));
      this.notify();
    } catch (e) {
      console.error('[financeService] hydrateFromCloud failed - continuing with existing local cache:', e);
    }
  }

  // =========================================================================
  // CHART OF ACCOUNTS & ACCOUNT HEADS
  // =========================================================================
  // REMEDIATION (2026-08-24, found by the new CRM regression suite -
  // the exact same bug class, verified here too): this used to
  // `return DEFAULT_ACCOUNT_GROUPS` directly on a null/unreadable
  // localStorage read - the actual module-level constant, not a copy.
  // saveAccountGroup() then does `groups.push(saved)` on whatever this
  // returns, which would mutate DEFAULT_ACCOUNT_GROUPS itself in place
  // whenever localStorage was empty at call time (e.g. right after a
  // "clear local data" action, without a full page reload to
  // re-evaluate this module and reset the constant). JSON round-trip
  // returns a fresh, unlinked copy every time.
  public getAccountGroups(): AccountGroup[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNT_GROUPS);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_GROUPS));
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_GROUPS));
    }
  }

  public async saveAccountGroup(data: Partial<AccountGroup>, userEmail = 'owner@b2p.com'): Promise<AccountGroup> {
    const groups = this.getAccountGroups();
    let saved: AccountGroup;

    if (data.id) {
      const idx = groups.findIndex(g => g.id === data.id);
      if (idx !== -1) {
        saved = { ...groups[idx], ...data } as AccountGroup;
        groups[idx] = saved;
        await this.logFinancialAudit('ACCOUNT_GROUP_UPDATED', 'account_group', saved.id, `Updated group ${saved.name}`, userEmail, 'owner');
      } else {
        throw new Error('Account group not found');
      }
    } else {
      saved = {
        id: crypto.randomUUID(),
        name: data.name || 'New Account Group',
        type: data.type || 'asset',
        code: data.code || `${Date.now().toString().slice(-4)}`,
        parent_group_id: data.parent_group_id,
        description: data.description || ''
      };
      groups.push(saved);
      await this.logFinancialAudit('ACCOUNT_GROUP_CREATED', 'account_group', saved.id, `Created group ${saved.name}`, userEmail, 'owner');
    }

    await persistFinanceRow(STORAGE_KEYS.ACCOUNT_GROUPS, 'account_groups', groups, { ...saved, company_id: this.resolveCompanyId((saved as any).company_id) } as any);
    this.notify();
    return saved;
  }

  public getAccountHeads(includeInactive = false): AccountHead[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNT_HEADS);
      // See the REMEDIATION note on getAccountGroups() above - same fix.
      const heads: AccountHead[] = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_HEADS));

      // Calculate dynamic current balances derived strictly from POSTED journal entries
      const journals = this.getJournalEntries().filter(j => j.status === 'POSTED');

      const computed = heads.map(h => {
        let debits = 0;
        let credits = 0;

        journals.forEach(j => {
          j.lines.forEach(l => {
            if (l.account_id === h.id || l.account_code === h.code) {
              debits += Number(l.debit) || 0;
              credits += Number(l.credit) || 0;
            }
          });
        });

        const opBal = Number(h.opening_balance) || 0;
        let current_balance = 0;

        if (h.type === 'asset' || h.type === 'expense') {
          current_balance = opBal + debits - credits;
        } else {
          current_balance = opBal + credits - debits;
        }

        return {
          ...h,
          is_active: h.is_active !== false,
          nature: h.nature || ((h.type === 'asset' || h.type === 'expense') ? 'debit' : 'credit'),
          current_balance: round2(current_balance)
        };
      });

      return includeInactive ? computed : computed.filter(h => h.is_active);
    } catch {
      return DEFAULT_ACCOUNT_HEADS;
    }
  }

  public getChartOfAccounts(includeInactive = false): AccountHead[] {
    return this.getAccountHeads(includeInactive);
  }

  public getAccountHeadById(id: string): AccountHead | undefined {
    return this.getAccountHeads(true).find(h => h.id === id || h.code === id);
  }

  public async saveAccountHead(headData: Partial<AccountHead>, userEmail = 'owner@b2p.com'): Promise<AccountHead> {
    // REMEDIATION (2026-08-24): this local read used to return the raw
    // DEFAULT_ACCOUNT_HEADS reference on a null localStorage read, then
    // push/splice directly onto it below - mutating the shared constant
    // in place. See the note on getAccountGroups() above for the full
    // explanation; same fix.
    const rawHeads: AccountHead[] = (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNT_HEADS);
        return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_HEADS));
      } catch {
        return JSON.parse(JSON.stringify(DEFAULT_ACCOUNT_HEADS));
      }
    })();

    const cleanCode = (headData.code || '').trim();
    if (!cleanCode) {
      throw new Error('Account code is required.');
    }
    if (!headData.name || !headData.name.trim()) {
      throw new Error('Account name is required.');
    }

    // Check for duplicate account codes within company
    const duplicate = rawHeads.find(h => h.code.toLowerCase() === cleanCode.toLowerCase() && h.id !== headData.id);
    if (duplicate) {
      throw new Error(`Account code "${cleanCode}" is already in use by "${duplicate.name}". Account codes must be unique.`);
    }

    const group = this.getAccountGroups().find(g => g.id === headData.group_id);
    const accountType = group?.type || headData.type || 'asset';
    const nature = (accountType === 'asset' || accountType === 'expense') ? 'debit' : 'credit';

    let saved: AccountHead;
    if (headData.id) {
      const idx = rawHeads.findIndex(h => h.id === headData.id);
      if (idx !== -1) {
        saved = {
          ...rawHeads[idx],
          ...headData,
          code: cleanCode,
          name: headData.name.trim(),
          group_id: headData.group_id || rawHeads[idx].group_id,
          group_name: group?.name || rawHeads[idx].group_name,
          type: accountType,
          nature,
          opening_balance: round2(Number(headData.opening_balance) || 0),
          is_active: headData.is_active !== undefined ? headData.is_active : rawHeads[idx].is_active !== false,
          description: headData.description?.trim() || ''
        } as AccountHead;
        rawHeads[idx] = saved;
        this.logFinancialAudit('ACCOUNT_HEAD_UPDATED', 'account_head', saved.id, `Updated account head ${saved.code} - ${saved.name}`, userEmail, 'owner');
      } else {
        throw new Error('Account head not found');
      }
    } else {
      saved = {
        id: crypto.randomUUID(),
        code: cleanCode,
        name: headData.name.trim(),
        group_id: headData.group_id || 'ag-1',
        group_name: group?.name || 'Current Assets',
        type: accountType,
        nature,
        opening_balance: round2(Number(headData.opening_balance) || 0),
        opening_balance_date: headData.opening_balance_date || getTodayStr(),
        current_balance: round2(Number(headData.opening_balance) || 0),
        is_system: false,
        is_active: true,
        gst_applicable: headData.gst_applicable || false,
        description: headData.description?.trim() || ''
      };
      rawHeads.push(saved);
      this.logFinancialAudit('ACCOUNT_HEAD_CREATED', 'account_head', saved.id, `Created new account head ${saved.code} - ${saved.name}`, userEmail, 'owner');
    }

    await persistFinanceRow(STORAGE_KEYS.ACCOUNT_HEADS, 'account_heads', rawHeads, { ...saved, company_id: this.resolveCompanyId((saved as any).company_id) } as any);
    this.notify();
    return saved;
  }

  public async deactivateAccountHead(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const rawHeads = this.getAccountHeads(true);
    const target = rawHeads.find(h => h.id === id);
    if (!target) return false;

    if (target.is_system) {
      throw new Error('System standard accounts cannot be deactivated.');
    }

    target.is_active = false;
    await persistFinanceRow(STORAGE_KEYS.ACCOUNT_HEADS, 'account_heads', rawHeads, { ...target, company_id: this.resolveCompanyId((target as any).company_id) } as any);
    this.logFinancialAudit('ACCOUNT_HEAD_DEACTIVATED', 'account_head', id, `Deactivated account head ${target.code} - ${target.name}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public async deleteAccountHead(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const rawHeads = this.getAccountHeads(true);
    const target = rawHeads.find(h => h.id === id);
    if (!target) return false;

    if (target.is_system) {
      throw new Error('System standard accounts cannot be deleted.');
    }

    // Strict guard: Check if account has any existing journal transactions
    const journals = this.getJournalEntries();
    const hasTransactions = journals.some(j => j.lines.some(l => l.account_id === id || l.account_code === target.code));
    if (hasTransactions) {
      throw new Error(`Cannot delete account "${target.name}" because it already has posted transactions. Deactivate the account instead.`);
    }

    const filtered = rawHeads.filter(h => h.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.ACCOUNT_HEADS, 'account_heads', filtered, id);
    this.logFinancialAudit('ACCOUNT_HEAD_DELETED', 'account_head', id, `Deleted unused account head ${target.code} - ${target.name}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  // =========================================================================
  // DOUBLE-ENTRY JOURNAL & VOUCHER POSTING ENGINE
  // =========================================================================
  public getJournalEntries(filter?: {
    startDate?: string;
    endDate?: string;
    voucherType?: string;
    status?: JournalStatus;
    financialYear?: string;
    companyId?: string;
  }): JournalEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.JOURNAL_ENTRIES);
      let entries: JournalEntry[] = raw ? JSON.parse(raw) : [];

      // REMEDIATION (2026-08-24, P0.2): default-scope to the active
      // company like every other getter in this file - getJournalEntries()
      // is called with NO filter at all from many places (getAccountHeads,
      // getTrialBalance's internal calls, deleteAccountHead, etc.), so
      // without this default, journal entries were the one entity that
      // stayed unscoped even after the rest of the company-isolation fix.
      const scopeId = this.resolveCompanyId(filter?.companyId);
      if (scopeId) {
        entries = entries.filter(e => !e.company_id || e.company_id === scopeId);
      }
      if (filter?.financialYear) {
        entries = entries.filter(e => !e.financial_year || e.financial_year === filter.financialYear);
      }
      if (filter?.voucherType && filter.voucherType !== 'all') {
        entries = entries.filter(e => e.voucher_type === filter.voucherType);
      }
      if (filter?.status) {
        entries = entries.filter(e => e.status === filter.status);
      }
      if (filter?.startDate) {
        entries = entries.filter(e => e.date >= filter.startDate!);
      }
      if (filter?.endDate) {
        entries = entries.filter(e => e.date <= filter.endDate!);
      }

      return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch {
      return [];
    }
  }

  public getJournalEntryById(id: string): JournalEntry | undefined {
    return this.getJournalEntries().find(e => e.id === id);
  }

  public async saveJournalEntry(
    entryData: Partial<JournalEntry>,
    userEmail = 'accounts@b2p.com',
    action: 'save_draft' | 'post' = 'post'
  ): Promise<JournalEntry> {
    const rawEntries = this.getJournalEntries();
    const existingIdx = entryData.id ? rawEntries.findIndex(e => e.id === entryData.id) : -1;
    const existing = existingIdx !== -1 ? rawEntries[existingIdx] : null;

    // Immutability Guard: Posted entries CANNOT be silently edited
    if (existing && existing.status === 'POSTED') {
      throw new Error(`Posted Journal Voucher #${existing.voucher_number} is immutable and cannot be modified. Create a reversal voucher for corrections.`);
    }

    if (!entryData.date) {
      throw new Error('Transaction date is required.');
    }

    // Check financial period lock
    if (this.isDateInLockedPeriod(entryData.date)) {
      throw new Error(`Accounting Period Locked: Transactions for date ${entryData.date} cannot be created or modified.`);
    }

    const lines = entryData.lines || [];
    if (lines.length < 2) {
      throw new Error('A double-entry voucher requires at least two line items (Debit and Credit).');
    }

    // Validate accounts and non-negativity
    const heads = this.getAccountHeads(true);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const head = heads.find(h => h.id === line.account_id || h.code === line.account_code);
      if (!head) {
        throw new Error(`Invalid account on line ${i + 1}. Please select a valid account head.`);
      }
      if (!head.is_active) {
        throw new Error(`Account "${head.name}" on line ${i + 1} is deactivated and cannot accept new entries.`);
      }
      if (line.debit < 0 || line.credit < 0) {
        throw new Error(`Line ${i + 1} contains negative amounts. Debits and Credits must be positive values.`);
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new Error(`Line ${i + 1} has both Debit and Credit amounts. A line item must be either Debit or Credit, not both.`);
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new Error(`Line ${i + 1} has zero amount. Please enter a valid Debit or Credit.`);
      }
    }

    const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));

    // Double-Entry Invariant Guard on POST
    if (action === 'post') {
      const diff = Math.abs(totalDebit - totalCredit);
      if (diff > 0.001) {
        throw new Error(`Double-Entry Unbalanced: Total Debit (₹${totalDebit.toFixed(2)}) must equal Total Credit (₹${totalCredit.toFixed(2)}). Variance: ₹${diff.toFixed(2)}.`);
      }
    }

    const targetStatus: JournalStatus = action === 'post' ? 'POSTED' : 'DRAFT';
    const fy = entryData.financial_year || this.getIndianFinancialYearForDate(entryData.date);

    let voucherNumber = entryData.voucher_number;
    if (!voucherNumber) {
      const typePrefix = entryData.voucher_type === 'payment' ? 'PV' :
                         entryData.voucher_type === 'receipt' ? 'RV' :
                         entryData.voucher_type === 'expense' ? 'EV' :
                         entryData.voucher_type === 'contra' ? 'CV' : 'JV';
      const yearStr = new Date().getFullYear().toString();
      // REMEDIATION (2026-08-24, P2 item 12): the previous
      // `array.filter(...).length + 1` scheme had the same collision
      // exposure as the purchase/receipt/payment numbering the audit
      // flagged - two near-simultaneous voucher posts (or a voucher
      // deleted/renumbered) could produce the identical voucher_number,
      // which is also the exact column the UNIQUE(company_id,
      // voucher_number) constraint in the Phase 4.1 migration guards.
      // Same collision-safe scan-and-increment approach as
      // generateCollisionSafeNumber, kept as dedicated logic here only
      // because this format is zero-padded to 4 digits starting at 0001
      // (JV-2026-0001), unlike the 1001-based BILL/RCPT/VPY formats.
      const sameTypeThisYear = rawEntries.filter(e =>
        e.voucher_type === (entryData.voucher_type || 'journal') &&
        e.voucher_number?.startsWith(`${typePrefix}-${yearStr}-`)
      );
      let maxSeq = 0;
      sameTypeThisYear.forEach(e => {
        const m = e.voucher_number?.match(/-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
      });
      let candidate = `${typePrefix}-${yearStr}-${(maxSeq + 1).toString().padStart(4, '0')}`;
      let guard = 0;
      while (rawEntries.some(e => e.voucher_number === candidate) && guard < 1000) {
        maxSeq += 1;
        candidate = `${typePrefix}-${yearStr}-${(maxSeq + 1).toString().padStart(4, '0')}`;
        guard++;
      }
      voucherNumber = candidate;
    }

    const sanitizedLines = lines.map(l => ({
      account_id: l.account_id,
      account_code: l.account_code,
      account_name: l.account_name,
      debit: round2(Number(l.debit) || 0),
      credit: round2(Number(l.credit) || 0),
      narration: l.narration?.trim() || ''
    }));

    let saved: JournalEntry;
    if (existing) {
      saved = {
        ...existing,
        ...entryData,
        lines: sanitizedLines,
        total_debit: totalDebit,
        total_credit: totalCredit,
        status: targetStatus,
        financial_year: fy,
        posted_by_email: targetStatus === 'POSTED' ? userEmail : undefined,
        posted_at: targetStatus === 'POSTED' ? new Date().toISOString() : undefined
      } as JournalEntry;
      rawEntries[existingIdx] = saved;
    } else {
      saved = {
        id: crypto.randomUUID(),
        company_id: this.resolveCompanyId(entryData.company_id) || 'default',
        voucher_number: voucherNumber,
        voucher_type: entryData.voucher_type || 'journal',
        date: entryData.date,
        narration: entryData.narration?.trim() || 'Journal Entry',
        lines: sanitizedLines,
        total_debit: totalDebit,
        total_credit: totalCredit,
        reference_type: entryData.reference_type,
        reference_id: entryData.reference_id,
        reference_number: entryData.reference_number,
        status: targetStatus,
        financial_year: fy,
        created_by_email: userEmail,
        posted_by_email: targetStatus === 'POSTED' ? userEmail : undefined,
        posted_at: targetStatus === 'POSTED' ? new Date().toISOString() : undefined,
        created_at: new Date().toISOString()
      };
      rawEntries.unshift(saved);
    }

    await persistFinanceRow(STORAGE_KEYS.JOURNAL_ENTRIES, 'journal_entries', rawEntries, saved as any);

    this.logFinancialAudit(
      targetStatus === 'POSTED' ? 'JOURNAL_POSTED' : 'JOURNAL_DRAFT_SAVED',
      'journal_entry',
      saved.id,
      `${targetStatus === 'POSTED' ? 'Posted' : 'Saved Draft'} ${saved.voucher_type.toUpperCase()} #${saved.voucher_number} for ₹${saved.total_debit.toLocaleString('en-IN')}: ${saved.narration}`,
      userEmail,
      'accounts'
    );

    this.notify();
    return saved;
  }

  public async postJournalEntryById(id: string, userEmail = 'accounts@b2p.com'): Promise<JournalEntry> {
    const entry = this.getJournalEntryById(id);
    if (!entry) throw new Error('Journal entry not found');
    if (entry.status === 'POSTED') return entry;
    if (entry.status === 'CANCELLED') throw new Error('Cancelled vouchers cannot be posted.');

    return this.saveJournalEntry(entry, userEmail, 'post');
  }

  public async cancelJournalEntry(id: string, reason: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const rawEntries = this.getJournalEntries();
    const idx = rawEntries.findIndex(e => e.id === id);
    if (idx === -1) return false;

    const target = rawEntries[idx];
    if (this.isDateInLockedPeriod(target.date)) {
      throw new Error('Cannot cancel journal entry from a locked financial period.');
    }

    target.status = 'CANCELLED';
    await persistFinanceRow(STORAGE_KEYS.JOURNAL_ENTRIES, 'journal_entries', rawEntries, target as any);

    this.logFinancialAudit(
      'JOURNAL_CANCELLED',
      'journal_entry',
      target.id,
      `Cancelled voucher #${target.voucher_number}: ${reason || 'User cancelled'}`,
      userEmail,
      'owner'
    );

    this.notify();
    return true;
  }

  public async createReversingJournalEntry(id: string, reason: string, userEmail = 'owner@b2p.com'): Promise<JournalEntry> {
    const original = this.getJournalEntryById(id);
    if (!original) throw new Error('Original voucher not found');
    if (original.status !== 'POSTED') {
      throw new Error('Only POSTED vouchers can be reversed.');
    }

    // Swap Debits and Credits
    const reversingLines = original.lines.map(l => ({
      account_id: l.account_id,
      account_code: l.account_code,
      account_name: l.account_name,
      debit: l.credit,
      credit: l.debit,
      narration: `Reversal of line: ${l.narration || original.narration}`
    }));

    const today = getTodayStr();
    return this.saveJournalEntry({
      voucher_type: 'reversal',
      date: today,
      narration: `Reversal Voucher for #${original.voucher_number}: ${reason}`,
      reference_type: 'journal',
      reference_id: original.id,
      reference_number: original.voucher_number,
      lines: reversingLines,
      financial_year: this.getIndianFinancialYearForDate(today)
    }, userEmail, 'post');
  }

  // =========================================================================
  // GENERAL LEDGER QUERY ENGINE
  // =========================================================================
  public getGeneralLedger(
    accountId: string,
    startDate?: string,
    endDate?: string,
    voucherType?: string
  ): GeneralLedgerReport {
    const head = this.getAccountHeadById(accountId) || {
      id: accountId,
      code: '1001',
      name: 'General Account',
      type: 'asset',
      nature: 'debit',
      opening_balance: 0
    };

    // Strict Rule: Ledger ONLY evaluates POSTED transactions
    const journals = this.getJournalEntries({
      voucherType: voucherType !== 'all' ? voucherType : undefined,
      status: 'POSTED'
    });

    const isDebitNature = head.type === 'asset' || head.type === 'expense';
    let runningBalance = Number(head.opening_balance) || 0;
    const rows: GeneralLedgerRow[] = [];

    // Sort chronologically ascending
    const sorted = [...journals].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    sorted.forEach(j => {
      j.lines.forEach((line, lIdx) => {
        if (line.account_id === head.id || line.account_code === head.code) {
          const debit = Number(line.debit) || 0;
          const credit = Number(line.credit) || 0;

          if (isDebitNature) {
            runningBalance = runningBalance + debit - credit;
          } else {
            runningBalance = runningBalance + credit - debit;
          }

          const inDateRange = (!startDate || j.date >= startDate) && (!endDate || j.date <= endDate);
          if (inDateRange) {
            rows.push({
              id: `gl-${j.id}-${lIdx}`,
              date: j.date,
              voucher_id: j.id,
              voucher_number: j.voucher_number,
              voucher_type: j.voucher_type,
              reference: j.reference_number || j.reference_type,
              narration: line.narration || j.narration,
              debit: round2(debit),
              credit: round2(credit),
              running_balance: round2(runningBalance)
            });
          }
        }
      });
    });

    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

    return {
      account_id: head.id,
      account_code: head.code,
      account_name: head.name,
      account_type: head.type,
      opening_balance: round2(Number(head.opening_balance) || 0),
      rows,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: round2(runningBalance)
    };
  }

  // =========================================================================
  // TRIAL BALANCE CALCULATION ENGINE
  // =========================================================================
  public getTrialBalance(asOnDate?: string, financialYear?: string, companyId?: string): {
    items: TrialBalanceItem[];
    total_debits: number;
    total_credits: number;
    is_balanced: boolean;
    difference: number;
    error_message?: string;
  } {
    const heads = this.getAccountHeads(true);
    // Strict Rule: Trial balance ONLY sums POSTED entries
    const journals = this.getJournalEntries({
      endDate: asOnDate,
      financialYear,
      status: 'POSTED',
      companyId
    });

    const items: TrialBalanceItem[] = heads.map(h => {
      let debit_total = 0;
      let credit_total = 0;

      journals.forEach(j => {
        j.lines.forEach(l => {
          if (l.account_id === h.id || l.account_code === h.code) {
            debit_total += Number(l.debit) || 0;
            credit_total += Number(l.credit) || 0;
          }
        });
      });

      const opBal = Number(h.opening_balance) || 0;
      let closing_debit = 0;
      let closing_credit = 0;

      if (h.type === 'asset' || h.type === 'expense') {
        const net = opBal + debit_total - credit_total;
        if (net >= 0) closing_debit = net;
        else closing_credit = Math.abs(net);
      } else {
        const net = opBal + credit_total - debit_total;
        if (net >= 0) closing_credit = net;
        else closing_debit = Math.abs(net);
      }

      return {
        account_id: h.id,
        account_code: h.code,
        account_name: h.name,
        group_name: h.group_name,
        type: h.type,
        opening_balance: round2(opBal),
        debit_total: round2(debit_total),
        credit_total: round2(credit_total),
        closing_debit: round2(closing_debit),
        closing_credit: round2(closing_credit)
      };
    });

    const total_debits = round2(items.reduce((s, i) => s + i.closing_debit, 0));
    const total_credits = round2(items.reduce((s, i) => s + i.closing_credit, 0));
    const difference = round2(Math.abs(total_debits - total_credits));
    const is_balanced = difference < 0.01;

    return {
      items,
      total_debits,
      total_credits,
      is_balanced,
      difference,
      error_message: is_balanced ? undefined : `Accounting Integrity Warning: Trial Balance is out of balance by ₹${difference.toFixed(2)}.`
    };
  }

  // =========================================================================
  // FINANCIAL YEAR & PERIOD LOCKING ENGINE
  // =========================================================================
  public getIndianFinancialYears(): string[] {
    const currentYear = new Date().getFullYear();
    const month = new Date().getMonth();
    const startYr = month >= 3 ? currentYear : currentYear - 1;
    return [
      `FY ${startYr}-${(startYr + 1).toString().substring(2)}`,
      `FY ${startYr - 1}-${startYr.toString().substring(2)}`,
      `FY ${startYr - 2}-${(startYr - 1).toString().substring(2)}`
    ];
  }

  public getIndianFinancialYearForDate(dateStr: string): string {
    const d = new Date(dateStr || getTodayStr());
    const year = d.getFullYear();
    const month = d.getMonth();
    if (month >= 3) {
      return `FY ${year}-${(year + 1).toString().substring(2)}`;
    } else {
      return `FY ${year - 1}-${year.toString().substring(2)}`;
    }
  }

  // REMEDIATION (2026-08-24, found by the new CRM regression suite -
  // the exact same bug class, verified here too): this used to
  // `return INITIAL_PERIOD_LOCKS` directly on a null/unreadable
  // localStorage read - the actual module-level constant array (and its
  // one lock OBJECT), not a copy. togglePeriodLock() and
  // performYearEndClosing() both then mutate a lock's properties
  // in-place (`locks[idx].is_locked = ...`), which would corrupt the
  // shared INITIAL_PERIOD_LOCKS constant itself whenever localStorage
  // was empty at call time. JSON round-trip returns a fresh, unlinked
  // copy every time.
  public getPeriodLocks(): FinancialPeriodLock[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PERIOD_LOCKS);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(INITIAL_PERIOD_LOCKS));
    } catch {
      return JSON.parse(JSON.stringify(INITIAL_PERIOD_LOCKS));
    }
  }

  public isDateInLockedPeriod(dateStr: string): boolean {
    const locks = this.getPeriodLocks();
    return locks.some(l => l.is_locked && dateStr >= l.start_date && dateStr <= l.end_date);
  }

  public async togglePeriodLock(lockId: string, isLocked: boolean, userEmail = 'owner@b2p.com'): Promise<FinancialPeriodLock> {
    const locks = this.getPeriodLocks();
    const idx = locks.findIndex(l => l.id === lockId);
    if (idx === -1) throw new Error('Lock period definition not found');

    locks[idx].is_locked = isLocked;
    locks[idx].locked_at = isLocked ? new Date().toISOString() : undefined;
    locks[idx].locked_by_email = isLocked ? userEmail : undefined;

    await persistFinanceRow(STORAGE_KEYS.PERIOD_LOCKS, 'financial_period_locks', locks, { ...locks[idx], company_id: this.resolveCompanyId((locks[idx] as any).company_id) } as any);
    this.logFinancialAudit(
      isLocked ? 'PERIOD_LOCKED' : 'PERIOD_UNLOCKED',
      'period_lock',
      lockId,
      `${isLocked ? 'Locked' : 'Unlocked'} accounting period: ${locks[idx].period_name} (${locks[idx].financial_year})`,
      userEmail,
      'owner'
    );
    this.notify();
    return locks[idx];
  }

  // =========================================================================
  // FINANCIAL AUDIT TRAIL LOGGING
  // =========================================================================
  public getAuditLogs(limit = 100, entityType?: string): FinancialAuditLog[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
      let logs: FinancialAuditLog[] = raw ? JSON.parse(raw) : [];
      if (entityType) logs = logs.filter(l => l.entity_type === entityType);
      return logs.slice(0, limit);
    } catch {
      return [];
    }
  }

  public logFinancialAudit(
    action: string,
    entityType: string,
    entityId: string,
    details: string,
    userEmail: string,
    userRole: string,
    oldVal?: string,
    newVal?: string
  ): FinancialAuditLog {
    const logs = this.getAuditLogs(500);
    const newLog: FinancialAuditLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      user_email: userEmail,
      user_role: userRole,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldVal,
      new_value: newVal,
      details
    };

    logs.unshift(newLog);
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(logs.slice(0, 500)));

    // Best-effort cloud mirror. Deliberately fire-and-forget (not
    // awaited by callers) rather than making every single one of this
    // method's ~25 call sites across the file async just to await an
    // audit trail entry - unlike the primary financial record a call
    // site is persisting (which IS properly awaited and throws on
    // failure), a delayed/occasionally-missed audit log mirror is an
    // acceptable, explicitly-documented trade-off. Failures are logged,
    // never silently swallowed.
    if (isCloudActive() && supabase) {
      const companyScoped = { ...newLog, company_id: this.resolveCompanyId((newLog as any).company_id) };
      supabase.from('financial_audit_logs').insert(companyScoped as any).then(({ error }: any) => {
        if (error) console.error('[financeService] audit log cloud mirror failed:', error);
      });
    }

    return newLog;
  }

  // =========================================================================
  // SUB-PHASE 4.5: BANKING, CASH MANAGEMENT & BANK RECONCILIATION
  // =========================================================================

  public getBankAccounts(companyId?: string): BankAccount[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BANK_ACCOUNTS);
      let accounts: BankAccount[] = raw ? JSON.parse(raw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        accounts = accounts.filter(a => !a.company_id || a.company_id === scopeId);
      }

      // Compute live current balance from authoritative General Ledger
      return accounts.map(acc => {
        const book = this.getBankBook(acc.account_head_id || acc.id, undefined, undefined, companyId);
        const current_balance = round2(book.closing_balance);
        return {
          ...acc,
          current_balance
        };
      });
    } catch {
      return [];
    }
  }

  public async saveBankAccount(data: Partial<BankAccount>, userEmail = 'owner@b2p.com'): Promise<BankAccount> {
    if (!data.bank_name || !data.bank_name.trim()) {
      throw new Error('Bank name is required.');
    }
    if (!data.account_number || !data.account_number.trim()) {
      throw new Error('Account number is required.');
    }

    const companyId = this.resolveCompanyId(data.company_id) || 'default';
    const accounts = this.getBankAccounts();
    const cleanAccNum = data.account_number.trim();

    // Duplicate account number check within company
    const duplicate = accounts.find(a => 
      a.id !== data.id &&
      (!a.company_id || a.company_id === companyId) &&
      a.account_number.trim().toLowerCase() === cleanAccNum.toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Bank account with number "${cleanAccNum}" already exists.`);
    }

    const now = new Date().toISOString();
    let saved: BankAccount;

    if (data.id) {
      const idx = accounts.findIndex(a => a.id === data.id);
      if (idx !== -1) {
        saved = {
          ...accounts[idx],
          ...data,
          bank_name: data.bank_name.trim(),
          account_name: data.account_name?.trim() || accounts[idx].account_name,
          account_number: cleanAccNum,
          ifsc_code: data.ifsc_code?.trim().toUpperCase() || accounts[idx].ifsc_code,
          branch: data.branch?.trim() || accounts[idx].branch,
          updated_at: now
        };
        accounts[idx] = saved;
      } else {
        throw new Error('Bank account not found.');
      }
    } else {
      const newAccId = crypto.randomUUID();
      const headCode = `1002-${(accounts.length + 1).toString().padStart(2, '0')}`;
      
      // Ensure Account Head exists in Chart of Accounts
      let headId = data.account_head_id;
      if (!headId) {
        const newHead = await this.saveAccountHead({
          code: headCode,
          name: `${data.bank_name.trim()} (${cleanAccNum.slice(-4)})`,
          group_id: 'ag-1000',
          group_name: 'Current Assets / Bank Accounts',
          type: 'asset',
          opening_balance: round2(Number(data.opening_balance) || 0),
          is_system: false
        }, userEmail);
        headId = newHead.id;
      }

      saved = {
        id: newAccId,
        company_id: companyId,
        account_head_id: headId,
        bank_name: data.bank_name.trim(),
        account_name: data.account_name?.trim() || `${data.bank_name.trim()} Operating Account`,
        account_number: cleanAccNum,
        ifsc_code: data.ifsc_code?.trim().toUpperCase() || '',
        branch: data.branch?.trim() || '',
        account_type: data.account_type || 'current',
        opening_balance: round2(Number(data.opening_balance) || 0),
        current_balance: round2(Number(data.opening_balance) || 0),
        is_default: data.is_default || accounts.length === 0,
        created_at: now,
        updated_at: now
      };
      accounts.push(saved);

      // Controlled Opening Balance Double-Entry Entry
      if (saved.opening_balance > 0) {
        try {
          await this.saveJournalEntry({
            company_id: companyId,
            voucher_type: 'journal',
            date: getTodayStr(),
            narration: `Opening balance for ${saved.bank_name} (${saved.account_number})`,
            lines: [
              { account_id: headId, account_code: headCode, account_name: saved.account_name, debit: saved.opening_balance, credit: 0 },
              { account_id: 'ah-3001', account_code: '3001', account_name: 'Owner Capital & Equity', debit: 0, credit: saved.opening_balance }
            ],
            reference_type: 'bank_account',
            reference_id: saved.id,
            reference_number: `OP-${saved.account_number.slice(-4)}`,
            financial_year: this.getIndianFinancialYearForDate(getTodayStr())
          }, userEmail, 'post');
        } catch (e) {
          console.warn('Opening balance journal notice:', e);
        }
      }
    }

    await persistFinanceRow(STORAGE_KEYS.BANK_ACCOUNTS, 'bank_accounts', accounts, saved as any);
    this.logFinancialAudit('BANK_ACCOUNT_SAVED', 'bank_account', saved.id, `Saved bank account ${saved.bank_name} (${saved.account_number})`, userEmail, 'owner');
    this.notify();
    return saved;
  }

  public async deleteBankAccount(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const accounts = this.getBankAccounts();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return false;

    // Check if transactions exist in bank book
    const book = this.getBankBook(acc.account_head_id || acc.id);
    if (book.entries.length > 0) {
      throw new Error(`Cannot delete bank account ${acc.bank_name}: Account has ${book.entries.length} posted transactions in the General Ledger.`);
    }

    const filtered = accounts.filter(a => a.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.BANK_ACCOUNTS, 'bank_accounts', filtered, id);
    this.logFinancialAudit('BANK_ACCOUNT_DELETED', 'bank_account', id, `Deleted bank account ${acc.bank_name}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getCashBook(cashAccountId?: string, startDate?: string, endDate?: string, companyId?: string): {
    entries: CashBookEntry[];
    total_receipts: number;
    total_payments: number;
    closing_balance: number;
  } {
    const journals = this.getJournalEntries({ startDate, endDate, status: 'POSTED', companyId });
    let running = 0;
    const entries: CashBookEntry[] = [];

    [...journals].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(j => {
      j.lines.forEach(l => {
        let matchesCash = false;
        if (cashAccountId) {
          matchesCash = l.account_id === cashAccountId || l.account_code === cashAccountId;
        } else {
          matchesCash = l.account_id === 'ah-1001' || l.account_code === '1001' || l.account_code?.startsWith('1001');
        }

        if (matchesCash) {
          running = running + l.debit - l.credit;
          entries.push({
            date: j.date,
            reference: j.voucher_number,
            description: j.narration,
            voucher_type: j.voucher_type,
            debit: l.debit,
            credit: l.credit,
            balance: round2(running)
          });
        }
      });
    });

    return {
      entries,
      total_receipts: round2(entries.reduce((s, e) => s + e.debit, 0)),
      total_payments: round2(entries.reduce((s, e) => s + e.credit, 0)),
      closing_balance: round2(running)
    };
  }

  public getBankBook(bankAccountId?: string, startDate?: string, endDate?: string, companyId?: string): {
    entries: BankBookEntry[];
    total_deposits: number;
    total_withdrawals: number;
    closing_balance: number;
  } {
    const journals = this.getJournalEntries({ startDate, endDate, status: 'POSTED', companyId });
    let running = 0;
    const entries: BankBookEntry[] = [];

    [...journals].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(j => {
      j.lines.forEach(l => {
        let matchesBank = false;
        if (bankAccountId) {
          matchesBank = l.account_id === bankAccountId || l.account_code === bankAccountId;
        } else {
          matchesBank = l.account_id === 'ah-1002' || l.account_code === '1002' || l.account_code?.startsWith('1002') || l.account_id?.startsWith('ah-1002');
        }

        if (matchesBank) {
          running = running + l.debit - l.credit;
          entries.push({
            date: j.date,
            reference: j.voucher_number,
            description: j.narration,
            voucher_type: j.voucher_type,
            debit: l.debit,
            credit: l.credit,
            balance: round2(running)
          });
        }
      });
    });

    return {
      entries,
      total_deposits: round2(entries.reduce((s, e) => s + e.debit, 0)),
      total_withdrawals: round2(entries.reduce((s, e) => s + e.credit, 0)),
      closing_balance: round2(running)
    };
  }

  public async recordContraVoucher(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date = getTodayStr(),
    reference = '',
    userEmail = 'accounts@b2p.com',
    companyId = 'default'
  ): Promise<JournalEntry> {
    if (amount <= 0) {
      throw new Error('Contra voucher amount must be greater than zero.');
    }
    if (fromAccountId === toAccountId) {
      throw new Error('Source and Destination accounts must be different.');
    }

    if (this.isDateInLockedPeriod(date)) {
      throw new Error(`Financial period for date ${date} is LOCKED. Cannot record contra transfers.`);
    }

    // Duplicate Reference Guard
    if (reference?.trim()) {
      const cleanRef = reference.trim().toLowerCase();
      const existingEntries = this.getJournalEntries({ companyId });
      const duplicate = existingEntries.find(e => 
        e.voucher_type === 'contra' &&
        e.reference_number?.trim().toLowerCase() === cleanRef
      );
      if (duplicate) {
        throw new Error(`Duplicate reference: A contra transfer with reference "${reference}" already exists.`);
      }
    }

    const fromHead = this.getAccountHeadById(fromAccountId) || { id: fromAccountId, code: '1001', name: 'Cash in Hand (Office Vault)' };
    const toHead = this.getAccountHeadById(toAccountId) || { id: toAccountId, code: '1002', name: 'Bank Operating Current Account' };

    const jv = await this.saveJournalEntry({
      company_id: companyId,
      voucher_type: 'contra',
      date,
      narration: `Funds Transfer / Cash Contra: ${fromHead.name} → ${toHead.name} (Ref: ${reference || 'N/A'})`,
      reference_type: 'contra',
      reference_number: reference?.trim() || undefined,
      lines: [
        { account_id: toHead.id, account_code: toHead.code, account_name: toHead.name, debit: amount, credit: 0 },
        { account_id: fromHead.id, account_code: fromHead.code, account_name: fromHead.name, debit: 0, credit: amount }
      ],
      financial_year: this.getIndianFinancialYearForDate(date)
    }, userEmail, 'post');

    this.logFinancialAudit(
      'CONTRA_TRANSFER_RECORDED',
      'contra_voucher',
      jv.id,
      `Recorded ₹${amount} transfer from ${fromHead.name} to ${toHead.name} (Ref: ${reference || 'N/A'})`,
      userEmail,
      'accounts'
    );

    return jv;
  }

  public getBankReconciliation(
    bankAccountId: string,
    statementBalance = 0,
    asOfDate = getTodayStr(),
    importedItems: BankReconciliationItem[] = [],
    companyId?: string
  ): BankReconciliationStatement {
    const bankBook = this.getBankBook(bankAccountId, undefined, asOfDate, companyId);
    const accounts = this.getBankAccounts(companyId);
    const acc = accounts.find(a => a.id === bankAccountId || a.account_head_id === bankAccountId);
    const bankAccountName = acc ? `${acc.bank_name} (${acc.account_number.slice(-4)})` : 'Bank Operating Current Account';

    const book_balance = bankBook.closing_balance;
    const difference = round2(statementBalance - book_balance);

    const reconItems: BankReconciliationItem[] = [];
    let cleared_balance = 0;
    let unreconciled_balance = 0;

    // Match imported statement lines with book transactions
    importedItems.forEach(item => {
      const match = bankBook.entries.find(e => 
        (item.reference_number && e.reference.toLowerCase().includes(item.reference_number.toLowerCase())) ||
        Math.abs(e.debit - item.amount) < 0.01 ||
        Math.abs(e.credit - item.amount) < 0.01
      );

      if (match) {
        cleared_balance += item.amount;
        reconItems.push({
          ...item,
          matched_voucher_id: match.reference,
          matched_voucher_number: match.reference,
          status: 'matched'
        });
      } else {
        unreconciled_balance += item.amount;
        reconItems.push({
          ...item,
          status: 'unreconciled'
        });
      }
    });

    return {
      id: `rec-stmt-${bankAccountId}-${asOfDate}`,
      company_id: companyId || 'default',
      bank_account_id: bankAccountId,
      bank_account_name: bankAccountName,
      as_of_date: asOfDate,
      statement_balance: round2(statementBalance),
      book_balance: round2(book_balance),
      difference,
      cleared_balance: round2(cleared_balance),
      unreconciled_balance: round2(unreconciled_balance),
      items: reconItems,
      reconciled_by_email: 'accounts@b2p.com',
      reconciled_at: new Date().toISOString()
    };
  }

  // REMEDIATION (2026-08-24, follow-up pass): this used to be a
  // synchronous, localStorage-only method - the one entity from the
  // Phase 4.5 schema never wired to Supabase in the first remediation
  // pass. Now follows the exact same persistFinanceRow pattern as every
  // other save method in this file, with `items` persisted as an
  // embedded JSONB column (see the phase4.8 migration note), matching
  // the precedent already set for purchase_bills.items/
  // journal_entries.lines rather than writing through the separate
  // bank_reconciliation_items child table.
  public async saveBankReconciliationStatement(data: Partial<BankReconciliationStatement>, userEmail = 'accounts@b2p.com'): Promise<BankReconciliationStatement> {
    const raw = localStorage.getItem(STORAGE_KEYS.BANK_RECON_STATEMENTS);
    const statements: BankReconciliationStatement[] = raw ? JSON.parse(raw) : [];
    const now = new Date().toISOString();
    const companyId = this.resolveCompanyId(data.company_id) || 'default';

    const saved: BankReconciliationStatement = {
      id: data.id || crypto.randomUUID(),
      company_id: companyId,
      bank_account_id: data.bank_account_id || 'ba-default',
      bank_account_name: data.bank_account_name || 'Bank Account',
      as_of_date: data.as_of_date || getTodayStr(),
      statement_balance: round2(Number(data.statement_balance) || 0),
      book_balance: round2(Number(data.book_balance) || 0),
      difference: round2(Number(data.difference) || 0),
      cleared_balance: round2(Number(data.cleared_balance) || 0),
      unreconciled_balance: round2(Number(data.unreconciled_balance) || 0),
      items: data.items || [],
      reconciled_by_email: userEmail,
      reconciled_at: now
    };

    statements.unshift(saved);
    await persistFinanceRow(STORAGE_KEYS.BANK_RECON_STATEMENTS, 'bank_reconciliation_statements', statements, saved as any);
    this.logFinancialAudit('BANK_RECONCILIATION_SAVED', 'bank_reconciliation', saved.id, `Saved reconciliation statement for ${saved.bank_account_name} as of ${saved.as_of_date}`, userEmail, 'accounts');
    this.notify();
    return saved;
  }

  // =====================================================================
  // Sub-Phase 4.3: Suppliers Master, Purchases & Accounts Payable
  // =====================================================================

  public getSuppliers(companyId?: string, includeInactive = false): Supplier[] {
    try {
      const actualRaw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
      let suppliers: Supplier[] = actualRaw ? JSON.parse(actualRaw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        suppliers = suppliers.filter(s => !s.company_id || s.company_id === scopeId);
      }
      if (!includeInactive) {
        suppliers = suppliers.filter(s => s.is_active !== false);
      }
      return suppliers;
    } catch {
      return [];
    }
  }

  public getSupplierById(id: string): Supplier | undefined {
    try {
      const actualRaw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
      const suppliers: Supplier[] = actualRaw ? JSON.parse(actualRaw) : [];
      return suppliers.find(s => s.id === id);
    } catch {
      return undefined;
    }
  }

  public async saveSupplier(data: Partial<Supplier>, userEmail = 'accounts@b2p.com'): Promise<Supplier> {
    if (!data.name || !data.name.trim()) {
      throw new Error('Supplier name is required.');
    }

    const actualRaw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
    const suppliers: Supplier[] = actualRaw ? JSON.parse(actualRaw) : [];
    const now = new Date().toISOString();
    const cleanName = data.name.trim();
    const companyId = this.resolveCompanyId(data.company_id) || 'default';

    // Duplicate check within company
    const duplicate = suppliers.find(s => 
      s.id !== data.id &&
      (!s.company_id || s.company_id === companyId) &&
      s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Supplier with name "${cleanName}" already exists.`);
    }

    // GSTIN validation via authoritative taxEngine
    let cleanGstin = data.gstin?.trim().toUpperCase();
    let stateCode = data.state_code || '32';
    let pan = data.pan;

    if (cleanGstin) {
      const gstinValidation = taxEngine.validateGSTIN(cleanGstin);
      if (!gstinValidation.isValid) {
        throw new Error(gstinValidation.error || 'Invalid statutory GSTIN checksum/format.');
      }
      stateCode = gstinValidation.stateCode || '32';
      if (!pan && gstinValidation.pan) {
        pan = gstinValidation.pan;
      }
    } else {
      cleanGstin = undefined;
    }

    let saved: Supplier;

    if (data.id) {
      const idx = suppliers.findIndex(s => s.id === data.id);
      if (idx !== -1) {
        saved = {
          ...suppliers[idx],
          ...data,
          name: cleanName,
          gstin: cleanGstin,
          state_code: stateCode,
          pan,
          updated_at: now
        } as Supplier;
        suppliers[idx] = saved;
      } else {
        throw new Error('Supplier not found');
      }
    } else {
      saved = {
        id: crypto.randomUUID(),
        company_id: companyId,
        name: cleanName,
        legal_name: data.legal_name || data.company_name,
        company_name: data.company_name || data.legal_name,
        phone: data.phone || '',
        email: data.email,
        address: data.address,
        billing_address: data.billing_address || data.address,
        gstin: cleanGstin,
        pan,
        state: data.state || 'Kerala',
        state_code: stateCode,
        place_of_supply: data.place_of_supply || data.state || 'Kerala',
        payment_terms: data.payment_terms || '30 Days Net',
        opening_balance: round2(Number(data.opening_balance) || 0),
        is_active: data.is_active !== false,
        notes: data.notes,
        created_at: now,
        updated_at: now
      };
      suppliers.unshift(saved);
    }

    await persistFinanceRow(STORAGE_KEYS.SUPPLIERS, 'suppliers', suppliers, saved as any);
    this.logFinancialAudit(
      data.id ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED',
      'supplier',
      saved.id,
      `${data.id ? 'Updated' : 'Created'} supplier ${saved.name} (GSTIN: ${saved.gstin || 'Unregistered'})`,
      userEmail,
      'accounts'
    );
    this.notify();
    return saved;
  }

  public async deleteSupplier(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const supplier = this.getSupplierById(id);
    if (!supplier) throw new Error('Supplier not found');

    const purchases = this.getPurchases().filter(p => p.supplier_id === id);
    if (purchases.length > 0) {
      throw new Error(`Cannot delete supplier "${supplier.name}": Supplier has ${purchases.length} purchase bill(s) in accounting history. Deactivate supplier instead.`);
    }

    const payments = this.getSupplierPayments().filter(p => p.supplier_id === id);
    if (payments.length > 0) {
      throw new Error(`Cannot delete supplier "${supplier.name}": Supplier has ${payments.length} payment disbursement(s) recorded.`);
    }

    const actualRaw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
    const suppliers: Supplier[] = actualRaw ? JSON.parse(actualRaw) : [];
    const filtered = suppliers.filter(s => s.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.SUPPLIERS, 'suppliers', filtered, id);

    this.logFinancialAudit('SUPPLIER_DELETED', 'supplier', id, `Deleted supplier ${supplier.name}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getPurchases(companyId?: string): Purchase[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PURCHASES);
      const purchases: Purchase[] = raw ? JSON.parse(raw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        return purchases.filter(p => !p.company_id || p.company_id === scopeId);
      }
      return purchases;
    } catch {
      return [];
    }
  }

  public getPurchaseById(id: string): Purchase | undefined {
    return this.getPurchases().find(p => p.id === id);
  }

  public async savePurchase(
    data: Partial<Purchase>,
    userEmail = 'accounts@b2p.com',
    action: 'draft' | 'post' = 'post'
  ): Promise<Purchase> {
    const purchaseDate = data.purchase_date || getTodayStr();

    // Check financial period lock
    if (this.isDateInLockedPeriod(purchaseDate)) {
      throw new Error(`Financial period for date ${purchaseDate} is LOCKED. Cannot record or modify purchase bills.`);
    }

    if (!data.supplier_id) {
      throw new Error('Supplier selection is required for purchase bill.');
    }
    if (!data.supplier_invoice_number || !data.supplier_invoice_number.trim()) {
      throw new Error('Supplier invoice number is required.');
    }

    const supplier = this.getSupplierById(data.supplier_id);
    const supplierName = supplier?.name || data.supplier_name || 'Vendor';
    const supplierGstin = supplier?.gstin || data.supplier_gstin;
    const cleanInvoiceNo = data.supplier_invoice_number.trim();
    const companyId = this.resolveCompanyId(data.company_id) || 'default';

    const purchases = this.getPurchases();
    const now = new Date().toISOString();

    // Duplicate Supplier Invoice Check (Company + Supplier + Invoice Number)
    const duplicateBill = purchases.find(p => 
      p.id !== data.id &&
      (!p.company_id || p.company_id === companyId) &&
      p.supplier_id === data.supplier_id &&
      p.supplier_invoice_number.trim().toLowerCase() === cleanInvoiceNo.toLowerCase() &&
      p.status !== 'cancelled'
    );
    if (duplicateBill) {
      throw new Error(`Duplicate supplier invoice: Bill #${cleanInvoiceNo} from supplier "${supplierName}" was already recorded on ${duplicateBill.purchase_date} (${duplicateBill.purchase_number}).`);
    }

    // Process Line Items and Authoritative Tax Calculations
    const pos = data.place_of_supply || supplier?.place_of_supply || supplier?.state || 'Kerala';
    const rawItems = data.items || [];
    let taxable_value = 0;
    let total_cgst = 0;
    let total_sgst = 0;
    let total_igst = 0;
    let total_cess = 0;

    const processedItems: PurchaseItem[] = rawItems.map((item, idx) => {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.rate) || 0;
      const discount = Number(item.discount) || 0;
      const itemTaxable = round2(Math.max(0, (qty * rate) - discount));
      const gstRate = Number(item.gst_percentage) || 0;

      const taxRes = taxEngine.calculateTax({
        taxableValue: itemTaxable,
        gstRate,
        placeOfSupply: pos,
        customerSupplierGstin: supplierGstin
      });

      taxable_value += taxRes.taxable_value;
      total_cgst += taxRes.cgst_amount;
      total_sgst += taxRes.sgst_amount;
      total_igst += taxRes.igst_amount;
      total_cess += taxRes.cess_amount;

      return {
        id: item.id || `p-item-${idx + 1}`,
        account_id: item.account_id || 'ah-5001',
        account_code: item.account_code || '5001',
        account_name: item.account_name || 'Fleet Fuel & Diesel Expenses',
        description: item.description || 'Goods / Service Item',
        hsn_sac: item.hsn_sac || '998361',
        quantity: qty,
        unit: item.unit || 'units',
        rate,
        discount,
        taxable_amount: taxRes.taxable_value,
        gst_percentage: gstRate,
        cgst: taxRes.cgst_amount,
        sgst: taxRes.sgst_amount,
        igst: taxRes.igst_amount,
        cess: taxRes.cess_amount,
        total_amount: taxRes.total_amount
      };
    });

    const total_gst = round2(total_cgst + total_sgst + total_igst + total_cess);
    const total_amount = round2(taxable_value + total_gst);

    let saved: Purchase;

    if (data.id) {
      const idx = purchases.findIndex(p => p.id === data.id);
      if (idx === -1) throw new Error('Purchase bill not found');

      const existing = purchases[idx];
      // Immutability protection: Cannot silently edit posted purchases
      if (existing.status === 'posted' || existing.status === 'paid' || existing.status === 'partially_paid') {
        throw new Error('Posted purchase bill is immutable. To make changes, reverse the purchase bill and create an updated bill.');
      }

      saved = {
        ...existing,
        ...data,
        supplier_id: data.supplier_id,
        supplier_name: supplierName,
        supplier_gstin: supplierGstin,
        supplier_invoice_number: cleanInvoiceNo,
        items: processedItems,
        taxable_value: round2(taxable_value),
        total_cgst: round2(total_cgst),
        total_sgst: round2(total_sgst),
        total_igst: round2(total_igst),
        total_cess: round2(total_cess),
        total_gst,
        total_amount,
        balance_amount: round2(Math.max(0, total_amount - (existing.paid_amount || 0))),
        updated_at: now
      };
      purchases[idx] = saved;
    } else {
      const purchaseNo = data.purchase_number || this.generateCollisionSafeNumber('BILL', purchases, 'purchase_number', companyId);
      saved = {
        id: crypto.randomUUID(),
        company_id: companyId,
        purchase_number: purchaseNo,
        supplier_id: data.supplier_id,
        supplier_name: supplierName,
        supplier_company: supplier?.company_name || supplier?.legal_name,
        supplier_gstin: supplierGstin,
        supplier_invoice_number: cleanInvoiceNo,
        supplier_invoice_date: data.supplier_invoice_date || purchaseDate,
        purchase_date: purchaseDate,
        due_date: data.due_date || purchaseDate,
        place_of_supply: pos,
        payment_terms: data.payment_terms || supplier?.payment_terms || '30 Days Net',
        items: processedItems,
        taxable_value: round2(taxable_value),
        total_cgst: round2(total_cgst),
        total_sgst: round2(total_sgst),
        total_igst: round2(total_igst),
        total_cess: round2(total_cess),
        total_gst,
        total_amount,
        paid_amount: 0,
        balance_amount: total_amount,
        status: action === 'post' ? 'posted' : 'draft',
        notes: data.notes,
        created_by_email: userEmail,
        created_at: now,
        updated_at: now
      };
      purchases.unshift(saved);
    }

    // Auto-generate and post balanced double-entry Journal Voucher if posting
    if (action === 'post' && saved.total_amount > 0) {
      try {
        const journalLines: any[] = [];
        // Debit each item's selected account head
        processedItems.forEach(item => {
          journalLines.push({
            account_id: item.account_id || 'ah-5001',
            account_code: item.account_code || '5001',
            account_name: item.account_name || 'Fleet Fuel & Diesel Expenses',
            debit: item.taxable_amount,
            credit: 0
          });
        });

        // Debit Input Tax Credits (ITC)
        if (saved.total_cgst > 0) {
          journalLines.push({
            account_id: 'ah-1030',
            account_code: '1030',
            account_name: 'Input CGST (Input Tax Credit)',
            debit: saved.total_cgst,
            credit: 0
          });
        }
        if (saved.total_sgst > 0) {
          journalLines.push({
            account_id: 'ah-1031',
            account_code: '1031',
            account_name: 'Input SGST (Input Tax Credit)',
            debit: saved.total_sgst,
            credit: 0
          });
        }
        if (saved.total_igst > 0) {
          journalLines.push({
            account_id: 'ah-1032',
            account_code: '1032',
            account_name: 'Input IGST (Input Tax Credit)',
            debit: saved.total_igst,
            credit: 0
          });
        }

        // Credit Sundry Creditors (Accounts Payable)
        journalLines.push({
          account_id: 'ah-2001',
          account_code: '2001',
          account_name: 'Accounts Payable (Sundry Creditors)',
          debit: 0,
          credit: saved.total_amount
        });

        const jv = await this.saveJournalEntry({
          company_id: companyId,
          voucher_type: 'purchase',
          date: saved.purchase_date,
          narration: `Purchase Bill #${saved.supplier_invoice_number} from ${saved.supplier_name} (${saved.purchase_number})`,
          lines: journalLines,
          reference_type: 'purchase',
          reference_id: saved.id,
          reference_number: saved.purchase_number,
          financial_year: this.getIndianFinancialYearForDate(saved.purchase_date)
        }, userEmail, 'post');

        saved.journal_entry_id = jv.id;
        saved.status = 'posted';
      } catch (e) {
        console.warn('Purchase journal voucher post notice:', e);
      }
    }

    await persistFinanceRow(STORAGE_KEYS.PURCHASES, 'purchase_bills', purchases, saved as any);
    this.logFinancialAudit(
      'PURCHASE_BILL_RECORDED',
      'purchase_bill',
      saved.id,
      `Recorded purchase bill #${saved.supplier_invoice_number} for ₹${saved.total_amount} from ${saved.supplier_name} (${saved.status.toUpperCase()})`,
      userEmail,
      'accounts'
    );
    this.notify();
    return saved;
  }

  public async reversePurchase(id: string, reason: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const purchase = this.getPurchaseById(id);
    if (!purchase) throw new Error('Purchase bill not found');
    if (purchase.status === 'cancelled') throw new Error('Purchase bill is already cancelled.');
    if (purchase.paid_amount > 0) {
      throw new Error(`Cannot reverse purchase bill #${purchase.purchase_number}: Bill has ₹${purchase.paid_amount} in payments applied. Reverse associated supplier payments first.`);
    }
    // REMEDIATION (2026-08-24, P1 item 8): locked-period enforcement now
    // applies to every destructive/cancellation path, not just creation.
    if (this.isDateInLockedPeriod(purchase.purchase_date)) {
      throw new Error(`Financial period for date ${purchase.purchase_date} is LOCKED. Cannot reverse this purchase bill.`);
    }

    if (purchase.journal_entry_id) {
      try {
        await this.createReversingJournalEntry(purchase.journal_entry_id, `Purchase reversal: ${reason}`, userEmail);
      } catch (e) {
        console.warn('Journal reversal notice:', e);
      }
    }

    const purchases = this.getPurchases();
    const idx = purchases.findIndex(p => p.id === id);
    if (idx !== -1) {
      purchases[idx].status = 'cancelled';
      purchases[idx].balance_amount = 0;
      purchases[idx].updated_at = new Date().toISOString();
      await persistFinanceRow(STORAGE_KEYS.PURCHASES, 'purchase_bills', purchases, purchases[idx] as any);
    }

    this.logFinancialAudit('PURCHASE_BILL_REVERSED', 'purchase_bill', id, `Reversed purchase bill #${purchase.purchase_number}: ${reason}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public async deletePurchase(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const purchase = this.getPurchaseById(id);
    if (!purchase) return false;
    if (purchase.status === 'posted' || purchase.paid_amount > 0) {
      throw new Error(`Posted purchase bill cannot be deleted. Use reversal instead.`);
    }
    // REMEDIATION (2026-08-24, P1 item 8): a draft purchase dated inside
    // a now-locked period must not be silently removable either - the
    // period's numbers must stay exactly as they were when it was locked.
    if (this.isDateInLockedPeriod(purchase.purchase_date)) {
      throw new Error(`Financial period for date ${purchase.purchase_date} is LOCKED. Cannot delete this purchase bill.`);
    }
    const filtered = this.getPurchases().filter(p => p.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.PURCHASES, 'purchase_bills', filtered, id);
    this.logFinancialAudit('PURCHASE_BILL_DELETED', 'purchase_bill', id, `Deleted draft purchase bill ID ${id}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getExpenses(companyId?: string): Expense[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      const expenses: Expense[] = raw ? JSON.parse(raw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        return expenses.filter(e => !e.company_id || e.company_id === scopeId);
      }
      return expenses;
    } catch {
      return [];
    }
  }

  public getExpenseById(id: string): Expense | undefined {
    return this.getExpenses().find(e => e.id === id);
  }

  // REMEDIATION (2026-08-24, P1 item 9): maps each expense category to
  // the account head it debits when posted to the General Ledger.
  // "Advertising"/"Office Expenses"/"Equipment" have no dedicated head in
  // DEFAULT_ACCOUNT_HEADS and fall back to the general admin head
  // (5505) rather than inventing new system accounts silently.
  private static readonly EXPENSE_CATEGORY_ACCOUNT: Record<string, { code: string; name: string }> = {
    'Fuel': { code: '5001', name: 'Fleet Diesel & Generator Fuel' },
    'Vehicle Maintenance': { code: '5002', name: 'Vehicle Maintenance & Spares' },
    'Staff Expenses': { code: '5003', name: 'Operator & Crew Wages' },
    'Printing': { code: '5004', name: 'Flex & Vinyl Printing Costs' },
    'Rent': { code: '5501', name: 'Office Rent & Workspace Lease' },
    'Electricity': { code: '5502', name: 'Electricity & Power Utilities' },
    'Internet': { code: '5503', name: 'Broadband & Communication' },
    'Travel': { code: '5504', name: 'Travel & Field Logistics' },
    'Advertising': { code: '5505', name: 'Office & General Administration' },
    'Office Expenses': { code: '5505', name: 'Office & General Administration' },
    'Equipment': { code: '5505', name: 'Office & General Administration' },
    'Miscellaneous': { code: '5505', name: 'Office & General Administration' }
  };

  public async saveExpense(data: Partial<Expense>, userEmail = 'accounts@b2p.com'): Promise<Expense> {
    const expenseDate = data.expense_date || getTodayStr();

    // REMEDIATION (2026-08-24, P1 item 8): expenses previously had NO
    // period-lock check at all on creation, unlike every other
    // transaction type (receipts, supplier payments, purchases,
    // journal entries) which already enforced this.
    if (this.isDateInLockedPeriod(expenseDate)) {
      throw new Error(`Financial period for date ${expenseDate} is LOCKED. Cannot record or modify expenses.`);
    }

    const amount = round2(Number(data.amount) || 0);
    if (amount <= 0) throw new Error('Expense amount must be greater than zero.');
    const gstAmount = round2(Math.min(Number(data.gst_amount) || 0, amount));

    const expenses = this.getExpenses();
    const now = new Date().toISOString();
    const companyId = this.resolveCompanyId(data.company_id) || 'default';
    let saved: Expense;

    if (data.id) {
      const idx = expenses.findIndex(e => e.id === data.id);
      if (idx === -1) throw new Error('Expense not found');
      const existing = expenses[idx];
      // Immutability guard, matching purchases/journal entries: a
      // posted (GL-linked) expense can't be silently edited - see
      // reverseExpense() for the correction path.
      if (existing.journal_entry_id && !existing.is_reversed) {
        throw new Error('This expense has already been posted to the General Ledger and is immutable. Reverse it and record a new expense for corrections.');
      }
      saved = { ...existing, ...data, amount, gst_amount: gstAmount, updated_at: now } as Expense;
      expenses[idx] = saved;
    } else {
      saved = {
        id: crypto.randomUUID(),
        company_id: companyId,
        expense_date: expenseDate,
        category: data.category || 'Miscellaneous',
        description: data.description || 'Expense',
        payee_name: data.payee_name || 'Payee',
        amount,
        gst_amount: gstAmount,
        payment_mode: data.payment_mode || 'bank_transfer',
        reference_number: data.reference_number,
        bank_cash_account: data.bank_cash_account,
        bank_cash_account_id: data.bank_cash_account_id,
        notes: data.notes,
        created_by_email: userEmail,
        created_at: now,
        updated_at: now
      };
      expenses.unshift(saved);
    }

    // REMEDIATION (2026-08-24, P1 item 9): expenses previously never
    // posted a journal entry at all, so they were invisible to the
    // Trial Balance/Balance Sheet/General Ledger - every other
    // transaction type in this file (receipts, supplier payments,
    // purchases, sales invoices) already auto-posts a balanced
    // double-entry voucher; expenses now do too. GST split between
    // CGST/SGST is a simplification (this app's business is
    // Kerala-based/intra-state, matching the default place-of-supply
    // used elsewhere in this file for purchases) - it does not attempt
    // to determine ITC eligibility per category, which would need
    // supplier-GSTIN/place-of-supply fields this form doesn't collect.
    if (!saved.journal_entry_id) {
      try {
        const taxable = round2(amount - gstAmount);
        const acct = FinanceService.EXPENSE_CATEGORY_ACCOUNT[saved.category] || FinanceService.EXPENSE_CATEGORY_ACCOUNT['Miscellaneous'];
        const isCash = saved.payment_mode === 'cash';
        const creditHeadId = saved.bank_cash_account_id || (isCash ? 'ah-1001' : 'ah-1002');
        const creditHeadCode = isCash ? '1001' : '1002';
        const creditHeadName = saved.bank_cash_account || (isCash ? 'Cash in Hand (Office Vault)' : 'Bank Operating Current Account');

        const lines: any[] = [
          { account_id: `ah-${acct.code}`, account_code: acct.code, account_name: acct.name, debit: taxable, credit: 0 }
        ];
        if (gstAmount > 0) {
          const half = round2(gstAmount / 2);
          lines.push({ account_id: 'ah-1030', account_code: '1030', account_name: 'Input CGST (Input Tax Credit)', debit: half, credit: 0 });
          lines.push({ account_id: 'ah-1031', account_code: '1031', account_name: 'Input SGST (Input Tax Credit)', debit: round2(gstAmount - half), credit: 0 });
        }
        lines.push({ account_id: creditHeadId, account_code: creditHeadCode, account_name: creditHeadName, debit: 0, credit: amount });

        const jv = await this.saveJournalEntry({
          company_id: companyId,
          voucher_type: 'expense',
          date: saved.expense_date,
          narration: `Expense: ${saved.description} - paid to ${saved.payee_name} (${saved.category})`,
          lines,
          reference_type: 'expense',
          reference_id: saved.id,
          reference_number: saved.reference_number,
          financial_year: this.getIndianFinancialYearForDate(saved.expense_date)
        }, userEmail, 'post');

        saved.journal_entry_id = jv.id;
      } catch (e) {
        console.warn('Expense journal voucher post notice:', e);
      }
    }

    await persistFinanceRow(STORAGE_KEYS.EXPENSES, 'expenses', expenses, saved as any);
    this.logFinancialAudit(
      data.id ? 'EXPENSE_UPDATED' : 'EXPENSE_RECORDED',
      'expense',
      saved.id,
      `${data.id ? 'Updated' : 'Recorded'} expense of ₹${saved.amount} to ${saved.payee_name} (${saved.category})`,
      userEmail,
      'accounts'
    );
    this.notify();
    return saved;
  }

  // REMEDIATION (2026-08-24, P1 item 10): deleteExpense() used to
  // unconditionally erase the row with zero checks - no existence
  // check, no company check, no period-lock check, and (since expenses
  // now post a journal entry) no reversal of that posting either, which
  // would have silently corrupted the General Ledger. A POSTED expense
  // is now reversed, not deleted: a balancing reversing journal entry is
  // posted and the original row is kept with is_reversed/reversed_at/
  // reversal_journal_entry_id set, preserving the audit trail. Plain
  // delete remains available (via deleteExpense below) ONLY for an
  // expense that was never successfully posted to the GL in the first
  // place (saveExpense's journal post failed and was swallowed) - that
  // is the sole case where nothing needs reversing.
  public async reverseExpense(id: string, reason: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const expenses = this.getExpenses();
    const idx = expenses.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Expense not found.');
    const expense = expenses[idx];

    if (expense.is_reversed) {
      throw new Error('This expense has already been reversed.');
    }
    if (this.isDateInLockedPeriod(expense.expense_date)) {
      throw new Error(`Financial period for date ${expense.expense_date} is LOCKED. Cannot reverse this expense.`);
    }
    if (!reason || !reason.trim()) {
      throw new Error('A reversal reason is required to preserve the audit trail.');
    }

    if (expense.journal_entry_id) {
      await this.createReversingJournalEntry(expense.journal_entry_id, `Expense reversal: ${reason}`, userEmail);
    }

    const updated: Expense = {
      ...expense,
      is_reversed: true,
      reversed_at: new Date().toISOString(),
      reversed_by_email: userEmail,
      reversal_reason: reason.trim(),
      updated_at: new Date().toISOString()
    };
    expenses[idx] = updated;
    await persistFinanceRow(STORAGE_KEYS.EXPENSES, 'expenses', expenses, updated as any);

    this.logFinancialAudit('EXPENSE_REVERSED', 'expense', id, `Reversed expense of ₹${expense.amount} to ${expense.payee_name}: ${reason}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public async deleteExpense(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const expense = this.getExpenseById(id);
    if (!expense) return false;

    // A posted expense (has a live GL entry) must be reversed, never
    // silently erased - matches the immutability rule already used for
    // purchases/supplier payments/customer receipts.
    if (expense.journal_entry_id && !expense.is_reversed) {
      throw new Error('This expense has been posted to the General Ledger and cannot be deleted directly. Use reverseExpense() to reverse it - this preserves the audit trail.');
    }
    if (this.isDateInLockedPeriod(expense.expense_date)) {
      throw new Error(`Financial period for date ${expense.expense_date} is LOCKED. Cannot delete this expense.`);
    }

    const filtered = this.getExpenses().filter(e => e.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.EXPENSES, 'expenses', filtered, id);
    this.logFinancialAudit('EXPENSE_DELETED', 'expense', id, `Deleted expense of ₹${expense.amount} to ${expense.payee_name}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getPaymentsReceived(companyId?: string): PaymentReceived[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PAYMENTS_RECEIVED);
      const payments: PaymentReceived[] = raw ? JSON.parse(raw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        return payments.filter(p => !p.company_id || p.company_id === scopeId);
      }
      return payments;
    } catch {
      return [];
    }
  }

  public async recordPaymentReceived(data: Partial<PaymentReceived>, userEmail = 'accounts@b2p.com'): Promise<PaymentReceived> {
    const paymentDate = data.payment_date || getTodayStr();

    // Check financial period lock
    if (this.isDateInLockedPeriod(paymentDate)) {
      throw new Error(`Financial period for date ${paymentDate} is LOCKED. Cannot record customer receipts in a closed period.`);
    }

    const amount = round2(Number(data.amount) || 0);
    if (amount <= 0) throw new Error('Receipt amount must be greater than zero.');

    const companyId = this.resolveCompanyId(data.company_id) || 'default';
    const payments = this.getPaymentsReceived();
    const now = new Date().toISOString();

    // Duplicate payment reference check within company
    if (data.reference_number?.trim()) {
      const cleanRef = data.reference_number.trim().toLowerCase();
      const duplicate = payments.find(p =>
        (!p.company_id || p.company_id === companyId) &&
        p.reference_number?.trim().toLowerCase() === cleanRef
      );
      if (duplicate) {
        throw new Error(`Duplicate payment reference: A receipt with reference "${data.reference_number}" was already recorded on ${duplicate.payment_date}.`);
      }
    }

    // Process Allocations
    let allocations: CustomerPaymentAllocation[] = [];
    let allocatedTotal = 0;

    if (data.allocations && data.allocations.length > 0) {
      // REMEDIATION (2026-08-24, P1 item 7): strict overpayment guard,
      // matching the one recordSupplierPayment already had - allocating
      // more than an invoice's own outstanding balance was previously
      // accepted with no check at all (only the receipt's own total was
      // validated, never against each target invoice's balance).
      const invoices = await this.getSalesInvoices(companyId);
      allocations = data.allocations.map(alloc => {
        const allocAmt = round2(Number(alloc.allocated_amount) || 0);
        if (allocAmt <= 0) throw new Error('Allocation amount must be greater than zero.');
        const invoice = invoices.find(i => i.id === alloc.document_id);
        if (invoice && allocAmt > invoice.balance_amount + 0.01) {
          throw new Error(`Overpayment guard: Allocated amount (₹${allocAmt}) exceeds outstanding balance (₹${invoice.balance_amount}) for invoice #${invoice.document_number}.`);
        }
        allocatedTotal += allocAmt;
        return {
          document_id: alloc.document_id,
          document_number: alloc.document_number,
          allocated_amount: allocAmt
        };
      });
    } else if (data.document_id) {
      const invoices = await this.getSalesInvoices(companyId);
      const invoice = invoices.find(i => i.id === data.document_id);
      if (invoice && amount > invoice.balance_amount + 0.01) {
        throw new Error(`Overpayment guard: Payment amount (₹${amount}) exceeds outstanding balance (₹${invoice.balance_amount}) for invoice #${invoice.document_number}.`);
      }
      allocatedTotal = amount;
      allocations = [{
        document_id: data.document_id,
        document_number: data.document_number || 'INV',
        allocated_amount: amount
      }];
    }

    if (allocatedTotal > amount) {
      throw new Error(`Total invoice allocations (₹${allocatedTotal}) exceed receipt disbursement amount (₹${amount}).`);
    }

    const advanceAmount = round2(amount - allocatedTotal);
    const isAdvance = data.is_advance || advanceAmount > 0;

    const saved: PaymentReceived = {
      id: data.id || crypto.randomUUID(),
      company_id: companyId,
      payment_number: data.payment_number || this.generateCollisionSafeNumber('RCPT', payments, 'payment_number', companyId, 'B2P'),
      document_id: data.document_id,
      document_number: data.document_number,
      customer_id: data.customer_id,
      customer_name: data.customer_name || 'Customer',
      payment_date: paymentDate,
      amount,
      payment_mode: data.payment_mode || 'bank_transfer',
      reference_number: data.reference_number?.trim() || undefined,
      bank_cash_account: data.bank_cash_account || 'Bank Operating Current Account',
      bank_cash_account_id: data.bank_cash_account_id || (data.payment_mode === 'cash' ? 'ah-1001' : 'ah-1002'),
      is_advance: isAdvance,
      advance_amount: advanceAmount,
      allocations,
      notes: data.notes?.trim() || undefined,
      created_by_email: userEmail,
      created_at: now
    };

    // Auto-post double-entry receipt voucher
    try {
      const isCash = saved.payment_mode === 'cash';
      const debitHead = saved.bank_cash_account_id || (isCash ? 'ah-1001' : 'ah-1002');
      const debitHeadCode = isCash ? '1001' : '1002';
      const debitHeadName = isCash ? 'Cash in Hand (Office Vault)' : 'Bank Operating Current Account';

      const journalLines: any[] = [
        {
          account_id: debitHead,
          account_code: debitHeadCode,
          account_name: debitHeadName,
          debit: amount,
          credit: 0
        }
      ];

      if (allocatedTotal > 0) {
        journalLines.push({
          account_id: 'ah-1010',
          account_code: '1010',
          account_name: 'Accounts Receivable (Sundry Debtors)',
          debit: 0,
          credit: allocatedTotal
        });
      }

      if (advanceAmount > 0) {
        journalLines.push({
          account_id: 'ah-2020',
          account_code: '2020',
          account_name: 'Advances from Customers',
          debit: 0,
          credit: advanceAmount
        });
      }

      const jv = await this.saveJournalEntry({
        company_id: companyId,
        voucher_type: 'receipt',
        date: saved.payment_date,
        narration: `Payment receipt from ${saved.customer_name}${isAdvance ? ' (Includes Advance)' : ''} (Ref: ${saved.reference_number || 'N/A'})`,
        lines: journalLines,
        reference_type: 'receipt',
        reference_id: saved.id,
        reference_number: saved.payment_number,
        financial_year: this.getIndianFinancialYearForDate(saved.payment_date)
      }, userEmail, 'post');

      saved.journal_entry_id = jv.id;
    } catch (e) {
      console.warn('Receipt auto journal notice:', e);
    }

    payments.unshift(saved);
    await persistFinanceRow(STORAGE_KEYS.PAYMENTS_RECEIVED, 'customer_receipts', payments, saved as any);

    this.logFinancialAudit(
      'PAYMENT_RECEIVED',
      'customer_receipt',
      saved.id,
      `Received ₹${saved.amount} from ${saved.customer_name} via ${saved.payment_mode.toUpperCase()} (Ref: ${saved.reference_number || 'N/A'})`,
      userEmail,
      'accounts'
    );

    this.notify();
    return saved;
  }

  public async deletePaymentReceived(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const payments = this.getPaymentsReceived();
    const payment = payments.find(p => p.id === id);
    if (!payment) return false;

    // REMEDIATION (2026-08-24, P1 item 8): locked-period enforcement now
    // applies here too - previously a receipt could be deleted (and its
    // reversing journal silently attempted) even when its payment_date
    // fell inside a period that record creation itself would refuse.
    if (this.isDateInLockedPeriod(payment.payment_date)) {
      throw new Error(`Financial period for date ${payment.payment_date} is LOCKED. Cannot delete this customer receipt.`);
    }

    if (payment.journal_entry_id) {
      try {
        await this.createReversingJournalEntry(payment.journal_entry_id, 'Receipt cancellation reversal', userEmail);
      } catch (e) {
        console.warn('Journal reversal notice:', e);
      }
    }

    const filtered = payments.filter(p => p.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.PAYMENTS_RECEIVED, 'customer_receipts', filtered, id);
    this.logFinancialAudit('PAYMENT_CANCELLED', 'customer_receipt', id, `Cancelled customer payment ID ${id}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getSupplierPayments(companyId?: string): SupplierPayment[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SUPPLIER_PAYMENTS);
      const payments: SupplierPayment[] = raw ? JSON.parse(raw) : [];
      const scopeId = this.resolveCompanyId(companyId);
      if (scopeId) {
        return payments.filter(p => !p.company_id || p.company_id === scopeId);
      }
      return payments;
    } catch {
      return [];
    }
  }

  public generateSupplierPaymentNumber(): string {
    const payments = this.getSupplierPayments();
    return this.generateCollisionSafeNumber('VPY', payments, 'payment_number', this.getActiveCompany() || undefined);
  }

  public async recordSupplierPayment(
    data: Partial<SupplierPayment>,
    userEmail = 'accounts@b2p.com'
  ): Promise<SupplierPayment> {
    const paymentDate = data.payment_date || getTodayStr();

    // Check financial period lock
    if (this.isDateInLockedPeriod(paymentDate)) {
      throw new Error(`Financial period for date ${paymentDate} is LOCKED. Cannot record disbursements in a closed period.`);
    }

    const amount = round2(Number(data.amount) || 0);
    if (amount <= 0) throw new Error('Disbursement amount must be greater than zero.');

    if (!data.supplier_id) throw new Error('Supplier selection is required for payment disbursement.');
    const supplier = this.getSupplierById(data.supplier_id);
    const supplierName = supplier?.name || data.supplier_name || 'Vendor';
    const companyId = this.resolveCompanyId(data.company_id) || 'default';

    const payments = this.getSupplierPayments();
    const purchases = this.getPurchases();
    const now = new Date().toISOString();

    // Duplicate payment reference check within company
    if (data.reference_number?.trim()) {
      const cleanRef = data.reference_number.trim().toLowerCase();
      const duplicate = payments.find(p => 
        (!p.company_id || p.company_id === companyId) &&
        p.reference_number?.trim().toLowerCase() === cleanRef
      );
      if (duplicate) {
        throw new Error(`Duplicate payment reference: A disbursement with reference "${data.reference_number}" was already recorded on ${duplicate.payment_date}.`);
      }
    }

    // Process Allocations
    let allocations: SupplierPaymentAllocation[] = [];
    let allocatedTotal = 0;

    if (data.allocations && data.allocations.length > 0) {
      allocations = data.allocations.map(alloc => {
        const purchase = purchases.find(p => p.id === alloc.purchase_id);
        if (!purchase) {
          throw new Error(`Allocated purchase bill ID ${alloc.purchase_id} does not exist.`);
        }
        if (purchase.status === 'cancelled') {
          throw new Error(`Cannot allocate payment to cancelled purchase bill #${purchase.purchase_number}.`);
        }

        const allocAmt = round2(Number(alloc.allocated_amount) || 0);
        if (allocAmt <= 0) {
          throw new Error(`Allocation amount for bill #${purchase.purchase_number} must be greater than zero.`);
        }

        // Overpayment Guard
        if (allocAmt > (purchase.balance_amount || 0)) {
          throw new Error(`Overpayment guard: Allocated amount (₹${allocAmt}) exceeds outstanding balance (₹${purchase.balance_amount}) for bill #${purchase.purchase_number}.`);
        }

        return {
          purchase_id: purchase.id,
          purchase_number: purchase.purchase_number,
          supplier_invoice_number: purchase.supplier_invoice_number,
          allocated_amount: allocAmt
        };
      });

      allocatedTotal = round2(allocations.reduce((sum, a) => sum + a.allocated_amount, 0));
      if (allocatedTotal > amount) {
        throw new Error(`Total bill allocations (₹${allocatedTotal}) exceed payment amount (₹${amount}).`);
      }
    }

    // Determine if it's an advance or bill settlement
    const isAdvance = allocations.length === 0;

    // Apply allocations to purchases
    if (allocations.length > 0) {
      allocations.forEach(alloc => {
        const pIdx = purchases.findIndex(p => p.id === alloc.purchase_id);
        if (pIdx !== -1) {
          const p = purchases[pIdx];
          const newPaid = round2((p.paid_amount || 0) + alloc.allocated_amount);
          const newBal = round2(Math.max(0, p.total_amount - newPaid));
          let newStatus: Purchase['status'] = 'partially_paid';
          if (newBal === 0) newStatus = 'paid';

          purchases[pIdx] = {
            ...p,
            paid_amount: newPaid,
            balance_amount: newBal,
            status: newStatus,
            updated_at: now
          };
        }
      });
      for (const alloc of allocations) {
        const updatedPurchase = purchases.find(p => p.id === alloc.purchase_id);
        if (updatedPurchase) {
          await persistFinanceRow(STORAGE_KEYS.PURCHASES, 'purchase_bills', purchases, updatedPurchase as any);
        }
      }
    }

    const saved: SupplierPayment = {
      id: data.id || crypto.randomUUID(),
      company_id: companyId,
      payment_number: data.payment_number || this.generateCollisionSafeNumber('VPY', payments, 'payment_number', companyId),
      supplier_id: data.supplier_id,
      supplier_name: supplierName,
      purchase_id: allocations.length === 1 ? allocations[0].purchase_id : undefined,
      purchase_number: allocations.length === 1 ? allocations[0].purchase_number : undefined,
      allocations,
      payment_date: paymentDate,
      amount,
      payment_mode: data.payment_mode || 'bank_transfer',
      bank_cash_account: data.bank_cash_account || 'Bank Operating Current Account',
      bank_cash_account_id: data.bank_cash_account_id || 'ah-1002',
      reference_number: data.reference_number?.trim() || undefined,
      is_advance: isAdvance,
      notes: data.notes?.trim() || undefined,
      created_by_email: userEmail,
      created_at: now
    };

    // Auto-Post Double Entry Payment Voucher
    try {
      const isCash = data.payment_mode === 'cash';
      const creditHead = data.bank_cash_account_id || (isCash ? 'ah-1001' : 'ah-1002');
      const creditHeadCode = isCash ? '1001' : '1002';
      const creditHeadName = isCash ? 'Cash in Hand (Office Vault)' : 'Bank Operating Current Account';

      const journalLines: any[] = [];
      if (allocatedTotal > 0) {
        journalLines.push({
          account_id: 'ah-2001',
          account_code: '2001',
          account_name: 'Accounts Payable (Sundry Creditors)',
          debit: allocatedTotal,
          credit: 0
        });
      }
      const advanceAmount = round2(amount - allocatedTotal);
      if (advanceAmount > 0) {
        journalLines.push({
          account_id: 'ah-1040',
          account_code: '1040',
          account_name: 'Advances to Suppliers & Contractors',
          debit: advanceAmount,
          credit: 0
        });
      }
      journalLines.push({
        account_id: creditHead,
        account_code: creditHeadCode,
        account_name: creditHeadName,
        debit: 0,
        credit: amount
      });

      const jv = await this.saveJournalEntry({
        company_id: companyId,
        voucher_type: 'payment',
        date: saved.payment_date,
        narration: `Payment disbursed to ${saved.supplier_name}${allocations.length > 0 ? ` for bills: ${allocations.map(a => a.supplier_invoice_number).join(', ')}` : ' (Supplier Advance)'} (Ref: ${saved.reference_number || 'N/A'})`,
        lines: journalLines,
        reference_type: 'supplier_payment',
        reference_id: saved.id,
        reference_number: saved.payment_number,
        financial_year: this.getIndianFinancialYearForDate(saved.payment_date)
      }, userEmail, 'post');

      saved.journal_entry_id = jv.id;
    } catch (e) {
      console.warn('Payment voucher auto post notice:', e);
    }

    payments.unshift(saved);
    await persistFinanceRow(STORAGE_KEYS.SUPPLIER_PAYMENTS, 'supplier_payments', payments, saved as any);

    this.logFinancialAudit(
      'SUPPLIER_PAYMENT_DISBURSED',
      'supplier_payment',
      saved.id,
      `Disbursed ₹${saved.amount} to supplier ${saved.supplier_name} via ${saved.payment_mode.toUpperCase()} (Ref: ${saved.reference_number || 'N/A'})`,
      userEmail,
      'accounts'
    );

    this.notify();
    return saved;
  }

  public async deleteSupplierPayment(id: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const payments = this.getSupplierPayments();
    const payment = payments.find(p => p.id === id);
    if (!payment) return false;

    // REMEDIATION (2026-08-24, P1 item 8): locked-period enforcement,
    // matching the guard added to deletePaymentReceived/deletePurchase.
    if (this.isDateInLockedPeriod(payment.payment_date)) {
      throw new Error(`Financial period for date ${payment.payment_date} is LOCKED. Cannot delete this supplier payment.`);
    }

    // Restore purchase bill balances if allocations existed
    if (payment.allocations && payment.allocations.length > 0) {
      const purchases = this.getPurchases();
      payment.allocations.forEach(alloc => {
        const pIdx = purchases.findIndex(p => p.id === alloc.purchase_id);
        if (pIdx !== -1) {
          const p = purchases[pIdx];
          const newPaid = round2(Math.max(0, (p.paid_amount || 0) - alloc.allocated_amount));
          const newBal = round2(p.total_amount - newPaid);
          let pStatus: Purchase['status'] = 'posted';
          if (newBal <= 0) pStatus = 'paid';
          else if (newPaid > 0) pStatus = 'partially_paid';

          purchases[pIdx] = {
            ...p,
            paid_amount: newPaid,
            balance_amount: newBal,
            status: pStatus,
            updated_at: new Date().toISOString()
          };
        }
      });
      for (const alloc of payment.allocations) {
        const updatedPurchase = purchases.find(p => p.id === alloc.purchase_id);
        if (updatedPurchase) {
          await persistFinanceRow(STORAGE_KEYS.PURCHASES, 'purchase_bills', purchases, updatedPurchase as any);
        }
      }
    }

    if (payment.journal_entry_id) {
      try {
        await this.createReversingJournalEntry(payment.journal_entry_id, 'Payment cancellation reversal', userEmail);
      } catch (e) {
        console.warn('Journal reversal notice:', e);
      }
    }

    const filtered = payments.filter(p => p.id !== id);
    await persistFinanceRowDeleted(STORAGE_KEYS.SUPPLIER_PAYMENTS, 'supplier_payments', filtered, id);
    this.logFinancialAudit('SUPPLIER_PAYMENT_CANCELLED', 'supplier_payment', id, `Cancelled vendor disbursement ID ${id}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public getAccountsPayableSummary(companyId?: string, asOfDate = getTodayStr()): AccountsPayableSummary {
    const purchases = this.getPurchases(companyId).filter(p => p.status !== 'cancelled' && p.status !== 'draft');
    const today = new Date(asOfDate);
    const todayTime = today.getTime();
    const sevenDaysTime = todayTime + 7 * 86400000;
    const thirtyDaysTime = todayTime + 30 * 86400000;

    let total_payables = 0;
    let due_today = 0;
    let overdue_payables = 0;
    let due_in_7_days = 0;
    let due_in_30_days = 0;
    let total_paid = 0;
    let open_bills_count = 0;

    let current = 0;
    let bucket_1_30 = 0;
    let bucket_31_60 = 0;
    let bucket_61_90 = 0;
    let bucket_90_plus = 0;

    purchases.forEach(p => {
      total_paid += p.paid_amount || 0;
      const balance = p.balance_amount || 0;
      if (balance > 0) {
        total_payables += balance;
        open_bills_count++;

        const dueDate = new Date(p.due_date);
        const dueDateTime = dueDate.getTime();
        const diffDays = Math.floor((todayTime - dueDateTime) / (1000 * 60 * 60 * 24));

        if (p.due_date === asOfDate) {
          due_today += balance;
        }

        if (diffDays > 0) {
          overdue_payables += balance;
          if (diffDays <= 30) bucket_1_30 += balance;
          else if (diffDays <= 60) bucket_31_60 += balance;
          else if (diffDays <= 90) bucket_61_90 += balance;
          else bucket_90_plus += balance;
        } else {
          current += balance;
          if (dueDateTime >= todayTime && dueDateTime <= sevenDaysTime) {
            due_in_7_days += balance;
          }
          if (dueDateTime >= todayTime && dueDateTime <= thirtyDaysTime) {
            due_in_30_days += balance;
          }
        }
      }
    });

    return {
      total_payables: round2(total_payables),
      due_today: round2(due_today),
      overdue_payables: round2(overdue_payables),
      due_in_7_days: round2(due_in_7_days),
      due_in_30_days: round2(due_in_30_days),
      total_paid: round2(total_paid),
      aging: {
        current: round2(current),
        bucket_1_30: round2(bucket_1_30),
        bucket_31_60: round2(bucket_31_60),
        bucket_61_90: round2(bucket_61_90),
        bucket_90_plus: round2(bucket_90_plus),
        total_overdue: round2(overdue_payables),
        total_payables: round2(total_payables)
      },
      open_bills_count
    };
  }

  public async getSalesInvoices(companyId?: string): Promise<(Document & { paid_amount: number; balance_amount: number; payment_status: InvoicePaymentStatus })[]> {
    const allDocs = await dbService.getDocuments();
    const payments = this.getPaymentsReceived(companyId);
    const todayStr = getTodayStr();

    // Authoritative Filter: Invoices only (Proformas and Quotations are non-accounting and excluded)
    let salesDocs = allDocs.filter(d => 
      d.document_type === 'invoice' || 
      d.document_type === 'non_tax_invoice'
    );

    if (companyId) {
      salesDocs = salesDocs.filter(d => !d.company_id || d.company_id === companyId);
    }

    return salesDocs.map(doc => {
      // REMEDIATION (2026-08-24, P1 item 6): a receipt split across
      // multiple invoices (RecordPaymentModal.tsx lets a user allocate
      // one receipt across several outstanding invoices) previously
      // credited only the ONE invoice matching the payment's legacy
      // top-level document_id/document_number - with the payment's FULL
      // amount, not that invoice's own allocated share. Every other
      // invoice in the split showed zero payment and stayed
      // overdue/unpaid forever. paid_amount is now summed from each
      // payment's allocations[] (each allocation's own allocated_amount
      // against ITS document_id) - the same relational shape the Phase
      // 4.4 migration already modeled. The legacy top-level
      // document_id/amount match is kept ONLY as a fallback for
      // payments that predate allocations (allocations is empty/unset).
      const paid_amount = round2(payments.reduce((sum, p) => {
        if (p.allocations && p.allocations.length > 0) {
          const allocSum = p.allocations
            .filter(a => a.document_id === doc.id)
            .reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0);
          return sum + allocSum;
        }
        if (p.document_id === doc.id || (p.document_number && p.document_number === doc.document_number)) {
          return sum + (Number(p.amount) || 0);
        }
        return sum;
      }, 0));
      const balance_amount = round2(Math.max(0, Number(doc.total || 0) - paid_amount));

      let payment_status: InvoicePaymentStatus = 'issued';
      if (((doc.status as unknown) as string) === 'draft') {
        payment_status = 'draft';
      } else if (doc.status === 'rejected') {
        payment_status = 'cancelled';
      } else if (balance_amount === 0 && Number(doc.total) > 0) {
        payment_status = 'paid';
      } else if (paid_amount > 0 && balance_amount > 0) {
        payment_status = 'partially_paid';
      } else if ((doc as any).due_date && (doc as any).due_date < todayStr && balance_amount > 0) {
        payment_status = 'overdue';
      }

      return {
        ...doc,
        paid_amount,
        balance_amount,
        payment_status
      };
    });
  }

  public async postSalesInvoice(doc: Document, userEmail = 'accounts@b2p.com'): Promise<JournalEntry> {
    if (doc.document_type !== 'invoice' && doc.document_type !== 'non_tax_invoice') {
      throw new Error(`Only Tax Invoices and Non-Tax Sales Invoices can be posted to the General Ledger (received: ${doc.document_type}).`);
    }

    if (this.isDateInLockedPeriod(doc.date || getTodayStr())) {
      throw new Error(`Financial period for date ${doc.date} is LOCKED. Cannot post sales invoice.`);
    }

    // Idempotency Guard: Check if sales journal was already posted for this document
    const existingEntries = this.getJournalEntries();
    const existingJV = existingEntries.find(e => 
      (e.reference_id === doc.id || (e.reference_number === doc.document_number && e.voucher_type === 'journal')) &&
      e.status === 'POSTED'
    );
    if (existingJV) {
      return existingJV;
    }

    const companyId = doc.company_id || 'default';
    const totalAmount = round2(Number(doc.total) || 0);
    if (totalAmount <= 0) {
      throw new Error('Cannot post zero or negative total sales invoice.');
    }

    const taxable = round2(Math.max(0, Number(doc.subtotal || 0) - Number(doc.discount_total || 0)));
    const pos = (doc as any).place_of_supply || (doc as any).shipping_state || (doc as any).customer_state || 'Kerala';
    const custGstin = (doc as any).customer_gstin;

    const taxRes = taxEngine.calculateTax({
      taxableValue: taxable,
      gstRate: 18,
      placeOfSupply: pos,
      customerSupplierGstin: custGstin
    });

    const isInterState = !taxRes.is_intra_state;

    const journalLines: any[] = [
      {
        account_id: 'ah-1010',
        account_code: '1010',
        account_name: 'Accounts Receivable (Sundry Debtors)',
        debit: totalAmount,
        credit: 0
      },
      {
        account_id: 'ah-4001',
        account_code: '4001',
        account_name: 'Media Advertising & Display Revenue',
        debit: 0,
        credit: taxRes.taxable_value
      }
    ];

    if (isInterState) {
      if (taxRes.igst_amount > 0) {
        journalLines.push({
          account_id: 'ah-2012',
          account_code: '2012',
          account_name: 'Output IGST',
          debit: 0,
          credit: taxRes.igst_amount
        });
      }
    } else {
      if (taxRes.cgst_amount > 0) {
        journalLines.push({
          account_id: 'ah-2010',
          account_code: '2010',
          account_name: 'Output CGST',
          debit: 0,
          credit: taxRes.cgst_amount
        });
      }
      if (taxRes.sgst_amount > 0) {
        journalLines.push({
          account_id: 'ah-2011',
          account_code: '2011',
          account_name: 'Output SGST',
          debit: 0,
          credit: taxRes.sgst_amount
        });
      }
    }

    const jv = await this.saveJournalEntry({
      company_id: companyId,
      voucher_type: 'journal',
      date: doc.date || getTodayStr(),
      narration: `Sales Invoice #${doc.document_number} to ${doc.customer_name}`,
      lines: journalLines,
      reference_type: 'sales_invoice',
      reference_id: doc.id,
      reference_number: doc.document_number,
      financial_year: this.getIndianFinancialYearForDate(doc.date || getTodayStr())
    }, userEmail, 'post');

    return jv;
  }

  public async reverseSalesInvoice(docId: string, reason: string, userEmail = 'owner@b2p.com'): Promise<boolean> {
    const docData = await dbService.getDocumentById(docId);
    if (!docData || !docData.document) throw new Error('Sales invoice not found.');

    const doc = docData.document;
    // REMEDIATION (2026-08-24): also catch payments where this invoice
    // was one of several targets in a multi-invoice allocation (not just
    // the payment's own top-level document_id) - same fix as
    // getSalesInvoices above, applied to the reversal guard.
    const payments = this.getPaymentsReceived().filter(p =>
      p.document_id === docId || (p.allocations || []).some(a => a.document_id === docId)
    );
    if (payments.length > 0) {
      throw new Error(`Cannot reverse invoice ${doc.document_number}: Invoice has payments recorded against it. Cancel associated payments first.`);
    }

    // REMEDIATION (2026-08-24, P1 item 8): locked-period enforcement on
    // invoice reversal, matching every other cancellation/reversal path.
    if (this.isDateInLockedPeriod(doc.date || getTodayStr())) {
      throw new Error(`Financial period for date ${doc.date} is LOCKED. Cannot reverse this sales invoice.`);
    }

    const existingEntries = this.getJournalEntries();
    const jv = existingEntries.find(e => e.reference_id === docId && e.status === 'POSTED');
    if (jv) {
      await this.createReversingJournalEntry(jv.id, `Sales invoice reversal: ${reason}`, userEmail);
    }

    doc.status = 'rejected';
    await dbService.saveDocument(doc, docData.items || []);

    this.logFinancialAudit('INVOICE_REVERSED', 'sales_invoice', docId, `Reversed sales invoice #${doc.document_number}: ${reason}`, userEmail, 'owner');
    this.notify();
    return true;
  }

  public async getCustomerReceivablesSummary(companyId?: string, asOfDate = getTodayStr()): Promise<CustomerReceivablesSummary> {
    const invoices = await this.getSalesInvoices(companyId);
    const validInvoices = invoices.filter(i => 
      (i.document_type === 'invoice' || i.document_type === 'non_tax_invoice') && 
      i.payment_status !== 'cancelled' && 
      i.payment_status !== 'draft'
    );

    const todayDate = new Date(asOfDate);
    const todayTime = todayDate.getTime();
    const sevenDaysTime = todayTime + 7 * 86400000;
    const thirtyDaysTime = todayTime + 30 * 86400000;

    let total_receivables = 0;
    let due_today = 0;
    let overdue_receivables = 0;
    let due_in_7_days = 0;
    let due_in_30_days = 0;
    let total_collected = 0;
    let open_invoices_count = 0;

    let current = 0;
    let bucket_1_30 = 0;
    let bucket_31_60 = 0;
    let bucket_61_90 = 0;
    let bucket_90_plus = 0;

    validInvoices.forEach(inv => {
      total_collected += inv.paid_amount || 0;
      const bal = inv.balance_amount || 0;
      if (bal > 0) {
        total_receivables += bal;
        open_invoices_count++;

        const dueDateStr = (inv as any).due_date || inv.date || asOfDate;
        const dueDate = new Date(dueDateStr);
        const dueDateTime = dueDate.getTime();
        const diffDays = Math.floor((todayTime - dueDateTime) / (1000 * 60 * 60 * 24));

        if (dueDateStr === asOfDate) {
          due_today += bal;
        }

        if (diffDays > 0) {
          overdue_receivables += bal;
          if (diffDays <= 30) bucket_1_30 += bal;
          else if (diffDays <= 60) bucket_31_60 += bal;
          else if (diffDays <= 90) bucket_61_90 += bal;
          else bucket_90_plus += bal;
        } else {
          current += bal;
          if (dueDateTime >= todayTime && dueDateTime <= sevenDaysTime) {
            due_in_7_days += bal;
          }
          if (dueDateTime >= todayTime && dueDateTime <= thirtyDaysTime) {
            due_in_30_days += bal;
          }
        }
      }
    });

    return {
      total_receivables: round2(total_receivables),
      due_today: round2(due_today),
      overdue_receivables: round2(overdue_receivables),
      due_in_7_days: round2(due_in_7_days),
      due_in_30_days: round2(due_in_30_days),
      total_collected: round2(total_collected),
      aging: {
        current: round2(current),
        bucket_1_30: round2(bucket_1_30),
        bucket_31_60: round2(bucket_31_60),
        bucket_61_90: round2(bucket_61_90),
        bucket_90_plus: round2(bucket_90_plus),
        total_overdue: round2(overdue_receivables),
        total_receivables: round2(total_receivables)
      },
      open_invoices_count
    };
  }

  public async getCustomerLedger(customerNameOrId: string, startDate?: string, endDate?: string, companyId?: string): Promise<{
    opening_balance: number;
    entries: CustomerLedgerEntry[];
    closing_balance: number;
    total_debits: number;
    total_credits: number;
  }> {
    const allDocs = await dbService.getDocuments();
    const allPayments = this.getPaymentsReceived(companyId);
    const targetLower = customerNameOrId.toLowerCase().trim();

    // Match only postable sales documents
    let matchingDocs = allDocs.filter(d => 
      (d.document_type === 'invoice' || d.document_type === 'non_tax_invoice') &&
      ((d.customer_name && d.customer_name.toLowerCase().trim() === targetLower) ||
       (d.customer_id && d.customer_id === customerNameOrId))
    );

    if (companyId) {
      matchingDocs = matchingDocs.filter(d => !d.company_id || d.company_id === companyId);
    }

    const matchingPayments = allPayments.filter(p => 
      (p.customer_name && p.customer_name.toLowerCase().trim() === targetLower) ||
      (p.customer_id && p.customer_id === customerNameOrId)
    );

    const rawTransactions: { date: string; reference: string; description: string; type: 'invoice' | 'payment' | 'reversal' | 'advance'; debit: number; credit: number }[] = [];

    matchingDocs.forEach(d => {
      if (d.status === 'rejected') {
        rawTransactions.push({
          date: d.date || getTodayStr(),
          reference: d.document_number,
          description: `Cancelled Invoice #${d.document_number}`,
          type: 'reversal',
          debit: 0,
          credit: round2(Number(d.total || 0))
        });
      } else {
        rawTransactions.push({
          date: d.date || getTodayStr(),
          reference: d.document_number,
          description: `${d.document_type === 'invoice' ? 'Tax Invoice' : 'Invoice'} #${d.document_number}`,
          type: 'invoice',
          debit: round2(Number(d.total || 0)),
          credit: 0
        });
      }
    });

    matchingPayments.forEach(p => {
      rawTransactions.push({
        date: p.payment_date,
        reference: p.payment_number,
        description: `Payment Received via ${p.payment_mode.toUpperCase()}${p.is_advance ? ' (Advance)' : ''}`,
        type: p.is_advance ? 'advance' : 'payment',
        debit: 0,
        credit: round2(Number(p.amount || 0))
      });
    });

    rawTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const entries: CustomerLedgerEntry[] = [];

    rawTransactions.forEach((tx, idx) => {
      running = running + tx.debit - tx.credit;
      const inRange = (!startDate || tx.date >= startDate) && (!endDate || tx.date <= endDate);
      if (inRange) {
        entries.push({
          id: `cle-${idx}`,
          date: tx.date,
          reference: tx.reference,
          description: tx.description,
          type: tx.type as any,
          debit: tx.debit,
          credit: tx.credit,
          running_balance: round2(running)
        });
      }
    });

    return {
      opening_balance: 0,
      entries,
      closing_balance: round2(running),
      total_debits: round2(entries.reduce((s, e) => s + e.debit, 0)),
      total_credits: round2(entries.reduce((s, e) => s + e.credit, 0))
    };
  }

  public getSupplierLedger(supplierId: string, startDate?: string, endDate?: string, companyId?: string): {
    opening_balance: number;
    entries: SupplierLedgerEntry[];
    closing_balance: number;
    total_debits: number;
    total_credits: number;
  } {
    const supplier = this.getSupplierById(supplierId);
    const purchases = this.getPurchases(companyId).filter(p => p.supplier_id === supplierId && p.status !== 'cancelled');
    const payments = this.getSupplierPayments(companyId).filter(p => p.supplier_id === supplierId);

    const rawTransactions: { date: string; reference: string; description: string; type: 'purchase' | 'payment' | 'advance'; debit: number; credit: number }[] = [];

    purchases.forEach(p => {
      rawTransactions.push({
        date: p.purchase_date,
        reference: p.purchase_number,
        description: `Purchase Bill #${p.supplier_invoice_number}`,
        type: 'purchase',
        debit: 0,
        credit: round2(Number(p.total_amount || 0))
      });
    });

    payments.forEach(p => {
      rawTransactions.push({
        date: p.payment_date,
        reference: p.payment_number,
        description: `Vendor Payment via ${p.payment_mode.toUpperCase()}${p.is_advance ? ' (Advance)' : ''}`,
        type: p.is_advance ? 'advance' : 'payment',
        debit: round2(Number(p.amount || 0)),
        credit: 0
      });
    });

    rawTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = round2(supplier?.opening_balance || 0);
    const entries: SupplierLedgerEntry[] = [];

    rawTransactions.forEach((tx, idx) => {
      running = running + tx.credit - tx.debit;
      const inRange = (!startDate || tx.date >= startDate) && (!endDate || tx.date <= endDate);
      if (inRange) {
        entries.push({
          id: `sle-${idx}`,
          date: tx.date,
          reference: tx.reference,
          description: tx.description,
          type: tx.type,
          debit: tx.debit,
          credit: tx.credit,
          running_balance: round2(running)
        });
      }
    });

    return {
      opening_balance: round2(supplier?.opening_balance || 0),
      entries,
      closing_balance: round2(running),
      total_debits: round2(entries.reduce((s, e) => s + e.debit, 0)),
      total_credits: round2(entries.reduce((s, e) => s + e.credit, 0))
    };
  }

  public async getGSTSummary(startDate?: string, endDate?: string, companyId?: string): Promise<GSTSummary> {
    const allDocs = await dbService.getDocuments();
    const purchases = this.getPurchases(companyId);
    const expenses = this.getExpenses(companyId);

    let salesInvoices = allDocs.filter(d => 
      (d.document_type === 'invoice' || d.document_type === 'non_tax_invoice') &&
      d.status !== 'rejected' &&
      (!startDate || (d.date && d.date >= startDate)) &&
      (!endDate || (d.date && d.date <= endDate))
    );

    if (companyId) {
      salesInvoices = salesInvoices.filter(d => !d.company_id || d.company_id === companyId);
    }

    let output_taxable = 0;
    let output_cgst = 0;
    let output_sgst = 0;
    let output_igst = 0;

    salesInvoices.forEach(doc => {
      const taxable = Math.max(0, Number(doc.subtotal || 0) - Number(doc.discount_total || 0));
      const pos = (doc as any).place_of_supply || (doc as any).shipping_state || (doc as any).customer_state || 'Kerala';
      const custGstin = (doc as any).customer_gstin;

      const taxResult = taxEngine.calculateTax({
        taxableValue: taxable,
        gstRate: 18,
        placeOfSupply: pos,
        customerSupplierGstin: custGstin
      });

      output_taxable += taxResult.taxable_value;
      output_cgst += taxResult.cgst_amount;
      output_sgst += taxResult.sgst_amount;
      output_igst += taxResult.igst_amount;
    });

    const filteredPurchases = purchases.filter(p => 
      (!startDate || p.purchase_date >= startDate) &&
      (!endDate || p.purchase_date <= endDate)
    );

    let input_taxable = 0;
    let input_cgst = 0;
    let input_sgst = 0;
    let input_igst = 0;

    filteredPurchases.forEach(p => {
      input_taxable += p.taxable_value;
      input_cgst += p.total_cgst;
      input_sgst += p.total_sgst;
      input_igst += p.total_igst;
    });

    const filteredExpenses = expenses.filter(e => 
      e.gst_amount > 0 &&
      (!startDate || e.expense_date >= startDate) &&
      (!endDate || e.expense_date <= endDate)
    );

    filteredExpenses.forEach(e => {
      input_cgst += e.gst_amount / 2;
      input_sgst += e.gst_amount / 2;
    });

    const total_output_gst = output_cgst + output_sgst + output_igst;
    const total_input_gst = input_cgst + input_sgst + input_igst;

    const net_cgst_payable = Math.max(0, output_cgst - input_cgst);
    const net_sgst_payable = Math.max(0, output_sgst - input_sgst);
    const net_igst_payable = Math.max(0, output_igst - input_igst);
    const net_gst_payable = Math.max(0, total_output_gst - total_input_gst);

    return {
      output_taxable: round2(output_taxable),
      output_cgst: round2(output_cgst),
      output_sgst: round2(output_sgst),
      output_igst: round2(output_igst),
      total_output_gst: round2(total_output_gst),
      
      input_taxable: round2(input_taxable),
      input_cgst: round2(input_cgst),
      input_sgst: round2(input_sgst),
      input_igst: round2(input_igst),
      total_input_gst: round2(total_input_gst),

      net_cgst_payable: round2(net_cgst_payable),
      net_sgst_payable: round2(net_sgst_payable),
      net_igst_payable: round2(net_igst_payable),
      net_gst_payable: round2(net_gst_payable),

      output_gst: {
        taxable_sales: round2(output_taxable),
        cgst: round2(output_cgst),
        sgst: round2(output_sgst),
        igst: round2(output_igst),
        total_output: round2(total_output_gst)
      },
      input_gst: {
        taxable_purchases: round2(input_taxable),
        cgst: round2(input_cgst),
        sgst: round2(input_sgst),
        igst: round2(input_igst),
        total_input: round2(total_input_gst)
      }
    };
  }

  public async getProfitAndLoss(startDate?: string, endDate?: string, companyId?: string): Promise<ProfitAndLossReport> {
    const allDocs = await dbService.getDocuments();
    const purchases = this.getPurchases(companyId);
    const expenses = this.getExpenses(companyId);

    let validInvoices = allDocs.filter(d => 
      (d.document_type === 'invoice' || d.document_type === 'non_tax_invoice') &&
      d.status !== 'rejected' &&
      (!startDate || (d.date && d.date >= startDate)) &&
      (!endDate || (d.date && d.date <= endDate))
    );

    if (companyId) {
      validInvoices = validInvoices.filter(d => !d.company_id || d.company_id === companyId);
    }

    const gross_revenue = validInvoices.reduce((sum, d) => sum + Number(d.subtotal || d.total || 0), 0);

    const validPurchases = purchases.filter(p => 
      (!startDate || p.purchase_date >= startDate) &&
      (!endDate || p.purchase_date <= endDate)
    );
    const purchases_cost = validPurchases.reduce((sum, p) => sum + p.taxable_value, 0);

    const validExpenses = expenses.filter(e => 
      (!startDate || e.expense_date >= startDate) &&
      (!endDate || e.expense_date <= endDate)
    );
    const operating_expenses = validExpenses.reduce((sum, e) => sum + e.amount, 0);

    const expense_breakdown: Record<string, number> = {};
    validExpenses.forEach(e => {
      expense_breakdown[e.category] = (expense_breakdown[e.category] || 0) + e.amount;
    });

    const total_expenses = purchases_cost + operating_expenses;
    const net_profit = gross_revenue - total_expenses;
    const net_margin_percentage = gross_revenue > 0 ? Number(((net_profit / gross_revenue) * 100).toFixed(1)) : 0;

    return {
      gross_revenue: round2(gross_revenue),
      total_revenue: round2(gross_revenue),
      purchases_cost: round2(purchases_cost),
      total_purchases: round2(purchases_cost),
      operating_expenses: round2(operating_expenses),
      total_expenses: round2(total_expenses),
      net_profit: round2(net_profit),
      net_margin_percentage,
      expense_breakdown
    };
  }

  public async getBalanceSheet(asOnDate = getTodayStr(), financialYear = 'FY 2026-27', companyId?: string): Promise<BalanceSheetReport> {
    const trial = this.getTrialBalance(asOnDate, financialYear, companyId);

    let fixed_assets = 0;
    let cash_and_bank = 0;
    let sundry_debtors = 0;
    let input_gst = 0;
    let other_current_assets = 0;

    let sundry_creditors = 0;
    let output_gst = 0;
    let short_term_loans = 0;
    let other_liabilities = 0;

    let owner_capital = 0;
    let retained_earnings = 0;

    trial.items.forEach(item => {
      const netValue = item.closing_debit > 0 ? item.closing_debit : -item.closing_credit;
      const netLiabilityValue = item.closing_credit > 0 ? item.closing_credit : -item.closing_debit;

      if (item.type === 'asset') {
        if (item.group_name === 'Fixed Assets') fixed_assets += netValue;
        else if (item.account_code.startsWith('1001') || item.account_code.startsWith('1002')) cash_and_bank += netValue;
        else if (item.account_code === '1010') sundry_debtors += netValue;
        else if (item.account_code.startsWith('103')) input_gst += netValue;
        else other_current_assets += netValue;
      } else if (item.type === 'liability') {
        if (item.account_code === '2001') sundry_creditors += netLiabilityValue;
        else if (item.account_code.startsWith('201')) output_gst += netLiabilityValue;
        else if (item.account_code.startsWith('202')) short_term_loans += netLiabilityValue;
        else other_liabilities += netLiabilityValue;
      } else if (item.type === 'equity') {
        if (item.account_code === '3001') owner_capital += netLiabilityValue;
        else if (item.account_code === '3002') retained_earnings += netLiabilityValue;
      }
      // income/expense account balances are handled below via
      // getLedgerNetProfitFromTrialBalance(), not accumulated here.
    });

    // REMEDIATION (2026-08-24 - Phase 4.6 verification, "Balance Sheet:
    // No direct-read calculation path that contradicts the authoritative
    // ledger"): current_period_profit used to come from a SEPARATE call
    // to getProfitAndLoss(), which derives revenue/expenses by reading
    // raw Document/Purchase/Expense records directly - a parallel
    // calculation path from the trial balance above (which only reflects
    // POSTED journal entries). Any invoice/purchase/expense that existed
    // as a record but was never explicitly posted to the GL
    // (postSalesInvoice is a separate, optional action from creating a
    // Document) would be counted in that P&L but invisible in the
    // trial-balance-derived asset/liability totals, so Assets could
    // permanently fail to equal Liabilities + Equity by exactly that gap
    // - not a rounding artifact, a structural one. Fixed by deriving
    // current-period profit from the SAME trial balance the rest of this
    // statement uses, via the one shared ledger-net-profit helper this
    // method now shares with performYearEndClosing() - by the
    // fundamental double-entry identity, summing every posted income and
    // expense account's net balance is guaranteed to reconcile exactly
    // against every posted asset/liability movement, because every
    // journal entry that produced one also produced the other.
    const current_period_profit = this.getLedgerNetProfitFromTrialBalance(trial);

    const total_assets = fixed_assets + cash_and_bank + sundry_debtors + input_gst + other_current_assets;
    const total_liabilities = sundry_creditors + output_gst + short_term_loans + other_liabilities;
    const total_equity = owner_capital + retained_earnings + current_period_profit;
    const total_liabilities_and_equity = total_liabilities + total_equity;
    const difference = Math.abs(total_assets - total_liabilities_and_equity);

    return {
      as_on_date: asOnDate,
      financial_year: financialYear,
      assets: {
        fixed_assets: round2(fixed_assets),
        current_assets: round2(cash_and_bank + sundry_debtors + input_gst + other_current_assets),
        cash_and_bank: round2(cash_and_bank),
        sundry_debtors: round2(sundry_debtors),
        input_gst: round2(input_gst),
        total_assets: round2(total_assets)
      },
      liabilities: {
        current_liabilities: round2(sundry_creditors + output_gst),
        sundry_creditors: round2(sundry_creditors),
        output_gst: round2(output_gst),
        short_term_loans: round2(short_term_loans),
        total_liabilities: round2(total_liabilities)
      },
      equity: {
        owner_capital: round2(owner_capital),
        retained_earnings: round2(retained_earnings),
        current_period_profit: current_period_profit,
        total_equity: round2(total_equity)
      },
      total_liabilities_and_equity: round2(total_liabilities_and_equity),
      is_balanced: difference < 1.0,
      difference: round2(difference)
    };
  }

  public async getCashFlowStatement(
    startDate?: string,
    endDate?: string,
    companyId?: string
  ): Promise<CashFlowStatement> {
    const paymentsReceived = this.getPaymentsReceived(companyId);
    const supplierPayments = this.getSupplierPayments(companyId);
    const expenses = this.getExpenses(companyId);
    const journals = this.getJournalEntries({ startDate, endDate, status: 'POSTED', companyId });

    // Operating Collections
    const validPayments = paymentsReceived.filter(p => 
      (!startDate || p.payment_date >= startDate) &&
      (!endDate || p.payment_date <= endDate)
    );
    const cash_from_customers = validPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // Operating Disbursements
    const validSupplierPayments = supplierPayments.filter(p => 
      (!startDate || p.payment_date >= startDate) &&
      (!endDate || p.payment_date <= endDate)
    );
    const cash_to_suppliers = validSupplierPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // Direct Operating Expenses Paid
    const validExpenses = expenses.filter(e => 
      (!startDate || e.expense_date >= startDate) &&
      (!endDate || e.expense_date <= endDate)
    );
    const cash_for_operating_expenses = validExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    // Cash Paid for GST
    const cash_for_gst = 0; // Derived when GST challans are posted

    const net_operating_cash = round2(cash_from_customers - cash_to_suppliers - cash_for_operating_expenses - cash_for_gst);

    // Investing Activities (Fixed Asset Purchase/Sale)
    let fixed_assets_purchased = 0;
    let fixed_assets_sold = 0;
    journals.forEach(j => {
      j.lines.forEach(l => {
        if (l.account_code?.startsWith('15')) {
          if (l.debit > 0) fixed_assets_purchased += l.debit;
          if (l.credit > 0) fixed_assets_sold += l.credit;
        }
      });
    });
    const net_investing_cash = round2(fixed_assets_sold - fixed_assets_purchased);

    // Financing Activities (Owner Capital / Drawings)
    let capital_introduced = 0;
    let drawings_by_owner = 0;
    journals.forEach(j => {
      j.lines.forEach(l => {
        if (l.account_code === '3001') {
          if (l.credit > 0) capital_introduced += l.credit;
          if (l.debit > 0) drawings_by_owner += l.debit;
        }
      });
    });
    const net_financing_cash = round2(capital_introduced - drawings_by_owner);

    const net_cash_movement = round2(net_operating_cash + net_investing_cash + net_financing_cash);

    // Opening and Closing Cash & Bank
    const bankBook = this.getBankBook(undefined, undefined, endDate, companyId);
    const cashBook = this.getCashBook(undefined, undefined, endDate, companyId);
    const closing_cash_and_bank = round2(bankBook.closing_balance + cashBook.closing_balance);
    const opening_cash_and_bank = round2(closing_cash_and_bank - net_cash_movement);

    return {
      as_of_date: endDate || getTodayStr(),
      financial_year: this.getIndianFinancialYearForDate(endDate || getTodayStr()),
      operating_activities: {
        cash_from_customers: round2(cash_from_customers),
        cash_to_suppliers: round2(cash_to_suppliers),
        cash_for_operating_expenses: round2(cash_for_operating_expenses),
        cash_for_gst: round2(cash_for_gst),
        net_operating_cash
      },
      investing_activities: {
        fixed_assets_purchased: round2(fixed_assets_purchased),
        fixed_assets_sold: round2(fixed_assets_sold),
        net_investing_cash
      },
      financing_activities: {
        capital_introduced: round2(capital_introduced),
        drawings_by_owner: round2(drawings_by_owner),
        net_financing_cash
      },
      opening_cash_and_bank,
      net_cash_movement,
      closing_cash_and_bank,
      is_reconciled: true
    };
  }

  public getYearEndClosingStatus(financialYear = 'FY 2025-26', companyId = 'default'): YearEndClosingStatus {
    const locks = this.getPeriodLocks();
    const lock = locks.find(l => l.financial_year === financialYear && (!l.company_id || l.company_id === companyId));
    const is_locked = !!lock?.is_locked;

    const raw = localStorage.getItem(STORAGE_KEYS.YEAR_END_CLOSURES);
    const closures = raw ? JSON.parse(raw) : [];
    const closure = closures.find((c: any) => c.financial_year === financialYear && (!c.company_id || c.company_id === companyId));

    const tb = this.getTrialBalance(undefined, financialYear, companyId);

    return {
      financial_year: financialYear,
      is_locked,
      is_closed: !!closure,
      closing_voucher_number: closure?.closing_voucher_number,
      closed_at: closure?.closed_at,
      closed_by_email: closure?.closed_by_email,
      trial_balance_balanced: tb.is_balanced,
      trial_balance_difference: tb.difference,
      net_profit_to_transfer: closure?.net_profit_transferred || 0
    };
  }

  public async performYearEndClosing(
    financialYear: string,
    nextFinancialYear: string,
    userEmail = 'owner@b2p.com',
    companyId = 'default'
  ): Promise<{ success: boolean; closingJv: JournalEntry; lock: FinancialPeriodLock }> {
    // REMEDIATION (2026-08-24 - Phase 4.6 verification, "Closing is
    // idempotent... No duplicate closing entries"): performYearEndClosing
    // previously had NO guard against being run twice for the same
    // financial year + company - a second call would post a SECOND
    // closing journal (double-zeroing every income/expense account into
    // Retained Earnings) and push a second closure record. Explicit
    // reopen/rollback is not implemented anywhere in this app, so once
    // closed, a year stays closed through this method.
    const existingStatus = this.getYearEndClosingStatus(financialYear, companyId);
    if (existingStatus.is_closed) {
      throw new Error(`Financial year ${financialYear} has already been closed (voucher #${existingStatus.closing_voucher_number} on ${existingStatus.closed_at}). Year-end closing cannot be run twice.`);
    }

    const tb = this.getTrialBalance(undefined, financialYear, companyId);
    if (!tb.is_balanced) {
      throw new Error(`Cannot perform year-end closing: Trial balance is out of balance by ₹${tb.difference}. Resolve imbalances first.`);
    }

    // REMEDIATION (2026-08-24 - Phase 4.6 verification, "Closing journal
    // is balanced"): netProfit for the Retained Earnings transfer line
    // used to come from getProfitAndLoss(), a SEPARATE calculation that
    // reads raw Document/Purchase/Expense records directly rather than
    // the posted ledger - the same class of bug fixed in getBalanceSheet
    // above. Whenever that raw-document total didn't exactly match the
    // sum of the income/expense accounts actually being zeroed out below
    // (any unposted document/purchase/expense), the closing voucher's
    // debits and credits would not match, and saveJournalEntry's
    // balance-invariant guard would reject it outright - i.e. year-end
    // closing could never actually complete. netProfit is now derived
    // from the SAME trial-balance figures as the closing lines
    // themselves, so the voucher is balanced by construction.
    const pnl = await this.getProfitAndLoss(undefined, undefined, companyId);

    // Build Closing Journal Entry: Zero out Income and Expense accounts into Retained Earnings (3002)
    // NOTE: only zeroes accounts with a normal-direction balance (income
    // credit-positive, expense debit-positive), matching this method's
    // original scope. An income/expense account sitting at an abnormal
    // (contra) balance is a rare edge case (e.g. revenue reversals
    // exceeding revenue) not handled here or previously - it would be
    // included in getLedgerNetProfitFromTrialBalance()'s total below but
    // not get its own zeroing line, leaving a residual balance carried
    // into the new year for that one account. Flagged rather than
    // silently left undocumented.
    const closingLines: any[] = [];
    const heads = this.getAccountHeads(true);

    heads.forEach(h => {
      const tbItem = tb.items.find(i => i.account_id === h.id);
      if (!tbItem) return;

      if (h.type === 'income' && tbItem.closing_credit > 0) {
        closingLines.push({
          account_id: h.id,
          account_code: h.code,
          account_name: h.name,
          debit: tbItem.closing_credit,
          credit: 0
        });
      } else if (h.type === 'expense' && tbItem.closing_debit > 0) {
        closingLines.push({
          account_id: h.id,
          account_code: h.code,
          account_name: h.name,
          debit: 0,
          credit: tbItem.closing_debit
        });
      }
    });

    // Single shared source of "ledger net profit" - see getBalanceSheet()
    // above, which now uses the exact same helper.
    const netProfit = this.getLedgerNetProfitFromTrialBalance(tb);

    if (netProfit > 0) {
      closingLines.push({
        account_id: 'ah-3002',
        account_code: '3002',
        account_name: 'Retained Earnings & Reserves',
        debit: 0,
        credit: netProfit
      });
    } else if (netProfit < 0) {
      closingLines.push({
        account_id: 'ah-3002',
        account_code: '3002',
        account_name: 'Retained Earnings & Reserves',
        debit: Math.abs(netProfit),
        credit: 0
      });
    }

    // REMEDIATION (2026-08-24, found by the new CRM/finance regression
    // suite - the shared-reference fix above uncovered it once each
    // test's period-lock state stopped silently leaking from the
    // previous test): this used to compute the closing date as
    // `${financialYear.split(' ')[1].split('-')[0]}-03-31` - for
    // "FY 2026-27" that's "2026-03-31", the last day of the PRIOR
    // fiscal year, not the one actually being closed (which ends
    // "2027-03-31"). The lock's own end_date a few lines below already
    // computes this correctly (+1 to the start year) - this now matches
    // it. The wrong date was never caught before because it happened to
    // land inside the always-still-"is_locked: true" FY2025-26 seed
    // lock's own range whenever a NEW FY was closed, and closing FY
    // 2025-26 itself was masked by the shared-reference bug leaving
    // that same lock already unlocked by an earlier, unrelated test.
    const closingDate = `${Number(financialYear.split(' ')[1].split('-')[0]) + 1}-03-31`;

    let closingJv: JournalEntry;
    if (closingLines.length > 0) {
      closingJv = await this.saveJournalEntry({
        company_id: companyId,
        voucher_type: 'journal',
        date: closingDate,
        narration: `Year-End Closing Entry for ${financialYear}: Net profit of ₹${netProfit} transferred to Retained Earnings`,
        lines: closingLines,
        reference_type: 'year_end_closing',
        financial_year: financialYear
      }, userEmail, 'post');
    } else {
      // REMEDIATION (2026-08-24, follow-up pass): no closing lines means
      // no journal was actually posted via saveJournalEntry() - the
      // previous fallback fabricated a synthetic id
      // (`jv-close-${financialYear}`) that isn't a real journal_entries
      // row and isn't even a valid UUID, which would fail the cloud
      // financial_year_closures.closing_journal_id UUID/FK column below.
      // Left undefined instead - there is genuinely no closing voucher
      // to reference in this (rare - zero income/expense balances) case.
      closingJv = {
        id: undefined,
        voucher_number: `NO-CLOSING-ENTRIES-${financialYear}`,
        total_debit: 0,
        total_credit: 0
      } as any;
    }

    // Record Period Lock. REMEDIATION (2026-08-24, follow-up pass): both
    // this and the closure record below used to write straight to
    // localStorage even when a cloud session was active, unlike every
    // other mutation in this file - a real gap, not a documented
    // limitation (togglePeriodLock(), the other place a lock is
    // written, already went through persistFinanceRow correctly; this
    // inline create-or-update path was missed). Now routes through the
    // same cloud-aware helper as everywhere else.
    const locks = this.getPeriodLocks();
    let lock = locks.find(l => l.financial_year === financialYear && (!l.company_id || l.company_id === companyId));
    if (!lock) {
      lock = {
        id: crypto.randomUUID(),
        company_id: companyId,
        financial_year: financialYear,
        period_name: `Annual ${financialYear}`,
        start_date: `${financialYear.split(' ')[1].split('-')[0]}-04-01`,
        end_date: closingDate,
        is_locked: true,
        locked_by_email: userEmail,
        locked_at: new Date().toISOString()
      };
      locks.push(lock);
    } else {
      lock.is_locked = true;
      lock.locked_by_email = userEmail;
      lock.locked_at = new Date().toISOString();
    }
    await persistFinanceRow(STORAGE_KEYS.PERIOD_LOCKS, 'financial_period_locks', locks, { ...lock, company_id: this.resolveCompanyId((lock as any).company_id) } as any);

    // Record Year-End Closure Record
    const raw = localStorage.getItem(STORAGE_KEYS.YEAR_END_CLOSURES);
    const closures = raw ? JSON.parse(raw) : [];
    const closureRecord = {
      id: crypto.randomUUID(),
      company_id: companyId,
      financial_year: financialYear,
      closing_date: new Date().toISOString().split('T')[0],
      closing_journal_id: closingJv.id || undefined,
      closing_voucher_number: closingJv.voucher_number,
      total_revenue: pnl.total_revenue,
      total_expenses: pnl.total_expenses,
      net_profit_transferred: netProfit,
      closed_by_email: userEmail,
      closed_at: new Date().toISOString()
    };
    closures.push(closureRecord);
    await persistFinanceRow(STORAGE_KEYS.YEAR_END_CLOSURES, 'financial_year_closures', closures, closureRecord as any);

    this.logFinancialAudit('YEAR_END_CLOSED', 'year_end_closing', financialYear, `Completed year-end closing for ${financialYear} into ${nextFinancialYear}`, userEmail, 'owner');
    this.notify();

    return { success: true, closingJv, lock };
  }

  public async getFinanceMetrics(companyId?: string): Promise<{
    totalReceivables: number;
    overdueReceivables: number;
    totalPayables: number;
    overduePayables: number;
    collectionsToday: number;
    expensesToday: number;
    cashBalance: number;
    bankBalance: number;
    netProfitMonth: number;
    netGstPayableMonth: number;
    openInvoicesCount: number;
    openPurchasesCount: number;
  }> {
    const invoices = await this.getSalesInvoices(companyId);
    const purchases = this.getPurchases(companyId);
    const expenses = this.getExpenses(companyId);
    const paymentsReceived = this.getPaymentsReceived(companyId);
    const supplierPayments = this.getSupplierPayments(companyId);
    const todayStr = getTodayStr();

    const totalReceivables = invoices.reduce((sum, inv) => sum + inv.balance_amount, 0);
    const overdueReceivables = invoices
      .filter(inv => inv.payment_status === 'overdue')
      .reduce((sum, inv) => sum + inv.balance_amount, 0);
    const openInvoicesCount = invoices.filter(inv => inv.balance_amount > 0).length;

    const totalPayables = purchases.reduce((sum, p) => sum + p.balance_amount, 0);
    const overduePayables = purchases
      .filter(p => p.status === 'overdue' || (p.due_date < todayStr && p.balance_amount > 0))
      .reduce((sum, p) => sum + p.balance_amount, 0);
    const openPurchasesCount = purchases.filter(p => p.balance_amount > 0).length;

    const collectionsToday = paymentsReceived
      .filter(p => p.payment_date === todayStr)
      .reduce((sum, p) => sum + p.amount, 0);
    const expensesToday = expenses
      .filter(e => e.expense_date === todayStr)
      .reduce((sum, e) => sum + e.amount, 0);

    const cashIn = paymentsReceived.filter(p => p.payment_mode === 'cash').reduce((sum, p) => sum + p.amount, 0);
    const cashOut = expenses.filter(e => e.payment_mode === 'cash').reduce((sum, e) => sum + e.amount, 0) +
                    supplierPayments.filter(sp => sp.payment_mode === 'cash').reduce((sum, sp) => sum + sp.amount, 0);
    const cashBalance = Math.max(0, cashIn - cashOut);

    const bankIn = paymentsReceived.filter(p => p.payment_mode !== 'cash').reduce((sum, p) => sum + p.amount, 0);
    const bankOut = expenses.filter(e => e.payment_mode !== 'cash').reduce((sum, e) => sum + e.amount, 0) +
                    supplierPayments.filter(sp => sp.payment_mode !== 'cash').reduce((sum, sp) => sum + sp.amount, 0);
    const bankBalance = Math.max(0, bankIn - bankOut);

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const pnl = await this.getProfitAndLoss(firstDayOfMonth, todayStr, companyId);
    const gst = await this.getGSTSummary(firstDayOfMonth, todayStr, companyId);

    return {
      totalReceivables: round2(totalReceivables),
      overdueReceivables: round2(overdueReceivables),
      totalPayables: round2(totalPayables),
      overduePayables: round2(overduePayables),
      collectionsToday: round2(collectionsToday),
      expensesToday: round2(expensesToday),
      cashBalance: round2(cashBalance),
      bankBalance: round2(bankBalance),
      netProfitMonth: pnl.net_profit,
      netGstPayableMonth: gst.net_gst_payable,
      openInvoicesCount,
      openPurchasesCount
    };
  }

  public getGSTComplianceRules(): GSTComplianceRule[] {
    const rules = taxEngine.getTaxRules();
    return rules.map(r => ({
      id: r.id,
      rule_code: r.rule_code,
      name: r.name,
      effective_from: r.effective_from,
      effective_to: r.effective_to,
      rule_type: 'tax_rate',
      value: `${r.gst_rate}%`,
      description: r.description,
      version: r.version
    }));
  }

  public async getGSTR1Workspace(period = '04-2026', financialYear = 'FY 2026-27'): Promise<GSTR1Workspace> {
    const allDocs = await dbService.getDocuments();
    const invoices = allDocs.filter(d => 
      (d.document_type === 'invoice' || d.document_type === 'non_tax_invoice') &&
      d.status !== 'rejected'
    );

    const b2b_records: GSTR1B2BRecord[] = [];
    const b2c_small_records: any[] = [];
    const hsn_map: Record<string, { desc: string; qty: number; taxable: number; igst: number; cgst: number; sgst: number; total: number }> = {};

    let taxable_total = 0;
    let cgst_total = 0;
    let sgst_total = 0;
    let igst_total = 0;

    invoices.forEach(doc => {
      const taxable = Math.max(0, Number(doc.subtotal || 0) - Number(doc.discount_total || 0));
      const pos = (doc as any).place_of_supply || (doc as any).shipping_state || (doc as any).customer_state || 'Kerala';
      const custGstin = (doc as any).customer_gstin || '';
      const isRegistered = Boolean(custGstin && taxEngine.validateGSTIN(custGstin).isValid);

      const taxRes = taxEngine.calculateTax({
        taxableValue: taxable,
        gstRate: 18,
        placeOfSupply: pos,
        customerSupplierGstin: custGstin
      });

      taxable_total += taxRes.taxable_value;
      cgst_total += taxRes.cgst_amount;
      sgst_total += taxRes.sgst_amount;
      igst_total += taxRes.igst_amount;

      if (isRegistered) {
        b2b_records.push({
          gstin: custGstin.toUpperCase(),
          customer_name: doc.customer_name || 'Client',
          invoice_number: doc.document_number,
          invoice_date: doc.date || getTodayStr(),
          invoice_value: taxRes.total_amount,
          place_of_supply: `${taxRes.place_of_supply_code}-${taxRes.place_of_supply_name}`,
          reverse_charge: false,
          applicable_tax_rate: taxRes.gst_rate,
          taxable_value: taxRes.taxable_value,
          cgst: taxRes.cgst_amount,
          sgst: taxRes.sgst_amount,
          igst: taxRes.igst_amount,
          cess: taxRes.cess_amount
        });
      } else {
        b2c_small_records.push({
          invoice_number: doc.document_number,
          customer_name: doc.customer_name || 'Retail Client',
          place_of_supply: `${taxRes.place_of_supply_code}-${taxRes.place_of_supply_name}`,
          taxable_value: taxRes.taxable_value,
          cgst: taxRes.cgst_amount,
          sgst: taxRes.sgst_amount,
          igst: taxRes.igst_amount,
          total_tax: taxRes.total_tax
        });
      }

      // HSN / SAC Aggregate
      const sac = '998361';
      if (!hsn_map[sac]) {
        hsn_map[sac] = { desc: 'Outdoor Advertising Services', qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, total: 0 };
      }
      hsn_map[sac].qty += 1;
      hsn_map[sac].taxable += taxRes.taxable_value;
      hsn_map[sac].cgst += taxRes.cgst_amount;
      hsn_map[sac].sgst += taxRes.sgst_amount;
      hsn_map[sac].igst += taxRes.igst_amount;
      hsn_map[sac].total += taxRes.total_amount;
    });

    const hsn_summary = Object.entries(hsn_map).map(([sac, data]) => ({
      hsn_sac: sac,
      description: data.desc,
      uqc: 'OTH',
      total_quantity: data.qty,
      total_value: round2(data.total),
      taxable_value: round2(data.taxable),
      integrated_tax: round2(data.igst),
      central_tax: round2(data.cgst),
      state_tax: round2(data.sgst),
      cess: 0
    }));

    const total_tax = round2(cgst_total + sgst_total + igst_total);

    return {
      period,
      financial_year: financialYear,
      status: invoices.length > 0 ? 'validated' : 'draft',
      b2b_records,
      b2c_large_records: [],
      b2c_small_records,
      credit_debit_notes: [],
      hsn_summary,
      taxable_total: round2(taxable_total),
      cgst_total: round2(cgst_total),
      sgst_total: round2(sgst_total),
      igst_total: round2(igst_total),
      cess_total: 0,
      total_tax,
      validation_errors: invoices.length === 0 ? ['No outward sales posted in current period.'] : [],
      last_validated_at: new Date().toISOString()
    };
  }

  public async getGSTR3BWorkspace(period = '04-2026', financialYear = 'FY 2026-27'): Promise<GSTR3BWorkspace> {
    const summary = await this.getGSTSummary();

    return {
      period,
      financial_year: financialYear,
      status: 'draft',
      table3_1_outward_taxable: {
        taxable_val: summary.output_taxable,
        igst: summary.output_igst,
        cgst: summary.output_cgst,
        sgst: summary.output_sgst,
        cess: 0
      },
      table4_itc_eligible: {
        all_other_itc_igst: summary.input_igst,
        all_other_itc_cgst: summary.input_cgst,
        all_other_itc_sgst: summary.input_sgst,
        all_other_itc_cess: 0
      },
      table4_itc_reversed: {
        rule42_43_igst: 0,
        rule42_43_cgst: 0,
        rule42_43_sgst: 0,
        others_igst: 0,
        others_cgst: 0,
        others_sgst: 0
      },
      table4_net_itc: {
        igst: summary.input_igst,
        cgst: summary.input_cgst,
        sgst: summary.input_sgst,
        cess: 0
      },
      table5_tax_payable: {
        igst: summary.net_igst_payable,
        cgst: summary.net_cgst_payable,
        sgst: summary.net_sgst_payable,
        cess: 0,
        total: summary.net_gst_payable
      },
      validation_errors: [],
      last_calculated_at: new Date().toISOString()
    };
  }

  public getGSTR2BReconciliation(importedItems: GSTR2BReconciliationItem[] = []): {
    items: GSTR2BReconciliationItem[];
    total_in_books: number;
    total_in_2b: number;
    matched_count: number;
    mismatched_count: number;
    eligible_itc: number;
    ineligible_itc: number;
  } {
    const purchases = this.getPurchases();
    const reconItems: GSTR2BReconciliationItem[] = [];

    let total_in_books = 0;
    let total_in_2b = 0;
    let matched_count = 0;
    let mismatched_count = 0;
    let eligible_itc = 0;
    let ineligible_itc = 0;

    purchases.forEach(p => {
      total_in_books += p.total_gst;
      // REMEDIATION (2026-08-24, Phase 4.7 verification, "GSTR-2B match
      // condition"): the second OR clause used to be
      // `(i.supplier_gstin && p.supplier_id)` - true for almost every
      // imported row against almost every purchase (any non-empty GSTIN
      // paired with any purchase that has a supplier), so it matched the
      // FIRST imported item regardless of whether its GSTIN actually
      // corresponded to this purchase's supplier - a real
      // statutory-reconciliation correctness bug, not just a style
      // nit. Purchase already carries its own `supplier_gstin` (set at
      // save time from the supplier record), so this now requires an
      // actual GSTIN match, same as invoice-number matching.
      const match2B = importedItems.find(i =>
        i.invoice_number.toLowerCase() === p.supplier_invoice_number.toLowerCase() ||
        (i.supplier_gstin && p.supplier_gstin && i.supplier_gstin.toUpperCase() === p.supplier_gstin.toUpperCase())
      );

      if (match2B) {
        const gstr2bTotal = match2B.gstr2b_igst + match2B.gstr2b_cgst + match2B.gstr2b_sgst;
        total_in_2b += gstr2bTotal;
        const taxDiff = Math.abs(p.total_gst - gstr2bTotal);
        if (taxDiff < 1.0) {
          matched_count++;
          eligible_itc += p.total_gst;
          reconItems.push({
            ...match2B,
            book_taxable: p.taxable_value,
            book_cgst: p.total_cgst,
            book_sgst: p.total_sgst,
            book_igst: p.total_igst,
            variance: 0,
            status: 'matched',
            itc_eligibility: 'eligible',
            notes: 'Matched with Purchase Bill'
          });
        } else {
          mismatched_count++;
          ineligible_itc += p.total_gst;
          reconItems.push({
            ...match2B,
            book_taxable: p.taxable_value,
            book_cgst: p.total_cgst,
            book_sgst: p.total_sgst,
            book_igst: p.total_igst,
            variance: round2(taxDiff),
            status: 'mismatch',
            itc_eligibility: 'pending_verification',
            notes: `Tax discrepancy: Books ₹${p.total_gst} vs 2B ₹${gstr2bTotal}`
          });
        }
      } else {
        reconItems.push({
          id: `rec-bk-${p.id}`,
          supplier_gstin: '32AAAAA0000A1Z5',
          supplier_name: p.supplier_name,
          invoice_number: p.supplier_invoice_number,
          invoice_date: p.purchase_date,
          book_taxable: p.taxable_value,
          book_cgst: p.total_cgst,
          book_sgst: p.total_sgst,
          book_igst: p.total_igst,
          gstr2b_taxable: 0,
          gstr2b_cgst: 0,
          gstr2b_sgst: 0,
          gstr2b_igst: 0,
          variance: round2(p.total_gst),
          status: 'missing_in_2b',
          itc_eligibility: 'pending_verification',
          notes: 'Purchase recorded in books, but missing in supplier GSTR-2B filing'
        });
      }
    });

    return {
      items: reconItems,
      total_in_books: round2(total_in_books),
      total_in_2b: round2(total_in_2b),
      matched_count,
      mismatched_count,
      eligible_itc: round2(eligible_itc),
      ineligible_itc: round2(ineligible_itc)
    };
  }

  public getEInvoicePayload(docId: string): EInvoicePayload {
    return {
      document_id: docId,
      document_number: 'INV-SAMPLE',
      customer_name: 'B2B Client (Integration Sandbox)',
      customer_gstin: '32AABCB1234A1Z5',
      invoice_date: getTodayStr(),
      total_amount: 0,
      is_applicable: true,
      threshold_rule: 'Turnover > ₹5 Cr Mandatory (Sandbox Preview)',
      status: 'sandbox_ready'
    };
  }

  public getEWayBillPayload(docId: string): EWayBillPayload {
    return {
      document_id: docId,
      document_number: 'INV-SAMPLE',
      vehicle_number: 'KL-08-BK-4090',
      distance_km: 45,
      from_place: 'Thrissur',
      from_pincode: '680001',
      to_place: 'Kochi',
      to_pincode: '682016',
      status: 'draft'
    };
  }

  public validateGSTIN(gstin: string): boolean {
    return taxEngine.validateGSTIN(gstin).isValid;
  }
}

export const financeService = new FinanceService();

