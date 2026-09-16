import React, { useState, useEffect } from 'react';
import { X, BookOpen, Calendar, Printer } from 'lucide-react';
import type { SupplierLedgerEntry, Supplier } from '../../types';
import { financeService } from '../../services/financeService';

interface SupplierLedgerModalProps {
  supplierId: string;
  onClose: () => void;
}

export const SupplierLedgerModal: React.FC<SupplierLedgerModalProps> = ({
  supplierId,
  onClose
}) => {
  const [supplier, setSupplier] = useState<Supplier | undefined>(undefined);
  const [entries, setEntries] = useState<SupplierLedgerEntry[]>([]);
  const [closingBalance, setClosingBalance] = useState(0);
  const [totalDebits, setTotalDebits] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadLedger = () => {
    try {
      const s = financeService.getSupplierById(supplierId);
      setSupplier(s);
      const data = financeService.getSupplierLedger(supplierId, startDate || undefined, endDate || undefined);
      setEntries(data.entries);
      setClosingBalance(data.closing_balance);
      setTotalDebits(data.total_debits);
      setTotalCredits(data.total_credits);
    } catch (e) {
      console.error('Failed to load supplier ledger:', e);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [supplierId, startDate, endDate]);

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '860px',
          padding: 0,
          background: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BookOpen size={20} style={{ color: 'var(--brand-blue)' }} />
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.02em' }}>
                Supplier Account Statement / Ledger
              </h2>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Vendor: <strong style={{ color: 'var(--brand-blue)' }}>{supplier?.name}</strong> {supplier?.company_name ? `(${supplier.company_name})` : ''} • GSTIN: <span className="mono">{supplier?.gstin || 'Unregistered'}</span>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button 
              onClick={() => window.print()}
              className="btn-secondary"
              style={{ padding: '0.35rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}
              title="Print Statement"
            >
              <Printer size={13} />
              <span>Print</span>
            </button>
            <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filters & Summary Ribbon */}
        <div style={{ padding: '0.85rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            
            {/* Date Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Calendar size={13} />
                Period:
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="btn-ghost"
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem', color: '#dc2626' }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Summary KPI Badges */}
            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>Total Debits (Disbursed)</div>
                <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 800, color: '#16a34a' }}>
                  ₹ {totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>Total Credits (Billed)</div>
                <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
                  ₹ {totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div style={{ textAlign: 'right', paddingLeft: '0.85rem', borderLeft: '2px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 700 }}>Closing Net Payable</div>
                <div className="mono" style={{ fontSize: '1rem', fontWeight: 800, color: closingBalance > 0 ? '#dc2626' : '#16a34a' }}>
                  ₹ {closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Ledger Table */}
        <div style={{ padding: '1rem 1.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '0.6rem 0.75rem' }}>Date</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Reference #</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Transaction Details</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Type</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Debit (₹)</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Credit (₹)</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Balance Payable (₹)</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening Balance Row */}
              <tr style={{ background: 'rgba(241, 245, 249, 0.5)', borderBottom: '1px solid #e2e8f0', fontStyle: 'italic' }}>
                <td style={{ padding: '0.55rem 0.75rem', color: '#64748b' }}>Opening</td>
                <td className="mono" style={{ padding: '0.55rem 0.75rem' }}>—</td>
                <td style={{ padding: '0.55rem 0.75rem', color: '#475569' }}>Opening Balance Forward</td>
                <td style={{ padding: '0.55rem 0.75rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#64748b' }}>OPENING</span>
                </td>
                <td className="mono" style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>—</td>
                <td className="mono" style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>
                  {supplier?.opening_balance ? `₹ ${supplier.opening_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                </td>
                <td className="mono" style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontWeight: 700 }}>
                  ₹ {(supplier?.opening_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>

              {/* Transactions */}
              {entries.length > 0 ? (
                entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.6rem 0.75rem' }}>{entry.date}</td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: 'var(--brand-blue)' }}>
                      {entry.reference}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', color: '#1e293b' }}>
                      {entry.description}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                      <span style={{
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        background: entry.type === 'payment' || entry.type === 'advance' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                        color: entry.type === 'payment' || entry.type === 'advance' ? '#16a34a' : 'var(--brand-blue)'
                      }}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: entry.debit > 0 ? '#16a34a' : '#94a3b8', fontWeight: entry.debit > 0 ? 700 : 400 }}>
                      {entry.debit > 0 ? `₹ ${entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: entry.credit > 0 ? '#0f172a' : '#94a3b8', fontWeight: entry.credit > 0 ? 700 : 400 }}>
                      {entry.credit > 0 ? `₹ ${entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="mono" style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: entry.running_balance > 0 ? '#dc2626' : '#16a34a' }}>
                      ₹ {entry.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                    No transactions recorded for this supplier in the selected period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff'
        }}>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            Official B2P International Accounts Payable Ledger
          </span>
          <button
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
