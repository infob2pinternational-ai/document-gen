import { supabase, isSupabaseConfigured } from './supabaseClient';
import type {
  TelecallingEntry,
  TelecallingStatus,
  TelecallingDailyReportData,
  TelecallingWeeklyReportData,
  TelecallingGoogleSyncQueueRow
} from '../types';
import { isUnresolvedStatus } from '../types';
import { getSyncSettings, computeBackoffMs } from './sheetsSyncQueue';
import { getKolkataToday, getKolkataWeekRange } from '../utils/dateUtils';

export const DEFAULT_TELECALLING_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbysHw97D_vV3j0yIUI94fPN0ycj_pJCq_No0UGsRZlTaQgLo3sTb5vOON0yRz63idBRVQ/exec';

export function getTelecallingWebhookUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_TELECALLING_WEBHOOK_URL;
  const custom = localStorage.getItem('b2p_telecalling_webhook_url');
  return custom && custom.trim() ? custom.trim() : DEFAULT_TELECALLING_WEBHOOK_URL;
}

export function setTelecallingWebhookUrl(url: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('b2p_telecalling_webhook_url', url.trim());
  }
}

const BROWSER_WORKER_ID = `browser_worker_${Math.random().toString(36).substring(2, 9)}`;

export interface CreateTelecallingEntryInput {
  company_id: string;
  entry_date: string; // YYYY-MM-DD
  company_name: string;
  contact_person?: string | null;
  phone: string;
  other_phone?: string | null;
  location?: string | null;
  email?: string | null;
  call_status: TelecallingStatus;
  feedback?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
  created_by_name?: string | null;
}

export interface TelecallingSaveResult {
  success: boolean;
  entry?: TelecallingEntry;
  error?: string;
}

// In-memory idempotency lock to prevent double-clicks or concurrent double saves
const activeSaveKeys = new Set<string>();

// Cache to prevent duplicate inserts for identical payloads within 15 seconds
const recentSubmissions = new Map<string, { timestamp: number; entry: TelecallingEntry }>();

