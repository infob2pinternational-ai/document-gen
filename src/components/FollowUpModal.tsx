import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FollowUp, Lead } from '../types';
import { X, Clock, CheckCircle2, Trash2 } from 'lucide-react';
import { officeService } from '../services/officeService';
import { leadService } from '../services/leadService';
import { formatStaffDisplayName, getAvailableStaffList } from '../utils/staffUtils';
import { getKolkataToday } from '../utils/dateUtils';

interface FollowUpModalProps {
  followUp: FollowUp | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (followUp: FollowUp) => void;
  onDeleted?: (id: string) => void;
  prefilledLead?: Lead | null;
  userEmail: string;
  companyId?: string;
}

export const FollowUpModal: React.FC<FollowUpModalProps> = ({
  followUp,
  isOpen,
  onClose,
  onSaved,
  onDeleted,
  prefilledLead,
  userEmail,
  companyId
}) => {
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [assignedStaff, setAssignedStaff] = useState(userEmail || '');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('11:00');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionNote, setCompletionNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const allLeads = leadService.getLeads(companyId);

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, allLeads, officeService.getFollowUps('all', companyId));
  }, [userEmail, isOpen, companyId]);

  const prevOpenRef = useRef(false);
  const prevTargetRef = useRef<string | null>(null);
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      prevOpenRef.current = false;
      saveInProgressRef.current = false;
      setIsSaving(false);
      return;
    }

    const currentTargetId = followUp?.id || prefilledLead?.id || 'new';
    const justOpened = !prevOpenRef.current && isOpen;
    const targetChanged = prevTargetRef.current !== currentTargetId;
    prevOpenRef.current = isOpen;
    prevTargetRef.current = currentTargetId;

    if (!justOpened && !targetChanged) {
      return;
    }

    if (followUp) {
      setCustomerName(followUp.customer_name);
      setCompanyName(followUp.company_name || '');
      setPhone(followUp.phone || '');
      setSelectedLeadId(followUp.lead_id || '');
      setAssignedStaff(followUp.assigned_staff_email || userEmail || '');
      setDueDate(followUp.due_date);
      setDueTime(followUp.due_time || '11:00');
      setReason(followUp.reason);
      setNotes(followUp.notes || '');
      setIsCompleting(false);
      setCompletionNote(followUp.completion_note || '');
    } else if (prefilledLead) {
      setCustomerName(prefilledLead.customer_name);
      setCompanyName(prefilledLead.company_name || '');
      setPhone(prefilledLead.phone || '');
      setSelectedLeadId(prefilledLead.id);
      setAssignedStaff(prefilledLead.assigned_telecaller_email || userEmail || '');
      setDueDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86400000)));
      setDueTime('11:00');
      setReason(`Follow up on ${prefilledLead.service_required || 'campaign inquiry'}`);
      setNotes('');
      setIsCompleting(false);
      setCompletionNote('');
    } else {
      setCustomerName('');
      setCompanyName('');
      setPhone('');
      setSelectedLeadId('');
      setAssignedStaff(userEmail || '');
      setDueDate(getKolkataToday());
      setDueTime('11:00');
      setReason('');
      setNotes('');
      setIsCompleting(false);
      setCompletionNote('');
    }
  }, [followUp, prefilledLead, userEmail, isOpen]);

  if (!isOpen) return null;

  const handleLeadSelect = (leadId: string) => {
    setSelectedLeadId(leadId);
    const found = allLeads.find(l => l.id === leadId);
    if (found) {
      setCustomerName(found.customer_name);
      setCompanyName(found.company_name || '');
      setPhone(found.phone || '');
      if (!reason) {
        setReason(`Follow up on ${found.service_required || 'requirement'}`);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saveInProgressRef.current) return;

    if (!customerName.trim()) {
      alert('Please enter a Customer Name.');
      return;
    }
    if (!reason.trim()) {
      alert('Please specify the Follow-up Reason.');
      return;
    }
    if (!dueDate) {
      alert('Please specify Due Date.');
      return;
    }

    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setIsSaving(true);

    try {
      if (isCompleting && followUp) {
        const completed = await officeService.completeFollowUp(followUp.id, completionNote, userEmail);
        if (completed) onSaved(completed);
        onClose();
        return;
      }

      const linkedLead = allLeads.find(l => l.id === selectedLeadId);

      // Resolve target company ID:
      // When EDITING an existing follow-up, strictly preserve its existing company_id.
      // When creating a NEW follow-up, resolve from props / prefilled lead / linked lead / active company.
      const resolvedCompanyId = followUp
        ? (followUp.company_id || companyId || officeService.getActiveCompanyId() || undefined)
        : (companyId || prefilledLead?.company_id || linkedLead?.company_id || officeService.getActiveCompanyId() || undefined);

      if (!followUp && (!resolvedCompanyId || resolvedCompanyId === 'default')) {
        alert('Please select or activate a company profile before scheduling a follow-up.');
        return;
      }

      const saved = await officeService.saveFollowUp({
        id: followUp?.id,
        company_id: resolvedCompanyId,
        lead_id: selectedLeadId || undefined,
        lead_number: linkedLead?.lead_number,
        customer_name: customerName.trim(),
        company_name: companyName.trim() || undefined,
        phone: phone.trim() || undefined,
        assigned_staff_email: assignedStaff,
        due_date: dueDate,
        due_time: dueTime,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
        status: followUp?.status || 'PENDING'
      }, userEmail);

      onSaved(saved);
      onClose();
    } catch (err: any) {
      console.error('[FollowUpModal] Save follow up failed:', err);
      alert('Failed to save follow-up: ' + (err?.message || 'Unknown error occurred.'));
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalElement = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', width: '95%', margin: 'auto' }}>
        
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={16} color="var(--brand-navy)" />
              <span>{isCompleting ? 'Complete Follow-up Call' : followUp ? 'Edit Follow-up Task' : 'Schedule Client Follow-up'}</span>
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.15rem 0 0 0' }}>
              Schedule timely client callbacks and conversation milestones.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {isCompleting ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem' }}>
                <strong>Customer:</strong> {followUp?.customer_name} ({followUp?.phone})<br />
                <strong>Scheduled Reason:</strong> {followUp?.reason}
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Call Outcome & Conversation Summary *</label>
                <textarea
                  required
                  rows={4}
                  placeholder="e.g. Spoke with client. Confirmed budget and requested revised quote with sound system."
                  value={completionNote}
                  onChange={(e) => setCompletionNote(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Link to Lead Inquiry (Optional)</label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => handleLeadSelect(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                >
                  <option value="">-- Standalone / General Follow-up --</option>
                  {allLeads.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lead_number || l.id} · {l.customer_name} ({l.service_required || 'Lead'})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Arun Kumar"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Company Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Kerala Grand Events"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Contact Phone</label>
                  <input
                    type="tel"
                    placeholder="9847012345"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Assigned Staff</label>
                  <select
                    value={assignedStaff}
                    onChange={(e) => setAssignedStaff(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  >
                    {availableStaff.map(s => (
                      <option key={s.email} value={s.email}>{s.label}</option>
                    ))}
                    {assignedStaff && !availableStaff.some(s => s.email === assignedStaff) && (
                      <option value={assignedStaff}>{formatStaffDisplayName(assignedStaff)} ({assignedStaff})</option>
                    )}
                    <option value="">Unassigned</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Follow-up Date *</label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Time</label>
                  <input
                    type="time"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Reason / Purpose *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Review quotation details & confirm dates"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Preparation Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Points to discuss during call..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>
            </>
          )}

          {/* Modal Actions Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '0.85rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {followUp && !isCompleting && followUp.status === 'PENDING' && (
                <button
                  type="button"
                  onClick={() => setIsCompleting(true)}
                  className="btn-secondary"
                  style={{ color: '#16a34a', borderColor: '#bbf7d0', fontSize: '0.78rem' }}
                >
                  <CheckCircle2 size={13} />
                  <span>Mark as Done</span>
                </button>
              )}
              {followUp && (
                <button
                  type="button"
                  onClick={async () => {
                    const label = followUp.customer_name ? `${followUp.customer_name} (${followUp.reason})` : followUp.reason;
                    if (window.confirm(`Are you sure you want to delete this follow-up for "${label}"? This action cannot be undone.`)) {
                      try {
                        await officeService.deleteFollowUp(followUp.id);
                        if (onDeleted) onDeleted(followUp.id);
                        onClose();
                      } catch (err: any) {
                        alert(err.message || 'Failed to delete follow-up.');
                      }
                    }
                  }}
                  className="btn-secondary"
                  style={{ color: '#dc2626', borderColor: '#fca5a5', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  title="Delete this follow-up task"
                >
                  <Trash2 size={13} />
                  <span>Delete Follow-up</span>
                </button>
              )}
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button type="button" onClick={onClose} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary"
                style={{
                  fontSize: '0.8125rem',
                  padding: '0.45rem 1.25rem',
                  opacity: isSaving ? 0.7 : 1,
                  cursor: isSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {isSaving ? 'Saving...' : isCompleting ? 'Log Outcome & Complete' : followUp ? 'Update Task' : 'Save Task'}
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalElement, document.body);
  }
  return modalElement;
};
