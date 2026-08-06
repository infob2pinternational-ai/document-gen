import type { Document } from '../types';
import { dbService } from '../services/db';

/**
 * Normalizes a stored phone number into wa.me's expected format
 * (country code + digits, no separators). Indian 10-digit numbers get
 * the '91' country code prepended; anything else (already has a country
 * code, or is some other length) is passed through digit-stripped only.
 * Exported so any caller building a wa.me link - not just the
 * document-share flow below - uses the same rule instead of a second
 * copy of it (e.g. the mobile app's "message this customer" button).
 */
export function normalizeIndianPhone(phone: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean;
  return clean;
}

/**
 * Shared WhatsApp document-share logic (extracted from Documents.tsx).
 * This is the ONE implementation used by both the staff web app and the
 * owner mobile app - neither should have its own copy of this message
 * construction or the wa.me link logic.
 *
 * Phase 1 of the mobile app deliberately reuses this exactly as-is
 * (shares a link to the public document view) rather than introducing
 * PDF file sharing - that's an explicitly later, separate decision.
 */
export function shareDocumentViaWhatsApp(
  doc: Document,
  companyName: string,
  userEmail: string,
  onLogged?: () => void
): void {
  if (doc.status !== 'approved') {
    alert('This document must be approved first before it can be sent to the customer.');
    return;
  }
  if (!doc.customer_phone) return;

  const cleanPhone = normalizeIndianPhone(doc.customer_phone);

  const docDate = doc.date ? doc.date.split('-').reverse().join('/') : '';
  const formattedTotal = Number(doc.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
  const shareLink = baseUrl + '/doc/' + doc.id;

  let docTypeLabel = 'Document';
  let docNoLabel = 'Doc';
  if (doc.document_type === 'invoice') {
    docTypeLabel = 'Tax Invoice';
    docNoLabel = 'Invoice';
  } else if (doc.document_type === 'non_tax_invoice') {
    docTypeLabel = 'Invoice';
    docNoLabel = 'Invoice';
  } else if (doc.document_type === 'proforma_invoice') {
    docTypeLabel = 'Proforma Invoice';
    docNoLabel = 'Invoice';
  } else if (doc.document_type === 'quotation') {
    docTypeLabel = 'Quotation';
    docNoLabel = 'Quotation';
  } else if (doc.document_type === 'work_order') {
    docTypeLabel = 'Work Order';
    docNoLabel = 'Work Order';
  }

  const msg = `*Dear ${doc.customer_name}*,\n\n` +
    `Greetings from ${companyName}.\n\n` +
    `Thank you for choosing us. Please find your ${docTypeLabel}.\n\n` +
    `📄 ${docNoLabel} No.: ${doc.document_number}\n` +
    `📅 Date: ${docDate}\n` +
    `💰 Amount: ₹${formattedTotal}\n\n` +
    `🔗 *View / Download ${docNoLabel}*\n` +
    `${shareLink}\n\n` +
    `Should you require any clarification or revisions, please feel free to contact us.\n\n` +
    `Thank you for your trust in ${companyName}.\n\n` +
    `Warm Regards,\n` +
    `${companyName}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `📲 *Follow Us*\n` +
    `Instagram\n` +
    `https://www.instagram.com/b2p_international/\n\n` +
    `Facebook\n` +
    `https://facebook.com/b2pinternational\n\n` +
    `⭐ *Share Your Experience*\n` +
    `https://g.page/r/CcC1J3PCvB_BEBM/review`;

  if (userEmail) {
    dbService.logWhatsAppSend(doc.id, userEmail).then(() => {
      if (onLogged) onLogged();
    }).catch(err => console.error(err));
  }

  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}
