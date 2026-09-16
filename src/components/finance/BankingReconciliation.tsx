import React, { useState, useEffect } from 'react';
import { 
  Landmark, 
  ArrowRightLeft, 
  Building2, 
  X, 
  Check, 
  AlertCircle, 
  Plus, 
  Search, 
  Calendar, 
  CheckCircle2,
  Save,
  HelpCircle,
  FileSpreadsheet
} from 'lucide-react';
import type { BankAccount, AccountHead, BankReconciliationItem, UserRole } from '../../types';
import { financeService } from '../../services/financeService';
import { AccessRestricted } from './AccessRestricted';

interface BankingReconciliationProps {
  userEmail?: string;
  userRole?: UserRole;
}

export const BankingReconciliation: React.FC<BankingReconciliationProps> = ({
  userEmail = 'accounts@b2p.com',
  userRole = 'owner'
}) => {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [cashAndBankHeads, setCashAndBankHeads] = useState<AccountHead[]>([]);
  const [activeTab, setActiveTab] = useState<'accounts' | 'bankbook' | 'cashbook' | 'reconcile'>('accounts');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New Bank Account Modal State
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newIfsc, setNewIfsc] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newAccountType, setNewAccountType] = useState<'current' | 'savings'>('current');
  const [newOpeningBalance, setNewOpeningBalance] = useState<number>(0);
  const [accountError, setAccountError] = useState('');

  // Contra Modal State
  const [showContraModal, setShowContraModal] = useState(false);
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [contraAmount, setContraAmount] = useState<number>(0);
  const [contraDate, setContraDate] = useState(new Date().toISOString().split('T')[0]);
  const [contraReference, setContraReference] = useState('');
  const [contraError, setContraError] = useState<string | null>(null);

  // Reconciliation State
  const [selectedBankForRecon, setSelectedBankForRecon] = useState<string>('');
  const [statementBalance, setStatementBalance] = useState<number>(0);
  const [reconAsOfDate, setReconAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [clearedTransactions, setClearedTransactions] = useState<Record<string, boolean>>({});
  const [importedItems, setImportedItems] = useState<BankReconciliationItem[]>([]);
  const [newStatementDesc, setNewStatementDesc] = useState('');
  const [newStatementAmount, setNewStatementAmount] = useState<number>(0);
  const [newStatementDirection, setNewStatementDirection] = useState<'debit' | 'credit'>('credit');
  const [newStatementRef, setNewStatementRef] = useState('');

  const loadData = () => {
    const accs = financeService.getBankAccounts();
    setBankAccounts(accs);

    const heads = financeService.getAccountHeads(true).filter((a: AccountHead) => 
      a.code.startsWith('1001') || a.code.startsWith('1002') || a.group_id === 'ag-1000'
    );
    setCashAndBankHeads(heads);

    if (!fromAccountId && heads.length > 0) setFromAccountId(heads[0].id);
    if (!toAccountId && heads.length > 1) setToAccountId(heads[1].id);
    if (!selectedBankForRecon && accs.length > 0) setSelectedBankForRecon(accs[0].id);
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(loadData);
    return unsub;
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError('');

    if (!newBankName.trim() || !newAccountNumber.trim()) {
      setAccountError('Bank name and account number are required.');
      return;
    }

    try {
      await financeService.saveBankAccount({
        bank_name: newBankName.trim(),
        account_name: newAccountName.trim() || `${newBankName.trim()} Operating Account`,
        account_number: newAccountNumber.trim(),
        ifsc_code: newIfsc.trim().toUpperCase(),
        branch: newBranch.trim(),
        account_type: newAccountType,
        opening_balance: Number(newOpeningBalance) || 0
      }, userEmail);

      setShowAddAccountModal(false);
      setNewBankName('');
      setNewAccountName('');
      setNewAccountNumber('');
      setNewIfsc('');
      setNewBranch('');
      setNewOpeningBalance(0);
      showToast('Bank account successfully created and mapped to Chart of Accounts!');
      loadData();
    } catch (err: any) {
      setAccountError(err.message || 'Failed to save bank account.');
    }
  };

  const handlePostContra = async (e: React.FormEvent) => {
    e.preventDefault();
    setContraError(null);

    if (contraAmount <= 0) {
      setContraError('Please enter a valid transfer amount greater than zero.');
      return;
    }
    if (fromAccountId === toAccountId) {
      setContraError('Source and destination accounts cannot be the same.');
      return;
    }

    try {
      await financeService.recordContraVoucher(
        fromAccountId,
        toAccountId,
        contraAmount,
        contraDate,
        contraReference,
        userEmail
      );
      setShowContraModal(false);
      setContraAmount(0);
      setContraReference('');
      showToast('Contra transfer voucher posted to General Ledger!', 'success');
      loadData();
    } catch (err: any) {
      setContraError(err.message || 'Failed to record contra voucher.');
    }
  };

  const handleAddStatementItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatementAmount || newStatementAmount <= 0) return;

    const newItem: BankReconciliationItem = {
      id: `stmt-line-${Date.now()}`,
      statement_date: reconAsOfDate,
      reference_number: newStatementRef.trim() || undefined,
      description: newStatementDesc.trim() || 'Bank statement entry',
      amount: Number(newStatementAmount),
      direction: newStatementDirection,
      status: 'unreconciled'
    };

    setImportedItems([...importedItems, newItem]);
    setNewStatementDesc('');
    setNewStatementAmount(0);
    setNewStatementRef('');
  };

  const handleSaveReconStatement = async () => {
    try {
      const recon = financeService.getBankReconciliation(
        selectedBankForRecon,
        statementBalance,
        reconAsOfDate,
        importedItems
      );
      await financeService.saveBankReconciliationStatement(recon, userEmail);
      showToast('Bank statement reconciliation session saved successfully!');
    } catch (err: any) {
      showToast(err.message || 'Failed to save reconciliation session.', 'error');
    }
  };

  const bankBook = financeService.getBankBook(selectedBankForRecon || undefined, startDate || undefined, endDate || undefined);
  const cashBook = financeService.getCashBook(undefined, startDate || undefined, endDate || undefined);

  const selectedBank = bankAccounts.find(b => b.id === selectedBankForRecon) || bankAccounts[0];
  const bookBalance = selectedBank ? selectedBank.current_balance : (bankBook.closing_balance || 0);
  const variance = Math.abs(statementBalance - bookBalance);

  const toggleCleared = (ref: string) => {
    setClearedTransactions(prev => ({
      ...prev,
      [ref]: !prev[ref]
    }));
  };

  const filteredBankEntries = bankBook.entries.filter(e => {
    const term = searchTerm.toLowerCase().trim();
    return !term || e.reference.toLowerCase().includes(term) || e.description.toLowerCase().includes(term);
  });

  const filteredCashEntries = cashBook.entries.filter(e => {
    const term = searchTerm.toLowerCase().trim();
    return !term || e.reference.toLowerCase().includes(term) || e.description.toLowerCase().includes(term);
  });

  // REMEDIATION (2026-08-24, P2 item 11): moved after every hook - see
  // the matching note in AccountsDashboard.tsx.
  if (userRole === 'admin' || userRole === 'telecaller') {
    return <AccessRestricted currentRole={userRole} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Toast Feedback */}
      {feedback && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          background: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: feedback.type === 'success' ? '#047857' : '#b91c1c',
          border: `1px solid ${feedback.type === 'success' ? '#10b981' : '#ef4444'}`,
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Header & Quick Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Landmark size={22} style={{ color: 'var(--brand-blue)' }} />
            <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
              Banking & Cash Management
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#64748b' }}>
            Central double-entry control over operating bank accounts, office cash vault, contra transfers, and statutory reconciliations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowAddAccountModal(true)}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.8125rem' }}
          >
            <Plus size={15} />
            <span>Add Bank Account</span>
          </button>
          <button
            onClick={() => setShowContraModal(true)}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
          >
            <ArrowRightLeft size={15} />
            <span>Transfer Funds (Contra)</span>
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.2rem' }}>
        {[
          { id: 'accounts', label: `Bank Accounts (${bankAccounts.length})` },
          { id: 'bankbook', label: 'Bank Book Ledger' },
          { id: 'cashbook', label: 'Cash Book Ledger' },
          { id: 'reconcile', label: 'Bank Statement Reconciliation' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`btn-ghost ${activeTab === tab.id ? 'active' : ''}`}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem',
              fontWeight: 700,
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-blue)' : '2px solid transparent',
              borderRadius: 0,
              color: activeTab === tab.id ? 'var(--brand-blue)' : '#64748b'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: BANK & CASH ACCOUNTS */}
      {activeTab === 'accounts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {bankAccounts.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <Landmark size={40} style={{ color: '#cbd5e1', margin: '0 auto 0.75rem auto' }} />
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>No Bank Accounts Registered</div>
              <p style={{ fontSize: '0.8125rem', margin: '0.35rem 0 1rem 0' }}>
                Register your business bank accounts to track ledger flows and perform statement reconciliation.
              </p>
              <button
                onClick={() => setShowAddAccountModal(true)}
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
              >
                <Plus size={16} />
                <span>Register Bank Account</span>
              </button>
            </div>
          ) : (
            bankAccounts.map(ba => (
              <div key={ba.id} className="card" style={{ padding: '1.25rem', background: '#ffffff', border: ba.is_default ? '2px solid rgba(37, 99, 235, 0.4)' : '1px solid #e2e8f0', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '10px',
                      background: 'rgba(37, 99, 235, 0.1)',
                      color: 'var(--brand-blue)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Building2 size={20} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                        {ba.bank_name}
                      </h3>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {ba.branch || 'Main Branch'} &bull; {ba.account_type.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {ba.is_default && (
                    <span style={{ padding: '0.2rem 0.5rem', borderRadius: '9999px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--brand-blue)', fontSize: '0.68rem', fontWeight: 700 }}>
                      Primary
                    </span>
                  )}
                </div>

                <div style={{ padding: '0.65rem 0.85rem', background: '#f8fafc', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.75rem' }}>
                  <div style={{ color: '#64748b' }}>Account Number:</div>
                  <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                    {ba.account_number}
                  </div>
                  {ba.ifsc_code && (
                    <div style={{ color: '#94a3b8', marginTop: '0.2rem' }}>
                      IFSC: {ba.ifsc_code}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem' }}>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Live GL Balance</div>
                    <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginTop: '0.15rem' }}>
                      ₹ {ba.current_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedBankForRecon(ba.id);
                      setActiveTab('reconcile');
                    }}
                    className="btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                  >
                    Reconcile
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: BANK BOOK */}
      {activeTab === 'bankbook' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          {/* Controls Bar */}
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '320px' }}>
              <Search size={15} style={{ color: '#94a3b8' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search reference or narration..."
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#64748b' }}>
                <Calendar size={13} />
                <span>Date Range:</span>
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
              />
              {(startDate || endDate) && (
                <button onClick={() => { setStartDate(''); setEndDate(''); }} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Totals Summary Ribbon */}
          <div style={{ padding: '0.65rem 1.25rem', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', flexWrap: 'wrap', gap: '1rem' }}>
            <span>Bank Operating Inflows & Outflows:</span>
            <div style={{ display: 'flex', gap: '1.25rem' }}>
              <div>Deposits: <strong className="mono" style={{ color: '#10b981' }}>₹ {bankBook.total_deposits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Withdrawals: <strong className="mono" style={{ color: '#dc2626' }}>₹ {bankBook.total_withdrawals.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Closing Balance: <strong className="mono" style={{ color: 'var(--brand-blue)' }}>₹ {bankBook.closing_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Voucher Ref</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Transaction Details</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Deposits (Dr)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Withdrawals (Cr)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredBankEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                      No posted bank transactions recorded in this period.
                    </td>
                  </tr>
                ) : (
                  filteredBankEntries.map((e, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 1rem', whiteSpace: 'nowrap' }}>{e.date}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 600, color: 'var(--brand-blue)' }}>
                        {e.reference}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', color: '#334155' }}>
                        {e.description}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: e.debit > 0 ? '#10b981' : '#94a3b8', fontWeight: e.debit > 0 ? 700 : 400 }}>
                        {e.debit > 0 ? `₹ ${e.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: e.credit > 0 ? '#dc2626' : '#94a3b8', fontWeight: e.credit > 0 ? 700 : 400 }}>
                        {e.credit > 0 ? `₹ ${e.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 800 }}>
                        ₹ {e.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* TAB 3: CASH BOOK */}
      {activeTab === 'cashbook' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          {/* Controls Bar */}
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '320px' }}>
              <Search size={15} style={{ color: '#94a3b8' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search reference or narration..."
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#64748b' }}>
                <Calendar size={13} />
                <span>Date Range:</span>
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
              />
              {(startDate || endDate) && (
                <button onClick={() => { setStartDate(''); setEndDate(''); }} className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Totals Summary Ribbon */}
          <div style={{ padding: '0.65rem 1.25rem', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', flexWrap: 'wrap', gap: '1rem' }}>
            <span>Office Vault Cash Inflows & Outflows:</span>
            <div style={{ display: 'flex', gap: '1.25rem' }}>
              <div>Receipts: <strong className="mono" style={{ color: '#10b981' }}>₹ {cashBook.total_receipts.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Disbursements: <strong className="mono" style={{ color: '#dc2626' }}>₹ {cashBook.total_payments.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Cash in Hand: <strong className="mono" style={{ color: 'var(--brand-blue)' }}>₹ {cashBook.closing_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Voucher Ref</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Transaction Details</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Receipts (Dr)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Payments (Cr)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredCashEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                      No posted cash transactions recorded in this period.
                    </td>
                  </tr>
                ) : (
                  filteredCashEntries.map((e, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 1rem', whiteSpace: 'nowrap' }}>{e.date}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 600, color: 'var(--brand-blue)' }}>
                        {e.reference}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', color: '#334155' }}>
                        {e.description}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: e.debit > 0 ? '#10b981' : '#94a3b8', fontWeight: e.debit > 0 ? 700 : 400 }}>
                        {e.debit > 0 ? `₹ ${e.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: e.credit > 0 ? '#dc2626' : '#94a3b8', fontWeight: e.credit > 0 ? 700 : 400 }}>
                        {e.credit > 0 ? `₹ ${e.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 800 }}>
                        ₹ {e.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* TAB 4: STATEMENT RECONCILIATION */}
      {activeTab === 'reconcile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Statutory Notice Disclaimer */}
          <div style={{ padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '0.78rem', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HelpCircle size={16} style={{ flexShrink: 0 }} />
            <span>
              <strong>Bank feed not connected — reconciliation is currently manual/import based:</strong> Match internal general ledger book transactions against bank statements to identify timing differences, uncleared deposits, and pending bank charges.
            </span>
          </div>

          <div className="card" style={{ padding: '1.25rem', background: '#ffffff' }}>
            
            {/* Account & Statement Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                  Reconciling Bank Account:
                </label>
                <select
                  value={selectedBankForRecon}
                  onChange={(e) => setSelectedBankForRecon(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                >
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bank_name} ({b.account_number.slice(-4)})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                  Reconciliation As Of Date:
                </label>
                <input
                  type="date"
                  value={reconAsOfDate}
                  onChange={(e) => setReconAsOfDate(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                  Bank Statement Closing Balance (₹):
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={statementBalance || ''}
                  onChange={(e) => setStatementBalance(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="input-field mono"
                  style={{ width: '100%', fontSize: '0.85rem', fontWeight: 700, textAlign: 'right' }}
                />
              </div>
            </div>

            {/* Reconciliation KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>General Ledger Book Balance</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '0.2rem' }}>
                  ₹ {bookBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>Bank Statement Balance</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.2rem' }}>
                  ₹ {statementBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: variance === 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', border: variance === 0 ? '1px solid #86efac' : '1px solid #fca5a5' }}>
                <div style={{ fontSize: '0.7rem', color: variance === 0 ? '#047857' : '#b91c1c', fontWeight: 700 }}>
                  {variance === 0 ? 'Reconciliation Status' : 'Variance to Reconcile'}
                </div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: variance === 0 ? '#047857' : '#b91c1c', marginTop: '0.2rem' }}>
                  {variance === 0 ? 'Fully Reconciled' : `₹ ${variance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
                </div>
              </div>
            </div>

            {/* Manual Statement Entry / Import Matrix */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <FileSpreadsheet size={15} color="var(--brand-blue)" />
                <span>Import / Add Statement Transactions:</span>
              </div>

              <form onSubmit={handleAddStatementItem} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', alignItems: 'flex-end', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#64748b' }}>Description *</label>
                  <input
                    type="text"
                    value={newStatementDesc}
                    onChange={(e) => setNewStatementDesc(e.target.value)}
                    placeholder="e.g. UPI Receipt / Bank Charge"
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.75rem' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#64748b' }}>Ref / UTR #</label>
                  <input
                    type="text"
                    value={newStatementRef}
                    onChange={(e) => setNewStatementRef(e.target.value)}
                    placeholder="e.g. UTR-998822"
                    className="input-field mono"
                    style={{ width: '100%', fontSize: '0.75rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#64748b' }}>Type</label>
                  <select
                    value={newStatementDirection}
                    onChange={(e) => setNewStatementDirection(e.target.value as any)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.75rem' }}
                  >
                    <option value="credit">Credit / Deposit (+)</option>
                    <option value="debit">Debit / Withdrawal (-)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#64748b' }}>Amount (₹) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newStatementAmount || ''}
                    onChange={(e) => setNewStatementAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="input-field mono"
                    style={{ width: '100%', fontSize: '0.75rem', textAlign: 'right' }}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.45rem 0.75rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                >
                  <Plus size={13} />
                  <span>Add Line</span>
                </button>
              </form>

              {importedItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '150px', overflowY: 'auto' }}>
                  {importedItems.map((item) => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.75rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="mono" style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>{item.reference_number || 'NO-REF'}</span>
                        <span>{item.description}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span className="mono" style={{ fontWeight: 700, color: item.direction === 'credit' ? '#16a34a' : '#dc2626' }}>
                          {item.direction === 'credit' ? '+' : '-'} ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                        <button
                          onClick={() => setImportedItems(importedItems.filter(i => i.id !== item.id))}
                          className="btn-ghost"
                          style={{ padding: '0.1rem 0.3rem', color: '#dc2626' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cleared Checklist */}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>
                  Book Transactions (Tick Cleared Items):
                </div>
                <button
                  onClick={handleSaveReconStatement}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                >
                  <Save size={14} />
                  <span>Save Reconciliation Session</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '250px', overflowY: 'auto' }}>
                {bankBook.entries.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                    No book transactions recorded for this bank account.
                  </div>
                ) : (
                  bankBook.entries.map((e, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => toggleCleared(e.reference)}
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '0.5rem 0.85rem', 
                        background: clearedTransactions[e.reference] ? 'rgba(16, 185, 129, 0.06)' : '#f8fafc',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        border: clearedTransactions[e.reference] ? '1px solid #86efac' : '1px solid #e2e8f0',
                        fontSize: '0.78rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <input 
                          type="checkbox" 
                          checked={!!clearedTransactions[e.reference]} 
                          onChange={() => {}} 
                          style={{ cursor: 'pointer' }}
                        />
                        <div>
                          <span className="mono" style={{ fontWeight: 700, color: 'var(--brand-blue)', marginRight: '0.5rem' }}>{e.reference}</span>
                          <span>{e.description}</span>
                        </div>
                      </div>
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {e.debit > 0 ? `+ ₹${e.debit.toFixed(2)}` : `- ₹${e.credit.toFixed(2)}`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Add Bank Account Modal */}
      {showAddAccountModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: '480px', padding: 0, background: '#ffffff', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Landmark size={18} color="var(--brand-blue)" />
                <span>Register Bank Account</span>
              </h2>
              <button onClick={() => setShowAddAccountModal(false)} className="btn-ghost" style={{ padding: '0.35rem' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {accountError && (
                <div style={{ padding: '0.65rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '0.78rem' }}>
                  {accountError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Bank Name *</label>
                <input
                  type="text"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                  placeholder="e.g. State Bank of India, Federal Bank"
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Account Number *</label>
                <input
                  type="text"
                  value={newAccountNumber}
                  onChange={(e) => setNewAccountNumber(e.target.value)}
                  placeholder="e.g. 10020100998877"
                  className="input-field mono"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>IFSC Code</label>
                  <input
                    type="text"
                    value={newIfsc}
                    onChange={(e) => setNewIfsc(e.target.value)}
                    placeholder="e.g. SBIN0001234"
                    className="input-field mono"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Branch</label>
                  <input
                    type="text"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    placeholder="e.g. MG Road, Kochi"
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Account Type</label>
                  <select
                    value={newAccountType}
                    onChange={(e) => setNewAccountType(e.target.value as any)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  >
                    <option value="current">Current Operating</option>
                    <option value="savings">Savings</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Opening Balance (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={newOpeningBalance || ''}
                    onChange={(e) => setNewOpeningBalance(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="input-field mono"
                    style={{ width: '100%', fontSize: '0.8125rem', textAlign: 'right' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Account Display Name</label>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g. B2P Operating Current Account"
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" onClick={() => setShowAddAccountModal(false)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ fontSize: '0.8125rem' }}>
                  Register Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contra Transfer Modal */}
      {showContraModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: '480px', padding: 0, background: '#ffffff', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ArrowRightLeft size={18} color="var(--brand-blue)" />
                <span>Record Contra Transfer (CV)</span>
              </h2>
              <button onClick={() => setShowContraModal(false)} className="btn-ghost" style={{ padding: '0.35rem' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePostContra} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {contraError && (
                <div style={{ padding: '0.65rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '0.78rem' }}>
                  {contraError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Source Account (Credit Outflow) *
                </label>
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                >
                  {cashAndBankHeads.map(h => (
                    <option key={h.id} value={h.id}>{h.code} - {h.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Destination Account (Debit Inflow) *
                </label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                >
                  {cashAndBankHeads.map(h => (
                    <option key={h.id} value={h.id}>{h.code} - {h.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Transfer Amount (₹) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={contraAmount || ''}
                    onChange={(e) => setContraAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="input-field mono"
                    style={{ width: '100%', fontSize: '0.85rem', fontWeight: 700, textAlign: 'right' }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Date *
                  </label>
                  <input
                    type="date"
                    value={contraDate}
                    onChange={(e) => setContraDate(e.target.value)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Reference / Cheque # / ATM Slip
                </label>
                <input
                  type="text"
                  value={contraReference}
                  onChange={(e) => setContraReference(e.target.value)}
                  placeholder="e.g. ATM-WDL-101, CHQ-5521"
                  className="input-field mono"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" onClick={() => setShowContraModal(false)} className="btn-secondary" style={{ fontSize: '0.8125rem' }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Check size={16} />
                  <span>Post Contra Voucher</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
