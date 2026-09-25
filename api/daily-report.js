import https from 'https';
import fs from 'fs';
import { requireUser } from '../server/auth.js';

const SNAPSHOT_FILE = '/tmp/b2p_followups_snapshot.json';
let memorySnapshot = null;

function saveFollowUpsSnapshot(snap) {
  memorySnapshot = snap;
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap));
  } catch (e) {}
}

function loadFollowUpsSnapshot(targetDate) {
  if (memorySnapshot && (!targetDate || memorySnapshot.date === targetDate)) {
    return memorySnapshot;
  }
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!targetDate || parsed.date === targetDate) {
        memorySnapshot = parsed;
        return parsed;
      }
    }
  } catch (e) {}
  return memorySnapshot;
}

// Helper to make HTTPS requests using Node's native module
function httpsRequest(url, options, bodyContent) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => {
            try {
              return JSON.parse(data);
            } catch {
              return { error: 'Failed to parse JSON response', raw: data };
            }
          },
          text: () => data
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (bodyContent) {
      req.write(bodyContent);
    }
    req.end();
  });
}

const DEFAULT_SUPABASE_URL = 'https://rqovkmjsdwzggebvwvdk.supabase.co';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb3ZrbWpzZHd6Z2dlYnZ3dmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDQ0MzMsImV4cCI6MjA5ODcyMDQzM30.A_4pG8rG4KDTxa85DSjJ1Y6wGwqMwXPL9DrlzoYjZ9M';
const DEFAULT_ADMIN_REFRESH_TOKEN = 'uiwzhphkiwvc';

let cachedAdminToken = null;
let adminTokenExpiry = 0;

async function getAdminToken(forceRefresh = false) {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  const now = Date.now();
  if (!forceRefresh && cachedAdminToken && adminTokenExpiry > now + 60000) {
    return cachedAdminToken;
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;
  const refreshToken = process.env.SUPABASE_ADMIN_REFRESH_TOKEN || DEFAULT_ADMIN_REFRESH_TOKEN;

  try {
    const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
    const res = await httpsRequest(url, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ refresh_token: refreshToken }));
    const data = res.json();
    if (data && data.access_token) {
      cachedAdminToken = data.access_token;
      adminTokenExpiry = data.expires_at ? data.expires_at * 1000 : Date.now() + 3600000;
      return cachedAdminToken;
    }
  } catch (err) {
    console.warn('[Daily Report API] Failed to refresh admin token:', err);
  }
  return cachedAdminToken || anonKey;
}

// Helper to query Supabase REST API from serverless functions
async function supabaseRest(endpoint, method = 'GET', body = null, callerToken = null) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

  let token = callerToken || await getAdminToken(false);
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${endpoint}`;

  const makeHeaders = (t) => ({
    'apikey': anonKey,
    'Authorization': `Bearer ${t}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  });

  try {
    let res = await httpsRequest(url, { method, headers: makeHeaders(token) }, body ? JSON.stringify(body) : null);

    // If 401 or 403, try force-refreshing admin token and retry once
    if (res.status === 401 || res.status === 403) {
      const refreshedToken = await getAdminToken(true);
      if (refreshedToken && refreshedToken !== token) {
        token = refreshedToken;
        res = await httpsRequest(url, { method, headers: makeHeaders(token) }, body ? JSON.stringify(body) : null);
      }
    }

    if (res.ok) {
      return res.json();
    }
    console.warn(`[Daily Report API] Supabase REST error (${res.status}) on ${endpoint}:`, res.text ? res.text() : '');
    return null;
  } catch (err) {
    console.error('[Daily Report API] Supabase REST error:', err);
    return null;
  }
}

// Format date to Asia/Kolkata YYYY-MM-DD
function getKolkataDateString(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);

    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().split('T')[0];
  }
}

// Format display date in DD MMM YYYY
export function formatDisplayDate(dateStr) {
  try {
    const [y, m, d] = (dateStr || '').split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  } catch {
    return dateStr;
  }
}

// Format time in Asia/Kolkata 12-hour format
export function formatISTTime(date) {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch {
    return '';
  }
}

// Format document type to human-friendly title
export function formatDocTypeLabel(type) {
  switch (type) {
    case 'invoice': return 'Tax Invoice';
    case 'proforma_invoice': return 'Proforma Invoice';
    case 'quotation': return 'Quotation';
    case 'work_order': return 'Work Order';
    case 'non_tax_invoice': return 'Non-Tax Invoice';
    case 'comparison_quotation': return 'Comparison Quote';
    case 'comparison_invoice': return 'Comparison Invoice';
    case 'crm_quotation': return 'CRM Quote';
    default: return 'Document';
  }
}

