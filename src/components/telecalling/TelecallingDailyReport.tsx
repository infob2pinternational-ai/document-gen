import React, { useState, useEffect } from 'react';
import { 
  Calendar, 
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
  X,
  Send,
  Clock,
  ExternalLink
} from 'lucide-react';
import type { CompanyProfile, TelecallingEntry, TelecallingStatus, TelecallingDailyReportData } from '../../types';
import { TELECALLING_STATUSES, isUnresolvedStatus } from '../../types';
import { telecallingService } from '../../services/telecallingService';
import { officeService } from '../../services/officeService';
import { metricsService } from '../../services/metricsService';
import { getKolkataToday, formatKolkataDisplayDate } from '../../utils/dateUtils';
import { 
  buildDailyReportWhatsAppMessage, 
  openWhatsAppShare, 
  getOwnerWhatsAppNumber,
  getOwnerReportEmail,
  buildDailyReportEmailContent,
  openMailtoShare,
  sendDailyReportViaB2PSystem,
  isOwnerAutoReportEnabled,
  getOwnerAutoReportTime
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

  // WhatsApp & Email dispatch state
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [emailStatusMsg, setEmailStatusMsg] = useState('');

  // Strictly query all entries for the selected date so KPI totals never zero out
  const loadReport = async () => {
    if (!companyId) return;
    setLoading(true);
    setShareError('');
    try {
      const data = await telecallingService.getEntriesForDate(companyId, selectedDate);
      setEntries(data);
      const computed = telecallingService.computeDailyReport(data, selectedDate);

      // Enrich with real CRM Follow-ups from app
      const crmDueToday = officeService.getFollowUps('today', companyId);
      const crmOverdue = officeService.getFollowUps('overdue', companyId);
      const crmCounts = metricsService.getFollowUpCounts();

      const followUpsDueTodayList = crmDueToday.map(f => ({
        id: f.id,
        customer_name: f.customer_name,
        company_name: f.company_name,
        phone: f.phone,
        reason: f.reason,
        assigned_staff_email: f.assigned_staff_email,
        due_date: f.due_date,
        due_time: f.due_time,
        status: f.status
      }));

      const overdueFollowUpsList = crmOverdue.map(f => ({
        id: f.id,
        customer_name: f.customer_name,
        company_name: f.company_name,
        phone: f.phone,
        reason: f.reason,
        assigned_staff_email: f.assigned_staff_email,
        due_date: f.due_date,
        due_time: f.due_time,
        status: f.status
      }));

      const dueTodayCount = crmDueToday.length > 0 ? crmDueToday.length : crmCounts.today;
      const overdueCount = crmOverdue.length > 0 ? crmOverdue.length : crmCounts.overdue;

      const enriched: TelecallingDailyReportData = {
        ...computed,
        followUpsCount: dueTodayCount,
        followUpsDueToday: dueTodayCount,
        overdueFollowUpsCount: overdueCount,
        followUpsDueTodayList,
        overdueFollowUpsList
      };

      setReportData(enriched);

      // Background sync snapshot to serverless API so unattended cron has the exact state
      fetch('/api/daily-report?action=sync-follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          followUpsDueToday: dueTodayCount,
          overdueFollowUpsCount: overdueCount,
          followUpsDueTodayList,
          overdueFollowUpsList
        })
      }).catch(() => {});
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

  // Handle direct B2P WhatsApp dispatch to Owner
  const handleSendToOwnerWhatsApp = async () => {
    if (!reportData) return;
    setShareError('');
    setShareSuccess('');

    const ownerPhone = getOwnerWhatsAppNumber();
    if (!ownerPhone) {
      setOwnerModalOpen(true);
      return;
    }

    setSendingWhatsApp(true);
    try {
      const result = await sendDailyReportViaB2PSystem({
        companyName: activeProfile?.name || 'B2P International',
        companyId: activeProfile?.id,
        date: selectedDate,
        reportData,
        ownerPhone
      });

      if (result.success) {
        setShareSuccess(`Daily Report for ${formatKolkataDisplayDate(selectedDate)} sent directly to Owner WhatsApp (+${result.recipient}) via B2P WhatsApp!`);
        setTimeout(() => setShareSuccess(''), 6000);
      } else {
        setShareError(result.error || 'Failed to dispatch report via B2P WhatsApp');
      }
    } catch (err: any) {
      setShareError(err.message || 'Error communicating with B2P WhatsApp service');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  // Handle WhatsApp Web Share fallback (wa.me link)
  const handleShareWhatsAppWeb = () => {
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
      setShareSuccess('WhatsApp Web opened with pre-filled Daily Report!');
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

  // Interactive Tile Click Handlers
  const handleToggleStatusFilter = (status: TelecallingStatus) => {
    if (selectedStatus === status && !unresolvedFilterOnly) {
      setSelectedStatus('all');
    } else {
      setSelectedStatus(status);
      setUnresolvedFilterOnly(false);
    }
  };

  const handleToggleUnresolvedFilter = () => {
    if (unresolvedFilterOnly) {
      setUnresolvedFilterOnly(false);
    } else {
      setUnresolvedFilterOnly(true);
      setSelectedStatus('all');
    }
  };

  const handleResetFilters = () => {
    setSelectedStatus('all');
    setSelectedTelecaller('all');
    setSearchQuery('');
    setUnresolvedFilterOnly(false);
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
  const isAnyFilterActive = unresolvedFilterOnly || selectedStatus !== 'all' || selectedTelecaller !== 'all' || Boolean(searchQuery.trim());

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
              Daily performance report for <strong>{formatKolkataDisplayDate(selectedDate)}</strong> ({selectedDate})
            </p>
            {isOwnerAutoReportEnabled() && (
              <span
                onClick={() => setOwnerModalOpen(true)}
                title="Click to configure Owner WhatsApp / Delivery Settings"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                <Clock size={12} color="#16a34a" />
                <span>Auto-Report: Daily 6:30 PM IST ({getOwnerAutoReportTime()}) to +{getOwnerWhatsAppNumber()}</span>
              </span>
            )}
          </div>
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

          {/* Send to Owner WhatsApp via B2P WhatsApp System */}
          <div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={handleSendToOwnerWhatsApp}
              disabled={sendingWhatsApp || !entries.length}
              className="btn-primary"
              title={`Dispatch report directly to Owner WhatsApp (+${getOwnerWhatsAppNumber()}) via verified B2P WhatsApp API`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                background: '#16a34a',
                borderColor: '#16a34a',
                borderTopRightRadius: 0,
                borderBottomRightRadius: 0
              }}
            >
              {sendingWhatsApp ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
              <span>{sendingWhatsApp ? 'Sending via B2P...' : 'Send to Owner WhatsApp'}</span>
            </button>
            <button
              type="button"
              onClick={handleShareWhatsAppWeb}
              disabled={!entries.length}
              className="btn-primary"
              title="Open WhatsApp Web (wa.me link fallback)"
              style={{
                background: '#15803d',
                borderColor: '#15803d',
                padding: '0 0.55rem',
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                borderLeft: '1px solid rgba(255,255,255,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <ExternalLink size={14} />
            </button>
          </div>

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

        {/* Status Dropdown Filter */}
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
            style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem', fontWeight: selectedStatus !== 'all' ? 700 : 500 }}
          >
            <option value="all">All Results / Statuses</option>
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

        {/* Search Input */}
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

        {/* Unresolved Calls toggle button */}
        <button
          type="button"
          onClick={handleToggleUnresolvedFilter}
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
          {unresolvedFilterOnly ? '✓ Unresolved Active' : 'Unresolved Only'}
        </button>

        {isAnyFilterActive && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="btn-ghost"
            title="Reset all filters"
            style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <X size={14} />
            <span>Reset</span>
          </button>
        )}

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
        /* STRICT REQUIREMENT: ZERO AUTOMATIC DATE SHIFTING */
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
          {/* INTERACTIVE DASHBOARD TILES: Clicking any tile filters the table */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem'
          }}>
            {/* Tile 1: Total Calls */}
            <div 
              onClick={handleResetFilters}
              style={{
                background: (selectedStatus === 'all' && !unresolvedFilterOnly) ? '#eff6ff' : 'var(--bg-primary, #ffffff)',
                border: (selectedStatus === 'all' && !unresolvedFilterOnly) ? '2px solid #2563eb' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #3b82f6',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: (selectedStatus === 'all' && !unresolvedFilterOnly) ? '0 4px 12px rgba(37, 99, 235, 0.12)' : undefined
              }}
              title="Click to view all calls"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Total Calls</span>
                {(selectedStatus === 'all' && !unresolvedFilterOnly) && (
                  <span style={{ fontSize: '0.65rem', background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0f172a', margin: '0.15rem 0' }}>
                {reportData.totalCalls}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {reportData.uniqueCompanies} unique companies
              </div>
            </div>

            {/* Tile 2: Unresolved Calls */}
            <div 
              onClick={handleToggleUnresolvedFilter}
              style={{
                background: unresolvedFilterOnly ? '#fef2f2' : 'var(--bg-primary, #ffffff)',
                border: unresolvedFilterOnly ? '2px solid #ef4444' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #dc2626',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: unresolvedFilterOnly ? '0 4px 12px rgba(239, 68, 68, 0.15)' : undefined
              }}
              title="Click to filter unresolved calls"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Unresolved</span>
                {unresolvedFilterOnly && (
                  <span style={{ fontSize: '0.65rem', background: '#fee2e2', color: '#991b1b', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#dc2626', margin: '0.15rem 0' }}>
                {unresolvedTotalCount}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#991b1b' }}>
                Action / Follow-up pending
              </div>
            </div>

            {/* Tile 3: Appointments Confirmed */}
            <div 
              onClick={() => handleToggleStatusFilter('Appointment Confirmed')}
              style={{
                background: selectedStatus === 'Appointment Confirmed' ? '#f0fdf4' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Appointment Confirmed' ? '2px solid #16a34a' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #16a34a',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Appointment Confirmed' ? '0 4px 12px rgba(22, 163, 74, 0.15)' : undefined
              }}
              title="Click to filter confirmed appointments"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Appointments</span>
                {selectedStatus === 'Appointment Confirmed' && (
                  <span style={{ fontSize: '0.65rem', background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#166534', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Appointment Confirmed']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#166534' }}>
                Confirmed meetings
              </div>
            </div>

            {/* Tile 4: Interested / Details Shared */}
            <div 
              onClick={() => handleToggleStatusFilter('Interested / Details Shared')}
              style={{
                background: selectedStatus === 'Interested / Details Shared' ? '#eff6ff' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Interested / Details Shared' ? '2px solid #2563eb' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #2563eb',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Interested / Details Shared' ? '0 4px 12px rgba(37, 99, 235, 0.15)' : undefined
              }}
              title="Click to filter interested leads"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Interested</span>
                {selectedStatus === 'Interested / Details Shared' && (
                  <span style={{ fontSize: '0.65rem', background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#1e40af', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Interested / Details Shared']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#1e40af' }}>
                Details shared
              </div>
            </div>

            {/* Tile 5: Follow-up Required (SEPARATE!) */}
            <div 
              onClick={() => handleToggleStatusFilter('Follow-up Required')}
              style={{
                background: selectedStatus === 'Follow-up Required' ? '#fffbeb' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Follow-up Required' ? '2px solid #d97706' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #d97706',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Follow-up Required' ? '0 4px 12px rgba(217, 119, 6, 0.15)' : undefined
              }}
              title="Click to filter follow-up required"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Follow-up</span>
                {selectedStatus === 'Follow-up Required' && (
                  <span style={{ fontSize: '0.65rem', background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#92400e', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Follow-up Required']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#92400e' }}>
                Follow-up needed
              </div>
            </div>

            {/* Tile 6: Call Back (SEPARATE!) */}
            <div 
              onClick={() => handleToggleStatusFilter('Call Back')}
              style={{
                background: selectedStatus === 'Call Back' ? '#fff7ed' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Call Back' ? '2px solid #ea580c' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #ea580c',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Call Back' ? '0 4px 12px rgba(234, 88, 12, 0.15)' : undefined
              }}
              title="Click to filter call back requests"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a3412', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Call Back</span>
                {selectedStatus === 'Call Back' && (
                  <span style={{ fontSize: '0.65rem', background: '#ffedd5', color: '#9a3412', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#c2410c', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Call Back']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#9a3412' }}>
                Client requested callback
              </div>
            </div>

            {/* Tile 7: No Answer / No Response */}
            <div 
              onClick={() => handleToggleStatusFilter('No Answer / No Response')}
              style={{
                background: selectedStatus === 'No Answer / No Response' ? '#f8fafc' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'No Answer / No Response' ? '2px solid #475569' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'No Answer / No Response' ? '0 4px 12px rgba(100, 116, 139, 0.15)' : undefined
              }}
              title="Click to filter no answer"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>No Answer</span>
                {selectedStatus === 'No Answer / No Response' && (
                  <span style={{ fontSize: '0.65rem', background: '#e2e8f0', color: '#334155', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#475569', margin: '0.15rem 0' }}>
                {reportData.statusCounts['No Answer / No Response']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Ringing / no response
              </div>
            </div>

            {/* Tile 8: Not Reachable / Switched Off */}
            <div 
              onClick={() => handleToggleStatusFilter('Not Reachable / Switched Off')}
              style={{
                background: selectedStatus === 'Not Reachable / Switched Off' ? '#f8fafc' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Not Reachable / Switched Off' ? '2px solid #334155' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #334155',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Not Reachable / Switched Off' ? '0 4px 12px rgba(51, 65, 85, 0.15)' : undefined
              }}
              title="Click to filter not reachable / switched off"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#334155', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Switched Off</span>
                {selectedStatus === 'Not Reachable / Switched Off' && (
                  <span style={{ fontSize: '0.65rem', background: '#cbd5e1', color: '#1e293b', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#1e293b', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Not Reachable / Switched Off']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                Not reachable
              </div>
            </div>

            {/* Tile 9: No Interest */}
            <div 
              onClick={() => handleToggleStatusFilter('No Interest')}
              style={{
                background: selectedStatus === 'No Interest' ? '#fdf2f8' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'No Interest' ? '2px solid #db2777' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #db2777',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'No Interest' ? '0 4px 12px rgba(219, 39, 119, 0.15)' : undefined
              }}
              title="Click to filter no interest"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9d174d', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>No Interest</span>
                {selectedStatus === 'No Interest' && (
                  <span style={{ fontSize: '0.65rem', background: '#fce7f3', color: '#9d174d', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#9d174d', margin: '0.15rem 0' }}>
                {reportData.statusCounts['No Interest']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#9d174d' }}>
                Declined / Not interested
              </div>
            </div>

            {/* Tile 10: Wrong / Invalid Number (NOW INCLUDED!) */}
            <div 
              onClick={() => handleToggleStatusFilter('Wrong / Invalid Number')}
              style={{
                background: selectedStatus === 'Wrong / Invalid Number' ? '#fff1f2' : 'var(--bg-primary, #ffffff)',
                border: selectedStatus === 'Wrong / Invalid Number' ? '2px solid #e11d48' : '1px solid var(--border-color, #e2e8f0)',
                borderRadius: '10px',
                padding: '0.85rem 1rem',
                borderLeft: '4px solid #e11d48',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: selectedStatus === 'Wrong / Invalid Number' ? '0 4px 12px rgba(225, 29, 72, 0.15)' : undefined
              }}
              title="Click to filter wrong or invalid numbers"
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9f1239', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Wrong Number</span>
                {selectedStatus === 'Wrong / Invalid Number' && (
                  <span style={{ fontSize: '0.65rem', background: '#ffe4e6', color: '#9f1239', padding: '1px 5px', borderRadius: '4px' }}>Active</span>
                )}
              </div>
              <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#be123c', margin: '0.15rem 0' }}>
                {reportData.statusCounts['Wrong / Invalid Number']}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#9f1239' }}>
                Invalid / incorrect contact
              </div>
            </div>
          </div>



          {/* Active Filter Indicator Banner */}
          {isAnyFilterActive && (
            <div style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '0.5rem 0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.85rem',
              color: '#1e40af',
              animation: 'fadeIn 0.2s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Filter size={15} color="#2563eb" />
                <span>
                  Filtering by: <strong>{unresolvedFilterOnly ? 'Unresolved Calls' : selectedStatus !== 'all' ? selectedStatus : 'Search / Telecaller'}</strong>
                  {' '}(Showing <strong>{displayedEntries.length}</strong> of {reportData.totalCalls} calls)
                </span>
              </div>
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
              >
                Clear Filter
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

          {/* Detailed Call Record Table */}
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
                {selectedStatus !== 'all' && !unresolvedFilterOnly && (
                  <span style={{
                    background: '#f1f5f9',
                    color: '#0f172a',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}>
                    {selectedStatus}
                  </span>
                )}
              </h4>

              {isAnyFilterActive && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="btn-ghost"
                  style={{ fontSize: '0.8rem', color: '#2563eb' }}
                >
                  Show All Calls
                </button>
              )}
            </div>

            {displayedEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
                No call entries match the selected filter for {formatKolkataDisplayDate(selectedDate)}.
                <div style={{ marginTop: '0.5rem' }}>
                  <button onClick={handleResetFilters} className="btn-secondary" style={{ fontSize: '0.8rem' }}>
                    View All Calls for Today ({reportData.totalCalls})
                  </button>
                </div>
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
                                          e.call_status === 'Follow-up Required' ? '#fef3c7' :
                                          e.call_status === 'Call Back' ? '#ffedd5' :
                                          e.call_status === 'No Interest' ? '#fce7f3' :
                                          e.call_status === 'Wrong / Invalid Number' ? '#ffe4e6' : '#f1f5f9',
                              color: e.call_status === 'Appointment Confirmed' ? '#166534' :
                                     e.call_status === 'Interested / Details Shared' ? '#1e40af' :
                                     e.call_status === 'Follow-up Required' ? '#92400e' :
                                     e.call_status === 'Call Back' ? '#c2410c' :
                                     e.call_status === 'No Interest' ? '#9d174d' :
                                     e.call_status === 'Wrong / Invalid Number' ? '#be123c' : '#475569'
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
                          {/* Quick Actions: Call, WhatsApp, Copy Phone, Call Again, Edit */}
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
