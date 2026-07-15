export type DocumentType = 'invoice' | 'proforma_invoice' | 'quotation' | 'work_order' | 'non_tax_invoice' | 'comparison_quotation';

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
  notes?: string;
  terms?: string;
  created_by_email?: string;
  whatsapp_sent_by_email?: string;
  whatsapp_sent_at?: string;
  status?: 'pending_approval' | 'approved' | 'rejected';
  approved_by_email?: string;
  approved_at?: string;
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
}
