import React, { useState } from 'react';
import type { Document } from '../../types';
import { Search } from 'lucide-react';

interface DocumentsListProps {
  title: string;
  documents: Document[];
  loading: boolean;
  onViewDocument: (doc: Document) => void;
  showFilters?: boolean;
}

const docTypeLabel = (type: Document['document_type']) => {
  switch (type) {
    case 'invoice': return 'Invoice';
    case 'non_tax_invoice': return 'Invoice';
    case 'proforma_invoice': return 'Proforma';
    case 'quotation': return 'Quotation';
    case 'work_order': return 'Work Order';
    case 'comparison_quotation': return 'Quote';
    case 'comparison_invoice': return 'Manual Invoice';
    default: return 'Document';
  }
};

const statusColor = (status?: string) => {
  if (status === 'approved') return '#10b981';
  if (status === 'rejected') return '#ef4444';
  return '#f59e0b';
};

const statusLabel = (status?: string) => {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
};

export const DocumentsList: React.FC<DocumentsListProps> = ({
  title,
  documents,
  loading,
  onViewDocument,
  showFilters = false
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_approval' | 'approved' | 'rejected'>('all');

  const filtered = documents
    .filter(d => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'pending_approval') return d.status === 'pending_approval' || !d.status;
      return d.status === statusFilter;
    })
    .filter(d => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return d.document_number.toLowerCase().includes(q) || d.customer_name.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>{title}</h1>

      {showFilters && (
        <>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search by document number or customer"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.7rem 0.75rem 0.7rem 2.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
            {(['all', 'pending_approval', 'approved', 'rejected'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={statusFilter === f ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap', minHeight: '40px' }}
              >
                {f === 'all' ? 'All' : f === 'pending_approval' ? 'Pending' : f === 'approved' ? 'Approved' : 'Rejected'}
              </button>
            ))}
          </div>
        </>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)' }}>No documents found.</div>
      ) : (
        <div className="owner-card" style={{ padding: '0 1rem' }}>
          {filtered.map(doc => (
            <button
              key={doc.id}
              onClick={() => onViewDocument(doc)}
              className="owner-list-item"
              style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{docTypeLabel(doc.document_type)} - {doc.customer_name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {doc.document_number} · {doc.date ? doc.date.split('-').reverse().join('/') : ''}
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: statusColor(doc.status) }}>
                {statusLabel(doc.status)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
