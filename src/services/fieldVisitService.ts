/**
 * Field Sales: data access, offline outbox and synchronisation.
 *
 * Every write goes through the database workflow functions
 * (save_field_visit, review_field_visit, convert_field_visit_to_lead). Nothing
 * here decides who the salesperson is, which company they may use, or what a
 * visit's status is: the server does, on every call. Anything cached on the
 * device (role, companies, visits) only decides what the screen shows.
 *
 * No React in this file, so it can be tested directly.
 */
import { generateUUID } from '../utils/uuid';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FieldVisitStatus = 'submitted' | 'needs_correction' | 'approved' | 'rejected' | 'converted';

/** B2P's actual service list (https://www.b2pinternational.com/), offered to a salesperson. */
export type RequirementKey =
  | 'mobile_led_van_advertising' | 'led_wall_display_rental' | 'lookwalker_advertising'
  | 'vehicle_branding_fleet_wraps' | 'billboard_hoarding_advertising' | 'event_roadshow_marketing'
  | 'graphic_designing' | 'video_production_4k' | 'event_video_coverage' | 'acrylic_signage_3d'
  | 'shop_boards_signage' | 'commercial_printing' | 'digital_marketing' | 'whatsapp_bulk_messaging'
  | 'brand_promotion' | 'corporate_advertising' | 'pr_media_strategy' | 'other';

export const REQUIREMENT_OPTIONS: { value: RequirementKey; label: string }[] = [
  { value: 'mobile_led_van_advertising', label: 'Mobile LED Van Advertising' },
  { value: 'led_wall_display_rental', label: 'LED Wall Display Rental' },
  { value: 'lookwalker_advertising', label: 'Lookwalker Advertising' },
  { value: 'vehicle_branding_fleet_wraps', label: 'Vehicle Branding & Fleet Wraps' },
  { value: 'billboard_hoarding_advertising', label: 'Billboard & Hoarding Advertising' },
  { value: 'event_roadshow_marketing', label: 'Event & Roadshow Marketing' },
  { value: 'graphic_designing', label: 'Graphic Designing' },
  { value: 'video_production_4k', label: '4K Video Production' },
  { value: 'event_video_coverage', label: 'Event Video Coverage' },
  { value: 'acrylic_signage_3d', label: '3D Acrylic Signage' },
  { value: 'shop_boards_signage', label: 'Shop Boards & Signage' },
  { value: 'commercial_printing', label: 'Commercial Printing' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'whatsapp_bulk_messaging', label: 'WhatsApp Bulk Messaging' },
  { value: 'brand_promotion', label: 'Brand Promotion' },
  { value: 'corporate_advertising', label: 'Corporate Advertising' },
  { value: 'pr_media_strategy', label: 'PR & Media Strategy' },
  { value: 'other', label: 'Other / Custom Requirement' }
];

/**
 * Keys a visit could have been saved with before this list changed
 * (Website / Billing Software / CRM / Attendance Software). No longer offered
 * for a new selection, but a visit already carrying one of these must keep
 * showing a real label, not a raw database key - see requirementLabel below.
 */
export const LEGACY_REQUIREMENT_LABELS: Record<string, string> = {
  website: 'Website', billing_software: 'Billing Software', crm: 'CRM', attendance_software: 'Attendance Software'
};

/** The label for any requirement key this app has ever stored: current, legacy, or (defensively) unknown. */
export function requirementLabel(key: string): string {
  return REQUIREMENT_OPTIONS.find(option => option.value === key)?.label || LEGACY_REQUIREMENT_LABELS[key] || key;
}

export const STATUS_LABEL: Record<FieldVisitStatus, string> = {
  submitted: 'Pending review',
  needs_correction: 'Needs correction',
  approved: 'Approved',
  rejected: 'Rejected',
  converted: 'Converted to lead'
};

