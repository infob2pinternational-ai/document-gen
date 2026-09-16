import type {
  FollowUp,
  CrmQuotation,
  Booking,
  Resource,
  WhatsAppConversation,
  WhatsAppMessage,
  NotificationItem,
  Lead
} from '../types';
import { leadService, hydrateLeadsFromCloud } from './leadService';
import { metricsService } from './metricsService';
import { supabase, isCloudActive } from './db';

const FOLLOW_UPS_KEY = 'docgen_follow_ups';
const QUOTATIONS_KEY = 'docgen_crm_quotations';
const BOOKINGS_KEY = 'docgen_bookings';
const RESOURCES_KEY = 'docgen_resources';
const CONVERSATIONS_KEY = 'docgen_whatsapp_conversations';
const MESSAGES_KEY = 'docgen_whatsapp_messages';
const NOTIFICATIONS_KEY = 'docgen_notifications';

// =====================================================================
// SEED RESOURCES (Configurable B2P Inventory)
// =====================================================================
const SEED_RESOURCES: Resource[] = [
  {
    id: 'res-van-1',
    name: 'LED Van 01 (14ft Thrissur)',
    category: 'LED Van',
    description: '14ft High-Brightness Screen, Hydraulic Lift, Generator & Audio System',
    location: 'Thrissur Hub',
    is_active: true
  },
  {
    id: 'res-van-2',
    name: 'LED Van 02 (16ft Kochi)',
    category: 'LED Van',
    description: '16ft Dual-Side Screen, High-Resolution P3 Display with Onboard Sound',
    location: 'Kochi Hub',
    is_active: true
  },
  {
    id: 'res-van-3',
    name: 'LED Van 03 (14ft Kozhikode)',
    category: 'LED Van',
    description: '14ft HD Display Van for Malabar region campaigns',
    location: 'Kozhikode Hub',
    is_active: true
  },
  {
    id: 'res-wall-1',
    name: 'LED Wall P3 Outdoor (20x10 ft)',
    category: 'LED Wall',
    description: 'High-definition outdoor waterproof stage screen with truss rigging',
    location: 'Central Warehouse (Thrissur)',
    is_active: true
  },
  {
    id: 'res-wall-2',
    name: 'LED Wall P2.5 Indoor (15x8 ft)',
    category: 'LED Wall',
    description: 'Ultra-clear indoor LED screen for corporate events & conferences',
    location: 'Central Warehouse (Thrissur)',
    is_active: true
  },
  {
    id: 'res-look-1',
    name: 'Lookwalker Fleet A (4 Units)',
    category: 'Lookwalker',
    description: '4x Backlit mobile walking billboards with promoter uniform kits',
    location: 'Kochi & Thrissur',
    is_active: true
  },
  {
    id: 'res-look-2',
    name: 'Lookwalker Fleet B (6 Units)',
    category: 'Lookwalker',
    description: '6x LED Illuminated walking displays for high-footfall mall campaigns',
    location: 'Kozhikode & Malappuram',
    is_active: true
  }
];

// Helper to format date strings
const getTodayStr = () => new Date().toISOString().split('T')[0];

// REMEDIATION (2026-08-24, CRM audit pass): this file used to seed six
// fully fictional datasets (follow-ups, quotations, bookings, WhatsApp
// conversations/messages, notifications - all cross-referencing the
// same fabricated customers, e.g. "Arun Kumar" / "Kerala Grand Events
// Pvt Ltd") as the fallback whenever their localStorage keys were empty,
// so a fresh browser/device showed fake business records mixed in as if
// real. Removed, matching the same fix already applied to leadService.ts
// and the "zero fictional balances" principle the finance module's
// chart-of-accounts defaults already follow. SEED_RESOURCES above is
// kept - it describes this specific company's actual fleet inventory
// (LED van/wall/lookwalker units), not a fictional transaction or
// customer, the same kind of legitimate default configuration as
// financeService.ts's standard chart of accounts.
const SEED_FOLLOW_UPS: FollowUp[] = [];
const SEED_QUOTATIONS: CrmQuotation[] = [];
const SEED_BOOKINGS: Booking[] = [];
const SEED_CONVERSATIONS: WhatsAppConversation[] = [];
const SEED_MESSAGES: Record<string, WhatsAppMessage[]> = {};
const SEED_NOTIFICATIONS: NotificationItem[] = [];

