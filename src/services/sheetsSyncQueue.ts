/**
 * Google Sheets Sync Queue — Supabase-backed, phases B1 + B2
 *
 * Replaces the old fire-and-forget `mode: 'no-cors'` fetch with a durable,
 * retryable queue. This module owns all reads/writes to three tables:
 *
 *   google_sync_settings  - one row per company: webhook URL, enabled flag
 *   google_sync_queue     - one row per document (UNIQUE on document_id) -
 *                            the document's CURRENT sync status
 *   google_sync_log       - append-only history of every attempt
 *
 * Locking: claimDueRows() calls the `claim_sync_queue_rows` Postgres
 * function, which atomically claims due, unlocked rows in one statement
 * (UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)). This is the one
 * shared claiming implementation used by BOTH the browser worker (below)
 * and the future Vercel Cron worker (Phase B3) - there is no second copy
 * of this logic anywhere, so the two can never double-process a row.
 *
 * Phase B3 note: `sendToWebhook` now reads the real JSON response from
 * the Apps Script instead of using `mode: 'no-cors'` - "success" is
 * finally a real, trustworthy signal (the Apps Script's own `success`
 * field), not just "the request didn't throw at the network level".
 * See google-apps-script/Code.gs for the corresponding server-side
 * redesign (upsert by document_id, real JSON responses, validation,
 * logging). That script must be deployed and its URL set in
 * google_sync_settings before this takes effect for a given company.
 *
 * Dashboard UI (Phase B4) is not implemented here.
 */

import { supabase } from './supabaseClient';

// ─── Types ──────────────────────────────────────────────────────────

export type SyncAction = 'save_document' | 'delete_document';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncQueueRow {
  id: string;
  company_id: string;
  document_id: string | null;
  action: SyncAction;
  payload: Record<string, any>;
  payload_version: number;
  status: SyncStatus;
  attempts: number;
  max_attempts: number;
  failed_permanently: boolean;
  next_attempt_at: string;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLogRow {
  id: string;
  company_id: string;
  document_id: string | null;
  document_number: string | null;
  action: string;
  payload_version: number;
  status: 'synced' | 'failed';
  attempt_number: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SyncSettings {
  company_id: string;
  webhook_url: string | null;
  enabled: boolean;
  last_full_resync_at: string | null;
}

const CURRENT_PAYLOAD_VERSION = 1;

// ─── Backoff ────────────────────────────────────────────────────────

/**
 * Exponential backoff, capped, with a small jitter to avoid many
 * documents saved around the same time all retrying in lockstep.
 * Attempt 1 -> ~30s, 2 -> ~2m, 3 -> ~8m, 4 -> ~30m, 5+ -> capped at 2h.
 */
export function computeBackoffMs(attempts: number): number {
  const base = 30_000; // 30s
  const capped = Math.min(base * Math.pow(4, Math.max(0, attempts - 1)), 2 * 60 * 60 * 1000);
  const jitter = capped * (0.85 + Math.random() * 0.3); // +/-15%
  return Math.round(jitter);
}

// ─── Settings ───────────────────────────────────────────────────────

/**
 * Reads google_sync_settings first; falls back to the legacy
 * profiles.google_sheets_url column if no settings row exists yet
 * (covers the moment right after migration, or a company that hasn't
 * been touched by the new Settings UI - see Phase B4).
 */
export async function getSyncSettings(companyId: string): Promise<SyncSettings | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('google_sync_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (data) return data as SyncSettings;

    // Fallback: legacy column, not yet migrated into settings for this company
    const { data: profile } = await supabase
      .from('profiles')
      .select('google_sheets_url')
      .eq('id', companyId)
      .maybeSingle();

    if (profile?.google_sheets_url) {
      return {
        company_id: companyId,
        webhook_url: profile.google_sheets_url,
        enabled: true,
        last_full_resync_at: null
      };
    }
    return null;
  } catch (err) {
    console.error('[SyncQueue] Failed to read sync settings:', err);
    return null;
  }
}

// ─── Enqueue (upsert by document_id) ────────────────────────────────

/**
 * Enqueues a sync operation for a document. Upserts by document_id
 * (never document_number) - saving the same document again before its
 * previous sync completes resets this ONE row rather than creating a
 * competing entry, matching the UNIQUE(document_id) constraint.
 */
export async function enqueueSync(
  companyId: string,
  documentId: string,
  action: SyncAction,
  payload: Record<string, any>
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('google_sync_queue')
      .upsert({
        company_id: companyId,
        document_id: documentId,
        action,
        payload,
        payload_version: CURRENT_PAYLOAD_VERSION,
        status: 'pending',
        attempts: 0,
        failed_permanently: false,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'document_id' });

    if (error) {
      console.error('[SyncQueue] Failed to enqueue sync:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[SyncQueue] Failed to enqueue sync:', err);
    return false;
  }
}

// ─── Claiming (atomic, shared by browser + cron workers) ────────────

/**
 * Atomically claims up to `limit` due, unlocked rows via the
 * claim_sync_queue_rows RPC, marking them 'syncing' with this worker's
 * id. Safe to call concurrently from multiple workers - Postgres-level
 * locking (FOR UPDATE SKIP LOCKED inside the function) guarantees no
 * two callers ever claim the same row.
 */
export async function claimDueRows(workerId: string, limit: number = 10): Promise<SyncQueueRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('claim_sync_queue_rows', {
      p_worker_id: workerId,
      p_limit: limit
    });
    if (error) {
      console.error('[SyncQueue] Failed to claim due rows:', error);
      return [];
    }
    return (data || []) as SyncQueueRow[];
  } catch (err) {
    console.error('[SyncQueue] Failed to claim due rows:', err);
    return [];
  }
}