/** What the salesperson types. `id` is created on the device and never changes: it is what makes retries safe. */
export interface FieldVisitInput {
  id: string;
  company_id: string;
  business_name: string;
  phone: string;
  contact_person: string;
  location: string;
  requirements: RequirementKey[];
  requirement_other: string;
  estimated_budget: string;
  remarks: string;
  follow_up_date: string;
  client_created_at: string;
}

/** A visit as stored on the server. */
export interface FieldVisit {
  id: string;
  company_id: string;
  salesperson_id: string | null;
  salesperson_email: string;
  business_name: string;
  phone: string;
  phone_normalized: string;
  location: string | null;
  contact_person: string | null;
  requirements: RequirementKey[];
  requirement_other: string | null;
  estimated_budget: number | string | null;
  remarks: string | null;
  follow_up_date: string | null;
  status: FieldVisitStatus;
  review_note: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  lead_id: string | null;
  follow_up_id: string | null;
  conversion_mode: 'new_lead' | 'linked_existing' | null;
  converted_by_email: string | null;
  converted_at: string | null;
  client_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldVisitEvent {
  id: number | string;
  visit_id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  actor_email: string;
  actor_role: string;
  self_review: boolean;
  note: string | null;
  details: Record<string, any>;
  created_at: string;
}

export interface FieldSalesCompany { id: string; name: string }
export interface FieldVisitAssignee { email: string; role: string }
export interface LeadMatch {
  id: string; lead_number: string | null; customer_name: string | null; company_name: string | null;
  phone: string | null; status: string | null; assigned_telecaller_email: string | null;
}
export interface ConvertResult {
  result: 'converted' | 'already_converted' | 'duplicates_found';
  mode?: 'new_lead' | 'linked_existing';
  visit: FieldVisit;
  lead_id?: string | null;
  lead_number?: string | null;
  follow_up_id?: string | null;
  matches?: LeadMatch[];
}
export interface ConvertOptions {
  assigneeEmail?: string | null;
  existingLeadId?: string | null;
  forceNew?: boolean;
  followUpDate?: string | null;
}

/**
 * local_state
 *   draft    kept on this device only; the salesperson has not sent it yet
 *   pending  sent by the salesperson, waiting to reach the server
 *   error    the server refused it; it stays here with the reason until fixed
 */
export type LocalState = 'draft' | 'pending' | 'error';
export interface LocalVisit extends FieldVisitInput {
  local_state: LocalState;
  sync_error: string;
  /** Why the last attempt did not go through, when it will be retried automatically. */
  waiting_reason: string;
  attempts: number;
  /** Goes up by one on every local save; used to notice an edit made while the visit was being sent. */
  revision: number;
  updated_at: string;
  /** Set when this is a correction of a visit the office sent back. */
  correction_of_status: FieldVisitStatus | null;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** transient = try again later without bothering the user; otherwise the server said no. */
export class FieldSalesError extends Error {
  transient: boolean;
  code: string;
  constructor(message: string, transient: boolean, code = '') {
    super(message);
    this.name = 'FieldSalesError';
    this.transient = transient;
    this.code = code;
  }
}

/** Turn whatever the network or the database returned into a FieldSalesError. */
export function toFieldSalesError(error: any): FieldSalesError {
  if (error instanceof FieldSalesError) return error;
  const message = String(error?.message || error || 'Unknown error');
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const looksLikeNetwork = /failed to fetch|fetch failed|network|load failed|timeout|timed out|aborted|ECONN|ENOTFOUND/i.test(message);
  // Expired or missing login: the visit is fine, the session is not.
  if (code === 'PGRST301' || status === 401 || /jwt expired|invalid jwt|JWT/i.test(message)) {
    return new FieldSalesError('Sign in again to send your saved visits.', true, 'no_session');
  }
  // 57014 = statement timeout, 40P01 = deadlock, 40001 = serialization: all safe to retry.
  if (offline || looksLikeNetwork || status >= 500 || ['57014', '40P01', '40001', '53300', '08006'].includes(code)) {
    return new FieldSalesError('No connection. Will retry automatically.', true, code || 'network');
  }
  // The functions are not installed yet (database migration not applied).
  if (code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message)) {
    return new FieldSalesError('Field Sales is not switched on for this account yet. Your visit is saved on this phone.', true, 'not_installed');
  }
  return new FieldSalesError(message, false, code);
}

// ─── Validation (the server validates again; this is for quick feedback) ─────

export function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (/^91[0-9]{10}$/.test(digits)) return digits.slice(2);
  if (/^0[0-9]{10}$/.test(digits)) return digits.slice(1);
  return digits;
}

