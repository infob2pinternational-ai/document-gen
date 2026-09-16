import React, { useState, useEffect } from 'react';
import { 
  Truck, 
  Search, 
  Plus, 
  Phone, 
  Mail, 
  Edit3, 
  Trash2, 
  BookOpen,
  ShieldCheck,
  CreditCard
} from 'lucide-react';
import type { Supplier } from '../../types';
import { financeService } from '../../services/financeService';
import { SupplierModal } from './SupplierModal';
import { SupplierLedgerModal } from './SupplierLedgerModal';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';

interface SuppliersProps {
  onNewPurchaseForSupplier?: (supplierId: string) => void;
  userEmail?: string;
}

export const Suppliers: React.FC<SuppliersProps> = ({
  onNewPurchaseForSupplier: _onNewPurchaseForSupplier,
  userEmail = 'accounts@b2p.com'
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [ledgerSupplierId, setLedgerSupplierId] = useState<string | null>(null);
  const [paymentSupplierId, setPaymentSupplierId] = useState<string | null>(null);

  const loadSuppliers = () => {
    setSuppliers(financeService.getSuppliers(undefined, true));
  };

  useEffect(() => {
    loadSuppliers();
    const unsub = financeService.subscribe(() => {
      loadSuppliers();
    });
    return unsub;
  }, []);

  const filteredSuppliers = suppliers.filter(s => {
    const term = searchTerm.toLowerCase().trim();
    return !term ||
      s.name.toLowerCase().includes(term) ||
      (s.company_name && s.company_name.toLowerCase().includes(term)) ||
      (s.gstin && s.gstin.toLowerCase().includes(term)) ||
      (s.phone && s.phone.includes(term));
  });

  const purchases = financeService.getPurchases();
  const supplierBalances = suppliers.map(s => {
    const sPurchases = purchases.filter(p => p.supplier_id === s.id && p.status !== 'cancelled');
    const totalBalance = sPurchases.reduce((sum, p) => sum + p.balance_amount, 0) + (s.opening_balance || 0);
    return {
      ...s,
      calculated_balance: totalBalance,
      open_bills_count: sPurchases.filter(p => p.balance_amount > 0).length
    };
  });

  const totalPayables = supplierBalances.reduce((sum, s) => sum + s.calculated_balance, 0);

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete vendor "${name}"?`)) {
      try {
        await financeService.deleteSupplier(id, userEmail);
      } catch (err: any) {
        alert(err.message || 'Failed to delete supplier.');
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', letterSpacing: '-0.02em' }}>
            <Truck size={22} style={{ color: 'var(--brand-blue)' }} />
            <span>Supplier & Vendor Directory</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: 0 }}>
            Manage equipment vendors, flex banner printers, diesel suppliers, and fabrication contractors.
          </p>
        </div>

        <button
          onClick={() => { setEditingSupplier(null); setShowModal(true); }}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>Add Supplier</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
        <div className="glass-panel" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Active Suppliers</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            {suppliers.filter(s => s.is_active !== false).length}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {suppliers.length} total registered
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>GST Registered Vendors</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.25rem' }}>
            {suppliers.filter(s => s.gstin && s.gstin.trim().length === 15).length}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Eligible for GST Input Tax Credit
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Payables Outstanding</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: totalPayables > 0 ? '#dc2626' : '#16a34a', marginTop: '0.25rem' }}>
            ₹ {totalPayables.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Across all vendors
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ position: 'relative', width: '100%', maxWidth: '360px' }}>
        <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Search suppliers by name, legal name, GSTIN, phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input-field"
          style={{ width: '100%', paddingLeft: '2.2rem', fontSize: '0.78rem' }}
        />
      </div>

      {/* Suppliers Table */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '0.65rem 1rem' }}>Vendor Name</th>
                <th style={{ padding: '0.65rem 1rem' }}>Legal Entity</th>
                <th style={{ padding: '0.65rem 1rem' }}>GSTIN / State</th>
                <th style={{ padding: '0.65rem 1rem' }}>Contact</th>
                <th style={{ padding: '0.65rem 1rem' }}>Terms</th>
                <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Outstanding Payables (₹)</th>
                <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.length > 0 ? (
                filteredSuppliers.map(s => {
                  const sPurchases = purchases.filter(p => p.supplier_id === s.id && p.status !== 'cancelled');
                  const balance = sPurchases.reduce((sum, p) => sum + p.balance_amount, 0) + (s.opening_balance || 0);
                  const openCount = sPurchases.filter(p => p.balance_amount > 0).length;

                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</div>
                        {s.notes && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.notes}</div>}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>
                        {s.legal_name || s.company_name || '—'}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        {s.gstin ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <ShieldCheck size={13} color="#16a34a" />
                            <span className="mono" style={{ fontWeight: 600, color: 'var(--brand-blue)' }}>{s.gstin}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Unregistered</span>
                        )}
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.state} ({s.state_code || '32'})</div>
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        {s.phone && <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}><Phone size={11} color="#64748b" /> {s.phone}</div>}
                        {s.email && <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}><Mail size={11} color="#64748b" /> {s.email}</div>}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {s.payment_terms || '30 Days Net'}
                      </td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 800, color: balance > 0 ? '#dc2626' : '#16a34a' }}>
                        <div>₹ {balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                        {openCount > 0 && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                            {openCount} open bill(s)
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                          <button
                            onClick={() => setLedgerSupplierId(s.id)}
                            className="btn-ghost"
                            style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                            title="View Supplier Ledger"
                          >
                            <BookOpen size={14} color="var(--brand-blue)" />
                            <span>Ledger</span>
                          </button>

                          {balance > 0 && (
                            <button
                              onClick={() => setPaymentSupplierId(s.id)}
                              className="btn-secondary"
                              style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                              title="Record Disbursement"
                            >
                              <CreditCard size={12} />
                              <span>Pay</span>
                            </button>
                          )}

                          <button
                            onClick={() => { setEditingSupplier(s); setShowModal(true); }}
                            className="btn-ghost"
                            style={{ padding: '0.25rem 0.4rem' }}
                            title="Edit Supplier"
                          >
                            <Edit3 size={14} />
                          </button>

                          <button
                            onClick={() => handleDelete(s.id, s.name)}
                            className="btn-ghost"
                            style={{ padding: '0.25rem 0.4rem', color: '#dc2626' }}
                            title="Delete Supplier"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No suppliers found in directory.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showModal && (
        <SupplierModal
          initialSupplier={editingSupplier}
          onClose={() => { setShowModal(false); setEditingSupplier(null); }}
          onSaved={() => { setShowModal(false); setEditingSupplier(null); loadSuppliers(); }}
        />
      )}

      {ledgerSupplierId && (
        <SupplierLedgerModal
          supplierId={ledgerSupplierId}
          onClose={() => setLedgerSupplierId(null)}
        />
      )}

      {paymentSupplierId && (
        <RecordSupplierPaymentModal
          initialSupplierId={paymentSupplierId}
          userEmail={userEmail}
          onClose={() => setPaymentSupplierId(null)}
          onPaymentRecorded={() => { setPaymentSupplierId(null); loadSuppliers(); }}
        />
      )}

    </div>
  );
};
