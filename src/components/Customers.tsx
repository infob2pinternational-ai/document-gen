import React, { useState } from 'react';
import type { CompanyProfile, Customer } from '../types';
import { dbService } from '../services/db';
import { Search, Plus, Edit, Trash2, ShieldAlert, Eye, X } from 'lucide-react';
import { Customer360Modal } from './Customer360Modal';

interface CustomersProps {
  role: string;
  activeProfile: CompanyProfile | null;
  onRefreshStats: () => void;
  preloadedCustomers: Customer[];
  onRefreshCustomers: () => void;
}

export const Customers: React.FC<CustomersProps> = ({
  role,
  activeProfile,
  onRefreshStats,
  preloadedCustomers,
  onRefreshCustomers
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewing360Customer, setViewing360Customer] = useState<Customer | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOpenModal = (customer: Customer | null = null) => {
    if (customer) {
      setEditingCustomer(customer);
      setName(customer.name);
      setGstin(customer.gstin || '');
      setEmail(customer.email || '');
      setPhone(customer.phone || '');
      setAddress(customer.address || '');
    } else {
      setEditingCustomer(null);
      setName('');
      setGstin('');
      setEmail('');
      setPhone('');
      setAddress('');
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    setLoading(true);
    try {
      const payload: Customer = {
        id: editingCustomer?.id || crypto.randomUUID(),
        company_id: activeProfile.id,
        name,
        gstin: gstin || undefined,
        email: email || undefined,
        phone: phone || undefined,
        address: address || undefined
      };

      await dbService.saveCustomer(payload);
      onRefreshCustomers();
      onRefreshStats();
      setShowModal(false);
    } catch (err) {
      console.error('Error saving customer:', err);
      alert('Failed to save customer.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this customer?')) {
      try {
        await dbService.deleteCustomer(id);
        onRefreshCustomers();
        onRefreshStats();
      } catch (err) {
        console.error('Error deleting customer:', err);
        alert('Failed to delete customer.');
      }
    }
  };

  const filteredCustomers = preloadedCustomers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (c.gstin && c.gstin.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div className="glass-panel" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem 1.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Customer Directory (CRM)
            </h1>
            <span className="badge badge-neutral">
              {filteredCustomers.length} Clients
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Manage client profiles, GST information, billing history, and 360° timelines.
          </p>
        </div>

        <button 
          onClick={() => handleOpenModal()} 
          className="btn-primary"
          disabled={!activeProfile}
          style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>Add Customer</span>
        </button>
      </div>

      {!activeProfile ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <ShieldAlert size={40} style={{ color: 'var(--accent-warning)', margin: '0 auto 0.75rem auto' }} />
          <h3 style={{ marginBottom: '0.35rem', fontSize: '1rem' }}>No Active Profile Selected</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Please create or select a company profile in Settings to manage customers.</p>
        </div>
      ) : (
        <>
          {/* Search Controls */}
          <div className="glass-panel" style={{ padding: '0.75rem 1rem' }}>
            <div style={{ position: 'relative', maxWidth: '320px' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search by client name, email, GSTIN, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Table list */}
          <div className="table-container animate-fade-in">
            {filteredCustomers.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: '170px' }}>Customer Name</th>
                    <th style={{ minWidth: '130px' }}>GSTIN</th>
                    <th style={{ minWidth: '160px' }}>Email Address</th>
                    <th style={{ minWidth: '120px' }}>Phone Number</th>
                    <th style={{ minWidth: '200px' }}>Billing Address</th>
                    <th style={{ textAlign: 'right', minWidth: '100px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map(cust => (
                    <tr key={cust.id} style={{ cursor: 'pointer' }} onClick={() => setViewing360Customer(cust)}>
                      <td style={{ fontWeight: 600, color: 'var(--brand-navy)' }}>{cust.name}</td>
                      <td className="mono" style={{ fontSize: '0.78rem' }}>{cust.gstin || '—'}</td>
                      <td style={{ fontSize: '0.8125rem' }}>{cust.email || '—'}</td>
                      <td style={{ fontSize: '0.8125rem' }}>{cust.phone || '—'}</td>
                      <td style={{ maxWidth: '280px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {cust.address || '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setViewing360Customer(cust)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem 0.55rem', borderRadius: '4px', fontSize: '0.72rem' }}
                            title="View Customer 360° Profile"
                          >
                            <Eye size={12} />
                            <span>360°</span>
                          </button>
                          <button
                            onClick={() => handleOpenModal(cust)}
                            className="btn-ghost"
                            style={{ padding: '0.3rem' }}
                            title="Edit Customer"
                          >
                            <Edit size={14} />
                          </button>
                          {(role === 'admin' || role === 'owner' || role === 'manager') && (
                            <button
                              onClick={() => handleDelete(cust.id)}
                              className="btn-ghost"
                              style={{ padding: '0.3rem', color: 'var(--accent-danger)' }}
                              title="Delete Customer"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p style={{ margin: 0, fontSize: '0.875rem' }}>No customers saved yet. Click "Add Customer" to create your first client record!</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit/Add Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', width: '95%' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingCustomer ? 'Edit Customer Record' : 'Add New Customer'}
                </h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.15rem 0 0 0' }}>
                  Enter client billing and contact information.
                </p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ padding: '0.35rem' }}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Customer / Company Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Malabar Gold & Diamonds"
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>GSTIN (Optional)</label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="32AAAAA1234A1Z5"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9847012345"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="billing@customer.com"
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Billing Address</label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, City, Kerala, PIN..."
                  rows={3}
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.85rem' }}>
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="btn-secondary"
                  disabled={loading}
                  style={{ fontSize: '0.8125rem' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={loading}
                  style={{ fontSize: '0.8125rem', padding: '0.45rem 1.25rem' }}
                >
                  {loading ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer 360 Profile Right-Side Drawer */}
      {viewing360Customer && (
        <Customer360Modal
          customer={viewing360Customer}
          isOpen={!!viewing360Customer}
          onClose={() => setViewing360Customer(null)}
          userEmail="admin@b2p.com"
        />
      )}
    </div>
  );
};
