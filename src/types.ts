export type DocumentType = 'invoice' | 'proforma_invoice' | 'quotation' | 'work_order' | 'non_tax_invoice' | 'comparison_quotation' | 'comparison_invoice';

export interface CompanyProfile {
  id: string;
  name: string;
  logo_url?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  seal_url?: string;
  google_sheets_url?: string;
  currency: string; // e.g. 'INR' or 'USD'
  
  // Bank details
  bank_name?: string;
  bank_account_no?: string;
  bank_ifsc?: string;
  bank_holder?: string;
  bank_branch?: string;
  
  // Document Defaults
  default_terms?: string;

  show_bank_details?: boolean;
  approver_email?: string;
  
  // Custom column headings
  col_name_description: string;
  col_name_quantity: string;
  col_name_unit: string;
  col_name_rate: string;
  col_name_amount: string;
  
  // Sequences settings
  invoice_prefix: string;
  invoice_start_number: number;
  proforma_prefix: string;
  proforma_start_number: number;
  quotation_prefix: string;
  quotation_start_number: number;
  work_order_prefix: string;
  work_order_start_number: number;
  non_tax_prefix?: string;
  non_tax_start_number?: number;
}

export interface Customer {
  id: string;
  company_id: string; // associated profile
  name: string;
  gstin?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface Service {
  id: string;
  company_id: string; // associated profile
  name: string;
  description?: string;
  default_rate: number;
  unit: string;
  hsn_sac?: string;
  gst_percentage: number;
}

export interface Document {
  id: string;
  company_id: string;
  document_type: DocumentType;
  document_number: string;
  sequence_number: number;
  customer_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_gstin?: string;
  date: string; // YYYY-MM-DD

  
  // Column titles locked at creation
  col_name_description: string;
  col_name_quantity: string;
  col_name_unit: string;
  col_name_rate: string;
  col_name_amount: string;
  
