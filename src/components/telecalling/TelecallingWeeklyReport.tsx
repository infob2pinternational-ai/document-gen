import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Share2, 
  Download, 
  Printer, 
  TrendingUp, 
  CheckCircle2, 
  AlertCircle,
  Settings,
  Loader2
} from 'lucide-react';
import type { CompanyProfile, TelecallingEntry, TelecallingStatus, TelecallingWeeklyReportData } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { 
  getKolkataToday, 
  getKolkataWeekRange,
  getKolkataMonthRange,
  shiftKolkataMonth,
  shiftKolkataWeek, 
  formatKolkataDisplayDate 
} from '../../utils/dateUtils';
import { 
  buildWeeklyReportWhatsAppMessage, 
  openWhatsAppShare, 
  getOwnerWhatsAppNumber 
} from '../../utils/telecallingShare';
import { TelecallingEditModal } from './TelecallingEditModal';
import { OwnerWhatsAppModal } from './OwnerWhatsAppModal';

const KPI_FILTERS: { id: string; label: string; description: string; color: string; statuses: TelecallingStatus[] }[] = [
  { id: 'all', label: 'All Calls', description: '', color: '#3b82f6', statuses: [] },
  { id: 'appointments', label: 'Appointments', description: 'Meetings scheduled', color: '#16a34a', statuses: ['Appointment Confirmed'] },
  { id: 'interested', label: 'Interested / Sent', description: 'Details shared', color: '#2563eb', statuses: ['Interested / Details Shared'] },
  { id: 'follow-ups', label: 'Follow-ups', description: 'Active pipeline', color: '#d97706', statuses: ['Follow-up Required', 'Call Back'] },
  { id: 'no-response', label: 'No Response', description: 'Unreachable / off', color: '#64748b', statuses: ['No Answer / No Response', 'Not Reachable / Switched Off'] },
  { id: 'no-interest', label: 'No Interest', description: 'Declined', color: '#ef4444', statuses: ['No Interest'] }
];

interface TelecallingWeeklyReportProps {
  activeProfile: CompanyProfile | null;
  user: any;
  userRole?: string;
  onNavigateToDailyReport?: () => void;
  period?: 'weekly' | 'monthly';
}

