import React, { useState, useEffect } from 'react';
import { X, BookOpen, Calendar, Printer } from 'lucide-react';
import type { CustomerLedgerEntry } from '../../types';
import { financeService } from '../../services/financeService';

interface CustomerLedgerModalProps {
  customerName: string;
  onClose: () => void;
}

export const CustomerLedgerModal: React.FC<CustomerLedgerModalProps> = ({
  customerName,
  onClose
}) => {
  const [entries, setEntries] = useState<CustomerLedgerEntry[]>([]);
  const [closingBalance, setClosingBalance] = useState(0);
  const [totalDebits, setTotalDebits] = useState(0);
  const [totalCredits, setTotalCredits] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLedger = async () => {
    setLoading(true);
    try {
      const data = await financeService.getCustomerLedger(customerName, startDate || undefined, endDate || undefined);
      setEntries(data.entries);
      setClosingBalance(data.closing_balance);
      setTotalDebits(data.total_debits);
      setTotalCredits(data.total_credits);
    } catch (e) {
      console.error('Failed to load customer ledger:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [customerName, startDate, endDate]);

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '850px',
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
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                Customer Account Ledger
              </h2>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
              Client: <span style={{ color: 'var(--brand-blue)' }}>{customerName}</span>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button 
              onClick={() => window.print()}
              className="btn-ghost"
              style={{ padding: '0.4rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}
              title="Print Ledger"
            >
              <Printer size={14} />
              <span>Print</span>
            </button>
            <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filters & Summary Ribbon */}
        <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            
            {/* Date Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Calendar size={13} />
                Period:
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', width: '130px' }}
                title="Start Date"
              />
              <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', width: '130px' }}
                title="End Date"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="btn-ghost"
                  style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Balances Summary Cards */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', background: '#ffffff', border: '1px solid #e2e8f0', textAlign: 'right' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Invoiced</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a' }}>
                  ₹ {totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', background: '#ffffff', border: '1px solid #e2e8f0', textAlign: 'right' }}>
                <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Paid</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#10b981' }}>
                  ₹ {totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', background: closingBalance > 0 ? 'rgba(37, 99, 235, 0.08)' : '#ffffff', border: '1px solid rgba(37, 99, 235, 0.3)', textAlign: 'right' }}>
                <div style={{ fontSize: '0.65rem', color: '#1d4ed8', textTransform: 'uppercase', fontWeight: 700 }}>Closing Balance</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: closingBalance > 0 ? '#1d4ed8' : '#10b981' }}>
                  ₹ {closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Ledger Table */}
        <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', minWidth: '95px' }}>Date</th>
                <th style={{ padding: '0.75rem 1rem', minWidth: '110px' }}>Reference</th>
                <th style={{ padding: '0.75rem 1rem', minWidth: '220px' }}>Transaction Description</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', minWidth: '110px' }}>Debit (₹)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', minWidth: '110px' }}>Credit (₹)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', minWidth: '120px' }}>Balance (₹)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    Loading customer transactions...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    No transactions recorded for this customer in selected period.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                      {entry.date ? entry.date.split('-').reverse().join('/') : '-'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>
                      {entry.reference}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>
                      {entry.description}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: entry.debit > 0 ? 600 : 400, color: entry.debit > 0 ? '#0f172a' : '#94a3b8' }}>
                      {entry.debit > 0 ? entry.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: entry.credit > 0 ? 600 : 400, color: entry.credit > 0 ? '#10b981' : '#94a3b8' }}>
                      {entry.credit > 0 ? entry.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '-'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: entry.running_balance > 0 ? '#1d4ed8' : '#0f172a' }}>
                      ₹ {entry.running_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
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
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            B2P International &bull; Real-time Account Balance Statement
          </span>
          <button onClick={onClose} className="btn-secondary">
            Close Statement
          </button>
        </div>

      </div>
    </div>
  );
};