// ─── Marking outcome ─────────────────────────────────────────────────

/**
 * Marks a claimed row as successfully synced, and writes a log entry.
 * The queue row itself is kept (not deleted) as the document's current
 * status record - a future save will upsert it back to 'pending'.
 */
export async function markSynced(
  row: SyncQueueRow,
  timing: { startedAt: string; completedAt: string; durationMs: number }
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('google_sync_queue')
      .update({
        status: 'synced',
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);

    await writeLog(row, 'synced', null, timing);
  } catch (err) {
    console.error('[SyncQueue] Failed to mark row synced:', err);
  }
}

/**
 * Marks a claimed row as failed. Increments attempts, computes the next
 * backoff, and sets failed_permanently once max_attempts is reached -
 * this is the dead-letter mechanism: a permanently-failed row is
 * excluded from claimDueRows() forever, until a manual retry resets it.
 */
export async function markFailed(
  row: SyncQueueRow,
  errorMessage: string,
  timing: { startedAt: string; completedAt: string; durationMs: number }
): Promise<void> {
  if (!supabase) return;
  const nextAttempts = row.attempts + 1;
  const isDead = nextAttempts >= row.max_attempts;
  try {
    await supabase
      .from('google_sync_queue')
      .update({
        status: 'failed',
        attempts: nextAttempts,
        failed_permanently: isDead,
        next_attempt_at: new Date(Date.now() + computeBackoffMs(nextAttempts)).toISOString(),
        last_error: errorMessage,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);

    await writeLog(row, 'failed', errorMessage, timing, nextAttempts);
  } catch (err) {
    console.error('[SyncQueue] Failed to mark row failed:', err);
  }
}

/**
 * Resets a specific document's queue row for a manual retry - clears
 * failed_permanently and attempts, so it re-enters the claimable pool
 * immediately regardless of its prior backoff schedule.
 */
export async function retryDocument(documentId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('google_sync_queue')
      .update({
        status: 'pending',
        attempts: 0,
        failed_permanently: false,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

    if (error) return false;
    // "Run immediately" per requirement - don't wait for the next
    // scheduled tick. Fire-and-forget: the queue row's own status
    // (visible live via Realtime) is the source of truth for the UI,
    // not this call's return value.
    processQueueOnce(BROWSER_WORKER_ID).catch(err => console.error('[SyncQueue] Immediate retry run failed:', err));
    return true;
  } catch (err) {
    console.error('[SyncQueue] Failed to reset document for retry:', err);
    return false;
  }
}

/**
 * Re-enqueues every currently-failed row for a company (used by a
 * future "Retry All" button - Phase B4).
 */
export async function retryAllFailed(companyId: string): Promise<number> {
  if (!supabase) return 0;
  try {
    const { data, error } = await supabase
      .from('google_sync_queue')
      .update({
        status: 'pending',
        attempts: 0,
        failed_permanently: false,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString()
      })
      .eq('company_id', companyId)
      .eq('status', 'failed')
      .select('id');

    if (error) {
      console.error('[SyncQueue] Failed to retry all failed rows:', error);
      return 0;
    }
    const count = (data || []).length;
    if (count > 0) {
      processQueueOnce(BROWSER_WORKER_ID, count).catch(err => console.error('[SyncQueue] Immediate retry-all run failed:', err));
    }
    return count;
  } catch (err) {
    console.error('[SyncQueue] Failed to retry all failed rows:', err);
    return 0;
  }
}

// ─── Log ─────────────────────────────────────────────────────────────

async function writeLog(
  row: SyncQueueRow,
  status: 'synced' | 'failed',
  errorMessage: string | null,
  timing: { startedAt: string; completedAt: string; durationMs: number },
  attemptNumberOverride?: number
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('google_sync_log').insert({
      company_id: row.company_id,
      document_id: row.document_id,
      document_number: (row.payload && (row.payload as any).document_number) || null,
      action: row.action,
      payload_version: row.payload_version,
      status,
      attempt_number: attemptNumberOverride ?? (row.attempts + 1),
      error_message: errorMessage,
      started_at: timing.startedAt,
      completed_at: timing.completedAt,
      duration_ms: timing.durationMs
    });
  } catch (err) {
    console.error('[SyncQueue] Failed to write sync log entry:', err);
  }
}

// ─── Status queries (for the dashboard - Phase B4) ──────────────────

export async function getQueueStatusForCompany(companyId: string): Promise<SyncQueueRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('google_sync_queue')
      .select('*')
      .eq('company_id', companyId);
    if (error) {
      console.error('[SyncQueue] Failed to read queue status:', error);
      return [];
    }
    return (data || []) as SyncQueueRow[];
  } catch (err) {
    console.error('[SyncQueue] Failed to read queue status:', err);
    return [];
  }
}

