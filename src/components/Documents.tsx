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
