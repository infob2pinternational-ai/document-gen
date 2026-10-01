import https from 'https';
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

let inMemoryHistory = [];

function sanitizeErrorMessage(raw) {
  if (!raw) return '';
  let str = typeof raw === 'string' ? raw : (raw.message || String(raw));
  const secrets = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.BIZYLEAD_API_KEY,
    process.env.CRON_SECRET,
    process.env.SUPABASE_ADMIN_REFRESH_TOKEN
  ].filter(Boolean);
  for (const secret of secrets) {
    if (secret && secret.length > 5) {
      str = str.split(secret).join('[REDACTED]');
    }
  }
  return str;
}

function normalizeDbRowToHistory(row) {
  return {
    id: row.id,
    reportType: row.report_type || 'detailed_staff_report',
    staffEmail: row.staff_email,
    date: row.report_date,
    recipient: row.recipient,
    status: row.status,
    sentAt: row.sent_at,
    sentCount: row.sent_count,
    messageIds: row.message_ids || [],
    summary: row.summary || {},
    ownerAttention: row.owner_attention || [],
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
    console.warn('[Detailed Staff Report] Failed to refresh admin token:', sanitizeErrorMessage(err));
  }
  return cachedAdminToken || SUPABASE_ANON_KEY;
}

/**
 * Loads recent dispatches from persistent Supabase table owner_report_dispatches.
 * Falls back to in-memory history if table is not yet migrated or unreachable.
 */
async function loadDispatchesFromSupabase(callerToken = null) {
  if (!SUPABASE_URL) return inMemoryHistory;
  try {
    const token = callerToken || await getAdminToken(false);
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/owner_report_dispatches?report_type=eq.detailed_staff_report&order=updated_at.desc&limit=50`;
    const res = await httpsRequest(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      const rows = res.json();
      if (Array.isArray(rows)) {
        const mapped = rows.map(normalizeDbRowToHistory);
        inMemoryHistory = mapped;
        return mapped;
      }
    }
  } catch (err) {
    console.warn('[Detailed Staff Report] Supabase dispatches load failed, using fallback:', sanitizeErrorMessage(err));
  }
  return inMemoryHistory;
}

/**
 * Looks up existing dispatch for the given idempotency key from Supabase.
 */
async function findExistingDispatchInSupabase(idempotencyId, callerToken = null) {
  // Check in-memory first for fast hit
  const mem = inMemoryHistory.find(h => h.id === idempotencyId);
  if (mem && (mem.status === 'sent' || mem.status === 'delivered')) {
    return mem;
  }

  if (!SUPABASE_URL) return mem || null;

  try {
    const token = callerToken || await getAdminToken(false);
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/owner_report_dispatches?id=eq.${encodeURIComponent(idempotencyId)}&select=*`;
    const res = await httpsRequest(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      const rows = res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const found = normalizeDbRowToHistory(rows[0]);
        const idx = inMemoryHistory.findIndex(h => h.id === idempotencyId);
        if (idx >= 0) inMemoryHistory[idx] = found;
        else inMemoryHistory.unshift(found);
        return found;
      }
    }
  } catch (err) {
    console.warn('[Detailed Staff Report] Supabase dispatch lookup failed:', sanitizeErrorMessage(err));
  }
  return mem || null;
}

/**
 * Persists a dispatch record to Supabase table owner_report_dispatches.
 * Uses atomic UPSERT (resolution=merge-duplicates) to guarantee at-most-once delivery.
 */
