import React, { useState } from 'react';
import type { CompanyProfile, Customer } from '../../types';
import { dbService } from '../../services/db';
import { Search, Phone, Edit2, X } from 'lucide-react';

interface CustomersScreenProps {
  activeProfile: CompanyProfile | null;
  customers: Customer[];
  onRefresh: () => void;
}

const whatsappHref = (phone: string) => {
  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10) clean = '91' + clean;
  return `https://wa.me/${clean}`;
};

export const CustomersScreen: React.FC<CustomersScreenProps> = ({ activeProfile, customers, onRefresh }) => {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = customers.filter(c =>
    !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );

  const handleSave = async () => {
    if (!editing || !activeProfile) return;
    setSaving(true);
    try {
      // Reuses dbService.saveCustomer exactly as the web app's
      // Customers.tsx does - same validation, same upsert behavior.
      await dbService.saveCustomer({ ...editing, company_id: activeProfile.id });
      setEditing(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Customers</h1>

      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
        <input
          type="text"
          placeholder="Search customers"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
        />
      </div>

      {editing ? (
        <div className="owner-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Edit Customer</h2>
            <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <X size={18} />
            </button>
          </div>
          <input placeholder="Name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
          <input placeholder="Phone" value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} style={inputStyle} />
          <input placeholder="Email" value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} style={inputStyle} />
          <input placeholder="Address" value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} style={inputStyle} />
          <input placeholder="GSTIN" value={editing.gstin || ''} onChange={e => setEditing({ ...editing, gstin: e.target.value })} style={inputStyle} />
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ minHeight: '48px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="owner-card" style={{ padding: '0 1rem' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No customers found.</div>
          ) : (
            filtered.map(c => (
              <div key={c.id} className="owner-list-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</div>
                  {c.phone && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.phone}</div>}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="btn-secondary owner-fab-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '50%' }}>
                      <Phone size={15} />
                    </a>
                  )}
                  {c.phone && (
                    <a href={whatsappHref(c.phone)} target="_blank" rel="noreferrer" className="btn-secondary owner-fab-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '50%', color: '#25D366' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24z" /></svg>
                    </a>
                  )}
                  <button onClick={() => setEditing(c)} className="btn-secondary owner-fab-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '50%' }}>
                    <Edit2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  padding: '0.7rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '0.9rem'
};
