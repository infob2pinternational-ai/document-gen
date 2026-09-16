import type { 
  Lead, 
  LeadStatus, 
  LeadPriority, 
  FollowUp, 
  CrmQuotation, 
  Booking, 
  Resource,
  LeadActivity 
} from '../types';

export type DateFilterType = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';

export interface DateFilter {
  type: DateFilterType;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface LeadCounts {
  total: number;
  byStatus: Record<LeadStatus, number>;
  byPriority: Record<LeadPriority, number>;
}

export interface FollowUpCounts {
  total: number;
  today: number;
  dueNow: number;
  upcoming: number;
  overdue: number;
  completed: number;
  snoozed: number;
}

export interface QuotationCounts {
  total: number;
  draft: number;
  waitingApproval: number;
  approved: number;
  rejected: number;
  sent: number;
  confirmed: number;
}

export interface ResourceCategoryAvailability {
  category: string;
  totalUnits: number;
  activeBookings: number;
  availableUnits: number;
}

export interface BookingCounts {
  total: number;
  tentative: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  conflicts: number;
  resourceAvailability: ResourceCategoryAvailability[];
}

export interface OwnerDailyMetrics {
  dateFilter: DateFilter;
  // Activity volume in selected date window
  newLeads: number;
  leadsWorked: number;
  requirementsCollected: number;
  sentToAdmin: number;
  quotationsCreated: number;
  quotationsApproved: number;
  quotationsSent: number;
  followUpsDue: number;
  followUpsCompleted: number;
  confirmedJobs: number;
  newBookings: number;
  // Current live state (point-in-time)
  quotationsWaitingApproval: number;
  overdueFollowUps: number;
}

export interface ActionRequiredCounts {
  leadsWaitingAdmin: number;
  quotationsWaitingOwnerApproval: number;
  followUpsDueNow: number;
  overdueFollowUps: number;
  bookingConflicts: number;
  unassignedLeads: number;
  totalAlerts: number;
}

export interface AdminQueueCounts {
  incomingRequirements: number; // sent_to_admin + quotation_preparing
  quotationsPreparing: number;  // quotation_preparing / DRAFT quotes
  waitingOwnerApproval: number; // WAITING_APPROVAL
  quotationsSent: number;       // SENT
}

export interface TelecallerMetricsRow {
  email: string;
  name: string;
  assignedLeads: number;
  newLeads: number;
  workingLeads: number;
  working: number;
  requirementsCollected: number;
  sentToAdmin: number;
  followUpsDue: number;
  confirmed: number;
  lost: number;
  conversionRate: number;
}

// LocalStorage Keys
const LEADS_KEY = 'docgen_leads';
const ACTIVITIES_KEY = 'docgen_lead_activities';
const FOLLOW_UPS_KEY = 'docgen_follow_ups';
const QUOTATIONS_KEY = 'docgen_crm_quotations';
const BOOKINGS_KEY = 'docgen_bookings';
const RESOURCES_KEY = 'docgen_resources';

const CUSTOM_EVENT_NAME = 'b2p_crm_metrics_update';

// Safe localStorage Readers
function readStorage<T>(key: string, defaultVal: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch (e) {
    console.error(`metricsService: Failed to read ${key}`, e);
    return defaultVal;
  }
}

// Date helpers
export function getLocalTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDateRangeBounds(filter: DateFilter): { start: string; end: string } {
  const today = getLocalTodayStr();
  
  if (filter.type === 'today') {
    return { start: today, end: today };
  }
  
  if (filter.type === 'yesterday') {
    const yesterday = getLocalYesterdayStr();
    return { start: yesterday, end: yesterday };
  }

  if (filter.type === 'this_week') {
    const now = new Date();
    const day = now.getDay(); // 0 is Sun, 1 is Mon
    const diffToMon = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMon);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const start = monday.toISOString().split('T')[0];
    const end = sunday.toISOString().split('T')[0];
    return { start, end };
  }

  if (filter.type === 'this_month') {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    return { start, end };
  }

  if (filter.type === 'custom') {
    return {
      start: filter.startDate || today,
      end: filter.endDate || today
    };
  }

