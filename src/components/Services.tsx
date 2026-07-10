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
    try {
      if (onRefreshServices) {
        onRefreshServices();
      } else {
        const data = await dbService.getServices();
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
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Services Library</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Manage pre-saved services and inventories for quick insertion into documents.
          </p>
        </div>
        <button 
          onClick={() => handleOpenModal()} 
          className="btn-primary"
          disabled={!activeProfile}
        >
          <Plus size={16} />
          <span>Add Service</span>
        </button>
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
          <div className="search-box" style={{ maxWidth: '360px' }}>
            <Search size={18} />
            <input
              type="text"
              placeholder="Search by name, description, HSN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map(service => (
                    <tr key={service.id}>
                      <td data-label="Service Name" style={{ fontWeight: 600 }}>{service.name}</td>
                      <td data-label="Description" style={{ color: 'var(--text-secondary)', maxWidth: '280px', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {service.description || '-'}
                      </td>
                      <td className="mono" data-label="HSN/SAC">{service.hsn_sac || '-'}</td>
                      <td className="mono" data-label="Default Rate" style={{ fontWeight: 500 }}>
                        {activeProfile.currency === 'INR' ? '₹' : '$'}
                        {service.default_rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td data-label="Unit" style={{ textTransform: 'lowercase' }}>{service.unit}</td>
                      <td className="mono" data-label="GST %">{service.gst_percentage}%</td>
                      <td data-label="Actions">
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleOpenModal(service)}
                            className="btn-secondary"
                            style={{ padding: '0.35rem', borderRadius: '4px' }}
                            title="Edit"
                          >
                            <Edit size={14} />
                          </button>
                          {role === 'admin' && (
                            <button
                              onClick={() => handleDelete(service.id)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px', color: 'var(--accent-danger)' }}
                              title="Delete"
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
          <div className="modal-content animate-fade-in" style={{ maxWidth: '720px', padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1.15rem', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
              {editingService ? 'Edit Saved Service' : 'Add New Service'}
            </h3>
            
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="grid-2" style={{ gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-name">Service Name *</label>
                  <input
                    id="s-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Website Development"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="s-desc">Description</label>
                  <input
                    id="s-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Scope of work..."
                  />
                </div>
              </div>

              <div className="grid-4-compact" style={{ gap: '0.75rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-rate">Rate ({activeProfile?.currency}) *</label>
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
                    placeholder="e.g. nos"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-hsn">HSN/SAC</label>
                  <input
                    id="s-hsn"
                    type="text"
                    value={hsnSac}
                    onChange={(e) => setHsnSac(e.target.value)}
                    placeholder="998313"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-gst">GST %</label>
                  <select
                    id="s-gst"
                    value={gstPercentage}
                    onChange={(e) => setGstPercentage(Number(e.target.value))}
                  >
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>
              </div>

              <div className="btn-row" style={{ marginTop: '0.5rem' }}>
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
