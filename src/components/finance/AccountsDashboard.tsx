import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  TrendingUp, 
  Receipt, 
  ShoppingCart, 
  Wallet, 
  Building, 
  ArrowUpRight, 
  ArrowDownRight, 
  CreditCard, 
  Truck, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  BookOpen,
  Scale,
  Landmark
} from 'lucide-react';
import { financeService } from '../../services/financeService';
import type { Purchase, Expense, UserRole } from '../../types';
import { RecordPaymentModal } from './RecordPaymentModal';
import { ExpenseModal } from './ExpenseModal';
import { PurchaseModal } from './PurchaseModal';
import { SupplierModal } from './SupplierModal';
import { CustomerLedgerModal } from './CustomerLedgerModal';
import { SupplierLedgerModal } from './SupplierLedgerModal';
import { AccessRestricted } from './AccessRestricted';

interface AccountsDashboardProps {
  onNavigate?: (view: string) => void;
  userRole?: UserRole;
  userEmail?: string;
}

export const AccountsDashboard: React.FC<AccountsDashboardProps> = ({
  onNavigate,
  userRole = 'owner',
  userEmail = 'accounts@b2p.com'
}) => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [gstSummary, setGstSummary] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [trialBalance, setTrialBalance] = useState<any>(null);

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState<string | null>(null);
  const [ledgerSupplierId, setLedgerSupplierId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const inv = await financeService.getSalesInvoices();
      const pur = financeService.getPurchases();
      const exp = financeService.getExpenses();
      const gst = await financeService.getGSTSummary();
      const pnlData = await financeService.getProfitAndLoss();
      const met = await financeService.getFinanceMetrics();
      const tb = financeService.getTrialBalance();

      setInvoices(inv);
      setPurchases(pur);
      setExpenses(exp);
      setGstSummary(gst);
      setPnl(pnlData);
      setMetrics(met);
      setTrialBalance(tb);
    } catch (e) {
      console.error('Failed to load accounts dashboard:', e);
    }
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(() => {
      loadData();
    });
    return unsub;
  }, []);

  // Aggregate Metrics
  const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total || 0), 0);
  const totalCollected = invoices.reduce((sum, i) => sum + i.paid_amount, 0);
  const totalReceivables = invoices.reduce((sum, i) => sum + i.balance_amount, 0);
  const overdueReceivables = invoices.filter(i => i.payment_status === 'overdue').reduce((sum, i) => sum + i.balance_amount, 0);

  const totalPurchases = purchases.reduce((sum, p) => sum + p.total_amount, 0);
  const totalPayables = purchases.reduce((sum, p) => sum + p.balance_amount, 0);
  const overduePayables = purchases.filter(p => p.status === 'overdue').reduce((sum, p) => sum + p.balance_amount, 0);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = pnl?.net_profit || 0;
  const netGstPayable = gstSummary?.net_gst_payable || 0;

  // Top Outstanding Clients
  const outstandingClients = invoices
    .filter(i => i.balance_amount > 0)
    .slice(0, 5);

  // Top Outstanding Suppliers
  const outstandingVendors = purchases
    .filter(p => p.balance_amount > 0)
    .slice(0, 5);

  // REMEDIATION (2026-08-24, P2 item 11 - audit finding "React Hooks
  // violations"): this role check used to run BEFORE any of this
  // component's ~15 useState/useEffect hooks, which violates the Rules
  // of Hooks (confirmed with a live oxlint run during the audit - 41
  // react-hooks(rules-of-hooks) errors across the 3 affected
  // components). Moved here, after every hook has already executed
  // unconditionally on every render, so a role change on this mounted
  // instance can no longer change how many hooks it calls.
  if (userRole === 'telecaller') {
    return <AccessRestricted currentRole={userRole} />;
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Executive Welcome & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DollarSign size={28} style={{ color: 'var(--brand-blue)' }} />
            <span>Executive Accounts & Finance</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Real-time financial control, cash inflows, vendor disbursements, GST tax liabilities, and profit margins.
          </p>
        </div>

        {/* Quick Actions Ribbon */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <CreditCard size={15} />
            <span>Record Payment</span>
          </button>

          <button
            onClick={() => setShowExpenseModal(true)}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Wallet size={15} />
            <span>Record Expense</span>
          </button>

          <button
            onClick={() => setShowPurchaseModal(true)}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <ShoppingCart size={15} />
            <span>New Purchase Bill</span>
          </button>

          <button
            onClick={() => setShowSupplierModal(true)}
            className="btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Truck size={15} />
            <span>Add Supplier</span>
          </button>
        </div>
      </div>

      {/* 10 KPI Glass Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
        
        {/* 1. Gross Invoiced */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('sales-receivables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Total Invoiced</span>
            <Receipt size={14} style={{ color: 'var(--brand-blue)' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            ₹ {totalInvoiced.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {invoices.length} invoices generated
          </div>
        </div>

        {/* 2. Collected */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('sales-receivables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Total Collected</span>
            <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981' }}>
            ₹ {totalCollected.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {totalInvoiced > 0 ? ((totalCollected / totalInvoiced) * 100).toFixed(1) : 0}% recovery rate
          </div>
        </div>

        {/* 3. Receivables */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('sales-receivables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Accounts Receivable</span>
            <ArrowDownRight size={14} style={{ color: 'var(--brand-blue)' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
            ₹ {totalReceivables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Pending client balances
          </div>
        </div>

        {/* 4. Overdue Receivables */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('sales-receivables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Overdue Receivables</span>
            <AlertCircle size={14} style={{ color: '#dc2626' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {overdueReceivables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Past payment terms
          </div>
        </div>

        {/* 5. Purchases Total */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('purchases-payables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Total Purchases</span>
            <ShoppingCart size={14} style={{ color: '#d97706' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            ₹ {totalPurchases.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {purchases.length} procurement orders
          </div>
        </div>

        {/* 6. Payables */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('purchases-payables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Accounts Payable</span>
            <ArrowUpRight size={14} style={{ color: '#dc2626' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {totalPayables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Vendor bills outstanding
          </div>
        </div>

        {/* 7. Overdue Payables */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('purchases-payables')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Overdue Payables</span>
            <Clock size={14} style={{ color: '#dc2626' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {overduePayables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Vendor due dates passed
          </div>
        </div>

        {/* 8. Expenses */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('expenses')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Operating Expenses</span>
            <Wallet size={14} style={{ color: '#ea580c' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Fuel, overheads, yard rent
          </div>
        </div>

        {/* 9. Net Profit */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', background: netProfit >= 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)', border: `1.5px solid ${netProfit >= 0 ? '#10b981' : '#dc2626'}`, cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('profit-loss')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 700, color: netProfit >= 0 ? '#047857' : '#dc2626', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Net Operating Profit</span>
            <TrendingUp size={14} />
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: netProfit >= 0 ? '#047857' : '#dc2626' }}>
            ₹ {netProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Margin: <strong>{totalInvoiced > 0 ? ((netProfit / totalInvoiced) * 100).toFixed(1) : 0}%</strong>
          </div>
        </div>

        {/* 10. Net GST Payable */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', border: '1.5px solid var(--brand-blue)', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('gst-tax')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 700, color: 'var(--brand-blue)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Net GST Payable</span>
            <Building size={14} />
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
            ₹ {netGstPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Output minus Input ITC
          </div>
        </div>

        {/* 11. Cash Balance */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('banking-reconciliation')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Office Vault Cash</span>
            <Wallet size={14} style={{ color: '#16a34a' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#16a34a' }}>
            ₹ {(metrics?.cashBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Cash in Hand (1001)
          </div>
        </div>

        {/* 12. Bank Balance */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default' }}
          onClick={() => onNavigate && onNavigate('banking-reconciliation')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Operating Bank</span>
            <Landmark size={14} style={{ color: 'var(--brand-blue)' }} />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
            ₹ {(metrics?.bankBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Bank Current Accounts (1002)
          </div>
        </div>

        {/* 13. Trial Balance Status */}
        <div 
          className="card glass-card" 
          style={{ padding: '1.15rem', cursor: onNavigate ? 'pointer' : 'default', border: trialBalance?.is_balanced ? '1px solid #86efac' : '1.5px solid #fca5a5' }}
          onClick={() => onNavigate && onNavigate('financial-reports')}
        >
          <div style={{ fontSize: '0.725rem', fontWeight: 700, color: trialBalance?.is_balanced ? '#047857' : '#dc2626', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Trial Balance Status</span>
            <Scale size={14} />
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: trialBalance?.is_balanced ? '#047857' : '#dc2626' }}>
            {trialBalance?.is_balanced ? 'Balanced (₹0 Diff)' : `Imbalance: ₹${(trialBalance?.difference || 0).toFixed(2)}`}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Debit = Credit Equality Check
          </div>
        </div>

      </div>

      {/* Two-column operational balances grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem' }}>
        
        {/* Top Outstanding Customers */}
        <div className="card glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Receipt size={17} style={{ color: 'var(--brand-blue)' }} />
              <span>Pending Customer Receivables</span>
            </h3>
            {onNavigate && (
              <button onClick={() => onNavigate('sales-receivables')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                View All
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {outstandingClients.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                All client accounts are fully settled.
              </div>
            ) : (
              outstandingClients.map(c => (
                <div 
                  key={c.id}
                  style={{
                    padding: '0.75rem 0.85rem',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.85rem' }}>{c.customer_name}</div>
                    <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '2px' }}>
                      Invoice #{c.document_number} &bull; Due: {c.due_date ? c.due_date.split('-').reverse().join('/') : '-'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontWeight: 800, color: 'var(--brand-blue)', fontSize: '0.95rem' }}>
                        ₹ {c.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: '0.675rem', color: '#64748b' }}>
                        of ₹{Number(c.total || 0).toLocaleString('en-IN')}
                      </div>
                    </div>

                    <button
                      onClick={() => setLedgerCustomer(c.customer_name)}
                      className="btn-ghost"
                      style={{ padding: '0.35rem', color: 'var(--brand-blue)' }}
                      title="Customer Ledger"
                    >
                      <BookOpen size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Outstanding Suppliers */}
        <div className="card glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Truck size={17} style={{ color: '#dc2626' }} />
              <span>Pending Supplier Payables</span>
            </h3>
            {onNavigate && (
              <button onClick={() => onNavigate('purchases-payables')} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                View All
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {outstandingVendors.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                All vendor purchase bills are fully settled.
              </div>
            ) : (
              outstandingVendors.map(p => (
                <div 
                  key={p.id}
                  style={{
                    padding: '0.75rem 0.85rem',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.85rem' }}>{p.supplier_name}</div>
                    <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '2px' }}>
                      PO #{p.purchase_number} (Bill #{p.supplier_invoice_number})
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontWeight: 800, color: '#dc2626', fontSize: '0.95rem' }}>
                        ₹ {p.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: '0.675rem', color: '#64748b' }}>
                        of ₹{p.total_amount.toLocaleString('en-IN')}
                      </div>
                    </div>

                    <button
                      onClick={() => setLedgerSupplierId(p.supplier_id)}
                      className="btn-ghost"
                      style={{ padding: '0.35rem', color: 'var(--brand-blue)' }}
                      title="Supplier Ledger"
                    >
                      <BookOpen size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Modals */}
      {showPaymentModal && (
        <RecordPaymentModal
          userEmail={userEmail}
          onClose={() => setShowPaymentModal(false)}
          onPaymentRecorded={() => {
            setShowPaymentModal(false);
            loadData();
          }}
        />
      )}

      {showExpenseModal && (
        <ExpenseModal
          userEmail={userEmail}
          onClose={() => setShowExpenseModal(false)}
          onSaved={() => {
            setShowExpenseModal(false);
            loadData();
          }}
        />
      )}

      {showPurchaseModal && (
        <PurchaseModal
          userEmail={userEmail}
          onClose={() => setShowPurchaseModal(false)}
          onSaved={() => {
            setShowPurchaseModal(false);
            loadData();
          }}
        />
      )}

      {showSupplierModal && (
        <SupplierModal
          onClose={() => setShowSupplierModal(false)}
          onSaved={() => {
            setShowSupplierModal(false);
            loadData();
          }}
        />
      )}

      {ledgerCustomer && (
        <CustomerLedgerModal
          customerName={ledgerCustomer}
          onClose={() => setLedgerCustomer(null)}
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
