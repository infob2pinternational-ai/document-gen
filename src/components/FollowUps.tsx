import React, { useState, useEffect, useRef } from 'react';
import type { FollowUp } from '../types';
import { officeService } from '../services/officeService';
import { metricsService } from '../services/metricsService';
import { FollowUpModal } from './FollowUpModal';
import { 
  Clock, 
  Plus, 
  Search, 
  CheckCircle2, 
  Phone, 
  MessageSquare, 
  Edit,
  BellRing,
  Volume2,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { normalizeIndianPhone } from '../utils/whatsappShare';
import { formatStaffDisplayName } from '../utils/staffUtils';
import { playFollowUpReminderSound } from '../utils/audio';
import { getDueFollowUpsForUser, type DueFollowUpItem } from '../utils/followUpReminders';

interface FollowUpsProps {
  role?: string;
  userEmail?: string;
  onOpenLead?: (leadId: string) => void;
}

export const FollowUps: React.FC<FollowUpsProps> = ({
  role = '',
  userEmail = '',
  onOpenLead
}) => {
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'overdue' | 'completed' | 'snoozed' | 'all'>('today');
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [dueReminders, setDueReminders] = useState<DueFollowUpItem[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null);

  const lastSoundPlayedRef = useRef<number>(0);

  const isOwner = role === 'owner' || 
    userEmail.toLowerCase().trim() === 'sarathjohnpanengadan@gmail.com' || 
    userEmail.toLowerCase().trim() === 'sarathjohnpanegdan@gmail.com' || 
    userEmail.toLowerCase().trim() === 'owner@b2p.com';

  const refreshFollowUps = () => {
    let list: FollowUp[] = [];
    if (activeTab === 'snoozed') {
      list = officeService.getFollowUps('all').filter(f => f.status === 'SNOOZED');
    } else {
      list = officeService.getFollowUps(activeTab as any);
    }
    setFollowUps(list);

    // Calculate due reminders for the currently assigned user
    const allList = officeService.getFollowUps('all');
    const due = getDueFollowUpsForUser(allList, userEmail, isOwner);
    setDueReminders(due);
  };

  useEffect(() => {
    refreshFollowUps();
    const unsub = metricsService.subscribe(refreshFollowUps);
    return unsub;
  }, [activeTab, userEmail]);

  // Audio reminder sound chime when due reminders exist
  useEffect(() => {
    if (dueReminders.length > 0 && !bannerDismissed) {
      const now = Date.now();
      // Play reminder chime once per 60 seconds when due items exist
      if (now - lastSoundPlayedRef.current > 60000) {
        lastSoundPlayedRef.current = now;
        playFollowUpReminderSound();
      }
    }
  }, [dueReminders.length, bannerDismissed]);

  const handleOpenAdd = () => {
    setEditingFollowUp(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (f: FollowUp) => {
    setEditingFollowUp(f);
    setModalOpen(true);
  };

  const handleQuickComplete = async (f: FollowUp) => {
    const note = prompt(`Enter completion outcome for ${f.customer_name}:`, 'Client contacted. Requirement updated.');
    if (note !== null) {
      try {
        await officeService.completeFollowUp(f.id, note, userEmail);
        refreshFollowUps();
      } catch (err: any) {
        alert(err.message || 'Failed to complete follow-up.');
      }
    }
  };

  const handleSnooze = async (f: FollowUp, minutes: number) => {
    try {
      await officeService.snoozeFollowUp(f.id, minutes, userEmail);
      refreshFollowUps();
    } catch (err: any) {
      alert(err.message || 'Failed to snooze follow-up.');
    }
  };

  const filtered = followUps.filter(f =>
    f.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (f.company_name && f.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    f.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (f.phone && f.phone.includes(searchTerm)) ||
    (f.lead_number && f.lead_number.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const counts = metricsService.getFollowUpCounts(userEmail);

  const tabs: { key: typeof activeTab; label: string; count: number; alert?: boolean }[] = [
    { key: 'today', label: 'Due Today', count: counts.today },
    { key: 'overdue', label: 'Overdue', count: counts.overdue, alert: counts.overdue > 0 },
    { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'snoozed', label: 'Snoozed', count: counts.snoozed },
    { key: 'all', label: 'All Tasks', count: counts.total }
  ];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* ── Follow-up Reminders Alert Banner ─────────────────────────────── */}
      {dueReminders.length > 0 && !bannerDismissed && (
        <div 
          className="glass-panel animate-fade-in" 
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.12))',
            border: '1.5px solid rgba(245, 158, 11, 0.45)',
            borderRadius: 'var(--radius-md)',
            padding: '1.1rem 1.35rem',
            boxShadow: '0 4px 20px -2px rgba(245, 158, 11, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: '#fef3c7',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 12px rgba(245, 158, 11, 0.35)',
                flexShrink: 0
              }}>
                <BellRing size={20} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    Follow-up Reminders for You
                  </h3>
                  <span style={{
                    background: dueReminders.some(d => d.isOverdue) ? '#ef4444' : '#f59e0b',
                    color: '#ffffff',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '12px',
                    fontSize: '0.72rem',
                    fontWeight: 800
                  }}>
                    {dueReminders.length} Task{dueReminders.length > 1 ? 's' : ''} Due
                  </span>
                </div>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Assigned client callback reminders scheduled for today or requiring urgent contact.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => playFollowUpReminderSound()}
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="Play chime audio"
              >
                <Volume2 size={13} />
                <span>Test Chime</span>
              </button>

              <button
                type="button"
                onClick={() => setBannerCollapsed(!bannerCollapsed)}
                className="btn-ghost"
                style={{ padding: '0.35rem' }}
                title={bannerCollapsed ? 'Expand list' : 'Collapse list'}
              >
                {bannerCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>

              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="btn-ghost"
                style={{ padding: '0.35rem', color: 'var(--text-muted)' }}
                title="Dismiss Banner"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Cards for each due task */}
          {!bannerCollapsed && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
              gap: '0.75rem',
              marginTop: '0.25rem'
            }}>
              {dueReminders.map(dueItem => {
                const item = dueItem.followUp;
                return (
                  <div 
                    key={item.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: dueItem.isOverdue ? '1px solid #f87171' : '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '0.65rem',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {item.customer_name}
                          </div>
                          {item.company_name && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.company_name}</div>
                          )}
                        </div>
                        <span style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          background: dueItem.isOverdue ? '#fee2e2' : '#fef3c7',
                          color: dueItem.isOverdue ? '#b91c1c' : '#b45309'
                        }}>
                          {dueItem.isOverdue ? '⚠️ OVERDUE' : `⏰ ${dueItem.dueDateTimeStr}`}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem', fontWeight: 500 }}>
                        {item.reason}
                      </div>

                      {item.phone && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          📞 {item.phone}
                        </div>
                      )}
                    </div>

                    {/* Action buttons inside card */}
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.4rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        {item.phone && (
                          <a
                            href={`tel:${item.phone}`}
                            className="btn-secondary"
                            style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
                          >
                            <Phone size={11} /> Call
                          </a>
                        )}
                        {item.phone && (
                          <a
                            href={`https://wa.me/${normalizeIndianPhone(item.phone)}?text=${encodeURIComponent(`Hello ${item.customer_name}, following up from B2P International regarding your inquiry.`)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary"
                            style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
                          >
                            <MessageSquare size={11} /> WA
                          </a>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <select
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (val > 0) handleSnooze(item, val);
                          }}
                          defaultValue=""
                          style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem', width: '80px' }}
                        >
                          <option value="" disabled>Snooze</option>
                          <option value="15">+15m</option>
                          <option value="30">+30m</option>
                          <option value="60">+1hr</option>
                          <option value="1440">Tomorrow</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleQuickComplete(item)}
                          className="btn-primary"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', background: '#16a34a', borderColor: '#16a34a', display: 'flex', alignItems: 'center', gap: '3px' }}
                        >
                          <CheckCircle2 size={12} />
                          <span>Done</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pill if user dismissed banner */}
      {dueReminders.length > 0 && bannerDismissed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setBannerDismissed(false)}
            className="btn-secondary"
            style={{
              fontSize: '0.75rem',
              padding: '0.3rem 0.75rem',
              background: '#fef3c7',
              borderColor: '#f59e0b',
              color: '#b45309',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <BellRing size={13} />
            <span>Show {dueReminders.length} Due Reminder{dueReminders.length > 1 ? 's' : ''}</span>
          </button>
        </div>
      )}

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
              Follow-ups & Client Reminders
            </h1>
            <span className="badge badge-neutral">
              {filtered.length} Active Tasks
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Track client callbacks, quotation negotiations, and closing touchpoints.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="btn-primary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>Schedule Follow-up</span>
        </button>
      </div>

      {/* Tabs & Urgency Filters Bar */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 0.75rem',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        {/* Left: Tab buttons */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: isActive ? 'var(--brand-navy)' : tab.alert ? '#fee2e2' : 'transparent',
                  color: isActive ? '#ffffff' : tab.alert ? '#991b1b' : 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: isActive || tab.alert ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <span>{tab.label}</span>
                <span 
                  className="mono"
                  style={{
                    background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--bg-slate)',
                    color: isActive ? '#ffffff' : 'inherit',
                    padding: '0.05rem 0.35rem',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    fontWeight: 700
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: Search Box */}
        <div style={{ position: 'relative', width: '260px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search customer, phone, purpose..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '2rem', fontSize: '0.8125rem' }}
          />
        </div>
      </div>

      {/* Follow-up Tasks Table */}
      <div className="table-container animate-fade-in">
        {filtered.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Customer / Company</th>
                <th>Phone / Contact</th>
                <th>Due Date & Time</th>
                <th>Urgency Status</th>
                <th>Follow-up Purpose</th>
                <th>Assigned Staff</th>
                <th style={{ textAlign: 'right' }}>Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const todayStr = new Date().toISOString().split('T')[0];
                const isOverdue = item.status !== 'COMPLETED' && item.due_date < todayStr;
                const isCompleted = item.status === 'COMPLETED';
                const isToday = item.status !== 'COMPLETED' && item.due_date === todayStr;

                return (
                  <tr key={item.id} style={{ opacity: isCompleted ? 0.7 : 1 }}>
                    
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.customer_name}</div>
                      {item.company_name && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.company_name}</div>
                      )}
                      {item.lead_number && (
                        <span 
                          onClick={() => item.lead_id && onOpenLead && onOpenLead(item.lead_id)}
                          className="mono" 
                          style={{ fontSize: '0.7rem', color: 'var(--brand-navy)', textDecoration: 'underline', cursor: 'pointer' }}
                        >
                          {item.lead_number}
                        </span>
                      )}
                    </td>

                    <td>
                      <div style={{ fontSize: '0.8125rem' }}>{item.phone || '—'}</div>
                      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.15rem' }}>
                        {item.phone && (
                          <a 
                            href={`tel:${item.phone}`} 
                            style={{ fontSize: '0.7rem', color: 'var(--accent-success)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '2px' }}
                          >
                            <Phone size={10} /> Call
                          </a>
                        )}
                        {item.phone && (
                          <a 
                            href={`https://wa.me/${normalizeIndianPhone(item.phone)}?text=${encodeURIComponent(`Hello ${item.customer_name}, following up from B2P International regarding your inquiry.`)}`}
                            target="_blank" 
                            rel="noreferrer"
                            style={{ fontSize: '0.7rem', color: '#16a34a', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '4px' }}
                          >
                            <MessageSquare size={10} /> WA
                          </a>
                        )}
                      </div>
                    </td>

                    <td>
                      <div className="mono" style={{ fontWeight: 600, fontSize: '0.8125rem', color: isOverdue ? 'var(--accent-danger)' : 'var(--text-primary)' }}>
                        {item.due_date.split('-').reverse().join('/')}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        at {item.due_time || '11:00 AM'}
                      </div>
                    </td>

                    <td>
                      {isCompleted ? (
                        <span className="badge badge-success">Completed</span>
                      ) : isOverdue ? (
                        <span className="badge badge-danger">Overdue</span>
                      ) : isToday ? (
                        <span className="badge badge-warning">Due Today</span>
                      ) : (
                        <span className="badge badge-info">Scheduled</span>
                      )}
                    </td>

                    <td style={{ maxWidth: '280px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{item.reason}</div>
                      {item.notes && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{item.notes}</div>
                      )}
                      {item.completion_note && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--accent-success)', marginTop: '0.1rem' }}>
                          Outcome: {item.completion_note}
                        </div>
                      )}
                    </td>

                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {formatStaffDisplayName(item.assigned_staff_email)}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {!isCompleted && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleQuickComplete(item)}
                              className="btn-primary"
                              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', background: '#16a34a', borderColor: '#16a34a' }}
                            >
                              <CheckCircle2 size={12} />
                              <span>Done</span>
                            </button>

                            <select
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (val > 0) handleSnooze(item, val);
                              }}
                              defaultValue=""
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem', width: '82px' }}
                            >
                              <option value="" disabled>Snooze</option>
                              <option value="30">+30m</option>
                              <option value="60">+1hr</option>
                              <option value="120">+2hr</option>
                              <option value="1440">Tomorrow</option>
                            </select>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="btn-ghost"
                          style={{ padding: '0.3rem' }}
                          title="Edit Task"
                        >
                          <Edit size={14} />
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Clock size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.35 }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>No follow-up tasks found for "{activeTab.toUpperCase()}" view.</p>
            <button
              onClick={handleOpenAdd}
              className="btn-secondary"
              style={{ marginTop: '0.75rem', fontSize: '0.8125rem' }}
            >
              + Create Follow-up Task
            </button>
          </div>
        )}
      </div>

      {/* FollowUp Modal */}
      {modalOpen && (
        <FollowUpModal
          followUp={editingFollowUp}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => refreshFollowUps()}
          userEmail={userEmail}
        />
      )}

    </div>
  );
};
