import type { TelecallingEntry } from '../types';

/**
 * Escapes a cell value according to RFC-4180:
 * - Wraps in double quotes if it contains commas, double quotes, or newlines
 * - Doubles any inner quotes (" -> "")
 */
export function escapeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }
  const str = String(value);
  // If string contains quote, comma, or newline, escape it
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Generates an RFC-4180 compliant CSV string with UTF-8 BOM.
 */
export function generateTelecallingCsvString(entries: TelecallingEntry[]): string {
  const headers = [
    'Date',
    'Company / Name',
    'Contact Person',
    'Phone',
    'Other Phone',
    'Location',
    'Email',
    'Call Status',
    'Feedback',
    'Telecaller',
    'Created At'
  ];

  const headerLine = headers.map(h => escapeCsvCell(h)).join(',');

  const rows = entries.map(e => {
    const caller = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : '');
    return [
      escapeCsvCell(e.entry_date),
      escapeCsvCell(e.company_name || ''),
      escapeCsvCell(e.contact_person || ''),
      escapeCsvCell(e.phone || ''),
      escapeCsvCell(e.other_phone || ''),
      escapeCsvCell(e.location || ''),
      escapeCsvCell(e.email || ''),
      escapeCsvCell(e.call_status || ''),
      escapeCsvCell(e.feedback || ''),
      escapeCsvCell(caller),
      escapeCsvCell(e.created_at || '')
    ].join(',');
  });

  // Prepend UTF-8 BOM (\uFEFF) for Excel compatibility with special characters
  return '\uFEFF' + [headerLine, ...rows].join('\r\n');
}

/**
 * Downloads the given entries as an RFC-4180 CSV file in the browser.
 */
export function downloadTelecallingCsv(filename: string, entries: TelecallingEntry[]): boolean {
  try {
    const csvContent = generateTelecallingCsvString(entries);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to export CSV:', err);
    return false;
  }
}
