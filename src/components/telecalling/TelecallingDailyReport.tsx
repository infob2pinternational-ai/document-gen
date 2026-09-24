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
  Loader2,
  Pencil,
  Mail,
  Copy,
  Check,
  Smartphone,
  AlertTriangle
} from 'lucide-react';
import type { CompanyProfile, TelecallingEntry, TelecallingStatus, TelecallingDailyReportData } from '../../types';
import { TELECALLING_STATUSES, isUnresolvedStatus } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { getKolkataToday, formatKolkataDisplayDate } from '../../utils/dateUtils';
import {
  buildDailyReportWhatsAppMessage,
  openWhatsAppShare,
  getOwnerWhatsAppNumber,
  getOwnerReportEmail,
  buildDailyReportEmailContent,
  openMailtoShare
} from '../../utils/telecallingShare';
import { downloadTelecallingCsv } from '../../utils/csvExport';
import { OwnerWhatsAppModal } from './OwnerWhatsAppModal';
import { TelecallingEditModal } from './TelecallingEditModal';

interface TelecallingDailyReportProps {
  activeProfile: CompanyProfile | null;
  user?: any;
  userRole?: string;
  onNavigateToEntry?: () => void;
  onCallAgain?: (entry: TelecallingEntry) => void;
}

export const TelecallingDailyReport: React.FC<TelecallingDailyReportProps> = ({
  activeProfile,
  onNavigateToEntry,
  onCallAgain
}) => {
  const companyId = activeProfile?.id || '';

  // STRICT Selected Report Date: Initialized to Asia/Kolkata today, NEVER shifts automatically
  const [selectedDate, setSelectedDate] = useState<string>(getKolkataToday());

  // Filters
  const [selectedTelecaller, setSelectedTelecaller] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<TelecallingStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [unresolvedFilterOnly, setUnresolvedFilterOnly] = useState(false);

  // Data & loading
  const [entries, setEntries] = useState<TelecallingEntry[]>([]);
  const [reportData, setReportData] = useState<TelecallingDailyReportData | null>(null);
  const [loading, setLoading] = useState(false);

  // Modals & Notifications
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TelecallingEntry | null>(null);
  const [shareError, setShareError] = useState('');
  const [shareSuccess, setShareSuccess] = useState('');
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);

  // Email state
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [emailStatusMsg, setEmailStatusMsg] = useState('');

  // Strictly query the date selected by the user with zero fallback
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

  // Re-load only when companyId or selectedDate changes (or manual refresh)
  useEffect(() => {
    loadReport();
  }, [companyId, selectedDate]);

  // Handle WhatsApp Share
  const handleShareWhatsApp = () => {
    if (!reportData) return;
    setShareError('');
    setShareSuccess('');

    const ownerPhone = getOwnerWhatsAppNumber();
    if (!ownerPhone) {
      setOwnerModalOpen(true);
      return;
    }

    const message = buildDailyReportWhatsAppMessage(activeProfile?.name || 'B2P International', reportData);
    const result = openWhatsAppShare(message, ownerPhone);

    if (result.success) {
      setShareSuccess('WhatsApp opened with pre-filled Daily Report!');
      setTimeout(() => setShareSuccess(''), 4000);
    } else {
      setShareError(result.error || 'Failed to share report via WhatsApp');
    }
  };

  // Handle Send Email via Google Apps Script (with mailto fallback)
  const handleSendEmail = async () => {
    if (!reportData) return;
    setShareError('');
    setEmailStatus('idle');
    setEmailStatusMsg('');

    const targetEmail = getOwnerReportEmail(activeProfile?.approver_email || activeProfile?.email);
    if (!targetEmail) {
      setOwnerModalOpen(true);
      return;
    }

    setSendingEmail(true);
    const emailPayload = buildDailyReportEmailContent(activeProfile?.name || 'B2P International', reportData);

    const result = await telecallingService.sendDailyReportEmail({
      to: targetEmail,
      subject: emailPayload.subject,
      body: emailPayload.body,
      htmlBody: emailPayload.htmlBody
    });

    setSendingEmail(false);

    if (result.success) {
      setEmailStatus('success');
      setEmailStatusMsg(`Daily Report email successfully sent to ${targetEmail}!`);
      setTimeout(() => setEmailStatusMsg(''), 5000);
    } else {
      setEmailStatus('failed');
      setEmailStatusMsg(result.error || 'Failed to send email via Google Apps Script.');
    }
  };

  // Fallback to open client mail app
  const handleMailtoFallback = () => {
    if (!reportData) return;
    const targetEmail = getOwnerReportEmail(activeProfile?.approver_email || activeProfile?.email);
    const emailPayload = buildDailyReportEmailContent(activeProfile?.name || 'B2P International', reportData);
    openMailtoShare(targetEmail, emailPayload.subject, emailPayload.body);
  };

  // Filtered dataset currently displayed
  const displayedEntries = entries.filter(e => {
    if (unresolvedFilterOnly && !isUnresolvedStatus(e.call_status)) {
      return false;
    }
    if (selectedStatus !== 'all' && e.call_status !== selectedStatus) {
      return false;
    }
    if (selectedTelecaller !== 'all') {
      const caller = e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff';
      if (caller !== selectedTelecaller) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const match = (e.company_name && e.company_name.toLowerCase().includes(q)) ||
                    (e.contact_person && e.contact_person.toLowerCase().includes(q)) ||
                    (e.phone && e.phone.includes(q)) ||
                    (e.other_phone && e.other_phone.includes(q)) ||
                    (e.location && e.location.toLowerCase().includes(q)) ||
                    (e.feedback && e.feedback.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // Feature 11: Export ONLY the currently displayed / filtered dataset
  const handleExportFilteredCSV = () => {
    if (!displayedEntries.length) return;
    const isFiltered = unresolvedFilterOnly || selectedStatus !== 'all' || selectedTelecaller !== 'all' || Boolean(searchQuery.trim());
    const filename = isFiltered
      ? `Telecalling_Report_${selectedDate}_Filtered.csv`
      : `Telecalling_Report_${selectedDate}.csv`;

    downloadTelecallingCsv(filename, displayedEntries);
  };

  // Copy phone number to clipboard
  const handleCopyPhone = (id: string, phone: string) => {
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhoneId(id);
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  // Extract unique telecallers list from entries
  const availableTelecallers = Array.from(new Set(
    entries.map(e => e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff').filter(Boolean)
  ));

  const unresolvedTotalCount = reportData?.unresolvedCallsCount ?? entries.filter(e => isUnresolvedStatus(e.call_status)).length;

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
            Daily performance report for <strong>{formatKolkataDisplayDate(selectedDate)}</strong> ({selectedDate})
          </p>
        </div>

        {/* Action Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setOwnerModalOpen(true)}
            className="btn-secondary"
            title="Configure Delivery Recipients (WhatsApp & Email)"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Settings size={15} />
            <span>Settings</span>
          </button>

          {/* Send Email Button */}
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={sendingEmail || !entries.length}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#1d4ed8',
              borderColor: '#93c5fd',
              background: '#eff6ff'
            }}
          >
            {sendingEmail ? <Loader2 className="spin" size={15} /> : <Mail size={15} />}
            <span>{sendingEmail ? 'Sending Email...' : 'Send Email'}</span>
          </button>

          {/* Share WhatsApp */}
          <button
            type="button"
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
            <span>Share WhatsApp</span>
          </button>

          {/* Export Filtered CSV */}
          <button
            type="button"
            onClick={handleExportFilteredCSV}
            className="btn-secondary"
            disabled={!displayedEntries.length}
            title="Export currently displayed dataset to CSV"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
          >
            <Printer size={15} />
            <span>Print</span>
          </button>

          {onNavigateToEntry && (
            <button
              type="button"
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

      {/* Share / Email notifications */}
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
          <span>{shareSuccess}</span>
        </div>
      )}

      {emailStatus === 'success' && emailStatusMsg && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#eff6ff',
          borderLeft: '4px solid #2563eb',
          color: '#1e40af',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem'
        }}>
          <CheckCircle2 size={16} />
          <span>{emailStatusMsg}</span>
        </div>
      )}

      {emailStatus === 'failed' && (
        <div style={{
          padding: '0.75rem 1rem',
          background: '#fee2e2',
          borderLeft: '4px solid #ef4444',
          color: '#991b1b',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem',
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} />
            <span>{emailStatusMsg}</span>
          </div>
          <button
            type="button"
            onClick={handleMailtoFallback}
            className="btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
          >
            Open in Email App (mailto:)
          </button>
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
        {/* Date Selector — Controls report date only, never resets automatically */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Calendar size={16} color="#2563eb" />
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Report Date:</span>
          <input
            type="date"
            className="input-field"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedDate(e.target.value);
              }
            }}
            style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem', fontWeight: 700 }}
          />
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Filter size={16} color="#64748b" />
          <select
            className="input-field"
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value as any);
              if (e.target.value !== 'all') {
                setUnresolvedFilterOnly(false);
              }
            }}
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
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Search size={16} color="#64748b" />
          <input
            type="text"
            className="input-field"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search company, phone, location, feedback..."
            style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
          />
        </div>

        {/* Unresolved Calls quick toggle button */}
        <button
          type="button"
          onClick={() => {
            setUnresolvedFilterOnly(!unresolvedFilterOnly);
            if (!unresolvedFilterOnly) {
              setSelectedStatus('all');
            }
          }}
          className="btn-secondary"
          style={{
            fontSize: '0.8rem',
            padding: '0.45rem 0.75rem',
            background: unresolvedFilterOnly ? '#fef2f2' : undefined,
            borderColor: unresolvedFilterOnly ? '#ef4444' : undefined,
            color: unresolvedFilterOnly ? '#b91c1c' : undefined,
            fontWeight: unresolvedFilterOnly ? 700 : 500
          }}
        >
          {unresolvedFilterOnly ? '✓ Unresolved Filter Active' : 'Show Unresolved Only'}
        </button>

        <button
          onClick={loadReport}
          className="btn-secondary"
          title="Refresh Report Data"
          style={{ padding: '0.45rem 0.75rem' }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3.5rem' }}>
          <Loader2 className="spin" size={32} style={{ margin: '0 auto', color: '#3b82f6' }} />
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#64748b' }}>
            Loading telecalling entries for {formatKolkataDisplayDate(selectedDate)}...
          </p>
        </div>
      ) : entries.length === 0 ? (
        /* STRICT REQUIREMENT: ZERO AUTOMATIC DATE SHIFTING. Show clean empty state */
        <div style={{
          background: 'var(--bg-primary, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '12px',
          padding: '3rem 1.5rem',
          textAlign: 'center',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
        }}>
          <Calendar size={42} style={{ margin: '0 auto 0.75rem auto', color: '#94a3b8' }} />
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
            No telecalling entries found for {formatKolkataDisplayDate(selectedDate)}.
          </h3>
          <p style={{ margin: '0.5rem 0 1.25rem 0', fontSize: '0.85rem', color: '#64748b' }}>
            No calls were logged on {selectedDate}. The report date remains fixed on your selection.
          </p>
          {onNavigateToEntry && (
            <button
              onClick={onNavigateToEntry}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <PhoneCall size={16} />
              <span>Log Telecalling Entry</span>
            </button>
          )}
        </div>
      ) : reportData ? (
        <>
          {/* Summary Metric Cards with UNRESOLVED CALLS KPI */}
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

            {/* Feature 10: UNRESOLVED CALLS KPI CARD (Interactive) */}
            <div
              onClick={() => setUnresolvedFilterOnly(!unresolvedFilterOnly)}
              style={{
                background: unresolvedFilterOnly ? '#fef2f2' : 'var(--bg-primary, #ffffff)',
                border: unresolvedFilterOnly ? '2px solid #ef4444' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '1rem',
                borderLeft: '4px solid #dc2626',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              title="Click to toggle only unresolved calls requiring action"
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Unresolved Calls</span>
                <span style={{ fontSize: '0.65rem', background: '#fee2e2', padding: '1px 5px', borderRadius: '4px' }}>
                  {unresolvedFilterOnly ? 'Filtering' : 'Click to View'}
                </span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#dc2626', margin: '0.2rem 0' }}>
                {unresolvedTotalCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>
                Action / Follow-up pending
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

            {/* No Response / Switched Off */}
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
          </div>

          {/* Feature 9 & 10: Dedicated Unresolved Calls Highlight Card */}
          {unresolvedTotalCount > 0 && !unresolvedFilterOnly && (
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '10px',
              padding: '1rem',
              marginBottom: '1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <AlertTriangle size={20} color="#d97706" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400e' }}>
                    {unresolvedTotalCount} Unresolved Call{unresolvedTotalCount > 1 ? 's' : ''} Require Action for {formatKolkataDisplayDate(selectedDate)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#b45309' }}>
                    Calls requiring follow-up, callback, or unreachable leads pending contact.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnresolvedFilterOnly(true)}
                className="btn-secondary"
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  background: '#fef3c7',
                  borderColor: '#f59e0b',
                  color: '#92400e'
                }}
              >
                View Unresolved Calls ({unresolvedTotalCount})
              </button>
            </div>
          )}

          {/* Telecaller Activity Breakdown */}
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

          {/* Detailed Call Record Table (Feature 10: Quick Actions included) */}
          <div style={{
            background: 'var(--bg-primary, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '10px',
            padding: '1rem',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
              flexWrap: 'wrap',
              gap: '0.5rem'
            }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Call Records Detail</span>
                <span style={{
                  background: '#eff6ff',
                  color: '#2563eb',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 800
                }}>
                  {displayedEntries.length} {displayedEntries.length === 1 ? 'Entry' : 'Entries'}
                </span>
                {unresolvedFilterOnly && (
                  <span style={{
                    background: '#fef2f2',
                    color: '#dc2626',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}>
                    Unresolved Only
                  </span>
                )}
              </h4>

              {unresolvedFilterOnly && (
                <button
                  type="button"
                  onClick={() => setUnresolvedFilterOnly(false)}
                  className="btn-ghost"
                  style={{ fontSize: '0.8rem', color: '#2563eb' }}
                >
                  Show All Calls
                </button>
              )}
            </div>

            {displayedEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                No call entries match the selected filters for {formatKolkataDisplayDate(selectedDate)}.
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
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedEntries.map((e) => {
                      const cleanPhone = (e.phone || '').replace(/\D/g, '');
                      const waNumber = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
                      const timeStr = e.created_at ? new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                      const isUnres = isUnresolvedStatus(e.call_status);

                      return (
                        <tr
                          key={e.id}
                          style={{
                            borderBottom: '1px solid var(--border-color, #e2e8f0)',
                            background: isUnres ? '#fffdfa' : undefined
                          }}
                        >
                          <td style={{ padding: '8px 10px', color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
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
                          <td style={{ padding: '8px 10px', color: '#475569', maxWidth: '280px' }}>
                            {e.feedback || '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#64748b' }}>
                            {e.created_by_name || e.created_by_email?.split('@')[0] || 'Staff'}
                          </td>
                          {/* Feature 10 Quick Actions: Call, WhatsApp, Copy Phone, Call Again, Edit */}
                          <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                              {cleanPhone && (
                                <>
                                  <a
                                    href={`tel:${cleanPhone}`}
                                    title="Call"
                                    style={{
                                      padding: '0.25rem',
                                      color: '#2563eb',
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center'
                                    }}
                                  >
                                    <Smartphone size={15} />
                                  </a>
                                  <a
                                    href={`https://wa.me/${waNumber}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="WhatsApp Chat"
                                    style={{
                                      padding: '0.25rem',
                                      color: '#16a34a',
                                      borderRadius: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center'
                                    }}
                                  >
                                    <MessageSquare size={15} />
                                  </a>
                                </>
                              )}

                              {/* Copy Phone */}
                              <button
                                type="button"
                                onClick={() => handleCopyPhone(e.id, e.phone)}
                                className="btn-ghost"
                                title="Copy Phone Number"
                                style={{ padding: '0.25rem', color: copiedPhoneId === e.id ? '#16a34a' : '#64748b' }}
                              >
                                {copiedPhoneId === e.id ? <Check size={14} /> : <Copy size={14} />}
                              </button>

                              {/* Call Again */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (onCallAgain) {
                                    onCallAgain(e);
                                  } else if (onNavigateToEntry) {
                                    onNavigateToEntry();
                                  }
                                }}
                                className="btn-ghost"
                                title="Call Again (prefill in entry form)"
                                style={{
                                  padding: '0.2rem 0.4rem',
                                  color: '#1d4ed8',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  background: '#eff6ff',
                                  borderRadius: '4px'
                                }}
                              >
                                Call Again
                              </button>

                              {/* Edit Modal */}
                              <button
                                type="button"
                                onClick={() => setEditingEntry(e)}
                                className="btn-ghost"
                                title="Edit details & comments"
                                style={{ padding: '0.25rem', color: '#2563eb' }}
                              >
                                <Pencil size={14} />
                              </button>
                            </div>
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

      {/* Owner Delivery Settings Modal (WhatsApp Phone & Report Email) */}
      {ownerModalOpen && (
        <OwnerWhatsAppModal
          isOpen={ownerModalOpen}
          onClose={() => setOwnerModalOpen(false)}
          defaultEmail={activeProfile?.approver_email || activeProfile?.email || ''}
          onSaved={() => {
            loadReport();
          }}
        />
      )}

      {/* Edit Entry Modal */}
      {editingEntry && (
        <TelecallingEditModal
          isOpen={Boolean(editingEntry)}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={() => {
            loadReport();
          }}
        />
      )}
    </div>
  );
};
