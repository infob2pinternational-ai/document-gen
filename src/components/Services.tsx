import React, { useState } from 'react';
import type { CompanyProfile, Service } from '../types';
import { dbService } from '../services/db';
import { Search, Plus, Edit, Trash2, ShieldAlert, X } from 'lucide-react';

interface ServicesProps {
  role: string;
  activeProfile: CompanyProfile | null;
  onRefreshStats: () => void;
  preloadedServices: Service[];
  onRefreshServices: () => void;
}

export const Services: React.FC<ServicesProps> = ({
  role,
  activeProfile,
  onRefreshStats,
  preloadedServices,
  onRefreshServices
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultRate, setDefaultRate] = useState<number>(0);
  const [unit, setUnit] = useState('nos');
  const [hsnSac, setHsnSac] = useState('');
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  const [loading, setLoading] = useState(false);

  const handleOpenModal = (service: Service | null = null) => {
    if (service) {
      setEditingService(service);
      setName(service.name);
      setDescription(service.description || '');
      setDefaultRate(service.default_rate);
      setUnit(service.unit);
      setHsnSac(service.hsn_sac || '');
      setGstPercentage(service.gst_percentage);
    } else {
      setEditingService(null);
      setName('');
      setDescription('');
      setDefaultRate(0);
      setUnit('nos');
      setHsnSac('');
      setGstPercentage(18);
    }
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    setLoading(true);
    try {
      const payload: Service = {
        id: editingService?.id || crypto.randomUUID(),
        company_id: activeProfile.id,
        name,
        description,
        default_rate: Number(defaultRate),
        unit,
        hsn_sac: hsnSac || undefined,
        gst_percentage: Number(gstPercentage)
      };

      await dbService.saveService(payload);
      onRefreshServices();
      onRefreshStats();
      setShowModal(false);
    } catch (err) {
      console.error('Error saving service:', err);
      alert('Failed to save service.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this service?')) {
      try {
        await dbService.deleteService(id);
        onRefreshServices();
        onRefreshStats();
      } catch (err) {
        console.error('Error deleting service:', err);
        alert('Failed to delete service.');
      }
    }
  };

  const safeServices = Array.isArray(preloadedServices) ? preloadedServices : [];
  const searchLower = (searchTerm || '').toLowerCase().trim();

  const filteredServices = safeServices.filter(s => {
    if (!s) return false;
    const nameMatch = s.name ? String(s.name).toLowerCase().includes(searchLower) : false;
    const descMatch = s.description ? String(s.description).toLowerCase().includes(searchLower) : false;
    const hsnMatch = s.hsn_sac ? String(s.hsn_sac).toLowerCase().includes(searchLower) : false;
    return nameMatch || descMatch || hsnMatch;
  });

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
              Service Catalog & Inventory Rates
            </h1>
            <span className="badge badge-neutral">
              {filteredServices.length} Items
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Manage pricing catalog, HSN/SAC codes, and standard rate cards.
          </p>
        </div>

        <button 
          onClick={() => handleOpenModal()} 
          className="btn-primary"
          disabled={!activeProfile}
          style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>Add Service</span>
        </button>
      </div>

      {!activeProfile ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <ShieldAlert size={40} style={{ color: 'var(--accent-warning)', margin: '0 auto 0.75rem auto' }} />
          <h3 style={{ marginBottom: '0.35rem', fontSize: '1rem' }}>No Active Profile Selected</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Please create or select a company profile in Settings to manage services.</p>
        </div>
      ) : (
        <>
          {/* Search Controls */}
          <div className="glass-panel" style={{ padding: '0.75rem 1rem' }}>
            <div style={{ position: 'relative', maxWidth: '320px' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search by name, description, HSN/SAC..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Table list */}
          <div className="table-container animate-fade-in">
            {filteredServices.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: '160px' }}>Service Name</th>
                    <th style={{ minWidth: '220px' }}>Scope / Description</th>
                    <th style={{ minWidth: '100px' }}>HSN/SAC</th>
                    <th style={{ minWidth: '130px' }}>Default Rate</th>
                    <th style={{ minWidth: '80px' }}>Unit</th>
                    <th style={{ minWidth: '95px' }}>GST Rate</th>
                    <th style={{ textAlign: 'right', minWidth: '85px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(service => (
                    <tr key={service.id}>
                      <td style={{ fontWeight: 600, color: 'var(--brand-navy)' }}>{service.name}</td>
                      <td style={{ color: 'var(--text-secondary)', maxWidth: '280px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', fontSize: '0.8125rem' }}>
                        {service.description || '—'}
                      </td>
                      <td className="mono" style={{ fontSize: '0.78rem' }}>{service.hsn_sac || '—'}</td>
                      <td className="mono" style={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                        {activeProfile?.currency === 'INR' || !activeProfile?.currency ? '₹' : (activeProfile?.currency === 'USD' ? '$' : `${activeProfile.currency} `)}
                        {Number(service.default_rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textTransform: 'lowercase', fontSize: '0.78rem' }}>{service.unit || 'nos'}</td>
                      <td className="mono" style={{ fontSize: '0.78rem' }}>{service.gst_percentage ?? 18}%</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleOpenModal(service)}
                            className="btn-ghost"
                            style={{ padding: '0.3rem' }}
                            title="Edit Service"
                          >
                            <Edit size={14} />
                          </button>
                          {(role === 'admin' || role === 'owner' || role === 'manager') && (
                            <button
                              onClick={() => handleDelete(service.id)}
                              className="btn-ghost"
                              style={{ padding: '0.3rem', color: 'var(--accent-danger)' }}
                              title="Delete Service"
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
                <p style={{ margin: 0, fontSize: '0.875rem' }}>No services saved yet. Click "Add Service" to create your first rate card entry!</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit/Add Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px', width: '95%' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {editingService ? 'Edit Catalog Service' : 'Add New Service Rate'}
                </h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.15rem 0 0 0' }}>
                  Define default unit price and tax classification.
                </p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="btn-ghost" style={{ padding: '0.35rem' }}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Service Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. LED Van Full Day Campaign"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Description / Scope</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Screen + sound + driver"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Rate ({activeProfile?.currency}) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={defaultRate}
                    onChange={(e) => setDefaultRate(Number(e.target.value))}
                    placeholder="0.00"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Unit *</label>
                  <input
                    type="text"
                    required
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="day / sqft / nos"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>HSN/SAC</label>
                  <input
                    type="text"
                    value={hsnSac}
                    onChange={(e) => setHsnSac(e.target.value)}
                    placeholder="998313"
                    style={{ fontSize: '0.8125rem' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 600 }}>GST %</label>
                  <select
                    value={gstPercentage}
                    onChange={(e) => setGstPercentage(Number(e.target.value))}
                    style={{ fontSize: '0.8125rem' }}
                  >
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
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
                  {loading ? 'Saving...' : 'Save Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
