import React, { useState, useEffect } from 'react';
import { X, Check, CreditCard, AlertCircle, Layers } from 'lucide-react';
import type { PaymentMode, PaymentReceived, CustomerPaymentAllocation, AccountHead, Document, InvoicePaymentStatus } from '../../types';
import { financeService } from '../../services/financeService';

interface RecordPaymentModalProps {
  initialDocument?: {
    id: string;
    document_number: string;
    customer_name: string;
    customer_id?: string;
    total: number;
    balance_amount: number;
  };
  initialCustomerName?: string;
  userEmail?: string;
  onClose: () => void;
  onPaymentRecorded: (payment: PaymentReceived) => void;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  initialDocument,
  initialCustomerName,
  userEmail = 'accounts@b2p.com',
  onClose,
  onPaymentRecorded
}) => {
  const [customerName, setCustomerName] = useState(initialDocument?.customer_name || initialCustomerName || '');
  const [customerId] = useState(initialDocument?.customer_id || '');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState<number>(initialDocument?.balance_amount || 0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankAccounts, setBankAccounts] = useState<AccountHead[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('ah-1002');
  const [customerInvoices, setCustomerInvoices] = useState<(Document & { paid_amount: number; balance_amount: number; payment_status: InvoicePaymentStatus })[]>([]);
  const [allocations, setAllocations] = useState<{ [docId: string]: number }>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const heads = financeService.getAccountHeads(true).filter((a: AccountHead) =>
      a.code.startsWith('1001') || a.code.startsWith('1002')
    );
    setBankAccounts(heads);
    if (heads.length > 0) {
      setSelectedAccountId(heads[0].id);
    }
  }, []);

  useEffect(() => {
    const loadOpenInvoices = async () => {
      if (!customerName.trim()) {
        setCustomerInvoices([]);
        return;
      }
      try {
        const list = await financeService.getSalesInvoices();
        const target = customerName.toLowerCase().trim();
        const open = list.filter(inv => 
          (inv.customer_name?.toLowerCase().trim() === target || (customerId && inv.customer_id === customerId)) &&
          inv.balance_amount > 0 &&
          inv.payment_status !== 'cancelled'
        );
        setCustomerInvoices(open);

        if (initialDocument && initialDocument.balance_amount > 0) {
          setAllocations({ [initialDocument.id]: initialDocument.balance_amount });
          setAmount(initialDocument.balance_amount);
        } else if (open.length > 0 && amount === 0) {
          setAmount(open[0].balance_amount);
          setAllocations({ [open[0].id]: open[0].balance_amount });
        }
      } catch (err) {
        console.error('Failed to load customer invoices:', err);
      }
    };
    loadOpenInvoices();
  }, [customerName, customerId]);

  const handleAllocationChange = (docId: string, val: number, maxBal: number) => {
    const validVal = Math.min(Math.max(0, val), maxBal);
    const updated = { ...allocations, [docId]: validVal };
    if (validVal === 0) {
      delete updated[docId];
    }
    setAllocations(updated);

    const totalAlloc = Object.values(updated).reduce((s, a) => s + a, 0);
    if (totalAlloc > amount) {
      setAmount(totalAlloc);
    }
  };

  const totalAllocated = Object.values(allocations).reduce((s, a) => s + (Number(a) || 0), 0);
  const advanceAmount = Math.max(0, amount - totalAllocated);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!customerName.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Please enter a valid receipt amount greater than zero.');
      return;
    }

    if (totalAllocated > amount) {
      setError(`Total allocated across invoices (₹${totalAllocated}) exceeds receipt amount (₹${amount}).`);
      return;
    }

    const selectedAccount = bankAccounts.find(a => a.id === selectedAccountId);

    const allocArray: CustomerPaymentAllocation[] = Object.entries(allocations)
      .filter(([_, allocAmt]) => allocAmt > 0)
      .map(([docId, allocAmt]) => {
        const doc = customerInvoices.find(d => d.id === docId);
        return {
          document_id: docId,
          document_number: doc?.document_number || 'INV',
          allocated_amount: allocAmt
        };
      });

    try {
      const saved = await financeService.recordPaymentReceived({
        customer_name: customerName.trim(),
        customer_id: customerId || undefined,
        document_id: allocArray.length === 1 ? allocArray[0].document_id : undefined,
        document_number: allocArray.length === 1 ? allocArray[0].document_number : undefined,
        payment_date: paymentDate,
        amount: Number(amount),
        payment_mode: paymentMode,
        reference_number: referenceNumber.trim() || undefined,
        bank_cash_account: selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : 'Bank Operating Current Account',
        bank_cash_account_id: selectedAccountId,
        is_advance: advanceAmount > 0,
        advance_amount: advanceAmount,
        allocations: allocArray,
        notes: notes.trim() || undefined
      }, userEmail);

      onPaymentRecorded(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to record customer receipt.');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '640px',
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
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CreditCard size={20} style={{ color: 'var(--brand-blue)' }} />
              <span>Record Customer Receipt</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Post payment receipt, settle sales invoice balances, and record customer advances.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem', maxHeight: '75vh', overflowY: 'auto' }}>
          
          {error && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Customer & Receipt Total */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Customer Name *
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer or Organization Name"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Receipt Amount (₹) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.9rem', fontWeight: 700 }}
                required
              />
            </div>
          </div>

          {/* Open Invoices Settlement Table */}
          {customerInvoices.length > 0 && (
            <div style={{ background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '0.65rem 1rem', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Layers size={14} color="var(--brand-blue)" />
                  Allocate to Open Sales Invoices
                </span>
                <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  Allocated: ₹{totalAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Invoice #</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Total (₹)</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Balance (₹)</th>
                      <th style={{ padding: '0.5rem 0.75rem', width: '130px', textAlign: 'right' }}>Apply Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerInvoices.map(inv => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="mono" style={{ padding: '0.5rem 0.75rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                          {inv.document_number}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{inv.date || 'N/A'}</td>
                        <td className="mono" style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                          ₹ {Number(inv.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="mono" style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                          ₹ {inv.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.35rem 0.75rem', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            max={inv.balance_amount}
                            step="0.01"
                            value={allocations[inv.id] || ''}
                            onChange={(e) => handleAllocationChange(inv.id, parseFloat(e.target.value) || 0, inv.balance_amount)}
                            placeholder="0.00"
                            className="input-field mono"
                            style={{ width: '100%', fontSize: '0.75rem', padding: '0.25rem 0.4rem', textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Advance Notice Banner */}
          {advanceAmount > 0 && (
            <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', fontSize: '0.75rem', color: '#b45309', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Unallocated excess will be credited as <strong>Customer Advance</strong>:</span>
              <span className="mono" style={{ fontWeight: 800, fontSize: '0.85rem' }}>
                ₹ {advanceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Payment Mode & Bank Account */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Receipt Date *
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Payment Mode
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                <option value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                <option value="upi">UPI (GPay/PhonePe/Paytm)</option>
                <option value="cheque">Cheque / Demand Draft</option>
                <option value="cash">Cash in Hand</option>
                <option value="card">Credit / Debit Card</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Bank / Cash Debit Head
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Reference & Notes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                UTR / Cheque / Transaction Ref #
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. UTR-20260823-112233"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Internal Notes / Narration
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Part payment for display campaign"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Check size={16} />
              <span>Record Receipt</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
