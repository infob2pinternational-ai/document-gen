import type { Lead, LeadActivity, LeadStatus } from '../types';
import { metricsService } from './metricsService';
import { supabase, isCloudActive } from './db';
import { generateUUID } from '../utils/uuid';
import { normalizeStaffEmail } from '../utils/staffUtils';

const LEADS_KEY = 'docgen_leads';
const ACTIVITIES_KEY = 'docgen_lead_activities';

// REMEDIATION (2026-08-24, CRM audit pass): this file used to seed a
// full set of fictional leads/activities ("Arun Kumar", "Kerala Grand
// Events Pvt Ltd", etc, explicitly labelled in a since-removed comment
// as "realistic seed leads for B2P International prototyping") as the
// fallback whenever LEADS_KEY/ACTIVITIES_KEY were empty in localStorage
// - i.e. every fresh browser/device would show fabricated customers,
// phone numbers and campaign notes mixed in as if they were real CRM
// records. That directly violates this app's own "zero fictional data"
// principle (already applied to the finance module's chart-of-accounts
// defaults - see the "ZERO FICTIONAL BALANCES" note in
// financeService.ts). A genuinely empty CRM now starts genuinely empty.
const SEED_LEADS: Lead[] = [];
const SEED_ACTIVITIES: LeadActivity[] = [];

// =========================================================================
// PERSISTENCE MODEL (REMEDIATION 2026-08-24, third full-project audit
// pass): leads/lead_activities were 100% localStorage - every browser/
// device had its own independent, unsynced lead pipeline. This follows
// the EXACT same cloud/local pattern already proven in financeService.ts
// (isCloudActive() from db.ts decides cloud vs local per request, never
// both): reads stay synchronous from a local cache, mutations write
// through to Supabase (leads/lead_activities - see the phase6 migration)
// when a cloud session is active, hydrateLeadsFromCloud() refreshes that
// cache on login/company-switch (called from officeService's combined
// hydrateCrmFromCloud(), itself called from App.tsx alongside
// financeService.hydrateFromCloud()).
// =========================================================================

type CrmLeadsTable = 'leads' | 'lead_activities';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeLeadForSupabase(row: any) {
  const payload: any = {
    id: row.id,
    customer_name: row.customer_name,
    phone: row.phone,
    priority: row.priority || 'WARM',
    status: row.status || 'new',
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
  };

  if (row.company_id && UUID_REGEX.test(row.company_id)) {
    payload.company_id = row.company_id;
  }
  if (row.customer_id && UUID_REGEX.test(row.customer_id)) {
    payload.customer_id = row.customer_id;
  }
  if (row.company_name) payload.company_name = row.company_name;
  if (row.alternate_phone) payload.alternate_phone = row.alternate_phone;
  if (row.email) payload.email = row.email;
  if (row.whatsapp_number) payload.whatsapp_number = row.whatsapp_number;
  if (row.address) payload.address = row.address;
  if (row.location) payload.location = row.location;
  if (row.business_type) payload.business_type = row.business_type;
  if (row.lead_source) payload.lead_source = row.lead_source;
  if (row.source_details) payload.source_details = row.source_details;
  if (row.service_required) payload.service_required = row.service_required;
  if (row.vehicle_service_type) payload.vehicle_service_type = row.vehicle_service_type;
  if (row.campaign_location) payload.campaign_location = row.campaign_location;
  if (row.assigned_telecaller_email) payload.assigned_telecaller_email = row.assigned_telecaller_email;
  if (row.notes) payload.notes = row.notes;
  if (row.remarks) payload.remarks = row.remarks;
  if (row.last_call_at) payload.last_call_at = row.last_call_at;
  if (row.last_call_outcome) payload.last_call_outcome = row.last_call_outcome;
  if (row.last_call_remark) payload.last_call_remark = row.last_call_remark;
  if (row.call_count !== undefined) payload.call_count = Number(row.call_count);
  if (row.last_contacted_by_email) payload.last_contacted_by_email = row.last_contacted_by_email;
  if (row.is_telecalling_lead !== undefined) payload.is_telecalling_lead = Boolean(row.is_telecalling_lead);

  if (row.required_date && typeof row.required_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.required_date)) {
    payload.required_date = row.required_date;
  }
  if (row.next_follow_up_at) {
    payload.next_follow_up_at = row.next_follow_up_at;
  }
  if (row.number_of_days !== '' && row.number_of_days !== undefined && !isNaN(Number(row.number_of_days))) {
    payload.number_of_days = Number(row.number_of_days);
  }

  // NOTE: 'lead_number' is an in-app sequence number and does not exist as a column in Supabase leads.
  // We keep it in local storage Lead records and omit it from the Supabase payload.
  return payload;
}