export async function getSyncLogForCompany(companyId: string, limit: number = 100): Promise<SyncLogRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('google_sync_log')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[SyncQueue] Failed to read sync log:', error);
      return [];
    }
    return (data || []) as SyncLogRow[];
  } catch (err) {
    console.error('[SyncQueue] Failed to read sync log:', err);
    return [];
  }
}

// ─── Webhook call (Phase B3 - real response reading, no more no-cors) ──

export interface WebhookResponse {
  success: boolean;
  document_id?: string;
  action?: string;
  sheet_row?: number;
  message?: string;
  error?: string;
}

async function sendToWebhook(url: string, payload: Record<string, any>): Promise<WebhookResponse> {
  // Content-Type is deliberately text/plain, NOT application/json - this
  // is what avoids a CORS preflight against Apps Script (verified against
  // current documentation: Apps Script cannot reliably serve as a
  // preflight responder for genuinely preflighted requests). No `mode:
  // 'no-cors'` anymore - the response is now fully readable.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });

  // Apps Script Web Apps always return HTTP 200 for any request the
  // script itself handles without an uncaught platform-level crash -
  // there is no API for it to set a custom status code (verified). So
  // response.ok is not a meaningful success signal by itself; the JSON
  // body's own `success` field is authoritative and is what's actually
  // checked below.
  let body: WebhookResponse;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Webhook returned a non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Webhook returned HTTP ${response.status}`);
  }
  if (!body.success) {
    throw new Error(body?.error || body?.message || 'Webhook reported failure');
  }
  return body;
}

// ─── Row processing (shared by the browser worker and the future cron worker) ──

/**
 * Processes one claimed row: resolves the company's webhook settings,
 * calls the webhook, and marks the row synced or failed with timing.
 * A row whose company has no configured/enabled webhook is marked
 * failed immediately (not retried forever against a URL that will
 * never exist) but does NOT count toward max_attempts as harshly -
 * it still increments attempts, since there's no separate "unconfigured"
 * state in this schema; if this proves noisy in practice, a dedicated
 * status can be added later.
 */
export async function processClaimedRow(row: SyncQueueRow): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const settings = await getSyncSettings(row.company_id);
    if (!settings?.webhook_url || !settings.enabled) {
      throw new Error(settings?.enabled === false ? 'Sync disabled for this company' : 'No webhook URL configured');
    }

    await sendToWebhook(settings.webhook_url, row.payload);

    const completedAt = new Date().toISOString();
    await markSynced(row, {
      startedAt,
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime()
    });
  } catch (err) {
    const completedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(row, message, {
      startedAt,
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime()
    });
  }
}

/**
 * Claims and processes one batch of due rows. Safe to call from
 * multiple triggers (interval tick, online event, app load, manual
 * retry) concurrently - claimDueRows() is the atomic gate that prevents
 * any row from being processed twice.
 */
export async function processQueueOnce(workerId: string, limit: number = 10): Promise<number> {
  const rows = await claimDueRows(workerId, limit);
  if (rows.length === 0) return 0;
  await Promise.all(rows.map(row => processClaimedRow(row)));
  return rows.length;
}

// ─── Browser worker lifecycle ───────────────────────────────────────

const BROWSER_WORKER_ID = 'browser-' + (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const PERIODIC_INTERVAL_MS = 60_000; // 1 minute

let workerState: {
  intervalId: ReturnType<typeof setInterval> | null;
  onlineHandler: (() => void) | null;
  running: boolean;
} = { intervalId: null, onlineHandler: null, running: false };

// Phase B4: in-memory heartbeat for the dashboard's "Worker running" /
// "Last worker execution" display. Honest limitation, stated plainly:
// this reflects only THIS browser tab's worker, not any other open tab
// and not a cron worker (none exists yet - see conversation).
let lastWorkerTickAt: string | null = null;

export function getWorkerStatus(): { running: boolean; lastTickAt: string | null } {
  return { running: workerState.running, lastTickAt: lastWorkerTickAt };
}

/**
 * Starts the browser worker: runs once immediately, then on a 60s
 * interval, and immediately again whenever the browser regains
 * connectivity. Idempotent - calling this while already running is a
 * no-op, so React StrictMode's double-invoke of effects (or any other
 * accidental double-call) can never register two intervals/listeners.
 */
export function startBrowserWorker(): void {
  if (workerState.running) return;
  workerState.running = true;

  const tick = () => {
    lastWorkerTickAt = new Date().toISOString();
    processQueueOnce(BROWSER_WORKER_ID).catch(err => {
      console.error('[SyncQueue] Browser worker tick failed:', err);
    });
  };

  tick(); // run once immediately on start (covers "starts on application load")

  workerState.intervalId = setInterval(tick, PERIODIC_INTERVAL_MS);

  workerState.onlineHandler = () => tick();
  window.addEventListener('online', workerState.onlineHandler);
}

/** Stops the browser worker - clears the interval and the online listener. */
export function stopBrowserWorker(): void {
  if (workerState.intervalId) clearInterval(workerState.intervalId);
  if (workerState.onlineHandler) window.removeEventListener('online', workerState.onlineHandler);
  workerState = { intervalId: null, onlineHandler: null, running: false };
}
