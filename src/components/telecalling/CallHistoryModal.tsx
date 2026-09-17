import React from 'react';
import { createPortal } from 'react-dom';
import type { Lead, LeadActivity } from '../../types';
import { leadService } from '../../services/leadService';
import { 
  X, 
  Phone, 
  MapPin, 
  History,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { formatIstDateTime } from '../../utils/dateUtils';
import { formatStaffDisplayName } from '../../utils/staffUtils';

interface CallHistoryModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onLogNewCall?: (lead: Lead) => void;
}

export const CallHistoryModal: React.FC<CallHistoryModalProps> = ({
  lead,
  isOpen,
  onClose,
  onLogNewCall
}) => {
  const [activities, setActivities] = React.useState<LeadActivity[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const loadActivities = React.useCallback(() => {
    if (!lead) return;
    try {
      setError(null);
      const acts = leadService.getLeadActivities(lead.id);
      setActivities(acts);
    } catch (err: any) {
      console.error('[CallHistoryModal] Failed to load activities:', err);
      setError(err.message || 'Failed to load call history.');
    }
  }, [lead]);

  React.useEffect(() => {
    loadActivities();
  }, [loadActivities]);

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
          maxWidth: '640px',
          maxHeight: '90vh',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <History size={16} color="var(--brand-blue)" />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Complete Call & Activity History
              </span>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
              {lead.company_name || lead.customer_name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.2rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              <span>Contact: <strong>{lead.customer_name}</strong></span>
              <span>•</span>
              <span>Phone: <strong>{lead.phone}</strong></span>
              {lead.location ? (
                <>
                  <span>•</span>
                  <span><MapPin size={12} style={{ display: 'inline', verticalAlign: 'text-top' }} /> {lead.location}</span>
                </>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '0.45rem', borderRadius: '50%' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Timeline Content */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#ef4444' }}>
              <AlertTriangle size={36} style={{ margin: '0 auto 0.75rem auto', color: '#ef4444' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Failed to load activity timeline</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: 'var(--text-secondary)' }}>{error}</p>
              <button
                type="button"
                onClick={loadActivities}
                className="btn btn-secondary"
                style={{ marginTop: '0.85rem', fontSize: '0.78rem', gap: '0.35rem' }}
              >
                <RotateCcw size={13} /> Retry Loading
              </button>
            </div>
          ) : activities.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <History size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No calls or activities recorded yet.</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>Log a call to start this client's permanent audit trail.</p>
            </div>
          ) : (
            <div style={{ position: 'relative', paddingLeft: '1.75rem' }}>
              {/* Vertical timeline connector */}
              <div style={{
                position: 'absolute',
                top: '0.75rem',
                bottom: '0.75rem',
                left: '0.45rem',
                width: '2px',
                background: 'var(--border-color)'
              }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {activities.map((act) => {
                  const outcome = act.call_outcome || act.action;
                  const telecallerName = formatStaffDisplayName(act.user_email);

                  return (
                    <div key={act.id} style={{ position: 'relative' }}>
                      {/* Timeline dot */}
                      <div style={{
                        position: 'absolute',
                        left: '-1.75rem',
                        top: '0.25rem',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: outcome === 'Connected' || outcome === 'Interested'
                          ? '#10b981'
                          : outcome === 'Requirement Collected' || outcome === 'Appointment Confirmed'
                          ? '#3b82f6'
                          : outcome === 'Not Interested' || outcome === 'Invalid Number'
                          ? '#ef4444'
                          : 'var(--text-muted)',
                        border: '2px solid var(--bg-card)'
                      }} />

                      {/* Timeline Card */}
                      <div style={{
                        padding: '0.85rem 1rem',
                        borderRadius: '12px',
                        background: 'var(--glass-bg-subtle)',
                        border: '1px solid var(--border-color)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              {formatIstDateTime(act.created_at)}
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                              Telecaller: <strong>{telecallerName}</strong> ({act.user_email})
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            {outcome ? (
                              <span 
                                className="badge"
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  background: outcome === 'Interested' || outcome === 'Connected'
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : outcome === 'Requirement Collected' || outcome === 'Appointment Confirmed'
                                    ? 'rgba(59, 130, 246, 0.15)'
                                    : 'rgba(100, 116, 139, 0.15)',
                                  color: outcome === 'Interested' || outcome === 'Connected'
                                    ? '#059669'
                                    : outcome === 'Requirement Collected' || outcome === 'Appointment Confirmed'
                                    ? '#2563eb'
                                    : 'var(--text-primary)'
                                }}
                              >
                                {outcome}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Remark Notes */}
                        {act.note ? (
                          <div style={{
                            marginTop: '0.6rem',
                            padding: '0.6rem 0.75rem',
                            borderRadius: '8px',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.8125rem',
                            color: 'var(--text-primary)',
                            lineHeight: 1.45
                          }}>
                            {act.note}
                          </div>
                        ) : null}

                        {/* Call Metadata (Contact person, phone used, follow-up) */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {act.contact_person && act.contact_person !== lead.customer_name ? (
                            <span>Spoke with: <strong>{act.contact_person}</strong></span>
                          ) : null}
                          {act.phone_used ? (
                            <span>Phone: <strong>{act.phone_used}</strong></span>
                          ) : null}
                          {act.next_follow_up_at ? (
                            <span style={{ color: 'var(--brand-blue)', fontWeight: 600 }}>
                              Follow-up scheduled: {formatIstDateTime(act.next_follow_up_at)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--glass-bg-subtle)'
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Total entries: {activities.length}
          </span>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onLogNewCall ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogNewCall(lead);
                }}
                className="btn btn-primary"
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.8125rem', gap: '0.4rem' }}
              >
                <Phone size={14} /> Log New Call
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.8125rem' }}
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