function sanitizeActivityForSupabase(row: any) {
  const payload: any = {
    id: row.id,
    lead_id: row.lead_id,
    action: row.action || row.type || 'activity',
    user_email: row.user_email || row.performed_by || 'Staff',
    note: row.note || row.notes || '',
    activity_type: row.activity_type || 'call',
    created_at: row.created_at || new Date().toISOString()
  };
  if (row.company_id && UUID_REGEX.test(row.company_id)) {
    payload.company_id = row.company_id;
  }
  if (row.call_outcome) payload.call_outcome = row.call_outcome;
  if (row.phone_used) payload.phone_used = row.phone_used;
  if (row.contact_person) payload.contact_person = row.contact_person;
  if (row.next_follow_up_at) payload.next_follow_up_at = row.next_follow_up_at;
  if (row.previous_status) payload.previous_status = row.previous_status;
  if (row.new_status) payload.new_status = row.new_status;
  if (row.updated_at) payload.updated_at = row.updated_at;
  return payload;
}

async function loadCrmTable<T>(storageKey: string, table: CrmLeadsTable, companyId?: string | null): Promise<T[]> {
  if (isCloudActive() && supabase) {
    try {
      let query = supabase.from(table).select('*');
      if (companyId && UUID_REGEX.test(companyId)) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query;
      if (!error && data) return data as T[];
      if (error) {
        console.warn(`[leadService] Failed to query ${table} from Supabase:`, error.message || error);
      }
    } catch (err) {
      console.warn(`[leadService] Error querying ${table} from Supabase:`, err);
    }
  }
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function persistCrmRow<T extends { id: string }>(storageKey: string, table: CrmLeadsTable, fullLocalArray: T[], changedRow: T): Promise<void> {
  // 1. ALWAYS persist to local cache first so it is synchronous, reliable and instant
  try {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  } catch (storageErr) {
    console.error(`[leadService] Failed to write to localStorage for ${storageKey}:`, storageErr);
  }
  metricsService.notifyChange();

  // 2. If cloud is active, try to sync to Supabase (best-effort write-through)
  if (isCloudActive() && supabase) {
    try {
      const sanitized = table === 'leads'
        ? sanitizeLeadForSupabase(changedRow)
        : sanitizeActivityForSupabase(changedRow);
      const { error } = await supabase.from(table).upsert(sanitized as any);
      if (error) {
        console.warn(`[leadService] Supabase upsert failed for ${table} (saved in local cache):`, error.message || error);
      }
    } catch (err) {
      console.warn(`[leadService] Could not reach Supabase for ${table} (saved in local cache):`, err);
    }
  }
}

async function persistCrmRowDeleted(storageKey: string, table: CrmLeadsTable, fullLocalArray: any[], deletedId: string): Promise<void> {
  // 1. ALWAYS persist deletion to local cache first
  try {
    localStorage.setItem(storageKey, JSON.stringify(fullLocalArray));
  } catch (storageErr) {
    console.error(`[leadService] Failed to delete from localStorage for ${storageKey}:`, storageErr);
  }
  metricsService.notifyChange();

  // 2. If cloud is active, try to delete from Supabase
  if (isCloudActive() && supabase) {
    try {
      const { error } = await supabase.from(table).delete().eq('id', deletedId);
      if (error) {
        console.warn(`[leadService] Supabase delete failed for ${table}:`, error.message || error);
      }
    } catch (err) {
      console.warn(`[leadService] Could not reach Supabase for ${table} delete:`, err);
    }
  }
}

/** Pulls this company's leads + lead activities down from Supabase and
 * merges into the local cache, never wiping existing local records. */
export async function hydrateLeadsFromCloud(companyId?: string, shouldApply = () => true): Promise<void> {
  if (!isCloudActive() || !supabase) return;
  try {
    const [cloudLeads, cloudActivities] = await Promise.all([
      loadCrmTable<Lead>(LEADS_KEY, 'leads', companyId),
      loadCrmTable<LeadActivity>(ACTIVITIES_KEY, 'lead_activities', companyId)
    ]);

    if (!shouldApply()) return;

    if (cloudLeads && cloudLeads.length > 0) {
      const localLeads = getStoredLeads();
      const localMap = new Map(localLeads.map(l => [l.id, l]));
      const merged: Lead[] = cloudLeads.map((cl: any, idx: number) => {
        const existing = localMap.get(cl.id);
        // Preserve a newer local edit while an older cloud read is in flight.
        if (existing && Date.parse(existing.updated_at || '') > Date.parse(cl.updated_at || '')) {
          return existing;
        }
        const seq = 1001 + idx;
        return {
          ...cl,
          lead_number: cl.lead_number || existing?.lead_number || `B2P-LD-${seq}`
        };
      });
      for (const loc of localLeads) {
        if (!merged.some(c => c.id === loc.id)) {
          merged.push(loc);
        }
      }
      localStorage.setItem(LEADS_KEY, JSON.stringify(merged));
    }

    if (cloudActivities && cloudActivities.length > 0) {
      const localActs = getStoredActivities();
      const mappedCloud: LeadActivity[] = (cloudActivities as any[]).map(ca => ({
        id: ca.id,
        lead_id: ca.lead_id,
        company_id: ca.company_id,
        user_email: ca.performed_by || ca.user_email || 'Staff',
        action: ca.type || ca.action || 'Activity',
        note: ca.notes || ca.note || '',
        created_at: ca.created_at
      }));
      const mergedActs = [...mappedCloud];
      for (const act of localActs) {
        if (!mergedActs.some(c => c.id === act.id)) {
          mergedActs.push(act);
        }
      }
      localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(mergedActs));
    }

    metricsService.notifyChange();
  } catch (e) {
    console.error('[leadService] hydrateLeadsFromCloud failed - continuing with existing local cache:', e);
  }
}

