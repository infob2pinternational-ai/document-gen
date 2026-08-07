import React from 'react';
import { Clock, Wallet, ChevronRight, FileText, Users, Briefcase, CheckCircle2, CalendarRange } from 'lucide-react';
import type { CompanyProfile, Document, Customer, Service } from '../../types';
import { docTypeLabel } from '../docTypeLabel';
import { computeDashboardStats } from '../../utils/dashboardStats';

interface HomeProps {
  userName: string;
  activeProfile: CompanyProfile | null;
  documents: Document[];
  customers: Customer[];
  services: Service[];
  loading: boolean;
  onViewDocument: (doc: Document) => void;
  onGoToPending: () => void;
}

const formatCurrency = (val: number, currency?: string) => {
  const symbol = currency === 'USD' ? '$' : '₹';
  return `${symbol}${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const Home: React.FC<HomeProps> = ({ userName, activeProfile, documents, customers, services, loading, onViewDocument, onGoToPending }) => {
  const pending = documents.filter(d => d.status === 'pending_approval' || !d.status);
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.slice(0, 7);
  const recent = [...documents]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);
  // Same revenue/outstanding definition as the desktop dashboard
  // (utils/dashboardStats.ts), not a separate calculation. No
  // trend/overdue figures shown here - the schema has no "paid" or
  // "due date" field to compute them from honestly.
  const stats = computeDashboardStats(documents, activeProfile?.id);
  // Second analytics row - all derived from fields that already exist
  // on Document/Customer/Service (approved_at, date), not new tracking.
  const approvedToday = documents.filter(d => d.status === 'approved' && d.approved_at?.slice(0, 10) === today).length;
  const documentsThisMonth = documents.filter(d => (d.date || '').slice(0, 7) === thisMonth).length;

  if (loading) {
    return (
      <div className="owner-loading-state">
        <Clock size={16} className="owner-spin" />
        <span>Loading your dashboard…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
      <div>
        <h1 style={{ fontSize: '1.55rem', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
          {/* Real user_metadata.full_name / email, not a placeholder -
              see OwnerApp.tsx. Falls back to the plain greeting alone
              (no invented name) on the rare account with neither. */}
          {getGreeting()}{userName ? `, ${userName}` : ''}
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--owner-text-secondary)', margin: '0.2rem 0 0' }}>
          Here's what's happening with your account today.
        </p>
      </div>

      <button
        onClick={onGoToPending}
        className="owner-card owner-pending-card"
        style={pending.length > 0 ? { boxShadow: 'var(--owner-shadow-card), inset 0 0 0 1.5px rgba(255,140,0,0.35)' } : undefined}
      >
        <div
          className="owner-pending-card-icon"
          style={{
            background: pending.length > 0 ? 'var(--owner-primary-soft)' : 'var(--owner-surface-high)',
            color: pending.length > 0 ? 'var(--owner-primary)' : 'var(--owner-text-secondary)'
          }}
        >
          <Clock size={20} />
        </div>
        <div className="owner-pending-card-body">
          <div className="owner-pending-card-label">Pending Approval</div>
          <div className="owner-pending-card-count" style={{ color: pending.length > 0 ? 'var(--owner-primary)' : 'var(--owner-text)' }}>
            {pending.length}
            <span className="owner-pending-card-unit">Document{pending.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <ChevronRight size={18} style={{ color: 'var(--owner-text-muted)', flexShrink: 0 }} />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <h2 className="owner-section-label">Financials</h2>
        <div className="owner-stat-grid">
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-success-bg)', color: 'var(--owner-success-fg)' }}>
                <Wallet size={15} />
              </div>
              <span className="owner-stat-label">Revenue</span>
            </div>
            <div className="owner-stat-value mono">{formatCurrency(stats.revenue, activeProfile?.currency)}</div>
          </div>
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-warning-bg)', color: 'var(--owner-warning-fg)' }}>
                <Clock size={15} />
              </div>
              <span className="owner-stat-label">Outstanding</span>
            </div>
            <div className="owner-stat-value mono">{formatCurrency(stats.outstanding, activeProfile?.currency)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <h2 className="owner-section-label">Overview</h2>
        <div className="owner-stat-grid">
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-primary-soft)', color: 'var(--owner-primary)' }}>
                <Users size={15} />
              </div>
              <span className="owner-stat-label">Customers</span>
            </div>
            <div className="owner-stat-value">{customers.length}</div>
          </div>
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-primary-soft)', color: 'var(--owner-primary)' }}>
                <Briefcase size={15} />
              </div>
              <span className="owner-stat-label">Services</span>
            </div>
            <div className="owner-stat-value">{services.length}</div>
          </div>
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-success-bg)', color: 'var(--owner-success-fg)' }}>
                <CheckCircle2 size={15} />
              </div>
              <span className="owner-stat-label">Approved</span>
            </div>
            <div className="owner-stat-value">{approvedToday}</div>
          </div>
          <div className="owner-card owner-stat-card">
            <div className="owner-stat-icon-row">
              <div className="owner-stat-icon" style={{ background: 'var(--owner-surface-high)', color: 'var(--owner-text-secondary)' }}>
                <CalendarRange size={15} />
              </div>
              <span className="owner-stat-label">This Month</span>
            </div>
            <div className="owner-stat-value">{documentsThisMonth}</div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="owner-section-label" style={{ marginBottom: '0.6rem' }}>Recent Documents</h2>
        <div className="owner-card" style={{ padding: '0 1.1rem' }}>
          {recent.length === 0 ? (
            <div className="owner-empty-state" style={{ padding: '1.5rem 0' }}>
              <div className="owner-empty-state-icon"><FileText size={22} /></div>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No documents yet.</p>
            </div>
          ) : (
            recent.map(doc => (
              <button
                key={doc.id}
                onClick={() => onViewDocument(doc)}
                className="owner-list-item"
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--owner-border)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                  <div className="owner-stat-icon" style={{ background: 'var(--owner-surface-high)', color: 'var(--owner-text-secondary)', minWidth: 36, minHeight: 36, flexShrink: 0 }}>
                    <FileText size={15} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {docTypeLabel(doc.document_type)} · {doc.customer_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--owner-text-secondary)' }}>{doc.document_number}</div>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--owner-text-muted)', flexShrink: 0 }} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
