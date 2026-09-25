import React, { useState, useEffect, useMemo } from 'react';
import type { Customer, Lead, LeadStatus } from '../types';
import { leadService } from '../services/leadService';
import { officeService } from '../services/officeService';
import { metricsService } from '../services/metricsService';
import { formatStaffDisplayName, getAvailableStaffList } from '../utils/staffUtils';
import { LeadModal } from './LeadModal';
import { LeadDetailModal } from './LeadDetailModal';
import { QuotationModal } from './QuotationModal';
import { 
  Search, 
  Plus, 
  Eye, 
  Edit, 
  Trash2, 
  FileText, 
  Inbox,
  X
} from 'lucide-react';

interface LeadsProps {
  role?: string;
  userEmail?: string;
  customers: Customer[];
  companyId?: string;
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; dotClass: string }> = {
  new: { label: 'New', dotClass: 'status-dot-info' },
  telecaller_working: { label: 'Working', dotClass: 'status-dot-info' },
  requirement_collected: { label: 'Req Collected', dotClass: 'status-dot-warning' },
  sent_to_admin: { label: 'Sent to Admin', dotClass: 'status-dot-purple' },
  quotation_preparing: { label: 'Quoting', dotClass: 'status-dot-purple' },
  waiting_owner_approval: { label: 'Waiting Approval', dotClass: 'status-dot-warning' },
  quotation_sent: { label: 'Quotation Sent', dotClass: 'status-dot-info' },
  follow_up: { label: 'Follow-up', dotClass: 'status-dot-warning' },
  confirmed: { label: 'Confirmed', dotClass: 'status-dot-success' },
  lost: { label: 'Lost', dotClass: 'status-dot-danger' },
  future: { label: 'Future', dotClass: 'status-dot-neutral' },
  owner_handover: { label: 'Handover', dotClass: 'status-dot-info' }
};

