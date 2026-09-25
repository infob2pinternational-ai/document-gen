import { normalizeIndianPhone } from './whatsappShare';
import type {
  TelecallingDailyReportData,
  TelecallingWeeklyReportData,
  TelecallingStatus
} from '../types';
import { formatKolkataDisplayDate } from './dateUtils';
import { isUnresolvedStatus } from '../types';

export const DEFAULT_OWNER_WHATSAPP_NUMBER = '918891074715';
const OWNER_WHATSAPP_KEY = 'b2p_owner_whatsapp_number';
const OWNER_REPORT_EMAIL_KEY = 'b2p_owner_report_email';
const OWNER_AUTO_REPORT_ENABLED_KEY = 'b2p_owner_auto_report_enabled';
const OWNER_AUTO_REPORT_TIME_KEY = 'b2p_owner_auto_report_time';

/**
 * Gets the configured Owner WhatsApp phone number.
 * Defaults to verified company owner mobile (+91 88910 74715).
 */
export function getOwnerWhatsAppNumber(): string {
  try {
    const stored = localStorage.getItem(OWNER_WHATSAPP_KEY);
    if (stored && stored.trim()) return stored.trim();
    return DEFAULT_OWNER_WHATSAPP_NUMBER;
  } catch {
    return DEFAULT_OWNER_WHATSAPP_NUMBER;
  }
}

/**
 * Checks if automated daily report dispatch is enabled.
 */
