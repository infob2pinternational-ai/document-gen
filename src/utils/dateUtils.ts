/**
 * Kerala / India Business Timezone (Asia/Kolkata, UTC+05:30) Utilities
 * Ensures all daily activity reporting, "Today's Calls", and End-of-Day
 * summaries strictly calculate under Asia/Kolkata regardless of UTC day shifts.
 */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns today's date formatted as 'YYYY-MM-DD' in Asia/Kolkata timezone.
 */
export function getIstTodayDateStr(): string {
  return getIstDateStr(new Date());
}

/**
 * Returns yesterday's date formatted as 'YYYY-MM-DD' in Asia/Kolkata timezone.
 */
export function getIstYesterdayDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getIstDateStr(d);
}

/**
 * Converts any ISO string, Date object, or millisecond timestamp into 'YYYY-MM-DD' in Asia/Kolkata.
 */
export function getIstDateStr(input?: string | Date | number | null): string {
  if (!input) return '';
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Formats a timestamp into 12-hour time in Asia/Kolkata, e.g., '10:30 AM'.
 */
export function formatIstTime(input?: string | Date | number | null): string {
  if (!input) return '—';
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
}

/**
 * Formats a timestamp into full date & time in Asia/Kolkata, e.g., '17 Sep 2026, 10:30 AM'.
 */
export function formatIstDateTime(input?: string | Date | number | null): string {
  if (!input) return '—';
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
}

/**
 * Formats a timestamp or date string into readable date in Asia/Kolkata, e.g., '17 Sep 2026'.
 */
export function formatIstDate(input?: string | Date | number | null): string {
  if (!input) return '—';
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(d);
}

/**
 * Checks if two date inputs fall on the exact same calendar day in Asia/Kolkata.
 */
export function isSameIstDay(
  a?: string | Date | number | null,
  b?: string | Date | number | null
): boolean {
  if (!a || !b) return false;
  const strA = getIstDateStr(a);
  const strB = getIstDateStr(b);
  return Boolean(strA && strB && strA === strB);
}

/**
 * Checks if a given timestamp falls on the specified 'YYYY-MM-DD' IST date.
 */
export function isTimestampOnIstDate(
  timestamp?: string | Date | number | null,
  istDateStr?: string
): boolean {
  if (!timestamp || !istDateStr) return false;
  return getIstDateStr(timestamp) === istDateStr;
}

/**
 * Safely parses any date input (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, Excel serials, ISO) into an ISO string.
 * Returns undefined if invalid or unparseable, without ever throwing a RangeError.
 */
export function parseFlexibleDateToIso(input?: string | number | null): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  if (!s || s === '-' || s === '—' || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') return undefined;

  // 1. Check if it's an Excel serial number (e.g. 40000 - 55000)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    const utcDays = serial - 25569;
    const utcValue = utcDays * 86400 * 1000;
    const dateObj = new Date(utcValue);
    if (!isNaN(dateObj.getTime())) return dateObj.toISOString();
  }

  // 2. Check DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1; // 0-indexed
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 10;
    const minute = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const second = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const dateObj = new Date(Date.UTC(year, month, day, hour, minute, second));
    if (!isNaN(dateObj.getTime())) return dateObj.toISOString();
  }

  // 3. Try standard Date parsing
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}

  return undefined;
}

