import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Plus, 
  Search, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw
} from 'lucide-react';
import type { JournalEntry, VoucherType, JournalStatus, AccountHead, JournalLineItem } from '../../types';
import { financeService, round2 } from '../../services/financeService';
import { GeneralLedgerModal } from './GeneralLedgerModal';

interface JournalEntriesProps {
  userEmail?: string;
}

export const JournalEntries: React.FC<JournalEntriesProps> = ({
  userEmail = 'accounts@b2p.com'
}) => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accountHeads, setAccountHeads] = useState<AccountHead[]>([]);
  const [financialYears, setFinancialYears] = useState<string[]>([]);
  const [selectedFY, setSelectedFY] = useState<string>('FY 2026-27');
  const [selectedVoucherType, setSelectedVoucherType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Expandable row tracking
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal State for New Voucher
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [voucherType, setVoucherType] = useState<VoucherType>('journal');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [narration, setNarration] = useState('');
  const [referenceType, setReferenceType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [lines, setLines] = useState<JournalLineItem[]>([
    { account_id: 'ah-1001', account_code: '1001', account_name: 'Cash in Hand (Office Vault)', debit: 0, credit: 0, narration: '' },
    { account_id: 'ah-4001', account_code: '4001', account_name: 'LED Van Advertising Revenue', debit: 0, credit: 0, narration: '' }
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  // Reversal Dialog State
  const [reversingVoucher, setReversingVoucher] = useState<JournalEntry | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // General Ledger inspection modal
  const [ledgerAccountId, setLedgerAccountId] = useState<string | null>(null);

  const loadData = () => {
    const list = financeService.getJournalEntries({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      voucherType: selectedVoucherType !== 'all' ? selectedVoucherType : undefined,
      status: selectedStatus !== 'all' ? (selectedStatus as JournalStatus) : undefined,
      financialYear: selectedFY
    });
    setEntries(list);
    setAccountHeads(financeService.getAccountHeads());
    setFinancialYears(financeService.getIndianFinancialYears());
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(loadData);
    return unsub;
  }, [startDate, endDate, selectedVoucherType, selectedStatus, selectedFY]);

  const handleOpenCreateModal = () => {
    const activeHeads = financeService.getAccountHeads();
    const head1 = activeHeads[0] || { id: 'ah-1001', code: '1001', name: 'Cash in Hand' };
    const head2 = activeHeads[1] || { id: 'ah-4001', code: '4001', name: 'Revenue' };

    setVoucherType('journal');
    setEntryDate(new Date().toISOString().split('T')[0]);
    setNarration('');
    setReferenceType('');
    setReferenceNumber('');
    setLines([
      { account_id: head1.id, account_code: head1.code, account_name: head1.name, debit: 0, credit: 0, narration: '' },
      { account_id: head2.id, account_code: head2.code, account_name: head2.name, debit: 0, credit: 0, narration: '' }
    ]);
    setFormError(null);
    setShowCreateModal(true);
  };

  const handleAddLine = () => {
    const defaultHead = accountHeads[0] || { id: 'ah-1001', code: '1001', name: 'Account' };
    setLines(prev => [
      ...prev,
      { account_id: defaultHead.id, account_code: defaultHead.code, account_name: defaultHead.name, debit: 0, credit: 0, narration: '' }
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    if (lines.length <= 2) {
      alert('A double-entry voucher requires at least two line items (Debit and Credit).');
      return;
    }
    setLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAccountChange = (idx: number, accountId: string) => {
    const head = accountHeads.find(h => h.id === accountId);
    if (!head) return;
    setLines(prev => prev.map((l, i) => i === idx ? {
      ...l,
      account_id: head.id,
      account_code: head.code,
      account_name: head.name
    } : l));
  };

  const handleAmountChange = (idx: number, field: 'debit' | 'credit', val: number) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      if (field === 'debit') {
        return { ...l, debit: Math.max(0, val), credit: val > 0 ? 0 : l.credit };
      } else {
        return { ...l, credit: Math.max(0, val), debit: val > 0 ? 0 : l.debit };
      }
    }));
  };

  const handleLineNarrationChange = (idx: number, text: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, narration: text } : l));
  };

  const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const variance = round2(Math.abs(totalDebit - totalCredit));
  const isBalanced = variance < 0.001 && totalDebit > 0;

  const handleSaveVoucher = async (action: 'save_draft' | 'post') => {
    setFormError(null);

    if (!narration.trim()) {
      setFormError('Voucher narration is required.');
      return;
    }
    if (!entryDate) {
      setFormError('Transaction date is required.');
      return;
    }

    if (action === 'post' && !isBalanced) {
      setFormError(`Cannot post unbalanced voucher: Total Debit (₹${totalDebit.toFixed(2)}) must equal Total Credit (₹${totalCredit.toFixed(2)}). Variance: ₹${variance.toFixed(2)}.`);
      return;
    }

    try {
      await financeService.saveJournalEntry({
        voucher_type: voucherType,
        date: entryDate,
        narration: narration.trim(),
        reference_type: referenceType.trim() || undefined,
        reference_number: referenceNumber.trim() || undefined,
        lines,
        financial_year: selectedFY
      }, userEmail, action);

      setShowCreateModal(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save voucher.');
    }
  };

  const handlePostDraft = async (voucherId: string) => {
    try {
      await financeService.postJournalEntryById(voucherId, userEmail);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCancelVoucher = async (voucher: JournalEntry) => {
    const reason = window.prompt(`Please enter the cancellation reason for Voucher #${voucher.voucher_number}:`);
    if (reason !== null) {
      try {
        await financeService.cancelJournalEntry(voucher.id, reason, userEmail);
        loadData();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  const handleExecuteReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingVoucher) return;
    if (!reversalReason.trim()) {
      alert('Please provide a reason for reversing this voucher.');
      return;
    }

    try {
      await financeService.createReversingJournalEntry(reversingVoucher.id, reversalReason.trim(), userEmail);
      setReversingVoucher(null);
      setReversalReason('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filteredEntries = entries.filter(e => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      e.voucher_number.toLowerCase().includes(term) ||
      e.narration.toLowerCase().includes(term) ||
      (e.reference_number && e.reference_number.toLowerCase().includes(term)) ||
      e.lines.some(l => l.account_name.toLowerCase().includes(term) || l.account_code.toLowerCase().includes(term))
    );
  });

  const getVoucherBadge = (type: VoucherType) => {
    const map: Record<string, { label: string; bg: string; color: string }> = {
      journal: { label: 'JV', bg: 'rgba(59, 130, 246, 0.1)', color: '#2563eb' },
      payment: { label: 'PV', bg: 'rgba(239, 68, 68, 0.1)', color: '#dc2626' },
      receipt: { label: 'RV', bg: 'rgba(16, 185, 129, 0.1)', color: '#059669' },
      contra: { label: 'CV', bg: 'rgba(139, 92, 246, 0.1)', color: '#7c3aed' },
      expense: { label: 'EV', bg: 'rgba(245, 158, 11, 0.1)', color: '#d97706' },
      sales: { label: 'SLS', bg: 'rgba(6, 182, 212, 0.1)', color: '#0891b2' },
      purchase: { label: 'PUR', bg: 'rgba(234, 88, 12, 0.1)', color: '#c2410c' },
      reversal: { label: 'REV', bg: 'rgba(100, 116, 139, 0.1)', color: '#475569' }
    };
    const b = map[type] || { label: type.toUpperCase(), bg: 'rgba(100, 116, 139, 0.1)', color: '#475569' };
    return (
      <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '4px', background: b.bg, color: b.color }}>
        {b.label}
      </span>
    );
  };

  const getStatusBadge = (status: JournalStatus) => {
    if (status === 'POSTED') {
      return (
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.1)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          POSTED
        </span>
      );
    }
    if (status === 'DRAFT') {
      return (
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '9999px', background: 'rgba(245, 158, 11, 0.1)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
          DRAFT
        </span>
      );
    }
    return (
      <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '9999px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
        CANCELLED
      </span>
    );
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={18} />
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              General Journal & Vouchers
            </h1>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Immutable double-entry transaction repository. Every posted entry satisfies Total Debit = Total Credit.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="btn-primary"
          style={{ gap: '0.4rem', fontSize: '0.8125rem' }}
        >
          <Plus size={16} />
          <span>New Journal Voucher</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="glass-panel" style={{ padding: '0.85rem 1.15rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
          
          {/* Voucher Type Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(['all', 'journal', 'payment', 'receipt', 'expense', 'contra', 'reversal'] as const).map((vt) => {
              const isActive = selectedVoucherType === vt;
              const labels: Record<typeof vt, string> = {
                all: 'All Types',
                journal: 'Journal (JV)',
                payment: 'Payment (PV)',
                receipt: 'Receipt (RV)',
                expense: 'Expense (EV)',
                contra: 'Contra (CV)',
                reversal: 'Reversal (REV)'
              };
              return (
                <button
                  key={vt}
                  type="button"
                  onClick={() => setSelectedVoucherType(vt)}
                  style={{
                    padding: '0.25rem 0.65rem',
                    fontSize: '0.72rem',
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '9999px',
                    border: 'none',
                    cursor: 'pointer',
                    background: isActive ? 'var(--brand-blue)' : 'rgba(241, 245, 249, 0.8)',
                    color: isActive ? '#ffffff' : 'var(--text-secondary)'
                  }}
                >
                  {labels[vt]}
                </button>
              );
            })}
          </div>

          {/* FY Selector & Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              value={selectedFY}
              onChange={(e) => setSelectedFY(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: '30px' }}
            >
              {financialYears.map(fy => (
                <option key={fy} value={fy}>{fy}</option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: '30px' }}
            >
              <option value="all">All Statuses</option>
              <option value="POSTED">Posted Only</option>
              <option value="DRAFT">Draft Only</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Date Range & Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', borderTop: '1px solid rgba(226, 232, 240, 0.7)', paddingTop: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Date Filter:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.45rem', height: '28px' }}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-field"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.45rem', height: '28px' }}
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="btn-ghost"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', color: 'var(--text-muted)' }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ position: 'relative', width: '240px' }}>
            <Search size={13} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search voucher #, narration..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field"
              style={{ width: '100%', paddingLeft: '1.85rem', fontSize: '0.75rem', height: '28px' }}
            />
          </div>
        </div>
      </div>

      {/* Journal Vouchers Table */}
      <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', color: 'var(--text-secondary)', textAlign: 'left' }}>
              <th style={{ padding: '0.7rem 0.85rem', width: '32px' }}></th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700 }}>Voucher #</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700 }}>Type</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700 }}>Date</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700 }}>Narration</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700, textAlign: 'center' }}>Status</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700, textAlign: 'right' }}>Total Debit (₹)</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700, textAlign: 'right' }}>Total Credit (₹)</th>
              <th style={{ padding: '0.7rem 0.85rem', fontWeight: 700, textAlign: 'center', width: '150px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length > 0 ? (
              filteredEntries.map((voucher) => {
                const isExpanded = expandedId === voucher.id;

                return (
                  <React.Fragment key={voucher.id}>
                    <tr 
                      className="table-row-hover"
                      style={{ 
                        borderBottom: '1px solid rgba(226, 232, 240, 0.7)',
                        background: isExpanded ? 'rgba(241, 245, 249, 0.5)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '0.7rem 0.85rem', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : voucher.id)}
                          className="btn-ghost"
                          style={{ padding: '0.2rem', color: 'var(--text-muted)' }}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                      <td className="mono" style={{ padding: '0.7rem 0.85rem', fontWeight: 700, color: 'var(--brand-blue)', whiteSpace: 'nowrap' }}>
                        {voucher.voucher_number}
                      </td>
                      <td style={{ padding: '0.7rem 0.85rem', whiteSpace: 'nowrap' }}>
                        {getVoucherBadge(voucher.voucher_type)}
                      </td>
                      <td style={{ padding: '0.7rem 0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {voucher.date}
                      </td>
                      <td style={{ padding: '0.7rem 0.85rem', color: 'var(--text-primary)' }}>
                        <div>{voucher.narration}</div>
                        {voucher.reference_number && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            Ref: {voucher.reference_number} ({voucher.reference_type || 'General'})
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.7rem 0.85rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {getStatusBadge(voucher.status)}
                      </td>
                      <td className="mono" style={{ padding: '0.7rem 0.85rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        ₹ {voucher.total_debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="mono" style={{ padding: '0.7rem 0.85rem', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        ₹ {voucher.total_credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.7rem 0.85rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                          {voucher.status === 'DRAFT' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handlePostDraft(voucher.id)}
                                className="btn-primary"
                                title="Post Draft Voucher"
                                style={{ padding: '0.2rem 0.45rem', fontSize: '0.6875rem' }}
                              >
                                Post
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelVoucher(voucher)}
                                className="btn-ghost"
                                title="Cancel Draft"
                                style={{ padding: '0.2rem 0.35rem', color: '#dc2626' }}
                              >
                                <X size={13} />
                              </button>
                            </>
                          )}

                          {voucher.status === 'POSTED' && voucher.voucher_type !== 'reversal' && (
                            <button
                              type="button"
                              onClick={() => setReversingVoucher(voucher)}
                              className="btn-secondary"
                              title="Create Reversal Voucher"
                              style={{ padding: '0.2rem 0.45rem', fontSize: '0.6875rem', gap: '0.25rem' }}
                            >
                              <RotateCcw size={11} />
                              <span>Reverse</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Detail Rows */}
                    {isExpanded && (
                      <tr style={{ background: '#f8fafc' }}>
                        <td colSpan={9} style={{ padding: '0.85rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.85rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                Voucher Line Items (Double-Entry Ledger Lines)
                              </div>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                Created by: {voucher.created_by_email} {voucher.posted_at ? `| Posted: ${new Date(voucher.posted_at).toLocaleString()}` : ''}
                              </div>
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                              <thead>
                                <tr style={{ background: '#f1f5f9', color: 'var(--text-secondary)', textAlign: 'left' }}>
                                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700 }}>Account</th>
                                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700 }}>Line Narration</th>
                                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Debit (₹)</th>
                                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Credit (₹)</th>
                                  <th style={{ padding: '0.4rem 0.6rem', fontWeight: 700, textAlign: 'center', width: '80px' }}>Ledger</th>
                                </tr>
                              </thead>
                              <tbody>
                                {voucher.lines.map((l, lIdx) => (
                                  <tr key={lIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                      <span className="mono" style={{ color: 'var(--brand-blue)', marginRight: '0.35rem' }}>{l.account_code}</span>
                                      <span>{l.account_name}</span>
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem', color: 'var(--text-secondary)' }}>
                                      {l.narration || '-'}
                                    </td>
                                    <td className="mono" style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: l.debit > 0 ? 700 : 400, color: l.debit > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                      {l.debit > 0 ? `₹ ${l.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                    </td>
                                    <td className="mono" style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: l.credit > 0 ? 700 : 400, color: l.credit > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                      {l.credit > 0 ? `₹ ${l.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>
                                      <button
                                        type="button"
                                        onClick={() => setLedgerAccountId(l.account_id)}
                                        className="btn-ghost"
                                        style={{ fontSize: '0.6875rem', color: 'var(--brand-blue)', padding: '0.15rem 0.35rem' }}
                                      >
                                        View
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                    <BookOpen size={28} color="#94a3b8" />
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      No journal entries recorded yet.
                    </div>
                    <div style={{ fontSize: '0.75rem' }}>
                      Click "New Journal Voucher" above to record a balanced double-entry transaction.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal for Creating New Journal Voucher */}
      {showCreateModal && (
        <div className="modal-backdrop" style={{ zIndex: 1050 }}>
          <div 
            className="modal-content animate-scale-up"
            style={{
              maxWidth: '850px',
              width: '95%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem',
              borderRadius: 'var(--radius-lg)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Record Double-Entry Journal Voucher
                </h2>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Balanced ledger entry with real-time debit = credit enforcement
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="btn-ghost"
                style={{ padding: '0.35rem', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div style={{
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                marginBottom: '1rem'
              }}>
                <AlertCircle size={14} />
                <span>{formError}</span>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem', paddingRight: '0.25rem' }}>
              {/* Header Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Voucher Type *
                  </label>
                  <select
                    value={voucherType}
                    onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  >
                    <option value="journal">Journal Voucher (JV)</option>
                    <option value="receipt">Receipt Voucher (RV)</option>
                    <option value="payment">Payment Voucher (PV)</option>
                    <option value="expense">Expense Voucher (EV)</option>
                    <option value="contra">Contra Voucher (CV)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Transaction Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Reference Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Cheque # / NEFT / Bill Ref"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  Voucher Narration / Reason *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Advance payment settlement for campaign..."
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                />
              </div>

              {/* Multi-line table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Ledger Line Entries (Minimum 2 Lines)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', gap: '0.25rem' }}
                  >
                    <Plus size={13} />
                    <span>Add Line</span>
                  </button>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.65rem', fontWeight: 700, width: '280px' }}>Account Head *</th>
                        <th style={{ padding: '0.5rem 0.65rem', fontWeight: 700 }}>Line Narration</th>
                        <th style={{ padding: '0.5rem 0.65rem', fontWeight: 700, textAlign: 'right', width: '130px' }}>Debit (₹)</th>
                        <th style={{ padding: '0.5rem 0.65rem', fontWeight: 700, textAlign: 'right', width: '130px' }}>Credit (₹)</th>
                        <th style={{ padding: '0.5rem 0.65rem', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.4rem 0.65rem' }}>
                            <select
                              value={line.account_id}
                              onChange={(e) => handleAccountChange(idx, e.target.value)}
                              className="input-field"
                              style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                            >
                              {accountHeads.map(h => (
                                <option key={h.id} value={h.id}>
                                  {h.code} - {h.name} ({h.type.toUpperCase()})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.65rem' }}>
                            <input
                              type="text"
                              placeholder="Line details (optional)"
                              value={line.narration || ''}
                              onChange={(e) => handleLineNarrationChange(idx, e.target.value)}
                              className="input-field"
                              style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.65rem' }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.debit === 0 ? '' : line.debit}
                              placeholder="0.00"
                              onChange={(e) => handleAmountChange(idx, 'debit', Number(e.target.value) || 0)}
                              className="input-field mono"
                              style={{ width: '100%', textAlign: 'right', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.65rem' }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.credit === 0 ? '' : line.credit}
                              placeholder="0.00"
                              onChange={(e) => handleAmountChange(idx, 'credit', Number(e.target.value) || 0)}
                              className="input-field mono"
                              style={{ width: '100%', textAlign: 'right', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.65rem', textAlign: 'center' }}>
                            {lines.length > 2 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(idx)}
                                className="btn-ghost"
                                style={{ padding: '0.2rem', color: '#dc2626' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                        <td colSpan={2} style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                          Voucher Totals:
                        </td>
                        <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: isBalanced ? '#059669' : '#dc2626', fontSize: '0.8125rem' }}>
                          ₹ {totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: isBalanced ? '#059669' : '#dc2626', fontSize: '0.8125rem' }}>
                          ₹ {totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Invariant Status Indicator */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '0.65rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  background: isBalanced ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: isBalanced ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                  fontSize: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: isBalanced ? '#059669' : '#dc2626', fontWeight: 700 }}>
                    {isBalanced ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>{isBalanced ? 'Double-Entry Invariant Satisfied: Debit = Credit' : `Unbalanced Voucher: Debit - Credit Variance = ₹${variance.toFixed(2)}`}</span>
                  </div>

                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {isBalanced ? 'Ready to Post' : 'Voucher cannot be posted while unbalanced'}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="btn-secondary"
                style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => handleSaveVoucher('save_draft')}
                  className="btn-secondary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  disabled={!isBalanced}
                  onClick={() => handleSaveVoucher('post')}
                  className="btn-primary"
                  style={{ 
                    padding: '0.45rem 1.35rem', 
                    fontSize: '0.8125rem',
                    opacity: isBalanced ? 1 : 0.5,
                    cursor: isBalanced ? 'pointer' : 'not-allowed'
                  }}
                >
                  Post Voucher
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Reversing a Voucher */}
      {reversingVoucher && (
        <div className="modal-backdrop" style={{ zIndex: 1050 }}>
          <div 
            className="modal-content animate-scale-up"
            style={{
              maxWidth: '480px',
              width: '95%',
              padding: '1.5rem',
              borderRadius: 'var(--radius-lg)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <RotateCcw size={16} color="var(--brand-blue)" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Create Reversal Voucher
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setReversingVoucher(null)}
                className="btn-ghost"
                style={{ padding: '0.35rem', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
              You are reversing posted voucher <strong style={{ color: 'var(--text-primary)' }}>#{reversingVoucher.voucher_number}</strong> ({reversingVoucher.narration}) for <strong style={{ color: 'var(--text-primary)' }}>₹{reversingVoucher.total_debit.toLocaleString('en-IN')}</strong>.
            </p>

            <form onSubmit={handleExecuteReversal} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  Reason for Reversal / Correction *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Incorrect client account code selected / duplicate bill..."
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setReversingVoucher(null)}
                  className="btn-secondary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '0.45rem 1.25rem', fontSize: '0.8125rem' }}
                >
                  Confirm Reversal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* General Ledger Modal from line click */}
      {ledgerAccountId && (
        <GeneralLedgerModal
          accountId={ledgerAccountId}
          onClose={() => setLedgerAccountId(null)}
        />
      )}

    </div>
  );
};
