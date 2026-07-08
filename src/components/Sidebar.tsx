import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Users, 
  Briefcase, 
  Settings as SettingsIcon, 
  ChevronDown, 
  Cloud, 
  CloudOff, 
  Sun, 
  Moon, 
  LogOut,
  Plus,
  X
} from 'lucide-react';
import type { CompanyProfile } from '../types';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  profiles: CompanyProfile[];
  activeProfile: CompanyProfile | null;
  setActiveProfile: (profile: CompanyProfile) => void;
  onAddProfileClick: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  user: any;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  profiles,
  activeProfile,
  setActiveProfile,
  onAddProfileClick,
  theme,
  toggleTheme,
  user,
  onLogout,
  isOpen,
  onClose
}) => {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const isCloudActive = !!user;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'services', label: 'Services', icon: Briefcase },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      {/* Mobile close button */}
      <div className="mobile-only-display" style={{ width: '100%', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button
          onClick={onClose}
          className="btn-secondary"
          style={{ padding: '0.35rem', borderRadius: '4px', border: 'none', background: 'transparent' }}
          title="Close Menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Brand Header & Profile Switcher */}
      <div style={{ position: 'relative', marginBottom: '2rem', width: '100%' }}>
        <button 
          onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
          className="btn-secondary"
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left', overflow: 'hidden' }}>
            {activeProfile?.logo_url ? (
              <img 
                src={activeProfile.logo_url} 
                alt="Logo" 
                style={{ width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '4px',
                background: 'var(--accent-primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '0.85rem'
              }}>
                {activeProfile?.name?.charAt(0) || 'C'}
              </div>
            )}
            <div className="profile-details" style={{ overflow: 'hidden' }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {activeProfile?.name || 'No Profile'}
              </p>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {activeProfile?.currency || 'INR'}
              </span>
            </div>
          </div>
          <ChevronDown size={16} className="profile-details" style={{ opacity: 0.6 }} />
        </button>

        {profileDropdownOpen && (
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
                  setActiveProfile(p);
                  setProfileDropdownOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  background: p.id === activeProfile?.id ? 'var(--bg-input)' : 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text-primary)'
                }}
                className="dropdown-item"
              >
                {p.logo_url ? (
                  <img src={p.logo_url} alt="Logo" style={{ width: '20px', height: '20px', borderRadius: '2px', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '2px',
                    background: 'var(--text-muted)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 'bold'
                  }}>
                    {p.name.charAt(0)}
                  </div>
                )}
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{p.name}</span>
              </button>
            ))}
            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }} />
            <button
              onClick={() => {
                onAddProfileClick();
                setProfileDropdownOpen(false);
              }}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                color: 'var(--accent-primary)',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              <Plus size={16} />
              <span style={{ fontSize: '0.875rem' }}>Add Profile</span>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, width: '100%' }}>
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              className={`nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} style={{ flexShrink: 0 }} />
              <span className="nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User Session & Status Area */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
        {/* Connection Status indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-input)',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          width: '100%'
        }}>
          {isCloudActive ? (
            <>
              <Cloud size={16} style={{ color: 'var(--accent-success)' }} />
              <span className="db-mode-text" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                Cloud: {user?.email}
              </span>
            </>
          ) : (
            <>
              <CloudOff size={16} style={{ color: 'var(--accent-warning)' }} />
              <span className="db-mode-text">Sandbox (Local Storage)</span>
            </>
          )}
        </div>

        {/* Theme and Logout Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <button
            onClick={toggleTheme}
            className="btn-secondary"
            style={{
              flex: 1,
              padding: '0.5rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer'
            }}
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {isCloudActive && (
            <button
              onClick={onLogout}
              className="btn-danger"
              style={{
                flex: 1,
                padding: '0.5rem',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer'
              }}
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
