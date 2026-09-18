import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lead, LeadActivity, LeadStatus } from '../types';
import { 
  X, 
  Phone, 
  MessageSquare, 
  Send, 
  Clock, 
  Edit, 
  Plus,
  FileText,
  Calendar,
  User,
  Briefcase,
  Layers,
  ChevronRight
} from 'lucide-react';
import { leadService } from '../services/leadService';
import { officeService } from '../services/officeService';
import { formatStaffDisplayName } from '../utils/staffUtils';
import { normalizeIndianPhone } from '../utils/whatsappShare';
import { FollowUpModal } from './FollowUpModal';
import { QuotationModal } from './QuotationModal';
import { BookingModal } from './BookingModal';

interface LeadDetailModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onUpdated: (lead: Lead) => void;
  userEmail: string;
  userRole?: string;
}

const PIPELINE_STAGES: { key: LeadStatus; label: string; stepNumber: number }[] = [
  { key: 'new', label: 'New lead', stepNumber: 1 },
  { key: 'telecaller_working', label: 'Calling', stepNumber: 2 },
  { key: 'requirement_collected', label: 'Details collected', stepNumber: 3 },
  { key: 'sent_to_admin', label: 'Sent to admin', stepNumber: 4 },
  { key: 'quotation_preparing', label: 'Quotation preparing', stepNumber: 5 },
  { key: 'waiting_owner_approval', label: 'Waiting owner approval', stepNumber: 6 },
  { key: 'quotation_sent', label: 'Quotation sent', stepNumber: 7 },
  { key: 'follow_up', label: 'Follow-up', stepNumber: 8 },
  { key: 'confirmed', label: 'Confirmed', stepNumber: 9 },
  { key: 'owner_handover', label: 'Owner handover', stepNumber: 10 },
  { key: 'future', label: 'Future lead', stepNumber: 11 },
  { key: 'lost', label: 'Lost', stepNumber: 12 }
];

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  lead,
  isOpen,
  onClose,
  onEdit,
  onUpdated,
  userEmail,
  userRole = 'telecaller'
}) => {
  const [newActivityNote, setNewActivityNote] = useState('');
  const [showHandoverPrompt, setShowHandoverPrompt] = useState(false);
  const [handoverNote, setHandoverNote] = useState('');

  // Sub-modal states
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  if (!isOpen || !lead) return null;

  const activities: LeadActivity[] = leadService.getLeadActivities(lead.id);
  const pendingFollowUps = officeService.getFollowUps('all').filter(f => f.lead_id === lead.id && f.status === 'PENDING');
  const nextFollowUp = pendingFollowUps.length > 0 ? pendingFollowUps[0] : null;

  const handleStatusChange = async (newStatus: LeadStatus) => {
    const updated = await leadService.updateLeadStatus(lead.id, newStatus, userEmail);
    if (updated) onUpdated(updated);
  };

  const handleSendToAdminSubmit = async () => {
    const res = await leadService.sendToAdmin(lead.id, userEmail, handoverNote);
    if (!res.success) {
      alert(res.error || 'Failed to send to Admin.');
      return;
    }
    setShowHandoverPrompt(false);
    setHandoverNote('');
    if (res.lead) onUpdated(res.lead);
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActivityNote.trim()) return;

    await leadService.addLeadActivity({
      lead_id: lead.id,
      company_id: lead.company_id,
      user_email: userEmail,
      action: 'Note Logged',
      previous_status: lead.status,
      new_status: lead.status,
      note: newActivityNote.trim()
    });

    setNewActivityNote('');
    const current = leadService.getLeadById(lead.id);
    if (current) onUpdated(current);
  };

  const handleWhatsAppOpen = () => {
    if (!lead.whatsapp_number && !lead.phone) return;
    const rawNumber = lead.whatsapp_number || lead.phone;
    const cleanPhone = normalizeIndianPhone(rawNumber);
    const msg = `Hello ${lead.customer_name}, thank you for contacting B2P International regarding ${lead.service_required || 'our advertising services'}. How may we assist you today?`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const currentStageIndex = PIPELINE_STAGES.findIndex(s => s.key === lead.status);

  if (!isOpen || !lead) return null;

  const drawerElement = (
    <div className="drawer-overlay" onClick={onClose} style={{ zIndex: 1900 }}>
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        
        {/* 1. Fixed Drawer Header */}
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
              <span className="mono" style={{ 
                fontWeight: 700, 
                fontSize: '0.8125rem', 
                color: 'var(--brand-blue)', 
                background: '#eff6ff', 
                padding: '0.15rem 0.55rem', 
                borderRadius: '6px', 
                border: '1px solid rgba(37, 99, 235, 0.2)' 
              }}>
                {lead.lead_number || lead.id}
              </span>

              <span className={`badge ${lead.priority === 'HOT' ? 'priority-pill-hot' : lead.priority === 'WARM' ? 'priority-pill-warm' : 'priority-pill-cold'}`}>
                {lead.priority} Priority
              </span>

              <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>
                <span className="status-dot status-dot-info" style={{ width: '6px', height: '6px' }} />
                <span>{lead.status.replace(/_/g, ' ')}</span>
              </span>
            </div>

            <h2 style={{ 
              fontSize: '1.25rem', 
              fontWeight: 800, 
              color: '#0f172a', 
              letterSpacing: '-0.02em', 
              margin: 0,
              lineHeight: 1.25,
              wordBreak: 'break-word'
            }}>
              {lead.customer_name}
            </h2>

            {lead.company_name && (
              <div style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500, marginTop: '0.15rem' }}>
                {lead.company_name}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
            <button
              onClick={() => onEdit(lead)}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem', gap: '0.35rem' }}
            >
              <Edit size={13} />
              <span>Edit</span>
            </button>
            <button
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.4rem', borderRadius: '8px' }}
              title="Close Drawer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 2. Horizontally Scrollable Lead Progress Stepper */}
        <div className="pipeline-track">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <div>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', color: '#64748b', textTransform: 'uppercase' }}>
                Lead Progress
              </span>
              <div style={{ fontSize: '0.6875rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                Shows the current step for this enquiry. Click a step only when you want to update the lead status.
              </div>
            </div>
            <span style={{ fontSize: '0.6875rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
              Scroll →
            </span>
          </div>

          <div className="pipeline-stepper">
            {PIPELINE_STAGES.map((stg, idx) => {
              const isCurrent = stg.key === lead.status;
              const isPast = currentStageIndex > idx;

              return (
                <button
                  key={stg.key}
                  type="button"
                  className={`pipeline-step ${isCurrent ? 'active' : isPast ? 'completed' : ''}`}
                  onClick={() => handleStatusChange(stg.key)}
                  title={`Click to set stage to ${stg.label}`}
                >
                  <span>{stg.label}</span>
                  {idx < PIPELINE_STAGES.length - 1 && (
                    <ChevronRight size={11} style={{ opacity: isCurrent ? 0.8 : 0.4, marginLeft: '0.15rem' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Quick Action Toolbar */}
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          padding: '0.65rem 1.35rem',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
          flexShrink: 0
        }}>
          <a
            href={`tel:${lead.phone}`}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem', textDecoration: 'none' }}
          >
            <Phone size={13} color="#10b981" />
            <span>Call</span>
          </a>

          <button
            type="button"
            onClick={handleWhatsAppOpen}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}
          >
            <MessageSquare size={13} color="#25D366" />
            <span>WhatsApp</span>
          </button>

          {lead.status !== 'sent_to_admin' && lead.status !== 'quotation_preparing' && lead.status !== 'waiting_owner_approval' && (
            <button
              type="button"
              onClick={() => setShowHandoverPrompt(true)}
              className="btn-primary"
              style={{ fontSize: '0.78rem', padding: '0.38rem 0.85rem' }}
            >
              <Send size={13} />
              <span>Send to Admin</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setFollowUpModalOpen(true)}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}
          >
            <Clock size={13} color="#f59e0b" />
            <span>+ Follow-up</span>
          </button>

          <button
            type="button"
            onClick={() => setQuotationModalOpen(true)}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}
          >
            <FileText size={13} color="var(--brand-blue)" />
            <span>Quotation</span>
          </button>

          <button
            type="button"
            onClick={() => setBookingModalOpen(true)}
            className="btn-secondary"
            style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}
          >
            <Calendar size={13} color="#8b5cf6" />
            <span>Fleet Slot</span>
          </button>
        </div>

        {/* 4. Scrollable Drawer Body with Solid Contrast Cards */}
        <div className="drawer-body">
          
          {/* Handover to Admin confirmation prompt banner */}
          {showHandoverPrompt && (
            <div style={{
              background: '#f5f3ff',
              border: '1px solid #c4b5fd',
              borderRadius: '10px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Send size={14} /> Handover Requirement to Admin for Quotation
              </div>
              <p style={{ fontSize: '0.78rem', color: '#4b5563', margin: 0, lineHeight: 1.4 }}>
                This will update status to <strong>sent_to_admin</strong> and notify Admin to prepare the official quotation.
              </p>
              <textarea
                rows={2}
                placeholder="Specific instructions for admin (e.g. 3-day LED Van campaign in Thrissur, client requested sound system)..."
                value={handoverNote}
                onChange={(e) => setHandoverNote(e.target.value)}
                style={{ fontSize: '0.8125rem', marginTop: '0.25rem', background: '#ffffff' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => setShowHandoverPrompt(false)}
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendToAdminSubmit}
                  className="btn-primary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.85rem', background: '#7c3aed', borderColor: '#7c3aed' }}
                >
                  Confirm & Transfer
                </button>
              </div>
            </div>
          )}

          {/* Section 1: Customer Information (Clean 2-Column Grid) */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '1.15rem 1.25rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
          }}>
            <div style={{ 
              fontSize: '0.72rem', 
              fontWeight: 700, 
              letterSpacing: '0.05em', 
              textTransform: 'uppercase', 
              color: '#64748b', 
              marginBottom: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}>
              <User size={14} color="var(--brand-blue)" />
              <span>Customer Information</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem 1rem' }}>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Contact Name
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a' }}>
                  {lead.customer_name}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Company / Entity
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: lead.company_name ? '#0f172a' : '#94a3b8' }}>
                  {lead.company_name || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Phone Number
                </span>
                <a href={`tel:${lead.phone}`} style={{ fontSize: '0.875rem', color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 700 }}>
                  {lead.phone}
                </a>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  WhatsApp Number
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {lead.whatsapp_number || lead.phone || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  District / City
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: lead.location ? '#0f172a' : '#94a3b8' }}>
                  {lead.location || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Business Type
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: lead.business_type ? '#0f172a' : '#94a3b8' }}>
                  {lead.business_type || '—'}
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Lead Acquisition Channel
                </span>
                <div style={{ fontSize: '0.8125rem', color: '#334155', fontWeight: 600, textTransform: 'capitalize' }}>
                  {lead.lead_source ? lead.lead_source.replace(/_/g, ' ') : 'Direct Call'} {lead.source_details ? `(${lead.source_details})` : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Requirement Specifications Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '1.15rem 1.25rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
          }}>
            <div style={{ 
              fontSize: '0.72rem', 
              fontWeight: 700, 
              letterSpacing: '0.05em', 
              textTransform: 'uppercase', 
              color: '#64748b', 
              marginBottom: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}>
              <Briefcase size={14} color="var(--brand-blue)" />
              <span>Requirement Specifications</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem 1rem' }}>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Service Required
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a' }}>
                  {lead.service_required || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Service / Vehicle Type
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: lead.vehicle_service_type ? '#0f172a' : '#94a3b8' }}>
                  {lead.vehicle_service_type || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Campaign Location
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {lead.campaign_location || lead.location || '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Target Event Date
                </span>
                <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {lead.required_date ? lead.required_date.split('-').reverse().join('/') : 'TBD'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Campaign Duration
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                  {lead.number_of_days ? `${lead.number_of_days} Day(s)` : '—'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Assigned Staff
                </span>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                  {lead.assigned_telecaller_email ? `${formatStaffDisplayName(lead.assigned_telecaller_email)} (${lead.assigned_telecaller_email})` : 'Unassigned'}
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', display: 'block', marginBottom: '0.15rem' }}>
                  Next Follow-up Scheduled
                </span>
                <div style={{ fontSize: '0.8125rem', color: nextFollowUp ? '#d97706' : '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Clock size={13} />
                  <span>
                    {nextFollowUp 
                      ? `${nextFollowUp.due_date} at ${nextFollowUp.due_time || '10:00 AM'} (${nextFollowUp.reason || 'Follow-up'})` 
                      : 'No pending follow-up scheduled.'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Notes / Remarks (Full Width Card) */}
          {lead.notes && (
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.15rem 1.25rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
            }}>
              <div style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                letterSpacing: '0.05em', 
                textTransform: 'uppercase', 
                color: '#64748b', 
                marginBottom: '0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}>
                <Layers size={14} color="var(--brand-blue)" />
                <span>Special Instructions & Remarks</span>
              </div>
              <div style={{
                background: '#f8fafc',
                borderLeft: '3px solid var(--brand-blue)',
                borderRadius: '6px',
                padding: '0.85rem 1rem',
                fontSize: '0.85rem',
                lineHeight: 1.5,
                color: '#1e293b',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {lead.notes}
              </div>
            </div>
          )}

          {/* Section 4: Append-Only Activity Timeline */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '1.15rem 1.25rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                letterSpacing: '0.05em', 
                textTransform: 'uppercase', 
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}>
                <Clock size={14} color="var(--brand-blue)" />
                <span>Activity & Conversation Logs ({activities.length})</span>
              </div>
              <span style={{ fontSize: '0.6875rem', color: '#94a3b8', fontWeight: 600 }}>
                Append-only audit trail
              </span>
            </div>

            {/* Quick Add Note Form */}
            <form onSubmit={handleAddNoteSubmit} style={{ display: 'flex', gap: '0.45rem' }}>
              <input
                type="text"
                placeholder="Log customer conversation, call outcome, or update..."
                value={newActivityNote}
                onChange={(e) => setNewActivityNote(e.target.value)}
                style={{ flex: 1, fontSize: '0.8125rem', background: '#f8fafc' }}
              />
              <button
                type="submit"
                className="btn-primary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.85rem', whiteSpace: 'nowrap' }}
              >
                <Plus size={14} />
                <span>Add Note</span>
              </button>
            </form>

            {/* Timeline Stream */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '320px', overflowY: 'auto' }}>
              {activities.length > 0 ? (
                activities.map(act => (
                  <div
                    key={act.id}
                    style={{
                      background: '#f8fafc',
                      borderLeft: '3px solid var(--brand-blue)',
                      borderRadius: '8px',
                      padding: '0.65rem 0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.2rem',
                      border: '1px solid #f1f5f9',
                      borderLeftWidth: '3px',
                      borderLeftColor: 'var(--brand-blue)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#0f172a' }}>
                        {act.action}
                      </span>
                      <span className="mono" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                        {new Date(act.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      Logged by <strong style={{ color: '#334155' }}>{act.user_email.split('@')[0]}</strong>
                    </div>
                    {act.note && (
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: '#334155', lineHeight: 1.45, wordBreak: 'break-word' }}>
                        {act.note}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.8125rem' }}>
                  No activity records logged yet. Use the field above to record a note.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* 5. Fixed Drawer Footer */}
        <div className="drawer-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ fontSize: '0.8125rem', padding: '0.45rem 1rem' }}
          >
            Close Drawer
          </button>
        </div>

        {/* Connected Modals */}
        {followUpModalOpen && (
          <FollowUpModal
            followUp={null}
            prefilledLead={lead}
            isOpen={followUpModalOpen}
            onClose={() => setFollowUpModalOpen(false)}
            onSaved={() => {
              const updated = leadService.getLeadById(lead.id);
              if (updated) onUpdated(updated);
              setFollowUpModalOpen(false);
            }}
            userEmail={userEmail}
          />
        )}

        {quotationModalOpen && (
          <QuotationModal
            quotation={officeService.getQuotationByLeadId(lead.id)}
            linkedLead={lead}
            isOpen={quotationModalOpen}
            onClose={() => setQuotationModalOpen(false)}
            onSaved={() => {
              const updated = leadService.getLeadById(lead.id);
              if (updated) onUpdated(updated);
              setQuotationModalOpen(false);
            }}
            userRole={userRole as any}
            userEmail={userEmail}
          />
        )}

        {bookingModalOpen && (
          <BookingModal
            booking={null}
            prefilledLead={lead}
            isOpen={bookingModalOpen}
            onClose={() => setBookingModalOpen(false)}
            onSaved={() => {
              const updated = leadService.getLeadById(lead.id);
              if (updated) onUpdated(updated);
              setBookingModalOpen(false);
            }}
            userEmail={userEmail}
          />
        )}

      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(drawerElement, document.body);
  }
  return drawerElement;
};
