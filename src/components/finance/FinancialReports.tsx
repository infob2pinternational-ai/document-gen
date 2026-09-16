import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  Scale, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Check
} from 'lucide-react';
import type { 
  BalanceSheetReport, 
  TrialBalanceItem, 
  FinancialPeriodLock, 
  FinancialAuditLog,
  CashFlowStatement,
  YearEndClosingStatus,
  UserRole
} from '../../types';
import { financeService } from '../../services/financeService';
import { AccessRestricted } from './AccessRestricted';

interface FinancialReportsProps {
  userEmail?: string;
  userRole?: UserRole | string;
}

export const FinancialReports: React.FC<FinancialReportsProps> = ({
  userEmail = 'accounts@b2p.com',
  userRole = 'accounts'
}) => {
  const [activeTab, setActiveTab] = useState<'balancesheet' | 'trialbalance' | 'cashflow' | 'aging' | 'locks' | 'yearend' | 'audit'>('balancesheet');
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [trialBalance, setTrialBalance] = useState<{ items: TrialBalanceItem[]; total_debits: number; total_credits: number; is_balanced: boolean; difference: number } | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowStatement | null>(null);
  const [periodLocks, setPeriodLocks] = useState<FinancialPeriodLock[]>([]);
  const [auditLogs, setAuditLogs] = useState<FinancialAuditLog[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [selectedFY, setSelectedFY] = useState<string>('FY 2026-27');
  const [closingStatus, setClosingStatus] = useState<YearEndClosingStatus | null>(null);
  const [isProcessingClose, setIsProcessingClose] = useState(false);
  const [closingMessage, setClosingMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadAllData = async () => {
    try {
      const bs = await financeService.getBalanceSheet();
      const tb = financeService.getTrialBalance();
      const cf = await financeService.getCashFlowStatement();
      const locks = financeService.getPeriodLocks();
      const logs = financeService.getAuditLogs(100);
      const inv = await financeService.getSalesInvoices();
      const pur = financeService.getPurchases();
      const cls = financeService.getYearEndClosingStatus(selectedFY);

      setBalanceSheet(bs);
      setTrialBalance(tb);
      setCashFlow(cf);
      setPeriodLocks(locks);
      setAuditLogs(logs);
      setInvoices(inv);
      setPurchases(pur);
      setClosingStatus(cls);
    } catch (e) {
      console.error('Failed to load financial statements:', e);
    }
  };

  useEffect(() => {
    loadAllData();
    const unsub = financeService.subscribe(loadAllData);
    return unsub;
  }, [selectedFY]);

  const handleToggleLock = async (lockId: string, currentStatus: boolean) => {
    if (userRole !== 'owner') {
      alert('Only OWNER role has permission to lock or unlock financial periods.');
      return;
    }
    const newStatus = !currentStatus;
    if (confirm(`Are you sure you want to ${newStatus ? 'LOCK' : 'UNLOCK'} this accounting period?`)) {
      try {
        await financeService.togglePeriodLock(lockId, newStatus, userEmail);
        loadAllData();
      } catch (err: any) {
        alert(err.message || 'Failed to update period lock.');
      }
    }
  };

  const handlePerformYearEndClose = async () => {
    if (userRole !== 'owner') {
      alert('Only OWNER role has statutory permission to perform Year-End Closing.');
      return;
    }

    if (!trialBalance?.is_balanced) {
      alert(`Cannot close financial year: Trial Balance has an accounting imbalance of ₹${trialBalance?.difference.toFixed(2)}. Please resolve all journal imbalances first.`);
      return;
    }

    const nextFY = selectedFY === 'FY 2025-26' ? 'FY 2026-27' : 'FY 2027-28';
    if (!confirm(`Are you sure you want to perform Year-End Closing for ${selectedFY}? This will transfer current year net profit/loss to Retained Earnings and lock the period.`)) {
      return;
    }

    setIsProcessingClose(true);
    setClosingMessage(null);

    try {
      const res = await financeService.performYearEndClosing(selectedFY, nextFY, userEmail);
      setClosingMessage({
        text: `Year-end closing for ${selectedFY} completed successfully! Closing Voucher: ${res.closingJv.voucher_number}. Period is now LOCKED.`,
        type: 'success'
      });
      loadAllData();
    } catch (err: any) {
      setClosingMessage({
        text: err.message || 'Failed to perform year-end closing.',
        type: 'error'
      });
    } finally {
      setIsProcessingClose(false);
    }
  };

  // Aging Calculations
  const receivablesAging = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
  const today = new Date();
  invoices.filter(i => i.balance_amount > 0).forEach(inv => {
    const due = inv.due_date ? new Date(inv.due_date) : today;
    const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));
    if (diffDays <= 0) receivablesAging.current += inv.balance_amount;
    else if (diffDays <= 30) receivablesAging.days30 += inv.balance_amount;
    else if (diffDays <= 60) receivablesAging.days60 += inv.balance_amount;
    else receivablesAging.days90Plus += inv.balance_amount;
  });

  const payablesAging = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
  purchases.filter(p => p.balance_amount > 0 && p.status !== 'cancelled').forEach(pur => {
    const due = pur.due_date ? new Date(pur.due_date) : today;
    const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));
    if (diffDays <= 0) payablesAging.current += pur.balance_amount;
    else if (diffDays <= 30) payablesAging.days30 += pur.balance_amount;
    else if (diffDays <= 60) payablesAging.days60 += pur.balance_amount;
    else payablesAging.days90Plus += pur.balance_amount;
  });

  // REMEDIATION (2026-08-24, P2 item 11): moved after every hook - see
  // the matching note in AccountsDashboard.tsx.
  if (userRole === 'admin' || userRole === 'telecaller') {
    return <AccessRestricted currentRole={userRole as UserRole} />;
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(37, 99, 235, 0.1)',
              color: 'var(--brand-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Scale size={18} />
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Financial Statements & Statutory Reports
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Indian GAAP double-entry Balance Sheet, Trial Balance, Cash Flow, Aging, Period Locks, and Year-End Closing.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Printer size={16} />
          <span>Print Statement</span>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { id: 'balancesheet', label: 'Balance Sheet' },
          { id: 'trialbalance', label: 'Trial Balance' },
          { id: 'cashflow', label: 'Cash Flow Statement' },
          { id: 'aging', label: 'Aging Analysis (A/R & A/P)' },
          { id: 'locks', label: 'Financial Period Locks' },
          { id: 'yearend', label: 'Year-End Closing' },
          { id: 'audit', label: 'Financial Audit Trail' }
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
              background: activeTab === tab.id ? 'var(--brand-blue)' : 'transparent',
              color: activeTab === tab.id ? '#ffffff' : '#64748b'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: BALANCE SHEET */}
      {activeTab === 'balancesheet' && balanceSheet && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {!balanceSheet.is_balanced && (
            <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} />
              <span>Accounting Integrity Warning: Balance sheet equation is out of balance by ₹{balanceSheet.difference.toFixed(2)} (Assets ≠ Liabilities + Equity).</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            
            {/* ASSETS COLUMN */}
            <div className="card" style={{ padding: '1.5rem', background: '#ffffff', borderTop: '4px solid var(--brand-blue)' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.25rem 0', color: 'var(--text-primary)' }}>
                Assets (Application of Funds)
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
                <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>I. Non-Current Assets</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', paddingLeft: '0.75rem' }}>
                    <span>Fixed Assets (LED Vans Fleet & Equipment)</span>
                    <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.assets.fixed_assets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>II. Current Assets</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '0.75rem', color: '#64748b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Cash & Bank Balances</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.assets.cash_and_bank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Sundry Debtors (A/R)</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.assets.sundry_debtors.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Input GST Credit Balance</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.assets.input_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '2px solid #e2e8f0', fontWeight: 800, fontSize: '1rem' }}>
                  <span>TOTAL ASSETS</span>
                  <span className="mono" style={{ color: 'var(--brand-blue)' }}>₹ {balanceSheet.assets.total_assets.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* LIABILITIES & EQUITY COLUMN */}
            <div className="card" style={{ padding: '1.5rem', background: '#ffffff', borderTop: '4px solid #16a34a' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1.25rem 0', color: 'var(--text-primary)' }}>
                Liabilities & Equity (Source of Funds)
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
                <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>I. Equity & Reserves</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '0.75rem', color: '#64748b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Owner Capital Account</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.equity.owner_capital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Retained Earnings</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.equity.retained_earnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Current Period Net Profit (P&L)</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#16a34a' }}>₹ {balanceSheet.equity.current_period_profit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>II. Liabilities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '0.75rem', color: '#64748b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Sundry Creditors (A/P)</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.liabilities.sundry_creditors.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Output GST Liability</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.liabilities.output_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Vehicle Equipment Financing</span>
                      <span className="mono" style={{ fontWeight: 600, color: '#0f172a' }}>₹ {balanceSheet.liabilities.short_term_loans.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '2px solid #e2e8f0', fontWeight: 800, fontSize: '1rem' }}>
                  <span>TOTAL LIABILITIES & EQUITY</span>
                  <span className="mono" style={{ color: '#16a34a' }}>₹ {balanceSheet.total_liabilities_and_equity.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 2: TRIAL BALANCE */}
      {activeTab === 'trialbalance' && trialBalance && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card" style={{ padding: '1rem 1.25rem', background: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>General Ledger Trial Balance</h3>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Closing Debit vs Credit Balance Equality Check</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {trialBalance.is_balanced ? (
                <>
                  <CheckCircle2 size={16} color="#16a34a" />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#16a34a' }}>
                    Balanced (₹ {trialBalance.total_debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })})
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={16} color="#dc2626" />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#dc2626' }}>
                    Imbalance: ₹ {trialBalance.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, background: '#ffffff', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem', width: '90px' }}>Code</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Account Head Name</th>
                  <th style={{ padding: '0.65rem 1rem', width: '180px' }}>Group Name</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right', width: '150px' }}>Debit Balance (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right', width: '150px' }}>Credit Balance (₹)</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.items.map(i => (
                  <tr key={i.account_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>{i.account_code}</td>
                    <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{i.account_name}</td>
                    <td style={{ padding: '0.65rem 1rem', color: '#64748b' }}>{i.group_name}</td>
                    <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: i.closing_debit > 0 ? '#0f172a' : '#94a3b8' }}>
                      {i.closing_debit > 0 ? `₹ ${i.closing_debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: i.closing_credit > 0 ? '#0f172a' : '#94a3b8' }}>
                      {i.closing_credit > 0 ? `₹ ${i.closing_credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                  <td colSpan={3} style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total Trial Balance:</td>
                  <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--brand-blue)' }}>₹ {trialBalance.total_debits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--brand-blue)' }}>₹ {trialBalance.total_credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CASH FLOW */}
      {activeTab === 'cashflow' && cashFlow && (
        <div className="card" style={{ padding: '1.5rem', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Direct Method Cash Flow Statement</h3>
            <span className="mono" style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Period: {cashFlow.financial_year}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.85rem' }}>
            
            {/* Operating Activities */}
            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>A. Cash Flows from Operating Activities</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Collections from Customer Invoices</span>
                <span className="mono" style={{ fontWeight: 600, color: '#16a34a' }}>+ ₹ {cashFlow.operating_activities.cash_from_customers.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Supplier / Procurement Payments</span>
                <span className="mono" style={{ fontWeight: 600, color: '#dc2626' }}>- ₹ {cashFlow.operating_activities.cash_to_suppliers.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Operating Fuel, Crew & Overhead Expenses</span>
                <span className="mono" style={{ fontWeight: 600, color: '#dc2626' }}>- ₹ {cashFlow.operating_activities.cash_for_operating_expenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.4rem', borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
                <span>Net Cash from Operating Activities</span>
                <span className="mono" style={{ color: cashFlow.operating_activities.net_operating_cash >= 0 ? '#16a34a' : '#dc2626' }}>
                  ₹ {cashFlow.operating_activities.net_operating_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Investing Activities */}
            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>B. Cash Flows from Investing Activities</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Fixed Assets Purchased (LED Vans / Equipment)</span>
                <span className="mono" style={{ fontWeight: 600, color: '#dc2626' }}>- ₹ {cashFlow.investing_activities.fixed_assets_purchased.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.4rem', borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
                <span>Net Cash from Investing Activities</span>
                <span className="mono">₹ {cashFlow.investing_activities.net_investing_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Financing Activities */}
            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>C. Cash Flows from Financing Activities</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Owner Capital Introduced</span>
                <span className="mono" style={{ fontWeight: 600, color: '#16a34a' }}>+ ₹ {cashFlow.financing_activities.capital_introduced.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', marginBottom: '0.35rem' }}>
                <span>Owner Drawings / Distributions</span>
                <span className="mono" style={{ fontWeight: 600, color: '#dc2626' }}>- ₹ {cashFlow.financing_activities.drawings_by_owner.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.4rem', borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
                <span>Net Cash from Financing Activities</span>
                <span className="mono">₹ {cashFlow.financing_activities.net_financing_cash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Net Movement & Reconciliation */}
            <div style={{ padding: '1.25rem', background: '#ffffff', border: '2px solid #e2e8f0', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600 }}>
                <span>Net Increase / (Decrease) in Cash & Bank:</span>
                <span className="mono" style={{ fontWeight: 800, color: cashFlow.net_cash_movement >= 0 ? '#16a34a' : '#dc2626' }}>
                  ₹ {cashFlow.net_cash_movement.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#64748b' }}>
                <span>Opening Cash & Bank Balance:</span>
                <span className="mono" style={{ fontWeight: 700 }}>₹ {cashFlow.opening_cash_and_bank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 800 }}>
                <span>Closing Cash & Bank Balance:</span>
                <span className="mono" style={{ color: 'var(--brand-blue)' }}>₹ {cashFlow.closing_cash_and_bank.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TAB 4: AGING ANALYSIS */}
      {activeTab === 'aging' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
          <div className="card" style={{ padding: '1.5rem', background: '#ffffff' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>Accounts Receivable Aging (A/R)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Current (Not Due)</span>
                <span className="mono" style={{ fontWeight: 700, color: '#16a34a' }}>₹ {receivablesAging.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>1 - 30 Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#f59e0b' }}>₹ {receivablesAging.days30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>31 - 60 Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#f97316' }}>₹ {receivablesAging.days60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>61+ Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#dc2626' }}>₹ {receivablesAging.days90Plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem', background: '#ffffff' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0' }}>Accounts Payable Aging (A/P)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Current (Not Due)</span>
                <span className="mono" style={{ fontWeight: 700, color: '#16a34a' }}>₹ {payablesAging.current.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>1 - 30 Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#f59e0b' }}>₹ {payablesAging.days30.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>31 - 60 Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#f97316' }}>₹ {payablesAging.days60.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>61+ Days Overdue</span>
                <span className="mono" style={{ fontWeight: 700, color: '#dc2626' }}>₹ {payablesAging.days90Plus.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: FINANCIAL PERIOD LOCKS */}
      {activeTab === 'locks' && (
        <div className="card" style={{ padding: 0, background: '#ffffff', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Financial Year Period Lock Management</h3>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Prevent historical back-dated voucher edits once returns are filed</span>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '0.65rem 1rem' }}>Financial Year</th>
                <th style={{ padding: '0.65rem 1rem' }}>Period Scope</th>
                <th style={{ padding: '0.65rem 1rem' }}>Date Range</th>
                <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Owner Action</th>
              </tr>
            </thead>
            <tbody>
              {periodLocks.map(lock => (
                <tr key={lock.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>{lock.financial_year}</td>
                  <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{lock.period_name}</td>
                  <td style={{ padding: '0.65rem 1rem', color: '#64748b' }}>{lock.start_date} to {lock.end_date}</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                    <span style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      background: lock.is_locked ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                      color: lock.is_locked ? '#dc2626' : '#16a34a'
                    }}>
                      {lock.is_locked ? 'LOCKED' : 'OPEN'}
                    </span>
                  </td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                    <button
                      onClick={() => handleToggleLock(lock.id, lock.is_locked)}
                      className={lock.is_locked ? 'btn-secondary' : 'btn-primary'}
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      {lock.is_locked ? <Unlock size={13} /> : <Lock size={13} />}
                      <span>{lock.is_locked ? 'Unlock Period' : 'Lock Period'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: YEAR-END CLOSING */}
      {activeTab === 'yearend' && (
        <div className="card" style={{ padding: '1.5rem', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.25rem 0' }}>Year-End Financial Closing & Period Lock</h3>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#64748b' }}>
                Transfer statutory P&L net margins into Retained Earnings, lock the closed financial year, and prepare the opening balances.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Select FY:</span>
              <select
                value={selectedFY}
                onChange={(e) => setSelectedFY(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.8125rem', padding: '0.35rem 0.65rem' }}
              >
                <option value="FY 2025-26">FY 2025-26 (01 Apr 2025 – 31 Mar 2026)</option>
                <option value="FY 2026-27">FY 2026-27 (01 Apr 2026 – 31 Mar 2027)</option>
              </select>
            </div>
          </div>

          {closingMessage && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: closingMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: closingMessage.type === 'success' ? '#047857' : '#b91c1c',
              border: `1px solid ${closingMessage.type === 'success' ? '#10b981' : '#ef4444'}`,
              fontSize: '0.8125rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.25rem'
            }}>
              {closingMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{closingMessage.text}</span>
            </div>
          )}

          {/* Pre-Closing Validation Checklist */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Trial Balance Balance Check</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
                {closingStatus?.trial_balance_balanced ? (
                  <>
                    <Check size={16} color="#16a34a" />
                    <span style={{ fontWeight: 700, color: '#16a34a', fontSize: '0.9rem' }}>Balanced (₹0.00 Diff)</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} color="#dc2626" />
                    <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.9rem' }}>Imbalance: ₹{closingStatus?.trial_balance_difference.toFixed(2)}</span>
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Period Lock Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
                {closingStatus?.is_locked ? (
                  <>
                    <Lock size={16} color="#dc2626" />
                    <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.9rem' }}>Period is Locked</span>
                  </>
                ) : (
                  <>
                    <Clock size={16} color="#f59e0b" />
                    <span style={{ fontWeight: 700, color: '#f59e0b', fontSize: '0.9rem' }}>Open for Closing</span>
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Closing Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem' }}>
                {closingStatus?.is_closed ? (
                  <>
                    <CheckCircle2 size={16} color="#16a34a" />
                    <span style={{ fontWeight: 700, color: '#16a34a', fontSize: '0.9rem' }}>Closed ({closingStatus.closing_voucher_number})</span>
                  </>
                ) : (
                  <>
                    <Clock size={16} color="#64748b" />
                    <span style={{ fontWeight: 700, color: '#64748b', fontSize: '0.9rem' }}>Pending Year-End Run</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>Authorized Statutory Action:</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Requires OWNER role. Generates formal Year-End Journal Entry and locks the accounting year.</div>
            </div>

            <button
              onClick={handlePerformYearEndClose}
              disabled={isProcessingClose || closingStatus?.is_closed || !closingStatus?.trial_balance_balanced}
              className="btn-primary"
              style={{ padding: '0.55rem 1.25rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Lock size={15} />
              <span>{isProcessingClose ? 'Processing...' : closingStatus?.is_closed ? 'Year-End Already Closed' : `Close ${selectedFY}`}</span>
            </button>
          </div>

        </div>
      )}

      {/* TAB 7: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="card" style={{ padding: 0, background: '#ffffff', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Financial Transaction Audit Log</h3>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Tamper-evident log of all financial postings, disbursements, receipts, and configurations</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '0.65rem 1rem', width: '160px' }}>Timestamp</th>
                <th style={{ padding: '0.65rem 1rem', width: '180px' }}>User & Role</th>
                <th style={{ padding: '0.65rem 1rem', width: '140px' }}>Action</th>
                <th style={{ padding: '0.65rem 1rem' }}>Transaction Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="mono" style={{ padding: '0.65rem 1rem', color: '#64748b' }}>
                    {new Date(log.timestamp).toLocaleString('en-IN', { hour12: true })}
                  </td>
                  <td style={{ padding: '0.65rem 1rem' }}>
                    <div style={{ fontWeight: 600 }}>{log.user_email}</div>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>{log.user_role}</span>
                  </td>
                  <td style={{ padding: '0.65rem 1rem' }}>
                    <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', background: '#f1f5f9', fontSize: '0.7rem', fontWeight: 700 }}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ padding: '0.65rem 1rem', color: '#334155' }}>
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
};
