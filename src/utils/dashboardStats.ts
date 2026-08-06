import type { Document } from '../types';

export interface DashboardStats {
  revenue: number;
  outstanding: number;
  invoiceCount: number;
  quoteCount: number;
  workOrderCount: number;
}

/**
 * Shared revenue/outstanding calculation - the single definition used by
 * both the desktop Dashboard.tsx and the owner mobile app's Home screen,
 * instead of each having its own copy of the same filter/reduce logic.
 *
 * "Revenue" is the total value of Invoice / Non-Tax-Invoice documents -
 * this app has no separate payment-received tracking, so this matches
 * the desktop dashboard's existing "Revenue (Paid)" label/meaning
 * exactly (not literally payment-verified, just invoiced value).
 *
 * "Outstanding" is the total value of documents still awaiting approval
 * (not yet a finalized invoice/quotation) - the one new figure this
 * mobile dashboard phase adds. There's no "paid" field on Document to
 * compute a true unpaid-invoice balance, so this is the most accurate
 * "money not yet finalized" figure the existing schema supports.
 */
export function computeDashboardStats(documents: Document[], companyId?: string | null): DashboardStats {
  const docs = companyId ? documents.filter(d => d.company_id === companyId) : documents;

  const revenueDocs = docs.filter(d => d.document_type === 'invoice' || d.document_type === 'non_tax_invoice');
  const revenue = revenueDocs.reduce((sum, d) => sum + Number(d.total), 0);

  const outstanding = docs
    .filter(d => d.status === 'pending_approval' || !d.status)
    .reduce((sum, d) => sum + Number(d.total), 0);

  return {
    revenue,
    outstanding,
    invoiceCount: revenueDocs.length,
    quoteCount: docs.filter(d => d.document_type === 'quotation').length,
    workOrderCount: docs.filter(d => d.document_type === 'work_order').length
  };
}