export type FieldErrors = Partial<Record<keyof FieldVisitInput, string>>;

export function validateVisit(input: FieldVisitInput, mode: 'draft' | 'submit'): FieldErrors {
  const errors: FieldErrors = {};
  const name = input.business_name.trim();
  const phone = normalizePhone(input.phone);
  if (mode === 'submit') {
    if (!input.company_id) errors.company_id = 'Choose the company this visit is for.';
    if (!name) errors.business_name = 'Enter the business name.';
    if (!input.phone.trim()) errors.phone = 'Enter a phone number.';
  } else if (!name && !input.phone.trim()) {
    errors.business_name = 'Enter a business name or phone number to save a draft.';
  }
  if (name.length > 200) errors.business_name = 'Business name is too long (200 characters at most).';
  if (input.phone.trim() && !/^[0-9]{6,15}$/.test(phone)) errors.phone = 'Enter a valid phone number (6 to 15 digits).';
  if (input.phone.length > 40) errors.phone = 'Phone number is too long.';
  if (input.contact_person.length > 200) errors.contact_person = 'Contact name is too long.';
  if (input.location.length > 300) errors.location = 'Location is too long (300 characters at most).';
  if (input.requirement_other.length > 300) errors.requirement_other = 'Too long (300 characters at most).';
  if (mode === 'submit' && input.requirements.includes('other') && !input.requirement_other.trim()) {
    errors.requirement_other = 'Say what the other requirement is.';
  }
  if (input.remarks.length > 2000) errors.remarks = 'Remarks are too long (2000 characters at most).';
  const budget = input.estimated_budget.trim();
  if (budget && (!/^[0-9]+(\.[0-9]{1,2})?$/.test(budget) || Number(budget) >= 1e12)) errors.estimated_budget = 'Enter the budget as a number, for example 25000.';
  if (input.follow_up_date && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.follow_up_date)) errors.follow_up_date = 'Choose a valid date.';
  return errors;
}

export function emptyVisit(companyId = ''): FieldVisitInput {
  return {
    id: generateUUID(), company_id: companyId, business_name: '', phone: '', contact_person: '', location: '',
    requirements: [], requirement_other: '', estimated_budget: '', remarks: '', follow_up_date: '',
    client_created_at: new Date().toISOString()
  };
}

/** A server visit turned back into form values, for correcting a visit the office returned. */
export function inputFromVisit(visit: FieldVisit): FieldVisitInput {
  return {
    id: visit.id, company_id: visit.company_id, business_name: visit.business_name || '', phone: visit.phone || '',
    contact_person: visit.contact_person || '', location: visit.location || '',
    requirements: [...(visit.requirements || [])], requirement_other: visit.requirement_other || '',
    estimated_budget: visit.estimated_budget === null || visit.estimated_budget === undefined ? '' : String(Number(visit.estimated_budget)),
    remarks: visit.remarks || '', follow_up_date: visit.follow_up_date || '',
    client_created_at: visit.client_created_at || visit.created_at
  };
}

/** Exactly what is sent to save_field_visit. Nothing about identity or status is included. */
export function toServerPayload(input: FieldVisitInput): Record<string, unknown> {
  return {
    id: input.id,
    company_id: input.company_id,
    business_name: input.business_name.trim(),
    phone: input.phone.trim(),
    contact_person: input.contact_person.trim(),
    location: input.location.trim(),
    requirements: input.requirements,
    requirement_other: input.requirements.includes('other') ? input.requirement_other.trim() : '',
    estimated_budget: input.estimated_budget.trim(),
    remarks: input.remarks.trim(),
    follow_up_date: input.follow_up_date || '',
    client_created_at: input.client_created_at
  };
}