export function isOwnerAutoReportEnabled(): boolean {
  try {
    const val = localStorage.getItem(OWNER_AUTO_REPORT_ENABLED_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

/**
 * Sets automated daily report dispatch status.
 */
export function setOwnerAutoReportEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(OWNER_AUTO_REPORT_ENABLED_KEY, String(enabled));
  } catch (err) {
    console.error('Failed to store owner_auto_report_enabled:', err);
  }
}

/**
 * Gets the configured daily auto-report send time (default: 18:30 / 6:30 PM IST).
 */
export function getOwnerAutoReportTime(): string {
  try {
    return localStorage.getItem(OWNER_AUTO_REPORT_TIME_KEY) || '18:30';
  } catch {
    return '18:30';
  }
}

/**
 * Sets the daily auto-report send time.
 */
export function setOwnerAutoReportTime(time: string): void {
  try {
    localStorage.setItem(OWNER_AUTO_REPORT_TIME_KEY, time.trim() || '18:30');
  } catch (err) {
    console.error('Failed to store owner_auto_report_time:', err);
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
 * Gets the configured Owner / Management Report email recipient.
 */
export function getOwnerReportEmail(defaultEmail?: string): string {
  try {
    const stored = localStorage.getItem(OWNER_REPORT_EMAIL_KEY);
    if (stored && stored.trim()) return stored.trim();
    return defaultEmail?.trim() || '';
  } catch {
    return defaultEmail?.trim() || '';
  }
}

/**
 * Sets the dedicated Owner / Management Report email recipient.
 */
export function setOwnerReportEmail(email: string): void {
  try {
    const clean = email.trim();
    if (clean) {
      localStorage.setItem(OWNER_REPORT_EMAIL_KEY, clean);
    } else {
      localStorage.removeItem(OWNER_REPORT_EMAIL_KEY);
    }
  } catch (err) {
    console.error('Failed to store owner_report_email:', err);
  }
}

/**
 * Builds the detailed breakdown for staff members, specifically
 * highlighting Shiva (sivasatheesan33@gmail.com) and Brutt (brutf5354@gmail.com).
 */
export function buildStaffDetailedBreakdown(report: TelecallingDailyReportData): string {
  const entries = report.entries || [];

  const staffRecords: Record<string, {
    label: string;
    email: string;
    total: number;
    confirmed: number;
    interested: number;
    followUp: number;
    callBack: number;
    noAnswer: number;
    switchedOff: number;
    noInterest: number;
    wrongNumber: number;
    other: number;
    unresolved: Array<{ company: string; phone: string; status: string; remarks: string }>;
  }> = {
    'shiva': {
      label: 'SHIVA (Sivasatheesan)',
      email: 'sivasatheesan33@gmail.com',
      total: 0,
      confirmed: 0,
      interested: 0,
      followUp: 0,
      callBack: 0,
      noAnswer: 0,
      switchedOff: 0,
      noInterest: 0,
      wrongNumber: 0,
      other: 0,
      unresolved: []
    },
    'brutt': {
      label: 'BRUTT (Brutf5354)',
      email: 'brutf5354@gmail.com',
      total: 0,
      confirmed: 0,
      interested: 0,
      followUp: 0,
      callBack: 0,
      noAnswer: 0,
      switchedOff: 0,
      noInterest: 0,
      wrongNumber: 0,
      other: 0,
      unresolved: []
    }
  };

  const otherStaff: Record<string, typeof staffRecords['shiva']> = {};

  for (const e of entries) {
    const rawEmail = (e.created_by_email || '').toLowerCase().trim();
    const rawName = (e.created_by_name || '').toLowerCase().trim();

    let key = '';
    if (rawEmail === 'sivasatheesan33@gmail.com' || rawName.includes('shiva') || rawName.includes('siva')) {
      key = 'shiva';
    } else if (rawEmail === 'brutf5354@gmail.com' || rawName.includes('brutt') || rawName.includes('brut')) {
      key = 'brutt';
    } else {
      const otherKey = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : 'Staff');
      if (!otherStaff[otherKey]) {
        otherStaff[otherKey] = {
          label: otherKey.toUpperCase(),
          email: e.created_by_email || '',
          total: 0,
          confirmed: 0,
          interested: 0,
          followUp: 0,
          callBack: 0,
          noAnswer: 0,
          switchedOff: 0,
          noInterest: 0,
          wrongNumber: 0,
          other: 0,
          unresolved: []
        };
      }
      key = otherKey;
    }

    const rec = staffRecords[key] || otherStaff[key];
    if (rec) {
      rec.total++;
      const st = e.call_status;
      if (st === 'Appointment Confirmed') rec.confirmed++;
      else if (st === 'Interested / Details Shared') rec.interested++;
      else if (st === 'Follow-up Required') rec.followUp++;
      else if (st === 'Call Back') rec.callBack++;
      else if (st === 'No Answer / No Response') rec.noAnswer++;
      else if (st === 'Not Reachable / Switched Off') rec.switchedOff++;
      else if (st === 'No Interest') rec.noInterest++;
      else if (st === 'Wrong / Invalid Number') rec.wrongNumber++;
      else rec.other++;

      if (isUnresolvedStatus(st)) {
        rec.unresolved.push({
          company: e.company_name || 'Contact',
          phone: e.phone || '',
          status: st,
          remarks: (e.feedback || '').trim() || 'Pending follow-up'
        });
      }
    }
  }

  // If entries are not populated but telecallerActivity summary exists
  if (entries.length === 0 && report.telecallerActivity) {
    for (const [caller, count] of Object.entries(report.telecallerActivity)) {
      const lower = caller.toLowerCase();
      if (lower.includes('shiva') || lower.includes('siva')) {
        staffRecords['shiva'].total = count;
      } else if (lower.includes('brutt') || lower.includes('brut')) {
        staffRecords['brutt'].total = count;
      } else {
        otherStaff[caller] = {
          label: caller.toUpperCase(),
          email: '',
          total: count,
          confirmed: 0, interested: 0, followUp: 0, callBack: 0,
          noAnswer: 0, switchedOff: 0, noInterest: 0, wrongNumber: 0, other: 0,
          unresolved: []
        };
      }
    }
  }

  const allStaff = [...Object.values(staffRecords), ...Object.values(otherStaff)];
  const blocks = allStaff.map(s => {
    let b = `👤 *${s.label}* (${s.email || 'Staff'})\n` +
      `Total Calls: ${s.total}\n` +
      `• Confirmed: ${s.confirmed} | Interested: ${s.interested} | Follow-up: ${s.followUp}\n` +
      `• Call Back: ${s.callBack} | No Answer: ${s.noAnswer} | Switched Off: ${s.switchedOff}\n` +
      `• No Interest: ${s.noInterest} | Wrong No: ${s.wrongNumber}`;

    if (s.unresolved.length > 0) {
      b += `\n⚠️ *Pending Action (${s.unresolved.length}):*`;
      s.unresolved.slice(0, 5).forEach((u, i) => {
        b += `\n  ${i + 1}. ${u.company} (${u.phone}) - ${u.status}${u.remarks ? ': ' + u.remarks.substring(0, 40) : ''}`;
      });
      if (s.unresolved.length > 5) {
        b += `\n  ...and ${s.unresolved.length - 5} more pending`;
      }
    } else if (s.total > 0) {
      b += `\n✓ All calls resolved / follow-ups addressed`;
    } else {
      b += `\n(No calls logged today)`;
    }

    return b;
  });

  return blocks.join('\n\n');
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

  const statusOrder: TelecallingStatus[] = [
    'Appointment Confirmed',
    'Interested / Details Shared',
    'Follow-up Required',
    'Call Back',
    'No Answer / No Response',
    'Not Reachable / Switched Off',
    'No Interest',
    'Wrong / Invalid Number',
    'Other'
  ];

  const statusLines: string[] = statusOrder.map((st, idx) => {
    const cnt = report.statusCounts[st] || 0;
    return `${idx + 1}. ${st}: ${cnt}`;
  });

  // Telecaller breakdown lines
  const telecallerLines = Object.entries(report.telecallerActivity)
    .map(([name, count]) => `${name || 'Unassigned'}: ${count}`)
    .join('\n');

  const staffSection = buildStaffDetailedBreakdown(report);

  return (
    `*${headerCompany}*\n` +
    `*TELECALLING DAILY REPORT*\n\n` +
    `Date: ${dateStr}\n\n` +
    `Total Calls: ${report.totalCalls}\n` +
    `Unique Companies: ${report.uniqueCompanies}\n` +
    `Unresolved Calls: ${report.unresolvedCallsCount ?? report.unresolvedEntries?.length ?? 0}\n\n` +
    `*Call Results:*\n` +
    (statusLines.length > 0 ? statusLines.join('\n') : 'No call entries recorded.') +
    `\n\n` +
    `*Telecaller Activity:*\n` +
    (telecallerLines || 'None') +
    `\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 *STAFF DETAILED BREAKDOWN*\n\n` +
    staffSection +
    `\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
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
 * Builds email payload: Subject, Plain Text, and HTML representation
 * of the Daily Telecalling Report, including Unresolved Calls section.
 */
export function buildDailyReportEmailContent(
  companyName: string,
  report: TelecallingDailyReportData
): { subject: string; body: string; htmlBody: string } {
  const safeCompany = companyName || 'B2P International';
  const displayDate = formatKolkataDisplayDate(report.date);
  const subject = `Telecalling Daily Report - ${displayDate} - ${safeCompany}`;

  const unresolvedList = report.unresolvedEntries || (report.entries ? report.entries.filter(e => isUnresolvedStatus(e.call_status)) : []);
  const unresolvedCount = typeof report.unresolvedCallsCount === 'number' ? report.unresolvedCallsCount : unresolvedList.length;

  // Status Order
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

  // Plain Text Version
  const plainLines: string[] = [
    `========================================`,
    `${safeCompany.toUpperCase()} - TELECALLING DAILY REPORT`,
    `Date: ${displayDate} (${report.date})`,
    `========================================\n`,
    `SUMMARY:`,
    `- Total Calls Logged: ${report.totalCalls}`,
    `- Unique Companies: ${report.uniqueCompanies}`,
    `- Unresolved Calls Requiring Action: ${unresolvedCount}`,
    `- Follow-ups / Call Back: ${report.followUpsCount}\n`,
    `CALL RESULTS BREAKDOWN:`
  ];

  for (const s of statusOrder) {
    plainLines.push(`  * ${s}: ${report.statusCounts[s] || 0}`);
  }

  plainLines.push(`\nTELECALLER ACTIVITY:`);
  for (const [caller, cnt] of Object.entries(report.telecallerActivity)) {
    plainLines.push(`  * ${caller}: ${cnt} calls`);
  }

  if (unresolvedList.length > 0) {
    plainLines.push(`\n----------------------------------------`);
    plainLines.push(`UNRESOLVED CALLS (${unresolvedCount} PENDING ACTION):`);
    plainLines.push(`----------------------------------------`);
    unresolvedList.forEach((e, idx) => {
      plainLines.push(
        `[${idx + 1}] ${e.company_name} | Contact: ${e.contact_person || 'N/A'} | Phone: ${e.phone}\n` +
        `    Status: ${e.call_status}\n` +
        `    Feedback: ${e.feedback || 'None'}\n` +
        `    Telecaller: ${e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff'}\n`
      );
    });
  }

  plainLines.push(`\nGenerated from B2P ONE Portal & ERP`);

  const plainTextBody = plainLines.join('\n');

  // HTML Version
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 20px; background-color: #f8fafc; }
    .container { max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }
    .header { background: #1e40af; color: #ffffff; padding: 20px 24px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
    .content { padding: 24px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; text-align: center; }
    .kpi-title { font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b; }
    .kpi-value { font-size: 22px; font-weight: 800; color: #0f172a; margin: 4px 0; }
    .kpi-sub { font-size: 11px; color: #64748b; }
    .badge-unresolved { color: #dc2626; font-weight: 800; }
    .section-title { font-size: 14px; font-weight: 700; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 20px 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
    th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-weight: 600; border: 1px solid #e2e8f0; }
    td { padding: 8px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
    .status-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #e2e8f0; }
    .status-app { background: #dcfce7; color: #166534; }
    .status-int { background: #dbeafe; color: #1e40af; }
    .status-fup { background: #fef3c7; color: #92400e; }
    .status-rej { background: #fee2e2; color: #991b1b; }
    .footer { background: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${safeCompany} — Telecalling Daily Report</h1>
      <p>Report Date: <strong>${displayDate}</strong> (${report.date}) | Generated from B2P ONE</p>
    </div>
    <div class="content">
      <!-- KPI Section -->
      <table style="width:100%; border:none; margin-bottom:20px;">
        <tr>
          <td style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:12px; text-align:center; width:25%;">
            <div style="font-size:11px; text-transform:uppercase; font-weight:600; color:#64748b;">Total Calls</div>
            <div style="font-size:22px; font-weight:800; color:#0f172a;">${report.totalCalls}</div>
            <div style="font-size:11px; color:#64748b;">${report.uniqueCompanies} companies</div>
          </td>
          <td style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:12px; text-align:center; width:25%;">
            <div style="font-size:11px; text-transform:uppercase; font-weight:600; color:#166534;">Appointments</div>
            <div style="font-size:22px; font-weight:800; color:#166534;">${report.statusCounts['Appointment Confirmed'] || 0}</div>
            <div style="font-size:11px; color:#166534;">Confirmed</div>
          </td>
          <td style="background:#fef3c7; border:1px solid #fde68a; border-radius:6px; padding:12px; text-align:center; width:25%;">
            <div style="font-size:11px; text-transform:uppercase; font-weight:600; color:#92400e;">Follow-ups</div>
            <div style="font-size:22px; font-weight:800; color:#92400e;">${report.followUpsCount}</div>
            <div style="font-size:11px; color:#92400e;">Action Required</div>
          </td>
          <td style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:12px; text-align:center; width:25%;">
            <div style="font-size:11px; text-transform:uppercase; font-weight:600; color:#991b1b;">Unresolved</div>
            <div style="font-size:22px; font-weight:800; color:#dc2626;">${unresolvedCount}</div>
            <div style="font-size:11px; color:#991b1b;">Pending</div>
          </td>
        </tr>
      </table>

      <!-- Status Breakdown -->
      <div class="section-title">Call Results Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Status / Outcome</th>
            <th style="width:90px; text-align:center;">Count</th>
            <th>Notes / Action Required</th>
          </tr>
        </thead>
        <tbody>
          ${statusOrder.map(s => {
            const count = report.statusCounts[s] || 0;
            const isUnres = isUnresolvedStatus(s);
            return `
            <tr>
              <td><strong>${s}</strong></td>
              <td style="text-align:center; font-weight:700; ${count > 0 ? 'color:#0f172a;' : 'color:#94a3b8;'}">${count}</td>
              <td style="color:#64748b;">${isUnres ? '<span style="color:#b45309; font-weight:600;">Action Pending</span>' : 'Resolved'}</td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <!-- Unresolved Calls Highlight -->
      ${unresolvedList.length > 0 ? `
      <div class="section-title" style="color:#b91c1c;">
        Action Needed: Unresolved Calls (${unresolvedCount})
      </div>
      <table>
        <thead>
          <tr>
            <th>Company / Contact</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Feedback / Remarks</th>
            <th>Telecaller</th>
          </tr>
        </thead>
        <tbody>
          ${unresolvedList.map(e => `
          <tr>
            <td>
              <strong>${e.company_name}</strong>
              ${e.contact_person ? `<br><span style="color:#64748b; font-size:11px;">Attn: ${e.contact_person}</span>` : ''}
              ${e.location ? `<br><span style="color:#94a3b8; font-size:10px;">${e.location}</span>` : ''}
            </td>
            <td><a href="tel:${e.phone}" style="color:#2563eb; text-decoration:none;">${e.phone}</a></td>
            <td><span class="status-badge status-fup">${e.call_status}</span></td>
            <td>${e.feedback || '—'}</td>
            <td>${e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff'}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      ` : `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:6px; color:#166534; font-size:12px; margin-bottom:20px;">
        All calls for ${displayDate} are resolved. No pending follow-ups or callbacks required.
      </div>
      `}

      <!-- Telecaller Activity -->
      <div class="section-title">Telecaller Performance</div>
      <table>
        <thead>
          <tr>
            <th>Staff / Telecaller</th>
            <th style="width:120px; text-align:center;">Calls Handled</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(report.telecallerActivity).map(([caller, cnt]) => `
          <tr>
            <td><strong>${caller}</strong></td>
            <td style="text-align:center; font-weight:700;">${cnt}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="footer">
      This is an automated operational report from B2P ONE Portal &amp; ERP.
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, body: plainTextBody, htmlBody };
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

/**
 * Client-side fallback to trigger local mail client (mailto:).
 */
export function openMailtoShare(
  recipient: string,
  subject: string,
  body: string
): void {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  const mailtoUri = `mailto:${recipient.trim()}?subject=${encodedSubject}&body=${encodedBody}`;
  window.location.href = mailtoUri;
}

/**
 * Programmatically sends the Daily Report directly to the owner WhatsApp
 * via the verified B2P Official WhatsApp Business API (Bizylead).
 */
export async function sendDailyReportViaB2PSystem(params: {
  companyName?: string;
  companyId?: string;
  date: string;
  reportData: TelecallingDailyReportData;
  ownerPhone?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string; recipient?: string }> {
  const targetPhone = params.ownerPhone || getOwnerWhatsAppNumber();
  if (!targetPhone || !targetPhone.trim()) {
    return {
      success: false,
      error: 'Owner WhatsApp number is not configured. Please set the Owner WhatsApp number.'
    };
  }

  const cleanPhone = normalizeIndianPhone(targetPhone);
  if (cleanPhone === '918139009034') {
    return {
      success: false,
      error: "Cannot send to the business's own sender number (+91 81390 09034). Please configure a personal owner mobile number."
    };
  }

  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { authenticatedHeaders } = await import('../services/apiAuth');
    headers = await authenticatedHeaders();
  } catch {
    headers = { 'Content-Type': 'application/json' };
  }

  try {
    const res = await fetch('/api/daily-report?action=send-report', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone: cleanPhone,
        date: params.date,
        company_id: params.companyId,
        company_name: params.companyName || 'B2P INTERNATIONAL',
        report_data: params.reportData
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data?.error || `HTTP ${res.status}: Failed to dispatch report via B2P WhatsApp`
      };
    }

    return {
      success: true,
      messageId: data.messageId,
      recipient: cleanPhone
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Network error communicating with B2P WhatsApp service'
    };
  }
}

/**
 * Sends a test verification ping to the owner WhatsApp number
 * via Bizylead WhatsApp API.
 */
export async function sendTestPingToOwner(phone: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const cleanPhone = normalizeIndianPhone(phone);
  try {
    const res = await fetch('/api/daily-report?action=test-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cleanPhone })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || 'Failed to send verification ping.' };
    }
    return { success: true, message: data.message };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error sending verification ping.' };
  }
}