export const TelecallingWeeklyReport: React.FC<TelecallingWeeklyReportProps> = ({
  activeProfile,
  onNavigateToDailyReport,
  period = 'weekly'
}) => {
  const companyId = activeProfile?.id || '';
  const periodTitle = period === 'monthly' ? 'Monthly' : 'Weekly';
  const periodUnit = period === 'monthly' ? 'Month' : 'Week';

  // Selected calendar period
  const [periodStart, setPeriodStart] = useState<string>(() => {
    return (period === 'monthly' ? getKolkataMonthRange : getKolkataWeekRange)(getKolkataToday()).startDate;
  });

  const periodInfo = (period === 'monthly' ? getKolkataMonthRange : getKolkataWeekRange)(periodStart);

  const requestId = useRef(0);
  const [selectedEntry, setSelectedEntry] = useState<{ entry: TelecallingEntry; readOnly: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadedReport, setReportData] = useState<(TelecallingWeeklyReportData & { companyId: string }) | null>(null);
  const reportData = loadedReport?.companyId === companyId && loadedReport.startDate === periodInfo.startDate && loadedReport.endDate === periodInfo.endDate ? loadedReport : null;
  const [loading, setLoading] = useState(false);
  const [activeKpi, setActiveKpi] = useState('all');
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [shareError, setShareError] = useState('');

  const loadReport = useCallback(async () => {
    const request = ++requestId.current;
    setLoadError('');
    if (!companyId) { setReportData(null); setLoading(false); return; }
    setLoading(true);
    setShareError('');
    try {
      const entries = await telecallingService.getEntriesForPeriod(
        companyId,
        periodInfo.startDate,
        periodInfo.endDate
      );
      const computed = telecallingService.computePeriodReport(
        entries,
        periodInfo.startDate,
        periodInfo.endDate
      );
      if (request === requestId.current) setReportData({ ...computed, companyId });
    } catch (err) {
      if (request === requestId.current) {
        setReportData(null);
        setLoadError(err instanceof Error ? err.message : 'Unable to load the report. Please retry.');
      }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [companyId, periodInfo.startDate, periodInfo.endDate]);

  useEffect(() => {
    setActiveKpi('all');
    setSelectedEntry(null);
    setReportData(null);
    void loadReport();
    return () => { requestId.current++; };
  }, [loadReport, period]);

  const handlePrevPeriod = () => {
    setPeriodStart(prev => (period === 'monthly' ? shiftKolkataMonth : shiftKolkataWeek)(prev, -1));
  };

  const handleNextPeriod = () => {
    setPeriodStart(prev => (period === 'monthly' ? shiftKolkataMonth : shiftKolkataWeek)(prev, 1));
  };

  const handleCurrentPeriod = () => {
    setPeriodStart((period === 'monthly' ? getKolkataMonthRange : getKolkataWeekRange)(getKolkataToday()).startDate);
  };

  const selectedKpi = KPI_FILTERS.find(kpi => kpi.id === activeKpi) || KPI_FILTERS[0];
  const filteredReport = reportData && (activeKpi === 'all' ? reportData : telecallingService.computePeriodReport(
    reportData.entries.filter(entry => selectedKpi.statuses.includes(entry.call_status)),
    periodInfo.startDate,
    periodInfo.endDate
  ));

  // WhatsApp Share
  const handleShareWhatsApp = () => {
    if (!filteredReport) return;
    setShareError('');
    setShareSuccess(false);

    const ownerPhone = getOwnerWhatsAppNumber();
    if (!ownerPhone) {
      setOwnerModalOpen(true);
      return;
    }

    const message = (activeKpi === 'all' ? '' : `Filter: ${selectedKpi.label}\n\n`) + buildWeeklyReportWhatsAppMessage(
      activeProfile?.name || 'B2P International',
      filteredReport,
      period
    );
    const result = openWhatsAppShare(message, ownerPhone);

    if (result.success) {
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } else {
      setShareError(result.error || 'Failed to share report');
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (!filteredReport?.entries.length) return;
    const headers = ['Date', 'Day', 'Company', 'Contact', 'Phone', 'Call Result', 'Feedback', 'Telecaller'];
    const rows = filteredReport.entries.map(e => [
      `"${e.entry_date}"`,
      `"${new Date(e.entry_date).toLocaleDateString('en-US', { weekday: 'short' })}"`,
      `"${(e.company_name || '').replace(/"/g, '""')}"`,
      `"${(e.contact_person || '').replace(/"/g, '""')}"`,
      `"${e.phone || ''}"`,
      `"${e.call_status}"`,
      `"${(e.feedback || '').replace(/"/g, '""')}"`,
      `"${e.created_by_name || e.created_by_email?.split('@')[0] || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Telecalling_${periodTitle}_Report_${periodInfo.startDate}_to_${periodInfo.endDate}${activeKpi === 'all' ? '' : `_${activeKpi}`}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="telecalling-weekly-container" style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '1.25rem'
      }}>
        <div>
          <h2 style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            margin: 0,
            color: 'var(--text-primary, #0f172a)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <TrendingUp size={24} color="#3b82f6" />
            Telecalling {periodTitle} Report
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
            Single-source aggregation for {periodInfo.label}
          </p>
        </div>

        {/* Action Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setOwnerModalOpen(true)}
            className="btn-secondary"
            title="Configure Owner WhatsApp Phone"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Settings size={15} />
            <span>Owner Phone</span>
          </button>

          <button
            onClick={handleShareWhatsApp}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              background: '#16a34a',
              borderColor: '#16a34a'
            }}
          >
            <Share2 size={15} />
            <span>Share to Owner WhatsApp</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="btn-secondary"
            disabled={!filteredReport?.entries.length || loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => window.print()}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Printer size={15} />
            <span>Print</span>
          </button>

          {onNavigateToDailyReport && (
            <button
              onClick={onNavigateToDailyReport}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
            >
              <Calendar size={15} color="#3b82f6" />
              <span>Daily Report</span>
            </button>
          )}
        </div>
      </div>

      {/* Share Notifications */}
      {shareSuccess && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#f0fdf4',
          borderLeft: '4px solid #16a34a',
          color: '#166534',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem'
        }}>
          <CheckCircle2 size={16} />
          <span>WhatsApp opened with pre-filled {periodTitle} Report!</span>
        </div>
      )}

      {shareError && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#fee2e2',
          borderLeft: '4px solid #ef4444',
          color: '#991b1b',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={16} />
          <span>{shareError}</span>
        </div>
      )}

      {loadError && <div role="alert" style={{ marginBottom: '1rem', color: '#b91c1c' }}>{loadError} <button type="button" className="btn-secondary" onClick={() => void loadReport()}>Retry</button></div>}
      {/* Period Selector Bar */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '10px',
        padding: '0.85rem 1.25rem',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button onClick={handlePrevPeriod} className="btn-secondary" style={{ padding: '0.4rem 0.6rem' }}>
            <ChevronLeft size={16} />
            <span>Prev {periodUnit}</span>
          </button>

          <button onClick={handleCurrentPeriod} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
            Current {periodUnit}
          </button>

          <button onClick={handleNextPeriod} className="btn-secondary" style={{ padding: '0.4rem 0.6rem' }}>
            <span>Next {periodUnit}</span>
            <ChevronRight size={16} />
          </button>
        </div>

        {period === 'monthly' && <input type="month" aria-label="Report month" value={periodInfo.startDate.slice(0, 7)} onChange={event => { if (event.target.value) setPeriodStart(`${event.target.value}-01`); }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Calendar size={18} color="#3b82f6" />
          <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
            {periodInfo.label}
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto', color: '#3b82f6' }} />
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#64748b' }}>Computing {period} performance statistics...</p>
        </div>
      ) : reportData && filteredReport ? (
        <>
          {/* Top Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.85rem',
            marginBottom: '1.25rem'
          }}>
            {KPI_FILTERS.map(kpi => {
              const selected = activeKpi === kpi.id;
              const count = kpi.id === 'all' ? reportData.totalCalls :
                kpi.statuses.reduce((total, status) => total + reportData.statusCounts[status], 0);
              return (
                <button
                  key={kpi.id}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="period-filtered-results"
                  aria-label={`${kpi.id === 'all' ? `${periodTitle} Calls` : kpi.label}: ${count} calls`}
                  onClick={() => setActiveKpi(kpi.id)}
                  style={{
                    background: 'var(--bg-primary, #ffffff)',
                    border: `1px solid ${selected ? kpi.color : 'var(--border-color, #e2e8f0)'}`,
                    borderLeft: `4px solid ${kpi.color}`,
                    borderRadius: '10px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    justifyContent: 'flex-start',
                    gap: '0.4rem',
                    minWidth: 0,
                    minHeight: '140px',
                    whiteSpace: 'normal',
                    textAlign: 'left',
                    font: 'inherit',
                    cursor: 'pointer',
                    boxShadow: selected ? `0 0 0 2px ${kpi.color}` : 'none'
                  }}
                >
                  <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: kpi.color, textTransform: 'uppercase' }}>{kpi.id === 'all' ? `${periodTitle} Calls` : kpi.label}</span>
                  <span style={{ display: 'block', fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)', margin: '0.2rem 0' }}>{count}</span>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                    {kpi.id === 'all' ? `${reportData.uniqueCompanies} unique companies` : kpi.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div id="period-filtered-results">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <span role="status" style={{ color: 'var(--text-primary, #0f172a)' }}>
                {activeKpi === 'all' ? `${periodTitle} Calls` : selectedKpi.label}: showing {filteredReport?.totalCalls || 0} of {reportData.totalCalls} calls
              </span>
              {activeKpi !== 'all' && (
                <button type="button" className="btn-secondary" onClick={() => setActiveKpi('all')}>Clear filter</button>
              )}
            </div>

            {/* Daily Breakdown Table */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.25rem'
            }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>
                Day-by-Day Activity Trend {period === 'weekly' ? '(Monday to Sunday)' : '(Full Month)'}:
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Day & Date</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Total Calls</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Appointment</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Interested</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Follow-up</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>No Response</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>No Interest</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Invalid / Other</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReport.dailyBreakdown.map((d) => (
                      <tr key={d.date} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          {d.dayName} ({formatKolkataDisplayDate(d.date)})
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: d.totalCalls > 0 ? '#2563eb' : '#64748b' }}>
                          {d.totalCalls}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#166534', fontWeight: 600 }}>
                          {d.statusCounts['Appointment Confirmed']}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#1e40af', fontWeight: 600 }}>
                          {d.statusCounts['Interested / Details Shared']}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#92400e', fontWeight: 600 }}>
                          {d.statusCounts['Follow-up Required'] + d.statusCounts['Call Back']}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#475569' }}>
                          {d.statusCounts['No Answer / No Response'] + d.statusCounts['Not Reachable / Switched Off']}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#991b1b' }}>
                          {d.statusCounts['No Interest']}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b' }}>
                          {d.statusCounts['Wrong / Invalid Number'] + d.statusCounts['Other']}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Telecaller Breakdown Section */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.25rem'
            }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>
                Telecaller Productivity Breakdown:
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.85rem' }}>
                {Object.entries(filteredReport.telecallerBreakdown).map(([caller, data]) => (
                  <div key={caller} style={{
                    background: 'var(--bg-secondary, #f8fafc)',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    borderRadius: '8px',
                    padding: '1rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{caller}</span>
                      <span style={{
                        background: '#eff6ff',
                        color: '#2563eb',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.8rem'
                      }}>
                        {data.total} Calls
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                      <div>Appointments: <strong style={{ color: '#166534' }}>{data.statusCounts['Appointment Confirmed']}</strong></div>
                      <div>Interested: <strong style={{ color: '#1e40af' }}>{data.statusCounts['Interested / Details Shared']}</strong></div>
                      <div>Follow-ups: <strong style={{ color: '#92400e' }}>{data.statusCounts['Follow-up Required'] + data.statusCounts['Call Back']}</strong></div>
                      <div>No Interest: <strong style={{ color: '#991b1b' }}>{data.statusCounts['No Interest']}</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Full Activity Log for the selected period */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem'
            }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>
                {periodTitle} Call Activity Log ({filteredReport.entries.length} Calls):
              </h4>
              {filteredReport.entries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  {activeKpi === 'all' ? `No calls recorded during this ${periodUnit.toLowerCase()}.` : `No ${selectedKpi.label.toLowerCase()} calls recorded during this ${periodUnit.toLowerCase()}.`}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Company</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Contact</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Result / Status</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Feedback / Remarks</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Telecaller</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }} className="no-print">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReport.entries.map((e) => (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                          <td style={{ padding: '8px 10px', color: '#64748b' }}>{e.entry_date}</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>{e.company_name}</td>
                          <td style={{ padding: '8px 10px' }}>{e.contact_person || '—'}</td>
                          <td style={{ padding: '8px 10px' }}>{e.phone}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: e.call_status === 'Appointment Confirmed' ? '#dcfce7' :
                                          e.call_status === 'Interested / Details Shared' ? '#dbeafe' :
                                          e.call_status === 'Follow-up Required' || e.call_status === 'Call Back' ? '#fef3c7' :
                                          e.call_status === 'No Interest' ? '#fee2e2' : '#f1f5f9',
                              color: e.call_status === 'Appointment Confirmed' ? '#166534' :
                                     e.call_status === 'Interested / Details Shared' ? '#1e40af' :
                                     e.call_status === 'Follow-up Required' || e.call_status === 'Call Back' ? '#92400e' :
                                     e.call_status === 'No Interest' ? '#991b1b' : '#475569'
                            }}>
                              {e.call_status}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569', maxWidth: '300px' }}>
                            {e.feedback || '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#64748b' }}>
                            {e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff'}
                          </td>
                          <td className="no-print" style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button type="button" className="btn-secondary" onClick={() => setSelectedEntry({ entry: e, readOnly: true })}>View</button>
                              <button type="button" className="btn-secondary" onClick={() => setSelectedEntry({ entry: e, readOnly: false })}>Edit</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {selectedEntry && selectedEntry.entry.company_id === companyId && (
        <TelecallingEditModal isOpen entry={selectedEntry.entry} readOnly={selectedEntry.readOnly}
          onClose={() => setSelectedEntry(null)} onSaved={() => { void loadReport(); }} />
      )}
      {/* Owner WhatsApp Configuration Modal */}
      {ownerModalOpen && (
        <OwnerWhatsAppModal
          isOpen={ownerModalOpen}
          onClose={() => setOwnerModalOpen(false)}
          onSaved={() => {
            setTimeout(handleShareWhatsApp, 200);
          }}
        />
      )}
    </div>
  );
};