// ─── Server API ─────────────────────────────────────────────────────────────

export interface FieldSalesApi {
  /** Companies the signed-in user may submit visits for. */
  companies(): Promise<FieldSalesCompany[]>;
  saveVisit(payload: Record<string, unknown>): Promise<{ result: string; visit: FieldVisit }>;
  /** Visits the signed-in user is allowed to see (their own, or a company's for reviewers). */
  listVisits(companyId?: string): Promise<FieldVisit[]>;
  listEvents(visitId: string): Promise<FieldVisitEvent[]>;
  review(visitId: string, action: 'approve' | 'reject' | 'request_correction', note?: string): Promise<{ result: string; visit: FieldVisit }>;
  assignees(companyId: string): Promise<FieldVisitAssignee[]>;
  convert(visitId: string, options: ConvertOptions): Promise<ConvertResult>;
}

/** The real implementation: Supabase RPC calls to the database functions, nothing else. */
export function createSupabaseFieldSalesApi(client: any): FieldSalesApi {
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    if (!client) throw new FieldSalesError('The database connection is not configured.', false, 'not_configured');
    let response;
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) throw new FieldSalesError('Sign in again to send your saved visits.', true, 'no_session');
      response = await client.rpc(name, args);
    } catch (error) {
      throw toFieldSalesError(error);
    }
    if (response.error) throw toFieldSalesError({ ...response.error, status: response.status });
    return response.data;
  };
  const select = async (build: (c: any) => any) => {
    if (!client) throw new FieldSalesError('The database connection is not configured.', false, 'not_configured');
    let response;
    try { response = await build(client); } catch (error) { throw toFieldSalesError(error); }
    if (response.error) throw toFieldSalesError({ ...response.error, status: response.status });
    return response.data || [];
  };
  return {
    companies: async () => (await rpc('my_field_sales_companies')) || [],
    saveVisit: payload => rpc('save_field_visit', { p_visit: payload }),
    listVisits: companyId => select(c => {
      let query = c.from('field_visits').select('*').order('created_at', { ascending: false }).limit(1000);
      if (companyId) query = query.eq('company_id', companyId);
      return query;
    }),
    listEvents: visitId => select(c => c.from('field_visit_events').select('*').eq('visit_id', visitId).order('id', { ascending: true })),
    review: (visitId, action, note) => rpc('review_field_visit', { p_visit_id: visitId, p_action: action, p_note: note ?? null }),
    assignees: async companyId => (await rpc('field_visit_assignees', { p_company_id: companyId })) || [],
    convert: (visitId, options) => rpc('convert_field_visit_to_lead', {
      p_visit_id: visitId,
      p_assignee_email: options.assigneeEmail || null,
      p_existing_lead_id: options.existingLeadId || null,
      p_force_new: Boolean(options.forceNew),
      p_follow_up_date: options.followUpDate || null
    })
  };
}

