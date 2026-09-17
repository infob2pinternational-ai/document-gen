import React, { useState, useMemo } from 'react';
import { type TelecallerDayStats } from '../../services/telecallingService';
import { leadService } from '../../services/leadService';
import { 
  getIstTodayDateStr, 
  getIstYesterdayDateStr, 
  formatIstDate, 
  getIstDateStr
} from '../../utils/dateUtils';
import { formatStaffDisplayName, getAvailableStaffList } from '../../utils/staffUtils';
import { 
  TrendingUp, 
  Download, 
  ArrowUpDown 
} from 'lucide-react';

interface TelecallerPerformanceReportProps {
  userRole?: string;
  userEmail?: string;
  onNavigateTab?: (tab: string) => void;
}

type DateRangePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';

export const TelecallerPerformanceReport: React.FC<TelecallerPerformanceReportProps> = ({
  userRole = 'owner',
  userEmail = 'owner@b2p.com'
}) => {
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [customStart, setCustomStart] = useState<string>(getIstTodayDateStr());
  const [customEnd, setCustomEnd] = useState<string>(getIstTodayDateStr());
  const [staffFilter, setStaffFilter] = useState<string>(userRole === 'telecaller' ? userEmail : 'all');
  const [sortField, setSortField] = useState<keyof TelecallerDayStats>('totalCalls');
  const [sortAsc, setSortAsc] = useState(false);

  const leads = useMemo(() => leadService.getLeads(), []);
  const allActivities = useMemo(() => leadService.getLeadActivities(''), []);
  const availableStaff = useMemo(() => getAvailableStaffList(userEmail, leads), [userEmail, leads]);

  // Determine active date bounds in IST
  const { startDateStr, endDateStr } = useMemo(() => {
    const today = getIstTodayDateStr();
    if (preset === 'today') {
      return { startDateStr: today, endDateStr: today };
    }
    if (preset === 'yesterday') {
      const y = getIstYesterdayDateStr();
      return { startDateStr: y, endDateStr: y };
    }
    if (preset === 'this_week') {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(d.setDate(diff));
      return { startDateStr: getIstDateStr(monday), endDateStr: today };
    }
    if (preset === 'this_month') {
      const d = new Date();
      const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
      return { startDateStr: getIstDateStr(firstDay), endDateStr: today };
    }
    return { startDateStr: customStart || today, endDateStr: customEnd || today };
  }, [preset, customStart, customEnd]);

  // Filter activities within the selected date range in IST
  const rangeActivities = useMemo(() => {
    return allActivities.filter(a => {
      const actDate = getIstDateStr(a.created_at);
      return actDate >= startDateStr && actDate <= endDateStr;
    });
  }, [allActivities, startDateStr, endDateStr]);

  // Gather active staff
  const telecallersData = useMemo(() => {
    const staffEmailSet = new Set<string>();
    leads.forEach(l => {
      if (l.assigned_telecaller_email) {
        staffEmailSet.add(l.assigned_telecaller_email.toLowerCase().trim());
      }
    });
    rangeActivities.forEach(a => {
      if (a.user_email) {
        staffEmailSet.add(a.user_email.toLowerCase().trim());
      }
    });

    const staffEmails = Array.from(staffEmailSet);

    const rows: TelecallerDayStats[] = staffEmails.map(email => {
      const cleanEmail = email.toLowerCase().trim();
      const staffLeads = leads.filter(l => (l.assigned_telecaller_email || '').toLowerCase().trim() === cleanEmail);
      const staffActs = rangeActivities.filter(a => (a.user_email || '').toLowerCase().trim() === cleanEmail);
      const callsOnly = staffActs.filter(a => a.activity_type === 'call' || Boolean(a.call_outcome));
      const calledLeadIds = new Set(callsOnly.map(a => a.lead_id));

      const countOutcome = (o: string) => callsOnly.filter(a => a.call_outcome === o).length;

      const connected = callsOnly.filter(a => [
        'Connected', 'Interested', 'Requirement Collected', 'Appointment Confirmed', 
        'Meeting Scheduled', 'Existing Agency', 'Call Back', 'Details Sent'
      ].includes(a.call_outcome as string)).length;

      const followUpsCreated = staffActs.filter(a => Boolean(a.next_follow_up_at) || a.action === 'Follow-up Scheduled').length;

      return {
        email,
        name: formatStaffDisplayName(email),
        assigned: staffLeads.length,
        called: calledLeadIds.size,
        remaining: Math.max(0, staffLeads.length - calledLeadIds.size),
        totalCalls: callsOnly.length,
        connected,
        noAnswer: countOutcome('No Answer'),
        notReachable: countOutcome('Not Reachable'),
        switchedOff: countOutcome('Switched Off'),
        invalid: countOutcome('Invalid Number'),
        interested: countOutcome('Interested'),
        notInterested: countOutcome('Not Interested'),
        followUpsCreated,
        requirementsCollected: countOutcome('Requirement Collected'),
        appointments: countOutcome('Appointment Confirmed'),
        meetings: countOutcome('Meeting Scheduled'),
        detailsSent: countOutcome('Details Sent'),
        other: countOutcome('Other')
      };
    });

    // Filter by staffFilter if selected
    let result = rows;
    if (staffFilter !== 'all') {
      result = result.filter(r => r.email.toLowerCase().trim() === staffFilter.toLowerCase().trim());
    }

    // Sort
    return result.sort((a, b) => {
      const valA = a[sortField] as any;
      const valB = b[sortField] as any;
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc 
        ? String(valA).localeCompare(String(valB)) 
        : String(valB).localeCompare(String(valA));
    });
  }, [leads, rangeActivities, staffFilter, sortField, sortAsc]);

  const handleSort = (field: keyof TelecallerDayStats) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleExport = () => {
    const headers = ['Telecaller', 'Email', 'Assigned', 'Called', 'Total Calls', 'Connected', 'Interested', 'Follow-ups Set', 'Reqs Collected', 'Appointments'];
    const rows = telecallersData.map(r => [
      `"${r.name}"`,
      `"${r.email}"`,
      r.assigned,
      r.called,
      r.totalCalls,
      r.connected,
      r.interested,
      r.followUpsCreated,
      r.requirementsCollected,
      r.appointments
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telecaller_performance_${startDateStr}_to_${endDateStr}.csv`;
    a.click();
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
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
            <TrendingUp size={22} color="var(--brand-blue)" />
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Telecaller Performance Matrix
            </h1>
            <span className="badge badge-neutral" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
              Velocity & Conversion
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Cross-telecaller activity volume, contact rates, and conversion pipeline progress.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExport}
          className="btn btn-secondary"
          style={{ gap: '0.45rem', fontSize: '0.8125rem' }}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Date Range & Staff Filter Bar */}
      <div className="glass-panel" style={{
        padding: '0.85rem 1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        {/* Date Range Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          {(
            [
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'this_week', label: 'This Week' },
              { key: 'this_month', label: 'This Month' },
              { key: 'custom', label: 'Custom Range' }
            ] as const
          ).map(p => {
            const isActive = preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: '9999px',
                  border: isActive ? '1px solid var(--brand-blue)' : '1px solid var(--border-color)',
                  background: isActive ? 'var(--brand-blue)' : 'var(--glass-bg-subtle)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Custom Date Pickers */}
        {preset === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}
            />
          </div>
        )}

        {/* Staff Filter */}
        {userRole !== 'telecaller' && (
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.65rem', minWidth: '180px' }}
          >
            <option value="all">All Telecallers</option>
            {availableStaff.map(s => (
              <option key={s.email} value={s.email}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Range Info */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0 0.5rem' }}>
        Showing telemetry from <strong>{formatIstDate(startDateStr)}</strong> to <strong>{formatIstDate(endDateStr)}</strong> (Asia/Kolkata).
      </div>

      {/* Performance Matrix Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer', minWidth: '160px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    Telecaller <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('assigned')} style={{ cursor: 'pointer', minWidth: '85px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Assigned <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('called')} style={{ cursor: 'pointer', minWidth: '85px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Called <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('totalCalls')} style={{ cursor: 'pointer', minWidth: '95px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Total Calls <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('connected')} style={{ cursor: 'pointer', minWidth: '95px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Connected <ArrowUpDown size={12} />
                  </div>
                </th>
                <th style={{ minWidth: '90px', textAlign: 'center' }}>
                  Connect Rate
                </th>
                <th onClick={() => handleSort('interested')} style={{ cursor: 'pointer', minWidth: '90px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Interested <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('followUpsCreated')} style={{ cursor: 'pointer', minWidth: '100px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Follow-ups <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('requirementsCollected')} style={{ cursor: 'pointer', minWidth: '110px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Req Collected <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('appointments')} style={{ cursor: 'pointer', minWidth: '105px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    Appts/Meets <ArrowUpDown size={12} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {telecallersData.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                    No telecaller activity found in this date range.
                  </td>
                </tr>
              ) : (
                telecallersData.map(tc => {
                  const connectRate = tc.totalCalls > 0 ? Math.round((tc.connected / tc.totalCalls) * 100) : 0;
                  return (
                    <tr key={tc.email}>
                      <td>
                        <strong>{tc.name}</strong>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{tc.email}</div>
                      </td>
                      <td className="mono" style={{ textAlign: 'center' }}>{tc.assigned}</td>
                      <td className="mono" style={{ textAlign: 'center', color: '#10b981', fontWeight: 700 }}>{tc.called}</td>
                      <td className="mono" style={{ textAlign: 'center', fontWeight: 700 }}>{tc.totalCalls}</td>
                      <td className="mono" style={{ textAlign: 'center', color: '#10b981' }}>{tc.connected}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${connectRate >= 50 ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '0.72rem' }}>
                          {connectRate}%
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'center', color: '#059669', fontWeight: 700 }}>{tc.interested}</td>
                      <td className="mono" style={{ textAlign: 'center', color: '#8b5cf6' }}>{tc.followUpsCreated}</td>
                      <td className="mono" style={{ textAlign: 'center', color: '#d97706', fontWeight: 600 }}>{tc.requirementsCollected}</td>
                      <td className="mono" style={{ textAlign: 'center', color: '#2563eb', fontWeight: 600 }}>{tc.appointments + tc.meetings}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
