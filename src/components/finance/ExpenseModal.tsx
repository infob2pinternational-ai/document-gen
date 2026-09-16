import React, { useState } from 'react';
import { X, Check, Wallet, Calendar, Tag, Building2, Landmark, Hash } from 'lucide-react';
import type { Expense, ExpenseCategory, PaymentMode } from '../../types';
import { financeService } from '../../services/financeService';

interface ExpenseModalProps {
  initialExpense?: Expense | null;
  userEmail?: string;
  onClose: () => void;
  onSaved: (expense: Expense) => void;
}

const CATEGORIES: ExpenseCategory[] = [
  'Fuel',
  'Vehicle Maintenance',
  'Staff Expenses',
  'Printing',
  'Advertising',
  'Office Expenses',
  'Rent',
  'Electricity',
  'Internet',
  'Travel',
  'Equipment',
  'Miscellaneous'
];

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  initialExpense,
  userEmail = 'accounts@b2p.com',
  onClose,
  onSaved
}) => {
  const [expenseDate, setExpenseDate] = useState(initialExpense?.expense_date || new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<ExpenseCategory>(initialExpense?.category || 'Fuel');
  const [description, setDescription] = useState(initialExpense?.description || '');
  const [payeeName, setPayeeName] = useState(initialExpense?.payee_name || '');
  const [amount, setAmount] = useState<number>(initialExpense?.amount || 0);
  const [gstAmount, setGstAmount] = useState<number>(initialExpense?.gst_amount || 0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initialExpense?.payment_mode || 'cash');
  const [referenceNumber, setReferenceNumber] = useState(initialExpense?.reference_number || '');
  const [bankAccount, setBankAccount] = useState(initialExpense?.bank_cash_account || 'Federal Bank Current A/c');
  const [notes, setNotes] = useState(initialExpense?.notes || '');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Description is required.');
      return;
    }
    if (!payeeName.trim()) {
      setError('Payee / Vendor name is required.');
      return;
    }
    if (!amount || amount <= 0) {
      setError('Please enter a valid expense amount.');
      return;
    }

    try {
      const saved = await financeService.saveExpense({
        id: initialExpense?.id,
        expense_date: expenseDate,
        category,
        description: description.trim(),
        payee_name: payeeName.trim(),
        amount: Number(amount),
        gst_amount: Number(gstAmount) || 0,
        payment_mode: paymentMode,
        reference_number: referenceNumber.trim() || undefined,
        bank_cash_account: bankAccount,
        notes: notes.trim() || undefined
      }, userEmail);

      onSaved(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to save expense.');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '560px',
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
              <Wallet size={20} style={{ color: 'var(--brand-blue)' }} />
              <span>{initialExpense ? 'Edit Operating Expense' : 'Record Business Expense'}</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Log roadshow fuel, maintenance, petty cash, or office overheads.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#f8fafc' }}>
          
          {error && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.8rem', fontWeight: 500 }}>
              {error}
            </div>
          )}

          {/* Date & Category */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Expense Date *
              </label>
              <div style={{ position: 'relative' }}>
                <Calendar size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                  style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Category *
              </label>
              <div style={{ position: 'relative' }}>
                <Tag size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Description / Item Detail *
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Diesel for LED Van 1 Thrissur Roadshow"
              required
              style={{ width: '100%', fontSize: '0.8125rem' }}
            />
          </div>

          {/* Payee & Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Payee / Vendor Name *
              </label>
              <div style={{ position: 'relative' }}>
                <Building2 size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  placeholder="e.g. HP Petrol Pump / Asianet"
                  required
                  style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Total Amount (₹) *
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                required
                style={{ width: '100%', fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}
              />
            </div>
          </div>

          {/* GST Component & Payment Mode */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                GST Amount Included (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={gstAmount || ''}
                onChange={(e) => setGstAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00 (optional)"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
              <span style={{ fontSize: '0.675rem', color: '#94a3b8' }}>For Input Tax Credit (ITC) tracking</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Payment Mode *
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                <option value="cash">Cash / Petty Cash</option>
                <option value="upi">UPI (GPay / PhonePe / QR)</option>
                <option value="bank_transfer">Bank Transfer (NEFT / RTGS)</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Paid From Account & Reference */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Paid From Account *
              </label>
              <div style={{ position: 'relative' }}>
                <Landmark size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <select
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
                >
                  <option value="Federal Bank Current A/c">Federal Bank Current A/c</option>
                  <option value="SBI Current A/c">SBI Current A/c</option>
                  <option value="Cash in Hand (Office Drawer)">Cash in Hand (Office Drawer)</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Bill / Voucher / UTR Ref #
              </label>
              <div style={{ position: 'relative' }}>
                <Hash size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="e.g. BILL-9901 or UTR-1234"
                  style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
                />
              </div>
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Notes / Vehicle & Project Reference
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Van KL-08-AB-1234, driver allowance..."
              rows={2}
              style={{ width: '100%', fontSize: '0.8125rem' }}
            />
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            marginTop: '0.5rem',
            paddingTop: '1rem',
            borderTop: '1px solid #e2e8f0'
          }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Check size={16} />
              <span>{initialExpense ? 'Update Expense' : 'Save Expense'}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
