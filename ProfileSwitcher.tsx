import React, { useState } from 'react';
import type { CompanyProfile } from '../../types';
import { ChevronDown } from 'lucide-react';

interface ProfileSwitcherProps {
  profiles: CompanyProfile[];
  activeProfile: CompanyProfile | null;
  onSwitch: (profile: CompanyProfile) => void;
}

/**
 * Brand + company-profile switcher for the header. Same data (profiles,
 * activeProfile), same switch handler contract, same dropdown
 * interaction as the desktop Sidebar's "Brand Header & Profile
 * Switcher" (src/components/Sidebar.tsx) - nothing about which
 * profiles exist or how switching one works is reimplemented here,
 * only the presentation.
 *
 * Unlike the desktop version, "B2P ONE" is always the headline (the
 * branding requirement is that the app name never appears to change),
 * with the active company as the switchable subtitle underneath it.
 * The dropdown affordance (chevron, tap-to-open) only appears once
 * there's actually more than one profile to switch to - with a single
 * profile there's nothing to switch, so it renders as a plain,
 * non-interactive brand block instead of a dead-end button.
 */
export const ProfileSwitcher: React.FC<ProfileSwitcherProps> = ({ profiles, activeProfile, onSwitch }) => {
  const [open, setOpen] = useState(false);
  const canSwitch = profiles.length > 1;

  // A company profile's own logo always takes priority when set (same
  // as desktop's Sidebar). With no per-company logo, fall back to the
  // official B2P ONE app icon instead of a plain text initial - this
  // is the same asset as the Android launcher icon (copied into this
  // app's own publicDir, see vite.mobile.config.ts), referenced via
  // BASE_URL so it resolves correctly in the Capacitor bundle.
  const appIconUrl = `${import.meta.env.BASE_URL}app-icon.png`;
  const avatar = (profile: CompanyProfile | null, size: 'lg' | 'sm') => {
    const cls = size === 'lg' ? 'owner-profile-avatar' : 'owner-profile-option-avatar';
    return <img src={profile?.logo_url || appIconUrl} alt="" className={cls} />;
  };

  return (
    <div className="owner-profile-switcher">
      <button
        onClick={() => canSwitch && setOpen(o => !o)}
        className="owner-profile-trigger"
        style={{ cursor: canSwitch ? 'pointer' : 'default' }}
        aria-expanded={open}
      >
        {avatar(activeProfile, 'lg')}
        <div className="owner-profile-text">
          <p className="owner-brand-name">B2P ONE</p>
          <div className="owner-profile-company-row">
            <span>{activeProfile?.name || 'No Company Profile'}</span>
            {canSwitch && <ChevronDown size={14} className={`owner-profile-chevron ${open ? 'open' : ''}`} />}
          </div>
        </div>
      </button>

      <div className={`owner-profile-dropdown ${open ? 'open' : ''}`}>
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => {
              onSwitch(p);
              setOpen(false);
            }}
            className={`owner-profile-option ${p.id === activeProfile?.id ? 'selected' : ''}`}
          >
            {avatar(p, 'sm')}
            <span className="owner-profile-option-name">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