  return { start: today, end: today };
}

export function isDateInBounds(dateStr?: string | null, bounds?: { start: string; end: string }): boolean {
  if (!dateStr || !bounds) return false;
  // If ISO datetime, take the YYYY-MM-DD portion
  const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  return dateOnly >= bounds.start && dateOnly <= bounds.end;
}

export const metricsService = {
  // Event Notification & Subscription
  notifyChange(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CUSTOM_EVENT_NAME));
    }
  },

  subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    
    const handler = () => callback();
    window.addEventListener(CUSTOM_EVENT_NAME, handler);
    window.addEventListener('storage', handler);
    
    return () => {
      window.removeEventListener(CUSTOM_EVENT_NAME, handler);
      window.removeEventListener('storage', handler);
    };
  },

  // 1. LEAD COUNTS
  getLeadCounts(staffEmail?: string): LeadCounts {
    let leads = readStorage<Lead[]>(LEADS_KEY, []);
    if (staffEmail && staffEmail !== 'owner@b2p.com' && staffEmail !== 'admin@b2p.com' && staffEmail.toLowerCase() !== 'fransonputhukkara@gmail.com' && staffEmail.toLowerCase() !== 'sarathjohnpanegdan@gmail.com') {
      leads = leads.filter(l => l.assigned_telecaller_email === staffEmail);
    }

    const byStatus: Record<LeadStatus, number> = {
      new: 0,
      telecaller_working: 0,
      requirement_collected: 0,
      sent_to_admin: 0,
      quotation_preparing: 0,
      waiting_owner_approval: 0,
      quotation_sent: 0,
      follow_up: 0,
      confirmed: 0,
      lost: 0,
      future: 0,
      owner_handover: 0
    };

    const byPriority: Record<LeadPriority, number> = {
      HOT: 0,
      WARM: 0,
      COLD: 0
    };

    leads.forEach(l => {
      if (byStatus[l.status] !== undefined) {
        byStatus[l.status]++;
      }
      if (l.priority && byPriority[l.priority] !== undefined) {
        byPriority[l.priority]++;
      }
    });

    return {
      total: leads.length,
      byStatus,
      byPriority
    };
  },

  // 2. FOLLOW-UP COUNTS
  getFollowUpCounts(staffEmail?: string): FollowUpCounts {
    let followUps = readStorage<FollowUp[]>(FOLLOW_UPS_KEY, []);
    if (staffEmail && staffEmail !== 'owner@b2p.com' && staffEmail !== 'admin@b2p.com' && staffEmail.toLowerCase() !== 'fransonputhukkara@gmail.com' && staffEmail.toLowerCase() !== 'sarathjohnpanegdan@gmail.com') {
      followUps = followUps.filter(f => f.assigned_staff_email === staffEmail);
    }

    const today = getLocalTodayStr();
    let todayCount = 0;
    let dueNowCount = 0;
    let upcomingCount = 0;
    let overdueCount = 0;
    let completedCount = 0;
    let snoozedCount = 0;

    followUps.forEach(f => {
      if (f.status === 'COMPLETED') {
        completedCount++;
      } else if (f.status === 'SNOOZED') {
        snoozedCount++;
      }

      if (f.status !== 'COMPLETED' && f.status !== 'CANCELLED') {
        if (f.due_date === today) {
          todayCount++;
          dueNowCount++;
        } else if (f.due_date > today) {
          upcomingCount++;
        } else if (f.due_date < today) {
          overdueCount++;
        }
      }
    });

    return {
      total: followUps.length,
      today: todayCount,
      dueNow: dueNowCount,
      upcoming: upcomingCount,
      overdue: overdueCount,
      completed: completedCount,
      snoozed: snoozedCount
    };
  },

  // 3. QUOTATION COUNTS
  getQuotationCounts(): QuotationCounts {
    const quotations = readStorage<CrmQuotation[]>(QUOTATIONS_KEY, []);
    const leads = readStorage<Lead[]>(LEADS_KEY, []);

    let draft = 0;
    let waitingApproval = 0;
    let approved = 0;
    let rejected = 0;
    let sent = 0;
    let confirmed = 0;

    quotations.forEach(q => {
      if (q.approval_status === 'DRAFT') draft++;
      else if (q.approval_status === 'WAITING_APPROVAL') waitingApproval++;
      else if (q.approval_status === 'APPROVED') approved++;
      else if (q.approval_status === 'REJECTED') rejected++;
      else if (q.approval_status === 'SENT') sent++;

      // Check if linked lead is confirmed
      const linkedLead = leads.find(l => l.id === q.lead_id);
      if (linkedLead?.status === 'confirmed') {
        confirmed++;
      }
    });

    return {
      total: quotations.length,
      draft,
      waitingApproval,
      approved,
      rejected,
      sent,
      confirmed
    };
  },

  // 4. BOOKING COUNTS & FLEET AVAILABILITY
  getBookingCounts(): BookingCounts {
    const bookings = readStorage<Booking[]>(BOOKINGS_KEY, []);
    const resources = readStorage<Resource[]>(RESOURCES_KEY, []);

    let tentative = 0;
    let confirmed = 0;
    let completed = 0;
    let cancelled = 0;
    let conflicts = 0;

    const activeBookings = bookings.filter(b => b.status === 'TENTATIVE' || b.status === 'CONFIRMED');

    bookings.forEach(b => {
      if (b.status === 'TENTATIVE') tentative++;
      else if (b.status === 'CONFIRMED') confirmed++;
      else if (b.status === 'COMPLETED') completed++;
      else if (b.status === 'CANCELLED') cancelled++;
    });

    // Detect overlapping conflicts among active bookings
    for (let i = 0; i < activeBookings.length; i++) {
      for (let j = i + 1; j < activeBookings.length; j++) {
        const b1 = activeBookings[i];
        const b2 = activeBookings[j];
        if (b1.resource_id === b2.resource_id) {
          if (b1.start_date <= b2.end_date && b1.end_date >= b2.start_date) {
            conflicts++;
          }
        }
      }
    }

    // Category resource breakdown (LED Van, LED Wall, Lookwalker)
    const categories = ['LED Van', 'LED Wall', 'Lookwalker'];
    const resourceAvailability: ResourceCategoryAvailability[] = categories.map(cat => {
      const catResources = resources.filter(r => r.category === cat && r.is_active !== false);
      const totalUnits = catResources.length;
      const bookedResourceIds = new Set(
        activeBookings
          .filter(b => catResources.some(r => r.id === b.resource_id))
          .map(b => b.resource_id)
      );
      const activeCount = bookedResourceIds.size;
      return {
        category: cat,
        totalUnits,
        activeBookings: activeCount,
        availableUnits: Math.max(0, totalUnits - activeCount)
      };
    });

    return {
      total: bookings.length,
      tentative,
      confirmed,
      completed,
      cancelled,
      conflicts,
      resourceAvailability
    };
  },

  // 5. OWNER DAILY DASHBOARD ("WHAT HAPPENED TODAY?" + DATE RANGE)
  getOwnerDailyMetrics(filter: DateFilter = { type: 'today' }): OwnerDailyMetrics {
    const bounds = getDateRangeBounds(filter);

    const leads = readStorage<Lead[]>(LEADS_KEY, []);
    const activities = readStorage<LeadActivity[]>(ACTIVITIES_KEY, []);
    const quotations = readStorage<CrmQuotation[]>(QUOTATIONS_KEY, []);
    const followUps = readStorage<FollowUp[]>(FOLLOW_UPS_KEY, []);
    const bookings = readStorage<Booking[]>(BOOKINGS_KEY, []);

    // 1. New Leads created in range
    const newLeads = leads.filter(l => isDateInBounds(l.created_at, bounds)).length;

    // 2. Leads Worked in range (status transitions or activity notes logged in range)
    const workedLeadIds = new Set(
      activities
        .filter(a => isDateInBounds(a.created_at, bounds))
        .map(a => a.lead_id)
    );
    const leadsWorked = workedLeadIds.size;

    // 3. Requirements Collected in range
    const requirementsCollected = activities.filter(a => 
      a.new_status === 'requirement_collected' && isDateInBounds(a.created_at, bounds)
    ).length;

    // 4. Sent to Admin in range
    const sentToAdmin = activities.filter(a => 
      a.new_status === 'sent_to_admin' && isDateInBounds(a.created_at, bounds)
    ).length;

    // 5. Quotations Created in range
    const quotationsCreated = quotations.filter(q => isDateInBounds(q.created_at, bounds)).length;

    // 6. Quotations Approved in range
    const quotationsApproved = quotations.filter(q => 
      q.approval_status === 'APPROVED' && isDateInBounds(q.approved_at || q.updated_at, bounds)
    ).length;

    // 7. Quotations Sent in range
    const quotationsSent = quotations.filter(q => 
      q.approval_status === 'SENT' && isDateInBounds(q.updated_at, bounds)
    ).length;

    // 8. Follow-ups Due in range
    const followUpsDue = followUps.filter(f => isDateInBounds(f.due_date, bounds)).length;

    // 9. Follow-ups Completed in range
    const followUpsCompleted = followUps.filter(f => 
      f.status === 'COMPLETED' && isDateInBounds(f.completed_at || f.created_at, bounds)
    ).length;

    // 10. Confirmed Jobs in range
    const confirmedJobs = leads.filter(l => 
      l.status === 'confirmed' && isDateInBounds(l.updated_at || l.created_at, bounds)
    ).length;

    // 11. New Bookings in range
    const newBookings = bookings.filter(b => isDateInBounds(b.created_at, bounds)).length;

    // Point-in-time snapshots (Current status)
    const quotationsWaitingApproval = quotations.filter(q => q.approval_status === 'WAITING_APPROVAL').length;
    
    const today = getLocalTodayStr();
    const overdueFollowUps = followUps.filter(f => 
      f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.due_date < today
    ).length;

    return {
      dateFilter: filter,
      newLeads,
      leadsWorked,
      requirementsCollected,
      sentToAdmin,
      quotationsCreated,
      quotationsApproved,
      quotationsSent,
      followUpsDue,
      followUpsCompleted,
      confirmedJobs,
      newBookings,
      quotationsWaitingApproval,
      overdueFollowUps
    };
  },

  // 6. OWNER ATTENTION ("ACTION REQUIRED")
  getActionRequiredCounts(): ActionRequiredCounts {
    const leads = readStorage<Lead[]>(LEADS_KEY, []);
    const quotations = readStorage<CrmQuotation[]>(QUOTATIONS_KEY, []);
    const followUps = readStorage<FollowUp[]>(FOLLOW_UPS_KEY, []);
    const bookings = readStorage<Booking[]>(BOOKINGS_KEY, []);

    const today = getLocalTodayStr();

    const leadsWaitingAdmin = leads.filter(l => l.status === 'sent_to_admin').length;
    const quotationsWaitingOwnerApproval = quotations.filter(q => q.approval_status === 'WAITING_APPROVAL').length;
    const followUpsDueNow = followUps.filter(f => f.status === 'PENDING' && f.due_date === today).length;
    const overdueFollowUps = followUps.filter(f => f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.due_date < today).length;
    const unassignedLeads = leads.filter(l => !l.assigned_telecaller_email).length;

    // Conflict calculations
    let bookingConflicts = 0;
    const activeBookings = bookings.filter(b => b.status === 'TENTATIVE' || b.status === 'CONFIRMED');
    for (let i = 0; i < activeBookings.length; i++) {
      for (let j = i + 1; j < activeBookings.length; j++) {
        const b1 = activeBookings[i];
        const b2 = activeBookings[j];
        if (b1.resource_id === b2.resource_id) {
          if (b1.start_date <= b2.end_date && b1.end_date >= b2.start_date) {
            bookingConflicts++;
          }
        }
      }
    }

    const totalAlerts = 
      leadsWaitingAdmin + 
      quotationsWaitingOwnerApproval + 
      followUpsDueNow + 
      overdueFollowUps + 
      bookingConflicts + 
      unassignedLeads;

    return {
      leadsWaitingAdmin,
      quotationsWaitingOwnerApproval,
      followUpsDueNow,
      overdueFollowUps,
      bookingConflicts,
      unassignedLeads,
      totalAlerts
    };
  },

  // 7. ADMIN QUEUE COUNTS
  getAdminCounts(): AdminQueueCounts {
    const leads = readStorage<Lead[]>(LEADS_KEY, []);
    const quotations = readStorage<CrmQuotation[]>(QUOTATIONS_KEY, []);

    const incomingRequirements = leads.filter(l => l.status === 'sent_to_admin' || l.status === 'quotation_preparing').length;
    const quotationsPreparing = leads.filter(l => l.status === 'quotation_preparing').length;
    const waitingOwnerApproval = quotations.filter(q => q.approval_status === 'WAITING_APPROVAL').length;
    const quotationsSent = quotations.filter(q => q.approval_status === 'SENT').length;

    return {
      incomingRequirements,
      quotationsPreparing,
      waitingOwnerApproval,
      quotationsSent
    };
  },

  // 8. TELECALLER MATRIX
  getTelecallerMetrics(staffFilter?: string): TelecallerMetricsRow[] {
    const leads = readStorage<Lead[]>(LEADS_KEY, []);
    const followUps = readStorage<FollowUp[]>(FOLLOW_UPS_KEY, []);
    const today = getLocalTodayStr();

    const emailsSet = new Set<string>();
    leads.forEach(l => {
      if (l.assigned_telecaller_email) emailsSet.add(l.assigned_telecaller_email);
    });
    followUps.forEach(f => {
      if (f.assigned_staff_email && f.assigned_staff_email !== 'owner@b2p.com' && f.assigned_staff_email.toLowerCase() !== 'sarathjohnpanegdan@gmail.com') {
        emailsSet.add(f.assigned_staff_email);
      }
    });

    const formatStaffName = (email: string) => {
      if (!email || email === 'unassigned') return 'Unassigned Queue';
      const local = email.split('@')[0];
      return local
        .split(/[._-]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    };

    const staffEmails = Array.from(emailsSet);
    const staffList = staffEmails.map(email => ({
      email,
      name: formatStaffName(email)
    }));

    const unassignedCount = leads.filter(l => !l.assigned_telecaller_email).length;
    if (unassignedCount > 0) {
      staffList.push({ email: 'unassigned', name: 'Unassigned Queue' });
    }

    const rows: TelecallerMetricsRow[] = staffList.map(staff => {
      const staffLeads = leads.filter(l => {
        if (staff.email === 'unassigned') {
          return !l.assigned_telecaller_email;
        }
        return l.assigned_telecaller_email === staff.email;
      });

      const staffFollowUps = followUps.filter(f => {
        if (staff.email === 'unassigned') return false;
        return f.assigned_staff_email === staff.email;
      });

      const assignedLeads = staffLeads.length;
      const newLeads = staffLeads.filter(l => l.status === 'new').length;
      const workingLeads = staffLeads.filter(l => l.status === 'telecaller_working').length;
      const requirementsCollected = staffLeads.filter(l => l.status === 'requirement_collected').length;
      const sentToAdmin = staffLeads.filter(l => l.status === 'sent_to_admin').length;
      const followUpsDue = staffFollowUps.filter(f => f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.due_date <= today).length;
      const confirmed = staffLeads.filter(l => l.status === 'confirmed').length;
      const lost = staffLeads.filter(l => l.status === 'lost').length;

      const conversionRate = assignedLeads > 0 ? Math.round((confirmed / assignedLeads) * 100) : 0;

      return {
        email: staff.email,
        name: staff.name,
        assignedLeads,
        newLeads,
        workingLeads,
        working: workingLeads,
        requirementsCollected,
        sentToAdmin,
        followUpsDue,
        confirmed,
        lost,
        conversionRate
      };
    });

    if (staffFilter && staffFilter !== 'owner@b2p.com' && staffFilter !== 'admin@b2p.com' && staffFilter.toLowerCase() !== 'fransonputhukkara@gmail.com' && staffFilter.toLowerCase() !== 'sarathjohnpanegdan@gmail.com') {
      return rows.filter(r => r.email === staffFilter);
    }

    return rows;
  }
};
