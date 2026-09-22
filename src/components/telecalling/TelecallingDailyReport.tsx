import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
  Share2, 
  Download, 
  Printer, 
  Filter, 
  Search, 
  MessageSquare, 
  RefreshCw, 
  User, 
  PhoneCall, 
  CheckCircle2, 
  AlertCircle,
  Settings,
  Loader2
} from 'lucide-react';
import type { CompanyProfile, TelecallingEntry, TelecallingStatus, TelecallingDailyReportData } from '../../types';
import { TELECALLING_STATUSES } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { getKolkataToday, formatKolkataDisplayDate } from '../../utils/dateUtils';
import { 
  buildDailyReportWhatsAppMessage, 
  openWhatsAppShare, 
  getOwnerWhatsAppNumber 
} from '../../utils/telecallingShare';
import { OwnerWhatsAppModal } from './OwnerWhatsAppModal';

interface TelecallingDailyReportProps {
  activeProfile: CompanyProfile | null;
  user: any;
  userRole?: string;
  onNavigateToEntry?: () => void;
}

export const TelecallingDailyReport: React.FC<TelecallingDailyReportProps> = ({
  activeProfile,
  onNavigateToEntry
}) => {
  const companyId = activeProfile?.id || '';
  const [selectedDate, setSelectedDate] = useState<string>(getKolkataToday());

  // Filters
  const [selectedTelecaller, setSelectedTelecaller] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<TelecallingStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Data & loading
  const [entries, setEntries] = useState<TelecallingEntry[]>([]);
  const [reportData, setReportData] = useState<TelecallingDailyReportData | null>(null);
  const [loading, setLoading] = useState(false);

  // Modals
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareSuccess, setShareSuccess] = useState(false);

  const loadReport = async () => {
    if (!companyId) return;
    setLoading(true);
    setShareError('');
    try {
      const data = await telecallingService.getEntriesForDate(companyId, selectedDate, {
        telecaller: selectedTelecaller,
        status: selectedStatus,
        search: searchQuery
      });
      setEntries(data);
      const computed = telecallingService.computeDailyReport(data, selectedDate);
      setReportData(computed);
    } catch (err) {
      console.error('Failed to load daily telecalling report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [companyId, selectedDate, selectedTelecaller, selectedStatus]);

  // Handle WhatsApp Share
  const handleShareWhatsApp = () => {
    if (!reportData) return;
    setShareError('');
    setShareSuccess(false);

    const ownerPhone = getOwnerWhatsAppNumber();
    if (!ownerPhone) {
      setOwnerModalOpen(true);
      return;
    }

    const message = buildDailyReportWhatsAppMessage(activeProfile?.name || 'B2P International', reportData);
    const result = openWhatsAppShare(message, ownerPhone);

    if (result.success) {
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } else {
      setShareError(result.error || 'Failed to share report via WhatsApp');
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (!entries.length) return;
    const headers = ['Date', 'Company', 'Contact Person', 'Phone', 'Other Phone', 'Location', 'Email', 'Call Status', 'Feedback', 'Telecaller', 'Created At'];
    const rows = entries.map(e => [
      `"${e.entry_date}"`,
      `"${(e.company_name || '').replace(/"/g, '""')}"`,
      `"${(e.contact_person || '').replace(/"/g, '""')}"`,
      `"${e.phone || ''}"`,
      `"${e.other_phone || ''}"`,
      `"${(e.location || '').replace(/"/g, '""')}"`,
      `"${e.email || ''}"`,
      `"${e.call_status}"`,
      `"${(e.feedback || '').replace(/"/g, '""')}"`,
      `"${e.created_by_name || e.created_by_email?.split('@')[0] || ''}"`,
      `"${e.created_at}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Telecalling_Daily_Report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Extract unique telecallers list from entries
  const availableTelecallers = Array.from(new Set(
    entries.map(e => e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff').filter(Boolean)
  ));

  return (
    <div className="telecalling-report-container" style={{ padding: '1rem', maxWidth: '1200px', margin: '0 auto' }}>
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
            <Calendar size={24} color="#3b82f6" />
            Telecalling Daily Report
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
            Real-time automated performance for {formatKolkataDisplayDate(selectedDate)}
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
            disabled={!entries.length}
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

          {onNavigateToEntry && (
            <button
              onClick={onNavigateToEntry}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
            >
              <PhoneCall size={15} color="#3b82f6" />
              <span>+ New Call</span>
            </button>
          )}
        </div>
      </div>

      {/* Share notifications */}
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
          <span>WhatsApp window opened with pre-filled Daily Report!</span>
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

      {/* Controls & Filter Bar */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '10px',
        padding: '1rem',
        marginBottom: '1.25rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.85rem',
        alignItems: 'center'
      }}>
        {/* Date Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Calendar size={16} color="#64748b" />
          <input
            type="date"
            className="input-field"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
          />
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Filter size={16} color="#64748b" />
          <select
            className="input-field"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
          >
            <option value="all">All Call Results</option>
            {TELECALLING_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Telecaller Filter */}
        {availableTelecallers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <User size={16} color="#64748b" />
            <select
              className="input-field"
              value={selectedTelecaller}
              onChange={(e) => setSelectedTelecaller(e.target.value)}
              style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
            >
              <option value="all">All Telecallers</option>
              {availableTelecallers.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Search size={16} color="#64748b" />
          <input
            type="text"
            className="input-field"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadReport()}
            placeholder="Search company, phone, location or notes..."
            style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
          />
        </div>

        <button onClick={loadReport} className="btn-secondary" style={{ padding: '0.45rem 0.75rem' }}>
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto', color: '#3b82f6' }} />
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#64748b' }}>Loading daily call records...</p>
        </div>
      ) : reportData ? (
        <>
          {/* Summary Metric Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.85rem',
            marginBottom: '1.25rem'
          }}>
            {/* Total Calls */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #3b82f6'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Total Calls
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: '0.2rem 0' }}>
                {reportData.totalCalls}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {reportData.uniqueCompanies} unique companies
              </div>
            </div>

            {/* Appointment Confirmed */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #16a34a'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                Appointments
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#166534', margin: '0.2rem 0' }}>
                {reportData.statusCounts['Appointment Confirmed']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                Confirmed meetings
              </div>
            </div>

            {/* Interested / Details Shared */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #2563eb'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>
                Interested / Details Sent
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e40af', margin: '0.2rem 0' }}>
                {reportData.statusCounts['Interested / Details Shared']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#1e40af' }}>
                Positive potential
              </div>
            </div>

            {/* Follow-up Required */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #d97706'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
                Follow-ups / Call Back
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#92400e', margin: '0.2rem 0' }}>
                {reportData.statusCounts['Follow-up Required'] + reportData.statusCounts['Call Back']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#92400e' }}>
                Action needed
              </div>
            </div>

            {/* No Response */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #64748b'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                No Response / Off
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#475569', margin: '0.2rem 0' }}>
                {reportData.statusCounts['No Answer / No Response'] + reportData.statusCounts['Not Reachable / Switched Off']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Unanswered
              </div>
            </div>

            {/* No Interest */}
            <div style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '10px',
              padding: '1rem',
              borderLeft: '4px solid #ef4444'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>
                No Interest
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#991b1b', margin: '0.2rem 0' }}>
                {reportData.statusCounts['No Interest']}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>
                Closed / declined
              </div>
            </div>
          </div>

          {/* Telecaller Activity Section */}
          <div style={{
            background: 'var(--bg-primary, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '10px',
            padding: '1rem',
            marginBottom: '1.25rem'
          }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
              Telecaller Activity Breakdown:
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {Object.entries(reportData.telecallerActivity).map(([caller, count]) => (
                <div key={caller} style={{
                  background: 'var(--bg-secondary, #f8fafc)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '6px',
                  padding: '0.5rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <User size={15} color="#3b82f6" />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{caller}:</span>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#2563eb' }}>{count} calls</span>
                </div>
              ))}
            </div>
          </div>

          {/* Detailed Call Record Table */}
          <div style={{
            background: 'var(--bg-primary, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '10px',
            padding: '1rem',
            overflow: 'hidden'
          }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>
              Call Records Detail ({entries.length} Entries):
            </h4>
            {entries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                No call entries match the selected filters.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary, #f8fafc)', borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Time / Date</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Company</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Contact</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Result / Status</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Feedback / Remarks</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Telecaller</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const cleanPhone = (e.phone || '').replace(/\D/g, '');
                      const timeStr = e.created_at ? new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                      return (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                          <td style={{ padding: '8px 10px', color: '#64748b', fontSize: '0.8rem' }}>
                            {timeStr || e.entry_date}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                            {e.company_name}
                            {e.location && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{e.location}</div>}
                          </td>
                          <td style={{ padding: '8px 10px' }}>{e.contact_person || '—'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span>{e.phone}</span>
                              {cleanPhone && (
                                <a
                                  href={`https://wa.me/${cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="WhatsApp Chat"
                                  style={{ color: '#16a34a' }}
                                >
                                  <MessageSquare size={13} />
                                </a>
                              )}
                            </div>
                          </td>
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
                      );
                    })}
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
            // After saving number, automatically trigger share
            setTimeout(handleShareWhatsApp, 200);
          }}
        />
      )}
    </div>
  );
};
