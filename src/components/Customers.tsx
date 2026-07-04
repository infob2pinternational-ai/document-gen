import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Customer } from '../types';
import { dbService } from '../services/db';
import { Search, Plus, Edit, Trash2, ShieldAlert } from 'lucide-react';

interface CustomersProps {
  role: string;
  activeProfile: CompanyProfile | null;
  onRefreshStats: () => void;
}

export const Customers: React.FC<CustomersProps> = ({
  role,
  activeProfile,
  onRefreshStats
}) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCustomers = async () => {
    if (!activeProfile) return;
    try {
      const data = await dbService.getCustomers(activeProfile.id);
      setCustomers(data);
    } catch (err) {
      console.error('Error fetching customers:', err);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [activeProfile]);

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
      await fetchCustomers();
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
        await fetchCustomers();
        onRefreshStats();
      } catch (err) {
        console.error('Error deleting customer:', err);
        alert('Failed to delete customer.');
      }
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (c.gstin && c.gstin.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Customers CRM</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Add, update, and manage clients details for billing.
          </p>
        </div>
        {role === 'admin' && (
          <button 
            onClick={() => handleOpenModal()} 
            className="btn-primary"
            disabled={!activeProfile}
          >
            <Plus size={16} />
            <span>Add Customer</span>
          </button>
        )}
      </div>

      {!activeProfile ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <ShieldAlert size={48} style={{ color: 'var(--accent-warning)', margin: '0 auto 1rem auto' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>No Active Profile Selected</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Please create or select a company profile in Settings to manage customers.</p>
        </div>
      ) : (
        <>
          {/* Search Controls */}
          <div style={{ position: 'relative', maxWidth: '360px' }}>
            <Search size={18} style={{
              position: 'absolute',
              left: '0.875rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }} />
            <input
              type="text"
              placeholder="Search by name, email, GSTIN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>

          {/* Table list */}
          <div className="table-container">
            {filteredCustomers.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>GSTIN</th>
                    <th>Email Address</th>
                    <th>Phone Number</th>
                    <th>Billing Address</th>
                    {role === 'admin' && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map(cust => (
                    <tr key={cust.id}>
                      <td style={{ fontWeight: 600 }}>{cust.name}</td>
                      <td className="mono">{cust.gstin || '-'}</td>
                      <td>{cust.email || '-'}</td>
                      <td>{cust.phone || '-'}</td>
                      <td style={{ maxWidth: '300px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {cust.address || '-'}
                      </td>
                      {role === 'admin' && (
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleOpenModal(cust)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px' }}
                              title="Edit"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(cust.id)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px', color: 'var(--accent-danger)' }}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p>No customers saved yet. Click "Add Customer" to create your first client!</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit/Add Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              {editingCustomer ? 'Edit Saved Customer' : 'Add New Customer'}
            </h3>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="c-name">Customer Name *</label>
                <input
                  id="c-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corporation Pvt Ltd"
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="c-gst">GSTIN (Optional)</label>
                  <input
                    id="c-gst"
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="e.g. 07AAAAA1111A1Z1"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="c-phone">Phone Number (Optional)</label>
                  <input
                    id="c-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 99999 88888"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="c-email">Email Address (Optional)</label>
                <input
                  id="c-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="billing@customer.com"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="c-address">Billing Address</label>
                <textarea
                  id="c-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, City, State, ZIP..."
                  rows={3}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="btn-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary"
                  disabled={loading}
                >
                  {loading ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
