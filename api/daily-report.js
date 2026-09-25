import https from 'https';
import { requireUser } from '../server/auth.js';

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

// Helper to query Supabase REST API from serverless functions
async function supabaseRest(endpoint, method = 'GET', body = null) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    const res = await httpsRequest(url, { method, headers }, body ? JSON.stringify(body) : null);
    if (res.ok) {
      return res.json();
    }
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
function formatDisplayDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  } catch {
    return dateStr;
  }
}

// Check if status is unresolved
function isUnresolvedStatus(status) {
  const UNRESOLVED = [
    'Follow-up Required',
    'Call Back',
    'No Answer / No Response',
    'Not Reachable / Switched Off'
  ];
  return UNRESOLVED.includes(status);
}

// Builds detailed breakdown for staff members (Shiva, Brutt, etc.)
export function buildStaffDetailedBreakdown(report) {
  const entries = report.entries || [];

  const staffRecords = {
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

  const otherStaff = {};

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

  // If entries array is empty but telecallerActivity summary exists
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

// Build executive WhatsApp report text
export function formatDailyReportMessage(companyName, report) {
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

  let message =
    `*${headerCompany}*\n` +
    `*TELECALLING DAILY REPORT*\n\n` +
    `Date: ${dateStr}\n\n` +
    `Total Calls: ${report.totalCalls || 0}\n` +
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
    `*Follow-ups Required:* ${report.followUpsCount || 0}\n\n` +
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

  // Verify authentication if triggered from frontend
  let authUser = null;
  const isCron = action === 'cron' || Boolean(req.headers['x-vercel-cron']);
  if (!isCron && req.headers.authorization && !req.headers.authorization.startsWith('Bearer cron_')) {
    authUser = await requireUser(req, res);
    if (!authUser) return; // Response sent by requireUser
  }

  // Determine target recipient phone
  let targetPhone = req.body?.phone || req.query.phone || process.env.OWNER_WHATSAPP_NUMBER || '918891074715';
  let cleanPhone = String(targetPhone).replace(/\D/g, '');
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

    const testText = `✅ *B2P ONE - System Verification Ping*\n\nThis is a test notification confirming that your Owner WhatsApp number (*+${cleanPhone}*) is connected to the B2P WhatsApp System.\n\nDaily automated operational reports will be dispatched here at 8:00 PM IST.\n\n_B2P International Pvt Ltd_`;

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

  // Target report date
  const targetDate = req.body?.date || req.query.date || getKolkataDateString();
  const companyName = req.body?.company_name || 'B2P INTERNATIONAL';

  let reportData = req.body?.report_data;

  // If report_data is not provided (e.g. Cron unattended execution), compute from database
  if (!reportData) {
    try {
      const entries = await supabaseRest(`telecalling_entries?entry_date=eq.${targetDate}&order=created_at.asc`) || [];
      
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

      for (const e of entries) {
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
        totalCalls: entries.length,
        uniqueCompanies: uniqueCompanySet.size,
        statusCounts,
        telecallerActivity,
        followUpsCount: followUps,
        unresolvedCallsCount: unresolvedEntries.length,
        unresolvedEntries,
        entries
      };
    } catch (dbErr) {
      console.error('[Daily Report API] Error loading entries from Supabase:', dbErr);
      reportData = {
        date: targetDate,
        totalCalls: 0,
        uniqueCompanies: 0,
        statusCounts: {},
        telecallerActivity: {},
        followUpsCount: 0,
        unresolvedCallsCount: 0
      };
    }
  }

  // Format message
  const reportMessage = formatDailyReportMessage(companyName, reportData);

  // Dispatch via Bizylead WhatsApp API
  const bizyleadApiKey = process.env.BIZYLEAD_API_KEY || 'c6a02de1ededcd12342b6302ec4b052f76eb83f273994a4606fa070333a0a1ce';
  const bizyleadPhoneId = process.env.BIZYLEAD_PHONE_NUMBER_ID || '992427143955673';
  const bizyleadBaseUrl = process.env.BIZYLEAD_BASE_URL || 'https://app.bizylead.com/api/v2/whatsapp-business';

  const bizyPayload = {
    to: cleanPhone,
    phoneNoId: bizyleadPhoneId,
    type: 'text',
    text: reportMessage
  };

  try {
    const bizyUrl = `${bizyleadBaseUrl.replace(/\/$/, '')}/messages`;
    const response = await httpsRequest(bizyUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bizyleadApiKey}`,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify(bizyPayload));

    const resData = response.json();

    if (!response.ok) {
      console.error('[Daily Report API] Bizylead API error:', resData);
      return res.status(response.status || 500).json({
        success: false,
        error: resData?.error?.message || resData?.message || 'Bizylead API error',
        details: resData
      });
    }

    const waMsgId = resData?.messageId || resData?.messages?.[0]?.id || `bizy_report_${Date.now()}`;

    // Record outbound message in Supabase whatsapp_conversations and whatsapp_messages
    try {
      let convs = await supabaseRest(`whatsapp_conversations?phone=eq.${cleanPhone}&select=id`);
      let convId = convs?.[0]?.id;

      if (!convId) {
        const newConv = await supabaseRest('whatsapp_conversations', 'POST', {
          customer_name: 'Company Owner (Reports)',
          phone: cleanPhone,
          last_message: reportMessage.substring(0, 200),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
          status: 'open'
        });
        convId = newConv?.[0]?.id;
      } else {
        await supabaseRest(`whatsapp_conversations?id=eq.${convId}`, 'PATCH', {
          last_message: reportMessage.substring(0, 200),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }

      if (convId) {
        await supabaseRest('whatsapp_messages', 'POST', {
          conversation_id: convId,
          wa_message_id: waMsgId,
          sender_type: 'system',
          sender_name: 'B2P Automated Reporting',
          message_type: 'text',
          text: reportMessage,
          status: 'sent'
        });
      }
    } catch (convErr) {
      console.warn('[Daily Report API] Non-fatal error recording to whatsapp inbox:', convErr);
    }

    return res.status(200).json({
      success: true,
      messageId: waMsgId,
      recipient: cleanPhone,
      date: targetDate,
      totalCalls: reportData.totalCalls,
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
