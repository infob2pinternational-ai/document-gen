import https from 'https';
import { requireOwner } from '../server/auth.js';
import {
  TARGET_STAFF_EMAIL,
  OWNER_WHATSAPP_NUMBER,
  buildDetailedStaffReport,
  formatDetailedReportWhatsAppMessages
} from '../server/detailedStaffReport.js';

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
  if (!row) return null;
  return {
    id: row.id,
    reportType: row.report_type || row.reportType || 'detailed_staff_report',
    staffEmail: row.staff_email || row.staffEmail,
    date: row.report_date || row.date,
    recipient: row.recipient,
    status: row.status,
    sentAt: row.sent_at || row.sentAt,
    sentCount: row.sent_count || row.sentCount,
    messageIds: row.message_ids || row.messageIds || [],
    messageResults: row.message_results || row.messageResults || [],
    summary: row.summary || {},
    ownerAttention: row.owner_attention || row.ownerAttention || [],
    error: row.error,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt
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

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
}

function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
}

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
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  if (!refreshToken || !supabaseUrl || !supabaseAnonKey) {
    return cachedAdminToken || supabaseAnonKey;
  }

  try {
    const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
    const res = await httpsRequest(url, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
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
  return cachedAdminToken || supabaseAnonKey;
}

/**
 * Loads recent dispatches from persistent Supabase table owner_report_dispatches.
 * Fails with an error if Supabase storage is unavailable (strictly no in-memory fallback).
 */
async function loadDispatchesFromSupabase(callerToken = null) {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error('Persistent storage unavailable: SUPABASE_URL not configured.');
  }
  const token = callerToken || await getAdminToken(false);
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/owner_report_dispatches?report_type=eq.detailed_staff_report&order=updated_at.desc&limit=50`;
  const res = await httpsRequest(url, {
    method: 'GET',
    headers: {
      'apikey': getSupabaseAnonKey(),
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to load dispatches from Supabase: HTTP ${res.status}`);
  }

  const rows = res.json();
  if (Array.isArray(rows)) {
    return rows.map(normalizeDbRowToHistory);
  }
  return [];
}

/**
 * Executes an atomic PostgreSQL claim operation for the report dispatch.
 * Calls public.claim_owner_report_dispatch RPC using SUPABASE_SERVICE_ROLE_KEY.
 * Restricts claim execution to service_role only.
 * If the PostgreSQL RPC fails or is unavailable, halts immediately with an error (no fallback locking methods).
 */
async function acquireAtomicClaimInPostgres(idempotencyId, staffEmail, targetDate, recipientPhone, force = false) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('Persistent storage unavailable: server-side claim operation requires SUPABASE_SERVICE_ROLE_KEY.');
  }
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error('Persistent storage unavailable: SUPABASE_URL not configured.');
  }

  const rpcUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/claim_owner_report_dispatch`;
  const rpcRes = await httpsRequest(rpcUrl, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    p_id: idempotencyId,
    p_staff_email: staffEmail,
    p_report_date: targetDate,
    p_recipient: recipientPhone,
    p_force: Boolean(force)
  }));

  if (!rpcRes.ok) {
    throw new Error(`claim_owner_report_dispatch RPC failed with HTTP ${rpcRes.status}: ${sanitizeErrorMessage(rpcRes.text())}`);
  }

  const claimResult = rpcRes.json();
  if (!claimResult || typeof claimResult.acquired !== 'boolean') {
    throw new Error('claim_owner_report_dispatch RPC returned invalid or unparseable response.');
  }

  return {
    acquired: claimResult.acquired,
    reason: claimResult.reason,
    dispatch: normalizeDbRowToHistory(claimResult.dispatch)
  };
}

/**
 * Updates dispatch state in Supabase table owner_report_dispatches.
 * Throws an Error if Supabase fails or is unreachable so callers can stop execution immediately.
 */
async function updateDispatchInSupabase(idempotencyId, fields, callerToken = null) {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    throw new Error('Persistent storage unavailable: SUPABASE_URL not configured.');
  }
  const token = callerToken || await getAdminToken(false);
  const tableUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/owner_report_dispatches?id=eq.${encodeURIComponent(idempotencyId)}`;
  
  const payload = {
    updated_at: new Date().toISOString()
  };
  if (fields.status) payload.status = fields.status;
  if (fields.sent_at) payload.sent_at = fields.sent_at;
  if (typeof fields.sent_count === 'number') payload.sent_count = fields.sent_count;
  if (fields.message_ids) payload.message_ids = fields.message_ids;
  if (fields.message_results) payload.message_results = fields.message_results;
  if (fields.summary) payload.summary = fields.summary;
  if (fields.owner_attention) payload.owner_attention = fields.owner_attention;
  if (fields.error !== undefined) payload.error = fields.error ? sanitizeErrorMessage(fields.error) : null;

  const res = await httpsRequest(tableUrl, {
    method: 'PATCH',
    headers: {
      'apikey': getSupabaseAnonKey(),
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  }, JSON.stringify(payload));

  if (!res.ok) {
    const errorText = sanitizeErrorMessage(res.text());
    console.error(`[Detailed Staff Report] Failed to update dispatch (HTTP ${res.status}):`, errorText);
    throw new Error(`Database dispatch update failed (HTTP ${res.status}): ${errorText}`);
  }

  return res;
}

