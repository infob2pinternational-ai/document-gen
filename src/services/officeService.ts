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
import { normalizeStaffEmail } from '../utils/staffUtils';
import { metricsService } from './metricsService';
import { supabase, isCloudActive } from './db';
import { generateUUID } from '../utils/uuid';

const FOLLOW_UPS_KEY = 'docgen_follow_ups';
const QUOTATIONS_KEY = 'docgen_crm_quotations';
const BOOKINGS_KEY = 'docgen_bookings';
const RESOURCES_KEY = 'docgen_resources';
const CONVERSATIONS_KEY = 'docgen_whatsapp_conversations';
const MESSAGES_KEY = 'docgen_whatsapp_messages';
const NOTIFICATIONS_KEY = 'docgen_notifications';

// =====================================================================
// SEED RESOURCES (Configurable B2P Inventory matching CRM Lead Services)
// =====================================================================
export const SEED_RESOURCES: Resource[] = [
  {
    id: 'res-van-3side',
    name: '3 Side LED Van',
    category: 'LED Van Advertising',
    description: '3-sided LED screen advertising van with generator & onboard sound',
    location: 'Kerala Fleet',
    is_active: true
  },
  {
    id: 'res-van-2side',
    name: '2 Side LED Van',
    category: 'LED Van Advertising',
    description: '2-sided high-brightness LED screen van with sound system',
    location: 'Kerala Fleet',
    is_active: true
  },
  {
    id: 'res-van-1side',
    name: 'Single Side LED Van',
    category: 'LED Van Advertising',
    description: 'Single-sided mobile LED display van for targeted promotions',
    location: 'Kerala Fleet',
    is_active: true
  },
  {
    id: 'res-truck-3side',
    name: '3 Side LED Truck',
    category: 'LED Van Advertising',
    description: 'Heavy commercial 3-sided LED display truck with hydraulic stage',
    location: 'Kerala Fleet',
    is_active: true
  },
  {
    id: 'res-wall-1',
    name: 'LED Wall',
    category: 'LED Wall',
    description: 'Modular high-definition indoor & outdoor LED video wall with truss rigging',
    location: 'Central Warehouse (Thrissur)',
    is_active: true
  },
  {
    id: 'res-look-1',
    name: 'Lookwalker',
    category: 'Lookwalker',
    description: 'Illuminated mobile walking billboards with dedicated brand promoter crew',
    location: 'Kerala Fleet',
    is_active: true
  },
  {
    id: 'res-marketing-1',
    name: 'Marketing',
    category: 'Marketing',
    description: 'Digital marketing, social media promotions, offline brand activation & marketing strategy',
    location: 'Head Office',
    is_active: true
  },
  {
    id: 'res-roadshow-1',
    name: 'Mobile Roadshow Campaigns',
    category: 'Mobile Roadshow Campaigns',
    description: 'Turnkey mobile roadshow campaigns across Kerala districts with crew and logistics',
    location: 'Kerala Hub',
    is_active: true
  },
  {
    id: 'res-events-1',
    name: 'Events & Staging',
    category: 'Events & Staging',
    description: 'Complete corporate & public event setup, staging, sound and lighting systems',
    location: 'Central Warehouse',
    is_active: true
  },
  {
    id: 'res-signage-1',
    name: 'Signage & Printing',
    category: 'Signage & Printing',
    description: 'Large-format hoardings, flex, vinyl printing, glow signs, and branding fabrication',
    location: 'Print Production Facility',
    is_active: true
  },
  {
    id: 'res-billboard-1',
    name: 'Digital Outdoor Billboard',
    category: 'Digital Outdoor Billboard',
    description: 'Prime outdoor digital billboard screens across key transit junctions in Kerala',
    location: 'Prime Transit Spots',
    is_active: true
  },
  {
    id: 'res-other-1',
    name: 'Other Advertising',
    category: 'Other Advertising',
    description: 'Custom experiential marketing and specialized promotional advertising campaigns',
    location: 'Kerala Hub',
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

function sanitizeOfficeRowForSupabase(table: CrmOfficeTable, row: any) {
  if (table === 'follow_ups') {
    const payload: any = {
      id: row.id,
      assigned_staff_email: row.assigned_staff_email || 'staff@b2p.com',
      follow_up_date: row.due_date || row.follow_up_date || new Date().toISOString().split('T')[0],
      follow_up_time: row.due_time || row.follow_up_time || '10:00',
      customer_name: row.customer_name,
      company_name: row.company_name ?? null,
      phone: row.phone ?? null,
      lead_id: row.lead_id || null,
      lead_number: row.lead_number ?? null,
      reason: row.reason,
      notes: row.notes ?? null,
      created_by_email: row.created_by_email,
      completed_at: row.completed_at ?? null,
      completion_note: row.completion_note ?? null,
      status: String(row.status || 'PENDING').toLowerCase(),
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString()
    };
    if (row.company_id && UUID_REGEX.test(row.company_id)) {
      payload.company_id = row.company_id;
    }
    if (row.customer_id && UUID_REGEX.test(row.customer_id)) {
      payload.customer_id = row.customer_id;
    }
    return payload;
  }

  if (table === 'bookings') {
    const payload: any = {
      id: row.id,
      customer_name: row.customer_name || 'Customer',
      resource_id: row.resource_id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status || 'CONFIRMED',
      notes: row.notes || '',
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString()
    };
    if (row.company_id && UUID_REGEX.test(row.company_id)) {
      payload.company_id = row.company_id;
    }
    if (row.lead_id && UUID_REGEX.test(row.lead_id)) {
      payload.lead_id = row.lead_id;
    }
    return payload;
  }

  if (table === 'crm_quotations') {
    const payload: any = {
      id: row.id,
      quotation_number: row.quotation_number,
      customer_name: row.customer_name,
      company_name: row.company_name,
      phone: row.customer_phone ?? row.phone ?? '',
      date: (row.created_at || new Date().toISOString()).slice(0, 10),
      service_summary: row.service_required || '',
      items: row.items || [],
      subtotal: row.subtotal || 0,
      total: row.total || 0,
      tax_total: row.tax_total || 0,
      discount_total: row.discount_total || 0,
      customer_address: row.customer_address ?? null,
      lead_number: row.lead_number ?? null,
      service_required: row.service_required,
      vehicle_service_type: row.vehicle_service_type ?? null,
      campaign_location: row.campaign_location,
      required_date: row.required_date || null,
      number_of_days: row.number_of_days || 1,
      notes: row.notes ?? null,
      terms: row.terms ?? null,
      status: row.approval_status || 'DRAFT',
      approval_status: row.approval_status || 'DRAFT',
      created_by: row.created_by_email,
      approver_name: row.approved_by_email ?? null,
      approver_notes: row.owner_remarks ?? null,
      sent_to_customer_at: row.sent_at ?? null,
      sent_by_email: row.sent_by_email ?? null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString()
    };
    if (row.company_id && UUID_REGEX.test(row.company_id)) {
      payload.company_id = row.company_id;
    }
    if (row.lead_id && UUID_REGEX.test(row.lead_id)) {
      payload.lead_id = row.lead_id;
    }
    if (row.approved_at) payload.approved_at = row.approved_at;
    if (row.valid_until) payload.valid_until = row.valid_until;
    return payload;
  }

  const payload = { ...row };
  if (payload.company_id && !UUID_REGEX.test(payload.company_id)) {
    delete payload.company_id;
  }
  return payload;
}

async function queryOfficeTableFromCloud<T>(table: CrmOfficeTable, companyId?: string | null): Promise<T[] | null> {
  if (!isCloudActive() || !supabase) return null;
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
  throw new Error('Unable to refresh ' + table);
}

function belongsToDifferentExplicitCompany(row: { company_id?: string | null }, companyId?: string | null): boolean {
  if (!companyId || !UUID_REGEX.test(companyId)) return false;
  return Boolean(row.company_id && row.company_id !== 'default' && row.company_id !== companyId);
}

function replaceCompanyScopedCache<T extends { id: string; company_id?: string | null }>(
  storageKey: string,
  localRows: T[],
  cloudRows: T[],
  companyId?: string | null
): T[] {
  if (!companyId || !UUID_REGEX.test(companyId)) {
    localStorage.setItem(storageKey, JSON.stringify(cloudRows));
    return cloudRows;
  }
  const cloudIds = new Set(cloudRows.map(row => row.id));
  const preserved = localRows.filter(row => belongsToDifferentExplicitCompany(row, companyId) && !cloudIds.has(row.id));
  const merged = [...cloudRows, ...preserved];
  localStorage.setItem(storageKey, JSON.stringify(merged));
  return merged;
}

async function persistOfficeRow<T extends { id: string }>(storageKey: string, table: CrmOfficeTable, fullLocalArray: T[], changedRow: T): Promise<void> {
  if (supabase) {
    if (!isCloudActive()) throw new Error('Please sign in again to save to the shared CRM.');
    const { data, error } = await supabase.from(table)
      .upsert(sanitizeOfficeRowForSupabase(table, changedRow)).select('*').single();
    if (error) throw new Error(`Unable to save ${table}: ${error.message}`);
    if (data?.id !== changedRow.id) throw new Error('The server did not confirm this save.');
    if (table === 'crm_quotations') {
      const server = data as any;
      Object.assign(changedRow, server,
        server.approver_name !== undefined ? { approved_by_email: server.approver_name } : {},
        server.approver_notes !== undefined ? { owner_remarks: server.approver_notes } : {});
    }
    const current = getLocal<T[]>(storageKey, []);
    const index = current.findIndex(row => row.id === changedRow.id);
    if (index < 0) current.unshift(changedRow);
    else current[index] = changedRow;
    localStorage.setItem(storageKey, JSON.stringify(current));
  } else {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  }
  metricsService.notifyChange();
}

async function persistOfficeRowDeleted(storageKey: string, table: CrmOfficeTable, fullLocalArray: any[], deletedId: string): Promise<void> {
  if (supabase) {
    if (!isCloudActive()) throw new Error('Please sign in again to delete from the shared CRM.');
    const { data, error } = await supabase.from(table).delete().eq('id', deletedId).select('id');
    if (error) throw new Error(`Unable to delete ${table}: ${error.message}`);
    if (!data?.some(row => row.id === deletedId)) throw new Error('Deletion was not confirmed. Refresh and check your access.');
    fullLocalArray = getLocal<any[]>(storageKey, []).filter(row => row.id !== deletedId);
  }
  localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  metricsService.notifyChange();
}

/** Pulls this company's resources/bookings/follow-ups/CRM quotations
 * (plus leads/lead activities, via leadService's own hydrator) down from
 * Supabase and merges into the local cache. A no-op when no cloud session
 * is active. Call once on login and again on company switch, exactly
 * like financeService.hydrateFromCloud(). */
export async function hydrateCrmFromCloud(companyId?: string, shouldApply = () => true): Promise<void> {
  await hydrateLeadsFromCloud(companyId, shouldApply);
  if (!shouldApply() || !isCloudActive() || !supabase) return;
  try {
    const [resources, bookings, followUps, quotations] = await Promise.all([
      queryOfficeTableFromCloud<Resource>('resources', companyId),
      queryOfficeTableFromCloud<Booking>('bookings', companyId),
      queryOfficeTableFromCloud<FollowUp>('follow_ups', companyId),
      queryOfficeTableFromCloud<CrmQuotation>('crm_quotations', companyId)
    ]);
    if (!shouldApply()) return;
    if (resources && resources.length > 0) {
      const legacySeedIds = new Set(['res-van-1', 'res-van-2', 'res-van-3']);
      const validCloudResources = resources.filter(r => !legacySeedIds.has(r.id) && !r.name?.includes('LED Van 0'));
      const seedMap = new Map(SEED_RESOURCES.map(r => [r.id, r]));
      validCloudResources.forEach(r => seedMap.set(r.id, r));
      localStorage.setItem(RESOURCES_KEY, JSON.stringify(Array.from(seedMap.values())));
    }
    if (bookings) {
      const localBookings = getLocal<Booking[]>(BOOKINGS_KEY, SEED_BOOKINGS);
      replaceCompanyScopedCache(BOOKINGS_KEY, localBookings, bookings, companyId);
    }
    if (followUps) {
      const localFollowUps = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
      const localMap = new Map(localFollowUps.map(f => [f.id, f]));
      const mappedCloud: FollowUp[] = (followUps as any[]).map(fu => {
        const existing = localMap.get(fu.id);
        return {
          ...fu,
          status: String(fu.status || 'pending').toUpperCase(),
          due_date: fu.follow_up_date || fu.due_date || existing?.due_date || new Date().toISOString().split('T')[0],
          due_time: fu.follow_up_time ?? fu.due_time ?? existing?.due_time ?? '10:00',
          reason: fu.reason ?? fu.notes ?? existing?.reason ?? 'Follow-up',
          customer_name: fu.customer_name ?? existing?.customer_name ?? 'Customer',
          phone: fu.phone ?? existing?.phone ?? '',
          company_name: fu.company_name !== undefined ? fu.company_name : existing?.company_name,
          lead_id: fu.lead_id !== undefined ? fu.lead_id : existing?.lead_id,
          lead_number: fu.lead_number !== undefined ? fu.lead_number : existing?.lead_number
        };
      });
      replaceCompanyScopedCache(FOLLOW_UPS_KEY, localFollowUps, mappedCloud, companyId);
    }
    if (quotations) {
      const localQuotations = getLocal<CrmQuotation[]>(QUOTATIONS_KEY, SEED_QUOTATIONS);
      const mappedQuotes = quotations.map((q: any) => ({
        ...q,
        customer_phone: q.phone ?? q.customer_phone,
        service_required: q.service_required ?? q.service_summary,
        created_by_email: q.created_by ?? q.created_by_email,
        approved_by_email: q.approver_name ?? q.approved_by_email,
        owner_remarks: q.approver_notes ?? q.owner_remarks,
        sent_at: q.sent_to_customer_at ?? q.sent_at
      }));
      replaceCompanyScopedCache(QUOTATIONS_KEY, localQuotations, mappedQuotes, companyId);
    }
    metricsService.notifyChange();
  } catch (e) {
    console.error('[officeService] hydrateCrmFromCloud failed:', e);
    throw e;
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
    const list = getLocal<Resource[]>(RESOURCES_KEY, SEED_RESOURCES);
    // Auto-reconcile / upgrade legacy mock seed resources to official B2P fleet & Lead services
    const hasLegacyPlaceholder = list.some(r =>
      r.id === 'res-van-1' ||
      r.id === 'res-van-2' ||
      r.id === 'res-van-3' ||
      Boolean(r.name && (r.name.includes('LED Van 01') || r.name.includes('14ft Thrissur') || r.name.includes('16ft Kochi')))
    );
    const hasMarketing = list.some(r => r.name === 'Marketing' || r.id === 'res-marketing-1');
    const has3SideVan = list.some(r => r.name === '3 Side LED Van' || r.id === 'res-van-3side');

    if (hasLegacyPlaceholder || !hasMarketing || !has3SideVan) {
      const legacySeedIds = new Set(['res-van-1', 'res-van-2', 'res-van-3', 'res-wall-1', 'res-wall-2', 'res-look-1', 'res-look-2']);
      // Keep any user-created custom resources
      const customResources = list.filter(r => !legacySeedIds.has(r.id) && !r.name?.startsWith('LED Van 0'));
      const upgraded = [...SEED_RESOURCES, ...customResources];
      setLocal(RESOURCES_KEY, upgraded);

      // Remap any legacy bookings in localStorage referencing old seed IDs
      try {
        const bookingsRaw = localStorage.getItem(BOOKINGS_KEY);
        if (bookingsRaw) {
          const bookings = JSON.parse(bookingsRaw) as Booking[];
          let changed = false;
          bookings.forEach(b => {
            if (b.resource_id === 'res-van-1') {
              b.resource_id = 'res-van-3side';
              b.resource_name = '3 Side LED Van';
              b.service_required = b.service_required || 'LED Van Advertising';
              b.vehicle_service_type = '3 Side LED Van';
              changed = true;
            } else if (b.resource_id === 'res-van-2') {
              b.resource_id = 'res-van-2side';
              b.resource_name = '2 Side LED Van';
              b.service_required = b.service_required || 'LED Van Advertising';
              b.vehicle_service_type = '2 Side LED Van';
              changed = true;
            } else if (b.resource_id === 'res-van-3') {
              b.resource_id = 'res-van-1side';
              b.resource_name = 'Single Side LED Van';
              b.service_required = b.service_required || 'LED Van Advertising';
              b.vehicle_service_type = 'Single Side LED Van';
              changed = true;
            } else if (b.resource_id === 'res-wall-2') {
              b.resource_id = 'res-wall-1';
              b.resource_name = 'LED Wall';
              b.service_required = b.service_required || 'LED Wall';
              changed = true;
            } else if (b.resource_id === 'res-look-2') {
              b.resource_id = 'res-look-1';
              b.resource_name = 'Lookwalker';
              b.service_required = b.service_required || 'Lookwalker';
              changed = true;
            }
          });
          if (changed) {
            localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
          }
        }
      } catch (e) {
        console.warn('[officeService] Error remapping legacy bookings:', e);
      }

      return upgraded;
    }

    return list;
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
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS).map(item => ({
      ...item,
      assigned_staff_email: normalizeStaffEmail(item.assigned_staff_email)
    }));
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
      id: item.id || generateUUID(),
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

  async deleteFollowUp(id: string): Promise<void> {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const existing = list.find(f => f.id === id);
    const updated = list.filter(f => f.id !== id);
    await persistOfficeRowDeleted(FOLLOW_UPS_KEY, 'follow_ups', updated, id);

    if (existing?.lead_id) {
      try {
        await leadService.addLeadActivity({
          lead_id: existing.lead_id,
          company_id: existing.company_id || leadService.getActiveCompany() || 'default',
          user_email: existing.assigned_staff_email || 'staff',
          action: 'Follow-up Deleted',
          note: `Removed follow-up: "${existing.reason}" (due ${existing.due_date})`
        });
      } catch (err) {
        console.warn('[officeService] Failed to log activity for deleted follow-up:', err);
      }
    }
  },

  async deleteFollowUps(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.deleteFollowUp(id);
    }
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

    if (q.approval_status !== 'APPROVED') {
      throw new Error('The quotation changed and requires review again. Refresh before approving.');
    }

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
      id: booking.id || generateUUID(),
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
      service_required: booking.service_required || res?.category || '',
      vehicle_service_type: booking.vehicle_service_type || res?.name || '',
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
      id: generateUUID(),
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
      id: generateUUID(),
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
      id: generateUUID(),
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
