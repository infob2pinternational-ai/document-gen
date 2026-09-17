import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Lead, CallOutcome } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { 
  X, 
  Phone, 
  PhoneCall, 
  Calendar, 
  ArrowRight,
  AlertCircle,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { getIstTodayDateStr } from '../../utils/dateUtils';
import { generateUUID } from '../../utils/uuid';

interface CallEntryModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updatedLead: Lead, nextCallRequested?: boolean) => void;
  telecallerEmail: string;
}

const OUTCOMES: { value: CallOutcome; label: string; color: string; category: 'positive' | 'neutral' | 'negative' | 'action' }[] = [
  { value: 'Connected', label: 'Connected', color: '#10b981', category: 'positive' },
  { value: 'Interested', label: 'Interested', color: '#059669', category: 'positive' },
  { value: 'Requirement Collected', label: 'Req Collected', color: '#d97706', category: 'positive' },
  { value: 'Appointment Confirmed', label: 'Appt Confirmed', color: '#2563eb', category: 'positive' },
  { value: 'Meeting Scheduled', label: 'Meeting Scheduled', color: '#4f46e5', category: 'positive' },
  { value: 'Call Back', label: 'Call Back', color: '#f59e0b', category: 'action' },
  { value: 'Follow-up Required', label: 'Follow-up Needed', color: '#ea580c', category: 'action' },
  { value: 'Details Sent', label: 'Details Sent', color: '#0284c7', category: 'positive' },
  { value: 'Contact Person Needed', label: 'Contact Needed', color: '#7c3aed', category: 'action' },
  { value: 'Existing Agency', label: 'Existing Agency', color: '#64748b', category: 'neutral' },
  { value: 'No Answer', label: 'No Answer', color: '#64748b', category: 'neutral' },
  { value: 'No Response', label: 'No Response', color: '#64748b', category: 'neutral' },
  { value: 'Not Reachable', label: 'Not Reachable', color: '#64748b', category: 'neutral' },
  { value: 'Switched Off', label: 'Switched Off', color: '#64748b', category: 'neutral' },
  { value: 'Invalid Number', label: 'Invalid Number', color: '#dc2626', category: 'negative' },
  { value: 'Not Interested', label: 'Not Interested', color: '#ef4444', category: 'negative' },
  { value: 'Other', label: 'Other', color: '#475569', category: 'neutral' }
];

const QUICK_REMARK_TAGS = [
  'Spoke with owner',
  'Asked to send details on WhatsApp',
  'Call back next week',
  'Owner out of station',
  'Busy, asked to call later today',
  'Interested in LED van advertising',
  'Interested in Lookwalker campaign',
  'Budget too high',
  'Using another marketing agency',
  'Wrong person, contact number requested'
];

