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