// =====================================================================
// GENERIC LOCAL STORAGE GET/SET HELPERS
//
// REMEDIATION (2026-08-24, found by the new CRM regression suite): this
// used to `return seed` directly - the actual shared SEED_* module-level
// constant, not a copy. Every caller (saveFollowUp, saveBooking, ...)
// then mutates the array/object it got back in place (`.unshift()`,
// index assignment), which silently mutated the "empty default" itself
// for the rest of this module's lifetime. Invisible in a real browser
// (a full page reload re-evaluates the module and resets every SEED_*
// constant) but real for any in-app flow that clears localStorage
// without a reload. JSON.parse(JSON.stringify(...)) returns a fresh,
// unlinked copy every time - safe here since every SEED_* value is
// already fully JSON-serializable by construction (it's persisted as
// JSON).
// =====================================================================
function getLocal<T>(key: string, seed: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    localStorage.setItem(key, JSON.stringify(seed));
    return JSON.parse(JSON.stringify(seed));
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return JSON.parse(JSON.stringify(seed));
  }
}

function setLocal<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
  metricsService.notifyChange();
}

// =========================================================================
// PERSISTENCE MODEL (REMEDIATION 2026-08-24, third full-project audit
// pass): resources, follow-ups, the CRM quotation-approval workflow, and
// the internal booking calendar were 100% localStorage, and the internal
// booking calendar was additionally a SECOND, disconnected data model
// from the real `resources`/`bookings` Supabase tables the public-
// website automated-quotation RPC already wrote to (see the note in the
// phase6 migration) - a website-originated booking hold was invisible to
// staff and vice versa. This follows the exact same cloud/local pattern
// already proven in financeService.ts/leadService.ts: reads stay
// synchronous from a local cache, mutations write through to Supabase
// when a cloud session is active, hydrateCrmFromCloud() (exported below)
// refreshes the cache on login/company-switch.
//
// WhatsApp conversations/messages and Notifications remain local-only -
// see the phase6 migration note for why.
// =========================================================================

type CrmOfficeTable = 'resources' | 'bookings' | 'follow_ups' | 'crm_quotations';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeOfficeRowForSupabase(_table: CrmOfficeTable, row: any) {
  const payload = { ...row };
  if (payload.company_id && !UUID_REGEX.test(payload.company_id)) {
    delete payload.company_id;
  }
  if (payload.customer_id && !UUID_REGEX.test(payload.customer_id)) {
    delete payload.customer_id;
  }
  if (payload.lead_id && !UUID_REGEX.test(payload.lead_id)) {
    delete payload.lead_id;
  }
  return payload;
}

