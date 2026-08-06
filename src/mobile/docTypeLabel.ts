import type { Document } from '../types';

/**
 * Mobile-only display label for a document's type. Deliberately separate
 * from the desktop app's own inline label logic (DocumentPreview.tsx,
 * Documents.tsx, etc.) - those use longer labels ("Tax Invoice") suited
 * to the desktop's denser layout, while the mobile list/home screens use
 * shorter labels that fit the compact card UI. This file exists so that
 * choice is made in exactly one place instead of duplicated across the
 * mobile screens that need it (previously copy-pasted into both
 * Home.tsx and DocumentsList.tsx).
 */
export function docTypeLabel(type: Document['document_type']): string {
  switch (type) {
    case 'invoice': return 'Invoice';
    case 'non_tax_invoice': return 'Invoice';
    case 'proforma_invoice': return 'Proforma';
    case 'quotation': return 'Quotation';
    case 'work_order': return 'Work Order';
    case 'comparison_quotation': return 'Quote';
    case 'comparison_invoice': return 'Manual Invoice';
    default: return 'Document';
  }
}