// REMEDIATION (2026-08-24, found by the new CRM regression suite): both
// getters below used to `return SEED_LEADS`/`return SEED_ACTIVITIES`
// directly - the actual module-level array, not a copy. Every caller
// (saveLead, addLeadActivity, ...) then mutates the array it got back
// in place (`.unshift()`), which silently mutated the shared "empty
// default" constant itself. In a real browser this was invisible (a
// full page reload re-evaluates the module, resetting SEED_LEADS to
// `[]` again) - but any in-app flow that clears localStorage WITHOUT a
// reload (a "clear local data" action, a backup restore) would then see
// a stale, already-populated "empty" default instead of a genuinely
// empty one. JSON.parse(JSON.stringify(...)) returns a fresh, unlinked
// copy every time - safe for this app's data, which is already fully
// JSON-serializable by construction (it's persisted as JSON).
function getStoredLeads(): Lead[] {
  const raw = localStorage.getItem(LEADS_KEY);
  if (!raw) {
    localStorage.setItem(LEADS_KEY, JSON.stringify(SEED_LEADS));
    return JSON.parse(JSON.stringify(SEED_LEADS));
  }
  try {
    return (JSON.parse(raw) as Lead[]).map(lead => ({
      ...lead,
      assigned_telecaller_email: lead.assigned_telecaller_email
        ? normalizeStaffEmail(lead.assigned_telecaller_email)
        : lead.assigned_telecaller_email
    }));
  } catch (e) {
    return JSON.parse(JSON.stringify(SEED_LEADS));
  }
}

function getStoredActivities(): LeadActivity[] {
  const raw = localStorage.getItem(ACTIVITIES_KEY);
  if (!raw) {
    localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(SEED_ACTIVITIES));
    return JSON.parse(JSON.stringify(SEED_ACTIVITIES));
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return JSON.parse(JSON.stringify(SEED_ACTIVITIES));
  }
}

