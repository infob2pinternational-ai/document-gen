import https from 'https';
import fs from 'fs';
import { requireOwner } from '../server/auth.js';
import {
  TARGET_STAFF_EMAIL,
  OWNER_WHATSAPP_NUMBER,
  getIstDayBoundariesUtc,
  buildDetailedStaffReport,
  formatDetailedReportWhatsAppMessages,
  isDay,
  email
} from '../server/detailedStaffReport.js';

const HISTORY_FILE = '/tmp/b2p_detailed_reports_history.json';
let inMemoryHistory = [];

function loadHistory() {
  if (inMemoryHistory.length > 0) return inMemoryHistory;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) {
        inMemoryHistory = data;
        return inMemoryHistory;
      }
    }
  } catch (e) {
    console.warn('[Detailed Staff Report] Failed to load history file:', e);
  }
  return inMemoryHistory;
}

function saveHistoryEntry(entry) {
  const history = loadHistory();
  const existingIdx = history.findIndex(h => h.id === entry.id);
  if (existingIdx >= 0) {
    history[existingIdx] = { ...history[existingIdx], ...entry, updatedAt: new Date().toISOString() };
  } else {
    history.unshift({ ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  // Keep last 100 entries
  if (history.length > 100) history.length = 100;
  inMemoryHistory = history;
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    console.warn('[Detailed Staff Report] Failed to write history file:', e);
  }
  return entry;
}

function httpsRequest(url, options, bodyContent) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
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
    if (bodyContent) req.write(bodyContent);
    req.end();
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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
  const refreshToken = process.env.SUPABASE_ADMIN_REFRESH_TOKEN;
  if (!refreshToken || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return cachedAdminToken || SUPABASE_ANON_KEY;
  }

  try {
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
    const res = await httpsRequest(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
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
    console.warn('[Detailed Staff Report] Failed to refresh admin token:', err);
  }
  return cachedAdminToken || SUPABASE_ANON_KEY;
}

/**
 * Paged Supabase REST API fetcher.
 * Automatically loops with limit/offset to prevent omitting records beyond 1000 items.
 */
async function supabaseFetchAll(endpoint, callerToken = null) {
  if (!SUPABASE_URL) return [];
  const token = callerToken || await getAdminToken(false);
  const pageSize = 1000;
  let offset = 0;
  const allResults = [];

  while (true) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const pagedEndpoint = `${endpoint}${separator}limit=${pageSize}&offset=${offset}`;
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pagedEndpoint}`;

    try {
      const res = await httpsRequest(url, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.text()}`);
      }

      const rows = res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      allResults.push(...rows);
      if (rows.length < pageSize) {
        break;
      }
      offset += pageSize;
    } catch (err) {
      console.warn(`[Detailed Staff Report] Error fetching page on ${endpoint}:`, err);
      throw err;
    }
  }

  return allResults;
}

function getKolkataToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export default async function handler(req, res) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vercel-cron');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || (req.method === 'GET' ? 'generate' : 'send');
  const isCron = action === 'cron' || Boolean(req.headers['x-vercel-cron']);

  // Enforce server-side authorization:
  // Cron is authorized via header/cron mechanism.
  // Interactive requests MUST be authenticated and verified as Owner.
  let auth = null;
  if (!isCron) {
    auth = await requireOwner(req, res);
    if (!auth) return; // 401 or 403 sent by requireOwner
  }

  const callerToken = auth?.headers?.Authorization ? auth.headers.Authorization.replace(/^Bearer\s+/i, '') : null;

  // Handle history inquiry
  if (action === 'history') {
    const history = loadHistory();
    return res.status(200).json({ success: true, history });
  }

  // Target Parameters
  const targetDate = req.body?.date || req.query.date || getKolkataToday();
  const staffEmail = TARGET_STAFF_EMAIL;
  let targetPhone = req.body?.phone || req.query.phone || process.env.OWNER_WHATSAPP_NUMBER || OWNER_WHATSAPP_NUMBER;
  let cleanPhone = String(targetPhone).replace(/\D/g, '');
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

  // Prevent sending to B2P's own business number (+91 81390 09034)
  if (cleanPhone === '918139009034') {
    return res.status(400).json({
      success: false,
      error: "Cannot send WhatsApp report to the business's own sender number (+91 81390 09034). Please provide the personal owner number."
    });
  }

  // Idempotency Key
  const idempotencyId = `detailed_staff_report_${staffEmail}_${targetDate}`;

  // Check existing dispatch if action is send/cron and not force
  const force = req.query.force === 'true' || req.body?.force === true;
  const history = loadHistory();
  const existingDispatch = history.find(h => h.id === idempotencyId && (h.status === 'sent' || h.status === 'delivered'));

  if ((action === 'send' || action === 'cron') && existingDispatch && !force) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: `Detailed report for ${staffEmail} on ${targetDate} was already dispatched at ${existingDispatch.sentAt || existingDispatch.updatedAt}.`,
      historyEntry: existingDispatch
    });
  }

  // Query CRM Data
  const queryErrors = [];
  let telecalling = [];
  let leads = [];
  let activities = [];
  let followups = [];
  let quotations = [];
  let documents = [];

  // Client-supplied records fallback/enrichment
  const clientData = req.body?.client_data;
  if (clientData) {
    if (Array.isArray(clientData.telecalling)) telecalling.push(...clientData.telecalling);
    if (Array.isArray(clientData.leads)) leads.push(...clientData.leads);
    if (Array.isArray(clientData.activities)) activities.push(...clientData.activities);
    if (Array.isArray(clientData.followups)) followups.push(...clientData.followups);
    if (Array.isArray(clientData.quotations)) quotations.push(...clientData.quotations);
    if (Array.isArray(clientData.documents)) documents.push(...clientData.documents);
  }

  // Query Supabase with pagination & error recording
  try {
    const { startIso, endIso } = getIstDayBoundariesUtc(targetDate);

    // 1. Telecalling entries
    try {
      const tcRows = await supabaseFetchAll(`telecalling_entries?order=created_at.asc`, callerToken);
      if (Array.isArray(tcRows)) {
        const existingIds = new Set(telecalling.map(x => x.id));
        tcRows.forEach(r => { if (!existingIds.has(r.id)) telecalling.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query telecalling_entries: ${e.message}`);
    }

    // 2. Leads
    try {
      const leadRows = await supabaseFetchAll(`leads?order=created_at.asc`, callerToken);
      if (Array.isArray(leadRows)) {
        const existingIds = new Set(leads.map(x => x.id));
        leadRows.forEach(r => { if (!existingIds.has(r.id)) leads.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query leads: ${e.message}`);
    }

    // 3. Lead activities
    try {
      const actRows = await supabaseFetchAll(`lead_activities?order=created_at.asc`, callerToken);
      if (Array.isArray(actRows)) {
        const existingIds = new Set(activities.map(x => x.id));
        actRows.forEach(r => { if (!existingIds.has(r.id)) activities.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query lead_activities: ${e.message}`);
    }

    // 4. Follow-ups
    try {
      const fuRows = await supabaseFetchAll(`follow_ups?order=created_at.asc`, callerToken);
      if (Array.isArray(fuRows)) {
        const existingIds = new Set(followups.map(x => x.id));
        fuRows.forEach(r => { if (!existingIds.has(r.id)) followups.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query follow_ups: ${e.message}`);
    }

    // 5. CRM Quotations
    try {
      const qRows = await supabaseFetchAll(`crm_quotations?order=created_at.asc`, callerToken);
      if (Array.isArray(qRows)) {
        const existingIds = new Set(quotations.map(x => x.id));
        qRows.forEach(r => { if (!existingIds.has(r.id)) quotations.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query crm_quotations: ${e.message}`);
    }

    // 6. Documents
    try {
      const docRows = await supabaseFetchAll(`documents?order=created_at.asc`, callerToken);
      if (Array.isArray(docRows)) {
        const existingIds = new Set(documents.map(x => x.id));
        docRows.forEach(r => { if (!existingIds.has(r.id)) documents.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query documents: ${e.message}`);
    }

  } catch (outerErr) {
    queryErrors.push(`General database exception: ${outerErr.message}`);
  }

  // Generate Report
  const reportResult = buildDetailedStaffReport({
    date: targetDate,
    staffEmail,
    telecalling,
    leads,
    activities,
    followups,
    quotations,
    documents,
    queryErrors
  });

  const messagesToSend = formatDetailedReportWhatsAppMessages(reportResult);

  // If action is preview/generate, return without dispatching
  if (action === 'generate' || action === 'preview') {
    return res.status(200).json({
      success: true,
      date: targetDate,
      staffEmail,
      recipient: cleanPhone,
      counts: reportResult.counts,
      ownerAttention: reportResult.ownerAttention,
      markdown: reportResult.markdown,
      messagesToSend,
      queryErrors
    });
  }

  // Dry-run mode: returns payload without dispatching
  const isDryRun = req.query?.dry_run === 'true' || req.body?.dry_run === true;
  if (isDryRun) {
    return res.status(200).json({
      success: true,
      dryRun: true,
      date: targetDate,
      staffEmail,
      recipient: cleanPhone,
      counts: reportResult.counts,
      ownerAttention: reportResult.ownerAttention,
      messagesToSend,
      markdown: reportResult.markdown,
      queryErrors
    });
  }

  // Official Bizylead WhatsApp Dispatch
  const bizyleadApiKey = process.env.BIZYLEAD_API_KEY;
  let bizyleadPhoneId = process.env.BIZYLEAD_PHONE_NUMBER_ID;
  if (bizyleadPhoneId === '982427143955673') bizyleadPhoneId = '992427143955673';
  const bizyleadBaseUrl = process.env.BIZYLEAD_BASE_URL || 'https://app.bizylead.com/api/v2/whatsapp-business';
  const bizyUrl = `${bizyleadBaseUrl.replace(/\/$/, '')}/messages`;

  if (!bizyleadApiKey || !bizyleadPhoneId) {
    const failureEntry = {
      id: idempotencyId,
      reportType: 'detailed_staff_report',
      staffEmail,
      date: targetDate,
      recipient: cleanPhone,
      status: 'failed',
      error: 'Bizylead WhatsApp credentials (BIZYLEAD_API_KEY / BIZYLEAD_PHONE_NUMBER_ID) not configured in environment.',
      summary: reportResult.counts
    };
    saveHistoryEntry(failureEntry);
    return res.status(503).json({
      success: false,
      error: failureEntry.error,
      historyEntry: failureEntry
    });
  }

  const sentResults = [];
  let dispatchError = null;

  try {
    for (let i = 0; i < messagesToSend.length; i++) {
      const msg = messagesToSend[i];
      if (i > 0) {
        // 1.2s delay between messages for delivery sequencing and rate limit safety
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      const payload = {
        to: cleanPhone,
        phoneNoId: bizyleadPhoneId,
        type: 'text',
        text: msg.text
      };

      const response = await httpsRequest(bizyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bizyleadApiKey}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(payload));

      const resData = response.json();
      if (!response.ok) {
        dispatchError = resData?.error?.message || resData?.message || `HTTP ${response.status}: Bizylead error`;
        console.error(`[Detailed Staff Report] Bizylead error on message ${i + 1}:`, resData);
        break;
      } else {
        const msgId = resData?.messageId || resData?.messages?.[0]?.id || `bizy_detailed_${Date.now()}_${i}`;
        sentResults.push({
          part: msg.part,
          total: msg.total,
          messageId: msgId
        });
      }
    }

    if (dispatchError) {
      const failureEntry = {
        id: idempotencyId,
        reportType: 'detailed_staff_report',
        staffEmail,
        date: targetDate,
        recipient: cleanPhone,
        status: 'failed',
        error: dispatchError,
        summary: reportResult.counts
      };
      saveHistoryEntry(failureEntry);
      return res.status(500).json({
        success: false,
        error: dispatchError,
        historyEntry: failureEntry
      });
    }

    const successEntry = {
      id: idempotencyId,
      reportType: 'detailed_staff_report',
      staffEmail,
      date: targetDate,
      recipient: cleanPhone,
      status: 'sent',
      sentAt: new Date().toISOString(),
      messageIds: sentResults.map(s => s.messageId),
      sentCount: sentResults.length,
      summary: reportResult.counts
    };
    saveHistoryEntry(successEntry);

    return res.status(200).json({
      success: true,
      recipient: cleanPhone,
      date: targetDate,
      staffEmail,
      sentCount: sentResults.length,
      sentResults,
      historyEntry: successEntry
    });

  } catch (err) {
    console.error('[Detailed Staff Report] Exception sending WhatsApp:', err);
    const failureEntry = {
      id: idempotencyId,
      reportType: 'detailed_staff_report',
      staffEmail,
      date: targetDate,
      recipient: cleanPhone,
      status: 'failed',
      error: String(err),
      summary: reportResult.counts
    };
    saveHistoryEntry(failureEntry);
    return res.status(500).json({
      success: false,
      error: String(err),
      historyEntry: failureEntry
    });
  }
}
