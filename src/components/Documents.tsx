import React, { useState } from 'react';
import type { CompanyProfile, Document } from '../types';
import { Search, Plus, Eye, Edit, Trash2, ShieldAlert, Check, X, Download, RefreshCw } from 'lucide-react';
import { dbService } from '../services/db';
import { retryDocument, type SyncQueueRow } from '../services/sheetsSyncQueue';

interface DocumentsProps {
  role: string;
  activeProfile: CompanyProfile | null;
  documents: Document[];
  syncQueue: SyncQueueRow[];
  onAddDocument: () => void;
  onAddComparison: (type: 'comparison_quotation' | 'comparison_invoice') => void;
  onEditDocument: (doc: Document) => void;
  onViewDocument: (doc: Document) => void;
  onDeleteDocument: (id: string) => void;
  onRefreshDocs?: () => void;
}

export const Documents: React.FC<DocumentsProps> = ({
  role,
  activeProfile,
  documents,
  syncQueue,
  onAddDocument,
  onAddComparison,
  onEditDocument,
  onViewDocument,
  onDeleteDocument,
  onRefreshDocs
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterDateRange, setFilterDateRange] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Derives the 5-state display status directly from the live
  // google_sync_queue row - never from local component state, per
  // requirement 1. No queue row at all means this document has never
  // been enqueued (e.g. sync isn't configured for this company) - no
  // badge is shown for that case, only for documents that have one.
  const getSyncDisplay = (docId: string) => {
    const row = syncQueue.find(q => q.document_id === docId);
    if (!row) return null;
    if (row.status === 'synced') return { label: 'Synced', icon: '✓', color: '#10b981', row };
    if (row.status === 'syncing') return { label: 'Syncing', icon: '🔄', color: '#3b82f6', row };
    if (row.status === 'failed' && row.failed_permanently) return { label: 'Failed', icon: '❌', color: '#ef4444', row };
    if (row.status === 'failed' && !row.failed_permanently) return { label: 'Retrying', icon: '🔄', color: '#f59e0b', row };
    return { label: 'Pending', icon: '⏳', color: '#64748b', row };
  };

  const handleRetrySync = async (docId: string) => {
    setRetryingId(docId);
    try {
      await retryDocument(docId);
    } finally {
      // syncQueue itself updates live via Realtime once the retry
      // actually runs - this just clears the button's own "in flight"
      // state for the click itself, not the sync outcome.
      setRetryingId(null);
    }
  };

  const filteredDocs = documents
    .filter(d => !activeProfile || d.company_id === activeProfile.id)
    .filter(d => {
      // 1. Search text filter
      const matchSearch = d.document_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          d.customer_name.toLowerCase().includes(searchTerm.toLowerCase());
      
      // 2. Document type filter
      const matchType = filterType === 'all' || d.document_type === filterType;
      
      // 3. Date wise filter
      let matchDate = true;
      if (d.date) {
        const docDateObj = new Date(d.date);
        docDateObj.setHours(0, 0, 0, 0); // Normalize to start of day

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (filterDateRange === 'today') {
          matchDate = docDateObj.getTime() === startOfToday.getTime();
        } else if (filterDateRange === 'yesterday') {
          const startOfYesterday = new Date(startOfToday);
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
          matchDate = docDateObj.getTime() === startOfYesterday.getTime();
        } else if (filterDateRange === 'this_week') {
          const startOfWeek = new Date(startOfToday);
          startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
          matchDate = docDateObj >= startOfWeek && docDateObj <= startOfToday;
        } else if (filterDateRange === 'this_month') {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          matchDate = docDateObj >= startOfMonth && docDateObj <= startOfToday;
        } else if (filterDateRange === 'custom') {
          const start = startDate ? new Date(startDate) : null;
          const end = endDate ? new Date(endDate) : null;
          if (start) start.setHours(0, 0, 0, 0);
          if (end) end.setHours(23, 59, 59, 999);

          if (start && end) {
            matchDate = docDateObj >= start && docDateObj <= end;
          } else if (start) {
            matchDate = docDateObj >= start;
          } else if (end) {
            matchDate = docDateObj <= end;
          }
        }
      }

      return matchSearch && matchType && matchDate;
    });

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Documents Repository</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Browse, manage, and print invoices, quotations, and work orders.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button 
            onClick={onAddDocument} 
            className="btn-secondary"
            disabled={!activeProfile}
          >
            <Plus size={16} />
            <span>Create Standard Document</span>
          </button>
          
          <button 
            onClick={() => onAddComparison('comparison_quotation')} 
            className="btn-primary"
            disabled={!activeProfile}
            style={{
              background: 'linear-gradient(135deg, var(--accent-primary) 0%, #d97706 100%)',
              border: 'none',
              color: '#fff',
              fontWeight: 600
            }}
          >
            <Plus size={16} />
            <span>Create Quote</span>
          </button>

          <button 
            onClick={() => onAddComparison('comparison_invoice')} 
            className="btn-primary"
            disabled={!activeProfile}
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              border: 'none',
              color: '#fff',
              fontWeight: 600
            }}
          >
            <Plus size={16} />
            <span>Create Manual Invoice</span>
          </button>

          <button 
            onClick={() => dbService.downloadFullBackupFile()} 
            className="btn-secondary"
            title="Download full backup file (.json) to local computer"
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Download size={16} />
            <span>Export Backup</span>
          </button>
        </div>
      </div>

      {!activeProfile ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <ShieldAlert size={48} style={{ color: 'var(--accent-warning)', margin: '0 auto 1rem auto' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>No Active Profile Selected</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Please create or select a company profile in Settings to manage documents.</p>
        </div>
      ) : (
        <>
          {/* Filters Area */}
          <div className="filters-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Search */}
            <div className="search-box" style={{ maxWidth: '320px', flex: '1 1 250px' }}>
              <Search size={18} />
              <input
                type="text"
                placeholder="Search by doc number, customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Document type filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="filter-select"
              style={{ width: '180px' }}
            >
              <option value="all">All Documents</option>
              <option value="invoice">Tax Invoices</option>
              <option value="non_tax_invoice">Invoices</option>
              <option value="proforma_invoice">Proforma Invoices</option>
              <option value="quotation">Quotations</option>
              <option value="comparison_quotation">Comparison Quotations</option>
              <option value="work_order">Work Orders</option>
            </select>

            {/* Date range selection */}
            <select
              value={filterDateRange}
              onChange={(e) => setFilterDateRange(e.target.value)}
              className="filter-select"
              style={{ width: '180px' }}
            >
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="custom">Custom Date Range...</option>
            </select>

            {/* Custom Date Range Picker Fields */}
            {filterDateRange === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="filter-select"
                  style={{ padding: '0.45rem 0.75rem', width: '140px' }}
                  title="Start Date"
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="filter-select"
                  style={{ padding: '0.45rem 0.75rem', width: '140px' }}
                  title="End Date"
                />
                {(startDate || endDate) && (
                  <button 
                    onClick={() => { setStartDate(''); setEndDate(''); }} 
                    className="btn-secondary" 
                    style={{ padding: '0.45rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Clear dates"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Table repository */}
          <div className="table-container animate-fade-in">
            {filteredDocs.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Doc Number</th>
                    <th>Date</th>
                    <th>Customer Name</th>
                    <th>Document Type</th>
                    <th>Total Amount</th>
                    <th>Created By</th>
                    <th>Status</th>
                    <th>Sync Status</th>
                    <th>WA Sent By</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map(doc => {
                    return (
                      <tr key={doc.id}>
                        <td className="mono" data-label="Doc Number" style={{ fontWeight: 600 }}>{doc.document_number}</td>
                        <td data-label="Date">{doc.date ? doc.date.split('-').reverse().join('/') : ''}</td>
                        <td data-label="Customer Name">{doc.customer_name}</td>
                        <td data-label="Document Type" style={{ textTransform: 'capitalize', fontSize: '0.75rem', fontWeight: 500 }}>
                          {doc.document_type === 'non_tax_invoice' ? 'Invoice' : 
                           doc.document_type === 'invoice' ? 'Tax Invoice' : 
                           doc.document_type === 'comparison_quotation' ? (
                             <span style={{
                               display: 'inline-flex',
                               alignItems: 'center',
                               background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.15) 100%)',
                               color: '#d97706',
                               padding: '0.15rem 0.45rem',
                               borderRadius: '4px',
                               fontWeight: 600,
                               fontSize: '0.65rem',
                               textTransform: 'uppercase'
                             }}>
                               Quote
                             </span>
                           ) : 
                           doc.document_type === 'comparison_invoice' ? (
                             <span style={{
                               display: 'inline-flex',
                               alignItems: 'center',
                               background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(29, 78, 216, 0.15) 100%)',
                               color: '#1d4ed8',
                               padding: '0.15rem 0.45rem',
                               borderRadius: '4px',
                               fontWeight: 600,
                               fontSize: '0.65rem',
                               textTransform: 'uppercase'
                             }}>
                               Manual Invoice
                             </span>
                           ) : 
                           doc.document_type.replace('_', ' ')}
                        </td>
                        <td className="mono" data-label="Total Amount" style={{ fontWeight: 600 }}>
                          {activeProfile.currency === 'INR' ? '₹' : '$'}
                          {doc.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td data-label="Created By" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {doc.created_by_email ? doc.created_by_email.split('@')[0] : '-'}
                        </td>
                        <td data-label="Status">
                          {doc.status === 'approved' ? (
                            <span style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                              color: '#10b981', 
                              padding: '0.25rem 0.5rem', 
                              borderRadius: '9999px', 
                              fontSize: '0.7rem', 
                              fontWeight: 600 
                            }}>
                              Approved
                            </span>
                          ) : doc.status === 'rejected' ? (
                            <span style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                              color: '#ef4444', 
                              padding: '0.25rem 0.5rem', 
                              borderRadius: '9999px', 
                              fontSize: '0.7rem', 
                              fontWeight: 600 
                            }}>
                              Rejected
                            </span>
                          ) : (
                            <span style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              backgroundColor: 'rgba(249, 115, 22, 0.1)', 
                              color: '#f97316', 
                              padding: '0.25rem 0.5rem', 
                              borderRadius: '9999px', 
                              fontSize: '0.7rem', 
                              fontWeight: 600 
                            }}>
                              Pending Approval
                            </span>
                          )}
                        </td>
                        <td data-label="Sync Status">
                          {(() => {
                            const sync = getSyncDisplay(doc.id);
                            if (!sync) {
                              return <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>-</span>;
                            }
                            const tooltip = [
                              `Last sync: ${sync.row.updated_at ? new Date(sync.row.updated_at).toLocaleString() : 'never'}`,
                              `Attempts: ${sync.row.attempts}`,
                              sync.row.last_error ? `Last error: ${sync.row.last_error}` : null
                            ].filter(Boolean).join('\n');
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span
                                  title={tooltip}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    color: sync.color,
                                    cursor: 'default'
                                  }}
                                >
                                  <span>{sync.icon}</span>
                                  <span>{sync.label}</span>
                                </span>
                                {(sync.label === 'Failed' || sync.label === 'Retrying') && (
                                  <button
                                    onClick={() => handleRetrySync(doc.id)}
                                    disabled={retryingId === doc.id}
                                    className="btn-secondary"
                                    style={{ padding: '0.2rem', borderRadius: '4px' }}
                                    title="Retry sync now"
                                  >
                                    <RefreshCw size={12} className={retryingId === doc.id ? 'spin' : ''} />
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td data-label="WA Sent By" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {doc.whatsapp_sent_by_email ? (
                            <span style={{ color: '#10b981', fontWeight: 500 }}>
                              {doc.whatsapp_sent_by_email.split('@')[0]}
                            </span>
                          ) : '-'}
                        </td>
                        <td data-label="Actions">
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            {doc.customer_phone && doc.status === 'approved' && (
                              <button
                                onClick={() => {
                                  if (doc.status !== 'approved') {
                                    alert('This document must be approved first before it can be sent to the customer.');
                                    return;
                                  }
                                  if (!doc.customer_phone) return;
                                  let cleanPhone = doc.customer_phone.replace(/\D/g, '');
                                  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                                  const docDate = doc.date ? doc.date.split('-').reverse().join('/') : '';
                                  const formattedTotal = Number(doc.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
                                  const shareLink = baseUrl + '/doc/' + doc.id;
                                  
                                  const companyName = activeProfile?.name || 'B2P International';
                                  
                                  let docTypeLabel = 'Document';
                                  let docNoLabel = 'Doc';
                                  if (doc.document_type === 'invoice') {
                                    docTypeLabel = 'Tax Invoice';
                                    docNoLabel = 'Invoice';
                                  } else if (doc.document_type === 'non_tax_invoice') {
                                    docTypeLabel = 'Invoice';
                                    docNoLabel = 'Invoice';
                                  } else if (doc.document_type === 'proforma_invoice') {
                                    docTypeLabel = 'Proforma Invoice';
                                    docNoLabel = 'Invoice';
                                  } else if (doc.document_type === 'quotation') {
                                    docTypeLabel = 'Quotation';
                                    docNoLabel = 'Quotation';
                                  } else if (doc.document_type === 'work_order') {
                                    docTypeLabel = 'Work Order';
                                    docNoLabel = 'Work Order';
                                  }

                                  const msg = `*Dear ${doc.customer_name}*,\n\n` +
                                    `Greetings from ${companyName}.\n\n` +
                                    `Thank you for choosing us. Please find your ${docTypeLabel}.\n\n` +
                                    `📄 ${docNoLabel} No.: ${doc.document_number}\n` +
                                    `📅 Date: ${docDate}\n` +
                                    `💰 Amount: ₹${formattedTotal}\n\n` +
                                    `🔗 *View / Download ${docNoLabel}*\n` +
                                    `${shareLink}\n\n` +
                                    `Should you require any clarification or revisions, please feel free to contact us.\n\n` +
                                    `Thank you for your trust in ${companyName}.\n\n` +
                                    `Warm Regards,\n` +
                                    `${companyName}\n\n` +
                                    `━━━━━━━━━━━━━━━━━━\n\n` +
                                    `📲 *Follow Us*\n` +
                                    `Instagram\n` +
                                    `https://www.instagram.com/b2p_international/\n\n` +
                                    `Facebook\n` +
                                    `https://facebook.com/b2pinternational\n\n` +
                                    `⭐ *Share Your Experience*\n` +
                                    `https://g.page/r/CcC1J3PCvB_BEBM/review`;

                                  const userStr = localStorage.getItem('supabase_user');
                                  const user = userStr ? JSON.parse(userStr) : null;
                                  const userEmail = user ? user.email : '';
                                  if (userEmail) {
                                    dbService.logWhatsAppSend(doc.id, userEmail).then(() => {
                                      if (onRefreshDocs) onRefreshDocs();
                                    }).catch(err => console.error(err));
                                  }

                                  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
                                }}
                                className="btn-secondary"
                                style={{ 
                                  padding: '0.35rem', 
                                  borderRadius: '4px', 
                                  color: doc.status === 'approved' ? '#25D366' : '#64748b',
                                  opacity: doc.status === 'approved' ? 1 : 0.45,
                                  cursor: doc.status === 'approved' ? 'pointer' : 'not-allowed'
                                }}
                                title={doc.status === 'approved' ? "Send via WhatsApp" : "Pending Approval"}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.49-4.22c1.7.994 3.551 1.54 5.46 1.545 5.867 0 10.639-4.76 10.643-10.627.002-2.842-1.096-5.513-3.093-7.514S14.86 3.1 12.016 3.1C6.15 3.1 1.38 7.86 1.377 13.728c-.001 1.955.513 3.868 1.49 5.58l-.995 3.637 3.733-.979zm11.168-5.32c-.305-.152-1.802-.888-2.082-.99-.28-.102-.484-.152-.688.152-.204.305-.79.99-.969 1.2-.178.204-.356.229-.66.076-.305-.152-1.289-.475-2.455-1.515-.908-.81-1.52-1.81-1.698-2.115-.178-.305-.019-.47.133-.621.137-.136.305-.356.457-.534.152-.178.204-.305.305-.508.102-.204.051-.381-.025-.533-.076-.152-.688-1.659-.942-2.27-.248-.596-.5-.515-.688-.525-.178-.01-.382-.01-.586-.01-.204 0-.535.076-.814.381-.28.305-1.069 1.042-1.069 2.54 0 1.498 1.09 2.946 1.242 3.149.152.204 2.146 3.277 5.198 4.59.726.313 1.293.5 1.734.64.73.232 1.394.2 1.918.12.584-.087 1.802-.737 2.057-1.448.255-.71.255-1.321.178-1.448-.076-.127-.28-.203-.585-.355z"/>
                                </svg>
                              </button>
                            )}
                            {doc.status !== 'approved' && doc.status !== 'rejected' && (() => {
                              const userStr = localStorage.getItem('supabase_user');
                              const user = userStr ? JSON.parse(userStr) : null;
                              const userEmail = (user ? user.email : '').toLowerCase();
                              return !activeProfile?.approver_email || userEmail === activeProfile.approver_email.toLowerCase();
                            })() && (
                              <>
                                <button
                                  onClick={async () => {
                                    const userStr = localStorage.getItem('supabase_user');
                                    const user = userStr ? JSON.parse(userStr) : null;
                                    const userEmail = user ? user.email : 'System';
                                    if (window.confirm(`Are you sure you want to approve document ${doc.document_number}?`)) {
                                      try {
                                        await dbService.approveDocument(doc.id, userEmail);
                                        if (onRefreshDocs) onRefreshDocs();
                                      } catch (err) {
                                        console.error(err);
                                        alert('Failed to approve document.');
                                      }
                                    }
                                  }}
                                  className="btn-secondary"
                                  style={{ padding: '0.35rem', borderRadius: '4px', color: '#10b981', marginRight: '0.25rem' }}
                                  title="Approve Document"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  onClick={async () => {
                                    const userStr = localStorage.getItem('supabase_user');
                                    const user = userStr ? JSON.parse(userStr) : null;
                                    const userEmail = user ? user.email : 'System';
                                    if (window.confirm(`Are you sure you want to reject document ${doc.document_number}?`)) {
                                      try {
                                        await dbService.rejectDocument(doc.id, userEmail);
                                        if (onRefreshDocs) onRefreshDocs();
                                      } catch (err) {
                                        console.error(err);
                                        alert('Failed to reject document.');
                                      }
                                    }
                                  }}
                                  className="btn-secondary"
                                  style={{ padding: '0.35rem', borderRadius: '4px', color: '#ef4444', marginRight: '0.25rem' }}
                                  title="Reject Document"
                                >
                                  <X size={14} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => onViewDocument(doc)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem', borderRadius: '4px' }}
                              title="View / Print Document"
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
              <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p>No documents found in this directory.</p>
                <button
                  onClick={onAddDocument}
                  className="btn-primary"
                  style={{ marginTop: '1.25rem' }}
                >
                  Create Your First Document
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
