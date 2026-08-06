import React from 'react';
import type { Document } from '../../types';

interface HomeProps {
  userName: string;
  documents: Document[];
  loading: boolean;
  onViewDocument: (doc: Document) => void;
  onGoToPending: () => void;
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export const Home: React.FC<HomeProps> = ({ userName, documents, loading, onViewDocument, onGoToPending }) => {
  const pending = documents.filter(d => d.status === 'pending_approval' || !d.status);
  const today = new Date().toISOString().split('T')[0];
  const todaysDocs = documents.filter(d => d.date === today);
  const recent = [...documents]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
        {getGreeting()} {userName}
      </h1>

      <button
        onClick={onGoToPending}
        className="owner-card"
        style={{ textAlign: 'left', cursor: 'pointer', border: pending.length > 0 ? '1px solid #f59e0b' : undefined }}
      >
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Pending Approval</div>
        <div style={{ fontSize: '2rem', fontWeight: 700, color: pending.length > 0 ? '#f59e0b' : 'var(--text-primary)' }}>
          {pending.length} Document{pending.length === 1 ? '' : 's'}
        </div>
      </button>

      <div className="owner-card">
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Today's Documents</div>
        <div style={{ fontSize: '2rem', fontWeight: 700 }}>{todaysDocs.length}</div>
      </div>

      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Recent Documents</h2>
        <div className="owner-card" style={{ padding: '0 1rem' }}>
          {recent.length === 0 ? (
            <div style={{ padding: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No documents yet.</div>
          ) : (
            recent.map(doc => (
              <button
                key={doc.id}
                onClick={() => onViewDocument(doc)}
                className="owner-list-item"
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{docTypeLabel(doc.document_type)} - {doc.customer_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{doc.document_number}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
