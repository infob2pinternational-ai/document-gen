import React, { useState } from 'react';
import type { CompanyProfile, Service } from '../../types';
import { dbService } from '../../services/db';
import { Plus, Edit2, Trash2, X, Briefcase, Check } from 'lucide-react';

interface ServicesScreenProps {
  activeProfile: CompanyProfile | null;
  services: Service[];
  onRefresh: () => void;
}

// Common Indian-business service units, with a free-text fallback for
// anything else (existing records, or units not in this list) - the
// underlying field is still the same free-text `unit: string` desktop's
// Services.tsx writes, just presented as a dropdown instead of a bare
// text input for the common cases.
const UNIT_OPTIONS = [
  { value: 'nos', label: 'Nos' },
  { value: 'hr', label: 'Hour (hr)' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'ltr', label: 'Litre (ltr)' },
  { value: 'sqft', label: 'Sq. Ft' },
  { value: 'pcs', label: 'Piece (pcs)' },
  { value: 'service', label: 'Service' }
];
const isPresetUnit = (u: string) => UNIT_OPTIONS.some(o => o.value === u.toLowerCase());

// Same GST slab options as the desktop app's Services.tsx modal - not a
// separate/invented list.
const GST_OPTIONS = [0, 5, 12, 18, 28];

const emptyService = (companyId: string): Service => ({
  // BUG FIX: this previously left id as '' for a new service. dbService
  // .saveService() upserts by looking up `.eq('id', service.id)` - with
  // '' that lookup always misses, so it always went to the insert
  // branch with id: '' as the payload's primary key. The `services`
  // table's id column is a uuid, and Postgres rejects '' as invalid
  // input for that type, so every "New Service" save on mobile failed.
  // Desktop's Services.tsx already generates `crypto.randomUUID()` for
  // new records (see handleSave there) - this just matches that, it
  // isn't new behavior.
  id: crypto.randomUUID(),
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

  const currencySymbol = activeProfile?.currency === 'USD' ? '$' : '₹';

  const handleSave = async () => {
    if (!editing || !activeProfile) return;
    if (!editing.name.trim()) {
      alert('Service name is required.');
      return;
    }
    setSaving(true);
    try {
      // Reuses dbService.saveService exactly as the web app's
      // Services.tsx does.
      await dbService.saveService(editing);
      setEditing(null);
      onRefresh();
    } catch (err) {
      console.error('Error saving service:', err);
      alert('Failed to save service.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this service?')) return;
    await dbService.deleteService(id);
    onRefresh();
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
            {editing.id && services.some(s => s.id === editing.id) ? 'Edit Service' : 'New Service'}
          </h1>
          <button onClick={() => setEditing(null)} className="owner-icon-btn">
            <X size={16} />
          </button>
        </div>

        <div className="owner-form-card">
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Service Details</h2>
          <div className="owner-field-group">
            <label className="owner-field-label">Service Name *</label>
            <input
              className="owner-field-input"
              placeholder="e.g. Website Maintenance"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
            />
          </div>
          <hr className="owner-form-divider" />
          <div className="owner-field-group">
            <label className="owner-field-label">Description</label>
            <textarea
              className="owner-field-textarea"
              placeholder="Add details about what this service includes…"
              rows={3}
              value={editing.description || ''}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
        </div>

        <div className="owner-form-card">
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Pricing &amp; Taxation</h2>
          <div className="owner-field-group">
            <label className="owner-field-label">Rate ({currencySymbol}) *</label>
            <div className="owner-field-prefix-wrap">
              <span className="owner-field-prefix">{currencySymbol}</span>
              <input
                className="owner-field-input"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={editing.default_rate}
                onChange={e => setEditing({ ...editing, default_rate: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="owner-field-group">
            <label className="owner-field-label">Unit</label>
            <select
              className="owner-field-select"
              value={isPresetUnit(editing.unit) ? editing.unit.toLowerCase() : 'other'}
              onChange={e => setEditing({ ...editing, unit: e.target.value === 'other' ? '' : e.target.value })}
            >
              {UNIT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              <option value="other">Other…</option>
            </select>
            {!isPresetUnit(editing.unit) && (
              <input
                className="owner-field-input"
                placeholder="Enter custom unit"
                value={editing.unit}
                onChange={e => setEditing({ ...editing, unit: e.target.value })}
                style={{ marginTop: '0.5rem' }}
              />
            )}
          </div>
          <hr className="owner-form-divider" />
          <div className="owner-field-group">
            <label className="owner-field-label">HSN/SAC Code</label>
            <input
              className="owner-field-input"
              placeholder="e.g. 998313"
              value={editing.hsn_sac || ''}
              onChange={e => setEditing({ ...editing, hsn_sac: e.target.value })}
            />
          </div>
          <div className="owner-field-group">
            <label className="owner-field-label">GST %</label>
            <select
              className="owner-field-select"
              value={editing.gst_percentage}
              onChange={e => setEditing({ ...editing, gst_percentage: Number(e.target.value) })}
            >
              {GST_OPTIONS.map(g => (
                <option key={g} value={g}>{g}%</option>
              ))}
            </select>
          </div>
        </div>

        <div className="owner-sticky-actions">
          <button onClick={() => setEditing(null)} disabled={saving} className="owner-btn-secondary" style={{ flex: 1 }}>
            <X size={16} />
            <span>Cancel</span>
          </button>
          <button onClick={handleSave} disabled={saving} className="owner-btn-primary" style={{ flex: 2 }}>
            <Check size={16} />
            <span>{saving ? 'Saving…' : 'Save Service'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>Services</h1>
        {activeProfile && (
          <button onClick={() => setEditing(emptyService(activeProfile.id))} className="owner-btn-primary" style={{ minHeight: '40px', padding: '0.55rem 1rem', fontSize: '0.85rem' }}>
            <Plus size={16} />
            <span>Add</span>
          </button>
        )}
      </div>

      {services.length === 0 ? (
        <div className="owner-empty-state">
          <div className="owner-empty-state-icon"><Briefcase size={24} /></div>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--owner-text)' }}>No services yet</p>
          <p style={{ margin: 0, fontSize: '0.82rem' }}>Add your first service to reuse it on documents.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {services.map(s => (
            <div key={s.id} className="owner-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--owner-text-secondary)', marginTop: '0.15rem' }}>
                  {currencySymbol}{Number(s.default_rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {s.unit}
                </div>
                <span className="owner-badge owner-badge-neutral" style={{ marginTop: '0.35rem' }}>{s.gst_percentage}% GST</span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                <button onClick={() => setEditing(s)} className="owner-icon-btn owner-fab-button">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => handleDelete(s.id)} className="owner-icon-btn owner-fab-button" style={{ color: 'var(--owner-error-fg)' }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