// ─── Device storage ─────────────────────────────────────────────────────────

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const outboxKey = (userId: string) => `b2p_field_visits_outbox:${userId}`;
const cacheKey = (userId: string) => `b2p_field_visits_cache:${userId}`;
const accessKey = (userId: string) => `b2p_field_sales_access:${userId}`;
const IDENTITY_KEY = 'b2p_field_sales_identity';
/** After this long without a successful online check, cached access is no longer trusted to open the screens. */
export const ACCESS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedAccess { role: string; companies: FieldSalesCompany[]; checkedAt: string }
export interface CachedIdentity { userId: string; email: string }

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Remembered only so the visit screens can open without a connection. The server never sees or trusts it. */
export const fieldSalesAccessCache = {
  save(storage: KeyValueStorage, userId: string, role: string, companies: FieldSalesCompany[]) {
    try { storage.setItem(accessKey(userId), JSON.stringify({ role, companies, checkedAt: new Date().toISOString() })); } catch { /* display cache only */ }
  },
  load(storage: KeyValueStorage, userId: string, now = Date.now()): CachedAccess | null {
    const cached = readJson<CachedAccess | null>(storage, accessKey(userId), null);
    if (!cached || !cached.checkedAt) return null;
    if (now - Date.parse(cached.checkedAt) > ACCESS_CACHE_MAX_AGE_MS) return null;
    return cached;
  },
  clear(storage: KeyValueStorage, userId: string) { storage.removeItem(accessKey(userId)); },
  saveIdentity(storage: KeyValueStorage, identity: CachedIdentity) {
    try { storage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch { /* display cache only */ }
  },
  loadIdentity(storage: KeyValueStorage): CachedIdentity | null {
    const identity = readJson<CachedIdentity | null>(storage, IDENTITY_KEY, null);
    return identity?.userId ? identity : null;
  },
  /** Called on sign-out. Unsent visits are NOT removed: they stay under the user's own key. */
  clearIdentity(storage: KeyValueStorage) { storage.removeItem(IDENTITY_KEY); }
};

// ─── The outbox ─────────────────────────────────────────────────────────────

export interface SyncSummary { sent: number; waiting: number; failed: number; message: string }

/**
 * Visits that exist only on this device, for one user. Everything is written
 * to storage before any network call, so nothing is lost if the app closes.
 */
export class FieldVisitStore {
  private listeners = new Set<() => void>();
  private syncing: Promise<SyncSummary> | null = null;
  private userId: string;
  private storage: KeyValueStorage;
  private api: FieldSalesApi;

  constructor(userId: string, storage: KeyValueStorage, api: FieldSalesApi) {
    this.userId = userId;
    this.storage = storage;
    this.api = api;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() { this.listeners.forEach(listener => listener()); }

  // local items -------------------------------------------------------------

  getLocal(): LocalVisit[] {
    const items = readJson<LocalVisit[]>(this.storage, outboxKey(this.userId), []);
    return Array.isArray(items) ? items : [];
  }
  getLocalById(id: string): LocalVisit | null {
    return this.getLocal().find(item => item.id === id) || null;
  }
  /** Throws if the device refuses the write, so the screen can say so instead of pretending it saved. */
  private writeLocal(items: LocalVisit[]) {
    try {
      this.storage.setItem(outboxKey(this.userId), JSON.stringify(items));
    } catch {
      throw new FieldSalesError('This phone could not save the visit (storage is full or blocked). Do not close this screen.', false, 'storage');
    }
    this.notify();
  }
  private upsert(input: FieldVisitInput, state: LocalState, correctionOf: FieldVisitStatus | null): LocalVisit {
    const items = this.getLocal();
    const existing = items.find(item => item.id === input.id);
    const record: LocalVisit = {
      ...input,
      local_state: state,
      sync_error: '',
      waiting_reason: '',
      attempts: existing?.attempts || 0,
      revision: (existing?.revision || 0) + 1,
      updated_at: new Date().toISOString(),
      correction_of_status: correctionOf ?? existing?.correction_of_status ?? null
    };
    this.writeLocal(existing ? items.map(item => (item.id === input.id ? record : item)) : [record, ...items]);
    return record;
  }

  /** Keep on this device without sending. */
  saveDraft(input: FieldVisitInput, correctionOf: FieldVisitStatus | null = null): LocalVisit {
    return this.upsert(input, 'draft', correctionOf);
  }
  /**
   * Queue for sending. Stored first, sent second: the caller can show
   * "saved" as soon as this returns and then call sync().
   */
  queueForSubmit(input: FieldVisitInput, correctionOf: FieldVisitStatus | null = null): LocalVisit {
    return this.upsert(input, 'pending', correctionOf);
  }
  /** Only ever called because the user asked to delete this item. */
  discard(id: string) {
    this.writeLocal(this.getLocal().filter(item => item.id !== id));
  }
  /** Put a refused visit back in the queue unchanged. */
  retry(id: string) {
    this.writeLocal(this.getLocal().map(item => (item.id === id && item.local_state === 'error'
      ? { ...item, local_state: 'pending', sync_error: '', waiting_reason: '' } : item)));
  }
  counts() {
    const items = this.getLocal();
    return {
      drafts: items.filter(item => item.local_state === 'draft').length,
      pending: items.filter(item => item.local_state === 'pending').length,
      errors: items.filter(item => item.local_state === 'error').length
    };
  }

  // server copies (for showing the list without a connection) ----------------

  getCachedVisits(): FieldVisit[] {
    const visits = readJson<FieldVisit[]>(this.storage, cacheKey(this.userId), []);
    return Array.isArray(visits) ? visits : [];
  }
  private cacheVisits(visits: FieldVisit[]) {
    try { this.storage.setItem(cacheKey(this.userId), JSON.stringify(visits)); } catch { /* display cache only */ }
    this.notify();
  }
  private cacheOne(visit: FieldVisit) {
    const visits = this.getCachedVisits();
    this.cacheVisits(visits.some(v => v.id === visit.id) ? visits.map(v => (v.id === visit.id ? visit : v)) : [visit, ...visits]);
  }
  /** Fetch my visits from the server. On failure the cached list is kept and the error is thrown. */
  async refreshVisits(): Promise<FieldVisit[]> {
    const visits = await this.api.listVisits();
    this.cacheVisits(visits);
    return visits;
  }

  // sending -----------------------------------------------------------------

  /**
   * Send every queued visit. Safe to call as often as you like and from
   * several places at once: only one run is active, and the server treats a
   * repeated visit id as the same visit.
   */
  sync(): Promise<SyncSummary> {
    if (!this.syncing) {
      this.syncing = this.runSync().finally(() => { this.syncing = null; });
    }
    return this.syncing;
  }

  private async runSync(): Promise<SyncSummary> {
    let sent = 0;
    let stoppedBecause = '';
    for (const queued of this.getLocal().filter(item => item.local_state === 'pending').reverse()) {
      // Re-read: the user may have edited or deleted it while an earlier one was being sent.
      const item = this.getLocalById(queued.id);
      if (!item || item.local_state !== 'pending') continue;
      const sentVersion = item.revision;
      try {
        const response = await this.api.saveVisit(toServerPayload(item));
        const current = this.getLocalById(item.id);
        // Remove only if it was not edited while in flight; an edit stays queued and goes out next.
        if (current && current.revision === sentVersion) {
          this.writeLocal(this.getLocal().filter(other => other.id !== item.id));
        }
        if (response?.visit) this.cacheOne(response.visit);
        sent++;
      } catch (raw) {
        const error = toFieldSalesError(raw);
        const attempts = (item.attempts || 0) + 1;
        if (error.transient) {
          this.patch(item.id, sentVersion, { attempts, waiting_reason: error.message });
          stoppedBecause = error.message;
          break;                      // no point trying the rest without a connection or a session
        }
        this.patch(item.id, sentVersion, { attempts, local_state: 'error', sync_error: error.message, waiting_reason: '' });
      }
    }
    const { pending, errors } = this.counts();
    const message = errors > 0
      ? `${errors} visit${errors === 1 ? '' : 's'} could not be sent. Open ${errors === 1 ? 'it' : 'them'} to see why.`
      : pending > 0 ? (stoppedBecause || 'Waiting to send.')
        : sent > 0 ? `${sent} visit${sent === 1 ? '' : 's'} sent.` : '';
    return { sent, waiting: pending, failed: errors, message };
  }

  private patch(id: string, expectedVersion: number, changes: Partial<LocalVisit>) {
    this.writeLocal(this.getLocal().map(item => (item.id === id && item.revision === expectedVersion ? { ...item, ...changes } : item)));
  }
}
