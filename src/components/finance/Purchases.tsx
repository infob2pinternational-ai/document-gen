import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, 
  Search, 
  Plus, 
  CreditCard, 
  BookOpen, 
  Trash2, 
  RotateCcw,
  Clock,
  CheckCircle2,
  Layers,
  TrendingDown
} from 'lucide-react';
import type { Purchase, PurchaseStatus, SupplierPayment, AccountsPayableSummary } from '../../types';
import { financeService } from '../../services/financeService';
import { PurchaseModal } from './PurchaseModal';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';
import { SupplierLedgerModal } from './SupplierLedgerModal';

interface PurchasesProps {
  userEmail?: string;
}

export const Purchases: React.FC<PurchasesProps> = ({
  userEmail = 'accounts@b2p.com'
}) => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [apSummary, setApSummary] = useState<AccountsPayableSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'bills' | 'payables' | 'payments'>('bills');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals state
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [paymentPurchase, setPaymentPurchase] = useState<Purchase | null>(null);
  const [showDirectPaymentModal, setShowDirectPaymentModal] = useState(false);
  const [ledgerSupplierId, setLedgerSupplierId] = useState<string | null>(null);

  const loadData = () => {
    try {
      const plist = financeService.getPurchases();
      const splist = financeService.getSupplierPayments();
      const ap = financeService.getAccountsPayableSummary();

      setPurchases(plist);
      setSupplierPayments(splist);
      setApSummary(ap);
    } catch (e) {
      console.error('Failed to load purchases:', e);
    }
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(() => {
      loadData();
    });
    return unsub;
  }, []);

  const filteredPurchases = purchases.filter(p => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term ||
      p.purchase_number.toLowerCase().includes(term) ||
      p.supplier_name.toLowerCase().includes(term) ||
      p.supplier_invoice_number.toLowerCase().includes(term);

    const matchesTab = activeTab === 'payables' ? p.balance_amount > 0 && p.status !== 'cancelled' : true;

    return matchesSearch && matchesTab;
  });

  const filteredPayments = supplierPayments.filter(sp => {
    const term = searchTerm.toLowerCase().trim();
    return !term ||
      sp.payment_number.toLowerCase().includes(term) ||
      sp.supplier_name.toLowerCase().includes(term) ||
      (sp.reference_number && sp.reference_number.toLowerCase().includes(term));
  });

  const handleReversePurchase = async (id: string, num: string) => {
    const reason = window.prompt(`Please enter the accounting reason for reversing purchase bill ${num}:`, 'Incorrect rate / cancelled delivery');
    if (reason && reason.trim()) {
      try {
        await financeService.reversePurchase(id, reason.trim(), userEmail);
      } catch (err: any) {
        alert(err.message || 'Failed to reverse purchase bill.');
      }
    }
  };

  const handleDeleteDraftPurchase = async (id: string, num: string) => {
    if (window.confirm(`Are you sure you want to delete draft purchase bill ${num}?`)) {
      try {
        await financeService.deletePurchase(id, userEmail);
      } catch (err: any) {
        alert(err.message || 'Failed to delete purchase.');
      }
    }
  };

  const getStatusBadge = (status: PurchaseStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(16, 185, 129, 0.1)',
            color: '#10b981',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase'
          }}>
            <CheckCircle2 size={12} />
            Paid
          </span>
        );
      case 'partially_paid':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#d97706',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase'
          }}>
            <Clock size={12} />
            Part-Paid
          </span>
        );
      case 'posted':
      case 'recorded':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(37, 99, 235, 0.1)',
            color: 'var(--brand-blue)',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase'
          }}>
            <Layers size={12} />
            Posted
          </span>
        );
      case 'cancelled':
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#dc2626',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase'
          }}>
            Cancelled
          </span>
        );
      case 'draft':
      default:
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: '#f1f5f9',
            color: '#64748b',
            padding: '0.2rem 0.55rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase'
          }}>
            Draft
          </span>
        );
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', letterSpacing: '-0.02em' }}>
            <ShoppingCart size={22} style={{ color: 'var(--brand-blue)' }} />
            <span>Purchases & Accounts Payable</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: 0 }}>
            Vendor bills, double-entry expense vouchers, input tax credit accounting, AP aging, and payment disbursements.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowDirectPaymentModal(true)}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}
          >
            <CreditCard size={15} />
            <span>Disburse Payment</span>
          </button>

          <button
            onClick={() => { setEditingPurchase(null); setShowPurchaseModal(true); }}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}
          >
            <Plus size={15} />
            <span>Record Purchase Bill</span>
          </button>
        </div>
      </div>

      {/* AP Summary KPI Cards */}
      {apSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--brand-blue)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Accounts Payable</div>
            <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              ₹ {apSummary.total_payables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {apSummary.open_bills_count} open purchase bill(s)
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Due Today</div>
            <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: apSummary.due_today > 0 ? '#d97706' : 'var(--text-primary)', marginTop: '0.25rem' }}>
              ₹ {apSummary.due_today.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Immediate payment obligation
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid #ef4444' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Overdue Payables</div>
            <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: apSummary.overdue_payables > 0 ? '#dc2626' : 'var(--text-primary)', marginTop: '0.25rem' }}>
              ₹ {apSummary.overdue_payables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Requires vendor settlement
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1rem', borderLeft: '4px solid #10b981' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Disbursed (Settled)</div>
            <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#16a34a', marginTop: '0.25rem' }}>
              ₹ {apSummary.total_paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Total payments processed
            </div>
          </div>
        </div>
      )}

      {/* AP Aging Buckets Breakdown */}
      {apSummary && apSummary.total_payables > 0 && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <TrendingDown size={15} color="var(--brand-blue)" />
              Accounts Payable Aging Schedule (Due Date Basis)
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Real-time maturity analysis</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>Current (Not Due)</div>
              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#16a34a', marginTop: '0.2rem' }}>
                ₹ {apSummary.aging.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>1–30 Days Overdue</div>
              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#d97706', marginTop: '0.2rem' }}>
                ₹ {apSummary.aging.bucket_1_30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>31–60 Days Overdue</div>
              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#ea580c', marginTop: '0.2rem' }}>
                ₹ {apSummary.aging.bucket_31_60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>61–90 Days Overdue</div>
              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#dc2626', marginTop: '0.2rem' }}>
                ₹ {apSummary.aging.bucket_61_90.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.6875rem', color: '#64748b', fontWeight: 600 }}>90+ Days Critical</div>
              <div className="mono" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#991b1b', marginTop: '0.2rem' }}>
                ₹ {apSummary.aging.bucket_90_plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs & Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[
            { id: 'bills', label: `Purchase Bills (${purchases.length})` },
            { id: 'payables', label: `Accounts Payable (${purchases.filter(p => p.balance_amount > 0 && p.status !== 'cancelled').length})` },
            { id: 'payments', label: `Vendor Disbursements (${supplierPayments.length})` }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                fontSize: '0.8125rem',
                fontWeight: activeTab === tab.id ? 700 : 500,
                cursor: 'pointer',
                background: activeTab === tab.id ? 'var(--brand-blue)' : 'rgba(241, 245, 249, 0.8)',
                color: activeTab === tab.id ? '#ffffff' : 'var(--text-secondary)'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '260px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search bills, vendors, invoice #..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field"
            style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.78rem' }}
          />
        </div>
      </div>

      {/* TAB 1 & 2: PURCHASE BILLS & OPEN PAYABLES TABLE */}
      {(activeTab === 'bills' || activeTab === 'payables') && (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Bill #</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Supplier / Vendor</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Vendor Inv #</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Due Date</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Taxable (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>GST (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Total (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Balance (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.length > 0 ? (
                  filteredPurchases.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                        {p.purchase_number}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.supplier_name}</div>
                        {p.supplier_gstin && <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.supplier_gstin}</div>}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem' }}>
                        {p.supplier_invoice_number}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>{p.purchase_date}</td>
                      <td style={{ padding: '0.65rem 1rem', color: p.balance_amount > 0 && p.due_date < new Date().toISOString().split('T')[0] ? '#dc2626' : 'inherit', fontWeight: p.balance_amount > 0 && p.due_date < new Date().toISOString().split('T')[0] ? 700 : 400 }}>
                        {p.due_date}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        ₹ {p.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                        ₹ {p.total_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 700 }}>
                        ₹ {p.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 800, color: p.balance_amount > 0 ? '#dc2626' : '#16a34a' }}>
                        ₹ {p.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        {getStatusBadge(p.status)}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                          {p.balance_amount > 0 && p.status !== 'cancelled' && (
                            <button
                              onClick={() => setPaymentPurchase(p)}
                              className="btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                              title="Disburse Payment"
                            >
                              <CreditCard size={12} />
                              <span>Pay</span>
                            </button>
                          )}

                          <button
                            onClick={() => setLedgerSupplierId(p.supplier_id)}
                            className="btn-ghost"
                            style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem' }}
                            title="View Supplier Ledger"
                          >
                            <BookOpen size={14} color="var(--brand-blue)" />
                          </button>

                          {p.status === 'posted' && p.paid_amount === 0 && (
                            <button
                              onClick={() => handleReversePurchase(p.id, p.purchase_number)}
                              className="btn-ghost"
                              style={{ padding: '0.25rem 0.4rem', color: '#dc2626' }}
                              title="Reverse Purchase Bill (Accounting Correction)"
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}

                          {p.status === 'draft' && (
                            <button
                              onClick={() => handleDeleteDraftPurchase(p.id, p.purchase_number)}
                              className="btn-ghost"
                              style={{ padding: '0.25rem 0.4rem', color: '#dc2626' }}
                              title="Delete Draft"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No purchase bills found matching the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: VENDOR DISBURSEMENTS TABLE */}
      {activeTab === 'payments' && (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Payment #</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Supplier / Vendor</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Payment Mode</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Bank / Cash Source</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Reference #</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Amount Paid (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Type</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length > 0 ? (
                  filteredPayments.map(sp => (
                    <tr key={sp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                        {sp.payment_number}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>
                        {sp.supplier_name}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>{sp.payment_date}</td>
                      <td style={{ padding: '0.65rem 1rem', textTransform: 'uppercase', fontSize: '0.72rem', fontWeight: 600 }}>
                        {sp.payment_mode.replace('_', ' ')}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>
                        {sp.bank_cash_account}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem' }}>
                        {sp.reference_number || 'N/A'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>
                        ₹ {sp.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          background: sp.is_advance ? 'rgba(245, 158, 11, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                          color: sp.is_advance ? '#d97706' : '#16a34a'
                        }}>
                          {sp.is_advance ? 'Supplier Advance' : 'Bill Settlement'}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        <button
                          onClick={() => setLedgerSupplierId(sp.supplier_id)}
                          className="btn-ghost"
                          style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem' }}
                          title="View Supplier Ledger"
                        >
                          <BookOpen size={14} color="var(--brand-blue)" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No vendor disbursement payments recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showPurchaseModal && (
        <PurchaseModal
          initialPurchase={editingPurchase}
          userEmail={userEmail}
          onClose={() => { setShowPurchaseModal(false); setEditingPurchase(null); }}
          onSaved={() => { setShowPurchaseModal(false); setEditingPurchase(null); loadData(); }}
        />
      )}

      {(paymentPurchase || showDirectPaymentModal) && (
        <RecordSupplierPaymentModal
          initialPurchase={paymentPurchase}
          userEmail={userEmail}
          onClose={() => { setPaymentPurchase(null); setShowDirectPaymentModal(false); }}
          onPaymentRecorded={() => { setPaymentPurchase(null); setShowDirectPaymentModal(false); loadData(); }}
        />
      )}

      {ledgerSupplierId && (
        <SupplierLedgerModal
          supplierId={ledgerSupplierId}
          onClose={() => setLedgerSupplierId(null)}
        />
      )}

    </div>
  );
};
