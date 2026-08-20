import type { DocumentItem, DocumentType } from '../types';

export interface CalculationResult {
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  taxTotal: number;
  total: number;
  effectiveGstRate: number;
  amountInWords: string;
}

/**
 * Converts a number into Indian Rupee Words format.
 * Example: 35400 -> "Thirty-Five Thousand Four Hundred Rupees Only"
 */
export function numberToWordsIndian(num: number): string {
  if (isNaN(num) || num <= 0) return 'Zero Rupees Only';

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  const units = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(n: number): string {
    if (n < 20) return units[n];
    const ten = Math.floor(n / 10);
    const unit = n % 10;
    return tens[ten] + (unit ? ' ' + units[unit] : '');
  }

  function convertWholeNumber(n: number): string {
    if (n === 0) return '';
    let str = '';

    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    const hundred = Math.floor(n / 100);
    const remainder = n % 100;

    if (crore) str += convertWholeNumber(crore) + ' Crore ';
    if (lakh) str += convertChunk(lakh) + ' Lakh ';
    if (thousand) str += convertChunk(thousand) + ' Thousand ';
    if (hundred) str += convertChunk(hundred) + ' Hundred ';
    if (remainder) {
      if (str !== '') str += 'and ';
      str += convertChunk(remainder) + ' ';
    }
    return str.trim();
  }

  const rupeeText = convertWholeNumber(rupees);
  let result = (rupeeText || 'Zero') + ' Rupee' + (rupees === 1 ? '' : 's');

  if (paise > 0) {
    const paiseText = convertChunk(paise);
    result += ' and ' + paiseText + ' Paise';
  }

  result += ' Only';
  return result;
}

/**
 * Shared calculation logic for Quotations, Invoices, Work Orders, and Non-Tax Invoices.
 * 
 * Line Total = Rate × Qty × (Days || 1)
 * Subtotal = Sum of all Line Totals
 * Taxable Amount = Subtotal − Discount
 * GST = Taxable Amount × GST %
 * Grand Total = Taxable Amount + GST
 */
export function calculateDocumentTotals(
  items: DocumentItem[],
  discountTotal: number = 0,
  docType: DocumentType = 'invoice'
): CalculationResult {
  let subtotal = 0;
  let rawTaxTotal = 0;

  items.forEach(item => {
    const q = Number(item.quantity) || 0;
    const d = Number(item.days) || 1;
    const r = Number(item.rate) || 0;
    const lineSubtotal = q * d * r;
    subtotal += lineSubtotal;

    const gstRate = Number(item.gst_percentage) || 0;
    rawTaxTotal += (lineSubtotal * gstRate) / 100;
  });

  const validDiscount = Math.min(subtotal, Math.max(0, Number(discountTotal) || 0));
  const taxableAmount = Math.max(0, subtotal - validDiscount);

  let taxTotal = 0;
  let effectiveGstRate = 0;

  if (docType !== 'non_tax_invoice' && subtotal > 0) {
    // Proportional GST on Taxable Amount:
    // GST = Taxable Amount × (rawTaxTotal / Subtotal)
    taxTotal = (taxableAmount / subtotal) * rawTaxTotal;
    effectiveGstRate = taxableAmount > 0 ? (taxTotal / taxableAmount) * 100 : 0;
  }

  const total = taxableAmount + taxTotal;
  const amountInWords = numberToWordsIndian(total);

  return {
    subtotal,
    discountTotal: validDiscount,
    taxableAmount,
    taxTotal,
    total,
    effectiveGstRate,
    amountInWords
  };
}

/**
 * Optional "Advance" payment support. Kept deliberately separate from
 * calculateDocumentTotals above (which computes the Grand Total) rather
 * than folded into it - an advance payment must NEVER change the Grand
 * Total, it only feeds a separately-displayed Balance Due.
 *
 * Normalizes a raw advance value the same way discountTotal is
 * normalized above: null/undefined/empty-string/NaN/Infinity/negative
 * all collapse to 0, i.e. "no advance entered". Accepts a raw input
 * string too so form `onChange` handlers can call it directly.
 */
export function normalizeAdvance(advance: number | string | null | undefined): number {
  const n = Number(advance);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Balance Due = Grand Total − Advance. Always derived from the Grand
 * Total at display/save time (never stored as its own authoritative
 * field), so it can never go stale. Clamped to never render negative -
 * the actual guard against saving an advance greater than the Grand
 * Total is the validation check in DocumentEditor's handleSaveDoc; this
 * clamp is only a last-resort display safety net (e.g. for an old row
 * edited directly in the database).
 */
export function calculateBalanceDue(grandTotal: number, advance: number | string | null | undefined): number {
  return Math.max(0, grandTotal - normalizeAdvance(advance));
}
