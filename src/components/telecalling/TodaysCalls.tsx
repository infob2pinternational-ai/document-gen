import React, { useState, useEffect, useMemo } from 'react';
import type { Lead } from '../../types';
import { leadService } from '../../services/leadService';
import { officeService } from '../../services/officeService';
import { metricsService } from '../../services/metricsService';
import { getIstTodayDateStr, formatIstDateTime, isTimestampOnIstDate } from '../../utils/dateUtils';
import { getAvailableStaffList } from '../../utils/staffUtils';
import { CallEntryModal } from './CallEntryModal';
import { CallHistoryModal } from './CallHistoryModal';
import { 
  Phone, 
  Search, 
  CheckCircle2, 
  MapPin, 
  History, 
  Check, 
  Flame,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';

interface TodaysCallsProps {
  userRole?: string;
  userEmail?: string;
  companyId?: string;
}

type QuickFilter = 
  | 'all' 
  | 'pending' 
  | 'completed' 
  | 'due_today' 
  | 'overdue' 
  | 'interested' 
  | 'no_answer' 
  | 'not_reachable';

export const TodaysCalls: React.FC<TodaysCallsProps> = ({
  userRole = 'telecaller',
  userEmail = 'telecaller@b2p.com',
  companyId
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<QuickFilter>('pending');
  const [staffFilter, setStaffFilter] = useState<string>(
    userRole === 'telecaller' ? userEmail : 'all'
  );

  // Modals
  const [entryModalLead, setEntryModalLead] = useState<Lead | null>(null);
  const [historyModalLead, setHistoryModalLead] = useState<Lead | null>(null);

  const todayStr = getIstTodayDateStr();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshAll = () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = leadService.getLeads(companyId);
      setLeads(data);
    } catch (err: any) {
      console.error('[TodaysCalls] Error loading calls:', err);
      setLoadError(err.message || 'Failed to load calling queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const unsub = metricsService.subscribe(refreshAll);
    return unsub;
  }, [companyId]);

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, leads);
  }, [userEmail, leads]);

  // Scope leads to staff:
  // If user is telecaller, strictly their leads (or unassigned if needed).
  // If owner/admin, respects staffFilter dropdown.
  const scopedLeads = useMemo(() => {
    const targetStaff = userRole === 'telecaller' ? userEmail : staffFilter;
    if (targetStaff === 'all') return leads;
    return leads.filter(l => (l.assigned_telecaller_email || '').toLowerCase().trim() === targetStaff.toLowerCase().trim());
  }, [leads, userRole, userEmail, staffFilter]);

  // Lead calling status for TODAY in IST
  const leadCallStatusMap = useMemo(() => {
    const map = new Map<string, { calledToday: boolean; lastCallOutcome?: string; lastCallAt?: string }>();
    scopedLeads.forEach(l => {
      const calledToday = Boolean(l.last_call_at && isTimestampOnIstDate(l.last_call_at, todayStr));
      map.set(l.id, {
        calledToday,
        lastCallOutcome: l.last_call_outcome,
        lastCallAt: l.last_call_at
      });
    });
    return map;
  }, [scopedLeads, todayStr]);

  // All follow-ups for due/overdue calculation
  const followUps = useMemo(() => officeService.getFollowUps('all', companyId), [companyId]);

  const followUpsMap = useMemo(() => {
    const map = new Map<string, { dueToday: boolean; overdue: boolean; nextDate?: string; nextTime?: string }>();
    followUps.forEach(f => {
      if (f.lead_id && f.status === 'PENDING') {
        const dueToday = f.due_date === todayStr;
        const overdue = f.due_date < todayStr;
        map.set(f.lead_id, {
          dueToday,
          overdue,
          nextDate: f.due_date,
          nextTime: f.due_time
        });
      }
    });
    return map;
  }, [followUps, todayStr]);

  // Compute Live Telecaller Summary KPIs
  const summary = useMemo(() => {
    const totalAssigned = scopedLeads.length;
    let calledCount = 0;
    let connectedCount = 0;
    let noAnswerCount = 0;
    let interestedCount = 0;
    let followUpCount = 0;

    scopedLeads.forEach(l => {
      const status = leadCallStatusMap.get(l.id);
      if (status?.calledToday) {
        calledCount++;
        const o = (status.lastCallOutcome || '').toLowerCase();
        if (o.includes('interested')) interestedCount++;
        if (o.includes('no answer') || o === 'na') noAnswerCount++;
        if (o.includes('connected') || o.includes('interested') || o.includes('requirement') || o.includes('appointment')) {
          connectedCount++;
        }
      }
      const fu = followUpsMap.get(l.id);
      if (fu?.dueToday || fu?.overdue) {
        followUpCount++;
      }
    });

    const remainingCount = Math.max(0, totalAssigned - calledCount);

    return {
      assigned: totalAssigned,
      called: calledCount,
      remaining: remainingCount,
      connected: connectedCount,
      noAnswer: noAnswerCount,
      interested: interestedCount,
      followUp: followUpCount
    };
  }, [scopedLeads, leadCallStatusMap, followUpsMap]);

  // Filter the list based on search and activeFilter
  const filteredList = useMemo(() => {
    return scopedLeads.filter(l => {
      const callStatus = leadCallStatusMap.get(l.id);
      const fu = followUpsMap.get(l.id);

      // Search match
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const match = 
          (l.company_name && l.company_name.toLowerCase().includes(term)) ||
          l.customer_name.toLowerCase().includes(term) ||
          l.phone.includes(term) ||
          (l.location && l.location.toLowerCase().includes(term)) ||
          (l.remarks && l.remarks.toLowerCase().includes(term));
        if (!match) return false;
      }

      // Quick filter match
      if (activeFilter === 'pending') {
        return !callStatus?.calledToday;
      }
      if (activeFilter === 'completed') {
        return Boolean(callStatus?.calledToday);
      }
      if (activeFilter === 'due_today') {
        return Boolean(fu?.dueToday);
      }
      if (activeFilter === 'overdue') {
        return Boolean(fu?.overdue);
      }
      if (activeFilter === 'interested') {
        return l.last_call_outcome === 'Interested';
      }
      if (activeFilter === 'no_answer') {
        return l.last_call_outcome === 'No Answer';
      }
      if (activeFilter === 'not_reachable') {
        return l.last_call_outcome === 'Not Reachable';
      }

      return true;
    });
  }, [scopedLeads, leadCallStatusMap, followUpsMap, searchTerm, activeFilter]);

  const handleOpenEntry = (lead: Lead) => {
    setEntryModalLead(lead);
  };

  const handleOpenHistory = (lead: Lead) => {
    setHistoryModalLead(lead);
  };

  const handleSavedCallResult = (updatedLead: Lead, nextCallRequested?: boolean) => {
    refreshAll();
    if (nextCallRequested) {
      // Find the next pending lead
      const remainingPending = scopedLeads.filter(l => l.id !== updatedLead.id && !leadCallStatusMap.get(l.id)?.calledToday);
      if (remainingPending.length > 0) {
        setTimeout(() => {
          setEntryModalLead(remainingPending[0]);
        }, 150);
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Top Header & Role/Staff Filter */}
      <div className="glass-panel" style={{
        padding: '1.25rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Today's Calls Workspace
            </h1>
            <span className="badge badge-info" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
              {summary.remaining} Pending
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            High-velocity calling desk. Direct one-click dialing and structured outcome capture.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading}
            className="btn btn-secondary"
            style={{ gap: '0.45rem', fontSize: '0.8125rem' }}
            title="Refresh queue"
          >
            <RotateCcw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>

          {/* Staff selector for Owner/Admin */}
          {userRole !== 'telecaller' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>VIEW DESK:</span>
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                style={{ fontSize: '0.8125rem', padding: '0.4rem 0.75rem', minWidth: '220px' }}
              >
                <option value="all">All Telecallers (Combined Queue)</option>
                {availableStaff.map(s => (
                  <option key={s.email} value={s.email}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Error Alert Banner */}
      {loadError && (
        <div style={{
          padding: '0.85rem 1.25rem',
          borderRadius: '12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Primary KPI Metrics Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '0.65rem'
      }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Assigned</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
            {summary.assigned}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Queue target</span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Called Today</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981', marginTop: '0.15rem' }}>
            {summary.called}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {summary.assigned > 0 ? Math.round((summary.called / summary.assigned) * 100) : 0}% done
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--brand-blue)', textTransform: 'uppercase' }}>Remaining</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.15rem' }}>
            {summary.remaining}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Awaiting call</span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase' }}>Connected</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981', marginTop: '0.15rem' }}>
            {summary.connected}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Discussions held</span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>No Answer</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#64748b', marginTop: '0.15rem' }}>
            {summary.noAnswer}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Retry needed</span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>Interested</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#d97706', marginTop: '0.15rem' }}>
            {summary.interested}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Positive leads</span>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase' }}>Follow-ups Due</span>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#8b5cf6', marginTop: '0.15rem' }}>
            {summary.followUp}
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Due or overdue</span>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="glass-panel" style={{
        padding: '0.85rem 1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        {/* Filter Pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {(
            [
              { key: 'pending', label: `Pending (${summary.remaining})` },
              { key: 'all', label: `All Assigned (${summary.assigned})` },
              { key: 'completed', label: `Called Today (${summary.called})` },
              { key: 'due_today', label: 'Follow-ups Today' },
              { key: 'overdue', label: 'Overdue Follow-ups' },
              { key: 'interested', label: 'Interested' },
              { key: 'no_answer', label: 'No Answer' },
              { key: 'not_reachable', label: 'Not Reachable' }
            ] as const
          ).map(tab => {
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveFilter(tab.key)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: '9999px',
                  border: isActive ? '1px solid var(--brand-blue)' : '1px solid var(--border-color)',
                  background: isActive ? 'var(--brand-blue)' : 'var(--glass-bg-subtle)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Quick Search Input */}
        <div style={{ position: 'relative', width: '260px', maxWidth: '100%' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search company, phone, location..."
            style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '0.75rem', paddingTop: '0.35rem', paddingBottom: '0.35rem', fontSize: '0.8125rem' }}
          />
        </div>
      </div>

      {/* Calling List View (Mobile-First Cards) */}
      {filteredList.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', color: 'var(--text-muted)' }}>
          {loading ? (
            <>
              <RotateCcw size={36} className="spin" style={{ margin: '0 auto 0.75rem auto', color: 'var(--brand-blue)' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Loading calls queue...
              </h3>
            </>
          ) : loadError ? (
            <>
              <AlertTriangle size={42} style={{ margin: '0 auto 0.75rem auto', color: '#ef4444' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ef4444' }}>
                Failed to load queue
              </h3>
              <p style={{ fontSize: '0.8125rem', marginTop: '0.3rem' }}>{loadError}</p>
              <button
                type="button"
                onClick={refreshAll}
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem', fontSize: '0.8125rem', gap: '0.35rem' }}
              >
                <RotateCcw size={13} /> Retry Loading
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 size={42} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4, color: '#10b981' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {activeFilter === 'pending' ? 'All clear! No pending calls in this queue.' : 'No matching calls found.'}
              </h3>
              <p style={{ fontSize: '0.8125rem', marginTop: '0.3rem' }}>
                {activeFilter === 'pending' ? 'Great work! You have completed all assigned calls for today.' : 'Try adjusting your search or filters.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredList.map((lead, idx) => {
            const callStatus = leadCallStatusMap.get(lead.id);
            const fu = followUpsMap.get(lead.id);

            return (
              <div
                key={lead.id}
                className="glass-panel"
                style={{
                  padding: '1.15rem 1.35rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  borderLeft: callStatus?.calledToday 
                    ? '4px solid #10b981' 
                    : fu?.overdue 
                    ? '4px solid #ef4444' 
                    : fu?.dueToday 
                    ? '4px solid #f59e0b' 
                    : '4px solid var(--brand-blue)'
                }}
              >
                {/* Left Side: Client Details */}
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      #{idx + 1}
                    </span>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      {lead.company_name || lead.customer_name}
                    </h3>
                    
                    {lead.priority === 'HOT' && (
                      <span className="badge badge-danger" style={{ fontSize: '0.6875rem', gap: '0.2rem' }}>
                        <Flame size={11} /> HOT
                      </span>
                    )}

                    {callStatus?.calledToday && (
                      <span className="badge badge-success" style={{ fontSize: '0.6875rem' }}>
                        <Check size={11} /> Called Today
                      </span>
                    )}

                    {fu?.overdue && (
                      <span className="badge badge-danger" style={{ fontSize: '0.6875rem' }}>
                        Overdue Follow-up
                      </span>
                    )}
                    {fu?.dueToday && !fu.overdue && (
                      <span className="badge badge-warning" style={{ fontSize: '0.6875rem' }}>
                        Follow-up Today
                      </span>
                    )}
                  </div>

                  {/* Contact Person & Location */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    <span>Contact: <strong>{lead.customer_name}</strong></span>
                    {lead.location ? (
                      <>
                        <span>•</span>
                        <span><MapPin size={12} style={{ display: 'inline', verticalAlign: 'text-top' }} /> {lead.location}</span>
                      </>
                    ) : null}
                    {lead.service_required ? (
                      <>
                        <span>•</span>
                        <span style={{ color: 'var(--brand-blue)' }}>Req: {lead.service_required}</span>
                      </>
                    ) : null}
                  </div>

                  {/* Previous call / follow-up summary */}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    {lead.last_call_outcome ? (
                      <span>Last Outcome: <strong style={{ color: 'var(--text-primary)' }}>{lead.last_call_outcome}</strong> ({formatIstDateTime(lead.last_call_at)})</span>
                    ) : (
                      <span>Not called yet</span>
                    )}
                    {lead.last_call_remark ? (
                      <span style={{ marginLeft: '0.5rem', fontStyle: 'italic' }}>
                        "{lead.last_call_remark}"
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Right Side: Direct Call & Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  {/* Phone Dial Link */}
                  <a
                    href={`tel:${lead.phone}`}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.55rem 0.95rem',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      gap: '0.45rem',
                      color: '#10b981',
                      borderColor: 'rgba(16,185,129,0.3)',
                      textDecoration: 'none'
                    }}
                    title={`Dial ${lead.phone}`}
                  >
                    <Phone size={15} /> {lead.phone}
                  </a>

                  {/* Alternate phone if present */}
                  {lead.alternate_phone ? (
                    <a
                      href={`tel:${lead.alternate_phone}`}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.55rem 0.75rem',
                        fontSize: '0.8125rem',
                        gap: '0.35rem',
                        textDecoration: 'none'
                      }}
                      title={`Dial Alternate ${lead.alternate_phone}`}
                    >
                      <Phone size={13} /> Alt
                    </a>
                  ) : null}

                  {/* History Modal Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenHistory(lead)}
                    className="btn btn-secondary"
                    style={{ padding: '0.55rem', borderRadius: '8px' }}
                    title="View Past History"
                  >
                    <History size={16} />
                  </button>

                  {/* Log Call Result Button (Primary Action) */}
                  <button
                    type="button"
                    onClick={() => handleOpenEntry(lead)}
                    className="btn btn-primary"
                    style={{
                      padding: '0.55rem 1.15rem',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      gap: '0.45rem',
                      boxShadow: '0 4px 14px rgba(59, 130, 246, 0.28)'
                    }}
                  >
                    <CheckCircle2 size={16} /> Log Result
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Call Entry Modal */}
      {entryModalLead && (
        <CallEntryModal
          lead={entryModalLead}
          isOpen={Boolean(entryModalLead)}
          onClose={() => setEntryModalLead(null)}
          onSaved={handleSavedCallResult}
          telecallerEmail={userEmail}
        />
      )}

      {/* Call History Modal */}
      {historyModalLead && (
        <CallHistoryModal
          lead={historyModalLead}
          isOpen={Boolean(historyModalLead)}
          onClose={() => setHistoryModalLead(null)}
          onLogNewCall={(l) => {
            setHistoryModalLead(null);
            setEntryModalLead(l);
          }}
        />
      )}

    </div>
  );
};