  // Totals
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
  // Optional payment already received/paid against this document's Grand
  // Total ("total" above). Missing/null/undefined/0 all mean "no advance
  // entered" - never shown in the UI/PDF/WhatsApp share and never
  // affects `total` itself. Balance Due is always derived as
  // `total - advance` (see calculateBalanceDue in utils/calculations.ts)
  // rather than stored, so it can never go stale.
  advance?: number;
  notes?: string;
  terms?: string;
  created_by_email?: string;
  whatsapp_sent_by_email?: string;
  whatsapp_sent_at?: string;
  status?: 'pending_approval' | 'approved' | 'rejected';
  approved_by_email?: string;
  approved_at?: string;
  due_date?: string;
  items?: DocumentItem[];
}

export interface DocumentItem {
  id: string;
  document_id: string;
  service_id?: string;
  description: string;
  quantity: number;
  days?: number;
  rate: number;
  unit: string;
  hsn_sac?: string;
  gst_percentage: number;
  amount: number;
  sort_order: number;
  discount_amount?: number;
  discount_percent?: number;
}

// =====================================================================
// B2P CRM & Office Management Types
// =====================================================================

export type LeadStatus =
  | 'new'
  | 'telecaller_working'
  | 'requirement_collected'
  | 'sent_to_admin'
  | 'quotation_preparing'
  | 'waiting_owner_approval'
  | 'quotation_sent'
  | 'follow_up'
  | 'confirmed'
  | 'lost'
  | 'future'
  | 'owner_handover';

export type LeadPriority = 'HOT' | 'WARM' | 'COLD';

export type LeadSource =
  | 'facebook'
  | 'instagram'
  | 'whatsapp_bulk'
  | 'website'
  | 'bulk_email'
  | 'existing_customer'
  | 'phone'
  | 'referral'
  | 'other';

export interface Lead {
  id: string;
  lead_number?: string; // e.g. B2P-LD-1001
  company_id: string;
  customer_id?: string;
  customer_name: string;
  company_name?: string;
  phone: string;
  whatsapp_number?: string;
  address?: string;
  location?: string;
  sub_district?: string;
  business_type?: string;
  lead_source: LeadSource;
  source_details?: string;
  service_required?: string;
  vehicle_service_type?: string;
  required_date?: string; // YYYY-MM-DD
  campaign_location?: string;
  number_of_days?: number;
  priority: LeadPriority;
  assigned_telecaller_email?: string;
  status: LeadStatus;
  next_follow_up_at?: string;
  notes?: string;
  remarks?: string;
  created_at: string;
  updated_at: string;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  company_id: string;
  user_email: string;
  action: string;
  previous_status?: LeadStatus;
  new_status?: LeadStatus;
  note?: string;
  created_at: string;
}

// =====================================================================
// Follow-ups System (Phase 2)
// =====================================================================

export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'SNOOZED' | 'CANCELLED' | 'OVERDUE';

export interface FollowUp {
  id: string;
  // REMEDIATION (2026-08-24, full-project audit pass): company_id was
  // missing from this type even though the follow_ups Supabase table
  // (and every other CRM entity's type) carries one - without it there
  // was no way to scope follow-ups per company profile at all. See the
  // matching note in leadService.ts.
  company_id?: string;
  lead_id?: string;
  lead_number?: string;
  customer_id?: string;
  customer_name: string;
  company_name?: string;
  phone?: string;
  assigned_staff_email: string;
  due_date: string; // YYYY-MM-DD
  due_time: string; // HH:mm
  reason: string;
  notes?: string;
  status: FollowUpStatus;
  created_by_email: string;
  created_at: string;
  completed_at?: string;
  completion_note?: string;
  snoozed_until?: string;
  next_follow_up_id?: string;
}

// =====================================================================
// Quotation Approval Workflow (Phase 3)
// =====================================================================

export type QuotationApprovalStatus =
  | 'DRAFT'
  | 'WAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'REVISED';

export interface QuotationLineItem {
  id: string;
  description: string;
  quantity: number;
  days: number;
  rate: number;
  amount: number;
}

export interface CrmQuotation {
  id: string;
  quotation_number: string; // e.g. QTN-B2P-1001
  company_id: string;
  lead_id?: string;
  lead_number?: string;
  customer_id?: string;
  customer_name: string;
  company_name?: string;
  customer_phone?: string;
  customer_address?: string;
  service_required: string;
  vehicle_service_type?: string;
  campaign_location: string;
  required_date: string;
  number_of_days: number;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
  items: QuotationLineItem[];
  notes?: string;
  terms?: string;
  approval_status: QuotationApprovalStatus;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  approved_by_email?: string;
  approved_at?: string;
  owner_remarks?: string;
  sent_at?: string;
  sent_by_email?: string;
}

// =====================================================================
// Booking Calendar & Resources (Phase 4)
// =====================================================================

export const SERVICE_OPTIONS: string[] = [
  'LED Van Advertising',
  'LED Wall',
  'Lookwalker',
  'Marketing',
  'Mobile Roadshow Campaigns',
  'Events & Staging',
  'Signage & Printing',
  'Digital Outdoor Billboard',
  'Other Advertising'
];

export const SERVICE_SUB_DIVISIONS: Record<string, string[]> = {
  'LED Van Advertising': [
    '3 Side LED Van',
    '2 Side LED Van',
    'Single Side LED Van',
    '3 Side LED Truck'
  ]
};

export type BookingStatus = 'TENTATIVE' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

export interface Resource {
  id: string;
  name: string;
  category: 'LED Van Advertising' | 'LED Van' | 'LED Wall' | 'Lookwalker' | 'Marketing' | 'Mobile Roadshow Campaigns' | 'Events & Staging' | 'Signage & Printing' | 'Digital Outdoor Billboard' | 'Other Advertising' | 'Roadshow' | 'Other' | string;
  description?: string;
  location?: string;
  is_active: boolean;
}

export interface Booking {
  id: string;
  booking_number: string; // e.g. BKG-1001
  company_id: string;
  customer_id?: string;
  customer_name: string;
  company_name?: string;
  customer_phone?: string;
  lead_id?: string;
  lead_number?: string;
  quotation_id?: string;
  quotation_number?: string;
  service_required?: string;
  vehicle_service_type?: string;
  resource_id: string;
  resource_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  location: string;
  number_of_days: number;
  assigned_staff_email?: string;
  driver_or_operator?: string;
  status: BookingStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// =====================================================================
// WhatsApp Business API & Team Inbox
// =====================================================================

export type WhatsAppMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppSenderType = 'customer' | 'staff' | 'system';
export type WhatsAppMessageType = 'text' | 'template' | 'document' | 'image' | 'location' | 'interactive';

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  company_id?: string;
  wa_message_id?: string;
  sender_type: WhatsAppSenderType;
  sender_name: string;
  sender_email?: string;
  message_type?: WhatsAppMessageType;
  text: string;
  timestamp: string;
  status: WhatsAppMessageStatus;
  attachment_url?: string;
  attachment_type?: 'pdf' | 'image' | 'route_map' | 'document';
  attachment_name?: string;
  error_message?: string;
  raw_payload?: any;
  created_at?: string;
}

export interface WhatsAppConversation {
  id: string;
  company_id?: string;
  customer_id?: string;
  customer_name: string;
  company_name?: string;
  phone: string;
  lead_id?: string;
  lead_number?: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  assigned_staff_email?: string;
  status?: 'open' | 'resolved' | 'pending';
  created_at?: string;
  updated_at?: string;
}

export interface WhatsAppTemplate {
  id: string;
  company_id?: string;
  template_name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  meta_status: 'APPROVED' | 'PENDING' | 'REJECTED';
  header_type?: 'NONE' | 'DOCUMENT' | 'IMAGE' | 'TEXT';
  body_text: string;
  variables?: string[];
  created_at?: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

// =====================================================================
// Notification Center (Phase 7)
// =====================================================================

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'lead' | 'quotation' | 'approval' | 'followup' | 'booking' | 'system';
  target_id?: string;
  target_type?: 'lead' | 'quotation' | 'followup' | 'booking' | 'customer';
  is_read: boolean;
  created_at: string;
}

// =====================================================================
// Accounts & Finance Module
// =====================================================================

export type UserRole = 'owner' | 'admin' | 'manager' | 'telecaller' | 'accounts';
export type PaymentMode = 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'card' | 'other';
export type InvoicePaymentStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type PurchaseStatus = 'draft' | 'posted' | 'recorded' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export interface Supplier {
  id: string;
  company_id: string;
  name: string;
  legal_name?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  billing_address?: string;
  gstin?: string;
  pan?: string;
  state: string; // e.g. 'Kerala', 'Tamil Nadu'
  state_code?: string;
  place_of_supply?: string;
  payment_terms?: string;
  opening_balance: number;
  is_active?: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PurchaseItem {
  id: string;
  account_id?: string;
  account_code?: string;
  account_name?: string;
  description: string;
  hsn_sac?: string;
  quantity: number;
  unit?: string;
  rate: number;
  discount: number;
  taxable_amount: number;
  gst_percentage: number; // e.g. 18, 12, 5, 0
  cgst: number;
  sgst: number;
  igst: number;
  cess?: number;
  total_amount: number;
}

export type ITCEligibility = 'eligible' | 'ineligible_17_5' | 'blocked' | 'pending_reversal';
export type GSTR2BStatus = 'matched' | 'mismatch_tax' | 'missing_in_2b' | 'missing_in_books';

export interface Purchase {
  id: string;
  company_id: string;
  purchase_number: string; // e.g. BILL-2026-0001 or PO-B2P-1001
  supplier_id: string;
  supplier_name: string;
  supplier_company?: string;
  supplier_gstin?: string;
  supplier_invoice_number: string;
  supplier_invoice_date?: string;
  purchase_date: string; // YYYY-MM-DD
  due_date: string; // YYYY-MM-DD
  place_of_supply?: string;
  payment_terms?: string;
  items: PurchaseItem[];
  taxable_value: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_cess?: number;
  total_gst: number;
  round_off?: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: PurchaseStatus;
  itc_eligibility?: ITCEligibility;
  gstr2b_status?: GSTR2BStatus;
  journal_entry_id?: string;
  notes?: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategoryItem {
  id: string;
  name: string;
  account_code: string;
}

export type ExpenseCategory = 
  | 'Fuel'
  | 'Vehicle Maintenance'
  | 'Staff Expenses'
  | 'Printing'
  | 'Advertising'
  | 'Office Expenses'
  | 'Rent'
  | 'Electricity'
  | 'Internet'
  | 'Travel'
  | 'Equipment'
  | 'Miscellaneous';

export interface Expense {
  id: string;
  company_id: string;
  expense_date: string; // YYYY-MM-DD
  category: ExpenseCategory;
  description: string;
  payee_name: string;
  amount: number;
  gst_amount: number;
  payment_mode: PaymentMode;
  reference_number?: string;
  bank_cash_account?: string;
  bank_cash_account_id?: string;
  journal_entry_id?: string;
  // REMEDIATION (2026-08-24): a posted expense (one with journal_entry_id
  // set) is no longer hard-deleted - it's reversed via a balancing
  // journal entry so the original record and its audit trail survive.
  // See financeService.reverseExpense().
  is_reversed?: boolean;
  reversed_at?: string;
  reversed_by_email?: string;
  reversal_journal_entry_id?: string;
  reversal_reason?: string;
  notes?: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerPaymentAllocation {
  document_id: string;
  document_number: string;
  allocated_amount: number;
}

export interface PaymentReceived {
  id: string;
  company_id: string;
  payment_number: string; // e.g. RCPT-B2P-1001
  document_id?: string;
  document_number?: string;
  customer_id?: string;
  customer_name: string;
  payment_date: string; // YYYY-MM-DD
  amount: number;
  payment_mode: PaymentMode;
  reference_number?: string;
  bank_cash_account: string;
  bank_cash_account_id?: string;
  is_advance?: boolean;
  advance_amount?: number;
  allocations?: CustomerPaymentAllocation[];
  journal_entry_id?: string;
  notes?: string;
  created_by_email: string;
  created_at: string;
}

export interface SupplierPaymentAllocation {
  purchase_id: string;
  purchase_number: string;
  supplier_invoice_number: string;
  allocated_amount: number;
}

export interface SupplierPayment {
  id: string;
  company_id: string;
  payment_number: string; // e.g. VPY-B2P-1001
  purchase_id?: string;
  purchase_number?: string;
  supplier_id: string;
  supplier_name: string;
  payment_date: string; // YYYY-MM-DD
  amount: number;
  payment_mode: PaymentMode;
  reference_number?: string;
  bank_cash_account: string;
  bank_cash_account_id?: string;
  is_advance?: boolean;
  advance_amount?: number;
  allocations?: SupplierPaymentAllocation[];
  journal_entry_id?: string;
  notes?: string;
  created_by_email: string;
  created_at: string;
}

export interface CustomerLedgerEntry {
  id: string;
  date: string;
  reference: string;
  description: string;
  type: 'invoice' | 'payment' | 'opening' | 'advance' | 'reversal';
  debit: number;
  credit: number;
  running_balance: number;
}

export interface SupplierLedgerEntry {
  id: string;
  date: string;
  reference: string;
  description: string;
  type: 'purchase' | 'payment' | 'opening' | 'advance' | 'reversal';
  debit: number;
  credit: number;
  running_balance: number;
}

export interface ARAgingBucket {
  current: number; // not yet due
  bucket_1_30: number; // 1-30 days overdue
  bucket_31_60: number; // 31-60 days overdue
  bucket_61_90: number; // 61-90 days overdue
  bucket_90_plus: number; // 90+ days overdue
  total_overdue: number;
  total_receivables: number;
}

export interface CustomerReceivablesSummary {
  total_receivables: number;
  due_today: number;
  overdue_receivables: number;
  due_in_7_days: number;
  due_in_30_days: number;
  total_collected: number;
  aging: ARAgingBucket;
  open_invoices_count: number;
}

export interface APAgingBucket {
  current: number; // not yet due
  bucket_1_30: number; // 1-30 days overdue
  bucket_31_60: number; // 31-60 days overdue
  bucket_61_90: number; // 61-90 days overdue
  bucket_90_plus: number; // 90+ days overdue
  total_overdue: number;
  total_payables: number;
}

export interface AccountsPayableSummary {
  total_payables: number;
  due_today: number;
  overdue_payables: number;
  due_in_7_days: number;
  due_in_30_days: number;
  total_paid: number;
  aging: APAgingBucket;
  open_bills_count: number;
}

export interface GSTSummary {
  output_taxable: number;
  output_cgst: number;
  output_sgst: number;
  output_igst: number;
  total_output_gst: number;
  
  input_taxable: number;
  input_cgst: number;
  input_sgst: number;
  input_igst: number;
  total_input_gst: number;

  net_cgst_payable: number;
  net_sgst_payable: number;
  net_igst_payable: number;
  net_gst_payable: number;

  output_gst: {
    taxable_sales: number;
    cgst: number;
    sgst: number;
    igst: number;
    total_output: number;
  };
  input_gst: {
    taxable_purchases: number;
    cgst: number;
    sgst: number;
    igst: number;
    total_input: number;
  };
}

export interface ProfitAndLossReport {
  gross_revenue: number;
  total_revenue: number;
  purchases_cost: number;
  total_purchases: number;
  operating_expenses: number;
  total_expenses: number;
  net_profit: number;
  net_margin_percentage: number;
  expense_breakdown: Record<string, number>;
}

// =====================================================================
// DOUBLE-ENTRY ACCOUNTING SYSTEM (CORE ERP)
// =====================================================================

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountGroup {
  id: string;
  name: string;
  type: AccountType;
  code: string;
  parent_group_id?: string;
  description?: string;
}

export interface AccountHead {
  id: string;
  company_id?: string;
  code: string; // e.g. 1001, 2001
  name: string;
  group_id: string;
  group_name: string;
  type: AccountType;
  opening_balance: number;
  opening_balance_date?: string;
  nature?: 'debit' | 'credit';
  current_balance: number;
  is_system: boolean;
  is_active?: boolean;
  gst_applicable?: boolean;
  description?: string;
}

export type VoucherType = 
  | 'journal' 
  | 'payment' 
  | 'receipt' 
  | 'contra' 
  | 'expense' 
  | 'sales' 
  | 'purchase' 
  | 'credit_note' 
  | 'debit_note'
  | 'reversal';

export type JournalStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export interface JournalLineItem {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  narration?: string;
}

export interface JournalEntry {
  id: string;
  company_id?: string;
  voucher_number: string; // e.g. JV-2026-0001
  voucher_type: VoucherType;
  date: string; // YYYY-MM-DD
  narration: string;
  lines: JournalLineItem[];
  total_debit: number;
  total_credit: number;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  status: JournalStatus;
  financial_year: string; // e.g. FY 2026-27
  is_locked?: boolean;
  created_by_email: string;
  posted_by_email?: string;
  posted_at?: string;
  created_at: string;
}

export interface GeneralLedgerRow {
  id: string;
  date: string;
  voucher_id: string;
  voucher_number: string;
  voucher_type: VoucherType;
  reference?: string;
  narration: string;
  debit: number;
  credit: number;
  running_balance: number;
}

export interface GeneralLedgerReport {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  opening_balance: number;
  rows: GeneralLedgerRow[];
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}

// =====================================================================
// BANKING & RECONCILIATION
// =====================================================================

export interface BankAccount {
  id: string;
  company_id?: string;
  account_head_id?: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  ifsc_code: string;
  branch: string;
  account_type: 'current' | 'savings' | 'cash';
  opening_balance: number;
  current_balance: number;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BankTransaction {
  id: string;
  company_id?: string;
  bank_account_id: string;
  bank_account_name: string;
  date: string;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'bank_charges';
  amount: number;
  payment_mode: PaymentMode;
  reference_number?: string;
  narration: string;
  reconciliation_status: 'unreconciled' | 'matched' | 'cleared' | 'exception';
  reconciled_at?: string;
  reconciled_by?: string;
}

export interface BankReconciliationItem {
  id: string;
  statement_date: string;
  reference_number?: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  matched_voucher_id?: string;
  matched_voucher_number?: string;
  status: 'unreconciled' | 'matched' | 'cleared' | 'exception';
  notes?: string;
}

export interface BankReconciliationStatement {
  id: string;
  company_id: string;
  bank_account_id: string;
  bank_account_name: string;
  as_of_date: string;
  statement_balance: number;
  book_balance: number;
  difference: number;
  cleared_balance: number;
  unreconciled_balance: number;
  items: BankReconciliationItem[];
  reconciled_by_email: string;
  reconciled_at: string;
}

export interface CashBookEntry {
  date: string;
  reference: string;
  description: string;
  voucher_type?: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface BankBookEntry {
  date: string;
  reference: string;
  description: string;
  voucher_type?: string;
  debit: number;
  credit: number;
  balance: number;
}

// =====================================================================
// FINANCIAL STATEMENTS & AUDIT TRAIL
// =====================================================================

export interface TrialBalanceItem {
  account_id: string;
  account_code: string;
  account_name: string;
  group_name: string;
  type: AccountType;
  opening_balance: number;
  debit_total: number;
  credit_total: number;
  closing_debit: number;
  closing_credit: number;
}

export interface BalanceSheetReport {
  as_on_date: string;
  financial_year: string;
  assets: {
    fixed_assets: number;
    current_assets: number;
    cash_and_bank: number;
    sundry_debtors: number;
    input_gst: number;
    total_assets: number;
  };
  liabilities: {
    current_liabilities: number;
    sundry_creditors: number;
    output_gst: number;
    short_term_loans: number;
    total_liabilities: number;
  };
  equity: {
    owner_capital: number;
    retained_earnings: number;
    current_period_profit: number;
    total_equity: number;
  };
  total_liabilities_and_equity: number;
  is_balanced: boolean;
  difference: number;
}

export interface CashFlowStatement {
  as_of_date: string;
  financial_year: string;
  operating_activities: {
    cash_from_customers: number;
    cash_to_suppliers: number;
    cash_for_operating_expenses: number;
    cash_for_gst: number;
    net_operating_cash: number;
  };
  investing_activities: {
    fixed_assets_purchased: number;
    fixed_assets_sold: number;
    net_investing_cash: number;
  };
  financing_activities: {
    capital_introduced: number;
    drawings_by_owner: number;
    net_financing_cash: number;
  };
  opening_cash_and_bank: number;
  net_cash_movement: number;
  closing_cash_and_bank: number;
  is_reconciled: boolean;
}

export interface YearEndClosingStatus {
  financial_year: string;
  is_locked: boolean;
  is_closed: boolean;
  closing_voucher_number?: string;
  closed_at?: string;
  closed_by_email?: string;
  trial_balance_balanced: boolean;
  trial_balance_difference: number;
  net_profit_to_transfer: number;
}

export interface FinancialAuditLog {
  id: string;
  timestamp: string;
  user_email: string;
  user_role: string;
  action: string; // e.g. 'INVOICE_POSTED', 'PAYMENT_RECORDED', 'JOURNAL_CREATED', 'PERIOD_LOCKED'
  entity_type: string;
  entity_id: string;
  reference_number?: string;
  old_value?: string;
  new_value?: string;
  details: string;
}

export interface FinancialPeriodLock {
  id: string;
  company_id?: string;
  financial_year: string; // e.g. 'FY 2026-27'
  period_name: string; // e.g. 'Annual FY 2026-27'
  start_date: string;
  end_date: string;
  is_locked: boolean;
  locked_at?: string;
  locked_by_email?: string;
}

// =====================================================================
// STATUTORY GST COMPLIANCE RULES & WORKSPACES
// =====================================================================

export interface GSTComplianceRule {
  id: string;
  rule_code: string;
  name: string;
  effective_from: string;
  effective_to?: string;
  rule_type: 'tax_rate' | 'einvoice_threshold' | 'ewaybill_threshold' | 'due_date' | 'itc_rule';
  value: string;
  description: string;
  version: string;
}

export interface GSTR1B2BRecord {
  gstin: string;
  customer_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value: number;
  place_of_supply: string;
  reverse_charge: boolean;
  applicable_tax_rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface GSTR1HSNRecord {
  hsn_sac: string;
  description: string;
  uqc: string;
  total_quantity: number;
  total_value: number;
  taxable_value: number;
  integrated_tax: number;
  central_tax: number;
  state_tax: number;
  cess: number;
}

export interface GSTR1Workspace {
  period: string; // e.g. '04-2026'
  financial_year: string;
  status: 'draft' | 'validated' | 'ready_for_filing' | 'filed';
  b2b_records: GSTR1B2BRecord[];
  b2c_large_records: any[];
  b2c_small_records: any[];
  credit_debit_notes: any[];
  hsn_summary: GSTR1HSNRecord[];
  taxable_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  cess_total: number;
  total_tax: number;
  validation_errors: string[];
  last_validated_at?: string;
}

export interface GSTR3BWorkspace {
  period: string;
  financial_year: string;
  status: 'draft' | 'validated' | 'ready_for_filing' | 'filed';
  table3_1_outward_taxable: {
    taxable_val: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  table4_itc_eligible: {
    all_other_itc_igst: number;
    all_other_itc_cgst: number;
    all_other_itc_sgst: number;
    all_other_itc_cess: number;
  };
  table4_itc_reversed: {
    rule42_43_igst: number;
    rule42_43_cgst: number;
    rule42_43_sgst: number;
    others_igst: number;
    others_cgst: number;
    others_sgst: number;
  };
  table4_net_itc: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  table5_tax_payable: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    total: number;
  };
  validation_errors: string[];
  last_calculated_at: string;
}

export interface GSTR2BReconciliationItem {
  id: string;
  supplier_gstin: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  book_taxable: number;
  book_cgst: number;
  book_sgst: number;
  book_igst: number;
  gstr2b_taxable: number;
  gstr2b_cgst: number;
  gstr2b_sgst: number;
  gstr2b_igst: number;
  variance: number;
  status: 'matched' | 'partially_matched' | 'missing_in_books' | 'missing_in_2b' | 'mismatch';
  itc_eligibility: 'eligible' | 'ineligible_section_17_5' | 'pending_verification';
  notes?: string;
}

export interface EInvoicePayload {
  document_id: string;
  document_number: string;
  customer_name: string;
  customer_gstin: string;
  invoice_date: string;
  total_amount: number;
  is_applicable: boolean;
  threshold_rule: string;
  irn?: string;
  ack_no?: string;
  ack_date?: string;
  qr_code_data?: string;
  status: 'not_applicable' | 'pending_generation' | 'generated' | 'failed' | 'cancelled' | 'sandbox_ready';
  raw_payload_json?: string;
}

export interface EWayBillPayload {
  document_id: string;
  document_number: string;
  vehicle_number: string;
  transporter_id?: string;
  transporter_name?: string;
  distance_km: number;
  from_place: string;
  from_pincode: string;
  to_place: string;
  to_pincode: string;
  ewb_number?: string;
  ewb_date?: string;
  valid_until?: string;
  status: 'draft' | 'ready_for_dispatch' | 'generated' | 'cancelled' | 'expired';
}

export type AppTheme = 'light' | 'dark' | 'dark-obsidian' | 'dark-amoled' | 'dark-mocha' | 'dark-slate';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  category: 'light' | 'dark';
  description: string;
  accentColor: string;
  bgPreview: string;
  cardPreview: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    name: 'Clean Light',
    category: 'light',
    description: 'Crisp, airy white with modern sky-blue accents',
    accentColor: '#2563eb',
    bgPreview: '#f8fafc',
    cardPreview: '#ffffff'
  },
  {
    id: 'dark-obsidian',
    name: 'Obsidian Charcoal',
    category: 'dark',
    description: 'Neutral matte dark (Linear / Vercel style) — no blue tint',
    accentColor: '#3b82f6',
    bgPreview: '#09090b',
    cardPreview: '#141417'
  },
  {
    id: 'dark-amoled',
    name: 'AMOLED Pitch Black',
    category: 'dark',
    description: 'Pure 100% black canvas with vibrant high-contrast accents',
    accentColor: '#38bdf8',
    bgPreview: '#000000',
    cardPreview: '#0c0c0e'
  },
  {
    id: 'dark-mocha',
    name: 'Warm Mocha',
    category: 'dark',
    description: 'Warm espresso chocolate with bronze & gold accents',
    accentColor: '#d97706',
    bgPreview: '#161311',
    cardPreview: '#211c19'
  },
  {
    id: 'dark-slate',
    name: 'Executive Slate',
    category: 'dark',
    description: 'Deep frosted midnight navy with glassmorphism',
    accentColor: '#3b82f6',
    bgPreview: '#0b0f19',
    cardPreview: '#1e293b'
  }
];

// =====================================================================
// TELECALLING OPERATIONS MODULE (PHASE 1)
// =====================================================================

export type TelecallingStatus =
  | 'Appointment Confirmed'
  | 'Interested / Details Shared'
  | 'Follow-up Required'
  | 'Call Back'
  | 'No Answer / No Response'
  | 'No Interest'
  | 'Not Reachable / Switched Off'
  | 'Wrong / Invalid Number'
  | 'Other';

export const TELECALLING_STATUSES: TelecallingStatus[] = [
  'Appointment Confirmed',
  'Interested / Details Shared',
  'Follow-up Required',
  'Call Back',
  'No Answer / No Response',
  'No Interest',
  'Not Reachable / Switched Off',
  'Wrong / Invalid Number',
  'Other'
];

export const UNRESOLVED_TELECALLING_STATUSES: TelecallingStatus[] = [
  'Follow-up Required',
  'Call Back',
  'No Answer / No Response',
  'Not Reachable / Switched Off',
  'Interested / Details Shared'
];

export function isUnresolvedStatus(status: TelecallingStatus | string | null | undefined): boolean {
  if (!status) return false;
  return (UNRESOLVED_TELECALLING_STATUSES as string[]).includes(status);
}

export interface TelecallingEntry {
  id: string;
  company_id: string;
  entry_date: string; // YYYY-MM-DD
  company_name: string;
  contact_person?: string | null;
  phone: string;
  other_phone?: string | null;
  location?: string | null;
  email?: string | null;
  call_status: TelecallingStatus;
  feedback?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  google_sync_status?: 'pending' | 'syncing' | 'synced' | 'failed';
  google_synced_at?: string | null;
  google_sync_error?: string | null;
}

export interface TelecallingDailyReportData {
  date: string; // YYYY-MM-DD
  totalCalls: number;
  uniqueCompanies: number;
  statusCounts: Record<TelecallingStatus, number>;
  telecallerActivity: Record<string, number>;
  followUpsCount: number;
  unresolvedCallsCount: number;
  unresolvedEntries: TelecallingEntry[];
  entries: TelecallingEntry[];
}

export interface TelecallingWeeklyReportData {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalCalls: number;
  uniqueCompanies: number;
  statusCounts: Record<TelecallingStatus, number>;
  dailyBreakdown: Array<{
    date: string;
    dayName: string;
    totalCalls: number;
    statusCounts: Record<TelecallingStatus, number>;
  }>;
  telecallerBreakdown: Record<string, { total: number; statusCounts: Record<TelecallingStatus, number> }>;
  followUpsCount: number;
  entries: TelecallingEntry[];
}

export interface TelecallingGoogleSyncQueueRow {
  id: string;
  company_id: string;
  telecalling_entry_id: string;
  action: string;
  payload: Record<string, any>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  attempts: number;
  max_attempts: number;
  failed_permanently: boolean;
  next_attempt_at: string;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}
