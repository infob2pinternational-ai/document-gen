import React, { useState, useEffect } from 'react';
import { 
  X, 
  BookOpen, 
  Printer
} from 'lucide-react';
import type { GeneralLedgerReport, VoucherType } from '../../types';
import { financeService } from '../../services/financeService';

interface GeneralLedgerModalProps {
  accountId: string;
  initialStartDate?: string;
  initialEndDate?: string;
  onClose: () => void;
  onSelectVoucher?: (voucherId: string) => void;
}

export const GeneralLedgerModal: React.FC<GeneralLedgerModalProps> = ({
  accountId,
  initialStartDate = '',
  initialEndDate = '',
  onClose,
  onSelectVoucher
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState(accountId);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [voucherType, setVoucherType] = useState<string>('all');
  const [report, setReport] = useState<GeneralLedgerReport | null>(null);

  const accountHeads = financeService.getAccountHeads(true);

  const loadLedger = () => {
    if (!selectedAccountId) return;
    const data = financeService.getGeneralLedger(
      selectedAccountId,
      startDate || undefined,
      endDate || undefined,
      voucherType !== 'all' ? voucherType : undefined
    );
    setReport(data);
  };

  useEffect(() => {
    loadLedger();
    const unsub = financeService.subscribe(loadLedger);
    return unsub;
  }, [selectedAccountId, startDate, endDate, voucherType]);

  const handlePrint = () => {
    window.print();
  };

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
      <span style={{
        fontSize: '0.6875rem',
        fontWeight: 700,
        padding: '0.15rem 0.4rem',
        borderRadius: '4px',
        background: b.bg,
        color: b.color
      }}>
        {b.label}
      </span>
    );
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1050 }}>
      <div 
        className="modal-content animate-scale-up"
        style={{
          maxWidth: '960px',
          width: '95%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-glass)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen size={18} />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                General Ledger Statement
              </h2>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Official transactional ledger for account <strong style={{ color: 'var(--text-primary)' }}>{report ? `${report.account_code} - ${report.account_name}` : 'Account'}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button 
              type="button" 
              onClick={handlePrint}
              className="btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', gap: '0.35rem' }}
            >
              <Printer size={14} />
              <span>Print</span>
            </button>
            <button 
              type="button" 
              onClick={onClose}
              className="btn-ghost"
              style={{ padding: '0.4rem', color: 'var(--text-muted)' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
          background: 'rgba(248, 250, 252, 0.8)',
          padding: '0.85rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid #e2e8f0',
          marginBottom: '1rem'
        }}>
          {/* Account Selector */}
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              Select Account Head
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="input-field"
              style={{ width: '100%', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
            >
              {accountHeads.map(h => (
                <option key={h.id} value={h.id}>
                  {h.code} - {h.name} ({h.type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-field"
              style={{ width: '100%', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-field"
              style={{ width: '100%', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
            />
          </div>

          {/* Voucher Type */}
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              Voucher Type
            </label>
            <select
              value={voucherType}
              onChange={(e) => setVoucherType(e.target.value)}
              className="input-field"
              style={{ width: '100%', fontSize: '0.78rem', padding: '0.35rem 0.5rem' }}
            >
              <option value="all">All Vouchers</option>
              <option value="journal">Journal Voucher (JV)</option>
              <option value="receipt">Receipt Voucher (RV)</option>
              <option value="payment">Payment Voucher (PV)</option>
              <option value="expense">Expense Voucher (EV)</option>
              <option value="contra">Contra Voucher (CV)</option>
              <option value="reversal">Reversal Voucher (REV)</option>
            </select>
          </div>
        </div>

        {/* Account Summary Strip */}
        {report && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '0.65rem',
            marginBottom: '1rem'
          }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 0.85rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Opening Balance</div>
              <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
                ₹ {report.opening_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 0.85rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Total Debits in Period</div>
              <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#059669', marginTop: '0.15rem' }}>
                ₹ {report.total_debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.65rem 0.85rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Total Credits in Period</div>
              <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#dc2626', marginTop: '0.15rem' }}>
                ₹ {report.total_credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.65rem 0.85rem' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--brand-blue)' }}>Closing Book Balance</div>
              <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.15rem' }}>
                ₹ {report.closing_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}

        {/* Ledger Table */}
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#ffffff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>Date</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>Voucher #</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>Type</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>Narration & Reference</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Debit (₹)</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Credit (₹)</th>
                <th style={{ padding: '0.6rem 0.75rem', fontWeight: 700, textAlign: 'right' }}>Running Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {report && report.rows.length > 0 ? (
                report.rows.map((row) => (
                  <tr 
                    key={row.id}
                    onClick={() => onSelectVoucher && onSelectVoucher(row.voucher_id)}
                    className="table-row-hover"
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: onSelectVoucher ? 'pointer' : 'default' }}
                  >
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {row.date}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: 'var(--brand-blue)', whiteSpace: 'nowrap' }}>
                      {row.voucher_number}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {getVoucherBadge(row.voucher_type)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-primary)' }}>
                      <div>{row.narration}</div>
                      {row.reference && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                          Ref: {row.reference}
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 600, color: row.debit > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {row.debit > 0 ? row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 600, color: row.credit > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {row.credit > 0 ? row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)' }}>
                      ₹ {row.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                      <BookOpen size={28} color="#94a3b8" />
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        No transactions posted for this account in the selected period.
                      </div>
                      <div style={{ fontSize: '0.75rem' }}>
                        All ledger balances are derived strictly from POSTED journal entries.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e2e8f0', marginTop: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.8125rem' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
