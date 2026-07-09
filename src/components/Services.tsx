import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Service } from '../types';
import { dbService } from '../services/db';
import { Search, Plus, Edit, Trash2, ShieldAlert } from 'lucide-react';

interface ServicesProps {
  role: string;
  activeProfile: CompanyProfile | null;
  onRefreshStats: () => void;
  preloadedServices?: Service[];
  onRefreshServices?: () => void;
}

export const Services: React.FC<ServicesProps> = ({
  role,
  activeProfile,
  onRefreshStats,
  preloadedServices = [],
  onRefreshServices
}) => {
  const [services, setServices] = useState<Service[]>(preloadedServices);
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

  // Sync state if preloadedServices changes in parent
  useEffect(() => {
    setServices(preloadedServices);
  }, [preloadedServices]);

  const fetchServices = async () => {
    if (!activeProfile) return;
    try {
      if (onRefreshServices) {
        onRefreshServices();
      } else {
        const data = await dbService.getServices(activeProfile.id);
        setServices(data);
      }
    } catch (err) {
      console.error('Error fetching services:', err);
    }
  };

  useEffect(() => {
    if (preloadedServices.length === 0) {
      fetchServices();
    }
  }, [activeProfile]);

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
      await fetchServices();
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
        await fetchServices();
        onRefreshStats();
      } catch (err) {
        console.error('Error deleting service:', err);
        alert('Failed to delete service.');
      }
    }
  };

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.description && s.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (s.hsn_sac && s.hsn_sac.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Services Library</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Manage pre-saved services and inventories for quick insertion into documents.
          </p>
        </div>
        {role === 'admin' && (
          <button 
            onClick={() => handleOpenModal()} 
            className="btn-primary"
            disabled={!activeProfile}
          >
            <Plus size={16} />
            <span>Add Service</span>
          </button>
        )}
      </div>

      {!activeProfile ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <ShieldAlert size={48} style={{ color: 'var(--accent-warning)', margin: '0 auto 1rem auto' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>No Active Profile Selected</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Please create or select a company profile in Settings to manage services.</p>
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
              placeholder="Search by name, description, HSN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>

          {/* Table list */}
          <div className="table-container">
            {filteredServices.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Service Name</th>
                    <th>Description</th>
                    <th>HSN/SAC</th>
                    <th>Default Rate</th>
                    <th>Unit</th>
                    <th>GST %</th>
                    {role === 'admin' && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(service => (
                    <tr key={service.id}>
                      <td style={{ fontWeight: 600 }}>{service.name}</td>
                      <td style={{ color: 'var(--text-secondary)', maxWidth: '280px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {service.description || '-'}
                      </td>
                      <td className="mono">{service.hsn_sac || '-'}</td>
                      <td className="mono" style={{ fontWeight: 500 }}>
                        {activeProfile.currency === 'INR' ? '₹' : '$'}
                        {service.default_rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ textTransform: 'lowercase' }}>{service.unit}</td>
                      <td className="mono">{service.gst_percentage}%</td>
                      {role === 'admin' && (
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleOpenModal(service)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px' }}
                              title="Edit"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(service.id)}
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
                <p>No services saved yet. Click "Add Service" to create your first saved item!</p>
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
              {editingService ? 'Edit Saved Service' : 'Add New Service'}
            </h3>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="s-name">Service/Inventory Name *</label>
                <input
                  id="s-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Website Development Consulting"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="s-desc">Description</label>
                <textarea
                  id="s-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed breakdown of work scope..."
                  rows={3}
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="s-rate">Default Rate ({activeProfile?.currency}) *</label>
                  <input
                    id="s-rate"
                    type="number"
                    step="0.01"
                    required
                    value={defaultRate}
                    onChange={(e) => setDefaultRate(Number(e.target.value))}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-unit">Unit *</label>
                  <input
                    id="s-unit"
                    type="text"
                    required
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="e.g. hrs, nos, sets, days"
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="s-hsn">HSN/SAC Code (Optional)</label>
                  <input
                    id="s-hsn"
                    type="text"
                    value={hsnSac}
                    onChange={(e) => setHsnSac(e.target.value)}
                    placeholder="e.g. 998313"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-gst">GST Percentage (%)</label>
                  <select
                    id="s-gst"
                    value={gstPercentage}
                    onChange={(e) => setGstPercentage(Number(e.target.value))}
                  >
                    <option value={0}>0% (Exempt)</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18% (Standard)</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
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
