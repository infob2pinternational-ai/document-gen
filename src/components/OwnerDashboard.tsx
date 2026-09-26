import React, { useState, useEffect, useMemo } from 'react';
import type { 
  CrmQuotation, 
  FollowUp, 
  Lead, 
  LeadActivity, 
  Booking, 
  Resource,
  PaymentReceived,
  Document
} from '../types';
import { leadService } from '../services/leadService';
import { officeService } from '../services/officeService';
import { metricsService, getDateRangeBounds, isDateInBounds, type DateFilterType } from '../services/metricsService';
import { financeService } from '../services/financeService';
import { bookingsOnDate, localDateKey } from '../utils/dashboardStats';
import { QuotationModal } from './QuotationModal';
import { FollowUpModal } from './FollowUpModal';
import { 
  Users, 
  Clock, 
  ShieldCheck, 
  CheckCircle2, 
  TrendingUp, 
  CreditCard, 
  Truck, 
  ChevronRight, 
  Activity, 
  Layers,
  UserCheck,
  Megaphone
} from 'lucide-react';

interface OwnerDashboardProps {
  userRole?: string;
  userEmail?: string;
  documents?: Document[];
  onNavigateTab: (tab: string) => void;
  onOpenLead?: (leadId: string) => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  userRole: _userRole = 'owner',
  userEmail = 'owner@b2p.com',
  documents = [],
  onNavigateTab,
  onOpenLead
}) => {
  // Time Window Filter
  const [dateFilter, setDateFilter] = useState<DateFilterType>('today');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'lead' | 'quote' | 'followup' | 'booking' | 'payment'>('all');

  // Core Data States
  const [leads, setLeads] = useState<Lead[]>([]);
  const [quotations, setQuotations] = useState<CrmQuotation[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [payments, setPayments] = useState<PaymentReceived[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [financeMetrics, setFinanceMetrics] = useState<any>(null);
  const [lastDataRefresh, setLastDataRefresh] = useState<string>('');

  // Modals for In-Cockpit Immediate Actions
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [viewingQuotation, setViewingQuotation] = useState<CrmQuotation | null>(null);
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [viewingFollowUp, setViewingFollowUp] = useState<FollowUp | null>(null);

  // Load live data across services
  const refreshAllData = async () => {
    const loadedLeads = leadService.getLeads();
    const loadedQuotes = officeService.getQuotations();
    const loadedFollowUps = officeService.getFollowUps('all');
    const loadedBookings = officeService.getBookings();
    const loadedResources = officeService.getResources();
    const loadedPayments = financeService.getPaymentsReceived();
    const fMetrics = await financeService.getFinanceMetrics();

    setLeads(loadedLeads);
    setQuotations(loadedQuotes);
    setFollowUps(loadedFollowUps);
    setBookings(loadedBookings);
    setResources(loadedResources);
    setPayments(loadedPayments);
    setFinanceMetrics(fMetrics);

    // Aggregate lead activities
    const allActs: LeadActivity[] = [];
    loadedLeads.forEach(l => {
      const acts = leadService.getLeadActivities(l.id);
      allActs.push(...acts);
    });
    allActs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setActivities(allActs);
    setLastDataRefresh(new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }));
  };

  useEffect(() => {
    refreshAllData();
    const unsubMetrics = metricsService.subscribe(refreshAllData);
    const unsubFinance = financeService.subscribe(refreshAllData);
    return () => {
      unsubMetrics();
      unsubFinance();
    };
  }, []);

  // Compute Active Date Bounds
  const dateBounds = useMemo(() => {
    return getDateRangeBounds({
      type: dateFilter,
      startDate: customStartDate,
      endDate: customEndDate
    });
  }, [dateFilter, customStartDate, customEndDate]);

  // Today ISO Date string for live comparison
  const [todayStr, setTodayStr] = useState(() => localDateKey());
  useEffect(() => {
    const timer = window.setInterval(() => setTodayStr(localDateKey()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  // Filtered in-window records
  const leadsInWindow = useMemo(() => {
    return leads.filter(l => isDateInBounds(l.created_at, dateBounds));
  }, [leads, dateBounds]);

  const followUpsInWindow = useMemo(() => {
    return followUps.filter(f => isDateInBounds(f.due_date, dateBounds));
  }, [followUps, dateBounds]);

  const paymentsInWindow = useMemo(() => {
    return payments.filter(p => isDateInBounds(p.payment_date, dateBounds));
  }, [payments, dateBounds]);

  // =========================================================================
  // EXECUTIVE KPIS (BUSINESS ACTIONS & DECISION VALUE)
  // =========================================================================

  // 1. Leads & Inquiries
  const newLeadsCount = leadsInWindow.length;
  const unassignedLeads = useMemo(() => leads.filter(l => !l.assigned_telecaller_email), [leads]);
  const unassignedCount = unassignedLeads.length;

  // 2. Follow-ups
  const overdueFollowUps = useMemo(() => {
    return followUps.filter(f => f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.due_date < todayStr);
  }, [followUps, todayStr]);
  const followUpsDueInWindow = followUpsInWindow.filter(f => f.status !== 'COMPLETED' && f.status !== 'CANCELLED').length;

  const docGenPendingApproval = useMemo(() => {
    return documents.filter(d => d.status !== 'approved' && d.status !== 'rejected');
  }, [documents]);
  const docGenPendingApprovalValue = useMemo(() => {
    return docGenPendingApproval.reduce((sum, d) => sum + (Number(d.total) || 0), 0);
  }, [docGenPendingApproval]);

  // 3. Quotations & Approvals
  const crmQuotesWaitingApproval = useMemo(() => {
    return quotations.filter(q => q.approval_status === 'WAITING_APPROVAL');
  }, [quotations]);
  const waitingApprovalCount = crmQuotesWaitingApproval.length + docGenPendingApproval.length;
  const waitingApprovalValue = useMemo(() => {
    const crmValue = crmQuotesWaitingApproval.reduce((sum, q) => sum + (Number(q.total) || 0), 0);
    return crmValue + docGenPendingApprovalValue;
  }, [crmQuotesWaitingApproval, docGenPendingApprovalValue]);

  // 4. Confirmed Jobs & Campaigns
  const confirmedLeadsInWindow = useMemo(() => {
    return leads.filter(l => l.status === 'confirmed' && isDateInBounds(l.updated_at || l.created_at, dateBounds));
  }, [leads, dateBounds]);
  const activeBookingsCount = useMemo(() => {
    return bookingsOnDate(bookings, todayStr).length;
  }, [bookings, todayStr]);

  // 5. Pipeline Financial Value
  const activePipelineQuotations = useMemo(() => {
    return quotations.filter(q => 
      q.approval_status === 'DRAFT' || 
      q.approval_status === 'WAITING_APPROVAL' || 
      q.approval_status === 'APPROVED' || 
      q.approval_status === 'SENT'
    );
  }, [quotations]);
  const activePipelineDocuments = useMemo(() => {
    return documents.filter(d =>
      (d.document_type === 'quotation' || d.document_type === 'proforma_invoice' || d.document_type === 'comparison_quotation') &&
      d.status !== 'rejected'
    );
  }, [documents]);
  const activePipelineCount = activePipelineQuotations.length + activePipelineDocuments.length;
  const activePipelineValue = useMemo(() => {
    const crmValue = activePipelineQuotations.reduce((sum, q) => sum + (Number(q.total) || 0), 0);
    const documentValue = activePipelineDocuments.reduce((sum, d) => sum + (Number(d.total) || 0), 0);
    return crmValue + documentValue;
  }, [activePipelineQuotations, activePipelineDocuments]);

  // 6. Payments & Cash Inflow
  const paymentsCollectedAmount = useMemo(() => {
    return paymentsInWindow.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [paymentsInWindow]);

  // Outstanding Receivables from Accounting Engine
  const outstandingReceivables = financeMetrics?.totalReceivables ?? 0;

  // 7. Fleet Availability & Occupancy
  const activeBookedResourceIds = useMemo(() => {
    const activeBkgs = bookingsOnDate(bookings, todayStr);
    const set = new Set<string>();
    activeBkgs.forEach(b => {
      if (b.resource_id) set.add(b.resource_id);
    });
    return set;
  }, [bookings, todayStr]);

  const totalFleetUnits = resources.filter(r => r.is_active !== false).length;
  const bookedFleetUnits = resources.filter(r => r.is_active !== false && activeBookedResourceIds.has(r.id)).length;
  const availableFleetUnits = Math.max(0, totalFleetUnits - bookedFleetUnits);

  // Category Fleet Breakdown
  const fleetCategories = useMemo(() => {
    const cats: { name: string; icon: any; total: number; booked: number; available: number }[] = [
      { name: 'LED Van Advertising', icon: Truck, total: 0, booked: 0, available: 0 },
      { name: 'LED Wall', icon: Layers, total: 0, booked: 0, available: 0 },
      { name: 'Lookwalker', icon: UserCheck, total: 0, booked: 0, available: 0 },
      { name: 'Marketing', icon: Megaphone, total: 0, booked: 0, available: 0 }
    ];

    cats.forEach(cat => {
      const catRes = resources.filter(r => 
        (r.category === cat.name || 
         (cat.name === 'LED Van Advertising' && (r.category === 'LED Van' || r.category === 'LED Van Advertising'))) && 
        r.is_active !== false
      );
      const total = catRes.length;
      const booked = catRes.filter(r => activeBookedResourceIds.has(r.id)).length;
      cat.total = total;
      cat.booked = booked;
      cat.available = Math.max(0, total - booked);
    });

    return cats;
  }, [resources, activeBookedResourceIds]);

  // Telecaller Performance Data (Dynamically derived from real application records)
  const telecallerMetrics = metricsService.getTelecallerMetrics();

  // Lead Pipeline Funnel Breakdown
  const leadPipelineStages = useMemo(() => {
    const stages: { key: string; label: string; count: number; color: string }[] = [
      { key: 'new', label: 'New Intake', count: 0, color: '#3b82f6' },
      { key: 'telecaller_working', label: 'Working', count: 0, color: '#0ea5e9' },
      { key: 'requirement_collected', label: 'Req Collected', count: 0, color: '#f59e0b' },
      { key: 'sent_to_admin', label: 'Sent to Admin', count: 0, color: '#8b5cf6' },
      { key: 'quotation_preparing', label: 'Quoting', count: 0, color: '#a855f7' },
      { key: 'waiting_owner_approval', label: 'Owner Review', count: 0, color: '#ef4444' },
      { key: 'quotation_sent', label: 'Quote Sent', count: 0, color: '#06b6d4' },
      { key: 'follow_up', label: 'Follow-up', count: 0, color: '#f97316' },
      { key: 'confirmed', label: 'Confirmed (Won)', count: 0, color: '#10b981' }
    ];

    leads.forEach(l => {
      const found = stages.find(s => s.key === l.status);
      if (found) found.count++;
    });

    const totalLeads = leads.length || 1;
    return stages.map(s => ({
      ...s,
      pct: Math.round((s.count / totalLeads) * 100)
    }));
  }, [leads]);

  // =========================================================================
  // COMBINED ACTIVITY STREAM
  // =========================================================================
  const activityStream = useMemo(() => {
    const items: {
      id: string;
      time: string;
      timestamp: number;
      type: 'lead' | 'quote' | 'followup' | 'booking' | 'payment';
      title: string;
      desc: string;
      author: string;
      leadId?: string;
      quoteId?: string;
    }[] = [];

    // 1. Lead Activities
    activities.forEach(act => {
      const lead = leads.find(l => l.id === act.lead_id);
      const isDateValid = isDateInBounds(act.created_at, dateBounds);
      if (isDateValid) {
        items.push({
          id: `act-${act.id}`,
          time: new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(act.created_at).getTime(),
          type: 'lead',
          title: act.action || 'Lead Updated',
          desc: lead ? `${lead.customer_name} (${lead.service_required || 'Enquiry'})` : (act.note || 'Lead activity'),
          author: act.user_email?.split('@')[0] || 'Staff',
          leadId: act.lead_id
        });
      }
    });

    // 2. Quotation Events
    quotations.forEach(q => {
      if (isDateInBounds(q.created_at, dateBounds)) {
        items.push({
          id: `q-created-${q.id}`,
          time: new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(q.created_at).getTime(),
          type: 'quote',
          title: `Quotation ${q.quotation_number} Created`,
          desc: `${q.customer_name} — ₹ ${Number(q.total || 0).toLocaleString('en-IN')}`,
          author: q.created_by_email?.split('@')[0] || 'Admin',
          quoteId: q.id,
          leadId: q.lead_id
        });
      }
      if (q.approved_at && isDateInBounds(q.approved_at, dateBounds)) {
        items.push({
          id: `q-app-${q.id}`,
          time: new Date(q.approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(q.approved_at).getTime(),
          type: 'quote',
          title: `Owner Approved ${q.quotation_number}`,
          desc: `${q.customer_name} — Approved for Dispatch`,
          author: 'Owner',
          quoteId: q.id,
          leadId: q.lead_id
        });
      }
    });

    // 3. Follow-up Events
    followUps.forEach(f => {
      if (f.completed_at && isDateInBounds(f.completed_at, dateBounds)) {
        items.push({
          id: `fu-comp-${f.id}`,
          time: new Date(f.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(f.completed_at).getTime(),
          type: 'followup',
          title: 'Follow-up Completed',
          desc: `${f.customer_name} — ${f.completion_note || f.reason}`,
          author: f.assigned_staff_email?.split('@')[0] || 'Telecaller',
          leadId: f.lead_id
        });
      }
    });

    // 4. Booking Events
    bookings.forEach(b => {
      if (isDateInBounds(b.created_at, dateBounds)) {
        items.push({
          id: `bkg-${b.id}`,
          time: new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(b.created_at).getTime(),
          type: 'booking',
          title: `Booking ${b.booking_number} Reserved`,
          desc: `${b.resource_name} for ${b.customer_name} (${b.start_date} to ${b.end_date})`,
          author: b.assigned_staff_email?.split('@')[0] || 'Ops',
          leadId: b.lead_id
        });
      }
    });

    // 5. Payment Inflow Events
    payments.forEach(p => {
      if (isDateInBounds(p.payment_date, dateBounds)) {
        items.push({
          id: `pmt-${p.id}`,
          time: new Date(p.created_at || p.payment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: new Date(p.created_at || p.payment_date).getTime(),
          type: 'payment',
          title: `Payment Received: ₹ ${Number(p.amount || 0).toLocaleString('en-IN')}`,
          desc: `${p.customer_name} via ${p.payment_mode.toUpperCase()} (Ref: ${p.reference_number || 'Direct'})`,
          author: p.created_by_email?.split('@')[0] || 'Accounts'
        });
      }
    });

    // Sort descending by timestamp
    items.sort((a, b) => b.timestamp - a.timestamp);

    // Apply category filter
    if (activityFilter === 'all') return items;
    return items.filter(i => i.type === activityFilter);
  }, [activities, quotations, followUps, bookings, payments, leads, dateBounds, activityFilter]);

  // Format INR Currency cleanly
  const formatINR = (val: number) => {
    return `₹ ${Number(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* ========================================================================= */}
      {/* 1. EXECUTIVE CONTROL HEADER & TIME WINDOW CONTROLLER */}
      {/* ========================================================================= */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '1rem 1.35rem',
        boxShadow: 'var(--shadow-glass)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Executive Control Center
            </h1>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.6875rem',
              fontWeight: 700,
              padding: '0.2rem 0.55rem',
              borderRadius: '9999px',
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#059669',
              border: '1px solid rgba(16, 185, 129, 0.25)'
            }}>
              <span className="status-dot status-dot-success" style={{ width: '6px', height: '6px' }} />
              Live Operations
            </span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Real-time business intelligence, actionable approvals, revenue velocity, and fleet utilization.
            {lastDataRefresh && (
              <span style={{ marginLeft: '0.45rem', color: 'var(--text-muted)' }}>
                View refreshed {lastDataRefresh}
              </span>
            )}
          </p>
        </div>

        {/* Date Filter Bar & Navigation Shortcuts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          
          {/* Quick Date Scope Pills */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.75)',
            border: '1px solid rgba(203, 213, 225, 0.7)',
            borderRadius: '9999px',
            padding: '0.2rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
          }}>
            {(['today', 'yesterday', 'this_week', 'this_month', 'custom'] as const).map((filterKey) => {
              const isActive = dateFilter === filterKey;
              const labels: Record<typeof filterKey, string> = {
                today: 'Today',
                yesterday: 'Yesterday',
                this_week: 'This Week',
                this_month: 'This Month',
                custom: 'Custom'
              };
              return (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => setDateFilter(filterKey)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.75rem',
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '9999px',
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? 'var(--brand-blue)' : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--text-secondary)',
                    boxShadow: isActive ? '0 2px 6px rgba(37, 99, 235, 0.3)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {labels[filterKey]}
                </button>
              );
            })}
          </div>

          {/* Custom Date Pickers if active */}
          {dateFilter === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderRadius: '8px' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', borderRadius: '8px' }}
              />
            </div>
          )}

          {/* Quick Add / Jump Buttons */}
          <button
            onClick={() => onNavigateTab('leads')}
            className="btn-primary"
            style={{ padding: '0.4rem 0.85rem', fontSize: '0.78rem', gap: '0.35rem' }}
          >
            <Users size={14} />
            <span>Manage Leads</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. EXECUTIVE KPI COMMAND STRIP (EVERY METRIC = BUSINESS ACTION) */}
      {/* ========================================================================= */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.85rem'
      }}>
        
        {/* KPI 1: Leads & Inquiries */}
        <div 
          onClick={() => onNavigateTab('leads')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to open Leads module"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(37, 99, 235, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-blue)' }}>
              <Users size={17} />
            </div>
            {unassignedCount > 0 ? (
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.15rem 0.45rem', borderRadius: '9999px' }}>
                {unassignedCount} unassigned
              </span>
            ) : (
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981' }}>Allocated</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {newLeadsCount}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Inquiries in Window
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>View lead intake</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 2: Follow-ups Due & Overdue */}
        <div 
          onClick={() => onNavigateTab('follow-ups')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to open Follow-ups schedule"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
              <Clock size={17} />
            </div>
            {overdueFollowUps.length > 0 ? (
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', padding: '0.15rem 0.45rem', borderRadius: '9999px' }}>
                {overdueFollowUps.length} overdue
              </span>
            ) : (
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981' }}>On schedule</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {followUpsDueInWindow}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Follow-ups Pending
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#d97706', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>Execute client calls</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 3: Quotations Waiting Owner Approval */}
        <div 
          onClick={() => {
            if (crmQuotesWaitingApproval.length > 0) {
              setViewingQuotation(crmQuotesWaitingApproval[0]);
              setQuotationModalOpen(true);
            } else {
              onNavigateTab('documents');
            }
          }}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to review & approve pending quotations"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
              <ShieldCheck size={17} />
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, background: waitingApprovalCount > 0 ? '#fee2e2' : '#f1f5f9', color: waitingApprovalCount > 0 ? '#b91c1c' : '#64748b', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.15rem 0.45rem', borderRadius: '9999px' }}>
              {waitingApprovalCount > 0 ? `${formatINR(waitingApprovalValue)} pending` : 'All Approved'}
            </span>
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {waitingApprovalCount}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Waiting Approval
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>Review & sign-off</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 4: Confirmed Jobs & Active Deployments */}
        <div 
          onClick={() => onNavigateTab('calendar')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to view Bookings Calendar"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
              <CheckCircle2 size={17} />
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981' }}>
              {activeBookingsCount} on field
            </span>
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {confirmedLeadsInWindow.length}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Confirmed Deals (Won)
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>View deployment calendar</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 5: Active Pipeline Value */}
        <div 
          onClick={() => onNavigateTab('reports')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to view Revenue Analytics"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <TrendingUp size={17} />
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              {activePipelineCount} proposals
            </span>
          </div>
          <div>
            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {formatINR(activePipelineValue)}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Active Pipeline Value
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>Conversion analytics</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 6: Payments & Inflow vs Receivables */}
        <div 
          onClick={() => onNavigateTab('sales-receivables')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to view Sales & Receivables"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(6, 182, 212, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0891b2' }}>
              <CreditCard size={17} />
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626' }}>
              {formatINR(outstandingReceivables)} due
            </span>
          </div>
          <div>
            <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {formatINR(paymentsCollectedAmount)}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Collections in Window
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#0891b2', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>Track receivables</span> <ChevronRight size={12} />
          </div>
        </div>

        {/* KPI 7: Fleet Availability & Readiness */}
        <div 
          onClick={() => onNavigateTab('calendar')}
          className="glass-panel glass-card-hoverable"
          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          title="Click to view Fleet Availability Matrix"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
              <Truck size={17} />
            </div>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: availableFleetUnits > 0 ? '#10b981' : '#ef4444' }}>
              {availableFleetUnits} / {totalFleetUnits} Free
            </span>
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {availableFleetUnits > 0 ? `${availableFleetUnits} Units` : 'Fully Booked'}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Fleet Ready to Book
            </div>
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: 'auto' }}>
            <span>Reserve vehicles</span> <ChevronRight size={12} />
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN DUAL-PANE COCKPIT: ACTIVITY TIMELINE + ACTION REQUIRED QUEUE */}
      {/* ========================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)', gap: '1.15rem' }}>
        
        {/* Left Pane: Today's Operational Activity Stream */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Operational Activity Stream
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Chronological ledger of inquiries, quotations, follow-ups, and payments
              </span>
            </div>

            {/* Category Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
              {(['all', 'lead', 'quote', 'followup', 'booking', 'payment'] as const).map((cat) => {
                const isActive = activityFilter === cat;
                const catLabels: Record<typeof cat, string> = {
                  all: 'All',
                  lead: 'Leads',
                  quote: 'Quotes',
                  followup: 'Calls',
                  booking: 'Fleet',
                  payment: 'Payments'
                };
                return (
                  <button
                    key={cat}
                    onClick={() => setActivityFilter(cat)}
                    style={{
                      padding: '0.2rem 0.55rem',
                      fontSize: '0.6875rem',
                      fontWeight: isActive ? 700 : 500,
                      borderRadius: '9999px',
                      border: 'none',
                      cursor: 'pointer',
                      background: isActive ? 'rgba(37, 99, 235, 0.15)' : 'transparent',
                      color: isActive ? 'var(--brand-blue)' : 'var(--text-secondary)'
                    }}
                  >
                    {catLabels[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Activity List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '380px', paddingRight: '0.25rem' }}>
            {activityStream.length > 0 ? (
              activityStream.slice(0, 15).map((item) => {
                const badgeColors: Record<typeof item.type, { bg: string; text: string }> = {
                  lead: { bg: 'rgba(37, 99, 235, 0.1)', text: '#2563eb' },
                  quote: { bg: 'rgba(139, 92, 246, 0.1)', text: '#7c3aed' },
                  followup: { bg: 'rgba(245, 158, 11, 0.12)', text: '#b45309' },
                  booking: { bg: 'rgba(16, 185, 129, 0.1)', text: '#059669' },
                  payment: { bg: 'rgba(6, 182, 212, 0.12)', text: '#0891b2' }
                };
                const color = badgeColors[item.type];

                return (
                  <div 
                    key={item.id}
                    onClick={() => {
                      if (item.leadId && onOpenLead) {
                        onOpenLead(item.leadId);
                      } else if (item.quoteId) {
                        const targetQ = quotations.find(q => q.id === item.quoteId);
                        if (targetQ) {
                          setViewingQuotation(targetQ);
                          setQuotationModalOpen(true);
                        } else {
                          onNavigateTab('documents');
                        }
                      } else if (item.type === 'payment') {
                        onNavigateTab('documents');
                      } else if (item.type === 'booking') {
                        onNavigateTab('calendar');
                      }
                    }}
                    className="glass-card-hoverable"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.75)',
                      border: '1px solid rgba(226, 232, 240, 0.8)',
                      cursor: 'pointer'
                    }}
                  >
                    <span className="mono" style={{ fontSize: '0.6875rem', color: '#94a3b8', width: '55px', flexShrink: 0, paddingTop: '2px' }}>
                      {item.time}
                    </span>
                    <div style={{
                      padding: '0.15rem 0.45rem',
                      borderRadius: '6px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      background: color.bg,
                      color: color.text,
                      textTransform: 'uppercase',
                      flexShrink: 0
                    }}>
                      {item.type}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.desc}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--text-muted)', flexShrink: 0, textTransform: 'capitalize' }}>
                      {item.author}
                    </span>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                <Activity size={28} color="#94a3b8" style={{ margin: '0 auto 0.5rem auto', opacity: 0.6 }} />
                No activity recorded in this selected timeframe.
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Needs Attention (Executive Decision Queue) */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Needs Attention
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Actionable executive decisions and risk alerts
              </span>
            </div>
            <span style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              padding: '0.15rem 0.5rem',
              borderRadius: '9999px',
              background: (waitingApprovalCount + overdueFollowUps.length + unassignedCount) > 0 ? '#fee2e2' : '#f0fdf4',
              color: (waitingApprovalCount + overdueFollowUps.length + unassignedCount) > 0 ? '#dc2626' : '#16a34a'
            }}>
              {waitingApprovalCount + overdueFollowUps.length + unassignedCount} Action Items
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', maxHeight: '380px' }}>
            
            {/* Attention Item 1: Quotations Waiting Owner Approval */}
            {crmQuotesWaitingApproval.length > 0 ? (
              crmQuotesWaitingApproval.map((q) => (
                <div 
                  key={q.id}
                  className="glass-card-hoverable"
                  style={{
                    background: 'rgba(255, 255, 255, 0.85)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '10px',
                    padding: '0.75rem 0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                      <ShieldCheck size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {q.quotation_number} — {q.customer_name}
                      </div>
                      <div className="mono" style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>
                        {formatINR(Number(q.total || 0))} · Waiting sign-off
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setViewingQuotation(q);
                      setQuotationModalOpen(true);
                    }}
                    className="btn-primary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.25rem 0.65rem',
                      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      border: 'none',
                      flexShrink: 0
                    }}
                  >
                    Review
                  </button>
                </div>
              ))
            ) : null}

            {docGenPendingApproval.length > 0 ? (
              docGenPendingApproval.slice(0, 5).map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onNavigateTab('documents')}
                  className="glass-card-hoverable"
                  style={{
                    background: 'rgba(255, 255, 255, 0.85)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '10px',
                    padding: '0.75rem 0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                      <ShieldCheck size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {doc.document_number} - {doc.customer_name}
                      </div>
                      <div className="mono" style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>
                        {formatINR(Number(doc.total || 0))} - Doc Gen approval pending
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={16} color="#ef4444" />
                </div>
              ))
            ) : null}

            {/* Attention Item 2: Overdue Follow-ups */}
            {overdueFollowUps.length > 0 ? (
              overdueFollowUps.slice(0, 3).map((f) => (
                <div 
                  key={f.id}
                  className="glass-card-hoverable"
                  style={{
                    background: 'rgba(255, 255, 255, 0.85)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    borderRadius: '10px',
                    padding: '0.75rem 0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706', flexShrink: 0 }}>
                      <Clock size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.customer_name} ({f.phone || 'No phone'})
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#b45309' }}>
                        Overdue since {f.due_date} — {f.reason}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setViewingFollowUp(f);
                      setFollowUpModalOpen(true);
                    }}
                    className="btn-secondary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.25rem 0.65rem',
                      color: '#d97706',
                      borderColor: '#fde68a',
                      flexShrink: 0
                    }}
                  >
                    Call Now
                  </button>
                </div>
              ))
            ) : null}

            {/* Attention Item 3: Unassigned Leads */}
            {unassignedLeads.length > 0 ? (
              <div 
                onClick={() => onNavigateTab('leads')}
                className="glass-card-hoverable"
                style={{
                  background: 'rgba(255, 255, 255, 0.85)',
                  border: '1px solid rgba(37, 99, 235, 0.2)',
                  borderRadius: '10px',
                  padding: '0.75rem 0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-blue)' }}>
                    <Users size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {unassignedLeads.length} Inquiries Unassigned
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Assign telecallers to initiate contact velocity
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </div>
            ) : null}

            {/* All clear state */}
            {waitingApprovalCount === 0 && overdueFollowUps.length === 0 && unassignedLeads.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                background: 'rgba(240, 253, 244, 0.5)',
                borderRadius: '10px',
                border: '1px solid rgba(187, 247, 208, 0.7)'
              }}>
                <CheckCircle2 size={28} color="#16a34a" style={{ margin: '0 auto 0.5rem auto' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534' }}>
                  All Queues Clear
                </div>
                <div style={{ fontSize: '0.72rem', color: '#15803d', marginTop: '0.2rem' }}>
                  No pending quotations, overdue follow-ups, or unassigned leads.
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 4. STRATEGIC ANALYTICAL PANELS: PIPELINES, FLEET & PERFORMANCE */}
      {/* ========================================================================= */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1.15rem'
      }}>
        
        {/* Panel 1: Lead Pipeline Stage Velocity */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Lead Pipeline Funnel
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Total Active Inquiries: {leads.length}
              </span>
            </div>
            <button 
              onClick={() => onNavigateTab('leads')}
              className="btn-ghost" 
              style={{ fontSize: '0.72rem', color: 'var(--brand-blue)', fontWeight: 600, padding: '0.2rem 0.5rem' }}
            >
              View Board
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', flex: 1 }}>
            {leadPipelineStages.map((stage) => (
              <div 
                key={stage.key}
                onClick={() => onNavigateTab('leads')}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                title={`${stage.label}: ${stage.count} leads (${stage.pct}%)`}
              >
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', width: '120px', flexShrink: 0, fontWeight: 500 }}>
                  {stage.label}
                </span>
                <div style={{ flex: 1, height: '8px', background: 'rgba(226, 232, 240, 0.7)', borderRadius: '9999px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(4, stage.pct)}%`, height: '100%', background: stage.color, borderRadius: '9999px', transition: 'width 0.3s ease' }} />
                </div>
                <span className="mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)', width: '35px', textAlign: 'right' }}>
                  {stage.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 2: Fleet Availability & Readiness */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Fleet Availability Matrix
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Live field deployment & booking slots
              </span>
            </div>
            <button 
              onClick={() => onNavigateTab('calendar')}
              className="btn-ghost" 
              style={{ fontSize: '0.72rem', color: 'var(--brand-blue)', fontWeight: 600, padding: '0.2rem 0.5rem' }}
            >
              Open Calendar
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
            {fleetCategories.map((cat) => {
              const IconComp = cat.icon;
              const bookedPct = cat.total > 0 ? Math.round((cat.booked / cat.total) * 100) : 0;
              const isAvailable = cat.available > 0;

              return (
                <div 
                  key={cat.name}
                  onClick={() => onNavigateTab('calendar')}
                  className="glass-card-hoverable"
                  style={{
                    background: 'rgba(255, 255, 255, 0.75)',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    borderRadius: '10px',
                    padding: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                      <IconComp size={15} color="var(--brand-blue)" />
                      <span>{cat.name}</span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                        ({cat.total} Units Total)
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: isAvailable ? '#059669' : '#dc2626',
                      background: isAvailable ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      padding: '0.1rem 0.45rem',
                      borderRadius: '9999px'
                    }}>
                      {cat.available} Available
                    </span>
                  </div>

                  <div style={{ height: '6px', background: 'rgba(226, 232, 240, 0.7)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div style={{ width: `${bookedPct}%`, height: '100%', background: isAvailable ? 'var(--brand-blue)' : '#ef4444', borderRadius: '9999px' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    <span>{cat.booked} Active Deployments</span>
                    <span>{bookedPct}% Occupied</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel 3: Dynamic Staff Velocity & Telecaller Matrix */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Team Performance
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Dynamic velocity derived from active accounts
              </span>
            </div>
            <button 
              onClick={() => onNavigateTab('reports')}
              className="btn-ghost" 
              style={{ fontSize: '0.72rem', color: 'var(--brand-blue)', fontWeight: 600, padding: '0.2rem 0.5rem' }}
            >
              Full Analytics
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
            {telecallerMetrics.length > 0 ? (
              telecallerMetrics.map((staff) => (
                <div 
                  key={staff.email}
                  onClick={() => onNavigateTab('reports')}
                  className="glass-card-hoverable"
                  style={{
                    background: 'rgba(255, 255, 255, 0.75)',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    borderRadius: '10px',
                    padding: '0.65rem 0.8rem',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 800 }}>
                        {staff.name.charAt(0)}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--text-primary)' }}>
                        {staff.name}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: staff.conversionRate > 20 ? '#059669' : '#d97706' }}>
                      {staff.conversionRate}% Win ({staff.confirmed})
                    </div>
                  </div>

                  <div style={{ height: '4px', background: 'rgba(226, 232, 240, 0.7)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(10, staff.conversionRate))}%`, height: '100%', background: staff.conversionRate > 20 ? '#10b981' : '#f59e0b', borderRadius: '9999px' }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    <span>{staff.assignedLeads} leads assigned</span>
                    <span>{staff.followUpsDue} follow-ups due</span>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                No active staff assignments in current records.
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* 5. IN-COCKPIT IMMEDIATE ACTION MODALS */}
      {/* ========================================================================= */}

      {/* Quotation Review & Owner Approval Modal */}
      {quotationModalOpen && viewingQuotation && (
        <QuotationModal
          quotation={viewingQuotation}
          isOpen={quotationModalOpen}
          onClose={() => {
            setQuotationModalOpen(false);
            setViewingQuotation(null);
          }}
          onSaved={() => {
            refreshAllData();
            setQuotationModalOpen(false);
            setViewingQuotation(null);
          }}
          userRole="owner"
          userEmail={userEmail}
        />
      )}

      {/* Follow-Up Edit / Action Modal */}
      {followUpModalOpen && viewingFollowUp && (
        <FollowUpModal
          followUp={viewingFollowUp}
          isOpen={followUpModalOpen}
          onClose={() => {
            setFollowUpModalOpen(false);
            setViewingFollowUp(null);
          }}
          onSaved={() => {
            refreshAllData();
            setFollowUpModalOpen(false);
            setViewingFollowUp(null);
          }}
          userEmail={userEmail}
          companyId={viewingFollowUp?.company_id || officeService.getActiveCompanyId() || undefined}
        />
      )}

    </div>
  );
};
