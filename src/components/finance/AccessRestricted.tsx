import React from 'react';
import { ShieldAlert, ArrowLeft, KeyRound } from 'lucide-react';
import type { UserRole } from '../../types';

interface AccessRestrictedProps {
  currentRole: UserRole;
  onNavigateToLeads?: () => void;
  onNavigateToDashboard?: () => void;
  onSwitchToOwner?: () => void;
}

export const AccessRestricted: React.FC<AccessRestrictedProps> = ({
  currentRole,
  onNavigateToLeads,
  onNavigateToDashboard,
  onSwitchToOwner
}) => {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', padding: '2rem 1rem', textAlign: 'center' }}>
      <div 
        className="card"
        style={{
          maxWidth: '540px',
          width: '100%',
          padding: '3rem 2.5rem',
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-glass)'
        }}
      >
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: 'rgba(239, 68, 68, 0.1)',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem auto',
          border: '1px solid rgba(239, 68, 68, 0.2)'
        }}>
          <ShieldAlert size={32} />
        </div>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.25rem 0.75rem',
          borderRadius: '9999px',
          background: 'rgba(239, 68, 68, 0.1)',
          color: '#dc2626',
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '0.75rem'
        }}>
          <span>Access Restricted</span>
        </div>

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: '#0f172a' }}>
          Accounts & Finance Security Gate
        </h1>

        <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1.75rem 0' }}>
          Your current simulated role (<strong>{currentRole.toUpperCase()}</strong>) does not have authorization to view financial ledgers, tax returns, or company accounts.
          <br /><br />
          Finance modules are strictly restricted to <strong>Owner</strong> and <strong>Accounts</strong> credentials.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {(onNavigateToDashboard || onNavigateToLeads) && (
            <button
              onClick={onNavigateToDashboard || onNavigateToLeads}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <ArrowLeft size={16} />
              <span>Back to Dashboard</span>
            </button>
          )}

          {onSwitchToOwner && (
            <button
              onClick={onSwitchToOwner}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <KeyRound size={16} />
              <span>Switch to Accounts Role</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