/**
 * Paged Supabase REST API fetcher.
 * Automatically loops with limit/offset to prevent omitting records beyond 1000 items.
 */
async function supabaseFetchAll(endpoint, callerToken = null) {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) return [];
  const token = callerToken || await getAdminToken(false);
  const pageSize = 1000;
  let offset = 0;
  const allResults = [];

  while (true) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const pagedEndpoint = `${endpoint}${separator}limit=${pageSize}&offset=${offset}`;
    const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${pagedEndpoint}`;

    try {
      const res = await httpsRequest(url, {
        method: 'GET',
        headers: {
          'apikey': getSupabaseAnonKey(),
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
    try {
      const history = await loadDispatchesFromSupabase(callerToken);
      return res.status(200).json({ success: true, history });
    } catch (err) {
      return res.status(503).json({
        success: false,
        error: `History unavailable: ${sanitizeErrorMessage(err)}`
      });
    }
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

  const isDryRun = req.query?.dry_run === 'true' || req.body?.dry_run === true;
  const force = req.query.force === 'true' || req.body?.force === true;
  const idempotencyId = `detailed_staff_report_${staffEmail}_${targetDate}`;

  // Atomic PostgreSQL Claim Operation (mandatory for actual send/cron executions)
  let claimResult = null;
  if ((action === 'send' || action === 'cron') && !isDryRun) {
    try {
      claimResult = await acquireAtomicClaimInPostgres(idempotencyId, staffEmail, targetDate, cleanPhone, force);
    } catch (claimErr) {
      // If Supabase is unavailable or claim cannot be persisted, STOP SENDING.
      // Do NOT fall back to in-memory storage.
      console.error('[Detailed Staff Report] Atomic claim failed:', sanitizeErrorMessage(claimErr));
      return res.status(503).json({
        success: false,
        error: 'Persistent storage unavailable. Automated report delivery halted to prevent duplicate messages.',
        details: sanitizeErrorMessage(claimErr)
      });
    }

    // Only the execution that successfully acquires the claim may send WhatsApp messages
    if (!claimResult.acquired) {
      const isManualReview = claimResult.reason === 'manual_review_required';
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: isManualReview
          ? `Detailed report for ${staffEmail} on ${targetDate} is flagged for manual review and cannot be dispatched automatically.`
          : `Detailed report for ${staffEmail} on ${targetDate} was already dispatched (or is currently locked by another active process).`,
        claimReason: claimResult.reason,
        historyEntry: claimResult.dispatch
      });
    }
  }

  // Query CRM Data (strictly read-only)
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
    try {
      const tcRows = await supabaseFetchAll(`telecalling_entries?order=created_at.asc`, callerToken);
      if (Array.isArray(tcRows)) {
        const existingIds = new Set(telecalling.map(x => x.id));
        tcRows.forEach(r => { if (!existingIds.has(r.id)) telecalling.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query telecalling_entries: ${sanitizeErrorMessage(e)}`);
    }

    try {
      const leadRows = await supabaseFetchAll(`leads?order=created_at.asc`, callerToken);
      if (Array.isArray(leadRows)) {
        const existingIds = new Set(leads.map(x => x.id));
        leadRows.forEach(r => { if (!existingIds.has(r.id)) leads.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query leads: ${sanitizeErrorMessage(e)}`);
    }

    try {
      const actRows = await supabaseFetchAll(`lead_activities?order=created_at.asc`, callerToken);
      if (Array.isArray(actRows)) {
        const existingIds = new Set(activities.map(x => x.id));
        actRows.forEach(r => { if (!existingIds.has(r.id)) activities.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query lead_activities: ${sanitizeErrorMessage(e)}`);
    }

    try {
      const fuRows = await supabaseFetchAll(`follow_ups?order=created_at.asc`, callerToken);
      if (Array.isArray(fuRows)) {
        const existingIds = new Set(followups.map(x => x.id));
        fuRows.forEach(r => { if (!existingIds.has(r.id)) followups.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query follow_ups: ${sanitizeErrorMessage(e)}`);
    }

    try {
      const qRows = await supabaseFetchAll(`crm_quotations?order=created_at.asc`, callerToken);
      if (Array.isArray(qRows)) {
        const existingIds = new Set(quotations.map(x => x.id));
        qRows.forEach(r => { if (!existingIds.has(r.id)) quotations.push(r); });
      }
    } catch (e) {
      queryErrors.push(`Failed to query crm_quotations: ${sanitizeErrorMessage(e)}`);
    }

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
    const errorMsg = 'Bizylead WhatsApp credentials (BIZYLEAD_API_KEY / BIZYLEAD_PHONE_NUMBER_ID) not configured in environment.';
    await updateDispatchInSupabase(idempotencyId, {
      status: 'failed',
      error: errorMsg,
      summary: reportResult.counts
    }, callerToken).catch(() => {});

    return res.status(503).json({
      success: false,
      error: errorMsg
    });
  }

  // Handle partial delivery: inspect previous attempts to avoid resending succeeded or uncertain parts
  const existingResults = Array.isArray(claimResult?.dispatch?.messageResults)
    ? claimResult.dispatch.messageResults
    : (Array.isArray(claimResult?.dispatch?.messageIds) && typeof claimResult.dispatch.messageIds[0] === 'object'
      ? claimResult.dispatch.messageIds
      : []);

  // Parts that must NEVER be automatically resent on retry:
  // - Already delivered/sent parts
  // - Parts whose delivery status is uncertain (to prevent duplicate delivery)
  const nonResendablePartNumbers = new Set(
    existingResults
      .filter(r => r.status === 'sent' || r.status === 'delivered' || r.status === 'uncertain')
      .map(r => r.part)
  );

  const sentResults = [...existingResults.filter(r => nonResendablePartNumbers.has(r.part))];
  let dispatchError = null;

  try {
    for (let i = 0; i < messagesToSend.length; i++) {
      const msg = messagesToSend[i];

      // If this part was already successfully delivered OR its delivery status is uncertain, DO NOT RESEND!
      if (nonResendablePartNumbers.has(msg.part)) {
        const existingPart = existingResults.find(r => r.part === msg.part);
        if (existingPart?.status === 'uncertain') {
          console.warn(`[Detailed Staff Report] Part ${msg.part} of ${msg.total} delivery status is uncertain. Skipping automatic resend to prevent duplicates.`);
        } else {
          console.log(`[Detailed Staff Report] Part ${msg.part} of ${msg.total} was already delivered previously. Skipping resend.`);
        }
        continue;
      }

      // 1.2s delay between messages for delivery sequencing and rate limit safety
      if (sentResults.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      const payload = {
        to: cleanPhone,
        phoneNoId: bizyleadPhoneId,
        type: 'text',
        text: msg.text
      };

      let response;
      let resData = null;
      try {
        response = await httpsRequest(bizyUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${bizyleadApiKey}`,
            'Content-Type': 'application/json'
          }
        }, JSON.stringify(payload));
        resData = response.json();
      } catch (bizyReqErr) {
        // Network error contacting WhatsApp gateway: delivery status is uncertain!
        const netErr = sanitizeErrorMessage(bizyReqErr);
        console.error(`[Detailed Staff Report] Network exception dispatching part ${msg.part}:`, netErr);

        sentResults.push({
          part: msg.part,
          total: msg.total,
          status: 'uncertain',
          error: `Network error contacting WhatsApp gateway: ${netErr}`,
          attemptedAt: new Date().toISOString()
        });

        const manualReviewReason = `Network error contacting WhatsApp gateway on part ${msg.part} of ${msg.total}. Delivery status is uncertain. Stopped further dispatch and flagged for manual review.`;
        try {
          await updateDispatchInSupabase(idempotencyId, {
            status: 'requires_manual_review',
            error: manualReviewReason,
            message_results: sentResults,
            message_ids: sentResults.map(s => s.messageId).filter(Boolean),
            sent_count: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length
          }, callerToken);
        } catch (emergencyErr) {
          console.error('[Detailed Staff Report] Emergency update for manual review also failed:', sanitizeErrorMessage(emergencyErr));
        }

        return res.status(500).json({
          success: false,
          status: 'requires_manual_review',
          error: manualReviewReason,
          uncertainPart: msg.part,
          deliveredCount: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length,
          totalParts: messagesToSend.length,
          messageResults: sentResults
        });
      }

      if (!response.ok) {
        dispatchError = sanitizeErrorMessage(resData?.error?.message || resData?.message || `HTTP ${response.status}: Bizylead error`);
        console.error(`[Detailed Staff Report] Bizylead error on message ${msg.part}:`, sanitizeErrorMessage(resData));

        sentResults.push({
          part: msg.part,
          total: msg.total,
          status: 'failed',
          error: dispatchError,
          attemptedAt: new Date().toISOString()
        });

        // Update incremental status immediately to record the partial state
        try {
          await updateDispatchInSupabase(idempotencyId, {
            status: 'partially_sent',
            error: dispatchError,
            message_results: sentResults,
            message_ids: sentResults.map(s => s.messageId).filter(Boolean),
            sent_count: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length
          }, callerToken);
        } catch (dbErr) {
          const dbErrMsg = sanitizeErrorMessage(dbErr);
          console.error(`[Detailed Staff Report] Database error saving failure progress for part ${msg.part}:`, dbErrMsg);

          try {
            await updateDispatchInSupabase(idempotencyId, {
              status: 'requires_manual_review',
              error: `Database persistence failed after gateway error on part ${msg.part}. (DB error: ${dbErrMsg})`,
              message_results: sentResults,
              message_ids: sentResults.map(s => s.messageId).filter(Boolean),
              sent_count: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length
            }, callerToken);
          } catch {}

          return res.status(500).json({
            success: false,
            status: 'requires_manual_review',
            error: `Failed to save message progress in database for part ${msg.part}. Flagged for manual review.`,
            deliveredCount: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length,
            totalParts: messagesToSend.length,
            messageResults: sentResults
          });
        }

        break;
      } else {
        const msgId = resData?.messageId || resData?.messages?.[0]?.id || `bizy_detailed_${Date.now()}_${msg.part}`;
        const partResult = {
          part: msg.part,
          total: msg.total,
          status: 'sent',
          messageId: msgId,
          sentAt: new Date().toISOString()
        };
        sentResults.push(partResult);

        // Update incremental status after each successful part
        try {
          await updateDispatchInSupabase(idempotencyId, {
            status: 'in_progress',
            message_results: sentResults,
            message_ids: sentResults.map(s => s.messageId).filter(Boolean),
            sent_count: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length
          }, callerToken);
        } catch (dbErr) {
          const dbErrMsg = sanitizeErrorMessage(dbErr);
          console.error(`[Detailed Staff Report] Database error saving progress for part ${msg.part}:`, dbErrMsg);

          // Part was delivered to WhatsApp gateway, but DB update failed: status is uncertain!
          partResult.status = 'uncertain';
          partResult.error = `Database progress persistence failed: ${dbErrMsg}`;

          const manualReviewReason = `Database error saving message progress after sending part ${msg.part} of ${msg.total}. Immediately stopped further messages to prevent duplicates. Flagged for manual review. (DB error: ${dbErrMsg})`;

          // Flag the report for manual review in Supabase
          try {
            await updateDispatchInSupabase(idempotencyId, {
              status: 'requires_manual_review',
              error: manualReviewReason,
              message_results: sentResults,
              message_ids: sentResults.map(s => s.messageId).filter(Boolean),
              sent_count: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length
            }, callerToken);
          } catch (emergencyErr) {
            console.error('[Detailed Staff Report] Emergency update for manual review also failed:', sanitizeErrorMessage(emergencyErr));
          }

          // Immediately stop sending further messages!
          return res.status(500).json({
            success: false,
            status: 'requires_manual_review',
            error: manualReviewReason,
            uncertainPart: msg.part,
            deliveredCount: sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length,
            totalParts: messagesToSend.length,
            messageResults: sentResults
          });
        }
      }
    }

    const hasUncertainParts = sentResults.some(s => s.status === 'uncertain');
    const successfulParts = sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length;
    const totalParts = messagesToSend.length;

    if (hasUncertainParts) {
      const reviewMsg = `Report contains message parts with uncertain delivery status. Cannot mark dispatch as complete automatically; manual verification required.`;
      try {
        await updateDispatchInSupabase(idempotencyId, {
          status: 'requires_manual_review',
          error: reviewMsg,
          message_results: sentResults,
          message_ids: sentResults.map(s => s.messageId).filter(Boolean),
          sent_count: successfulParts,
          summary: reportResult.counts
        }, callerToken);
      } catch {}

      return res.status(500).json({
        success: false,
        status: 'requires_manual_review',
        error: reviewMsg,
        deliveredCount: successfulParts,
        totalParts,
        messageResults: sentResults
      });
    }

    if (dispatchError || successfulParts < totalParts) {
      const finalStatus = successfulParts > 0 ? 'partially_sent' : 'failed';
      try {
        await updateDispatchInSupabase(idempotencyId, {
          status: finalStatus,
          error: dispatchError || 'Not all message parts delivered successfully.',
          message_results: sentResults,
          message_ids: sentResults.map(s => s.messageId).filter(Boolean),
          sent_count: successfulParts,
          summary: reportResult.counts
        }, callerToken);
      } catch (dbErr) {
        const dbErrMsg = sanitizeErrorMessage(dbErr);
        console.error('[Detailed Staff Report] Database error saving final partial status:', dbErrMsg);
        try {
          await updateDispatchInSupabase(idempotencyId, {
            status: 'requires_manual_review',
            error: `Partial delivery occurred and DB persistence failed. (DB error: ${dbErrMsg})`,
            message_results: sentResults,
            message_ids: sentResults.map(s => s.messageId).filter(Boolean),
            sent_count: successfulParts
          }, callerToken);
        } catch {}
      }

      return res.status(500).json({
        success: false,
        status: finalStatus,
        error: dispatchError || 'Partial delivery occurred.',
        deliveredCount: successfulParts,
        totalParts,
        messageResults: sentResults
      });
    }

    // Complete delivery of all parts
    try {
      await updateDispatchInSupabase(idempotencyId, {
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: successfulParts,
        message_results: sentResults,
        message_ids: sentResults.map(s => s.messageId).filter(Boolean),
        summary: reportResult.counts,
        owner_attention: reportResult.ownerAttention,
        error: null
      }, callerToken);
    } catch (finalDbErr) {
      const finalErrMsg = sanitizeErrorMessage(finalDbErr);
      console.error('[Detailed Staff Report] Failed to mark final dispatch as sent in database:', finalErrMsg);

      const manualReviewReason = `All message parts sent to WhatsApp, but final status update in database failed. Flagged for manual review. (DB error: ${finalErrMsg})`;
      try {
        await updateDispatchInSupabase(idempotencyId, {
          status: 'requires_manual_review',
          error: manualReviewReason,
          sent_count: successfulParts,
          message_results: sentResults,
          message_ids: sentResults.map(s => s.messageId).filter(Boolean),
          summary: reportResult.counts
        }, callerToken);
      } catch {}

      return res.status(500).json({
        success: false,
        status: 'requires_manual_review',
        error: manualReviewReason,
        deliveredCount: successfulParts,
        totalParts,
        messageResults: sentResults
      });
    }

    return res.status(200).json({
      success: true,
      recipient: cleanPhone,
      date: targetDate,
      staffEmail,
      sentCount: successfulParts,
      sentResults
    });

  } catch (err) {
    const sanitizedMsg = sanitizeErrorMessage(err);
    console.error('[Detailed Staff Report] Exception during dispatch:', sanitizedMsg);

    const successfulParts = sentResults.filter(s => s.status === 'sent' || s.status === 'delivered').length;
    const hasUncertain = sentResults.some(s => s.status === 'uncertain');
    const finalStatus = hasUncertain ? 'requires_manual_review' : (successfulParts > 0 ? 'partially_sent' : 'failed');

    await updateDispatchInSupabase(idempotencyId, {
      status: finalStatus,
      error: sanitizedMsg,
      message_results: sentResults,
      message_ids: sentResults.map(s => s.messageId).filter(Boolean),
      sent_count: successfulParts,
      summary: reportResult?.counts || {}
    }, callerToken).catch(() => {});

    return res.status(500).json({
      success: false,
      status: finalStatus,
      error: sanitizedMsg,
      deliveredCount: successfulParts,
      messageResults: sentResults
    });
  }
}
