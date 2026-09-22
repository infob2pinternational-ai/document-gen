import React, { useState, useEffect } from 'react';
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
import type { CompanyProfile, TelecallingWeeklyReportData } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { 
  getKolkataToday, 
  getKolkataWeekRange, 
  shiftKolkataWeek, 
  formatKolkataDisplayDate 
} from '../../utils/dateUtils';
import { 
  buildWeeklyReportWhatsAppMessage, 
  openWhatsAppShare, 
  getOwnerWhatsAppNumber 
} from '../../utils/telecallingShare';
import { OwnerWhatsAppModal } from './OwnerWhatsAppModal';

interface TelecallingWeeklyReportProps {
  activeProfile: CompanyProfile | null;
  user: any;
  userRole?: string;
  onNavigateToDailyReport?: () => void;
}

export const TelecallingWeeklyReport: React.FC<TelecallingWeeklyReportProps> = ({
  activeProfile,
  onNavigateToDailyReport
}) => {
  const companyId = activeProfile?.id || '';

  // Current week state
  const [currentWeekMonday, setCurrentWeekMonday] = useState<string>(() => {
    return getKolkataWeekRange(getKolkataToday()).startDate;
  });

  const weekInfo = getKolkataWeekRange(currentWeekMonday);

  const [reportData, setReportData] = useState<TelecallingWeeklyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [shareError, setShareError] = useState('');

  const loadWeeklyReport = async () => {
    if (!companyId) return;
    setLoading(true);
    setShareError('');
    try {
      const entries = await telecallingService.getEntriesForWeek(
        companyId,
        weekInfo.startDate,
        weekInfo.endDate
      );
      const computed = telecallingService.computeWeeklyReport(
        entries,
        weekInfo.startDate,
        weekInfo.endDate
      );
      setReportData(computed);
    } catch (err) {
      console.error('Failed to load weekly report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeeklyReport();
  }, [companyId, currentWeekMonday]);

  const handlePrevWeek = () => {
    setCurrentWeekMonday(prev => shiftKolkataWeek(prev, -1));
  };

  const handleNextWeek = () => {
    setCurrentWeekMonday(prev => shiftKolkataWeek(prev, 1));
  };

  const handleCurrentWeek = () => {
    setCurrentWeekMonday(getKolkataWeekRange(getKolkataToday()).startDate);
  };

  // WhatsApp Share
  const handleShareWhatsApp = () => {
    if (!reportData) return;
    setShareError('');
    setShareSuccess(false);

    const ownerPhone = getOwnerWhatsAppNumber();
    if (!ownerPhone) {
      setOwnerModalOpen(true);
      return;
    }

    const message = buildWeeklyReportWhatsAppMessage(
      activeProfile?.name || 'B2P International',
      reportData
    );
    const result = openWhatsAppShare(message, ownerPhone);

    if (result.success) {
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } else {
      setShareError(result.error || 'Failed to share weekly report');
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (!reportData || !reportData.entries.length) return;
    const headers = ['Date', 'Day', 'Company', 'Contact', 'Phone', 'Call Result', 'Feedback', 'Telecaller'];
    const rows = reportData.entries.map(e => [
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
    link.setAttribute('download', `Telecalling_Weekly_Report_${weekInfo.startDate}_to_${weekInfo.endDate}.csv`);
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
            Telecalling Weekly Report
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
            Single-source aggregation for {weekInfo.label}
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
            disabled={!reportData?.entries.length}
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
          <span>WhatsApp opened with pre-filled Weekly Report!</span>
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

      {/* Week Selector Bar */}
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
          <button onClick={handlePrevWeek} className="btn-secondary" style={{ padding: '0.4rem 0.6rem' }}>
            <ChevronLeft size={16} />
            <span>Prev Week</span>
          </button>

          <button onClick={handleCurrentWeek} className="btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
            Current Week
          </button>

          <button onClick={handleNextWeek} className="btn-secondary" style={{ padding: '0.4rem 0.6rem' }}>
            <span>Next Week</span>
            <ChevronRight size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Calendar size={18} color="#3b82f6" />
          <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
            {weekInfo.label}
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto', color: '#3b82f6' }} />
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#64748b' }}>Computing weekly performance statistics...</p>
        </div>
      ) : reportData ? (
        <>
          {/* Top Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.85rem',
            marginBottom: '1.25rem'
          }}>
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #3b82f6'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Weekly Calls</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0.2rem 0' }}>{reportData.totalCalls}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{reportData.uniqueCompanies} unique companies</div>
            </div>

            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #16a34a'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Appointments</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#166534', margin: '0.2rem 0' }}>
                {reportData.statusCounts['Appointment Confirmed']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#166534' }}>Meetings scheduled</div>
            </div>

            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #2563eb'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>Interested / Sent</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e40af', margin: '0.2rem 0' }}>
                {reportData.statusCounts['Interested / Details Shared']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#1e40af' }}>Details shared</div>
            </div>

            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #d97706'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>Follow-ups</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#92400e', margin: '0.2rem 0' }}>
                {reportData.followUpsCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#92400e' }}>Active pipeline</div>
            </div>

            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #64748b'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>No Response</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#475569', margin: '0.2rem 0' }}>
                {reportData.statusCounts['No Answer / No Response'] + reportData.statusCounts['Not Reachable / Switched Off']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Unreachable / off</div>
            </div>

            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #ef4444'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>No Interest</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#991b1b', margin: '0.2rem 0' }}>
                {reportData.statusCounts['No Interest']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>Declined</div>
            </div>
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
              Day-by-Day Activity Trend (Monday to Sunday):
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
                  {reportData.dailyBreakdown.map((d) => (
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
              {Object.entries(reportData.telecallerBreakdown).map(([caller, data]) => (
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
                    <div>Follow-ups: <strong style={{ color: '#92400e' }}>{data.statusCounts['Follow-up Required']}</strong></div>
                    <div>No Interest: <strong style={{ color: '#991b1b' }}>{data.statusCounts['No Interest']}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Full Activity Log for the Week */}
          <div style={{
            background: 'var(--bg-primary, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '10px',
            padding: '1rem'
          }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>
              Weekly Call Activity Log ({reportData.entries.length} Total Calls):
            </h4>
            {reportData.entries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                No calls recorded during this week.
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
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.entries.map((e) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

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
