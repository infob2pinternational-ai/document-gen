import React, { useState, useEffect } from 'react';
import type { Customer, Lead, CrmQuotation, Booking, FollowUp, LeadActivity } from '../types';
import { leadService } from '../services/leadService';
import { officeService } from '../services/officeService';
import { 
  X, 
  MessageSquare, 
  ArrowUpRight
} from 'lucide-react';
import { normalizeIndianPhone } from '../utils/whatsappShare';

interface Customer360ModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenLead?: (leadId: string) => void;
  onOpenQuotation?: (quotationId: string) => void;
  onOpenBooking?: (bookingId: string) => void;
  userEmail?: string;
}

export const Customer360Modal: React.FC<Customer360ModalProps> = ({
  customer,
  isOpen,
  onClose,
  onOpenLead,
  onOpenQuotation: _onOpenQuotation,
  onOpenBooking: _onOpenBooking,
  userEmail: _userEmail
}) => {
  const [activeTab, setActiveTab] = useState<'leads' | 'quotations' | 'bookings' | 'followups' | 'activity'>('leads');
  const [customerLeads, setCustomerLeads] = useState<Lead[]>([]);
  const [customerQuotations, setCustomerQuotations] = useState<CrmQuotation[]>([]);
  const [customerBookings, setCustomerBookings] = useState<Booking[]>([]);
  const [customerFollowUps, setCustomerFollowUps] = useState<FollowUp[]>([]);
  const [customerActivities, setCustomerActivities] = useState<LeadActivity[]>([]);

  useEffect(() => {
    if (customer) {
      const allLeads = leadService.getLeads(customer.company_id).filter(l => 
        (l.customer_id && l.customer_id === customer.id) ||
        l.customer_name.toLowerCase() === customer.name.toLowerCase() ||
        (l.phone && customer.phone && l.phone.replace(/\D/g, '') === customer.phone.replace(/\D/g, ''))
      );
      setCustomerLeads(allLeads);

      const allQuotes = officeService.getQuotations(customer.company_id).filter(q =>
        (q.customer_id && q.customer_id === customer.id) ||
        q.customer_name.toLowerCase() === customer.name.toLowerCase() ||
        allLeads.some(l => l.id === q.lead_id)
      );
      setCustomerQuotations(allQuotes);

      const allBookings = officeService.getBookings().filter(b =>
        ((b.customer_id && b.customer_id === customer.id) ||
        b.customer_name.toLowerCase() === customer.name.toLowerCase() ||
        allLeads.some(l => l.id === b.lead_id)) &&
        (!customer.company_id || !b.company_id || b.company_id === 'default' || b.company_id === customer.company_id)
      );
      setCustomerBookings(allBookings);

      const allFollowUps = officeService.getFollowUps('all', customer.company_id).filter(f =>
        (f.customer_id && f.customer_id === customer.id) ||
        f.customer_name.toLowerCase() === customer.name.toLowerCase() ||
        allLeads.some(l => l.id === f.lead_id)
      );
      setCustomerFollowUps(allFollowUps);

      const acts: LeadActivity[] = [];
      allLeads.forEach(l => {
        acts.push(...leadService.getLeadActivities(l.id));
      });
      acts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setCustomerActivities(acts);
    }
  }, [customer, isOpen]);

  if (!isOpen || !customer) return null;

  const handleWhatsApp = () => {
    const phone = customer.phone;
    if (!phone) return;
    const clean = normalizeIndianPhone(phone);
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(`Hello ${customer.name}, greetings from B2P International!`)}`, '_blank');
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        
        {/* Drawer Header */}
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
              <span className="badge badge-info">
                Customer 360° Profile
              </span>
              {customer.gstin && (
                <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  GST: {customer.gstin}
                </span>
              )}
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              {customer.name}
            </h2>
            {(customer as any).company_name && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                {(customer as any).company_name}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {customer.phone && (
              <button
                type="button"
                onClick={handleWhatsApp}
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
              >
                <MessageSquare size={13} color="#25D366" />
                <span>WhatsApp</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.35rem' }}
              title="Close Profile Drawer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Contact Info Strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.6rem',
          padding: '0.75rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          background: '#f8fafc',
          fontSize: '0.78rem'
        }}>
          {customer.phone && (
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Phone</span>
              <a href={`tel:${customer.phone}`} style={{ color: 'var(--brand-navy)', fontWeight: 600, textDecoration: 'none' }}>
                {customer.phone}
              </a>
            </div>
          )}
          {customer.email && (
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Email</span>
              <span>{customer.email}</span>
            </div>
          )}
          {customer.address && (
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Location / Address</span>
              <span>{customer.address}</span>
            </div>
          )}
        </div>

        {/* 360 Summary Metrics Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(68px, 1fr))',
          gap: '0.45rem',
          padding: '0.75rem 1.35rem',
          borderBottom: '1px solid var(--border-color)',
          background: '#ffffff'
        }}>
          {[
            { key: 'leads', label: 'Leads', count: customerLeads.length },
            { key: 'quotations', label: 'Quotes', count: customerQuotations.length },
            { key: 'bookings', label: 'Bookings', count: customerBookings.length },
            { key: 'followups', label: 'Follow-ups', count: customerFollowUps.length },
            { key: 'activity', label: 'Activity', count: customerActivities.length }
          ].map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as any)}
                style={{
                  padding: '0.4rem 0.25rem',
                  borderRadius: 'var(--radius-sm)',
                  border: isActive ? '1px solid var(--brand-blue)' : '1px solid var(--border-color)',
                  background: isActive ? '#eff6ff' : '#f8fafc',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: isActive ? 'var(--brand-blue)' : 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  {tab.label}
                </div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: isActive ? 'var(--brand-blue)' : 'var(--text-primary)', marginTop: '0.1rem' }}>
                  {tab.count}
                </div>
              </button>
            );
          })}
        </div>

        {/* Drawer Scrollable Body */}
        <div className="drawer-body">
          
          {/* Tab 1: Leads */}
          {activeTab === 'leads' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Lead Inquiries ({customerLeads.length})
              </div>
              {customerLeads.length > 0 ? (
                customerLeads.map(l => (
                  <div 
                    key={l.id} 
                    onClick={() => onOpenLead && onOpenLead(l.id)}
                    className="card"
                    style={{ 
                      padding: '0.75rem 1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: onOpenLead ? 'pointer' : 'default'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <strong className="mono" style={{ color: 'var(--brand-navy)', fontSize: '0.78rem' }}>{l.lead_number}</strong>
                        <strong style={{ fontSize: '0.8125rem' }}>{l.service_required}</strong>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        Location: {l.campaign_location || l.location} · {l.number_of_days || 1}d
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        Status: <code>{l.status}</code> · Priority: <strong>{l.priority}</strong>
                      </div>
                    </div>
                    {onOpenLead && <ArrowUpRight size={15} color="var(--text-muted)" />}
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  No lead records logged for this customer.
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Quotations */}
          {activeTab === 'quotations' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Quotations History ({customerQuotations.length})
              </div>
              {customerQuotations.length > 0 ? (
                customerQuotations.map(q => (
                  <div key={q.id} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <strong className="mono" style={{ color: 'var(--brand-navy)', fontSize: '0.78rem' }}>{q.quotation_number}</strong>
                        <span style={{ fontSize: '0.8125rem' }}>{q.service_required}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Approval: <strong style={{ color: q.approval_status === 'APPROVED' ? 'var(--accent-success)' : '#b45309' }}>{q.approval_status}</strong>
                      </div>
                    </div>
                    <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--brand-navy)' }}>
                      ₹{q.total.toLocaleString('en-IN')}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  No quotations prepared yet.
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Bookings */}
          {activeTab === 'bookings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Fleet & Resource Bookings ({customerBookings.length})
              </div>
              {customerBookings.length > 0 ? (
                customerBookings.map(b => (
                  <div key={b.id} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <strong className="mono" style={{ color: 'var(--brand-navy)', fontSize: '0.78rem' }}>{b.booking_number}</strong>
                        <strong style={{ fontSize: '0.8125rem' }}>{b.resource_name}</strong>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        Dates: {b.start_date} to {b.end_date} · {b.location}
                      </div>
                    </div>
                    <span className="badge badge-success">{b.status}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  No fleet bookings scheduled.
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Follow-ups */}
          {activeTab === 'followups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Follow-up Reminders ({customerFollowUps.length})
              </div>
              {customerFollowUps.length > 0 ? (
                customerFollowUps.map(f => (
                  <div key={f.id} className="card" style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.8125rem' }}>{f.reason}</strong>
                      <span className="badge badge-info">{f.status}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      Due: {f.due_date} at {f.due_time} · Staff: {f.assigned_staff_email.split('@')[0]}
                    </div>
                    {f.completion_note && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--accent-success)', marginTop: '0.2rem' }}>
                        Note: {f.completion_note}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  No follow-up touchpoints recorded.
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Activity History */}
          {activeTab === 'activity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Complete Audit Trail ({customerActivities.length})
              </div>
              {customerActivities.length > 0 ? (
                customerActivities.map(act => (
                  <div key={act.id} style={{ padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--brand-navy)', fontSize: '0.78rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{act.action}</strong>
                      <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>
                        {new Date(act.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    {act.note && <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)' }}>{act.note}</p>}
                  </div>
                ))
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  No activity history logged.
                </div>
              )}
            </div>
          )}

        </div>

        {/* Drawer Footer */}
        <div className="drawer-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ fontSize: '0.8125rem' }}
          >
            Close Profile
          </button>
        </div>

      </div>
    </div>
  );
};