// Format currency amount in Indian numbering format
export function formatAmount(val) {
  const n = Number(val) || 0;
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Check if status is unresolved
export function isUnresolvedStatus(status) {
  const UNRESOLVED = [
    'Follow-up Required',
    'Call Back',
    'No Answer / No Response',
    'Not Reachable / Switched Off'
  ];
  return UNRESOLVED.includes(status);
}

export function formatFollowUpClientLabel(item) {
  if (!item) return 'Client';
  const cust = (item.customer_name || '').trim();
  const comp = (item.company_name || '').trim();
  if (cust && comp && cust.toLowerCase() !== comp.toLowerCase()) {
    return `${cust} / ${comp}`;
  }
  return cust || comp || 'Client';
}

// Helper to resolve canonical staff key from email or name
export function resolveStaffKey(email, name) {
  const cleanEmail = (email || '').toLowerCase().trim();
  const cleanName = (name || '').toLowerCase().trim();

  if (cleanEmail === 'sivasatheesan33@gmail.com' || cleanName.includes('shiva') || cleanName.includes('siva')) {
    return 'shiva';
  }
  if (cleanEmail === 'brutf5354@gmail.com' || cleanName.includes('brutt') || cleanName.includes('brut')) {
    return 'brutt';
  }
  if (cleanEmail === 'fransonputhukkara@gmail.com' || cleanName.includes('franson')) {
    return 'franson';
  }
  if (cleanEmail === 'sarathjohnpanengadan@gmail.com' || cleanName.includes('sarath')) {
    return 'sarath';
  }
  return cleanName || (cleanEmail ? cleanEmail.split('@')[0] : 'staff');
}

/**
 * Builds individual staff records grouping telecalling entries, completed follow-ups,
 * rescheduled follow-ups, documents generated, and pending/overdue follow-ups.
 */
export function buildStaffRecordsMap(report) {
  const staffRecords = {
    'shiva': {
      key: 'shiva',
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
      unresolved: [],
      completedFollowUps: [],
      rescheduledFollowUps: [],
      documents: [],
      dueToday: [],
      overdue: [],
      timeline: []
    },
    'brutt': {
      key: 'brutt',
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
      unresolved: [],
      completedFollowUps: [],
      rescheduledFollowUps: [],
      documents: [],
      dueToday: [],
      overdue: [],
      timeline: []
    }
  };

  const otherStaff = {};

  function getStaffRecord(key, email, name) {
    if (staffRecords[key]) return staffRecords[key];
    if (!otherStaff[key]) {
      const label = (name || (email ? email.split('@')[0] : key)).toUpperCase();
      otherStaff[key] = {
        key,
        label,
        email: email || '',
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
        unresolved: [],
        completedFollowUps: [],
        rescheduledFollowUps: [],
        documents: [],
        dueToday: [],
        overdue: [],
        timeline: []
      };
    }
    return otherStaff[key];
  }

  // 1. Process Telecalling Entries
  const entries = report.entries || [];
  for (const e of entries) {
    const key = resolveStaffKey(e.created_by_email, e.created_by_name);
    const rec = getStaffRecord(key, e.created_by_email, e.created_by_name);

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

    if (e.created_at) rec.timeline.push(e.created_at);
  }

  // Fallback if entries array is empty but telecallerActivity summary exists
  if (entries.length === 0 && report.telecallerActivity) {
    for (const [caller, count] of Object.entries(report.telecallerActivity)) {
      const key = resolveStaffKey(null, caller);
      const rec = getStaffRecord(key, null, caller);
      rec.total = count;
    }
  }

  // 2. Process Completed Follow-ups
  const completedList = report.completedFollowUpsList || [];
  for (const c of completedList) {
    const key = resolveStaffKey(c.assigned_staff_email, c.created_by_name);
    const rec = getStaffRecord(key, c.assigned_staff_email, null);
    rec.completedFollowUps.push(c);
    if (c.completed_at || c.updated_at) {
      rec.timeline.push(c.completed_at || c.updated_at);
    }
  }

  // 3. Process Rescheduled / Snoozed Follow-ups
  const rescheduledList = report.rescheduledFollowUpsList || [];
  for (const r of rescheduledList) {
    const key = resolveStaffKey(r.assigned_staff_email, r.created_by_name);
    const rec = getStaffRecord(key, r.assigned_staff_email, null);
    rec.rescheduledFollowUps.push(r);
    if (r.updated_at) rec.timeline.push(r.updated_at);
  }

  // 4. Process Documents (Invoices, Quotations, Comparison Quotes, Work Orders)
  const docList = report.documentsList || [];
  for (const d of docList) {
    const senderKey = d.whatsapp_sent_by_email ? resolveStaffKey(d.whatsapp_sent_by_email, null) : null;
    const creatorKey = resolveStaffKey(d.created_by_email, d.created_by_name);
    
    // Primary staff to assign to
    let targetKey = creatorKey;
    let targetEmail = d.created_by_email;
    if (senderKey && senderKey !== 'franson' && senderKey !== 'staff') {
      targetKey = senderKey;
      targetEmail = d.whatsapp_sent_by_email;
    }

    const rec = getStaffRecord(targetKey, targetEmail, d.created_by_name);
    rec.documents.push(d);
    if (d.created_at || d.updated_at) rec.timeline.push(d.created_at || d.updated_at);
  }

  // 5. Process Due Today and Overdue Follow-ups
  const dueTodayList = report.followUpsDueTodayList || [];
  for (const u of dueTodayList) {
    const key = resolveStaffKey(u.assigned_staff_email, null);
    const rec = getStaffRecord(key, u.assigned_staff_email, null);
    rec.dueToday.push(u);
  }

  const overdueList = report.overdueFollowUpsList || [];
  for (const o of overdueList) {
    const key = resolveStaffKey(o.assigned_staff_email, null);
    const rec = getStaffRecord(key, o.assigned_staff_email, null);
    rec.overdue.push(o);
  }

  return { staffRecords, otherStaff };
}

/**
 * Builds the consolidated breakdown section embedded in the executive message.
 */
export function buildStaffDetailedBreakdown(report) {
  const { staffRecords, otherStaff } = buildStaffRecordsMap(report);
  const allStaff = [...Object.values(staffRecords), ...Object.values(otherStaff)];

  const blocks = allStaff.map(s => {
    let b = `👤 *${s.label}* (${s.email || 'Staff'})\n` +
      `Total Calls: ${s.total}\n` +
      `• Confirmed: ${s.confirmed} | Interested: ${s.interested} | Follow-up: ${s.followUp}\n` +
      `• Call Back: ${s.callBack} | No Answer: ${s.noAnswer} | Switched Off: ${s.switchedOff}\n` +
      `• No Interest: ${s.noInterest} | Wrong No: ${s.wrongNumber}`;

    if (s.unresolved.length > 0) {
      b += `\n⚠️ *Pending Telecalling (${s.unresolved.length}):*`;
      s.unresolved.slice(0, 4).forEach((u, i) => {
        b += `\n  ${i + 1}. ${u.company} (${u.phone}) - ${u.status}${u.remarks ? ': ' + u.remarks.substring(0, 35) : ''}`;
      });
      if (s.unresolved.length > 4) {
        b += `\n  ...and ${s.unresolved.length - 4} more pending`;
      }
    } else if (s.total > 0) {
      b += `\n✓ All calls resolved / follow-ups addressed`;
    } else {
      b += `\n(No calls logged today)`;
    }

    if (s.documents.length > 0) {
      b += `\n📄 *Documents Generated (${s.documents.length}):*`;
      s.documents.slice(0, 10).forEach((d, i) => {
        const type = formatDocTypeLabel(d.document_type);
        const num = d.document_number || 'Draft';
        const amt = formatAmount(d.total);
        const profileTag = d.company_name ? ` [${d.company_name.replace('B2P ', '')}]` : '';
        b += `\n  ${i + 1}. ${type} #${num}${profileTag} (${d.customer_name || 'Client'}) - ${amt}`;
      });
      if (s.documents.length > 10) {
        b += `\n  ...and ${s.documents.length - 10} more documents`;
      }
    }

    if (s.completedFollowUps.length > 0) {
      b += `\n✅ *Follow-ups Completed Today (${s.completedFollowUps.length}):*`;
      s.completedFollowUps.slice(0, 10).forEach((c, i) => {
        const name = formatFollowUpClientLabel(c);
        const outcome = c.completion_note ? `: ${c.completion_note.substring(0, 30)}` : '';
        b += `\n  ${i + 1}. ${name}${outcome}`;
      });
      if (s.completedFollowUps.length > 10) {
        b += `\n  ...and ${s.completedFollowUps.length - 10} more completed`;
      }
    }

    if (s.rescheduledFollowUps.length > 0) {
      b += `\n🔄 *Follow-ups Rescheduled / Snoozed (${s.rescheduledFollowUps.length}):*`;
      s.rescheduledFollowUps.slice(0, 10).forEach((r, i) => {
        const name = formatFollowUpClientLabel(r);
        const due = (r.due_date || r.follow_up_date) ? ` ➔ ${formatDisplayDate(r.due_date || r.follow_up_date)}` : '';
        b += `\n  ${i + 1}. ${name}${due}`;
      });
      if (s.rescheduledFollowUps.length > 10) {
        b += `\n  ...and ${s.rescheduledFollowUps.length - 10} more rescheduled`;
      }
    }

    if (s.dueToday.length > 0) {
      b += `\n📅 *Follow-ups Due Today (${s.dueToday.length}):*`;
      s.dueToday.slice(0, 4).forEach((u, i) => {
        const name = formatFollowUpClientLabel(u);
        const phone = u.phone ? ` (${u.phone})` : '';
        const reason = u.reason ? `: ${u.reason.substring(0, 35)}` : '';
        b += `\n  ${i + 1}. ${name}${phone}${reason}`;
      });
      if (s.dueToday.length > 4) {
        b += `\n  ...and ${s.dueToday.length - 4} more due today`;
      }
    }

    if (s.overdue.length > 0) {
      b += `\n⚠️ *previouse follow up not done =* ${s.overdue.length}`;
      s.overdue.slice(0, 3).forEach(u => {
        const name = formatFollowUpClientLabel(u);
        const phone = u.phone ? ` (${u.phone})` : '';
        const reason = u.reason ? `: ${u.reason.substring(0, 35)}` : '';
        b += `\n  • ${name}${phone}${reason}`;
      });
      if (s.overdue.length > 3) {
        b += `\n  ...and ${s.overdue.length - 3} more overdue`;
      }
    }

    return b;
  });

  return blocks.join('\n\n');
}

/**
 * Formats a STANDALONE, detailed performance report for a specific staff member.
 * This is sent as its own independent WhatsApp message directly to the owner.
 */
export function formatStaffIndividualReport(staff, companyName, reportDate, isEveningUpdate = false) {
  const headerCompany = (companyName || 'B2P INTERNATIONAL').toUpperCase();
  const dateStr = formatDisplayDate(reportDate);
  const tag = isEveningUpdate
    ? '🌙 *EVENING STAFF REPORT (Post 6:30 PM Activity Update)*'
    : '📋 *DAILY STAFF PERFORMANCE REPORT*';

  let msg = `*${headerCompany}*\n${tag}\n\n` +
    `👤 *Staff:* ${staff.label}\n` +
    `📧 *Email:* ${staff.email || 'Staff Desk'}\n` +
    `📅 *Date:* ${dateStr}\n`;

  // 1. Working Time Window
  if (staff.timeline && staff.timeline.length > 0) {
    const validTimestamps = staff.timeline
      .map(t => new Date(t).getTime())
      .filter(t => !isNaN(t) && t > 0)
      .sort((a, b) => a - b);

    if (validTimestamps.length > 0) {
      const first = formatISTTime(new Date(validTimestamps[0]));
      const last = formatISTTime(new Date(validTimestamps[validTimestamps.length - 1]));
      msg += `⏱️ *Active Window:* ${first} – ${last} IST\n`;
    }
  }

  // 2. Telecalling Performance
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📞 *TELECALLING CALLS (${staff.total}):*\n` +
    `• Confirmed: ${staff.confirmed} | Interested: ${staff.interested} | Follow-up: ${staff.followUp}\n` +
    `• Call Back: ${staff.callBack} | No Answer: ${staff.noAnswer} | Switched Off: ${staff.switchedOff}\n` +
    `• No Interest: ${staff.noInterest} | Wrong Number: ${staff.wrongNumber}`;

  if (staff.unresolved && staff.unresolved.length > 0) {
    msg += `\n\n⚠️ *Pending Telecalling Actions (${staff.unresolved.length}):*`;
    staff.unresolved.slice(0, 5).forEach((u, i) => {
      msg += `\n  ${i + 1}. ${u.company} (${u.phone}) - ${u.status}${u.remarks ? ': ' + u.remarks.substring(0, 40) : ''}`;
    });
    if (staff.unresolved.length > 5) {
      msg += `\n  ...and ${staff.unresolved.length - 5} more pending`;
    }
  } else if (staff.total > 0) {
    msg += `\n✓ All telecalling calls resolved`;
  } else {
    msg += `\n(No direct telecalling dialer calls logged)`;
  }

  // 3. Documents / Invoices / Quotes Generated Today
  const docs = staff.documents || [];
  msg += `\n\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📄 *DOCUMENTS / QUOTES / INVOICES (${docs.length}):*\n`;
  if (docs.length > 0) {
    docs.forEach((d, i) => {
      const typeLabel = formatDocTypeLabel(d.document_type);
      const num = d.document_number || 'Draft';
      const cust = d.customer_name || 'Client';
      const amt = formatAmount(d.total);
      const st = (d.approval_status || d.status || 'Active').toUpperCase();
      const profileTag = d.company_name ? ` [${d.company_name.replace('B2P ', '')}]` : '';
      msg += `  ${i + 1}. *${typeLabel} #${num}*${profileTag} — ${cust}\n` +
        `     Amount: ${amt} | Status: ${st}\n`;
      if (d.id) {
        msg += `     🔗 https://b2pinternational.com/doc/${d.id}\n`;
      }
    });
  } else {
    msg += `(No documents generated today)\n`;
  }

  // 4. CRM Follow-ups Completed Today
  const completed = staff.completedFollowUps || [];
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ *CRM FOLLOW-UPS COMPLETED (${completed.length}):*\n`;
  if (completed.length > 0) {
    completed.forEach((c, i) => {
      const name = formatFollowUpClientLabel(c);
      const phone = c.phone ? ` (${c.phone})` : '';
      const timeStr = c.completed_at ? ` [${formatISTTime(c.completed_at)}]` : '';
      const outcome = c.completion_note ? `\n     Outcome: ${c.completion_note.substring(0, 60)}` : '';
      msg += `  ${i + 1}. *${name}*${phone}${timeStr}${outcome}\n`;
    });
  } else {
    msg += `(No follow-ups marked completed today)\n`;
  }

  // 5. CRM Follow-ups Rescheduled / Snoozed Today
  const rescheduled = staff.rescheduledFollowUps || [];
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔄 *FOLLOW-UPS RESCHEDULED / SNOOZED (${rescheduled.length}):*\n`;
  if (rescheduled.length > 0) {
    rescheduled.forEach((r, i) => {
      const name = formatFollowUpClientLabel(r);
      const phone = r.phone ? ` (${r.phone})` : '';
      const due = (r.due_date || r.follow_up_date)
        ? ` ➔ Due: ${formatDisplayDate(r.due_date || r.follow_up_date)} ${r.due_time || ''}`
        : '';
      const note = r.notes || r.reason ? `\n     Note: ${(r.notes || r.reason).substring(0, 60)}` : '';
      msg += `  ${i + 1}. *${name}*${phone}${due}${note}\n`;
    });
  } else {
    msg += `(No follow-ups rescheduled today)\n`;
  }

  // 6. Remaining Pending & Overdue Tasks
  const dueToday = staff.dueToday || [];
  const overdue = staff.overdue || [];
  if (dueToday.length > 0 || overdue.length > 0) {
    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 *Pending Tasks Assigned:*\n` +
      `• Due Today Remaining: ${dueToday.length} | Overdue: ${overdue.length}\n`;
  }

  msg += `\nGenerated from B2P ONE`;
  return msg;
}

// Build executive WhatsApp report text
export function formatDailyReportMessage(companyName, report, isNightSlot = false) {
  const headerCompany = (companyName || 'B2P INTERNATIONAL').toUpperCase();
  const dateStr = formatDisplayDate(report.date);

  const statusOrder = [
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

  const statusLines = statusOrder.map((st, idx) => {
    const cnt = (report.statusCounts && report.statusCounts[st]) || 0;
    return `${idx + 1}. ${st}: ${cnt}`;
  });

  const telecallerLines = report.telecallerActivity && Object.keys(report.telecallerActivity).length > 0
    ? Object.entries(report.telecallerActivity)
        .map(([name, count]) => `${name || 'Unassigned'}: ${count}`)
        .join('\n')
    : 'None';

  const unresolvedCount = typeof report.unresolvedCallsCount === 'number'
    ? report.unresolvedCallsCount
    : (report.unresolvedEntries ? report.unresolvedEntries.length : 0);

  const staffSection = buildStaffDetailedBreakdown(report);

  const dueTodayCount = typeof report.followUpsDueToday === 'number'
    ? report.followUpsDueToday
    : (report.followUpsDueTodayList?.length ?? report.followUpsCount ?? 0);

  const overdueCount = typeof report.overdueFollowUpsCount === 'number'
    ? report.overdueFollowUpsCount
    : (report.overdueFollowUpsList?.length ?? 0);

  const completedTodayCount = typeof report.completedFollowUpsCount === 'number'
    ? report.completedFollowUpsCount
    : (report.completedFollowUpsList?.length ?? 0);

  const rescheduledTodayCount = typeof report.rescheduledFollowUpsCount === 'number'
    ? report.rescheduledFollowUpsCount
    : (report.rescheduledFollowUpsList?.length ?? 0);

  const docsCount = typeof report.documentsCount === 'number'
    ? report.documentsCount
    : (report.documentsList?.length ?? 0);

  let followUpSection = `*Follow-ups Due Today:* ${dueTodayCount}`;
  if (report.followUpsDueTodayList && report.followUpsDueTodayList.length > 0) {
    report.followUpsDueTodayList.slice(0, 5).forEach((item, idx) => {
      const name = formatFollowUpClientLabel(item);
      const phoneStr = item.phone ? ` (${item.phone})` : '';
      const staff = item.assigned_staff_email ? ` [${item.assigned_staff_email.split('@')[0]}]` : '';
      const reason = item.reason ? `: ${item.reason.substring(0, 40)}` : '';
      followUpSection += `\n  ${idx + 1}. ${name}${phoneStr}${staff}${reason}`;
    });
    if (report.followUpsDueTodayList.length > 5) {
      followUpSection += `\n  ...and ${report.followUpsDueTodayList.length - 5} more due today`;
    }
  }

  followUpSection += `\n\n*previouse follow up not done =* ${overdueCount}`;
  if (report.overdueFollowUpsList && report.overdueFollowUpsList.length > 0) {
    report.overdueFollowUpsList.slice(0, 5).forEach((item, idx) => {
      const name = formatFollowUpClientLabel(item);
      const phoneStr = item.phone ? ` (${item.phone})` : '';
      const staff = item.assigned_staff_email ? ` [${item.assigned_staff_email.split('@')[0]}]` : '';
      const reason = item.reason ? `: ${item.reason.substring(0, 40)}` : '';
      followUpSection += `\n  ${idx + 1}. ${name}${phoneStr}${staff}${reason}`;
    });
    if (report.overdueFollowUpsList.length > 5) {
      followUpSection += `\n  ...and ${report.overdueFollowUpsList.length - 5} more overdue`;
    }
  }

  const reportTitle = isNightSlot
    ? `*TELECALLING & OPERATIONS NIGHT REPORT (Post 6:30 PM)*`
    : `*TELECALLING DAILY REPORT*`;

  let message =
    `*${headerCompany}*\n` +
    `${reportTitle}\n\n` +
    `Date: ${dateStr}\n\n` +
    `Total Calls: ${report.totalCalls || 0}\n` +
    `Documents Generated: ${docsCount}\n` +
    `Follow-ups Completed Today: ${completedTodayCount}\n` +
    `Follow-ups Rescheduled / Snoozed: ${rescheduledTodayCount}\n` +
    `Unique Companies: ${report.uniqueCompanies || 0}\n` +
    `Unresolved Calls: ${unresolvedCount}\n\n` +
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
    followUpSection +
    `\n\n_Detailed individual reports for each staff account are dispatched separately below._\n` +
    `Generated from B2P ONE`;

  return message;
}

export default async function handler(req, res) {
  // 1. CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vercel-cron');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || (req.method === 'GET' ? 'cron' : 'send-report');

  // Handle follow-ups snapshot sync from CRM client
  if (action === 'sync-follow-ups' || action === 'sync-snapshot') {
    const snap = {
      date: req.body?.date || getKolkataDateString(),
      followUpsDueToday: Number(req.body?.followUpsDueToday ?? 0),
      overdueFollowUpsCount: Number(req.body?.overdueFollowUpsCount ?? 0),
      followUpsDueTodayList: Array.isArray(req.body?.followUpsDueTodayList) ? req.body.followUpsDueTodayList : [],
      overdueFollowUpsList: Array.isArray(req.body?.overdueFollowUpsList) ? req.body.overdueFollowUpsList : [],
      updatedAt: new Date().toISOString()
    };
    saveFollowUpsSnapshot(snap);
    return res.status(200).json({ success: true, message: 'Follow-ups snapshot synced successfully', snapshot: snap });
  }

  // Verify authentication if triggered from frontend
  let authUser = null;
  const isCron = action === 'cron' || Boolean(req.headers['x-vercel-cron']);
  if (!isCron && req.headers.authorization && !req.headers.authorization.startsWith('Bearer cron_')) {
    authUser = await requireUser(req, res);
    if (!authUser) return; // Response sent by requireUser
  }

  // Determine target recipient phone (defaults to owner number 918589909034)
  let targetPhone = req.body?.phone || req.query.phone || process.env.OWNER_WHATSAPP_NUMBER || '918589909034';
  let cleanPhone = String(targetPhone).replace(/\D/g, '');
  if (cleanPhone === '918891074715' || cleanPhone === '8891074715') {
    cleanPhone = '918589909034';
  }
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

  // Prevent sending to B2P's own business number
  if (cleanPhone === '918139009034') {
    return res.status(400).json({
      success: false,
      error: "Cannot send WhatsApp report to the business's own sender number (+91 81390 09034). Please provide a personal owner number."
    });
  }

  // Handle Quick Test Ping action
  if (action === 'test-ping') {
    const bizyleadApiKey = process.env.BIZYLEAD_API_KEY || 'c6a02de1ededcd12342b6302ec4b052f76eb83f273994a4606fa070333a0a1ce';
    const bizyleadPhoneId = process.env.BIZYLEAD_PHONE_NUMBER_ID || '992427143955673';
    const bizyleadBaseUrl = process.env.BIZYLEAD_BASE_URL || 'https://app.bizylead.com/api/v2/whatsapp-business';

    const testText = `✅ *B2P ONE - System Verification Ping*\n\nThis is a test notification confirming that your Owner WhatsApp number (*+${cleanPhone}*) is connected to the B2P WhatsApp System.\n\nDaily automated operational reports will be dispatched here at 6:30 PM IST.\n\n_B2P International Pvt Ltd_`;

    try {
      const bizyUrl = `${bizyleadBaseUrl.replace(/\/$/, '')}/messages`;
      const response = await httpsRequest(bizyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bizyleadApiKey}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({
        to: cleanPhone,
        phoneNoId: bizyleadPhoneId,
        type: 'text',
        text: testText
      }));

      const resData = response.json();
      if (!response.ok) {
        return res.status(response.status || 500).json({
          success: false,
          error: resData?.error?.message || resData?.message || 'Bizylead API error',
          details: resData
        });
      }

      return res.status(200).json({
        success: true,
        message: `Test ping successfully dispatched to +${cleanPhone}`,
        messageId: resData?.messageId || resData?.messages?.[0]?.id || `test_${Date.now()}`
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  }

  // Target report date & slot ('day' = 6:30 PM IST, 'night' = 11:30 PM IST)
  const targetDate = req.body?.date || req.query.date || getKolkataDateString();
  const companyName = req.body?.company_name || 'B2P INTERNATIONAL';
  const slot = req.query.slot || req.body?.slot || 'day';
  const isNightSlot = slot === 'night';

  let reportData = req.body?.report_data;
  const callerAuth = req.headers?.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null;

  // 1. Fetch company profiles mapping
  const profileMap = {
    '5fa77dcb-02a8-43f1-a212-3ce64ec474fd': 'B2P Inter-Media Solutions',
    '45b600ac-f996-413f-a467-a36a798b94a1': 'B2P International'
  };
  try {
    const profiles = await supabaseRest('profiles?select=id,name', 'GET', null, callerAuth);
    if (Array.isArray(profiles)) {
      profiles.forEach(p => { if (p.id && p.name) profileMap[p.id] = p.name; });
    }
  } catch (pErr) {
    console.warn('[Daily Report API] Error loading profiles:', pErr);
  }

  // 2. Query Supabase follow_ups table
  let completedFollowUpsList = [];
  let rescheduledFollowUpsList = [];
  let dueTodayList = [];
  let overdueList = [];

  try {
    const cloudFollowUps = await supabaseRest(`follow_ups?select=*&order=updated_at.desc`, 'GET', null, callerAuth) || [];
    if (Array.isArray(cloudFollowUps) && cloudFollowUps.length > 0) {
      for (const f of cloudFollowUps) {
        const fDate = f.follow_up_date || f.due_date;
        const completedAt = f.completed_at;
        const updatedAt = f.updated_at;
        const createdAt = f.created_at;

        const item = {
          id: f.id,
          customer_name: f.customer_name,
          company_name: f.company_name,
          phone: f.phone,
          reason: f.reason || f.notes,
          completion_note: f.completion_note || f.remarks,
          assigned_staff_email: f.assigned_staff_email,
          due_date: fDate,
          due_time: f.follow_up_time || f.due_time,
          status: f.status,
          completed_at: completedAt,
          updated_at: updatedAt,
          created_at: createdAt
        };

        const compDate = completedAt ? getKolkataDateString(new Date(completedAt)) : null;
        const upDate = updatedAt ? getKolkataDateString(new Date(updatedAt)) : null;

        if (f.status === 'completed' || compDate === targetDate) {
          if (compDate === targetDate || (!compDate && upDate === targetDate)) {
            completedFollowUpsList.push(item);
          }
        } else if (f.status === 'snoozed' || (upDate === targetDate && fDate && fDate > targetDate)) {
          if (upDate === targetDate) {
            rescheduledFollowUpsList.push(item);
          }
        } else if (f.status !== 'cancelled') {
          if (fDate === targetDate) {
            dueTodayList.push(item);
          } else if (fDate && fDate < targetDate) {
            overdueList.push(item);
          }
        }
      }
    }
  } catch (crmErr) {
    console.warn('[Daily Report API] Error querying cloud follow_ups:', crmErr);
  }

  // 3. Query documents table for documents created today
  const documentsList = [];
  try {
    const docs = await supabaseRest(`documents?select=*&order=created_at.desc`, 'GET', null, callerAuth) || [];
    if (Array.isArray(docs)) {
      for (const d of docs) {
        const docDate = d.created_at ? getKolkataDateString(new Date(d.created_at)) : (d.date ? d.date.slice(0, 10) : null);
        if (docDate === targetDate) {
          documentsList.push({
            id: d.id,
            document_type: d.document_type || d.type || 'Document',
            document_number: d.document_number || d.number,
            customer_name: d.customer_name || d.client_name,
            total: d.total || d.grand_total || d.amount || 0,
            approval_status: d.approval_status || d.status || 'Active',
            created_by_email: d.created_by_email || d.user_email || d.staff_email,
            created_by_name: d.created_by_name || d.user_name || d.created_by,
            whatsapp_sent_by_email: d.whatsapp_sent_by_email,
            company_id: d.company_id,
            company_name: profileMap[d.company_id] || (d.company_id === '5fa77dcb-02a8-43f1-a212-3ce64ec474fd' ? 'B2P Inter-Media Solutions' : 'B2P International'),
            created_at: d.created_at,
            updated_at: d.updated_at
          });
        }
      }
    }
  } catch (docErr) {
    console.warn('[Daily Report API] Error querying documents:', docErr);
  }

  // 4. Query crm_quotations table for quotes created today
  try {
    const quotes = await supabaseRest(`crm_quotations?select=*&order=created_at.desc`, 'GET', null, callerAuth) || [];
    if (Array.isArray(quotes)) {
      const existingIds = new Set(documentsList.map(d => d.id));
      for (const q of quotes) {
        const qDate = q.created_at ? getKolkataDateString(new Date(q.created_at)) : null;
        if (qDate === targetDate && !existingIds.has(q.id)) {
          documentsList.push({
            id: q.id,
            document_type: 'quotation',
            document_number: q.quotation_number || q.number,
            customer_name: q.customer_name || q.client_name,
            total: q.total_amount || q.total || 0,
            approval_status: q.status || 'Active',
            created_by_email: q.created_by_email || q.user_email || q.staff_email,
            created_by_name: q.created_by_name || q.user_name || q.created_by,
            company_id: q.company_id,
            company_name: profileMap[q.company_id] || 'B2P International',
            created_at: q.created_at,
            updated_at: q.updated_at
          });
        }
      }
    }
  } catch (qErr) {
    console.warn('[Daily Report API] Error querying crm_quotations:', qErr);
  }

  // Snapshot fallback for follow-ups if cloud table had zero
  const snap = loadFollowUpsSnapshot(targetDate);
  if (dueTodayList.length === 0 && snap?.followUpsDueTodayList?.length > 0) {
    dueTodayList = snap.followUpsDueTodayList;
  }
  if (overdueList.length === 0 && snap?.overdueFollowUpsList?.length > 0) {
    overdueList = snap.overdueFollowUpsList;
  }

  // 5. Query telecalling entries from database
  let dbEntries = [];
  try {
    dbEntries = await supabaseRest(`telecalling_entries?entry_date=eq.${targetDate}&order=created_at.asc`, 'GET', null, callerAuth) || [];
  } catch (dbErr) {
    console.warn('[Daily Report API] Error loading entries from Supabase:', dbErr);
  }

  // If reportData was supplied by caller (e.g. from frontend button click), enrich it!
  if (reportData) {
    reportData.documentsList = documentsList;
    reportData.documentsCount = documentsList.length;
    reportData.completedFollowUpsList = completedFollowUpsList;
    reportData.completedFollowUpsCount = completedFollowUpsList.length;
    reportData.rescheduledFollowUpsList = rescheduledFollowUpsList;
    reportData.rescheduledFollowUpsCount = rescheduledFollowUpsList.length;
    reportData.followUpsDueTodayList = dueTodayList;
    reportData.followUpsDueToday = dueTodayList.length;
    reportData.overdueFollowUpsList = overdueList;
    reportData.overdueFollowUpsCount = overdueList.length;

    if ((!reportData.entries || reportData.entries.length === 0) && dbEntries.length > 0) {
      reportData.entries = dbEntries;
      reportData.totalCalls = dbEntries.length;
    }
  } else {
    // If report_data was not supplied (e.g. Cron unattended execution), build it from scratch
    const statusCounts = {
      'Appointment Confirmed': 0,
      'Interested / Details Shared': 0,
      'Follow-up Required': 0,
      'Call Back': 0,
      'No Answer / No Response': 0,
      'No Interest': 0,
      'Not Reachable / Switched Off': 0,
      'Wrong / Invalid Number': 0,
      'Other': 0
    };

    const telecallerActivity = {};
    const uniqueCompanySet = new Set();
    let followUps = 0;
    const unresolvedEntries = [];

    for (const e of dbEntries) {
      if (e.call_status && statusCounts[e.call_status] !== undefined) {
        statusCounts[e.call_status]++;
      } else {
        statusCounts['Other']++;
      }

      if (e.call_status === 'Follow-up Required' || e.call_status === 'Call Back') {
        followUps++;
      }

      if (isUnresolvedStatus(e.call_status)) {
        unresolvedEntries.push(e);
      }

      const caller = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : 'Staff');
      telecallerActivity[caller] = (telecallerActivity[caller] || 0) + 1;

      if (e.company_name) {
        uniqueCompanySet.add(e.company_name.trim().toLowerCase());
      }
    }

    reportData = {
      date: targetDate,
      totalCalls: dbEntries.length,
      uniqueCompanies: uniqueCompanySet.size,
      statusCounts,
      telecallerActivity,
      followUpsCount: dueTodayList.length > 0 ? dueTodayList.length : followUps,
      followUpsDueToday: dueTodayList.length,
      overdueFollowUpsCount: overdueList.length,
      followUpsDueTodayList: dueTodayList,
      overdueFollowUpsList: overdueList,
      completedFollowUpsCount: completedFollowUpsList.length,
      completedFollowUpsList,
      rescheduledFollowUpsCount: rescheduledFollowUpsList.length,
      rescheduledFollowUpsList,
      documentsCount: documentsList.length,
      documentsList,
      unresolvedCallsCount: unresolvedEntries.length,
      unresolvedEntries,
      entries: dbEntries
    };
  }

  // Night slot check: If slot is 'night', only send if activity occurred after 6:30 PM IST (13:00 UTC)
  if (isNightSlot) {
    const eveningCutoff = new Date(`${targetDate}T13:00:00.000Z`).getTime();
    let post630Activity = 0;

    if (Array.isArray(reportData.entries)) {
      for (const e of reportData.entries) {
        if (e.created_at && new Date(e.created_at).getTime() >= eveningCutoff) {
          post630Activity++;
        }
      }
    }
    if (Array.isArray(reportData.documentsList)) {
      for (const d of reportData.documentsList) {
        if (d.created_at && new Date(d.created_at).getTime() >= eveningCutoff) {
          post630Activity++;
        }
      }
    }
    if (Array.isArray(reportData.completedFollowUpsList)) {
      for (const c of reportData.completedFollowUpsList) {
        const time = c.completed_at || c.updated_at;
        if (time && new Date(time).getTime() >= eveningCutoff) {
          post630Activity++;
        }
      }
    }
    if (Array.isArray(reportData.rescheduledFollowUpsList)) {
      for (const r of reportData.rescheduledFollowUpsList) {
        if (r.updated_at && new Date(r.updated_at).getTime() >= eveningCutoff) {
          post630Activity++;
        }
      }
    }

    if (post630Activity === 0) {
      console.log(`[Daily Report API] Night slot skipped for ${targetDate}: No activity logged after 6:30 PM IST.`);
      return res.status(200).json({
        success: true,
        skipped: true,
        slot: 'night',
        date: targetDate,
        message: 'No activity logged after 6:30 PM IST (13:00 UTC). Evening report skipped.'
      });
    }
  }

  // 1. Executive consolidated report message
  const executiveMessage = formatDailyReportMessage(companyName, reportData, isNightSlot);
  const messagesToSend = [
    { type: 'executive', staff: 'Executive Summary', text: executiveMessage }
  ];

  // 2. Individual staff performance reports (sent separately)
  const { staffRecords, otherStaff } = buildStaffRecordsMap(reportData);
  const allStaff = [...Object.values(staffRecords), ...Object.values(otherStaff)];

  for (const s of allStaff) {
    const hasActivity = s.total > 0 ||
      (s.documents && s.documents.length > 0) ||
      (s.completedFollowUps && s.completedFollowUps.length > 0) ||
      (s.rescheduledFollowUps && s.rescheduledFollowUps.length > 0) ||
      (s.unresolved && s.unresolved.length > 0);

    // Send individual report if user has activity, or for primary staff accounts (Shiva, Brutt)
    if (s.email === 'sivasatheesan33@gmail.com' || s.email === 'brutf5354@gmail.com' || hasActivity) {
      const indText = formatStaffIndividualReport(s, companyName, targetDate, isNightSlot);
      messagesToSend.push({
        type: 'individual',
        staff: s.label,
        email: s.email,
        text: indText
      });
    }
  }

  // Dry run mode for testing without dispatching messages
  if (req.query?.dry_run === 'true' || req.body?.dry_run === true) {
    return res.status(200).json({
      success: true,
      dryRun: true,
      recipient: cleanPhone,
      date: targetDate,
      totalCalls: reportData.totalCalls,
      documentsCount: reportData.documentsCount || 0,
      completedFollowUpsCount: reportData.completedFollowUpsCount || 0,
      rescheduledFollowUpsCount: reportData.rescheduledFollowUpsCount || 0,
      messagesToSend
    });
  }

  // Dispatch via Bizylead WhatsApp API
  const bizyleadApiKey = process.env.BIZYLEAD_API_KEY || 'c6a02de1ededcd12342b6302ec4b052f76eb83f273994a4606fa070333a0a1ce';
  const bizyleadPhoneId = process.env.BIZYLEAD_PHONE_NUMBER_ID || '992427143955673';
  const bizyleadBaseUrl = process.env.BIZYLEAD_BASE_URL || 'https://app.bizylead.com/api/v2/whatsapp-business';
  const bizyUrl = `${bizyleadBaseUrl.replace(/\/$/, '')}/messages`;

  const sentResults = [];

  try {
    for (let i = 0; i < messagesToSend.length; i++) {
      const item = messagesToSend[i];
      if (i > 0) {
        // 1.2s delay between messages for delivery sequencing and rate limit safety
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      const bizyPayload = {
        to: cleanPhone,
        phoneNoId: bizyleadPhoneId,
        type: 'text',
        text: item.text
      };

      const response = await httpsRequest(bizyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bizyleadApiKey}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(bizyPayload));

      const resData = response.json();
      if (!response.ok) {
        console.error(`[Daily Report API] Bizylead API error on ${item.type} (${item.staff}):`, resData);
      } else {
        const waMsgId = resData?.messageId || resData?.messages?.[0]?.id || `bizy_report_${Date.now()}_${i}`;
        sentResults.push({
          type: item.type,
          staff: item.staff,
          messageId: waMsgId
        });

        // Note: Automated owner management reports are dispatched directly to WhatsApp
        // and are deliberately NOT saved into customer WhatsApp inbox conversations.
      }
    }

    return res.status(200).json({
      success: true,
      slot,
      recipient: cleanPhone,
      date: targetDate,
      totalCalls: reportData.totalCalls,
      documentsCount: reportData.documentsCount || 0,
      completedFollowUpsCount: reportData.completedFollowUpsCount || 0,
      rescheduledFollowUpsCount: reportData.rescheduledFollowUpsCount || 0,
      sentMessagesCount: sentResults.length,
      sentResults,
      provider: 'bizylead'
    });
  } catch (err) {
    console.error('[Daily Report API] Exception sending WhatsApp report:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while sending daily report',
      details: String(err)
    });
  }
}
