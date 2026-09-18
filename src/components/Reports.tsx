import React, { useState, useEffect, useMemo } from 'react';
import type { Lead, CrmQuotation, LeadSource } from '../types';
import { leadService } from '../services/leadService';
import { officeService } from '../services/officeService';
import { metricsService } from '../services/metricsService';
import { getAvailableStaffList } from '../utils/staffUtils';
import { 
  BarChart3, 
  Users
} from 'lucide-react';

interface ReportsProps {
  userRole?: string;
  userEmail?: string;
}

export const Reports: React.FC<ReportsProps> = ({
  userRole = 'owner',
  userEmail = 'owner@b2p.com'
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [quotations, setQuotations] = useState<CrmQuotation[]>([]);
  const [staffFilter, setStaffFilter] = useState<string>(userRole === 'telecaller' ? userEmail : 'all');
  const isRestrictedStaff = userRole === 'telecaller';

  const refreshAll = () => {
    setLeads(leadService.getLeads());
    setQuotations(officeService.getQuotations());
  };

  useEffect(() => {
    setStaffFilter(isRestrictedStaff ? userEmail : 'all');
  }, [isRestrictedStaff, userEmail]);

  useEffect(() => {
    refreshAll();
    const unsub = metricsService.subscribe(refreshAll);
    return unsub;
  }, []);

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, leads);
  }, [userEmail, leads]);

  const scopedLeads = staffFilter === 'all'
    ? leads
    : leads.filter(l => (l.assigned_telecaller_email || '').toLowerCase().trim() === staffFilter.toLowerCase().trim());

  // 1. Source Breakdown
  const sources: LeadSource[] = [
    'instagram',
    'facebook',
    'whatsapp_bulk',
    'website',
    'phone',
    'existing_customer',
    'referral',
    'bulk_email',
    'other'
  ];

  const sourceData = sources.map(src => {
    const matching = scopedLeads.filter(l => l.lead_source === src);
    const confirmed = matching.filter(l => l.status === 'confirmed').length;
    return {
      source: src.replace(/_/g, ' '),
      count: matching.length,
      confirmed,
      percentage: scopedLeads.length > 0 ? Math.round((matching.length / scopedLeads.length) * 100) : 0
    };
  }).sort((a, b) => b.count - a.count);

  // 2. Priority Breakdown
  const hotCount = scopedLeads.filter(l => l.priority === 'HOT').length;
  const warmCount = scopedLeads.filter(l => l.priority === 'WARM').length;
  const coldCount = scopedLeads.filter(l => l.priority === 'COLD').length;

  // 3. Central Telecaller Metrics from metricsService
  const telecallerData = metricsService.getTelecallerMetrics(staffFilter === 'all' ? undefined : staffFilter);

  // 4. Quotation Financial Conversion
  const totalQuotedValue = quotations.reduce((sum, q) => sum + (q.total || 0), 0);
  const approvedQuotedValue = quotations.filter(q => q.approval_status === 'APPROVED' || q.approval_status === 'SENT').reduce((sum, q) => sum + (q.total || 0), 0);
  const confirmedJobs = scopedLeads.filter(l => l.status === 'confirmed').length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Operational & Conversion Analytics
            </h1>
            <span className="badge badge-neutral">
              Executive View
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Cross-departmental telemetry on inquiry channels, conversion rates, and staff velocity.
          </p>
        </div>

        {!isRestrictedStaff && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>STAFF SCOPE:</span>
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', minWidth: '220px' }}
            >
              <option value="all">All Telecallers & Staff</option>
              {availableStaff.map(s => (
                <option key={s.email} value={s.email}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Financial Conversion KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Quoted Value</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--brand-blue)', marginTop: '0.15rem' }}>
            ₹{totalQuotedValue.toLocaleString('en-IN')}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Across {quotations.length} formal proposals</span>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Owner Approved Value</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981', marginTop: '0.15rem' }}>
            ₹{approvedQuotedValue.toLocaleString('en-IN')}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ready for client dispatch</span>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Lead-to-Quote Velocity</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#d97706', marginTop: '0.15rem' }}>
            {scopedLeads.length > 0 ? Math.round((quotations.length / scopedLeads.length) * 100) : 0}%
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Inquiries reaching quotation stage</span>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Confirmed Deals</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8b5cf6', marginTop: '0.15rem' }}>
            {confirmedJobs} Deals
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Campaigns booked in calendar</span>
        </div>
      </div>

      {/* 2-Column: Leads By Source + Priority Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        
        {/* Leads By Source */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
              <BarChart3 size={16} color="var(--brand-blue)" />
              <span>Inquiry Volume by Channel Source</span>
            </h3>
            <span className="badge badge-neutral">Total: {leads.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.25rem' }}>
            {sourceData.filter(s => s.count > 0).map(s => (
              <div key={s.source} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                  <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--text-primary)' }}>{s.source}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong>{s.count}</strong> inquiries ({s.percentage}%) · <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>{s.confirmed} won</span>
                  </span>
                </div>
                <div style={{ width: '100%', height: '6px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${s.percentage}%`,
                    height: '100%',
                    background: 'var(--brand-blue)',
                    borderRadius: '999px',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Health */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
            <span className="status-dot status-dot-danger" style={{ width: '8px', height: '8px' }} />
            <span>Lead Urgency & Priority Mix</span>
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.25rem' }}>
            <div style={{ background: '#fef2f2', borderLeft: '3px solid #dc2626', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: '#dc2626', fontSize: '0.8125rem' }}>HOT PRIORITY</strong>
                <span className="mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#dc2626' }}>{hotCount}</span>
              </div>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Urgent event date within 7 days. Immediate pricing & vehicle lock required.
              </p>
            </div>

            <div style={{ background: '#fffbeb', borderLeft: '3px solid #d97706', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: '#d97706', fontSize: '0.8125rem' }}>WARM PRIORITY</strong>
                <span className="mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#d97706' }}>{warmCount}</span>
              </div>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Planning campaign for next month. Regular follow-up cadence scheduled.
              </p>
            </div>

            <div style={{ background: '#eff6ff', borderLeft: '3px solid #2563eb', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: '#2563eb', fontSize: '0.8125rem' }}>COLD PRIORITY</strong>
                <span className="mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#2563eb' }}>{coldCount}</span>
              </div>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                General pricing inquiry or future festival season campaigns.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Telecaller Performance Matrix */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
            <Users size={16} color="var(--brand-blue)" />
            <span>Telecaller & Staff Performance Matrix</span>
          </h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Computed in real-time from centralized metricsPubSub
          </span>
        </div>

        <div className="table-container animate-fade-in">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: '150px' }}>Telecaller</th>
                <th style={{ minWidth: '85px' }}>Assigned</th>
                <th style={{ minWidth: '75px' }}>New</th>
                <th style={{ minWidth: '85px' }}>Working</th>
                <th style={{ minWidth: '110px' }}>Req Collected</th>
                <th style={{ minWidth: '110px' }}>Sent to Admin</th>
                <th style={{ minWidth: '120px' }}>Follow-ups Due</th>
                <th style={{ minWidth: '90px' }}>Confirmed</th>
                <th style={{ minWidth: '75px' }}>Lost</th>
                <th style={{ minWidth: '95px' }}>Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {telecallerData.map(tc => {
                return (
                  <tr key={tc.email}>
                    <td>
                      <strong>{tc.name}</strong>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{tc.email}</div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{tc.assignedLeads}</td>
                    <td className="mono" style={{ color: '#2563eb' }}>{tc.newLeads}</td>
                    <td className="mono" style={{ color: '#4f46e5' }}>{tc.working}</td>
                    <td className="mono" style={{ color: '#d97706' }}>{tc.requirementsCollected}</td>
                    <td className="mono" style={{ color: '#7c3aed', fontWeight: 600 }}>{tc.sentToAdmin}</td>
                    <td className="mono" style={{ color: tc.followUpsDue > 0 ? '#dc2626' : 'inherit', fontWeight: tc.followUpsDue > 0 ? 700 : 400 }}>
                      {tc.followUpsDue}
                    </td>
                    <td className="mono" style={{ color: 'var(--accent-success)', fontWeight: 700 }}>{tc.confirmed}</td>
                    <td className="mono" style={{ color: 'var(--accent-danger)' }}>{tc.lost}</td>
                    <td>
                      <span className={`badge ${tc.conversionRate > 20 ? 'badge-success' : 'badge-info'}`}>
                        {tc.conversionRate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
