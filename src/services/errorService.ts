/**
 * Internal Error & Diagnostic Logging Service
 * Captures operational errors without exposing technical stack traces to end users.
 * Never logs passwords, auth tokens, session tokens, or secrets.
 */
import { supabase, isCloudActive } from './db';
import { generateUUID } from '../utils/uuid';
import { metricsService } from './metricsService';

export interface AppErrorLog {
  id: string;
  timestamp: string; // ISO string
  user_email: string;
  company_id?: string;
  lead_id?: string;
  operation: string; // e.g., 'log_call', 'save_follow_up', 'excel_import', 'fetch_leads'
  screen?: string; // e.g., 'TodaysCalls', 'CallingDatabase', 'CallEntryModal'
  error_message: string;
  error_code?: string;
  metadata?: Record<string, any>;
  resolved?: boolean;
}

const STORAGE_KEY = 'docgen_error_logs';
const MAX_LOCAL_LOGS = 100;

// Sensitive keys filter to prevent credential leakage
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'authorization',
  'apikey',
  'anon_key',
  'service_role'
]);

function sanitizeMetadata(data?: Record<string, any>): Record<string, any> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('pass')) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      try {
        clean[key] = JSON.parse(JSON.stringify(value));
      } catch {
        clean[key] = String(value);
      }
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function getLocalErrors(): AppErrorLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalErrors(errors: AppErrorLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(errors.slice(0, MAX_LOCAL_LOGS)));
  } catch (e) {
    console.error('[errorService] Failed to write error log to localStorage:', e);
  }
}

export const errorService = {
  /**
   * Log an operational error. Always saves locally and attempts Supabase write-through.
   */
  async logError(params: {
    userEmail: string;
    operation: string;
    errorMessage: string;
    errorCode?: string;
    companyId?: string;
    leadId?: string;
    screen?: string;
    metadata?: Record<string, any>;
  }): Promise<AppErrorLog> {
    const logItem: AppErrorLog = {
      id: generateUUID(),
      timestamp: new Date().toISOString(),
      user_email: params.userEmail || 'system',
      company_id: params.companyId,
      lead_id: params.leadId,
      operation: params.operation,
      screen: params.screen,
      error_message: params.errorMessage || 'Unknown operational error',
      error_code: params.errorCode,
      metadata: sanitizeMetadata(params.metadata),
      resolved: false
    };

    // 1. Always save in local buffer
    const local = getLocalErrors();
    local.unshift(logItem);
    saveLocalErrors(local);

    // Notify listeners so UI updates immediately
    metricsService.notifyChange();

    // 2. Best-effort write-through to Supabase if cloud active
    if (isCloudActive() && supabase) {
      try {
        const payload: any = {
          id: logItem.id,
          user_email: logItem.user_email,
          operation: logItem.operation,
          error_message: logItem.error_message,
          created_at: logItem.timestamp
        };
        if (logItem.company_id) payload.company_id = logItem.company_id;
        if (logItem.lead_id) payload.lead_id = logItem.lead_id;
        if (logItem.screen) payload.screen = logItem.screen;
        if (logItem.error_code) payload.error_code = logItem.error_code;
        if (logItem.metadata) payload.metadata = logItem.metadata;

        await supabase.from('app_error_logs').insert(payload);
      } catch (cloudErr) {
        console.warn('[errorService] Failed to sync error log to Supabase:', cloudErr);
      }
    }

    return logItem;
  },

  /**
   * Synchronously get local error logs buffer
   */
  getLocalErrors(companyId?: string, limit: number = 50): AppErrorLog[] {
    const local = getLocalErrors();
    if (companyId) {
      return local.filter(l => !l.company_id || l.company_id === companyId).slice(0, limit);
    }
    return local.slice(0, limit);
  },

  /**
   * Get operational error logs for Owner/Admin view
   */
  async getErrors(companyId?: string, limit: number = 50): Promise<AppErrorLog[]> {
    // 1. If cloud is active, try fetching from Supabase first
    if (isCloudActive() && supabase) {
      try {
        let query = supabase
          .from('app_error_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (companyId) {
          query = query.or(`company_id.eq.${companyId},company_id.is.null`);
        }

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return data.map((d: any) => ({
            id: d.id,
            timestamp: d.created_at,
            user_email: d.user_email,
            company_id: d.company_id,
            lead_id: d.lead_id,
            operation: d.operation,
            screen: d.screen,
            error_message: d.error_message,
            error_code: d.error_code,
            metadata: d.metadata,
            resolved: Boolean(d.resolved)
          }));
        }
      } catch (err) {
        console.warn('[errorService] Could not fetch cloud errors, falling back to local:', err);
      }
    }

    // 2. Fallback to local storage
    const local = getLocalErrors();
    if (companyId) {
      return local.filter(l => !l.company_id || l.company_id === companyId).slice(0, limit);
    }
    return local.slice(0, limit);
  },

  /**
   * Mark an error log as resolved / acknowledged
   */
  async resolveError(id: string): Promise<void> {
    const local = getLocalErrors();
    const target = local.find(l => l.id === id);
    if (target) {
      target.resolved = true;
      saveLocalErrors(local);
      metricsService.notifyChange();
    }

    if (isCloudActive() && supabase) {
      try {
        await supabase.from('app_error_logs').update({ resolved: true }).eq('id', id);
      } catch (err) {
        console.warn('[errorService] Failed to resolve error in cloud:', err);
      }
    }
  },

  /**
   * Clear local error logs
   */
  clearLocalErrors(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      metricsService.notifyChange();
    } catch (e) {
      console.error('[errorService] Failed to clear local errors:', e);
    }
  }
};
