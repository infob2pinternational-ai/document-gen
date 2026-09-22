import JSZip from 'jszip';
import type { TelecallingStatus } from '../types';
import { getKolkataToday } from './dateUtils';

export interface ParsedExcelRow {
  rowIndex: number;
  date: string;
  companyName: string;
  contactPerson?: string;
  phone: string;
  otherPhone?: string;
  location?: string;
  email?: string;
  feedback?: string;
  callStatus: TelecallingStatus;
  isValid: boolean;
  validationError?: string;
  isDuplicate?: boolean;
}

export interface ExcelImportSummary {
  totalRowsFound: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  rows: ParsedExcelRow[];
}

/**
 * Categorizes free-text feedback into the 9 validated standard statuses.
 */
export function categorizeFeedback(feedback?: string | null): TelecallingStatus {
  if (!feedback || !feedback.trim()) return 'Other';
  const s = feedback.toLowerCase().trim();

  if (s.includes('appoint')) {
    return 'Appointment Confirmed';
  }
  if (['sent detail', 'sent mail', 'sent offer', 'shared detail', 'positive', 'details sent', 'pachakarani', 'offers'].some(k => s.includes(k))) {
    return 'Interested / Details Shared';
  }
  if (['follow', 'update', 'contact perunnal', 'they will contact', 'will call', 'call scheduled'].some(k => s.includes(k))) {
    return 'Follow-up Required';
  }
  if (['call back', 'currently bc', 'number bc', 'busy', 'call tomorrow'].some(k => s.includes(k))) {
    return 'Call Back';
  }
  if (['no intrest', 'no interest', 'not interested', 'in house team', 'inhouse team'].some(k => s.includes(k))) {
    return 'No Interest';
  }
  if (['no answer', 'no respond', 'no response', 'not available', 'marketing team not available'].some(k => s.includes(k))) {
    return 'No Answer / No Response';
  }
  if (['switch off', 'switchoff', 'switched off', 'not reachable', 'out of service'].some(k => s.includes(k))) {
    return 'Not Reachable / Switched Off';
  }
  if (['invalid', 'wrong number'].some(k => s.includes(k))) {
    return 'Wrong / Invalid Number';
  }
  return 'Other';
}

/**
 * Normalizes phone numbers from Excel cells (which may be numbers, floats, or comma-separated strings).
 */
export function normalizeExcelPhone(rawVal: any): string {
  if (!rawVal) return '';
  let str = String(rawVal).trim();
  // Strip trailing .0 from Excel float numbers
  if (str.endsWith('.0')) {
    str = str.slice(0, -2);
  }
  // If comma separated, take first valid phone
  if (str.includes(',')) {
    const parts = str.split(',').map(p => p.trim());
    for (const p of parts) {
      const digits = p.replace(/\D/g, '');
      if (digits.length >= 7) return p;
    }
  }
  return str;
}

/**
 * Parses dates from strings like "14-09-2026", "2026-09-14", or Excel serial dates into YYYY-MM-DD.
 */
