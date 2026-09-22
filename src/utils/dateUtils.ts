/**
 * Pure Asia/Kolkata date utilities for B2P ONE ERP Telecalling & Reporting.
 * Prevents UTC offset shifts from moving records into previous/next calendar days.
 */

const TIME_ZONE = 'Asia/Kolkata';

/**
 * Returns today's date formatted as YYYY-MM-DD strictly in Asia/Kolkata.
 */
export function getKolkataToday(): string {
  // 'en-CA' gives ISO format YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

/**
 * Formats a date string (YYYY-MM-DD or ISO) into human-readable display date (e.g. "22 Sep 2026").
 */
export function formatKolkataDisplayDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    // If it's already YYYY-MM-DD, parse parts directly to avoid UTC local time shifts
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // Noon UTC avoids day boundary shift
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: TIME_ZONE,
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }).format(d);
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(d);
  } catch {
    return dateStr || '';
  }
}

/**
 * Returns the Monday and Sunday date strings (YYYY-MM-DD) for the week containing the given date.
 */
export function getKolkataWeekRange(referenceDateStr?: string | null): {
  startDate: string;
  endDate: string;
  label: string;
  days: Array<{ date: string; dayName: string; shortLabel: string }>;
} {
  const baseDateStr = referenceDateStr && /^\d{4}-\d{2}-\d{2}$/.test(referenceDateStr)
    ? referenceDateStr
    : getKolkataToday();

  const [year, month, day] = baseDateStr.split('-').map(Number);
  // Noon UTC represents the calendar day accurately
  const refDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  
  // Day of week: 0 is Sunday, 1 is Monday, ..., 6 is Saturday
  const dayOfWeek = refDate.getUTCDay();
  // We want Monday as start of week:
  // if dayOfWeek is 0 (Sunday), diff to Monday is -6 days
  // if dayOfWeek is 1 (Monday), diff to Monday is 0 days
  // if dayOfWeek is 2 (Tuesday), diff to Monday is -1 day, etc.
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
  const monday = new Date(refDate);
  monday.setUTCDate(refDate.getUTCDate() + diffToMonday);

  const days: Array<{ date: string; dayName: string; shortLabel: string }> = [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (let i = 0; i < 7; i++) {
    const current = new Date(monday);
    current.setUTCDate(monday.getUTCDate() + i);
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    const dateFormatted = `${y}-${m}-${d}`;
    days.push({
      date: dateFormatted,
      dayName: dayNames[i],
      shortLabel: `${dayNames[i]} (${d}/${m})`
    });
  }

  const startDate = days[0].date;
  const endDate = days[6].date;
  const label = `${formatKolkataDisplayDate(startDate)} — ${formatKolkataDisplayDate(endDate)}`;

  return {
    startDate,
    endDate,
    label,
    days
  };
}

/**
 * Shifts a week by offset weeks (-1 for previous week, +1 for next week).
 */
export function shiftKolkataWeek(startDate: string, weekOffset: number): string {
  const [year, month, day] = startDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + (weekOffset * 7), 12, 0, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dt = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dt}`;
}