export const Leads: React.FC<LeadsProps> = ({
  role: _role,
  userEmail = '',
  customers,
  companyId = 'default'
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [telecallerFilter, setTelecallerFilter] = useState<string>('all');

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, leads);
  }, [userEmail, leads]);

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingLead, setViewingLead] = useState<Lead | null>(null);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [leadForQuotation, setLeadForQuotation] = useState<Lead | null>(null);

  const refreshLeads = () => {
    const list = leadService.getLeads(companyId);
    setLeads(list);
  };

  useEffect(() => {
    refreshLeads();
    const unsub = metricsService.subscribe(refreshLeads);
    return unsub;
  }, [companyId]);

  const handleOpenAddModal = () => {
    setEditingLead(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (lead: Lead) => {
    setEditingLead(lead);
    setDetailModalOpen(false);
    setModalOpen(true);
  };

  const handleOpenDetailModal = (lead: Lead) => {
    const fresh = (lead?.id ? leadService.getLeadById(lead.id) : null) || lead;
    setViewingLead(fresh);
    setDetailModalOpen(true);
  };

  const handleDeleteLead = async (id: string, leadNo?: string) => {
    if (window.confirm(`Are you sure you want to delete lead ${leadNo || id}?`)) {
      try {
        await leadService.deleteLead(id);
        refreshLeads();
        if (viewingLead?.id === id) setDetailModalOpen(false);
      } catch (err: any) {
        alert(err.message || 'Failed to delete lead.');
      }
    }
  };

  const handleStartQuotation = async (lead: Lead) => {
    try {
      await leadService.startQuotationPreparation(lead.id, userEmail);
      refreshLeads();
      setLeadForQuotation(lead);
      setQuotationModalOpen(true);
    } catch (err: any) {
      alert(err.message || 'Failed to start quotation preparation.');
    }
  };

  const filteredLeads = leads.filter(l => {
    const matchSearch = 
      l.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (l.company_name && l.company_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.lead_number && l.lead_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.phone && l.phone.includes(searchTerm)) ||
      (l.location && l.location.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.sub_district && l.sub_district.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.service_required && l.service_required.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.vehicle_service_type && l.vehicle_service_type.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchPriority = priorityFilter === 'all' || l.priority === priorityFilter;
    const matchSource = sourceFilter === 'all' || l.lead_source === sourceFilter;
    const matchTelecaller = 
      telecallerFilter === 'all' 
        ? true 
        : telecallerFilter === 'unassigned' 
          ? !l.assigned_telecaller_email 
          : (l.assigned_telecaller_email || '').toLowerCase().trim() === telecallerFilter.toLowerCase().trim();

    return matchSearch && matchStatus && matchPriority && matchSource && matchTelecaller;
  });

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const sortedLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => {
      const matchA = (a.lead_number || a.id || '').match(/(\d+)$/);
      const matchB = (b.lead_number || b.id || '').match(/(\d+)$/);
      const numA = matchA ? parseInt(matchA[1], 10) : NaN;
      const numB = matchB ? parseInt(matchB[1], 10) : NaN;
      let diff = 0;
      if (!isNaN(numA) && !isNaN(numB)) {
        diff = numA - numB;
      } else {
        diff = (a.lead_number || a.id || '').localeCompare(b.lead_number || b.id || '', undefined, { numeric: true });
      }
      if (diff === 0) {
        diff = (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0);
      }
      return sortOrder === 'asc' ? diff : -diff;
    });
  }, [filteredLeads, sortOrder]);

  const incomingAdminLeads = useMemo(() => {
    return leads
      .filter(l => l.status === 'sent_to_admin' || l.status === 'quotation_preparing')
      .sort((a, b) => {
        const matchA = (a.lead_number || a.id || '').match(/(\d+)$/);
        const matchB = (b.lead_number || b.id || '').match(/(\d+)$/);
        const numA = matchA ? parseInt(matchA[1], 10) : NaN;
        const numB = matchB ? parseInt(matchB[1], 10) : NaN;
        let diff = 0;
        if (!isNaN(numA) && !isNaN(numB)) diff = numB - numA;
        else diff = (b.lead_number || b.id || '').localeCompare(a.lead_number || a.id || '', undefined, { numeric: true });
        if (diff === 0) {
          diff = (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
        }
        return diff;
      });
  }, [leads]);

  const leadCounts = metricsService.getLeadCounts(telecallerFilter === 'all' ? undefined : telecallerFilter);
  const hasActiveFilters = searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || sourceFilter !== 'all' || telecallerFilter !== 'all';

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
              Leads Pipeline Management
            </h1>
            <span className="badge badge-neutral">
              {filteredLeads.length} of {leadCounts.total} Records
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Manage client inquiries, requirements intake, and quotations handover workflow.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="btn-primary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
        >
          <Plus size={15} />
          <span>New Lead Intake</span>
        </button>
      </div>

      {/* Admin Incoming Requirements Queue Banner */}
      {incomingAdminLeads.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.25rem', borderLeft: '4px solid #8b5cf6', background: 'rgba(255, 255, 255, 0.85)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Inbox size={16} color="#8b5cf6" />
              <h2 style={{ fontSize: '0.875rem', fontWeight: 700, margin: 0, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Incoming Requirements — Admin Queue ({incomingAdminLeads.length})
              </h2>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#8b5cf6' }}>
              Verified telecaller handovers awaiting quotation drafting
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.75rem' }}>
            {incomingAdminLeads.map(item => (
              <div 
                key={item.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid rgba(226, 232, 240, 0.8)',
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.02)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{item.company_name || item.customer_name}</strong>
                    {item.company_name && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({item.customer_name})</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    <strong>{item.service_required}</strong> · {item.campaign_location || (item.sub_district ? `${item.sub_district}, ${item.location}` : item.location)} · {item.number_of_days || 1}d
                  </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                      Staff: {formatStaffDisplayName(item.assigned_telecaller_email)}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleOpenDetailModal(item)}
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem' }}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartQuotation(item)}
                    className="btn-primary"
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.65rem', background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' }}
                  >
                    <FileText size={12} />
                    <span>Quote</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CRM Search & Filters Bar */}
      <div className="glass-panel" style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        
        {/* Top Filter Row: Search + Status + Priority + Telecaller */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Search Box */}
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search lead, customer, phone, location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '2.2rem', fontSize: '0.8125rem' }}
            />
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '180px', fontSize: '0.8125rem' }}
          >
            <option value="all">All Stages ({leadCounts.total})</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label} ({(leadCounts.byStatus as any)[k] || 0})</option>
            ))}
          </select>

          {/* Priority Quick Toggles */}
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            {[
              { key: 'HOT', label: 'Hot', count: leadCounts.byPriority.HOT, pillClass: 'priority-pill-hot' },
              { key: 'WARM', label: 'Warm', count: leadCounts.byPriority.WARM, pillClass: 'priority-pill-warm' },
              { key: 'COLD', label: 'Cold', count: leadCounts.byPriority.COLD, pillClass: 'priority-pill-cold' }
            ].map(p => {
              const isActive = priorityFilter === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPriorityFilter(priorityFilter === p.key ? 'all' : p.key)}
                  className={`badge ${p.pillClass}`}
                  style={{
                    padding: '0.35rem 0.6rem',
                    cursor: 'pointer',
                    opacity: isActive || priorityFilter === 'all' ? 1 : 0.45,
                    borderWidth: isActive ? '2px' : '1px'
                  }}
                >
                  {p.label} ({p.count})
                </button>
              );
            })}
          </div>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{ width: '150px', fontSize: '0.8125rem' }}
          >
            <option value="all">All Sources</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="whatsapp_bulk">WhatsApp</option>
            <option value="website">Website</option>
            <option value="phone">Direct Call</option>
            <option value="existing_customer">Existing Client</option>
            <option value="referral">Referral</option>
            <option value="other">Other</option>
          </select>

          {/* Telecaller Filter */}
          <select
            value={telecallerFilter}
            onChange={(e) => setTelecallerFilter(e.target.value)}
            style={{ minWidth: '160px', fontSize: '0.8125rem' }}
          >
            <option value="all">All Staff</option>
            {availableStaff.map(s => (
              <option key={s.email} value={s.email}>{s.name}{s.email.toLowerCase() === (userEmail || '').toLowerCase().trim() ? ' (You)' : ''}</option>
            ))}
            <option value="unassigned">Unassigned Leads</option>
          </select>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setPriorityFilter('all');
                setSourceFilter('all');
                setTelecallerFilter('all');
              }}
              className="btn-ghost"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
            >
              <X size={13} />
              <span>Reset</span>
            </button>
          )}

        </div>

      </div>

      {/* Main CRM Data Table */}
      <div className="table-container animate-fade-in">
        {sortedLeads.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th 
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  style={{ minWidth: '115px', cursor: 'pointer', userSelect: 'none' }}
                  title={`Click to sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span>Lead ID</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--brand-blue)', fontWeight: 800 }}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  </div>
                </th>
                <th style={{ minWidth: '160px' }}>Company</th>
                <th style={{ minWidth: '160px' }}>Customer Name</th>
                <th style={{ minWidth: '160px' }}>Service Required</th>
                <th style={{ minWidth: '130px' }}>Campaign Location</th>
                <th style={{ minWidth: '100px' }}>Target Date</th>
                <th style={{ minWidth: '85px' }}>Priority</th>
                <th style={{ minWidth: '140px' }}>Workflow Stage</th>
                <th style={{ minWidth: '110px' }}>Assigned Staff</th>
                <th style={{ textAlign: 'right', minWidth: '95px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.map(lead => {
                const statusMeta = STATUS_CONFIG[lead.status] || { label: lead.status, dotClass: 'status-dot-neutral' };

                return (
                  <tr 
                    key={lead.id}
                    onClick={() => handleOpenDetailModal(lead)}
                    style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                  >
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--brand-blue)', fontSize: '0.8125rem' }}>
                      {lead.lead_number || lead.id}
                    </td>

                    <td>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.875rem' }}>{lead.company_name || '—'}</div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.84rem' }}>{lead.customer_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem' }}>{lead.phone}</div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.8125rem' }}>{lead.service_required || '—'}</div>
                      {lead.vehicle_service_type && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.1rem' }}>{lead.vehicle_service_type}</div>
                      )}
                    </td>

                    <td style={{ color: '#334155', fontSize: '0.8125rem' }}>
                      {lead.campaign_location || (lead.sub_district ? `${lead.sub_district}, ${lead.location}` : lead.location) || '—'}
                    </td>

                    <td className="mono" style={{ fontSize: '0.8125rem', color: '#334155' }}>
                      {lead.required_date ? lead.required_date.split('-').reverse().join('/') : 'TBD'}
                      {lead.number_of_days ? <span style={{ color: '#64748b', fontSize: '0.75rem' }}> ({lead.number_of_days}d)</span> : ''}
                    </td>

                    <td>
                      <span className={`badge ${lead.priority === 'HOT' ? 'priority-pill-hot' : lead.priority === 'WARM' ? 'priority-pill-warm' : 'priority-pill-cold'}`}>
                        {lead.priority}
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <span className={`status-dot ${statusMeta.dotClass}`} />
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a' }}>
                          {statusMeta.label}
                        </span>
                      </div>
                    </td>

                    <td style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 500 }}>
                      {formatStaffDisplayName(lead.assigned_telecaller_email)}
                    </td>

                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleOpenDetailModal(lead)}
                          className="btn-ghost"
                          style={{ padding: '0.3rem' }}
                          title="Open Lead Drawer"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(lead)}
                          className="btn-ghost"
                          style={{ padding: '0.3rem' }}
                          title="Edit Lead"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteLead(lead.id, lead.lead_number)}
                          className="btn-ghost"
                          style={{ padding: '0.3rem', color: '#ef4444' }}
                          title="Delete Lead"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ margin: 0, fontSize: '0.875rem' }}>No leads found matching your search and filter criteria.</p>
            <button
              onClick={handleOpenAddModal}
              className="btn-primary"
              style={{ marginTop: '0.75rem' }}
            >
              + Create New Lead
            </button>
          </div>
        )}
      </div>

      {/* Lead Create / Edit Modal */}
      {modalOpen && (
        <LeadModal
          lead={editingLead}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={(savedLead) => {
            refreshLeads();
            if (savedLead && viewingLead && viewingLead.id === savedLead.id) {
              setViewingLead(savedLead);
            }
          }}
          customers={customers}
          userEmail={userEmail}
          companyId={companyId}
        />
      )}

      {/* Lead Detail Right-Side Drawer */}
      {detailModalOpen && viewingLead && (
        <LeadDetailModal
          lead={viewingLead}
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          onEdit={(l) => handleOpenEditModal(l)}
          onUpdated={(updated) => {
            setViewingLead(updated);
            refreshLeads();
          }}
          userEmail={userEmail}
          userRole={_role}
        />
      )}

      {/* Admin Quotation Modal */}
      {quotationModalOpen && leadForQuotation && (
        <QuotationModal
          quotation={officeService.getQuotationByLeadId(leadForQuotation.id)}
          linkedLead={leadForQuotation}
          isOpen={quotationModalOpen}
          onClose={() => setQuotationModalOpen(false)}
          onSaved={() => {
            refreshLeads();
            setQuotationModalOpen(false);
          }}
          userRole={_role as any || 'admin'}
          userEmail={userEmail}
        />
      )}
    </div>
  );
};