// REMEDIATION (2026-08-24, full-project audit pass - the exact same
// "company-isolation problems" class of bug already fixed once for
// financeService.ts's P0.2): before this fix, EVERY leadService/
// officeService getter except Leads.tsx's own list screen was called
// with zero arguments across the whole CRM UI (FollowUps, BookingCalendar,
// OwnerDashboard, Reports, Customer360Modal, QuotationModal,
// FollowUpModal, LeadDetailModal) - so follow-ups, CRM quotations and
// bookings for EVERY company profile were shown mixed together
// everywhere except the main Leads list. Same fix as financeService: the
// app tells this service ONCE which company is active (App.tsx calls
// setActiveCompany() at the exact same moments it already calls
// financeService.setActiveCompany()), and every method defaults to that
// scope when no explicit companyId is supplied. An explicit companyId
// argument, where still accepted, still wins.
let activeCompanyId: string | null = null;

export const leadService = {
  setActiveCompany(companyId: string | null): void {
    activeCompanyId = companyId;
  },

  getActiveCompany(): string | null {
    return activeCompanyId;
  },

  getLeads(companyId?: string): Lead[] {
    const leads = getStoredLeads();
    const scopeId = companyId || activeCompanyId;
    if (scopeId) {
      return leads.filter(l => !l.company_id || l.company_id === 'default' || l.company_id === scopeId);
    }
    return leads;
  },

  getLeadById(id: string): Lead | null {
    const leads = getStoredLeads();
    return leads.find(l => l.id === id) || null;
  },

  async saveLead(lead: Partial<Lead> & { customer_name: string; phone: string }, userEmail: string = 'Staff'): Promise<Lead> {
    const leads = getStoredLeads();
    const isNew = !lead.id || !leads.some(l => l.id === lead.id);
    const now = new Date().toISOString();

    let leadNumber = lead.lead_number;
    if (isNew && !leadNumber) {
      const maxSeq = leads.reduce((max, l) => {
        if (l.lead_number && l.lead_number.startsWith('B2P-LD-')) {
          const num = parseInt(l.lead_number.replace('B2P-LD-', ''), 10);
          if (!isNaN(num) && num > max) return num;
        }
        return max;
      }, 1000);
      leadNumber = `B2P-LD-${maxSeq + 1}`;
    }

    const leadRecord: Lead = {
      id: lead.id || generateUUID(),
      lead_number: leadNumber,
      company_id: lead.company_id || activeCompanyId || 'default',
      customer_id: lead.customer_id,
      customer_name: lead.customer_name,
      company_name: lead.company_name,
      phone: lead.phone,
      alternate_phone: lead.alternate_phone,
      email: lead.email,
      whatsapp_number: lead.whatsapp_number || lead.phone,
      address: lead.address,
      location: lead.location,
      business_type: lead.business_type,
      lead_source: lead.lead_source || 'phone',
      source_details: lead.source_details,
      service_required: lead.service_required,
      vehicle_service_type: lead.vehicle_service_type,
      required_date: lead.required_date,
      campaign_location: lead.campaign_location,
      number_of_days: lead.number_of_days ? Number(lead.number_of_days) : undefined,
      priority: lead.priority || 'WARM',
      assigned_telecaller_email: lead.assigned_telecaller_email,
      status: lead.status || 'new',
      next_follow_up_at: lead.next_follow_up_at,
      notes: lead.notes,
      remarks: lead.remarks,
      last_call_at: lead.last_call_at,
      last_call_outcome: lead.last_call_outcome,
      last_call_remark: lead.last_call_remark,
      call_count: lead.call_count !== undefined ? Number(lead.call_count) : 0,
      last_contacted_by_email: lead.last_contacted_by_email,
      is_telecalling_lead: lead.is_telecalling_lead !== undefined ? Boolean(lead.is_telecalling_lead) : true,
      created_at: lead.created_at || now,
      updated_at: now
    };

    if (isNew) {
      leads.unshift(leadRecord);
      await persistCrmRow(LEADS_KEY, 'leads', leads, leadRecord);

      // Record activity
      await this.addLeadActivity({
        lead_id: leadRecord.id,
        company_id: leadRecord.company_id,
        user_email: userEmail,
        action: 'Lead Created',
        new_status: leadRecord.status,
        note: `New lead created from ${leadRecord.lead_source || 'inquiry'}.`
      });
    } else {
      const idx = leads.findIndex(l => l.id === leadRecord.id);
      const prev = leads[idx];
      leads[idx] = leadRecord;
      await persistCrmRow(LEADS_KEY, 'leads', leads, leadRecord);

      // Record update activity if status changed
      if (prev && prev.status !== leadRecord.status) {
        await this.addLeadActivity({
          lead_id: leadRecord.id,
          company_id: leadRecord.company_id,
          user_email: userEmail,
          action: 'Status Updated',
          previous_status: prev.status,
          new_status: leadRecord.status,
          note: `Status updated to ${leadRecord.status.replace(/_/g, ' ')}.`
        });
      }
    }

    return leadRecord;
  },

  async deleteLead(id: string): Promise<void> {
    const leads = getStoredLeads();
    const updated = leads.filter(l => l.id !== id);
    await persistCrmRowDeleted(LEADS_KEY, 'leads', updated, id);

    // Clean up local activities cache for this lead
    const activities = getStoredActivities();
    const updatedActs = activities.filter(a => a.lead_id !== id);
    try {
      localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(updatedActs));
      metricsService.notifyChange();
    } catch (e) {
      console.error('[leadService] Failed to update activities cache on lead delete:', e);
    }
  },

  getLeadActivities(leadId: string): LeadActivity[] {
    const activities = getStoredActivities();
    return activities
      .filter(a => a.lead_id === leadId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async addLeadActivity(activity: Omit<LeadActivity, 'id' | 'created_at'> & { created_at?: string }): Promise<LeadActivity> {
    const activities = getStoredActivities();
    const newAct: LeadActivity = {
      ...activity,
      id: generateUUID(),
      created_at: activity.created_at || new Date().toISOString()
    };
    activities.unshift(newAct);
    await persistCrmRow(ACTIVITIES_KEY, 'lead_activities', activities, newAct);
    return newAct;
  },

  async updateLeadStatus(leadId: string, newStatus: LeadStatus, userEmail: string, note?: string): Promise<Lead | null> {
    const leads = getStoredLeads();
    const idx = leads.findIndex(l => l.id === leadId);
    if (idx < 0) return null;

    const prev = leads[idx];
    const updated: Lead = {
      ...prev,
      status: newStatus,
      updated_at: new Date().toISOString()
    };
    leads[idx] = updated;
    await persistCrmRow(LEADS_KEY, 'leads', leads, updated);

    await this.addLeadActivity({
      lead_id: leadId,
      company_id: updated.company_id,
      user_email: userEmail,
      action: 'Status Transition',
      previous_status: prev.status,
      new_status: newStatus,
      note: note || `Status changed from ${prev.status} to ${newStatus}.`
    });

    return updated;
  },

  async sendToAdmin(leadId: string, userEmail: string, handoverNote?: string): Promise<{ success: boolean; lead?: Lead; error?: string }> {
    const lead = this.getLeadById(leadId);
    if (!lead) return { success: false, error: 'Lead not found.' };

    // Validation for handover
    if (!lead.customer_name || !lead.phone) {
      return { success: false, error: 'Customer Name and Phone are required before sending to Admin.' };
    }
    if (!lead.service_required) {
      return { success: false, error: 'Service Required must be specified before sending to Admin.' };
    }

    const updated = await this.updateLeadStatus(
      leadId,
      'sent_to_admin',
      userEmail,
      handoverNote ? `Telecaller Handover: ${handoverNote}` : 'Requirement collected and handed over to Admin for quotation.'
    );

    return { success: true, lead: updated || undefined };
  },

  async startQuotationPreparation(leadId: string, userEmail: string): Promise<{ success: boolean; lead?: Lead }> {
    const updated = await this.updateLeadStatus(
      leadId,
      'quotation_preparing',
      userEmail,
      'Admin started quotation drafting process.'
    );
    return { success: true, lead: updated || undefined };
  }
};
