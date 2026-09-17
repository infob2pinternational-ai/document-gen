import React, { useState, useEffect, useMemo } from 'react';
import type { Lead } from '../../types';
import { leadService } from '../../services/leadService';
import { metricsService } from '../../services/metricsService';
import { getIstTodayDateStr, formatIstDateTime } from '../../utils/dateUtils';
import { formatStaffDisplayName, getAvailableStaffList } from '../../utils/staffUtils';
import { CallEntryModal } from './CallEntryModal';
import { CallHistoryModal } from './CallHistoryModal';
import { ExcelImportModal } from './ExcelImportModal';
import { 
  Database, 
  Search, 
  Plus, 
  Upload, 
  Phone, 
  History, 
  CheckCircle2, 
  User, 
  MapPin, 
  Download,
  X,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';

interface CallingDatabaseProps {
  userRole?: string;
  userEmail?: string;
  companyId?: string;
}

export const CallingDatabase: React.FC<CallingDatabaseProps> = ({
  userRole = 'owner',
  userEmail = 'owner@b2p.com',
  companyId
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [telecallerFilter, setTelecallerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');

  // Modals
  const [entryModalLead, setEntryModalLead] = useState<Lead | null>(null);
  const [historyModalLead, setHistoryModalLead] = useState<Lead | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Quick New Lead modal state
  const [newLeadModalOpen, setNewLeadModalOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newContactPerson, setNewContactPerson] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAltPhone, setNewAltPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newService, setNewService] = useState('');
  const [newAssignedStaff, setNewAssignedStaff] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshLeads = () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = leadService.getLeads(companyId);
      setLeads(data);
    } catch (err: any) {
      console.error('[CallingDatabase] Error refreshing leads:', err);
      setLoadError(err.message || 'Failed to load calling database records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshLeads();
    const unsub = metricsService.subscribe(refreshLeads);
    return unsub;
  }, [companyId]);

  const availableStaff = useMemo(() => {
    return getAvailableStaffList(userEmail, leads);
  }, [userEmail, leads]);

  // Unique locations from data for filter
  const locations = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      if (l.location && l.location.trim()) {
        set.add(l.location.trim());
      }
    });
    return Array.from(set).sort();
  }, [leads]);

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      // Role scope: telecaller only sees assigned leads unless owner/admin
      if (userRole === 'telecaller') {
        const assigned = (l.assigned_telecaller_email || '').toLowerCase().trim();
        if (assigned !== userEmail.toLowerCase().trim()) return false;
      }

      // Search match
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const match = 
          (l.company_name && l.company_name.toLowerCase().includes(term)) ||
          l.customer_name.toLowerCase().includes(term) ||
          l.phone.includes(term) ||
          (l.alternate_phone && l.alternate_phone.includes(term)) ||
          (l.location && l.location.toLowerCase().includes(term)) ||
          (l.remarks && l.remarks.toLowerCase().includes(term)) ||
          (l.last_call_remark && l.last_call_remark.toLowerCase().includes(term));
        if (!match) return false;
      }

      // Telecaller filter
      if (telecallerFilter !== 'all') {
        if (telecallerFilter === 'unassigned') {
          if (l.assigned_telecaller_email) return false;
        } else {
          if ((l.assigned_telecaller_email || '').toLowerCase().trim() !== telecallerFilter.toLowerCase().trim()) {
            return false;
          }
        }
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (l.status !== statusFilter) return false;
      }

      // Outcome filter
      if (outcomeFilter !== 'all') {
        if (l.last_call_outcome !== outcomeFilter) return false;
      }

      // Location filter
      if (locationFilter !== 'all') {
        if ((l.location || '').trim().toLowerCase() !== locationFilter.trim().toLowerCase()) return false;
      }

      return true;
    });
  }, [leads, userRole, userEmail, searchTerm, telecallerFilter, statusFilter, outcomeFilter, locationFilter]);

  const handleQuickReassign = async (leadId: string, staffEmail: string) => {
    const lead = leadService.getLeadById(leadId);
    if (!lead) return;

    await leadService.saveLead({
      ...lead,
      assigned_telecaller_email: staffEmail || undefined
    }, userEmail);

    refreshLeads();
  };

  const handleCreateNewLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim() && !newContactPerson.trim()) {
      alert('Please enter a Company Name or Contact Person.');
      return;
    }
    if (!newPhone.trim()) {
      alert('Please enter a Primary Phone number.');
      return;
    }

    try {
      await leadService.saveLead({
        company_id: companyId || leadService.getActiveCompany() || 'default',
        company_name: newCompanyName.trim() || newContactPerson.trim(),
        customer_name: newContactPerson.trim() || newCompanyName.trim(),
        phone: newPhone.trim(),
        alternate_phone: newAltPhone.trim(),
        email: newEmail.trim(),
        location: newLocation.trim(),
        service_required: newService.trim(),
        assigned_telecaller_email: newAssignedStaff || (userRole === 'telecaller' ? userEmail : undefined),
        status: 'new',
        priority: 'WARM',
        is_telecalling_lead: true
      }, userEmail);

      setNewLeadModalOpen(false);
      setNewCompanyName('');
      setNewContactPerson('');
      setNewPhone('');
      setNewAltPhone('');
      setNewEmail('');
      setNewLocation('');
      setNewService('');
      setNewAssignedStaff('');
      refreshLeads();
    } catch (err: any) {
      alert(err.message || 'Failed to create new lead.');
    }
  };

  const handleExportCsv = () => {
    if (filteredLeads.length === 0) {
      alert('No records to export.');
      return;
    }

    const headers = [
      'Company Name',
      'Contact Person',
      'Primary Phone',
      'Alternate Phone',
      'Email',
      'Location',
      'Assigned Telecaller',
      'Status',
      'Last Call Date',
      'Last Call Outcome',
      'Last Call Remark',
      'Calls Count',
      'Next Follow-up'
    ];

    const rows = filteredLeads.map(l => [
      `"${(l.company_name || '').replace(/"/g, '""')}"`,
      `"${(l.customer_name || '').replace(/"/g, '""')}"`,
      `"${l.phone || ''}"`,
      `"${l.alternate_phone || ''}"`,
      `"${l.email || ''}"`,
      `"${(l.location || '').replace(/"/g, '""')}"`,
      `"${l.assigned_telecaller_email || 'Unassigned'}"`,
      `"${l.status}"`,
      `"${l.last_call_at ? formatIstDateTime(l.last_call_at) : ''}"`,
      `"${l.last_call_outcome || ''}"`,
      `"${(l.last_call_remark || '').replace(/"/g, '""')}"`,
      l.call_count || 0,
      `"${l.next_follow_up_at ? formatIstDateTime(l.next_follow_up_at) : ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `b2p_calling_database_${getIstTodayDateStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header Bar */}
      <div className="glass-panel" style={{
        padding: '1.25rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Database size={20} color="var(--brand-blue)" />
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Master Calling Database
            </h1>
            <span className="badge badge-neutral" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {filteredLeads.length} of {leads.length} Records
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.2rem' }}>
            Single source of truth for all client outreach, live calling history, and follow-ups.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={refreshLeads}
            disabled={loading}
            className="btn btn-secondary"
            style={{ gap: '0.45rem', fontSize: '0.8125rem' }}
            title="Refresh database"
          >
            <RotateCcw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>

          {userRole !== 'telecaller' && (
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="btn btn-secondary"
              style={{ gap: '0.45rem', fontSize: '0.8125rem', fontWeight: 600 }}
            >
              <Upload size={14} color="#10b981" /> Import from Excel
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            className="btn btn-secondary"
            style={{ gap: '0.45rem', fontSize: '0.8125rem' }}
            title="Export CSV"
          >
            <Download size={14} /> Export CSV
          </button>

          <button
            type="button"
            onClick={() => setNewLeadModalOpen(true)}
            className="btn btn-primary"
            style={{ gap: '0.45rem', fontSize: '0.8125rem', fontWeight: 700 }}
          >
            <Plus size={15} /> Add Contact
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {loadError && (
        <div style={{
          padding: '0.85rem 1.25rem',
          borderRadius: '12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={refreshLeads}
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Controls Bar */}
      <div className="glass-panel" style={{
        padding: '1rem 1.25rem',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem'
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search company, contact, phone, location..."
            style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '0.75rem', paddingTop: '0.4rem', paddingBottom: '0.4rem', fontSize: '0.8125rem' }}
          />
        </div>

        {/* Telecaller Filter (if Owner/Admin) */}
        {userRole !== 'telecaller' && (
          <select
            value={telecallerFilter}
            onChange={(e) => setTelecallerFilter(e.target.value)}
            style={{ fontSize: '0.8125rem', padding: '0.4rem 0.65rem', minWidth: '160px' }}
          >
            <option value="all">All Telecallers</option>
            <option value="unassigned">Unassigned Only</option>
            {availableStaff.map(s => (
              <option key={s.email} value={s.email}>{s.name}</option>
            ))}
          </select>
        )}

        {/* Lead Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '0.4rem 0.65rem', minWidth: '140px' }}
        >
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="telecaller_working">Working</option>
          <option value="requirement_collected">Req Collected</option>
          <option value="sent_to_admin">Sent to Admin</option>
          <option value="follow_up">Follow-up</option>
          <option value="confirmed">Confirmed</option>
          <option value="lost">Lost</option>
        </select>

        {/* Outcome Filter */}
        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '0.4rem 0.65rem', minWidth: '150px' }}
        >
          <option value="all">All Outcomes</option>
          <option value="Connected">Connected</option>
          <option value="Interested">Interested</option>
          <option value="Requirement Collected">Requirement Collected</option>
          <option value="Appointment Confirmed">Appointment Confirmed</option>
          <option value="Meeting Scheduled">Meeting Scheduled</option>
          <option value="Call Back">Call Back</option>
          <option value="Follow-up Required">Follow-up Required</option>
          <option value="No Answer">No Answer</option>
          <option value="Not Reachable">Not Reachable</option>
          <option value="Switched Off">Switched Off</option>
          <option value="Invalid Number">Invalid Number</option>
          <option value="Not Interested">Not Interested</option>
        </select>

        {/* Location Filter */}
        {locations.length > 0 && (
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            style={{ fontSize: '0.8125rem', padding: '0.4rem 0.65rem', minWidth: '140px' }}
          >
            <option value="all">All Locations</option>
            {locations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        )}

        {/* Reset Filters button */}
        {(searchTerm || telecallerFilter !== 'all' || statusFilter !== 'all' || outcomeFilter !== 'all' || locationFilter !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setTelecallerFilter('all');
              setStatusFilter('all');
              setOutcomeFilter('all');
              setLocationFilter('all');
            }}
            className="btn btn-ghost"
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Main Database Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: '180px' }}>Company & Contact</th>
                <th style={{ minWidth: '150px' }}>Phone Numbers</th>
                <th style={{ minWidth: '110px' }}>Location</th>
                <th style={{ minWidth: '140px' }}>Assigned Telecaller</th>
                <th style={{ minWidth: '110px' }}>CRM Status</th>
                <th style={{ minWidth: '170px' }}>Last Call Outcome</th>
                <th style={{ minWidth: '80px', textAlign: 'center' }}>Calls</th>
                <th style={{ minWidth: '140px' }}>Next Follow-up</th>
                <th style={{ minWidth: '160px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                    {loading ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <RotateCcw size={16} className="spin" />
                        <span>Loading calling database records...</span>
                      </div>
                    ) : loadError ? (
                      <div>
                        <p style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.85rem' }}>{loadError}</p>
                        <button
                          type="button"
                          onClick={refreshLeads}
                          className="btn btn-secondary"
                          style={{ marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <span>No client records matching your filters.</span>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLeads.map(lead => {
                  return (
                    <tr key={lead.id}>
                      {/* Company & Contact Person */}
                      <td>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {lead.company_name || lead.customer_name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                          <User size={12} /> {lead.customer_name}
                        </div>
                        {lead.email ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {lead.email}
                          </div>
                        ) : null}
                      </td>

                      {/* Phone Numbers */}
                      <td>
                        <a
                          href={`tel:${lead.phone}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            color: '#10b981',
                            fontWeight: 700,
                            fontSize: '0.8125rem',
                            textDecoration: 'none'
                          }}
                        >
                          <Phone size={13} /> {lead.phone}
                        </a>
                        {lead.alternate_phone ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            Alt: {lead.alternate_phone}
                          </div>
                        ) : null}
                      </td>

                      {/* Location */}
                      <td>
                        {lead.location ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            <MapPin size={12} /> {lead.location}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>

                      {/* Assigned Telecaller (Editable by Admin/Owner) */}
                      <td>
                        {userRole !== 'telecaller' ? (
                          <select
                            value={lead.assigned_telecaller_email || ''}
                            onChange={(e) => handleQuickReassign(lead.id, e.target.value)}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.45rem', maxWidth: '140px' }}
                          >
                            <option value="">Unassigned</option>
                            {availableStaff.map(s => (
                              <option key={s.email} value={s.email}>{s.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {formatStaffDisplayName(lead.assigned_telecaller_email)}
                          </span>
                        )}
                      </td>

                      {/* Current Status */}
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: '0.7rem', textTransform: 'capitalize' }}>
                          {lead.status.replace(/_/g, ' ')}
                        </span>
                      </td>

                      {/* Last Call Outcome & Remark */}
                      <td>
                        {lead.last_call_outcome ? (
                          <div>
                            <span 
                              className="badge"
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                background: lead.last_call_outcome === 'Interested' || lead.last_call_outcome === 'Connected'
                                  ? 'rgba(16, 185, 129, 0.12)'
                                  : 'rgba(100, 116, 139, 0.12)',
                                color: lead.last_call_outcome === 'Interested' || lead.last_call_outcome === 'Connected'
                                  ? '#059669'
                                  : 'var(--text-primary)'
                              }}
                            >
                              {lead.last_call_outcome}
                            </span>
                            {lead.last_call_at ? (
                              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                {formatIstDateTime(lead.last_call_at)}
                              </div>
                            ) : null}
                            {lead.last_call_remark ? (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lead.last_call_remark}>
                                {lead.last_call_remark}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Not contacted</span>
                        )}
                      </td>

                      {/* Calls Count */}
                      <td style={{ textAlign: 'center' }}>
                        <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: lead.call_count ? 'var(--brand-blue)' : 'var(--text-muted)' }}>
                          {lead.call_count || 0}
                        </span>
                      </td>

                      {/* Next Follow-up */}
                      <td>
                        {lead.next_follow_up_at ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--brand-blue)', fontWeight: 600 }}>
                            {formatIstDateTime(lead.next_follow_up_at)}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>

                      {/* Action Buttons */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          {/* Log Result Button */}
                          <button
                            type="button"
                            onClick={() => setEntryModalLead(lead)}
                            className="btn btn-primary"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', gap: '0.3rem' }}
                            title="Log Call Result"
                          >
                            <CheckCircle2 size={13} /> Log Call
                          </button>

                          {/* History View */}
                          <button
                            type="button"
                            onClick={() => setHistoryModalLead(lead)}
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.5rem' }}
                            title="Complete Timeline"
                          >
                            <History size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Call Entry Modal */}
      {entryModalLead && (
        <CallEntryModal
          lead={entryModalLead}
          isOpen={Boolean(entryModalLead)}
          onClose={() => setEntryModalLead(null)}
          onSaved={() => refreshLeads()}
          telecallerEmail={userEmail}
        />
      )}

      {/* Call History Modal */}
      {historyModalLead && (
        <CallHistoryModal
          lead={historyModalLead}
          isOpen={Boolean(historyModalLead)}
          onClose={() => setHistoryModalLead(null)}
          onLogNewCall={(l) => {
            setHistoryModalLead(null);
            setEntryModalLead(l);
          }}
        />
      )}

      {/* Excel Import Modal */}
      {importModalOpen && (
        <ExcelImportModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          onImportSuccess={(imp, act) => {
            refreshLeads();
            alert(`Successfully imported ${imp} clients and logged ${act} initial call activities!`);
          }}
          currentUserEmail={userEmail}
          companyId={companyId}
        />
      )}

      {/* Add New Contact Modal */}
      {newLeadModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            padding: '1rem'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewLeadModalOpen(false);
          }}
        >
          <div
            className="glass-panel animate-scale-up"
            style={{
              width: '100%',
              maxWidth: '540px',
              background: 'var(--bg-card)',
              borderRadius: '20px',
              padding: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Add New Calling Contact
              </h2>
              <button
                type="button"
                onClick={() => setNewLeadModalOpen(false)}
                className="btn-ghost"
                style={{ padding: '0.4rem', borderRadius: '50%' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewLead} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                  Company Name <span style={{ color: 'red' }}>*</span>
                </label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Malabar Gold & Diamonds"
                  style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={newContactPerson}
                    onChange={(e) => setNewContactPerson(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                    Primary Phone <span style={{ color: 'red' }}>*</span>
                  </label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="e.g. +91 98470 11223"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                    Alternate Phone
                  </label>
                  <input
                    type="tel"
                    value={newAltPhone}
                    onChange={(e) => setNewAltPhone(e.target.value)}
                    placeholder="e.g. +91 98470 33445"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="e.g. info@company.com"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                    Location / City
                  </label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Thrissur, Kerala"
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                    Assign Telecaller
                  </label>
                  <select
                    value={newAssignedStaff}
                    onChange={(e) => setNewAssignedStaff(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                  >
                    <option value="">Leave Unassigned</option>
                    {availableStaff.map(s => (
                      <option key={s.email} value={s.email}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>
                  Service / Product Interest
                </label>
                <input
                  type="text"
                  value={newService}
                  onChange={(e) => setNewService(e.target.value)}
                  placeholder="e.g. LED Display Van Promotion"
                  style={{ width: '100%', padding: '0.45rem 0.65rem', fontSize: '0.8125rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setNewLeadModalOpen(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ fontWeight: 700 }}
                >
                  Save to Database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
