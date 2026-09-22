import { normalizeIndianPhone } from './whatsappShare';
import type { TelecallingDailyReportData, TelecallingWeeklyReportData, TelecallingStatus } from '../types';
import { formatKolkataDisplayDate } from './dateUtils';

const OWNER_WHATSAPP_KEY = 'b2p_owner_whatsapp_number';

/**
 * Gets the configured Owner WhatsApp phone number.
 * Dedicated configuration — never falls back to arbitrary profile phone.
 */
export function getOwnerWhatsAppNumber(): string {
  try {
    return localStorage.getItem(OWNER_WHATSAPP_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Sets the dedicated Owner WhatsApp phone number.
 */
export function setOwnerWhatsAppNumber(phone: string): void {
  try {
    const clean = phone.trim();
    if (clean) {
      localStorage.setItem(OWNER_WHATSAPP_KEY, clean);
    } else {
      localStorage.removeItem(OWNER_WHATSAPP_KEY);
    }
  } catch (err) {
    console.error('Failed to store owner_whatsapp_number:', err);
  }
}

/**
 * Builds the WhatsApp message for Daily Telecalling Report.
 */
export function buildDailyReportWhatsAppMessage(
  companyName: string,
  report: TelecallingDailyReportData
): string {
  const headerCompany = (companyName || 'B2P INTERNATIONAL').toUpperCase();
  const dateStr = formatKolkataDisplayDate(report.date);

  // Filter status counts to show only statuses with count > 0 or key ones
  const statusLines: string[] = [];
  const statusOrder: TelecallingStatus[] = [
    'Appointment Confirmed',
    'Interested / Details Shared',
    'Follow-up Required',
    'Call Back',
    'No Answer / No Response',
    'No Interest',
    'Not Reachable / Switched Off',
    'Wrong / Invalid Number',
    'Other'
  ];

  for (const st of statusOrder) {
    const cnt = report.statusCounts[st] || 0;
    if (cnt > 0) {
      statusLines.push(`${st}: ${cnt}`);
    }
  }

  // Telecaller breakdown lines
  const telecallerLines = Object.entries(report.telecallerActivity)
    .map(([name, count]) => `${name || 'Unassigned'}: ${count}`)
    .join('\n');

  return (
    `*${headerCompany}*\n` +
    `*TELECALLING DAILY REPORT*\n\n` +
    `Date: ${dateStr}\n\n` +
    `Total Calls: ${report.totalCalls}\n` +
    `Unique Companies: ${report.uniqueCompanies}\n\n` +
    `*Call Results:*\n` +
    (statusLines.length > 0 ? statusLines.join('\n') : 'No call entries recorded.') +
    `\n\n` +
    `*Telecaller Activity:*\n` +
    (telecallerLines || 'None') +
    `\n\n` +
    `*Follow-ups Required:* ${report.followUpsCount}\n\n` +
    `Generated from B2P ONE`
  );
}

/**
 * Builds the WhatsApp message for Weekly Telecalling Report.
 */
export function buildWeeklyReportWhatsAppMessage(
  companyName: string,
  report: TelecallingWeeklyReportData
): string {
  const headerCompany = (companyName || 'B2P INTERNATIONAL').toUpperCase();
  const weekLabel = `${formatKolkataDisplayDate(report.startDate)} - ${formatKolkataDisplayDate(report.endDate)}`;

  // Status breakdown
  const statusLines = Object.entries(report.statusCounts)
    .filter(([_, count]) => count > 0)
    .map(([st, count]) => `${st}: ${count}`)
    .join('\n');

  // Daily breakdown
  const dailyLines = report.dailyBreakdown
    .map(d => `${d.dayName} (${d.date.slice(5)}): ${d.totalCalls} calls`)
    .join('\n');

  // Telecaller breakdown
  const telecallerLines = Object.entries(report.telecallerBreakdown)
    .map(([name, data]) => `${name}: ${data.total} calls`)
    .join('\n');

  return (
    `*${headerCompany}*\n` +
    `*TELECALLING WEEKLY REPORT*\n\n` +
    `Week:\n${weekLabel}\n\n` +
    `Total Calls: ${report.totalCalls}\n` +
    `Unique Companies: ${report.uniqueCompanies}\n` +
    `Follow-ups Required: ${report.followUpsCount}\n\n` +
    `*Status Breakdown:*\n` +
    (statusLines || 'No calls recorded this week.') +
    `\n\n` +
    `*Daily Breakdown:*\n` +
    (dailyLines || 'None') +
    `\n\n` +
    `*Telecaller Breakdown:*\n` +
    (telecallerLines || 'None') +
    `\n\n` +
    `Generated from B2P ONE`
  );
}

/**
 * Opens WhatsApp with pre-filled report text.
 * Requires configured owner_whatsapp_number.
 */
export function openWhatsAppShare(
  message: string,
  ownerPhone?: string
): { success: boolean; error?: string; url?: string } {
  const target = ownerPhone || getOwnerWhatsAppNumber();
  if (!target || !target.trim()) {
    return {
      success: false,
      error: 'Owner WhatsApp number is not configured. Please set the Owner WhatsApp number before sharing.'
    };
  }

  const cleanPhone = normalizeIndianPhone(target);
  const encodedText = encodeURIComponent(message);
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

  try {
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    return { success: true, url: waUrl };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to open WhatsApp window' };
  }
}