export const CallEntryModal: React.FC<CallEntryModalProps> = ({
  lead,
  isOpen,
  onClose,
  onSaved,
  telecallerEmail
}) => {
  const [outcome, setOutcome] = useState<CallOutcome>('Connected');
  const [remarks, setRemarks] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [serviceRequired, setServiceRequired] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('11:00');
  const [followUpReason, setFollowUpReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [retryingFollowUp, setRetryingFollowUp] = useState(false);
  const [savedLeadState, setSavedLeadState] = useState<Lead | null>(null);
  const [submissionToken, setSubmissionToken] = useState<string>(() => generateUUID());

  useEffect(() => {
    if (lead) {
      setOutcome(lead.last_call_outcome as CallOutcome || 'Connected');
      setRemarks('');
      setContactPerson(lead.customer_name || '');
      setAlternatePhone(lead.alternate_phone || '');
      setEmail(lead.email || '');
      setLocation(lead.location || '');
      setServiceRequired(lead.service_required || '');
      setShowFollowUp(false);
      setFollowUpDate('');
      setFollowUpTime('11:00');
      setFollowUpReason('');
      setSaveError(null);
      setFollowUpError(null);
      setRetryingFollowUp(false);
      setSavedLeadState(null);
      setSubmissionToken(generateUUID());
    }
  }, [lead]);

  // Auto-suggest follow-up on action-oriented outcomes
  const handleSelectOutcome = (val: CallOutcome) => {
    setOutcome(val);
    const requiresFollowUp = [
      'Call Back',
      'Follow-up Required',
      'Interested',
      'Appointment Confirmed',
      'Meeting Scheduled',
      'Requirement Collected'
    ].includes(val);

    if (requiresFollowUp) {
      setShowFollowUp(true);
      if (!followUpDate) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setFollowUpDate(getIstTodayDateStr());
      }
      if (!followUpReason) {
        setFollowUpReason(`Follow-up on ${val}`);
      }
    }
  };

  const handleApplyQuickRemark = (tag: string) => {
    setRemarks(prev => (prev ? `${prev}. ${tag}` : tag));
  };

  const handleSetQuickDate = (daysAhead: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setFollowUpDate(`${yyyy}-${mm}-${dd}`);
  };

  const handleSave = async (andNext: boolean = false) => {
    if (!lead) return;
    if (!outcome) {
      setSaveError('Please select a call outcome.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setFollowUpError(null);

    try {
      const result = await telecallingService.logCallResult({
        leadId: lead.id,
        telecallerEmail,
        callOutcome: outcome,
        remarks: remarks.trim() || `Call recorded: ${outcome}`,
        submissionToken,
        contactPerson: contactPerson.trim(),
        phoneUsed: lead.phone,
        alternatePhone: alternatePhone.trim(),
        email: email.trim(),
        location: location.trim(),
        serviceRequired: serviceRequired.trim(),
        followUpDate: showFollowUp && followUpDate ? followUpDate : undefined,
        followUpTime: showFollowUp && followUpDate ? followUpTime : undefined,
        followUpReason: followUpReason.trim()
      });

      if (result.followUpError) {
        // Call was logged and saved safely to CRM & lead_activities!
        // But follow-up failed to schedule. Preserve lead and show actionable retry banner.
        setSavedLeadState(result.lead);
        setFollowUpError(result.followUpError);
      } else {
        onSaved(result.lead, andNext);
        onClose();
      }
    } catch (err: any) {
      console.error('[CallEntryModal] Save failed:', err);
      // NEVER lose data: keep modal open and keep all entered fields intact
      setSaveError(err.message || 'Call result could not be saved. Your entered information has been kept. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRetryFollowUp = async () => {
    if (!lead || !followUpDate) return;
    setRetryingFollowUp(true);
    try {
      await telecallingService.retryFollowUp({
        leadId: lead.id,
        telecallerEmail,
        dueDate: followUpDate,
        dueTime: followUpTime,
        reason: followUpReason.trim(),
        notes: remarks.trim()
      });
      setFollowUpError(null);
      if (savedLeadState) {
        onSaved(savedLeadState, false);
      }
      onClose();
    } catch (err: any) {
      console.error('[CallEntryModal] Retry follow-up failed:', err);
      alert(`Retry follow-up failed: ${err.message || 'Could not schedule reminder'}`);
    } finally {
      setRetryingFollowUp(false);
    }
  };

  if (!isOpen || !lead) return null;

  return createPortal(
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '1rem'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="glass-panel animate-scale-up" 
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-card)',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--glass-bg-subtle)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                CALL RESULT ENTRY
              </span>
              {lead.call_count ? (
                <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                  Call #{lead.call_count + 1}
                </span>
              ) : null}
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              {lead.company_name || lead.customer_name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.2rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              <span>Contact: <strong>{lead.customer_name}</strong></span>
              <span>•</span>
              <a 
                href={`tel:${lead.phone}`}
                style={{ 
                  color: 'var(--brand-blue)', 
                  fontWeight: 600, 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '0.3rem', 
                  textDecoration: 'none' 
                }}
              >
                <Phone size={13} /> {lead.phone}
              </a>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <a
              href={`tel:${lead.phone}`}
              className="btn btn-secondary"
              style={{ padding: '0.45rem 0.75rem', fontSize: '0.8125rem', gap: '0.4rem', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
              title="Dial Now"
            >
              <PhoneCall size={14} /> Call Now
            </a>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.45rem', borderRadius: '50%' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Form Body */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Save Error Alert Banner */}
          {saveError && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.65rem'
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1, fontSize: '0.8125rem' }}>
                <strong>Call result could not be saved.</strong>
                <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)' }}>
                  Your entered remarks and updates have been preserved. Please check your network and click "Save Result" again.
                </div>
                <div style={{ marginTop: '0.25rem', fontFamily: 'monospace', fontSize: '0.72rem', opacity: 0.85 }}>
                  Error: {saveError}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaveError(null)}
                className="btn-ghost"
                style={{ padding: '0.2rem', color: '#ef4444' }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Follow-up Warning Banner (Decoupled Follow-up Retry) */}
          {followUpError && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#d97706',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.65rem',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flex: 1 }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.8125rem' }}>
                  <strong>Call activity recorded successfully!</strong>
                  <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)' }}>
                    However, scheduling the follow-up reminder encountered an issue: {followUpError}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={handleRetryFollowUp}
                  disabled={retryingFollowUp}
                  className="btn btn-warning"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', fontWeight: 700, gap: '0.3rem' }}
                >
                  <RotateCcw size={13} className={retryingFollowUp ? 'spin' : ''} />
                  {retryingFollowUp ? 'Retrying...' : 'Retry Follow-up'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (savedLeadState) onSaved(savedLeadState, false);
                    onClose();
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                >
                  Dismiss & Close
                </button>
              </div>
            </div>
          )}
          
          {/* 1. Structured Outcome Chips Grid */}
          <div>
            <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>
              Select Call Outcome <span style={{ color: 'var(--accent-danger)' }}>*</span>
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '0.45rem'
            }}>
              {OUTCOMES.map(o => {
                const isSelected = outcome === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => handleSelectOutcome(o.value)}
                    style={{
                      padding: '0.5rem 0.65rem',
                      borderRadius: '10px',
                      fontSize: '0.78rem',
                      fontWeight: isSelected ? 700 : 500,
                      textAlign: 'center',
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${o.color}` : '1px solid var(--border-color)',
                      background: isSelected ? `${o.color}15` : 'var(--bg-card)',
                      color: isSelected ? o.color : 'var(--text-primary)',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: o.color,
                      flexShrink: 0
                    }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {o.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Remarks & Human Notes */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Call Remarks & Feedback Notes
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Permanent audit record
              </span>
            </div>

            {/* Quick remark chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
              {QUICK_REMARK_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleApplyQuickRemark(tag)}
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '9999px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--glass-bg-subtle)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  + {tag}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Spoke with Jaison (MD). Interested in 14ft LED van campaign next month. Asked to send details and call back Monday."
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                fontSize: '0.85rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-input, rgba(255,255,255,0.05))',
                color: 'var(--text-primary)',
                resize: 'vertical',
                lineHeight: 1.4
              }}
            />
          </div>

          {/* 3. Follow-up Section */}
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1rem',
            background: showFollowUp ? 'rgba(59, 130, 246, 0.03)' : 'var(--glass-bg-subtle)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={16} color="var(--brand-blue)" />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Schedule Next Follow-up
                </span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={showFollowUp}
                  onChange={(e) => setShowFollowUp(e.target.checked)}
                />
                Require Follow-up
              </label>
            </div>

            {showFollowUp && (
              <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Quick Date Shortcuts */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => handleSetQuickDate(1)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetQuickDate(2)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
                  >
                    In 2 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetQuickDate(7)}
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
                  >
                    Next Week
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                      Follow-up Date
                    </label>
                    <input
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                      Follow-up Time
                    </label>
                    <input
                      type="time"
                      value={followUpTime}
                      onChange={(e) => setFollowUpTime(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                    Follow-up Reason
                  </label>
                  <input
                    type="text"
                    value={followUpReason}
                    onChange={(e) => setFollowUpReason(e.target.value)}
                    placeholder="e.g. Call to confirm meeting date"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4. Quick Contact Updates */}
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1rem',
            background: 'var(--glass-bg-subtle)'
          }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.65rem' }}>
              Update Contact Details (Optional)
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  Contact Person Name
                </label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  placeholder="e.g. Jaison - MD"
                  style={{ width: '100%', padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  Alternate Phone / WhatsApp
                </label>
                <input
                  type="text"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                  placeholder="e.g. +91 98470 12345"
                  style={{ width: '100%', padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. client@company.com"
                  style={{ width: '100%', padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  Location / City
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Thrissur, Kochi, Kozhikode"
                  style={{ width: '100%', padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  Requirement / Service Interest
                </label>
                <input
                  type="text"
                  value={serviceRequired}
                  onChange={(e) => setServiceRequired(e.target.value)}
                  placeholder="e.g. 3-Side LED Van, Lookwalker promotion, LED Wall setup"
                  style={{ width: '100%', padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--glass-bg-subtle)',
          gap: '0.75rem',
          flexWrap: 'wrap'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            disabled={saving || retryingFollowUp}
          >
            Cancel
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="btn btn-secondary"
              disabled={saving || retryingFollowUp}
              style={{ fontWeight: 600, gap: '0.4rem', display: 'flex', alignItems: 'center' }}
            >
              {saving && <RotateCcw size={13} className="spin" />}
              {saving ? 'Saving...' : 'Save Result'}
            </button>

            <button
              type="button"
              onClick={() => handleSave(true)}
              className="btn btn-primary"
              disabled={saving || retryingFollowUp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)'
              }}
            >
              {saving ? (
                <>
                  <RotateCcw size={13} className="spin" />
                  Saving...
                </>
              ) : (
                <>
                  Save & Next Call <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
