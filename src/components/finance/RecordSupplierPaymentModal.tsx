import React, { useState, useEffect } from 'react';
import { X, Check, CreditCard, AlertCircle } from 'lucide-react';
import type { PaymentMode, SupplierPayment, Purchase, Supplier, SupplierPaymentAllocation, AccountHead } from '../../types';
import { financeService } from '../../services/financeService';

interface RecordSupplierPaymentModalProps {
  initialPurchase?: Purchase | null;
  initialSupplierId?: string;
  userEmail?: string;
  onClose: () => void;
  onPaymentRecorded: (payment: SupplierPayment) => void;
}

export const RecordSupplierPaymentModal: React.FC<RecordSupplierPaymentModalProps> = ({
  initialPurchase,
  initialSupplierId,
  userEmail = 'accounts@b2p.com',
  onClose,
  onPaymentRecorded
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(initialPurchase?.supplier_id || initialSupplierId || '');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState<number>(initialPurchase?.balance_amount || 0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankAccounts, setBankAccounts] = useState<AccountHead[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('ah-1002');
  const [allocations, setAllocations] = useState<{ [purchaseId: string]: number }>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const list = financeService.getSuppliers();
    setSuppliers(list);
    if (!supplierId && list.length > 0) {
      setSupplierId(list[0].id);
    }

    const coa = financeService.getAccountHeads(true).filter((a: AccountHead) => 
      a.code.startsWith('1001') || a.code.startsWith('1002')
    );
    setBankAccounts(coa);
    if (coa.length > 0) {
      setSelectedAccountId(coa[0].id);
    }
  }, []);

  const openPurchases = financeService.getPurchases().filter(p => 
    p.supplier_id === supplierId && 
    (p.balance_amount || 0) > 0 &&
    p.status !== 'cancelled'
  );

  // Initialize allocation if initialPurchase is passed
  useEffect(() => {
    if (initialPurchase && initialPurchase.balance_amount > 0) {
      setAllocations({ [initialPurchase.id]: initialPurchase.balance_amount });
      setAmount(initialPurchase.balance_amount);
    } else if (openPurchases.length > 0) {
      setAllocations({});
    }
  }, [supplierId]);

  const handleAllocationChange = (pId: string, val: number, maxBal: number) => {
    const cleanVal = Math.min(Math.max(0, val), maxBal);
    const updated = { ...allocations, [pId]: cleanVal };
    setAllocations(updated);

    const totalAllocated = Object.values(updated).reduce((sum, v) => sum + (v || 0), 0);
    setAmount(totalAllocated);
  };

  const selectedSupplier = suppliers.find(s => s.id === supplierId);
  const selectedAccount = bankAccounts.find(a => a.id === selectedAccountId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!supplierId) {
      setError('Please select a vendor.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Please enter a valid disbursement amount greater than zero.');
      return;
    }

    // Build allocation payload
    const allocArray: SupplierPaymentAllocation[] = [];
    let totalAlloc = 0;

    Object.entries(allocations).forEach(([pId, allocAmt]) => {
      if (allocAmt > 0) {
        const p = openPurchases.find(item => item.id === pId);
        if (p) {
          allocArray.push({
            purchase_id: p.id,
            purchase_number: p.purchase_number,
            supplier_invoice_number: p.supplier_invoice_number,
            allocated_amount: allocAmt
          });
          totalAlloc += allocAmt;
        }
      }
    });

    if (totalAlloc > amount) {
      setError(`Total allocated across bills (₹${totalAlloc}) exceeds payment amount (₹${amount}).`);
      return;
    }

    try {
      const saved = await financeService.recordSupplierPayment({
        supplier_id: supplierId,
        supplier_name: selectedSupplier?.name || 'Vendor',
        payment_date: paymentDate,
        amount: Number(amount),
        payment_mode: paymentMode,
        reference_number: referenceNumber.trim() || undefined,
        bank_cash_account: selectedAccount ? `${selectedAccount.name} (${selectedAccount.code})` : 'Bank Operating Current Account',
        bank_cash_account_id: selectedAccountId,
        allocations: allocArray,
        notes: notes.trim() || undefined
      }, userEmail);

      onPaymentRecorded(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to record vendor disbursement.');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '680px',
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
              <span>Record Vendor Payment / Disbursement</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Disburse payments against outstanding purchase bills or record supplier advances with double-entry ledger vouchers.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem', maxHeight: '75vh', overflowY: 'auto', background: '#f8fafc' }}>
          
          {error && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Supplier Selector */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Select Vendor / Payee *
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.company_name || s.state})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Payment Disbursement Date *
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
          </div>

          {/* Bill Allocation Table */}
          <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.65rem 1rem', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
                Allocate Disbursement to Outstanding Bills ({openPurchases.length} open)
              </span>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Leave empty for Supplier Advance
              </span>
            </div>

            {openPurchases.length > 0 ? (
              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                      <th style={{ padding: '0.45rem 0.75rem' }}>Bill #</th>
                      <th style={{ padding: '0.45rem 0.75rem' }}>Invoice No</th>
                      <th style={{ padding: '0.45rem 0.75rem' }}>Due Date</th>
                      <th style={{ padding: '0.45rem 0.75rem', textAlign: 'right' }}>Total (₹)</th>
                      <th style={{ padding: '0.45rem 0.75rem', textAlign: 'right' }}>Outstanding (₹)</th>
                      <th style={{ padding: '0.45rem 0.75rem', width: '120px', textAlign: 'right' }}>Pay Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPurchases.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td className="mono" style={{ padding: '0.45rem 0.75rem', fontWeight: 600 }}>{p.purchase_number}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{p.supplier_invoice_number}</td>
                        <td style={{ padding: '0.45rem 0.75rem' }}>{p.due_date}</td>
                        <td className="mono" style={{ padding: '0.45rem 0.75rem', textAlign: 'right' }}>
                          ₹ {p.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="mono" style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                          ₹ {p.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            max={p.balance_amount}
                            step="0.01"
                            value={allocations[p.id] || ''}
                            onChange={(e) => handleAllocationChange(p.id, parseFloat(e.target.value) || 0, p.balance_amount)}
                            placeholder="0.00"
                            className="input-field mono"
                            style={{ width: '100%', fontSize: '0.75rem', textAlign: 'right', padding: '0.25rem 0.4rem' }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
                No open purchase bills found for this vendor. Any recorded payment will be credited as a <strong>Supplier Advance</strong>.
              </div>
            )}
          </div>

          {/* Amount, Mode & Bank Account */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Total Disbursement Amount (₹) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.875rem', fontWeight: 700, color: 'var(--brand-blue)' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Payment Mode
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                <option value="bank_transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                <option value="upi">UPI (GPay / PhonePe)</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="card">Corporate Card</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Bank / Cash Credit Head
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
                placeholder="e.g. UTR-20260823-998811"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Remarks / Payment Narration
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Final settlement for fabrication material"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.45rem 1.25rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Check size={16} />
              <span>Record Disbursement</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
