import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Printer,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle2,
  PhoneCall,
  User,
  ShieldAlert,
  Loader2,
  Copy,
  Check,
  Eye,
  X
} from 'lucide-react';
import { getKolkataToday, formatKolkataDisplayDate } from '../utils/dateUtils';
import { officeService } from '../services/officeService';
import { leadService } from '../services/leadService';
import { telecallingService } from '../services/telecallingService';
import { authenticatedHeaders } from '../services/apiAuth';

interface DetailedStaffReportProps {
  userRole?: string;
  userEmail?: string;
}

export const DetailedStaffReport: React.FC<DetailedStaffReportProps> = ({
  userRole = 'owner',
  userEmail = 'owner@b2p.com'
}) => {
  const isOwner = userRole === 'owner' ||
    userEmail.toLowerCase().trim() === 'sarathjohnpanengadan@gmail.com' ||
    userEmail.toLowerCase().trim() === 'sarathjohnpanegdan@gmail.com' ||
    userEmail.toLowerCase().trim() === 'owner@b2p.com';

  const fixedStaffEmail = 'brutf5354@gmail.com';
  const ownerRecipient = '+91 85899 09034';

  const [selectedDate, setSelectedDate] = useState<string>(getKolkataToday());
  const [loading, setLoading] = useState(false);
  const [reportResult, setReportResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // WhatsApp Preview Modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copiedPart, setCopiedPart] = useState<number | null>(null);

  // Send & Dry-Run state
  const [sending, setSending] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);

  // History state
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load history from API and local storage
  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        headers = await authenticatedHeaders();
      } catch (e) {}

      const res = await fetch('/api/detailed-staff-report?action=history', { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          setHistory(data.history);
          return;
        }
      }
    } catch (e) {
      console.warn('[DetailedStaffReport] History API fetch failed, checking localStorage fallback:', e);
    } finally {
      setLoadingHistory(false);
    }

    try {
      const local = JSON.parse(localStorage.getItem('b2p_detailed_report_history') || '[]');
      setHistory(local);
    } catch {
      setHistory([]);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Generate Report
  const handleGenerate = async (targetDateToUse = selectedDate) => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setReportResult(null);

    try {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        headers = await authenticatedHeaders();
      } catch (authErr) {
        console.warn('Using unauthenticated fallback for development:', authErr);
      }

      // Collect client-side cached records to enrich the cloud query
      const clientData = {
        leads: leadService.getLeads(),
        followups: officeService.getFollowUps(),
        quotations: officeService.getQuotations(),
        telecalling: [] as any[]
      };

      try {
        const companyId = officeService.getActiveCompanyId() || undefined;
        if (companyId) {
          clientData.telecalling = await telecallingService.getEntriesForDate(companyId, targetDateToUse);
        }
      } catch (tcErr) {}

      const res = await fetch(`/api/detailed-staff-report?action=generate&date=${targetDateToUse}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          date: targetDateToUse,
          client_data: clientData
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}: Failed to generate report.`);
      }

      setReportResult(data);
      setSuccessMsg(`Report successfully generated for ${targetDateToUse}.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate report.');
    } finally {
      setLoading(false);
    }
  };

  // Dispatch via WhatsApp (Dry Run or Official Send)
  const handleSend = async (dryRunOverride?: boolean) => {
    const dryRun = dryRunOverride !== undefined ? dryRunOverride : isDryRun;
    setSending(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        headers = await authenticatedHeaders();
      } catch (e) {}

      const res = await fetch(`/api/detailed-staff-report?action=send&force=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          date: selectedDate,
          dry_run: dryRun
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}: Dispatch failed.`);
      }

      if (data.dryRun) {
        setSuccessMsg(`[Dry-Run Simulation Succeeded] Payload formatted for ${ownerRecipient}. No actual message dispatched.`);
      } else if (data.skipped) {
        setSuccessMsg(`Report already dispatched earlier: ${data.reason}`);
      } else {
        setSuccessMsg(`✓ Detailed Report dispatched via Bizylead WhatsApp to ${ownerRecipient}! (${data.sentCount} message chunks).`);
        await loadHistory();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'WhatsApp dispatch error.');
    } finally {
      setSending(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const copyToClipboard = (text: string, part: number) => {
    navigator.clipboard.writeText(text);
    setCopiedPart(part);
    setTimeout(() => setCopiedPart(null), 2000);
  };

  if (!isOwner) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <ShieldAlert size={48} color="#dc2626" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Owner-Only Access Restricted
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          The Detailed Staff Activity Report contains confidential management telemetry and is restricted strictly to the verified company owner account.
        </p>
      </div>
    );
  }

  const counts = reportResult?.counts || {};
  const ownerAttention = reportResult?.ownerAttention || [];
  const messagesToSend = reportResult?.messagesToSend || [];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header Panel */}
      <div className="glass-panel no-print" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.25rem 1.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Detailed Staff Report
            </h1>
            <span className="badge badge-warning" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
              Owner Confidential
            </span>
            <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
              8:00 PM IST Automated
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
            Complete customer-by-customer activity tracking, modifications audit, and verified WhatsApp dispatches.
          </p>
        </div>

        {/* Staff & Target info badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '8px',
            padding: '0.4rem 0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <User size={14} color="#3b82f6" />
            <div style={{ fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Staff Account: </span>
              <strong style={{ color: '#2563eb' }}>{fixedStaffEmail}</strong>
            </div>
          </div>

          <div style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '8px',
            padding: '0.4rem 0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <PhoneCall size={14} color="#10b981" />
            <div style={{ fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Owner WhatsApp: </span>
              <strong style={{ color: '#059669' }}>{ownerRecipient}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Date Selection & Action Bar */}
      <div className="glass-panel no-print" style={{
        padding: '1rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Date Selector & Quick Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={16} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>REPORT DATE:</span>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.65rem', borderRadius: '6px' }}
          />

          {/* Quick Preset Buttons */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { const d = getKolkataToday(); setSelectedDate(d); handleGenerate(d); }}
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
          >
            Today
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setSelectedDate('2026-09-30'); handleGenerate('2026-09-30'); }}
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
          >
            30 Sep 2026
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setSelectedDate('2026-09-29'); handleGenerate('2026-09-29'); }}
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
          >
            29 Sep 2026
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleGenerate(selectedDate)}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            <span>{loading ? 'Generating...' : 'Generate Report'}</span>
          </button>

          {reportResult && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPreviewOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
              >
                <Eye size={15} />
                <span>Preview WhatsApp</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handlePrint}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
              >
                <Printer size={15} />
                <span>Download / Print PDF</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isDryRun}
                    onChange={(e) => setIsDryRun(e.target.checked)}
                  />
                  <span>Dry-run mode</span>
                </label>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleSend()}
                  disabled={sending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.82rem',
                    background: isDryRun ? '#4f46e5' : '#16a34a',
                    borderColor: isDryRun ? '#4f46e5' : '#16a34a'
                  }}
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  <span>{isDryRun ? 'Simulate Dispatch' : 'Send to Owner'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Feedback Messages */}
      {errorMsg && (
        <div className="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={16} />
          <span style={{ fontSize: '0.82rem' }}>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="glass-panel" style={{ padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#059669', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={16} />
          <span style={{ fontSize: '0.82rem' }}>{successMsg}</span>
        </div>
      )}

      {/* Owner Attention Box (Section G) */}
      {ownerAttention.length > 0 && (
        <div className="glass-panel" style={{
          padding: '1rem 1.25rem',
          background: 'rgba(245, 158, 11, 0.08)',
          borderLeft: '4px solid #f59e0b',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} color="#d97706" />
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#b45309', margin: 0 }}>
              Section G: Owner Attention Required ({ownerAttention.length} Items)
            </h3>
          </div>
          <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0, fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.6 }}>
            {ownerAttention.map((item: string, idx: number) => (
              <li key={idx} style={{ marginBottom: '0.2rem' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Section A: Verified Database Totals KPI Grid */}
      {reportResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Section A: Verified Database Totals ({formatKolkataDisplayDate(selectedDate)})
            </h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Period: 12:00 AM – 11:59 PM IST
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.65rem' }}>
            {[
              { label: 'New Leads Created', val: counts['New leads created'] || 0, color: '#2563eb' },
              { label: 'Existing Leads Updated', val: counts['Existing leads updated'] || 0, color: '#4f46e5' },
              { label: 'New Telecalling Records', val: counts['New telecalling records'] || 0, color: '#059669' },
              { label: 'Existing Telecalling Updated', val: counts['Existing telecalling records updated'] || 0, color: '#0d9488' },
              { label: 'Follow-ups Created', val: counts['Follow-ups created'] || 0, color: '#d97706' },
              { label: 'Follow-ups Completed', val: counts['Follow-ups completed'] || 0, color: '#16a34a' },
              { label: 'Follow-ups Rescheduled', val: counts['Follow-ups rescheduled'] || 0, color: '#7c3aed' },
              { label: 'Follow-ups Deleted', val: counts['Follow-ups deleted'] || 0, color: '#dc2626' },
              { label: 'Quotations Created', val: counts['Quotations created'] || 0, color: '#2563eb' },
              { label: 'Quotations Approved', val: counts['Quotations approved'] || 0, color: '#10b981' },
              { label: 'WhatsApp Documents Sent', val: counts['Documents sent through WhatsApp'] || 0, color: '#0891b2' }
            ].map((kpi, idx) => (
              <div key={idx} className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  {kpi.label}
                </span>
                <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color: kpi.color, marginTop: '0.2rem' }}>
                  {kpi.val}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render Markdown Complete Report (Customer-by-Customer View) */}
      {reportResult && reportResult.markdown && (
        <div className="glass-panel printable-report" style={{ padding: '1.5rem', lineHeight: 1.6 }}>
          <div style={{ borderBottom: '2px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Complete Detailed Customer Audit Trail
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Rendered from authoritative database events & chronological modification logs
              </span>
            </div>
            <span className="badge badge-neutral no-print">
              Printable Format
            </span>
          </div>

          <pre style={{
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '0.84rem',
            color: 'var(--text-primary)',
            margin: 0,
            background: 'transparent'
          }}>
            {reportResult.markdown}
          </pre>
        </div>
      )}

      {/* Automatic Report History & Delivery Status Panel */}
      <div className="glass-panel no-print" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Automatic Report Delivery History & Audit Log
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              Tracks automated 8:00 PM IST crons and manual dispatches, message IDs, and delivery statuses.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadHistory}
            disabled={loadingHistory}
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
          >
            <RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} />
            <span>Refresh Log</span>
          </button>
        </div>

        {history.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No automatic report history recorded yet. Deliveries will appear here upon automated 8:00 PM dispatch.
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Report Date</th>
                  <th>Staff</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Sent Timestamp (IST)</th>
                  <th>Message IDs</th>
                  <th>Details / Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, idx) => (
                  <tr key={idx}>
                    <td className="mono" style={{ fontWeight: 600 }}>{h.date}</td>
                    <td>{h.staffEmail}</td>
                    <td className="mono">{h.recipient}</td>
                    <td>
                      <span className={`badge ${
                        h.status === 'sent' || h.status === 'delivered'
                          ? 'badge-success'
                          : h.status === 'failed'
                            ? 'badge-danger'
                            : 'badge-neutral'
                      }`}>
                        {h.status?.toUpperCase() || 'RECORDED'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem' }}>{h.sentAt ? new Date(h.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : (h.updatedAt ? new Date(h.updatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A')}</td>
                    <td className="mono" style={{ fontSize: '0.72rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {Array.isArray(h.messageIds) ? h.messageIds.join(', ') : (h.messageIds || 'None')}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: h.error ? '#dc2626' : 'inherit' }}>
                      {h.error || 'Delivered successfully'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* WhatsApp Message Preview Modal */}
      {previewOpen && (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div
            className="modal-card glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '680px', width: '92%', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                  WhatsApp Dispatch Preview
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Recipient: {ownerRecipient} | {messagesToSend.length} Chunk(s)
                </span>
              </div>
              <button className="icon-button" onClick={() => setPreviewOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messagesToSend.map((msg: any, i: number) => (
                <div key={i} style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                      {msg.title} (Part {msg.part} of {msg.total})
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => copyToClipboard(msg.text, i)}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      {copiedPart === i ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                      <span>{copiedPart === i ? 'Copied' : 'Copy Text'}</span>
                    </button>
                  </div>
                  <pre style={{
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    whiteSpace: 'pre-wrap',
                    background: '#1e293b',
                    color: '#f8fafc',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    margin: 0,
                    lineHeight: 1.45
                  }}>
                    {msg.text}
                  </pre>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem', gap: '0.6rem' }}>
              <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(false)}>
                Close Preview
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { setPreviewOpen(false); handleSend(); }}
                style={{ background: '#16a34a', borderColor: '#16a34a' }}
              >
                Send via WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-specific style tag */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .printable-report { box-shadow: none !important; border: none !important; padding: 0 !important; }
        }
      `}</style>

    </div>
  );
};
