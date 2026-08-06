import React, { useState } from 'react';
import type { CompanyProfile, Service } from '../../types';
import { dbService } from '../../services/db';
import { Plus, Edit2, Trash2, X } from 'lucide-react';

interface ServicesScreenProps {
  activeProfile: CompanyProfile | null;
  services: Service[];
  onRefresh: () => void;
}

const emptyService = (companyId: string): Service => ({
  id: '',
  company_id: companyId,
  name: '',
  description: '',
  default_rate: 0,
  unit: 'nos',
  hsn_sac: '',
  gst_percentage: 18
});

export const ServicesScreen: React.FC<ServicesScreenProps> = ({ activeProfile, services, onRefresh }) => {
  const [editing, setEditing] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editing || !activeProfile) return;
    setSaving(true);
    try {
      // Reuses dbService.saveService exactly as the web app's
      // Services.tsx does.
      await dbService.saveService(editing);
      setEditing(null);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this service?')) return;
    await dbService.deleteService(id);
    onRefresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Services</h1>
        {!editing && activeProfile && (
          <button onClick={() => setEditing(emptyService(activeProfile.id))} className="btn-primary" style={{ padding: '0.5rem 0.9rem', minHeight: '40px' }}>
            <Plus size={16} />
            <span>Add</span>
          </button>
        )}
      </div>

      {editing ? (
        <div className="owner-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{editing.id ? 'Edit Service' : 'New Service'}</h2>
            <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <X size={18} />
            </button>
          </div>
          <input placeholder="Name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
          <input placeholder="Description" value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} style={inputStyle} />
          <input placeholder="Rate" type="number" value={editing.default_rate} onChange={e => setEditing({ ...editing, default_rate: Number(e.target.value) })} style={inputStyle} />
          <input placeholder="Unit" value={editing.unit} onChange={e => setEditing({ ...editing, unit: e.target.value })} style={inputStyle} />
          <input placeholder="HSN/SAC" value={editing.hsn_sac || ''} onChange={e => setEditing({ ...editing, hsn_sac: e.target.value })} style={inputStyle} />
          <input placeholder="GST %" type="number" value={editing.gst_percentage} onChange={e => setEditing({ ...editing, gst_percentage: Number(e.target.value) })} style={inputStyle} />
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ minHeight: '48px' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="owner-card" style={{ padding: '0 1rem' }}>
          {services.length === 0 ? (
            <div style={{ padding: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No services yet.</div>
          ) : (
            services.map(s => (
              <div key={s.id} className="owner-list-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    ₹{s.default_rate} / {s.unit} · GST {s.gst_percentage}%
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button onClick={() => setEditing(s)} className="btn-secondary owner-fab-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '50%' }}>
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => handleDelete(s.id)} className="btn-secondary owner-fab-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', borderRadius: '50%', color: '#ef4444' }}>
                    <Trash2 size={15} />
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
