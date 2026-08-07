import React, { useState } from 'react';
import type { CompanyProfile } from '../../types';
import { ChevronDown } from 'lucide-react';
import { resolveProfileLogo } from '../../utils/resolveProfileLogo';

interface ProfileSwitcherProps {
  profiles: CompanyProfile[];
  activeProfile: CompanyProfile | null;
  onSwitch: (profile: CompanyProfile) => void;
}

/**
 * Mobile equivalent of the desktop Sidebar's "Brand Header & Profile
 * Switcher" (src/components/Sidebar.tsx) - same data (profiles,
 * activeProfile), same switch handler contract, same dropdown
 * interaction. Only the layout is mobile-specific; nothing about which
 * profiles exist or how switching one works is reimplemented here.
 */
export const ProfileSwitcher: React.FC<ProfileSwitcherProps> = ({ profiles, activeProfile, onSwitch }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className="btn-secondary"
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.6rem 0.75rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
          {resolveProfileLogo(activeProfile) ? (
            <img
              src={resolveProfileLogo(activeProfile)}
              alt="Logo"
              style={{ width: '26px', height: '26px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div style={{
              width: '26px', height: '26px', borderRadius: '4px',
              background: 'var(--accent-primary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'bold', fontSize: '0.8rem', flexShrink: 0
            }}>
              {activeProfile?.name?.charAt(0) || 'C'}
            </div>
          )}
          <div style={{ overflow: 'hidden', textAlign: 'left' }}>
            <p style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
              {activeProfile?.name || 'No Profile'}
            </p>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {activeProfile?.currency || 'INR'}
            </span>
          </div>
        </div>
        <ChevronDown size={16} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '105%',
          left: 0,
          right: 0,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100,
          overflow: 'hidden',
          padding: '0.25rem 0'
        }}>
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => {
                onSwitch(p);
                setOpen(false);
              }}
              style={{
                width: '100%',
                padding: '0.65rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                background: p.id === activeProfile?.id ? 'var(--bg-input)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            >
              {resolveProfileLogo(p) ? (
                <img src={resolveProfileLogo(p)} alt="Logo" loading="lazy" style={{ width: '20px', height: '20px', borderRadius: '2px', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '20px', height: '20px', borderRadius: '2px',
                  background: 'var(--text-muted)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.65rem', fontWeight: 'bold'
                }}>
                  {p.name.charAt(0)}
                </div>
              )}
              <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