async function loadOfficeTable<T>(storageKey: string, table: CrmOfficeTable, companyId?: string | null): Promise<T[]> {
  if (isCloudActive() && supabase) {
    try {
      let query = supabase.from(table).select('*');
      if (companyId && table !== 'resources' && UUID_REGEX.test(companyId)) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query;
      if (!error && data) return data as T[];
      if (error) {
        console.warn(`[officeService] Failed to query ${table} from Supabase:`, error.message || error);
      }
    } catch (err) {
      console.warn(`[officeService] Error querying ${table} from Supabase:`, err);
    }
  }
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function persistOfficeRow<T extends { id: string }>(storageKey: string, table: CrmOfficeTable, fullLocalArray: T[], changedRow: T): Promise<void> {
  // 1. ALWAYS persist to local cache first so it is synchronous, reliable and instant
  try {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  } catch (storageErr) {
    console.error(`[officeService] Failed to write to localStorage for ${storageKey}:`, storageErr);
  }
  metricsService.notifyChange();

  // 2. If cloud is active, try to sync to Supabase (best-effort write-through)
  if (isCloudActive() && supabase) {
    try {
      const sanitized = sanitizeOfficeRowForSupabase(table, changedRow);
      const { error } = await supabase.from(table).upsert(sanitized as any);
      if (error) {
        console.warn(`[officeService] Supabase upsert failed for ${table} (saved in local cache):`, error.message || error);
      }
    } catch (err) {
      console.warn(`[officeService] Could not reach Supabase for ${table} (saved in local cache):`, err);
    }
  }
}

async function persistOfficeRowDeleted(storageKey: string, table: CrmOfficeTable, fullLocalArray: any[], deletedId: string): Promise<void> {
  // 1. ALWAYS persist deletion to local cache first
  try {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  } catch (storageErr) {
    console.error(`[officeService] Failed to delete from localStorage for ${storageKey}:`, storageErr);
  }
  metricsService.notifyChange();

  // 2. If cloud is active, try to delete from Supabase
  if (isCloudActive() && supabase) {
    try {
      const { error } = await supabase.from(table).delete().eq('id', deletedId);
      if (error) {
        console.warn(`[officeService] Supabase delete failed for ${table}:`, error.message || error);
      }
    } catch (err) {
      console.warn(`[officeService] Could not reach Supabase for ${table} delete:`, err);
    }
  }
}

/** Pulls this company's resources/bookings/follow-ups/CRM quotations
 * (plus leads/lead activities, via leadService's own hydrator) down from
 * Supabase and merges into the local cache. A no-op when no cloud session
 * is active. Call once on login and again on company switch, exactly
 * like financeService.hydrateFromCloud(). */
export async function hydrateCrmFromCloud(companyId?: string): Promise<void> {
  await hydrateLeadsFromCloud(companyId);
  if (!isCloudActive() || !supabase) return;
  try {
    const [resources, bookings, followUps, quotations] = await Promise.all([
      loadOfficeTable<Resource>(RESOURCES_KEY, 'resources', companyId),
      loadOfficeTable<Booking>(BOOKINGS_KEY, 'bookings', companyId),
      loadOfficeTable<FollowUp>(FOLLOW_UPS_KEY, 'follow_ups', companyId),
      loadOfficeTable<CrmQuotation>(QUOTATIONS_KEY, 'crm_quotations', companyId)
    ]);
    if (resources && resources.length > 0) {
      localStorage.setItem(RESOURCES_KEY, JSON.stringify(resources));
    }
    if (bookings && bookings.length > 0) {
      const localBookings = getLocal<Booking[]>(BOOKINGS_KEY, SEED_BOOKINGS);
      const merged = [...bookings];
      for (const loc of localBookings) {
        if (!merged.some(b => b.id === loc.id)) merged.push(loc);
      }
      localStorage.setItem(BOOKINGS_KEY, JSON.stringify(merged));
    }
    if (followUps && followUps.length > 0) {
      const localFollowUps = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
      const merged = [...followUps];
      for (const loc of localFollowUps) {
        if (!merged.some(f => f.id === loc.id)) merged.push(loc);
      }
      localStorage.setItem(FOLLOW_UPS_KEY, JSON.stringify(merged));
    }
    if (quotations && quotations.length > 0) {
      const localQuotations = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
      const merged = [...quotations];
      for (const loc of localQuotations) {
        if (!merged.some(q => q.id === loc.id)) merged.push(loc);
      }
      localStorage.setItem(QUOTATIONS_KEY, JSON.stringify(merged));
    }
    metricsService.notifyChange();
  } catch (e) {
    console.error('[officeService] hydrateCrmFromCloud failed - continuing with existing local cache:', e);
  }
}

// =====================================================================
// MAIN OFFICE SERVICE
// =====================================================================
export const officeService = {
  // Thin re-export so components that already import officeService
  // (but not leadService directly) can resolve the active company
  // without a second import - officeService itself defers to
  // leadService's setActiveCompany()/getActiveCompany(), the single
  // source of truth for CRM company-scoping (see the note above
  // hydrateCrmFromCloud()).
  getActiveCompanyId(): string | null {
    return leadService.getActiveCompany();
  },

  // ─── Resources ─────────────────────────────────────────────────────
  getResources(): Resource[] {
    return getLocal<Resource[]>(RESOURCES_KEY, SEED_RESOURCES);
  },

  async saveResource(resource: Resource): Promise<Resource> {
    const list = this.getResources();
    const idx = list.findIndex(r => r.id === resource.id);
    if (idx >= 0) {
      list[idx] = resource;
    } else {
      list.push(resource);
    }
    await persistOfficeRow(RESOURCES_KEY, 'resources', list, resource);
    return resource;
  },

  // ─── Follow-ups (Phase 2) ──────────────────────────────────────────
  // REMEDIATION (2026-08-24, full-project audit pass - the same
  // "company-isolation problems" class of bug already fixed for
  // financeService.ts's P0.2): getFollowUps()/getQuotations()/
  // getBookings() below now default-scope to the active company the
  // same way leadService.getLeads() does, since virtually every call
  // site across the CRM UI (FollowUps, BookingCalendar, OwnerDashboard,
  // Reports, Customer360Modal, QuotationModal, FollowUpModal,
  // LeadDetailModal) calls them with zero arguments.
  getFollowUps(filter: 'today' | 'upcoming' | 'overdue' | 'completed' | 'all' = 'all', companyId?: string): FollowUp[] {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const today = getTodayStr();
    const scopeId = companyId || leadService.getActiveCompany();

    return list.filter(item => {
      if (scopeId && item.company_id && item.company_id !== 'default' && item.company_id !== scopeId) return false;
      if (filter === 'completed') return item.status === 'COMPLETED' || item.status === 'CANCELLED';
      if (filter === 'today') return item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && item.due_date === today;
      if (filter === 'upcoming') return item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && item.due_date > today;
      if (filter === 'overdue') return item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && item.due_date < today;
      return true;
    }).sort((a, b) => `${a.due_date} ${a.due_time}`.localeCompare(`${b.due_date} ${b.due_time}`));
  },

  async saveFollowUp(item: Partial<FollowUp> & { customer_name: string; due_date: string; reason: string }, userEmail: string): Promise<FollowUp> {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const isNew = !item.id;

    const followUpRecord: FollowUp = {
      id: item.id || crypto.randomUUID(),
      company_id: item.company_id || leadService.getActiveCompany() || 'default',
      lead_id: item.lead_id,
      lead_number: item.lead_number,
      customer_id: item.customer_id,
      customer_name: item.customer_name,
      company_name: item.company_name,
      phone: item.phone,
      assigned_staff_email: item.assigned_staff_email || userEmail,
      due_date: item.due_date,
      due_time: item.due_time || '10:00',
      reason: item.reason,
      notes: item.notes,
      status: item.status || 'PENDING',
      created_by_email: item.created_by_email || userEmail,
      created_at: item.created_at || new Date().toISOString()
    };

    if (isNew) {
      list.unshift(followUpRecord);
      await persistOfficeRow(FOLLOW_UPS_KEY, 'follow_ups', list, followUpRecord);
      // Log to lead activity if linked
      if (followUpRecord.lead_id) {
        await leadService.addLeadActivity({
          lead_id: followUpRecord.lead_id,
          company_id: followUpRecord.company_id || leadService.getActiveCompany() || 'default',
          user_email: userEmail,
          action: 'Follow-up Scheduled',
          note: `Follow-up set for ${followUpRecord.due_date} ${followUpRecord.due_time}: ${followUpRecord.reason}`
        });
      }
    } else {
      const idx = list.findIndex(f => f.id === followUpRecord.id);
      if (idx >= 0) list[idx] = followUpRecord;
      await persistOfficeRow(FOLLOW_UPS_KEY, 'follow_ups', list, followUpRecord);
    }

    return followUpRecord;
  },

  async completeFollowUp(id: string, completionNote: string, userEmail: string): Promise<FollowUp | null> {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const idx = list.findIndex(f => f.id === id);
    if (idx < 0) return null;

    const current = list[idx];
    current.status = 'COMPLETED';
    current.completed_at = new Date().toISOString();
    current.completion_note = completionNote;

    list[idx] = current;
    await persistOfficeRow(FOLLOW_UPS_KEY, 'follow_ups', list, current);

    // Log to lead activity if linked
    if (current.lead_id) {
      await leadService.addLeadActivity({
        lead_id: current.lead_id,
        company_id: current.company_id || leadService.getActiveCompany() || 'default',
        user_email: userEmail,
        action: 'Follow-up Completed',
        note: `Completed follow-up: "${current.reason}". Note: ${completionNote || 'No completion remarks.'}`
      });
    }

    return current;
  },

  async snoozeFollowUp(id: string, minutes: number, userEmail: string): Promise<FollowUp | null> {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const idx = list.findIndex(f => f.id === id);
    if (idx < 0) return null;

    const current = list[idx];
    const newTime = new Date(Date.now() + minutes * 60 * 1000);
    current.status = 'SNOOZED';
    current.due_time = `${String(newTime.getHours()).padStart(2, '0')}:${String(newTime.getMinutes()).padStart(2, '0')}`;
    current.due_date = newTime.toISOString().split('T')[0];

    list[idx] = current;
    await persistOfficeRow(FOLLOW_UPS_KEY, 'follow_ups', list, current);

    if (current.lead_id) {
      await leadService.addLeadActivity({
        lead_id: current.lead_id,
        company_id: current.company_id || leadService.getActiveCompany() || 'default',
        user_email: userEmail,
        action: 'Follow-up Snoozed',
        note: `Snoozed for ${minutes} minutes until ${current.due_time}.`
      });
    }

    return current;
  },

  getDueFollowUps(companyId?: string): FollowUp[] {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const today = getTodayStr();
    const scopeId = companyId || leadService.getActiveCompany();
    return list.filter(f => {
      if (scopeId && f.company_id && f.company_id !== 'default' && f.company_id !== scopeId) return false;
      return f.status === 'PENDING' && f.due_date <= today;
    });
  },

  // ─── Quotation Workflow & Approval (Phase 3) ───────────────────────
  getQuotations(companyId?: string): CrmQuotation[] {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const scopeId = companyId || leadService.getActiveCompany();
    if (scopeId) {
      return list.filter(q => !q.company_id || q.company_id === 'default' || q.company_id === scopeId);
    }
    return list;
  },

  getQuotationById(id: string): CrmQuotation | null {
    const list = this.getQuotations();
    return list.find(q => q.id === id) || null;
  },

  getQuotationByLeadId(leadId: string): CrmQuotation | null {
    const list = this.getQuotations();
    return list.find(q => q.lead_id === leadId) || null;
  },

  async saveQuotation(q: CrmQuotation, userEmail: string): Promise<CrmQuotation> {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const isNew = !list.some(existing => existing.id === q.id);

    if (isNew) {
      list.unshift(q);
      await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);
      if (q.lead_id) {
        await leadService.addLeadActivity({
          lead_id: q.lead_id,
          company_id: q.company_id,
          user_email: userEmail,
          action: 'Quotation Created',
          note: `Quotation ${q.quotation_number} drafted for ₹${q.total.toLocaleString('en-IN')}.`
        });
      }
    } else {
      const idx = list.findIndex(existing => existing.id === q.id);
      list[idx] = q;
      await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);
    }

    return q;
  },

  async submitQuotationForApproval(quotationId: string, userEmail: string): Promise<CrmQuotation | null> {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const idx = list.findIndex(q => q.id === quotationId);
    if (idx < 0) return null;

    const q = list[idx];
    q.approval_status = 'WAITING_APPROVAL';
    q.updated_at = new Date().toISOString();
    list[idx] = q;
    await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);

    if (q.lead_id) {
      await leadService.updateLeadStatus(
        q.lead_id,
        'waiting_owner_approval',
        userEmail,
        `Quotation ${q.quotation_number} submitted for Owner approval.`
      );
    }

    this.addNotification({
      title: 'Quotation Awaiting Owner Approval',
      message: `Quotation ${q.quotation_number} for ${q.customer_name} (₹${q.total.toLocaleString('en-IN')}) requires approval.`,
      type: 'approval',
      target_id: q.id,
      target_type: 'quotation'
    });

    return q;
  },

  async ownerApproveQuotation(quotationId: string, ownerEmail: string, remarks?: string): Promise<CrmQuotation | null> {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const idx = list.findIndex(q => q.id === quotationId);
    if (idx < 0) return null;

    const q = list[idx];
    q.approval_status = 'APPROVED';
    q.approved_by_email = ownerEmail;
    q.approved_at = new Date().toISOString();
    q.owner_remarks = remarks;
    q.updated_at = new Date().toISOString();
    list[idx] = q;
    await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);

    if (q.lead_id) {
      await leadService.addLeadActivity({
        lead_id: q.lead_id,
        company_id: q.company_id,
        user_email: ownerEmail,
        action: 'Quotation Approved by Owner',
        note: remarks ? `Owner Approved: ${remarks}` : `Quotation ${q.quotation_number} approved by Owner.`
      });
    }

    this.addNotification({
      title: 'Quotation Approved by Owner',
      message: `Quotation ${q.quotation_number} for ${q.customer_name} is approved and ready to be sent to client.`,
      type: 'quotation',
      target_id: q.id,
      target_type: 'quotation'
    });

    return q;
  },

  async ownerRejectQuotation(quotationId: string, ownerEmail: string, remarks: string): Promise<CrmQuotation | null> {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const idx = list.findIndex(q => q.id === quotationId);
    if (idx < 0) return null;

    const q = list[idx];
    q.approval_status = 'REJECTED';
    q.owner_remarks = remarks;
    q.updated_at = new Date().toISOString();
    list[idx] = q;
    await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);

    if (q.lead_id) {
      await leadService.addLeadActivity({
        lead_id: q.lead_id,
        company_id: q.company_id,
        user_email: ownerEmail,
        action: 'Quotation Rejected by Owner',
        note: `Owner Rejected Quotation ${q.quotation_number}. Reason: ${remarks}`
      });
    }

    return q;
  },

  async sendQuotationToCustomer(quotationId: string, userEmail: string): Promise<CrmQuotation | null> {
    const list = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
    const idx = list.findIndex(q => q.id === quotationId);
    if (idx < 0) return null;

    const q = list[idx];
    if (q.approval_status !== 'APPROVED') {
      throw new Error('Hard Gate: Unapproved quotations cannot be sent to customers.');
    }

    q.approval_status = 'SENT';
    q.sent_at = new Date().toISOString();
    q.sent_by_email = userEmail;
    list[idx] = q;
    await persistOfficeRow(QUOTATIONS_KEY, 'crm_quotations', list, q);

    if (q.lead_id) {
      await leadService.updateLeadStatus(
        q.lead_id,
        'quotation_sent',
        userEmail,
        `Approved Quotation ${q.quotation_number} sent to customer via WhatsApp.`
      );
    }

    return q;
  },

  // ─── Booking Calendar & Conflict Engine (Phase 4) ──────────────────
  // NOTE (2026-08-24, full-project audit pass): deliberately NOT
  // company-scoped by default, unlike getFollowUps()/getQuotations()/
  // getLeads() above - the fleet resources these bookings reserve are
  // real, physical equipment shared across every company profile this
  // one organization operates (see the matching note on resources in
  // the phase6 migration), so double-booking prevention
  // (checkBookingConflict() below) has to see every company's bookings,
  // not just the active one. Each booking still records which company
  // profile it belongs to (for reporting), it just isn't filtered by it.
  getBookings(): Booking[] {
    return getLocal<Booking[]>(BOOKINGS_KEY, SEED_BOOKINGS);
  },

  checkBookingConflict(resourceId: string, startDate: string, endDate: string, excludeBookingId?: string): Booking | null {
    const bookings = this.getBookings();
    const activeBookings = bookings.filter(b =>
      b.resource_id === resourceId &&
      (b.status === 'CONFIRMED' || b.status === 'TENTATIVE') &&
      (!excludeBookingId || b.id !== excludeBookingId)
    );

    for (const b of activeBookings) {
      // Overlap condition: start <= b.end && end >= b.start
      if (startDate <= b.end_date && endDate >= b.start_date) {
        return b;
      }
    }
    return null;
  },

  async saveBooking(booking: Partial<Booking> & { resource_id: string; start_date: string; end_date: string; customer_name: string }, userEmail: string): Promise<{ success: boolean; booking?: Booking; conflict?: Booking; error?: string }> {
    const conflict = this.checkBookingConflict(booking.resource_id, booking.start_date, booking.end_date, booking.id);
    if (conflict && (booking.status === 'CONFIRMED' || booking.status === 'TENTATIVE' || !booking.status)) {
      return {
        success: false,
        conflict,
        error: `Resource is already booked by ${conflict.customer_name} (${conflict.booking_number}) from ${conflict.start_date} to ${conflict.end_date}.`
      };
    }

    const list = this.getBookings();
    const isNew = !booking.id;
    const resources = this.getResources();
    const res = resources.find(r => r.id === booking.resource_id);

    let bookingNumber = booking.booking_number;
    if (isNew && !bookingNumber) {
      const maxSeq = list.reduce((max, b) => {
        const num = parseInt((b.booking_number || '').replace('BKG-', ''), 10);
        return !isNaN(num) && num > max ? num : max;
      }, 1000);
      bookingNumber = `BKG-${maxSeq + 1}`;
    }

    const start = new Date(booking.start_date);
    const end = new Date(booking.end_date);
    const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1);

    const record: Booking = {
      id: booking.id || crypto.randomUUID(),
      booking_number: bookingNumber!,
      company_id: booking.company_id || leadService.getActiveCompany() || 'default',
      customer_id: booking.customer_id,
      customer_name: booking.customer_name,
      company_name: booking.company_name,
      customer_phone: booking.customer_phone,
      lead_id: booking.lead_id,
      lead_number: booking.lead_number,
      quotation_id: booking.quotation_id,
      quotation_number: booking.quotation_number,
      resource_id: booking.resource_id,
      resource_name: res?.name || booking.resource_name || 'Resource',
      start_date: booking.start_date,
      end_date: booking.end_date,
      location: booking.location || 'Kerala',
      number_of_days: booking.number_of_days || diffDays,
      assigned_staff_email: booking.assigned_staff_email || userEmail,
      driver_or_operator: booking.driver_or_operator,
      status: booking.status || 'TENTATIVE',
      notes: booking.notes,
      created_at: booking.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isNew) {
      list.unshift(record);
      await persistOfficeRow(BOOKINGS_KEY, 'bookings', list, record);
      if (record.lead_id) {
        await leadService.addLeadActivity({
          lead_id: record.lead_id,
          company_id: record.company_id,
          user_email: userEmail,
          action: 'Resource Reserved on Calendar',
          note: `${record.status} booking ${record.booking_number} created for ${record.resource_name} from ${record.start_date} to ${record.end_date}.`
        });
      }
    } else {
      const idx = list.findIndex(b => b.id === record.id);
      if (idx >= 0) list[idx] = record;
      await persistOfficeRow(BOOKINGS_KEY, 'bookings', list, record);
    }

    return { success: true, booking: record };
  },

  async deleteBooking(id: string): Promise<void> {
    const list = this.getBookings();
    const updated = list.filter(b => b.id !== id);
    await persistOfficeRowDeleted(BOOKINGS_KEY, 'bookings', updated, id);
  },

  // ─── WhatsApp Inbox Prototype (Phase 6) ────────────────────────────
  getConversations(): WhatsAppConversation[] {
    return getLocal<WhatsAppConversation[]>(CONVERSATIONS_KEY, SEED_CONVERSATIONS);
  },

  getMessages(conversationId: string): WhatsAppMessage[] {
    const all = getLocal<Record<string, WhatsAppMessage[]>>(MESSAGES_KEY, SEED_MESSAGES);
    return all[conversationId] || [];
  },

  sendMessage(conversationId: string, text: string, senderType: 'customer' | 'staff', senderName: string, attachment?: { type: 'pdf' | 'image' | 'route_map'; name: string; url: string }): WhatsAppMessage {
    const all = getLocal<Record<string, WhatsAppMessage[]>>(MESSAGES_KEY, SEED_MESSAGES);
    const msgs = all[conversationId] || [];

    const newMsg: WhatsAppMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender_type: senderType,
      sender_name: senderName,
      text,
      timestamp: new Date().toISOString(),
      status: 'sent',
      attachment_type: attachment?.type,
      attachment_name: attachment?.name,
      attachment_url: attachment?.url
    };

    msgs.push(newMsg);
    all[conversationId] = msgs;
    setLocal(MESSAGES_KEY, all);

    // Update conversation last message
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      convs[idx].last_message = text;
      convs[idx].last_message_at = newMsg.timestamp;
      setLocal(CONVERSATIONS_KEY, convs);

      // If linked to lead, log to lead activity. Fire-and-forget (not
      // awaited) - same documented trade-off as
      // financeService.logFinancialAudit()'s cloud mirror: this is a
      // best-effort activity-log entry for a purely local WhatsApp
      // simulation, not the primary record being persisted here.
      if (convs[idx].lead_id && senderType === 'staff') {
        leadService.addLeadActivity({
          lead_id: convs[idx].lead_id!,
          company_id: 'default',
          user_email: senderName,
          action: 'WhatsApp Message Sent',
          note: `Message to ${convs[idx].customer_name}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`
        }).catch(e => console.error('[officeService] lead activity log for WhatsApp message failed:', e));
      }
    }

    return newMsg;
  },

  createConversationFromLead(lead: Lead, initialText?: string): WhatsAppConversation {
    const convs = this.getConversations();
    const existing = convs.find(c => c.lead_id === lead.id || c.phone.replace(/\D/g, '') === lead.phone.replace(/\D/g, ''));
    if (existing) return existing;

    const newConv: WhatsAppConversation = {
      id: crypto.randomUUID(),
      customer_id: lead.customer_id,
      customer_name: lead.customer_name,
      company_name: lead.company_name,
      phone: lead.whatsapp_number || lead.phone,
      lead_id: lead.id,
      lead_number: lead.lead_number,
      last_message: initialText || 'Inquiry conversation initiated.',
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      assigned_staff_email: lead.assigned_telecaller_email
    };

    convs.unshift(newConv);
    setLocal(CONVERSATIONS_KEY, convs);

    if (initialText) {
      this.sendMessage(newConv.id, initialText, 'staff', 'Staff');
    }

    return newConv;
  },

  // ─── Notifications (Phase 7) ───────────────────────────────────────
  getNotifications(): NotificationItem[] {
    return getLocal<NotificationItem[]>(NOTIFICATIONS_KEY, SEED_NOTIFICATIONS);
  },

  addNotification(item: Omit<NotificationItem, 'id' | 'created_at' | 'is_read'>): NotificationItem {
    const list = this.getNotifications();
    const newItem: NotificationItem = {
      ...item,
      id: crypto.randomUUID(),
      is_read: false,
      created_at: new Date().toISOString()
    };
    list.unshift(newItem);
    setLocal(NOTIFICATIONS_KEY, list);
    return newItem;
  },

  markNotificationAsRead(id: string): void {
    const list = this.getNotifications();
    const idx = list.findIndex(n => n.id === id);
    if (idx >= 0) {
      list[idx].is_read = true;
      setLocal(NOTIFICATIONS_KEY, list);
    }
  },

  markAllNotificationsAsRead(): void {
    const list = this.getNotifications().map(n => ({ ...n, is_read: true }));
    setLocal(NOTIFICATIONS_KEY, list);
  },

  // ─── Global Search (Phase 7) ───────────────────────────────────────
  globalSearch(query: string): {
    leads: Lead[];
    quotations: CrmQuotation[];
    bookings: Booking[];
    followUps: FollowUp[];
    conversations: WhatsAppConversation[];
  } {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { leads: [], quotations: [], bookings: [], followUps: [], conversations: [] };
    }

    const leads = leadService.getLeads().filter(l =>
      l.customer_name.toLowerCase().includes(q) ||
      (l.company_name && l.company_name.toLowerCase().includes(q)) ||
      (l.lead_number && l.lead_number.toLowerCase().includes(q)) ||
      l.phone.includes(q) ||
      (l.location && l.location.toLowerCase().includes(q)) ||
      (l.service_required && l.service_required.toLowerCase().includes(q))
    );

    const quotations = this.getQuotations().filter(quo =>
      quo.quotation_number.toLowerCase().includes(q) ||
      quo.customer_name.toLowerCase().includes(q) ||
      (quo.company_name && quo.company_name.toLowerCase().includes(q)) ||
      quo.service_required.toLowerCase().includes(q)
    );

    const bookings = this.getBookings().filter(b =>
      b.booking_number.toLowerCase().includes(q) ||
      b.customer_name.toLowerCase().includes(q) ||
      b.resource_name.toLowerCase().includes(q) ||
      b.location.toLowerCase().includes(q)
    );

    const followUps = this.getFollowUps().filter(f =>
      f.customer_name.toLowerCase().includes(q) ||
      f.reason.toLowerCase().includes(q) ||
      (f.company_name && f.company_name.toLowerCase().includes(q))
    );

    const conversations = this.getConversations().filter(c =>
      c.customer_name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.last_message.toLowerCase().includes(q)
    );

    return { leads, quotations, bookings, followUps, conversations };
  }
};
