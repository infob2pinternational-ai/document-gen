import React, { useState, useEffect } from 'react';
import { 
  Layers, 
  Plus, 
  Search, 
  Edit3, 
  X, 
  BookOpen,
  Trash2,
  AlertCircle
} from 'lucide-react';
import type { AccountHead, AccountGroup, AccountType } from '../../types';
import { financeService, round2 } from '../../services/financeService';
import { GeneralLedgerModal } from './GeneralLedgerModal';

export const ChartOfAccounts: React.FC = () => {
  const [heads, setHeads] = useState<AccountHead[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  
  // Modal State for Add / Edit Account Head
  const [showModal, setShowModal] = useState(false);
  const [editingHead, setEditingHead] = useState<AccountHead | null>(null);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formGroupId, setFormGroupId] = useState('');
  const [formType, setFormType] = useState<AccountType>('asset');
  const [formOpeningBalance, setFormOpeningBalance] = useState<number>(0);
  const [formGstApplicable, setFormGstApplicable] = useState(false);
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // General Ledger View Modal
  const [ledgerAccountId, setLedgerAccountId] = useState<string | null>(null);

  const loadData = () => {
    setHeads(financeService.getAccountHeads(showInactive));
    setGroups(financeService.getAccountGroups());
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(loadData);
    return unsub;
  }, [showInactive]);

  const handleOpenAdd = () => {
    setEditingHead(null);
    setFormName('');
    const nextCode = (1000 + heads.length + 1).toString();
    setFormCode(nextCode);
    setFormGroupId(groups[0]?.id || 'ag-1');
    setFormType(groups[0]?.type || 'asset');
    setFormOpeningBalance(0);
    setFormGstApplicable(false);
    setFormDescription('');
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (head: AccountHead) => {
    setEditingHead(head);
    setFormName(head.name);
    setFormCode(head.code);
    setFormGroupId(head.group_id);
    setFormType(head.type);
    setFormOpeningBalance(head.opening_balance);
    setFormGstApplicable(head.gst_applicable || false);
    setFormDescription(head.description || '');
    setFormError(null);
    setShowModal(true);
  };

  const handleGroupSelect = (groupId: string) => {
    setFormGroupId(groupId);
    const grp = groups.find(g => g.id === groupId);
    if (grp) {
      setFormType(grp.type);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Account name is required.');
      return;
    }
    if (!formCode.trim()) {
      setFormError('Account code is required.');
      return;
    }

    try {
      const group = groups.find(g => g.id === formGroupId);
      await financeService.saveAccountHead({
        id: editingHead ? editingHead.id : undefined,
        name: formName.trim(),
        code: formCode.trim(),
        group_id: formGroupId,
        group_name: group?.name || 'Account Group',
        type: group?.type || formType,
        opening_balance: round2(Number(formOpeningBalance) || 0),
        gst_applicable: formGstApplicable,
        description: formDescription.trim()
      });

      setShowModal(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save account head.');
    }
  };

  const handleDeactivate = async (head: AccountHead) => {
    if (window.confirm(`Are you sure you want to deactivate "${head.name}"? Inactive accounts cannot be used for new vouchers.`)) {
      try {
        await financeService.deactivateAccountHead(head.id);
        loadData();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  const handleDelete = async (head: AccountHead) => {
    if (window.confirm(`Are you sure you want to permanently delete unused account "${head.name}"?`)) {
      try {
        await financeService.deleteAccountHead(head.id);
        loadData();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  const filteredHeads = heads.filter(h => {
    const matchesType = selectedType === 'all' || h.type === selectedType;
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || 
      h.name.toLowerCase().includes(term) || 
      h.code.toLowerCase().includes(term) ||
      h.group_name.toLowerCase().includes(term);
    return matchesType && matchesSearch;
  });

  const totalAssetsBalance = round2(heads.filter(h => h.type === 'asset' && h.is_active).reduce((s, h) => s + h.current_balance, 0));
  const totalLiabilitiesBalance = round2(heads.filter(h => h.type === 'liability' && h.is_active).reduce((s, h) => s + h.current_balance, 0));
  const totalIncomeBalance = round2(heads.filter(h => h.type === 'income' && h.is_active).reduce((s, h) => s + h.current_balance, 0));
  const totalExpenseBalance = round2(heads.filter(h => h.type === 'expense' && h.is_active).reduce((s, h) => s + h.current_balance, 0));

  const getTypeBadge = (type: AccountType) => {
    const map: Record<AccountType, { bg: string; color: string; label: string }> = {
      asset: { bg: 'rgba(59, 130, 246, 0.1)', color: '#2563eb', label: 'Asset' },
      liability: { bg: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', label: 'Liability' },
      equity: { bg: 'rgba(139, 92, 246, 0.1)', color: '#7c3aed', label: 'Equity' },
      income: { bg: 'rgba(16, 185, 129, 0.1)', color: '#059669', label: 'Income' },
      expense: { bg: 'rgba(245, 158, 11, 0.1)', color: '#d97706', label: 'Expense' }
    };
    const b = map[type];
    return (
      <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '4px', background: b.bg, color: b.color, textTransform: 'uppercase' }}>
        {b.label}
      </span>
    );
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(37, 99, 235, 0.1)', color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Layers size={18} />
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Chart of Accounts (COA)
            </h1>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Authoritative double-entry ledger architecture, account codes, debit/credit nature, and dynamic book balances.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAdd}
          className="btn-primary"
          style={{ gap: '0.4rem', fontSize: '0.8125rem' }}
        >
          <Plus size={16} />
          <span>New Account Head</span>
        </button>
      </div>

      {/* Summary KPI Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Assets Position</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#2563eb' }}>
            ₹ {totalAssetsBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Cash, Bank, Debtors & Fixed Assets</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Liabilities Position</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {totalLiabilitiesBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Accounts Payable & Output Taxes</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Operating Income</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#059669' }}>
            ₹ {totalIncomeBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Advertising, LED Van & Event Billing</div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Operating Expenses</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#d97706' }}>
            ₹ {totalExpenseBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Fuel, Crew Wages, Fleet Spares & Rent</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel" style={{ padding: '0.85rem 1.15rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(['all', 'asset', 'liability', 'equity', 'income', 'expense'] as const).map((t) => {
            const isActive = selectedType === t;
            const labels: Record<typeof t, string> = {
              all: 'All Accounts',
              asset: 'Assets',
              liability: 'Liabilities',
              equity: 'Equity',
              income: 'Income',
              expense: 'Expenses'
            };
            return (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedType(t)}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: '9999px',
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive ? 'var(--brand-blue)' : 'rgba(241, 245, 249, 0.8)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show Inactive</span>
          </label>

          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search code or account..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field"
              style={{ width: '100%', paddingLeft: '2rem', fontSize: '0.78rem', paddingRight: '0.5rem', height: '32px' }}
            />
          </div>
        </div>
      </div>

      {/* Account Heads Table */}
      <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', color: 'var(--text-secondary)', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700, width: '90px' }}>Code</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Account Head</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Account Group</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Type</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Nature</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700, textAlign: 'right' }}>Opening (₹)</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700, textAlign: 'right' }}>Current Balance (₹)</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 700, textAlign: 'center', width: '160px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredHeads.length > 0 ? (
              filteredHeads.map((head) => (
                <tr 
                  key={head.id}
                  className="table-row-hover"
                  style={{ 
                    borderBottom: '1px solid rgba(226, 232, 240, 0.7)',
                    opacity: head.is_active === false ? 0.6 : 1 
                  }}
                >
                  <td className="mono" style={{ padding: '0.7rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                    {head.code}
                  </td>
                  <td style={{ padding: '0.7rem 1rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {head.name}
                      {head.is_system && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.625rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: '#f1f5f9', color: '#64748b', fontWeight: 700 }}>
                          SYSTEM
                        </span>
                      )}
                      {head.is_active === false && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.625rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>
                          DEACTIVATED
                        </span>
                      )}
                    </div>
                    {head.description && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        {head.description}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '0.7rem 1rem', color: 'var(--text-secondary)' }}>
                    {head.group_name}
                  </td>
                  <td style={{ padding: '0.7rem 1rem' }}>
                    {getTypeBadge(head.type)}
                  </td>
                  <td style={{ padding: '0.7rem 1rem', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {head.nature || ((head.type === 'asset' || head.type === 'expense') ? 'DR' : 'CR')}
                  </td>
                  <td className="mono" style={{ padding: '0.7rem 1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    ₹ {head.opening_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="mono" style={{ padding: '0.7rem 1rem', textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)' }}>
                    ₹ {head.current_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '0.7rem 1rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => setLedgerAccountId(head.id)}
                        className="btn-secondary"
                        title="View General Ledger"
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.7rem', gap: '0.25rem' }}
                      >
                        <BookOpen size={12} />
                        <span>Ledger</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(head)}
                        className="btn-ghost"
                        title="Edit Account Head"
                        style={{ padding: '0.25rem 0.35rem', color: 'var(--text-secondary)' }}
                      >
                        <Edit3 size={13} />
                      </button>

                      {!head.is_system && head.is_active !== false && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(head)}
                          className="btn-ghost"
                          title="Deactivate Account"
                          style={{ padding: '0.25rem 0.35rem', color: '#d97706' }}
                        >
                          <X size={13} />
                        </button>
                      )}

                      {!head.is_system && (
                        <button
                          type="button"
                          onClick={() => handleDelete(head)}
                          className="btn-ghost"
                          title="Delete Account"
                          style={{ padding: '0.25rem 0.35rem', color: '#dc2626' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                  No account heads found matching the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal for Add / Edit Account Head */}
      {showModal && (
        <div className="modal-backdrop" style={{ zIndex: 1050 }}>
          <div 
            className="modal-content animate-scale-up"
            style={{
              maxWidth: '520px',
              width: '95%',
              padding: '1.5rem',
              borderRadius: 'var(--radius-lg)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {editingHead ? 'Edit Account Head' : 'Add New Account Head'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="btn-ghost"
                style={{ padding: '0.35rem', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div style={{
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                padding: '0.65rem 0.85rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                marginBottom: '1rem'
              }}>
                <AlertCircle size={14} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Account Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    className="input-field"
                    placeholder="e.g. 1025"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Account Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="input-field"
                    placeholder="e.g. Studio Audio Monitors"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  Account Group *
                </label>
                <select
                  value={formGroupId}
                  onChange={(e) => handleGroupSelect(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', fontSize: '0.8125rem' }}
                >
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.type.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Account Type
                  </label>
                  <input
                    type="text"
                    disabled
                    value={formType.toUpperCase()}
                    className="input-field"
                    style={{ width: '100%', background: '#f8fafc', color: 'var(--text-muted)', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                    Opening Balance (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formOpeningBalance}
                    onChange={(e) => setFormOpeningBalance(Number(e.target.value) || 0)}
                    className="input-field"
                    style={{ width: '100%', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
                  Description / Notes
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="input-field"
                  placeholder="Optional description of account usage..."
                  style={{ width: '100%', fontSize: '0.8125rem', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <input
                  type="checkbox"
                  id="gstApplicable"
                  checked={formGstApplicable}
                  onChange={(e) => setFormGstApplicable(e.target.checked)}
                />
                <label htmlFor="gstApplicable" style={{ fontSize: '0.75rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  GST Applicable on this Account
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '0.45rem 1.25rem', fontSize: '0.8125rem' }}
                >
                  {editingHead ? 'Save Changes' : 'Create Account Head'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* General Ledger Modal */}
      {ledgerAccountId && (
        <GeneralLedgerModal
          accountId={ledgerAccountId}
          onClose={() => setLedgerAccountId(null)}
        />
      )}

    </div>
  );
};
