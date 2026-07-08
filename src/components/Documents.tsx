import React, { useState } from 'react';
import type { CompanyProfile, Document } from '../types';
import { Search, Plus, Eye, Edit, Trash2, ShieldAlert } from 'lucide-react';

interface DocumentsProps {
  role: string;
  activeProfile: CompanyProfile | null;
  documents: Document[];
  onAddDocument: () => void;
  onEditDocument: (doc: Document) => void;
  onViewDocument: (doc: Document) => void;
  onDeleteDocument: (id: string) => void;
}

export const Documents: React.FC<DocumentsProps> = ({
  role,
  activeProfile,
  documents,
  onAddDocument,
  onEditDocument,
  onViewDocument,
  onDeleteDocument
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const filteredDocs = documents
    .filter(d => !activeProfile || d.company_id === activeProfile.id)
    .filter(d => {
      const matchSearch = d.document_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          d.customer_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchType = filterType === 'all' || d.document_type === filterType;
      return matchSearch && matchType;
    });

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Documents Repository</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Browse, manage, and print invoices, quotations, and work orders.
          </p>
        </div>
        <button 
          onClick={onAddDocument} 
          className="btn-primary"
          disabled={!activeProfile}
        >
          <Plus size={16} />
          <span>Create Document</span>
        </button>
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
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            {/* Search */}
            <div style={{ position: 'relative', width: '320px' }}>
              <Search size={18} style={{
                position: 'absolute',
                left: '0.875rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }} />
              <input
                type="text"
                placeholder="Search by doc number, customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>

            {/* Document type filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ width: '200px' }}
            >
              <option value="all">All Documents</option>
              <option value="invoice">Tax Invoices</option>
              <option value="proforma_invoice">Proforma Invoices</option>
              <option value="quotation">Quotations</option>
              <option value="work_order">Work Orders</option>
            </select>
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
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map(doc => {
                    return (
                      <tr key={doc.id}>
                        <td className="mono" style={{ fontWeight: 600 }}>{doc.document_number}</td>
                        <td>{doc.date ? doc.date.split('-').reverse().join('/') : ''}</td>
                        <td>{doc.customer_name}</td>
                        <td style={{ textTransform: 'capitalize', fontSize: '0.75rem', fontWeight: 500 }}>
                          {doc.document_type.replace('_', ' ')}
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {activeProfile.currency === 'INR' ? '₹' : '$'}
                          {doc.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            {doc.customer_phone && (
                              <button
                                onClick={() => {
                                  if (!doc.customer_phone) return;
                                  let cleanPhone = doc.customer_phone.replace(/\D/g, '');
                                  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                                  const docTitle = doc.document_type === 'invoice' ? 'TAX INVOICE' : doc.document_type === 'proforma_invoice' ? 'PROFORMA INVOICE' : doc.document_type === 'quotation' ? 'QUOTATION' : 'WORK ORDER';
                                  const msg = `Hello *${doc.customer_name}*,\n\nHere is your *${docTitle}* *#${doc.document_number}* dated *${doc.date ? doc.date.split('-').reverse().join('/') : ''}* from *${activeProfile?.name}*.\n\n*Amount:* ₹${Number(doc.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\nThank you!`;
                                  window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
                                }}
                                className="btn-secondary"
                                style={{ padding: '0.35rem', borderRadius: '4px', color: '#25D366' }}
                                title="Send via WhatsApp"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.49-4.22c1.7.994 3.551 1.54 5.46 1.545 5.867 0 10.639-4.76 10.643-10.627.002-2.842-1.096-5.513-3.093-7.514S14.86 3.1 12.016 3.1C6.15 3.1 1.38 7.86 1.377 13.728c-.001 1.955.513 3.868 1.49 5.58l-.995 3.637 3.733-.979zm11.168-5.32c-.305-.152-1.802-.888-2.082-.99-.28-.102-.484-.152-.688.152-.204.305-.79.99-.969 1.2-.178.204-.356.229-.66.076-.305-.152-1.289-.475-2.455-1.515-.908-.81-1.52-1.81-1.698-2.115-.178-.305-.019-.47.133-.621.137-.136.305-.356.457-.534.152-.178.204-.305.305-.508.102-.204.051-.381-.025-.533-.076-.152-.688-1.659-.942-2.27-.248-.596-.5-.515-.688-.525-.178-.01-.382-.01-.586-.01-.204 0-.535.076-.814.381-.28.305-1.069 1.042-1.069 2.54 0 1.498 1.09 2.946 1.242 3.149.152.204 2.146 3.277 5.198 4.59.726.313 1.293.5 1.734.64.73.232 1.394.2 1.918.12.584-.087 1.802-.737 2.057-1.448.255-.71.255-1.321.178-1.448-.076-.127-.28-.203-.585-.355z"/>
                                </svg>
                              </button>
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
