import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Search, 
  Filter, 
  Plus, 
  Trash2, 
  Edit3, 
  Tag
} from 'lucide-react';
import type { Expense } from '../../types';
import { financeService } from '../../services/financeService';
import { ExpenseModal } from './ExpenseModal';

interface ExpensesProps {
  userEmail?: string;
}

export const Expenses: React.FC<ExpensesProps> = ({
  userEmail = 'accounts@b2p.com'
}) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const loadExpenses = () => {
    setExpenses(financeService.getExpenses());
  };

  useEffect(() => {
    loadExpenses();
    const unsub = financeService.subscribe(() => {
      loadExpenses();
    });
    return unsub;
  }, []);

  const filteredExpenses = expenses.filter(exp => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term ||
      exp.description.toLowerCase().includes(term) ||
      exp.payee_name.toLowerCase().includes(term) ||
      (exp.reference_number && exp.reference_number.toLowerCase().includes(term));

    const matchesCat = selectedCategory === 'all' || exp.category === selectedCategory;
    const matchesStart = !startDate || exp.expense_date >= startDate;
    const matchesEnd = !endDate || exp.expense_date <= endDate;

    return matchesSearch && matchesCat && matchesStart && matchesEnd;
  });

  const totalExpenseAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalGstAmount = filteredExpenses.reduce((sum, e) => sum + (e.gst_amount || 0), 0);

  // Group by category for distribution
  const categoryTotals = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // REMEDIATION (2026-08-24, P1 item 10): every expense now auto-posts a
  // journal entry (see financeService.saveExpense), so plain delete will
  // reject any posted expense with a "use reversal instead" error. This
  // handler now falls back to the formal reversal path (a balancing
  // reversing journal entry, original row kept and flagged) instead of
  // leaving the Delete button silently broken for posted records.
  const handleDelete = async (id: string, desc: string) => {
    if (!window.confirm(`Are you sure you want to delete expense record: "${desc}"?`)) return;
    try {
      await financeService.deleteExpense(id, userEmail);
    } catch (err: any) {
      if (!err?.message?.includes('posted to the General Ledger')) {
        alert(err?.message || 'Failed to delete expense.');
        return;
      }
      const reason = window.prompt(`"${desc}" has already been posted to the General Ledger and can't be deleted directly.\n\nEnter a reason to reverse it instead (this keeps the record and its audit trail, and posts a balancing entry):`, 'Recorded in error');
      if (!reason || !reason.trim()) return;
      try {
        await financeService.reverseExpense(id, reason.trim(), userEmail);
      } catch (reverseErr: any) {
        alert(reverseErr.message || 'Failed to reverse expense.');
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wallet size={28} style={{ color: 'var(--brand-blue)' }} />
            <span>Operating Expense Management</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Track operational expenditure, vehicle diesel logs, maintenance, staff stipends, and overheads.
          </p>
        </div>

        <button
          onClick={() => { setEditingExpense(null); setShowModal(true); }}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Plus size={16} />
          <span>Record Expense</span>
        </button>
      </div>

      {/* KPI Cards & Top Categories */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        
        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Total Period Expenses
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {totalExpenseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {filteredExpenses.length} expense entries recorded
          </div>
        </div>

        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Input GST Claimable (ITC)
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
            ₹ {totalGstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Eligible for GST offset
          </div>
        </div>

        {/* Top 2 Categories mini cards */}
        {topCategories.map(([cat, total]) => (
          <div key={cat} className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
              <span>{cat}</span>
              <Tag size={13} />
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              ₹ {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Major operational cost centre
            </div>
          </div>
        ))}

      </div>

      {/* Filter and Date Bar */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        
        {/* Search */}
        <div style={{ position: 'relative', minWidth: '260px', flex: 1 }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Search description, payee, ref #..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={14} style={{ color: 'var(--text-secondary)' }} />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ fontSize: '0.8125rem', minWidth: '160px' }}
          >
            <option value="all">All Categories</option>
            <option value="Fuel">Fuel (Diesel)</option>
            <option value="Vehicle Maintenance">Vehicle Maintenance</option>
            <option value="Staff Expenses">Staff Expenses</option>
            <option value="Printing">Printing & Flex</option>
            <option value="Advertising">Advertising</option>
            <option value="Rent">Office & Yard Rent</option>
            <option value="Electricity">Electricity</option>
            <option value="Internet">Internet & Comms</option>
            <option value="Travel">Travel & Lodging</option>
            <option value="Equipment">Equipment</option>
            <option value="Miscellaneous">Miscellaneous</option>
          </select>
        </div>

        {/* Date Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', width: '125px' }}
            title="Start Date"
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.5rem', width: '125px' }}
            title="End Date"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem' }}
            >
              Clear
            </button>
          )}
        </div>

      </div>

      {/* Expenses Table */}
      <div className="table-container animate-fade-in">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: '95px' }}>Date</th>
              <th style={{ minWidth: '130px' }}>Category</th>
              <th style={{ minWidth: '220px' }}>Description / Purpose</th>
              <th style={{ minWidth: '160px' }}>Payee / Vendor</th>
              <th style={{ minWidth: '110px' }}>Mode</th>
              <th style={{ minWidth: '105px', textAlign: 'right' }}>GST Claim</th>
              <th style={{ minWidth: '115px', textAlign: 'right' }}>Total Amount</th>
              <th style={{ minWidth: '90px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  No expense records found. Click "+ Record Expense" to add one.
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp) => (
                <tr key={exp.id}>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {exp.expense_date ? exp.expense_date.split('-').reverse().join('/') : '-'}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '9999px',
                      background: 'rgba(15, 23, 42, 0.06)',
                      color: 'var(--text-primary)',
                      fontSize: '0.725rem',
                      fontWeight: 600
                    }}>
                      {exp.category}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    <div>{exp.description}</div>
                    {exp.notes && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {exp.notes}
                      </div>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {exp.payee_name}
                  </td>
                  <td style={{ textTransform: 'uppercase', fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {exp.payment_mode}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: exp.gst_amount > 0 ? 'var(--brand-blue)' : 'var(--text-secondary)' }}>
                    {exp.gst_amount > 0 ? `₹ ${exp.gst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                    ₹ {exp.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                      <button
                        onClick={() => { setEditingExpense(exp); setShowModal(true); }}
                        className="btn-ghost"
                        style={{ padding: '0.3rem 0.45rem' }}
                        title="Edit Expense"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(exp.id, exp.description)}
                        className="btn-ghost"
                        style={{ padding: '0.3rem 0.45rem', color: '#ef4444' }}
                        title="Delete Expense"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Expense Modal */}
      {showModal && (
        <ExpenseModal
          initialExpense={editingExpense}
          userEmail={userEmail}
          onClose={() => { setShowModal(false); setEditingExpense(null); }}
          onSaved={() => {
            setShowModal(false);
            setEditingExpense(null);
            loadExpenses();
          }}
        />
      )}

    </div>
  );
};
