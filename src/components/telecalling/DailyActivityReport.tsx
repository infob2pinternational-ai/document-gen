import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { Lead } from '../../types';
import { telecallingService, type DailyActivityReportData } from '../../services/telecallingService';
import { leadService } from '../../services/leadService';
import { errorService, type AppErrorLog } from '../../services/errorService';
import { isCloudActive } from '../../services/db';
import { metricsService } from '../../services/metricsService';
import { 
  getIstTodayDateStr, 
  getIstYesterdayDateStr, 
  formatIstDate, 
  formatIstDateTime 
} from '../../utils/dateUtils';
import { getAvailableStaffList } from '../../utils/staffUtils';
import { CallHistoryModal } from './CallHistoryModal';
import { 
  BarChart3, 
  Calendar, 
  Download, 
  Printer, 
  Search, 
  ArrowRight,
  Eye,
  Activity,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  RotateCcw,
  Check
} from 'lucide-react';

interface DailyActivityReportProps {
  userRole?: string;
  userEmail?: string;
  onNavigateTab?: (tab: string) => void;
  onOpenLead?: (id: string) => void;
}

export const DailyActivityReport: React.FC<DailyActivityReportProps> = ({
  userRole = 'owner',
  userEmail = 'owner@b2p.com',
  onNavigateTab
}) => {
  const [activeView, setActiveView] = useState<'report' | 'diagnostics'>('report');
  const [errorLogs, setErrorLogs] = useState<AppErrorLog[]>([]);
  const [errorFilter, setErrorFilter] = useState<'all' | 'unresolved'>('unresolved');
  const [errorSearch, setErrorSearch] = useState('');

  const refreshErrors = useCallback(async () => {
    setErrorLogs(errorService.getLocalErrors());
    try {
      const logs = await errorService.getErrors();
      setErrorLogs(logs);
    } catch (e) {
      console.warn('[DailyActivityReport] Could not fetch cloud error logs:', e);
    }
  }, []);

  useEffect(() => {
    refreshErrors();
    const unsub = metricsService.subscribe(refreshErrors);
    return unsub;
  }, [refreshErrors]);

  const unresolvedCount = useMemo(() => {
    return errorLogs.filter(e => !e.resolved).length;
  }, [errorLogs]);

  const filteredErrors = useMemo(() => {
    return errorLogs.filter(err => {
      if (errorFilter === 'unresolved' && err.resolved) return false;
      if (errorSearch) {
        const q = errorSearch.toLowerCase();
        const match = 
          (err.operation && err.operation.toLowerCase().includes(q)) ||
          (err.screen && err.screen.toLowerCase().includes(q)) ||
          (err.error_message && err.error_message.toLowerCase().includes(q)) ||
          (err.user_email && err.user_email.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [errorLogs, errorFilter, errorSearch]);

  const handleResolveError = async (id: string) => {
    await errorService.resolveError(id);
    refreshErrors();
  };

  const handleClearErrors = () => {
    if (confirm('Clear local error logs?')) {
      errorService.clearLocalErrors();
      refreshErrors();
    }
  };

  const [selectedDate, setSelectedDate] = useState<string>(getIstTodayDateStr());
  const [selectedStaff, setSelectedStaff] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [historyModalLead, setHistoryModalLead] = useState<Lead | null>(null);

  const reportData: DailyActivityReportData = useMemo(() => {
    return telecallingService.getDailyActivityReport(selectedDate, selectedStaff);
  }, [selectedDate, selectedStaff]);

  const availableStaff = useMemo(() => {
    const leads = leadService.getLeads();
    return getAvailableStaffList(userEmail, leads);
  }, [userEmail]);

  // Filtered timeline rows
  const filteredTimeline = useMemo(() => {
    return reportData.activityTimeline.filter(item => {
      if (outcomeFilter !== 'all' && item.outcome !== outcomeFilter) return false;
      if (timelineSearch) {
        const term = timelineSearch.toLowerCase();
        const match = 
          item.companyName.toLowerCase().includes(term) ||
          item.contactPerson.toLowerCase().includes(term) ||
          item.telecallerName.toLowerCase().includes(term) ||
          item.remarks.toLowerCase().includes(term) ||
          item.phone.includes(term);
        if (!match) return false;
      }
      return true;
    });
  }, [reportData.activityTimeline, outcomeFilter, timelineSearch]);

  const handleExportCsv = () => {
    const headers = ['Time (IST)', 'Company', 'Contact Person', 'Phone', 'Telecaller', 'Outcome', 'Remarks', 'Next Follow-up'];
    const rows = filteredTimeline.map(item => [
      `"${item.timeStr}"`,
      `"${item.companyName.replace(/"/g, '""')}"`,
      `"${item.contactPerson.replace(/"/g, '""')}"`,
      `"${item.phone}"`,
      `"${item.telecallerName}"`,
      `"${item.outcome}"`,
      `"${item.remarks.replace(/"/g, '""')}"`,
      `"${item.nextFollowUpAt ? formatIstDateTime(item.nextFollowUpAt) : ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `b2p_eod_report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header & Date/Staff Selector */}
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
            <BarChart3 size={22} color="var(--brand-blue)" />
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Telecalling — {activeView === 'report' ? 'End of Day Report' : 'System Diagnostics'}
            </h1>
            <span className="badge badge-success" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
              Audit-Verified
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            {activeView === 'report'
              ? 'Authoritative, factual activity breakdown calculated from real database records in Kerala time (Asia/Kolkata).'
              : 'Real-time observability, live database dual-write sync status, and system error telemetry.'}
          </p>
        </div>

        {/* View Switcher (for Owner/Admin) */}
        {userRole !== 'telecaller' && (
          <div style={{
            display: 'inline-flex',
            padding: '0.25rem',
            borderRadius: '10px',
            background: 'var(--glass-bg-subtle)',
            border: '1px solid var(--border-color)',
            gap: '0.35rem'
          }}>
            <button
              type="button"
              onClick={() => setActiveView('report')}
              className={`btn ${activeView === 'report' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', gap: '0.4rem', fontWeight: 700 }}
            >
              <BarChart3 size={14} /> EOD Report
            </button>
            <button
              type="button"
              onClick={() => setActiveView('diagnostics')}
              className={`btn ${activeView === 'diagnostics' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', gap: '0.4rem', fontWeight: 700 }}
            >
              <Activity size={14} /> System Diagnostics
              {unresolvedCount > 0 && (
                <span style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: '0.6875rem',
                  padding: '0.1rem 0.45rem',
                  borderRadius: '9999px',
                  fontWeight: 800
                }}>
                  {unresolvedCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Date & Filter Controls (shown when activeView === 'report') */}
        {activeView === 'report' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Quick Date Presets */}
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                onClick={() => setSelectedDate(getIstTodayDateStr())}
                className={`btn ${selectedDate === getIstTodayDateStr() ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(getIstYesterdayDateStr())}
                className={`btn ${selectedDate === getIstYesterdayDateStr() ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
              >
                Yesterday
              </button>
            </div>

            {/* Date Picker Input */}
            <div style={{ position: 'relative' }}>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
              />
            </div>

            {/* Staff Filter Dropdown */}
            <select
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
              style={{ fontSize: '0.8125rem', padding: '0.4rem 0.65rem', minWidth: '180px' }}
            >
              <option value="all">All Telecallers (Team Total)</option>
              {availableStaff.map(s => (
                <option key={s.email} value={s.email}>{s.name}</option>
              ))}
            </select>

            {/* Export & Print */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
              title="Export CSV"
            >
              <Download size={14} />
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.65rem', fontSize: '0.8125rem' }}
              title="Print Summary"
            >
              <Printer size={14} />
            </button>
          </div>
        )}
      </div>

      {activeView === 'diagnostics' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Health Status Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid #10b981' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Cloud Connectivity
                </span>
                <ShieldCheck size={16} color="#10b981" />
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.35rem' }}>
                {isCloudActive() ? 'Supabase Online' : 'Local Storage Cache'}
              </div>
              <span style={{ fontSize: '0.72rem', color: isCloudActive() ? '#059669' : 'var(--text-muted)' }}>
                {isCloudActive() ? 'Real-time database sync active' : 'Offline resilient mode'}
              </span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', borderLeft: unresolvedCount > 0 ? '4px solid #ef4444' : '4px solid #10b981' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Unresolved Errors
                </span>
                {unresolvedCount > 0 ? <AlertTriangle size={16} color="#ef4444" /> : <CheckCircle2 size={16} color="#10b981" />}
              </div>
              <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: unresolvedCount > 0 ? '#ef4444' : '#10b981', marginTop: '0.15rem' }}>
                {unresolvedCount}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {unresolvedCount === 0 ? 'All operations normal' : 'Requires review'}
              </span>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--brand-blue)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Total Logged Events
                </span>
                <Activity size={16} color="var(--brand-blue)" />
              </div>
              <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                {errorLogs.length}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Logged to Supabase & local buffer
              </span>
            </div>
          </div>

          {/* Diagnostics Filter & Actions Bar */}
          <div className="glass-panel" style={{
            padding: '0.85rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setErrorFilter('unresolved')}
                className={`btn ${errorFilter === 'unresolved' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
              >
                Unresolved Only ({unresolvedCount})
              </button>
              <button
                type="button"
                onClick={() => setErrorFilter('all')}
                className={`btn ${errorFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
              >
                All Logs ({errorLogs.length})
              </button>

              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={errorSearch}
                  onChange={(e) => setErrorSearch(e.target.value)}
                  placeholder="Filter logs..."
                  style={{ width: '100%', paddingLeft: '2rem', paddingRight: '0.5rem', paddingTop: '0.3rem', paddingBottom: '0.3rem', fontSize: '0.78rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={refreshErrors}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', gap: '0.3rem' }}
                title="Refresh error list"
              >
                <RotateCcw size={13} /> Refresh
              </button>
              <button
                type="button"
                onClick={handleClearErrors}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', gap: '0.3rem', color: '#ef4444' }}
                title="Clear local logs"
              >
                <Trash2 size={13} /> Clear Logs
              </button>
            </div>
          </div>

          {/* Diagnostics Error Table */}
          <div className="glass-panel" style={{ overflow: 'hidden' }}>
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: '150px' }}>Timestamp (IST)</th>
                    <th style={{ minWidth: '130px' }}>Operation</th>
                    <th style={{ minWidth: '130px' }}>Screen</th>
                    <th style={{ minWidth: '140px' }}>User</th>
                    <th style={{ minWidth: '220px' }}>Error Details</th>
                    <th style={{ minWidth: '100px' }}>Status</th>
                    <th style={{ minWidth: '110px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredErrors.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                        <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 0.5rem auto', opacity: 0.7 }} />
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {errorFilter === 'unresolved' ? 'No unresolved issues!' : 'No error logs recorded.'}
                        </div>
                        <div style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
                          Application operations and telecalling updates are running smoothly.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredErrors.map(err => (
                      <tr key={err.id}>
                        <td>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                            {formatIstDateTime(err.timestamp)}
                          </div>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                            {err.operation}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {err.screen || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {err.user_email}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.78rem', color: '#ef4444', fontWeight: 600 }}>
                            {err.error_message}
                          </div>
                          {err.metadata && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem', fontFamily: 'monospace' }}>
                              {JSON.stringify(err.metadata)}
                            </div>
                          )}
                        </td>
                        <td>
                          {err.resolved ? (
                            <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Resolved</span>
                          ) : (
                            <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>Active</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!err.resolved && (
                            <button
                              type="button"
                              onClick={() => handleResolveError(err.id)}
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', gap: '0.25rem' }}
                            >
                              <Check size={12} /> Acknowledge
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Date Banner */}
          <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.25rem',
        borderRadius: '12px',
        background: 'var(--glass-bg-subtle)',
        border: '1px solid var(--border-color)',
        fontSize: '0.875rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calendar size={16} color="var(--brand-blue)" />
          <span>Reporting Date: <strong>{formatIstDate(selectedDate)}</strong> ({selectedDate})</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Timezone: <strong>Asia/Kolkata (IST, UTC+05:30)</strong>
        </div>
      </div>

      {/* Section 8: Overall Team Summary */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Overall Team Summary
        </h2>

        {/* Big Numbers Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '0.75rem'
        }}>
          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Assigned</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
              {reportData.overall.assigned}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>In active queue</span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#059669', textTransform: 'uppercase' }}>Called</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', marginTop: '0.15rem' }}>
              {reportData.overall.called}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Unique clients called</span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--brand-blue)', textTransform: 'uppercase' }}>Remaining</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.15rem' }}>
              {reportData.overall.remaining}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Pending today</span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Calls Placed</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
              {reportData.overall.totalCalls}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Includes redials</span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase' }}>Connected</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', marginTop: '0.15rem' }}>
              {reportData.overall.connected}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {reportData.overall.totalCalls > 0 ? Math.round((reportData.overall.connected / reportData.overall.totalCalls) * 100) : 0}% connect rate
            </span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>Interested</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#d97706', marginTop: '0.15rem' }}>
              {reportData.overall.interested}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Positive inquiries</span>
          </div>

          <div style={{ padding: '0.85rem 1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase' }}>Follow-ups Set</span>
            <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#8b5cf6', marginTop: '0.15rem' }}>
              {reportData.overall.followUpsCreated}
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Future calls booked</span>
          </div>
        </div>

        {/* Detailed Outcome Counter Pills */}
        <div style={{
          marginTop: '1.25rem',
          padding: '1rem',
          borderRadius: '12px',
          background: 'var(--glass-bg-subtle)',
          border: '1px solid var(--border-color)'
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '0.65rem' }}>
            Complete Outcome Breakdown
          </span>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Connected:</span>
              <strong className="mono" style={{ color: '#10b981' }}>{reportData.overall.connected}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>No Answer:</span>
              <strong className="mono">{reportData.overall.noAnswer}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Not Reachable:</span>
              <strong className="mono">{reportData.overall.notReachable}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Switched Off:</span>
              <strong className="mono">{reportData.overall.switchedOff}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Invalid Number:</span>
              <strong className="mono" style={{ color: '#ef4444' }}>{reportData.overall.invalid}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Interested:</span>
              <strong className="mono" style={{ color: '#059669' }}>{reportData.overall.interested}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Not Interested:</span>
              <strong className="mono" style={{ color: '#dc2626' }}>{reportData.overall.notInterested}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Req Collected:</span>
              <strong className="mono" style={{ color: '#d97706' }}>{reportData.overall.requirementsCollected}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Appointments:</span>
              <strong className="mono" style={{ color: '#2563eb' }}>{reportData.overall.appointments}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Meetings:</span>
              <strong className="mono" style={{ color: '#4f46e5' }}>{reportData.overall.meetings}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Details Sent:</span>
              <strong className="mono" style={{ color: '#0284c7' }}>{reportData.overall.detailsSent}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0.6rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.78rem' }}>
              <span>Other / Misc:</span>
              <strong className="mono">{reportData.overall.other}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Section 9 & 11: Telecaller-Wise Breakdown (Accountability) */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
          Telecaller-Wise Performance & Accountability
        </h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Factual daily metrics showing exactly what each telecaller accomplished on {formatIstDate(selectedDate)}.
        </p>

        {reportData.telecallers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
            No telecaller activity recorded on this date.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '1rem' }}>
            {reportData.telecallers.map(tc => {
              const connectRate = tc.totalCalls > 0 ? Math.round((tc.connected / tc.totalCalls) * 100) : 0;
              return (
                <div
                  key={tc.email}
                  style={{
                    padding: '1.15rem',
                    borderRadius: '14px',
                    background: 'var(--glass-bg-subtle)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                        {tc.name}
                      </h3>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {tc.email}
                      </div>
                    </div>
                    <span className="badge badge-info" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                      {connectRate}% Connect
                    </span>
                  </div>

                  {/* Summary Grid for this telecaller */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    <div style={{ padding: '0.5rem', background: 'var(--bg-card)', borderRadius: '8px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>Assigned</span>
                      <strong className="mono" style={{ fontSize: '1.15rem' }}>{tc.assigned}</strong>
                    </div>
                    <div style={{ padding: '0.5rem', background: 'var(--bg-card)', borderRadius: '8px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: '#10b981', textTransform: 'uppercase', display: 'block' }}>Called</span>
                      <strong className="mono" style={{ fontSize: '1.15rem', color: '#10b981' }}>{tc.called}</strong>
                    </div>
                    <div style={{ padding: '0.5rem', background: 'var(--bg-card)', borderRadius: '8px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--brand-blue)', textTransform: 'uppercase', display: 'block' }}>Remaining</span>
                      <strong className="mono" style={{ fontSize: '1.15rem', color: 'var(--brand-blue)' }}>{tc.remaining}</strong>
                    </div>
                  </div>

                  {/* Factual Metrics Table */}
                  <div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Total Calls Placed:</span>
                      <strong className="mono">{tc.totalCalls}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Connected Calls:</span>
                      <strong className="mono" style={{ color: '#10b981' }}>{tc.connected}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Interested Leads:</span>
                      <strong className="mono" style={{ color: '#059669' }}>{tc.interested}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Follow-ups Scheduled:</span>
                      <strong className="mono" style={{ color: '#8b5cf6' }}>{tc.followUpsCreated}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Requirements Collected:</span>
                      <strong className="mono" style={{ color: '#d97706' }}>{tc.requirementsCollected}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>No Answer / Reachable:</span>
                      <strong className="mono">{tc.noAnswer + tc.notReachable}</strong>
                    </div>
                  </div>

                  {/* Filter View for this Telecaller */}
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(tc.email)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.4rem', justifyContent: 'center', marginTop: '0.25rem' }}
                  >
                    View Details for {tc.name}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 10: Detailed Daily Activity Log */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Detailed Daily Activity Log
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing {filteredTimeline.length} activities on {formatIstDate(selectedDate)}
            </span>
          </div>

          {/* Timeline Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '200px' }}>
              <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={timelineSearch}
                onChange={(e) => setTimelineSearch(e.target.value)}
                placeholder="Search company or remark..."
                style={{ width: '100%', paddingLeft: '2rem', paddingRight: '0.5rem', paddingTop: '0.3rem', paddingBottom: '0.3rem', fontSize: '0.78rem' }}
              />
            </div>

            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.55rem' }}
            >
              <option value="all">All Outcomes</option>
              <option value="Connected">Connected</option>
              <option value="Interested">Interested</option>
              <option value="Requirement Collected">Requirement Collected</option>
              <option value="Appointment Confirmed">Appointment Confirmed</option>
              <option value="Meeting Scheduled">Meeting Scheduled</option>
              <option value="Call Back">Call Back</option>
              <option value="Follow-up Required">Follow-up Required</option>
              <option value="No Answer">No Answer</option>
              <option value="Not Reachable">Not Reachable</option>
              <option value="Switched Off">Switched Off</option>
              <option value="Invalid Number">Invalid Number</option>
              <option value="Not Interested">Not Interested</option>
            </select>
          </div>
        </div>

        <div className="table-responsive" style={{ maxHeight: '420px', overflowY: 'auto' }}>
          <table style={{ fontSize: '0.8125rem' }}>
            <thead>
              <tr>
                <th style={{ minWidth: '95px' }}>Time (IST)</th>
                <th style={{ minWidth: '160px' }}>Company</th>
                <th style={{ minWidth: '130px' }}>Telecaller</th>
                <th style={{ minWidth: '140px' }}>Outcome</th>
                <th style={{ minWidth: '220px' }}>Remarks</th>
                <th style={{ minWidth: '130px' }}>Next Follow-up</th>
                <th style={{ minWidth: '60px', textAlign: 'center' }}>History</th>
              </tr>
            </thead>
            <tbody>
              {filteredTimeline.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                    No call activities logged for this selection.
                  </td>
                </tr>
              ) : (
                filteredTimeline.map(item => {
                  return (
                    <tr key={item.id}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {item.timeStr}
                      </td>
                      <td>
                        <strong>{item.companyName}</strong>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {item.contactPerson} ({item.phone})
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{item.telecallerName}</span>
                      </td>
                      <td>
                        <span 
                          className="badge"
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            background: item.outcome === 'Interested' || item.outcome === 'Connected'
                              ? 'rgba(16, 185, 129, 0.12)'
                              : 'rgba(100, 116, 139, 0.12)',
                            color: item.outcome === 'Interested' || item.outcome === 'Connected'
                              ? '#059669'
                              : 'var(--text-primary)'
                          }}
                        >
                          {item.outcome}
                        </span>
                      </td>
                      <td style={{ maxWidth: '280px', lineHeight: 1.4 }}>
                        {item.remarks}
                      </td>
                      <td>
                        {item.nextFollowUpAt ? (
                          <span style={{ color: 'var(--brand-blue)', fontWeight: 600, fontSize: '0.75rem' }}>
                            {formatIstDateTime(item.nextFollowUpAt)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            const l = leadService.getLeadById(item.leadId);
                            if (l) setHistoryModalLead(l);
                          }}
                          className="btn-ghost"
                          style={{ padding: '0.3rem' }}
                          title="View Lead History"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 12: End-of-Day Insights & Pending Work */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
          End-of-Day Insights & Next Day Pipeline
        </h2>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Action items to kickstart operations for the following morning.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {/* Uncontacted Leads */}
          <div style={{ padding: '1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Leads Not Contacted Today
              </span>
              <span className="badge badge-warning">
                {reportData.pendingWork.uncontactedLeads.length}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Assigned companies that did not receive a call during this business day.
            </p>
            {reportData.pendingWork.uncontactedLeads.length > 0 && onNavigateTab ? (
              <button
                type="button"
                onClick={() => onNavigateTab('todays-calls')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', marginTop: '0.75rem', gap: '0.3rem' }}
              >
                Open Today's Calling Queue <ArrowRight size={13} />
              </button>
            ) : null}
          </div>

          {/* Follow-ups Due Tomorrow */}
          <div style={{ padding: '1rem', borderRadius: '12px', background: 'var(--glass-bg-subtle)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Follow-ups Due Tomorrow
              </span>
              <span className="badge badge-info">
                {reportData.pendingWork.followUpsDueTomorrow.length}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Scheduled callbacks and meetings lined up for the next business day.
            </p>
            {onNavigateTab ? (
              <button
                type="button"
                onClick={() => onNavigateTab('follow-ups')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', marginTop: '0.75rem', gap: '0.3rem' }}
              >
                View Follow-ups Desk <ArrowRight size={13} />
              </button>
            ) : null}
          </div>

          {/* Interested Leads Requiring Action */}
          <div style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#059669' }}>
                Interested Leads Awaiting Action
              </span>
              <span className="badge badge-success">
                {reportData.pendingWork.interestedRequiringAttention.length}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Hot prospects from calls that require quotation drafting or admin follow-through.
            </p>
            {onNavigateTab ? (
              <button
                type="button"
                onClick={() => onNavigateTab('leads')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', marginTop: '0.75rem', gap: '0.3rem' }}
              >
                View CRM Leads Pipeline <ArrowRight size={13} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Call History Modal */}
      {historyModalLead && (
        <CallHistoryModal
          lead={historyModalLead}
          isOpen={Boolean(historyModalLead)}
          onClose={() => setHistoryModalLead(null)}
        />
      )}

    </div>
  );
};