class TelecallingService {
  /**
   * Creates a new telecalling entry in Supabase (Single Source of Truth).
   * STRICT: Never saves a silent local fallback on error.
   */
  async createEntry(input: CreateTelecallingEntryInput): Promise<TelecallingSaveResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error: 'Cloud database connection is not configured. Telecalling requires active Supabase access.'
      };
    }

    const cleanCompany = (input.company_name || '').trim();
    const cleanPhone = (input.phone || '').trim();
    const entryDate = input.entry_date || getKolkataToday();

    // Clean entries older than 30 seconds
    const now = Date.now();
    for (const [k, v] of recentSubmissions.entries()) {
      if (now - v.timestamp > 30000) {
        recentSubmissions.delete(k);
      }
    }

    // De-duplication check: if identical phone and company was saved within last 15 seconds, return existing record
    const dedupeKey = `${input.company_id}_${entryDate}_${cleanPhone}_${cleanCompany.toLowerCase()}`;
    const recentCached = recentSubmissions.get(dedupeKey);
    if (recentCached && (now - recentCached.timestamp < 15000)) {
      return {
        success: true,
        entry: recentCached.entry
      };
    }

    // Idempotency lock key based on company, date, phone and company_name
    const lockKey = dedupeKey;
    if (activeSaveKeys.has(lockKey)) {
      return {
        success: false,
        error: 'A submission for this contact is already being processed. Please wait a moment.'
      };
    }

    activeSaveKeys.add(lockKey);

    try {
      const payload: any = {
        company_id: input.company_id,
        entry_date: entryDate,
        company_name: cleanCompany,
        contact_person: input.contact_person?.trim() || null,
        phone: cleanPhone,
        other_phone: input.other_phone?.trim() || null,
        location: input.location?.trim() || null,
        email: input.email?.trim() || null,
        call_status: input.call_status,
        feedback: input.feedback?.trim() || null,
        created_by: input.created_by || null,
        created_by_email: input.created_by_email || null,
        created_by_name: input.created_by_name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('telecalling_entries')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      const savedEntry = data as TelecallingEntry;

      // Cache recent submission to block immediate re-inserts
      recentSubmissions.set(dedupeKey, { timestamp: Date.now(), entry: savedEntry });

      // Automatically enqueue to dedicated Google sync queue (non-blocking)
      void this.enqueueGoogleSync(savedEntry).catch(syncErr => {
        console.warn('[Telecalling] Google sync enqueue non-fatal notice:', syncErr);
      });

      return {
        success: true,
        entry: savedEntry
      };
    } catch (err: any) {
      console.error('[Telecalling] Save failed:', err);
      return {
        success: false,
        error: err.message || 'Failed to save record to cloud database. Please retry.'
      };
    } finally {
      activeSaveKeys.delete(lockKey);
    }
  }

  /**
   * Updates an existing telecalling entry in Supabase.
   */
  async updateEntry(id: string, updates: Partial<CreateTelecallingEntryInput>): Promise<TelecallingSaveResult> {
    if (!isSupabaseConfigured() || !supabase) {
      return {
        success: false,
        error: 'Cloud database connection is not configured.'
      };
    }

    try {
      const payload: any = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('telecalling_entries')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw new Error(error.message);

      const updatedEntry = data as TelecallingEntry;

      // Re-enqueue for Google Sheets update
      void this.enqueueGoogleSync(updatedEntry).catch(err => {
        console.warn('[Telecalling] Re-enqueue notice:', err);
      });

      return {
        success: true,
        entry: updatedEntry
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Failed to update telecalling record.'
      };
    }
  }

  /**
   * Deletes an entry from Supabase.
   */
  async deleteEntry(id: string): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured() || !supabase) {
      return { success: false, error: 'Database not connected.' };
    }

    try {
      const { error } = await supabase
        .from('telecalling_entries')
        .delete()
        .eq('id', id);

      if (error) throw new Error(error.message);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to delete entry.' };
    }
  }

  /**
   * Fetches entries for a specific date with optional filters.
   */
  async getEntriesForDate(
    companyId: string,
    dateStr: string,
    filters?: {
      telecaller?: string;
      status?: TelecallingStatus | 'all';
      search?: string;
    }
  ): Promise<TelecallingEntry[]> {
    if (!isSupabaseConfigured() || !supabase || !companyId) return [];

    try {
      let query = supabase
        .from('telecalling_entries')
        .select(`
          *,
          queue:telecalling_google_sync_queue(status, last_error, updated_at)
        `)
        .eq('company_id', companyId)
        .eq('entry_date', dateStr)
        .order('created_at', { ascending: false });

      if (filters?.telecaller && filters.telecaller !== 'all') {
        query = query.or(`created_by_email.eq.${filters.telecaller},created_by_name.eq.${filters.telecaller}`);
      }

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('call_status', filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;

      let entries: TelecallingEntry[] = (data || []).map((row: any) => {
        const q = Array.isArray(row.queue) ? row.queue[0] : row.queue;
        return {
          id: row.id,
          company_id: row.company_id,
          entry_date: row.entry_date,
          company_name: row.company_name,
          contact_person: row.contact_person,
          phone: row.phone,
          other_phone: row.other_phone,
          location: row.location,
          email: row.email,
          call_status: row.call_status,
          feedback: row.feedback,
          created_by: row.created_by,
          created_by_email: row.created_by_email,
          created_by_name: row.created_by_name,
          created_at: row.created_at,
          updated_at: row.updated_at,
          google_sync_status: q?.status || 'pending',
          google_sync_error: q?.last_error || null,
          google_synced_at: q?.status === 'synced' ? q.updated_at : null
        };
      });

      if (filters?.search && filters.search.trim()) {
        const s = filters.search.trim().toLowerCase();
        entries = entries.filter(e =>
          (e.company_name && e.company_name.toLowerCase().includes(s)) ||
          (e.contact_person && e.contact_person.toLowerCase().includes(s)) ||
          (e.phone && e.phone.includes(s)) ||
          (e.location && e.location.toLowerCase().includes(s)) ||
          (e.feedback && e.feedback.toLowerCase().includes(s))
        );
      }

      return entries;
    } catch (err) {
      console.error('[Telecalling] Failed to fetch entries for date:', err);
      return [];
    }
  }

  /**
   * Fetches entries for a week range (startDate to endDate inclusive).
   */
  async getEntriesForWeek(
    companyId: string,
    startDate: string,
    endDate: string,
    filters?: {
      telecaller?: string;
      status?: TelecallingStatus | 'all';
    }
  ): Promise<TelecallingEntry[]> {
    if (!isSupabaseConfigured() || !supabase || !companyId) return [];

    try {
      let query = supabase
        .from('telecalling_entries')
        .select('*')
        .eq('company_id', companyId)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .order('entry_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (filters?.telecaller && filters.telecaller !== 'all') {
        query = query.or(`created_by_email.eq.${filters.telecaller},created_by_name.eq.${filters.telecaller}`);
      }

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('call_status', filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as TelecallingEntry[];
    } catch (err) {
      console.error('[Telecalling] Failed to fetch weekly entries:', err);
      return [];
    }
  }

  /**
   * Computes Daily Report metrics purely from database records.
   */
  computeDailyReport(entries: TelecallingEntry[], dateStr: string): TelecallingDailyReportData {
    const statusCounts: Record<TelecallingStatus, number> = {
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

    const telecallerActivity: Record<string, number> = {};
    const uniqueCompanySet = new Set<string>();
    let followUps = 0;
    const unresolvedEntries: TelecallingEntry[] = [];

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

      const callerKey = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : 'Unassigned');
      telecallerActivity[callerKey] = (telecallerActivity[callerKey] || 0) + 1;

      if (e.company_name) {
        uniqueCompanySet.add(e.company_name.trim().toLowerCase());
      }
    }

    return {
      date: dateStr,
      totalCalls: entries.length,
      uniqueCompanies: uniqueCompanySet.size,
      statusCounts,
      telecallerActivity,
      followUpsCount: followUps,
      unresolvedCallsCount: unresolvedEntries.length,
      unresolvedEntries,
      entries
    };
  }

  /**
   * Computes Weekly Report metrics purely from database records.
   */
  computeWeeklyReport(
    entries: TelecallingEntry[],
    startDate: string,
    endDate: string
  ): TelecallingWeeklyReportData {
    const weekRange = getKolkataWeekRange(startDate);
    const dayMap: Record<string, { total: number; statusCounts: Record<TelecallingStatus, number> }> = {};

    for (const day of weekRange.days) {
      dayMap[day.date] = {
        total: 0,
        statusCounts: {
          'Appointment Confirmed': 0,
          'Interested / Details Shared': 0,
          'Follow-up Required': 0,
          'Call Back': 0,
          'No Answer / No Response': 0,
          'No Interest': 0,
          'Not Reachable / Switched Off': 0,
          'Wrong / Invalid Number': 0,
          'Other': 0
        }
      };
    }

    const overallStatusCounts: Record<TelecallingStatus, number> = {
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

    const telecallerBreakdown: Record<string, { total: number; statusCounts: Record<TelecallingStatus, number> }> = {};
    const uniqueCompanies = new Set<string>();
    let followUps = 0;

    for (const e of entries) {
      const st = (e.call_status in overallStatusCounts) ? e.call_status : 'Other';
      overallStatusCounts[st]++;

      if (st === 'Follow-up Required' || st === 'Call Back') {
        followUps++;
      }

      if (e.company_name) {
        uniqueCompanies.add(e.company_name.trim().toLowerCase());
      }

      // Day breakdown
      if (dayMap[e.entry_date]) {
        dayMap[e.entry_date].total++;
        dayMap[e.entry_date].statusCounts[st]++;
      }

      // Telecaller breakdown
      const caller = e.created_by_name || (e.created_by_email ? e.created_by_email.split('@')[0] : 'Unassigned');
      if (!telecallerBreakdown[caller]) {
        telecallerBreakdown[caller] = {
          total: 0,
          statusCounts: {
            'Appointment Confirmed': 0,
            'Interested / Details Shared': 0,
            'Follow-up Required': 0,
            'Call Back': 0,
            'No Answer / No Response': 0,
            'No Interest': 0,
            'Not Reachable / Switched Off': 0,
            'Wrong / Invalid Number': 0,
            'Other': 0
          }
        };
      }
      telecallerBreakdown[caller].total++;
      telecallerBreakdown[caller].statusCounts[st]++;
    }

    const dailyBreakdown = weekRange.days.map(d => ({
      date: d.date,
      dayName: d.dayName,
      totalCalls: dayMap[d.date]?.total || 0,
      statusCounts: dayMap[d.date]?.statusCounts || {
        'Appointment Confirmed': 0,
        'Interested / Details Shared': 0,
        'Follow-up Required': 0,
        'Call Back': 0,
        'No Answer / No Response': 0,
        'No Interest': 0,
        'Not Reachable / Switched Off': 0,
        'Wrong / Invalid Number': 0,
        'Other': 0
      }
    }));

    return {
      startDate,
      endDate,
      totalCalls: entries.length,
      uniqueCompanies: uniqueCompanies.size,
      statusCounts: overallStatusCounts,
      dailyBreakdown,
      telecallerBreakdown,
      followUpsCount: followUps,
      entries
    };
  }

  // =====================================================================
  // DEDICATED TELECALLING GOOGLE SHEETS SYNC QUEUE
  // =====================================================================

  /**
   * Enqueues an entry into telecalling_google_sync_queue.
   */
  async enqueueGoogleSync(entry: TelecallingEntry): Promise<boolean> {
    if (!isSupabaseConfigured() || !supabase) return false;

    try {
      const syncPayload = {
        entry_id: entry.id,
        date: entry.entry_date,
        company_name: entry.company_name,
        contact_person: entry.contact_person || '',
        phone: entry.phone,
        other_phone: entry.other_phone || '',
        location: entry.location || '',
        email: entry.email || '',
        call_status: entry.call_status,
        feedback: entry.feedback || '',
        created_by: entry.created_by_name || entry.created_by_email || '',
        created_at: entry.created_at,
        updated_at: entry.updated_at
      };

      const { error } = await supabase
        .from('telecalling_google_sync_queue')
        .upsert({
          company_id: entry.company_id,
          telecalling_entry_id: entry.id,
          action: 'save_telecalling_entry',
          payload: syncPayload,
          status: 'pending',
          attempts: 0,
          failed_permanently: false,
          next_attempt_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'telecalling_entry_id' });

      if (error) {
        console.error('[TelecallingSync] Failed to enqueue sync row:', error);
        return false;
      }

      // Trigger immediate background sync tick
      void this.processSyncQueueOnce(entry.company_id).catch(e => {
        console.warn('[TelecallingSync] Background worker tick:', e);
      });

      return true;
    } catch (err) {
      console.error('[TelecallingSync] Enqueue exception:', err);
      return false;
    }
  }

  /**
   * Processes due rows in telecalling_google_sync_queue.
   */
  async processSyncQueueOnce(companyId: string): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) return;

    try {
      const telecallingUrl = getTelecallingWebhookUrl();
      const settings = await getSyncSettings(companyId);
      const webhookUrl = telecallingUrl || settings?.webhook_url;
      if (!webhookUrl) {
        return; // Sync not configured
      }

      // Claim rows via RPC
      const { data: rows, error: claimError } = await supabase.rpc('claim_telecalling_sync_queue_rows', {
        p_worker_id: BROWSER_WORKER_ID,
        p_limit: 10
      });

      if (claimError || !rows || rows.length === 0) {
        return;
      }

      for (const row of rows as TelecallingGoogleSyncQueueRow[]) {
        await this.syncQueueRow(row, webhookUrl);
      }
    } catch (err) {
      console.error('[TelecallingSync] processSyncQueueOnce error:', err);
    }
  }

  private async syncQueueRow(row: TelecallingGoogleSyncQueueRow, webhookUrl: string): Promise<void> {
    if (!supabase) return;

    try {
      const payloadToSend = {
        action: 'save_telecalling_entry',
        ...row.payload
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payloadToSend)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result || result.success === false) {
        throw new Error(result?.error || result?.message || 'Apps Script returned failure');
      }

      // Mark row as synced
      await supabase
        .from('telecalling_google_sync_queue')
        .update({
          status: 'synced',
          last_error: null,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id);

    } catch (err: any) {
      const nextAttempts = (row.attempts || 0) + 1;
      const isDead = nextAttempts >= row.max_attempts;
      const backoffMs = computeBackoffMs(nextAttempts);

      await supabase
        .from('telecalling_google_sync_queue')
        .update({
          status: 'failed',
          attempts: nextAttempts,
          failed_permanently: isDead,
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
          last_error: err.message || String(err),
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id);
    }
  }

  /**
   * Resets a specific entry's sync queue status for manual retry.
   */
  async retryEntrySync(telecallingEntryId: string, companyId: string): Promise<boolean> {
    if (!supabase) return false;

    try {
      const { error } = await supabase
        .from('telecalling_google_sync_queue')
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
        .eq('telecalling_entry_id', telecallingEntryId);

      if (error) return false;

      void this.processSyncQueueOnce(companyId);
      return true;
    } catch (err) {
      console.error('[TelecallingSync] Retry error:', err);
      return false;
    }
  }

  /**
   * Fast search across historical telecalling records by company, contact person, or phone.
   */
  async searchPreviousEntries(
    companyId: string,
    rawQuery: string,
    limit: number = 30
  ): Promise<TelecallingEntry[]> {
    if (!isSupabaseConfigured() || !supabase || !companyId) return [];
    const q = rawQuery.trim();
    if (!q) return [];

    try {
      const sanitized = q.replace(/[%_,]/g, ' ');
      const queryFilter = `company_name.ilike.%${sanitized}%,contact_person.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,other_phone.ilike.%${sanitized}%`;

      const { data, error } = await supabase
        .from('telecalling_entries')
        .select('*')
        .eq('company_id', companyId)
        .or(queryFilter)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as TelecallingEntry[];
    } catch (err) {
      console.error('[Telecalling] Historical search failed:', err);
      return [];
    }
  }

  /**
   * Checks if phone or company already exists in previous records.
   * Returns the most recent matching record for gentle duplicate warning.
   */
  async checkDuplicateWarning(
    companyId: string,
    phone: string,
    companyName?: string
  ): Promise<TelecallingEntry | null> {
    if (!isSupabaseConfigured() || !supabase || !companyId) return null;

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanCompany = (companyName || '').trim();

    // Only search if phone has >= 6 digits or company name has >= 3 chars
    if (cleanPhone.length < 6 && cleanCompany.length < 3) {
      return null;
    }

    try {
      const orClauses: string[] = [];
      if (cleanPhone.length >= 6) {
        orClauses.push(`phone.ilike.%${cleanPhone}%`);
        orClauses.push(`other_phone.ilike.%${cleanPhone}%`);
      }
      if (cleanCompany.length >= 3) {
        const sanitized = cleanCompany.replace(/[%_,]/g, ' ');
        orClauses.push(`company_name.ilike.%${sanitized}%`);
      }

      const { data, error } = await supabase
        .from('telecalling_entries')
        .select('*')
        .eq('company_id', companyId)
        .or(orClauses.join(','))
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? (data[0] as TelecallingEntry) : null;
    } catch (err) {
      console.warn('[Telecalling] checkDuplicateWarning notice:', err);
      return null;
    }
  }

  /**
   * Checks if an entry with the same phone or company was already submitted today
   * or within the last maxAgeMinutes window.
   */
  async findRecentDuplicate(
    companyId: string,
    phone: string,
    companyName?: string,
    maxAgeMinutes: number = 10
  ): Promise<TelecallingEntry | null> {
    if (!isSupabaseConfigured() || !supabase || !companyId) return null;

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const cleanCompany = (companyName || '').trim();

    if (cleanPhone.length < 6 && cleanCompany.length < 3) {
      return null;
    }

    try {
      const todayKolkata = getKolkataToday();
      const orClauses: string[] = [];
      if (cleanPhone.length >= 6) {
        orClauses.push(`phone.ilike.%${cleanPhone}%`);
        orClauses.push(`other_phone.ilike.%${cleanPhone}%`);
      }
      if (cleanCompany.length >= 3) {
        const sanitized = cleanCompany.replace(/[%_,]/g, ' ');
        orClauses.push(`company_name.ilike.%${sanitized}%`);
      }

      let query = supabase
        .from('telecalling_entries')
        .select('*')
        .eq('company_id', companyId)
        .eq('entry_date', todayKolkata)
        .or(orClauses.join(','))
        .order('created_at', { ascending: false });

      if (maxAgeMinutes > 0) {
        const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
        query = query.gte('created_at', cutoffTime);
      }

      const { data, error } = await query.limit(1);
      if (error) throw error;
      return data && data.length > 0 ? (data[0] as TelecallingEntry) : null;
    } catch (err) {
      console.warn('[Telecalling] findRecentDuplicate notice:', err);
      return null;
    }
  }

  /**
   * Sends the Daily Report via Google Apps Script Web App (MailApp).
   */
  async sendDailyReportEmail(payload: {
    to: string;
    subject: string;
    body: string;
    htmlBody?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const webhookUrl = getTelecallingWebhookUrl();
    if (!webhookUrl) {
      return {
        success: false,
        error: 'Google Apps Script Web App URL is not configured.'
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'send_telecalling_report_email',
          to: payload.to.trim(),
          subject: payload.subject,
          body: payload.body,
          htmlBody: payload.htmlBody || null
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = await response.json();
      if (!res || res.success === false) {
        throw new Error(res?.error || res?.message || 'Apps Script returned failure');
      }

      return { success: true };
    } catch (err: any) {
      console.error('[Telecalling] sendDailyReportEmail failed:', err);
      return {
        success: false,
        error: err.message || 'Failed to send email via Google Apps Script'
      };
    }
  }
}

export const telecallingService = new TelecallingService();