async function saveDispatchToSupabase(entry, callerToken = null) {
  const existingIdx = inMemoryHistory.findIndex(h => h.id === entry.id);
  const normalized = {
    ...entry,
    updatedAt: new Date().toISOString()
  };
  if (existingIdx >= 0) {
    inMemoryHistory[existingIdx] = { ...inMemoryHistory[existingIdx], ...normalized };
  } else {
    inMemoryHistory.unshift({ ...normalized, createdAt: new Date().toISOString() });
  }
  if (inMemoryHistory.length > 100) inMemoryHistory.length = 100;

  if (!SUPABASE_URL) return normalized;

  const dbRow = {
    id: entry.id,
    report_type: entry.reportType || 'detailed_staff_report',
    staff_email: entry.staffEmail,
    report_date: entry.date,
    recipient: entry.recipient,
    status: entry.status || 'sent',
    sent_at: entry.sentAt || null,
    sent_count: entry.sentCount || 0,
    message_ids: entry.messageIds || [],
    summary: entry.summary || {},
    owner_attention: entry.ownerAttention || [],
    error: entry.error ? sanitizeErrorMessage(entry.error) : null,
    updated_at: new Date().toISOString()
  };

  try {
    const token = callerToken || await getAdminToken(false);
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/owner_report_dispatches`;
    const res = await httpsRequest(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      }
    }, JSON.stringify(dbRow));

    if (!res.ok) {
      console.warn(`[Detailed Staff Report] Failed to persist dispatch to Supabase (HTTP ${res.status}):`, sanitizeErrorMessage(res.text()));
    }
  } catch (err) {
    console.warn('[Detailed Staff Report] Exception persisting dispatch to Supabase:', sanitizeErrorMessage(err));
  }

  return normalized;
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
      console.warn(`[Detailed Staff Report] Error fetching page on ${endpoint}:`, sanitizeErrorMessage(err));
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
  // 1. Cron requests MUST provide valid CRON_SECRET via Authorization: Bearer <CRON_SECRET>
  // 2. Interactive requests MUST be authenticated and verified as Owner via requireOwner
  let callerToken = null;
  if (isCron) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization || '';

    if (!cronSecret) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: CRON_SECRET is not configured on the server.'
      });
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing or invalid CRON_SECRET authorization.'
      });
    }
  } else {
    const auth = await requireOwner(req, res);
    if (!auth) return; // 401 or 403 sent by requireOwner
    callerToken = auth?.headers?.Authorization ? auth.headers.Authorization.replace(/^Bearer\s+/i, '') : null;
  }

  // Handle history inquiry
  if (action === 'history') {
    const history = await loadDispatchesFromSupabase(callerToken);
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

  // Persistent Idempotency Key (staff + date)
  const idempotencyId = `detailed_staff_report_${staffEmail}_${targetDate}`;
  const force = req.query.force === 'true' || req.body?.force === true;

  // Check persistent Supabase storage for existing dispatch
  const existingDispatch = await findExistingDispatchInSupabase(idempotencyId, callerToken);

  if ((action === 'send' || action === 'cron') && existingDispatch && !force) {
    if (existingDispatch.status === 'sent' || existingDispatch.status === 'delivered') {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: `Detailed report for ${staffEmail} on ${targetDate} was already dispatched at ${existingDispatch.sentAt || existingDispatch.updatedAt}.`,
        historyEntry: existingDispatch
      });
    }

    // Microsecond concurrency protection: check if another container claimed it within the last 3 minutes
    if (existingDispatch.status === 'in_progress') {
      const lastUpdate = new Date(existingDispatch.updatedAt || existingDispatch.createdAt || 0).getTime();
      if (Date.now() - lastUpdate < 3 * 60 * 1000) {
        return res.status(200).json({
          success: true,
          skipped: true,
          reason: `Detailed report for ${staffEmail} on ${targetDate} is currently being dispatched by another process.`,
          historyEntry: existingDispatch
        });
      }
    }
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
    // 1. Telecalling entries
    try {
      const tcRows = await supabaseFetchAll(`telecalling_entries?order=created_at.asc`, callerToken);
      if (Array.isArray(tcRows)) {
        const existingIds = new Set(telecalling.map(x => x.id));
        tcRows.forEach(r => { if (!existingIds.has(r.id)) telecalling.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query telecalling_entries: ${sanitizeErrorMessage(e)}`);
    }

    // 2. Leads
    try {
      const leadRows = await supabaseFetchAll(`leads?order=created_at.asc`, callerToken);
      if (Array.isArray(leadRows)) {
        const existingIds = new Set(leads.map(x => x.id));
        leadRows.forEach(r => { if (!existingIds.has(r.id)) leads.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query leads: ${sanitizeErrorMessage(e)}`);
    }

    // 3. Lead activities
    try {
      const actRows = await supabaseFetchAll(`lead_activities?order=created_at.asc`, callerToken);
      if (Array.isArray(actRows)) {
        const existingIds = new Set(activities.map(x => x.id));
        actRows.forEach(r => { if (!existingIds.has(r.id)) activities.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query lead_activities: ${sanitizeErrorMessage(e)}`);
    }

    // 4. Follow-ups
    try {
      const fuRows = await supabaseFetchAll(`follow_ups?order=created_at.asc`, callerToken);
      if (Array.isArray(fuRows)) {
        const existingIds = new Set(followups.map(x => x.id));
        fuRows.forEach(r => { if (!existingIds.has(r.id)) followups.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query follow_ups: ${sanitizeErrorMessage(e)}`);
    }

    // 5. CRM Quotations
    try {
      const qRows = await supabaseFetchAll(`crm_quotations?order=created_at.asc`, callerToken);
      if (Array.isArray(qRows)) {
        const existingIds = new Set(quotations.map(x => x.id));
        qRows.forEach(r => { if (!existingIds.has(r.id)) quotations.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query crm_quotations: ${sanitizeErrorMessage(e)}`);
    }

    // 6. Documents
    try {
      const docRows = await supabaseFetchAll(`documents?order=created_at.asc`, callerToken);
      if (Array.isArray(docRows)) {
        const existingIds = new Set(documents.map(x => x.id));
        docRows.forEach(r => { if (!existingIds.has(r.id)) documents.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query documents: ${sanitizeErrorMessage(e)}`);
    }

  } catch (outerErr) {
    queryErrors.push(`General database exception: ${sanitizeErrorMessage(outerErr)}`);
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

  // Atomic in-progress claim before dispatch
  await saveDispatchToSupabase({
    id: idempotencyId,
    reportType: 'detailed_staff_report',
    staffEmail,
    date: targetDate,
    recipient: cleanPhone,
    status: 'in_progress',
    summary: reportResult.counts
  }, callerToken);

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
    await saveDispatchToSupabase(failureEntry, callerToken);
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
        dispatchError = sanitizeErrorMessage(resData?.error?.message || resData?.message || `HTTP ${response.status}: Bizylead error`);
        console.error(`[Detailed Staff Report] Bizylead error on message ${i + 1}:`, sanitizeErrorMessage(resData));
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
      await saveDispatchToSupabase(failureEntry, callerToken);
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
      summary: reportResult.counts,
      ownerAttention: reportResult.ownerAttention
    };
    await saveDispatchToSupabase(successEntry, callerToken);

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
    const sanitizedMsg = sanitizeErrorMessage(err);
    console.error('[Detailed Staff Report] Exception sending WhatsApp:', sanitizedMsg);
    const failureEntry = {
      id: idempotencyId,
      reportType: 'detailed_staff_report',
      staffEmail,
      date: targetDate,
      recipient: cleanPhone,
      status: 'failed',
      error: sanitizedMsg,
      summary: reportResult.counts
    };
    await saveDispatchToSupabase(failureEntry, callerToken);
    return res.status(500).json({
      success: false,
      error: sanitizedMsg,
      historyEntry: failureEntry
    });
  }
}
