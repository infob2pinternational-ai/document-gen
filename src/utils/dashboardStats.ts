import type { Booking, Document } from '../types';

export interface DashboardStats {
  revenue: number;
  outstanding: number;
  invoiceCount: number;
  quoteCount: number;
  workOrderCount: number;
}

// These are document values, not verified collections or receivables.
// Keep the legacy property names for callers; labels describe the actual metric.
export function computeDashboardStats(documents: Document[], companyId?: string | null): DashboardStats {
  const docs = companyId ? documents.filter(d => d.company_id === companyId) : documents;
  const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const revenueDocs = docs.filter(d => ['invoice', 'non_tax_invoice', 'comparison_invoice'].includes(d.document_type));
  const revenue = revenueDocs.filter(d => d.status === 'approved').reduce((sum, d) => sum + amount(d.total), 0);

  const outstanding = docs
    .filter(d => d.status === 'pending_approval' || !d.status)
    .reduce((sum, d) => sum + amount(d.total), 0);

  return {
    revenue,
    outstanding,
    invoiceCount: revenueDocs.length,
    quoteCount: docs.filter(d => d.document_type === 'quotation' || d.document_type === 'comparison_quotation').length,
    workOrderCount: docs.filter(d => d.document_type === 'work_order').length
  };
}

export function localDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

export function bookingsOnDate(bookings: Booking[], date: string): Booking[] {
  return bookings.filter(booking =>
    (booking.status === 'TENTATIVE' || booking.status === 'CONFIRMED') &&
    booking.start_date <= date && booking.end_date >= date
  );
}