export function normalizeExcelDate(rawDate: any): string | null {
  if (!rawDate) return null;
  const str = String(rawDate).trim();

  // Pattern: DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (ddmmyyyy) {
    const d = ddmmyyyy[1].padStart(2, '0');
    const m = ddmmyyyy[2].padStart(2, '0');
    const y = ddmmyyyy[3];
    return `${y}-${m}-${d}`;
  }

  // Pattern: YYYY-MM-DD
  const yyyymmdd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (yyyymmdd) {
    const y = yyyymmdd[1];
    const m = yyyymmdd[2].padStart(2, '0');
    const d = yyyymmdd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Excel serial number (days since 1899-12-30)
  const num = Number(str);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Parses an .xlsx file ArrayBuffer using JSZip.
 */
export async function parseExcelTelecallingFile(
  fileData: ArrayBuffer | Uint8Array,
  existingKeys?: Set<string>
): Promise<ExcelImportSummary> {
  const zip = await JSZip.loadAsync(fileData);

  // 1. Parse shared strings if present
  const sharedStrings: string[] = [];
  const sstFile = zip.file('xl/sharedStrings.xml');
  if (sstFile) {
    const sstXml = await sstFile.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(sstXml, 'application/xml');
    const siNodes = doc.getElementsByTagName('si');
    for (let i = 0; i < siNodes.length; i++) {
      const tNodes = siNodes[i].getElementsByTagName('t');
      let text = '';
      for (let j = 0; j < tNodes.length; j++) {
        text += tNodes[j].textContent || '';
      }
      sharedStrings.push(text);
    }
  }

  // 2. Locate worksheet - prefer 'Data' sheet, otherwise sheet1
  let targetSheetPath = 'xl/worksheets/sheet1.xml';
  const workbookFile = zip.file('xl/workbook.xml');
  if (workbookFile) {
    const wbXml = await workbookFile.async('text');
    const parser = new DOMParser();
    const doc = parser.parseFromString(wbXml, 'application/xml');
    const sheetNodes = doc.getElementsByTagName('sheet');
    for (let i = 0; i < sheetNodes.length; i++) {
      const name = sheetNodes[i].getAttribute('name') || '';
      if (name.trim().toLowerCase() === 'data') {
        targetSheetPath = `xl/worksheets/sheet${i + 1}.xml`;
        break;
      }
    }
  }

  const sheetFile = zip.file(targetSheetPath) || zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) {
    throw new Error('No readable worksheet found in the Excel file.');
  }

  const sheetXml = await sheetFile.async('text');
  const parser = new DOMParser();
  const doc = parser.parseFromString(sheetXml, 'application/xml');
  const rowNodes = doc.getElementsByTagName('row');

  const rowsData: Array<Record<number, string>> = [];

  for (let i = 0; i < rowNodes.length; i++) {
    const rowNode = rowNodes[i];
    const cNodes = rowNode.getElementsByTagName('c');
    const colMap: Record<number, string> = {};

    for (let j = 0; j < cNodes.length; j++) {
      const c = cNodes[j];
      const r = c.getAttribute('r') || '';
      const t = c.getAttribute('t');
      const vNode = c.getElementsByTagName('v')[0];
      let val = vNode ? vNode.textContent || '' : '';

      if (t === 's') {
        const sIndex = parseInt(val, 10);
        val = sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex] : val;
      }

      // Convert column letter (e.g. A, B, C...) to 0-based index
      const colLetters = r.replace(/\d+/g, '');
      let colIdx = 0;
      for (let k = 0; k < colLetters.length; k++) {
        colIdx = colIdx * 26 + (colLetters.charCodeAt(k) - 64);
      }
      colIdx -= 1; // 0-based
      colMap[colIdx] = val;
    }

    if (Object.keys(colMap).length > 0) {
      rowsData.push(colMap);
    }
  }

  if (rowsData.length === 0) {
    return {
      totalRowsFound: 0,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      rows: []
    };
  }

  // 3. Detect column indices from header
  let headerRowIndex = 0;
  let colDate = 0;
  let colName = 1;
  let colContact = 2;
  let colPhone = 3;
  let colOtherPhone = 4;
  let colLocation = 5;
  let colEmail = 6;
  let colFeedback = 7;

  // Search first 5 rows for header row
  for (let r = 0; r < Math.min(5, rowsData.length); r++) {
    const row = rowsData[r];
    const values = Object.values(row).map(v => String(v).toLowerCase().trim());
    if (values.some(v => v.includes('name') || v.includes('company')) &&
        values.some(v => v.includes('phone') || v.includes('contact'))) {
      headerRowIndex = r;
      for (const [colIdxStr, val] of Object.entries(row)) {
        const colIdx = Number(colIdxStr);
        const lower = String(val).toLowerCase().trim();
        if (lower.includes('date')) colDate = colIdx;
        else if (lower === 'name' || lower.includes('company')) colName = colIdx;
        else if (lower.includes('contact person')) colContact = colIdx;
        else if (lower === 'phone' || lower.includes('mobile')) colPhone = colIdx;
        else if (lower.includes('other phone')) colOtherPhone = colIdx;
        else if (lower.includes('location')) colLocation = colIdx;
        else if (lower.includes('email') || lower.includes('mail')) colEmail = colIdx;
        else if (lower.includes('feedback') || lower.includes('remark')) colFeedback = colIdx;
      }
      break;
    }
  }

  const parsedRows: ParsedExcelRow[] = [];
  let activeDate = getKolkataToday();
  const seenKeys = new Set<string>(existingKeys || []);

  for (let r = headerRowIndex + 1; r < rowsData.length; r++) {
    const row = rowsData[r];
    const rawDate = row[colDate];
    const rawName = row[colName];
    const rawContact = row[colContact];
    const rawPhone = row[colPhone];
    const rawOtherPhone = row[colOtherPhone];
    const rawLocation = row[colLocation];
    const rawEmail = row[colEmail];
    const rawFeedback = row[colFeedback];

    // Skip purely empty rows or repeated headers
    if (!rawName && !rawPhone && !rawFeedback) continue;
    if (String(rawName).trim().toLowerCase() === 'name' || String(rawPhone).trim().toLowerCase() === 'phone') {
      continue;
    }

    // Date carry-down logic
    const normalizedDate = normalizeExcelDate(rawDate);
    if (normalizedDate) {
      activeDate = normalizedDate;
    }

    const companyName = String(rawName || '').trim();
    const phone = normalizeExcelPhone(rawPhone);
    const otherPhone = normalizeExcelPhone(rawOtherPhone);
    const contactPerson = rawContact ? String(rawContact).trim() : undefined;
    const location = rawLocation ? String(rawLocation).trim() : undefined;
    const email = rawEmail ? String(rawEmail).trim() : undefined;
    const feedback = rawFeedback ? String(rawFeedback).trim() : undefined;
    const callStatus = categorizeFeedback(feedback);

    let isValid = true;
    let validationError: string | undefined;

    if (!companyName) {
      isValid = false;
      validationError = 'Missing company name';
    } else if (!phone) {
      isValid = false;
      validationError = 'Missing contact phone';
    }

    // Deduplication check
    const dedupKey = `${activeDate}_${phone.replace(/\D/g, '')}_${companyName.toLowerCase()}`;
    const isDuplicate = seenKeys.has(dedupKey);

    if (isValid && !isDuplicate) {
      seenKeys.add(dedupKey);
    }

    parsedRows.push({
      rowIndex: r + 1,
      date: activeDate,
      companyName,
      contactPerson,
      phone,
      otherPhone,
      location,
      email,
      feedback,
      callStatus,
      isValid,
      validationError,
      isDuplicate
    });
  }

  const validCount = parsedRows.filter(r => r.isValid && !r.isDuplicate).length;
  const duplicateCount = parsedRows.filter(r => r.isDuplicate).length;
  const invalidCount = parsedRows.filter(r => !r.isValid).length;

  return {
    totalRowsFound: parsedRows.length,
    validRows: validCount,
    duplicateRows: duplicateCount,
    invalidRows: invalidCount,
    rows: parsedRows
  };
}
