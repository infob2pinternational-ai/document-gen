import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document } from '../types';
import { 
  FileText, 
  Search, 
  TrendingUp,
  FileCheck,
  Briefcase,
  Eye,
  Edit,
  Trash2
} from 'lucide-react';

interface DashboardProps {
  role: string;
  activeProfile: CompanyProfile | null;
  profiles: CompanyProfile[];
  documents: Document[];
  onEditDocument: (doc: Document) => void;
  onViewDocument: (doc: Document) => void;
  onDeleteDocument: (id: string) => void;
  setCurrentTab: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  role,
  activeProfile,
  profiles,
  documents,
  onEditDocument,
  onViewDocument,
  onDeleteDocument,
  setCurrentTab
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [stats, setStats] = useState({
    revenue: 0,
    invoiceCount: 0,
    quoteCount: 0,
    workOrderCount: 0
  });

  // Calculate stats for the active profile
  useEffect(() => {
    if (!activeProfile) return;
    const companyDocs = documents.filter(d => d.company_id === activeProfile.id);
    
    // Revenue: sum of all invoices
    const paidRevenue = companyDocs
      .filter(d => d.document_type === 'invoice' || d.document_type === 'non_tax_invoice')
      .reduce((sum, d) => sum + Number(d.total), 0);

    const invoices = companyDocs.filter(d => d.document_type === 'invoice' || d.document_type === 'non_tax_invoice').length;
    const quotes = companyDocs.filter(d => d.document_type === 'quotation').length;
    const workOrders = companyDocs.filter(d => d.document_type === 'work_order').length;

    setStats({
      revenue: paidRevenue,
      invoiceCount: invoices,
      quoteCount: quotes,
      workOrderCount: workOrders
    });
  }, [activeProfile, documents]);

  // Currency helper
  const formatCurrency = (val: number, currency: string) => {
    const symbol = currency === 'INR' ? '₹' : '$';
    return `${symbol}${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const filteredDocs = documents
    .filter(d => !activeProfile || d.company_id === activeProfile.id)
    .filter(d => {
      const matchSearch = d.document_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          d.customer_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchType = filterType === 'all' || d.document_type === filterType;
      return matchSearch && matchType;
    })
    .slice(0, 10); // Limit to top 10 recent

  // Compute coverage stats for all profiles
  const profileCoverages = profiles.map(prof => {
    const pDocs = documents.filter(d => d.company_id === prof.id);
    const pRevenue = pDocs
      .filter(d => d.document_type === 'invoice' || d.document_type === 'non_tax_invoice')
      .reduce((sum, d) => sum + Number(d.total), 0);
    return {
      profile: prof,
      docCount: pDocs.length,
      revenue: pRevenue
    };
  });

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Welcome & Quick Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Dashboard Overview</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Real-time operations dashboard for <strong>{activeProfile?.name || 'Create a profile to begin'}</strong>
          </p>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid-4">
        {/* Revenue */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--accent-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <TrendingUp size={24} />
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Revenue (Paid)</p>
            <h3 className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
              {formatCurrency(stats.revenue, activeProfile?.currency || 'INR')}
            </h3>
          </div>
        </div>

        {/* Invoices */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(37, 99, 235, 0.1)',
            color: 'var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FileText size={24} />
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Invoices Created</p>
            <h3 className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
              {stats.invoiceCount}
            </h3>
          </div>
        </div>

        {/* Quotations */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(245, 158, 11, 0.1)',
            color: 'var(--accent-warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <FileCheck size={24} />
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Pending Quotations</p>
            <h3 className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
              {stats.quoteCount}
            </h3>
          </div>
        </div>

        {/* Work Orders */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'rgba(139, 92, 246, 0.1)',
            color: '#8b5cf6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Briefcase size={24} />
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Active Work Orders</p>
            <h3 className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
              {stats.workOrderCount}
            </h3>
          </div>
        </div>
      </div>

      {/* Main Dashboard Panels */}
      <div className="dashboard-grid">
        {/* Left Side: Recent Documents with Search */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="filters-row">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Recent Documents</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', width: 'auto' }}>
              {/* Search */}
              <div className="search-box" style={{ maxWidth: '220px' }}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search by ID or customer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ fontSize: '0.8rem' }}
                />
              </div>
              {/* Filter */}
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="filter-select"
                style={{ width: '150px', fontSize: '0.8rem' }}
              >
                <option value="all">All Types</option>
                <option value="invoice">Tax Invoices</option>
                <option value="non_tax_invoice">Invoices</option>
                <option value="proforma_invoice">Proforma Invoices</option>
                <option value="quotation">Quotations</option>
                <option value="work_order">Work Orders</option>
              </select>
            </div>
          </div>

          <div className="table-container">
            {filteredDocs.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Doc Number</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Total</th>
                    <th>Created By</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map(doc => {
                    return (
                      <tr key={doc.id}>
                        <td className="mono" data-label="Doc Number" style={{ fontWeight: 600 }}>{doc.document_number}</td>
                        <td data-label="Customer">{doc.customer_name}</td>
                        <td data-label="Type" style={{ textTransform: 'capitalize', fontSize: '0.75rem', fontWeight: 500 }}>
                          {doc.document_type === 'non_tax_invoice' ? 'Invoice' : doc.document_type === 'invoice' ? 'Tax Invoice' : doc.document_type.replace('_', ' ')}
                        </td>
                        <td className="mono" data-label="Total" style={{ fontWeight: 600 }}>
                          {formatCurrency(doc.total, activeProfile?.currency || 'INR')}
                        </td>
                        <td data-label="Created By" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {doc.created_by_email ? doc.created_by_email.split('@')[0] : '-'}
                        </td>
                        <td data-label="Actions">
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => onViewDocument(doc)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px' }}
                              title="View Document"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => onEditDocument(doc)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px' }}
                              title="Edit Document"
                            >
                              <Edit size={14} />
                            </button>
                            {role === 'admin' && (
                              <button
                                onClick={() => {
                                  if (window.confirm(`Are you sure you want to delete ${doc.document_number}?`)) {
                                    onDeleteDocument(doc.id);
                                  }
                                }}
                                className="btn-secondary"
                                style={{ padding: '0.35rem', borderRadius: '4px', color: 'var(--accent-danger)' }}
                                title="Delete Document"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p>No documents found matching the search/filter criteria.</p>
                <button
                  onClick={() => setCurrentTab('documents')}
                  className="btn-primary"
                  style={{ marginTop: '1rem' }}
                >
                  Create Document
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Company Coverage */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Company Coverage</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {profileCoverages.map(({ profile, docCount, revenue }) => (
              <div 
                key={profile.id}
                className="card animate-fade-in"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  border: profile.id === activeProfile?.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: 'var(--bg-card)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {profile.logo_url ? (
                    <img 
                      src={profile.logo_url} 
                      alt={profile.name} 
                      loading="lazy"
                      style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '4px',
                      background: 'var(--border-color)',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '0.9rem'
                    }}>
                      {profile.name.charAt(0)}
                    </div>
                  )}
                  <div style={{ overflow: 'hidden' }}>
                    <h4 style={{ fontSize: '0.9rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>{profile.name}</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      GSTIN: {profile.gstin || 'Not Configured'}
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '0.5rem',
                  borderTop: '1px solid var(--border-color)',
                  fontSize: '0.8rem'
                }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.7rem' }}>DOCUMENTS</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{docCount}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.7rem' }}>COLLECTED REVENUE</span>
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--accent-success)' }}>
                      {formatCurrency(revenue, profile.currency)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
