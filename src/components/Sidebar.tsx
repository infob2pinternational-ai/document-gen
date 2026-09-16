import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Target, 
  Users, 
  Clock, 
  FileText, 
  Receipt, 
  Calendar, 
  Briefcase, 
  MessageSquare, 
  CreditCard, 
  ShoppingCart, 
  BarChart3, 
  Settings as SettingsIcon, 
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
  X,
  Wallet,
  Truck,
  Building,
  TrendingUp,
  BookOpen,
  Layers,
  Landmark,
  Plus,
  Check,
  LogOut,
  Sun,
  Moon,
  Zap,
  Coffee,
  Sparkles
} from 'lucide-react';
import type { CompanyProfile, AppTheme } from '../types';
import { metricsService } from '../services/metricsService';
import { officeService } from '../services/officeService';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  profiles: CompanyProfile[];
  activeProfile: CompanyProfile | null;
  setActiveProfile: (profile: CompanyProfile) => void;
  onAddProfileClick: () => void;
  theme: AppTheme;
  toggleTheme?: () => void;
  onOpenThemeSelector?: () => void;
  user: any;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  userRole?: string;
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
  onOpenThemeSelector,
  isOpen,
  onClose,
  isCollapsed = false,
  onToggleCollapse,
  userRole = 'owner',
  user,
  onLogout
}) => {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = React.useRef<HTMLDivElement>(null);
  const [leadCount, setLeadCount] = useState(0);
  const [followUpDueCount, setFollowUpDueCount] = useState(0);
  const [waitingApprovalCount, setWaitingApprovalCount] = useState(0);
  const [whatsAppUnreadCount, setWhatsAppUnreadCount] = useState(0);

  const refreshBadges = () => {
    const leads = metricsService.getLeadCounts();
    const followUps = metricsService.getFollowUpCounts();
    const quotes = metricsService.getQuotationCounts();
    const convs = officeService.getConversations();
    const unreadWA = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);

    setLeadCount(leads.total || 0);
    setFollowUpDueCount((followUps.today || 0) + (followUps.overdue || 0));
    setWaitingApprovalCount(quotes.waitingApproval || 0);
    setWhatsAppUnreadCount(unreadWA);
  };

  useEffect(() => {
    refreshBadges();
    const unsub = metricsService.subscribe(refreshBadges);
    return unsub;
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    if (profileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [profileDropdownOpen]);

  interface NavItem {
    id: string;
    label: string;
    icon: any;
    badge?: number;
    badgeText?: string;
  }

  interface NavSection {
    title: string;
    items: NavItem[];
  }

  const isFinanceRole = userRole === 'owner' || userRole === 'admin' || userRole === 'accounts' || (user?.email || '').toLowerCase().trim() === 'fransonputhukkara@gmail.com' || (user?.email || '').toLowerCase().trim() === 'sarathjohnpanegdan@gmail.com';

  const baseSections: NavSection[] = [
    {
      title: 'WORKSPACE',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'leads', label: 'Leads', icon: Target, badge: leadCount > 0 ? leadCount : undefined },
        { id: 'customers', label: 'Customers', icon: Users },
        { id: 'follow-ups', label: 'Follow-ups', icon: Clock, badge: followUpDueCount > 0 ? followUpDueCount : undefined }
      ]
    },
    {
      title: 'SALES',
      items: [
        { id: 'documents', label: 'Quotations', icon: FileText, badge: waitingApprovalCount > 0 ? waitingApprovalCount : undefined },
        { id: 'invoices', label: 'Invoices', icon: Receipt }
      ]
    },
    {
      title: 'OPERATIONS',
      items: [
        { id: 'calendar', label: 'Calendar', icon: Calendar },
        { id: 'services', label: 'Services', icon: Briefcase }
      ]
    },
    {
      title: 'COMMUNICATION',
      items: [
        { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, badge: whatsAppUnreadCount > 0 ? whatsAppUnreadCount : undefined }
      ]
    }
  ];

  if (isFinanceRole) {
    baseSections.push({
      title: 'FINANCE & ACCOUNTS',
      items: [
        { id: 'finance-accounts', label: 'Accounts Dashboard', icon: CreditCard },
        { id: 'journal-entries', label: 'General Journal & Vouchers', icon: BookOpen },
        { id: 'chart-of-accounts', label: 'Chart of Accounts', icon: Layers },
        { id: 'banking-reconciliation', label: 'Banking & Cash', icon: Landmark },
        { id: 'sales-receivables', label: 'Sales & Receivables', icon: Receipt },
        { id: 'expenses', label: 'Expenses', icon: Wallet },
        { id: 'suppliers', label: 'Suppliers Directory', icon: Truck },
        { id: 'purchases-payables', label: 'Purchases & Payables', icon: ShoppingCart },
        { id: 'gst-tax', label: 'GST Compliance Center', icon: Building },
        { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
        { id: 'financial-reports', label: 'Financial Statements', icon: BarChart3 }
      ]
    });
  }

  if (userRole !== 'telecaller') {
    baseSections.push({
      title: 'ANALYTICS',
      items: [
        { id: 'reports', label: 'Reports', icon: BarChart3 }
      ]
    });
  }

  const navSections = baseSections;

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`} style={{
      background: 'rgba(255, 255, 255, 0.65)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.8)',
      boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.03)'
    }}>
      {/* Mobile close button */}
      <div className="mobile-only-display" style={{ width: '100%', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        <button onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }} title="Close Menu">
          <X size={18} />
        </button>
      </div>

      {/* Brand Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.65rem',
        padding: isCollapsed ? '0.5rem 0' : '0.5rem 0.5rem 0.75rem 0.5rem',
        justifyContent: isCollapsed ? 'center' : 'flex-start'
      }}>
        {/* Geometric B2P Glyph Logo */}
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 8L12 4L20 8L12 12L4 8Z" fill="#ffffff" fillOpacity="0.9" />
            <path d="M4 12L12 16L20 12" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16L12 20L20 16" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        {!isCollapsed && (
          <div className="logo-text" style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
              lineHeight: 1.1
            }}>
              B2P ONE
            </span>
            <span style={{
              fontSize: '0.625rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              lineHeight: 1.2
            }}>
              Portal & ERP
            </span>
          </div>
        )}
      </div>

      {/* Company Profile Switcher */}
      <div ref={profileDropdownRef} style={{ position: 'relative', marginBottom: '0.75rem', width: '100%' }}>
        <button
          type="button"
          onClick={() => setProfileDropdownOpen(prev => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'space-between',
            gap: '0.6rem',
            padding: isCollapsed ? '0.45rem 0' : '0.5rem 0.65rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            background: profileDropdownOpen ? 'var(--glass-bg-hover)' : 'var(--glass-bg-subtle)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s ease'
          }}
          title={isCollapsed ? (activeProfile?.name || 'Switch Company') : undefined}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
            {activeProfile?.logo_url ? (
              <img
                src={activeProfile.logo_url}
                alt={activeProfile.name}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '6px',
                  objectFit: 'contain',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                  flexShrink: 0
                }}
              />
            ) : (
              <div style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.75rem',
                flexShrink: 0
              }}>
                {activeProfile?.name?.charAt(0) || 'C'}
              </div>
            )}

            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                <span style={{
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {activeProfile?.name || 'Select Company'}
                </span>
                <span style={{
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  lineHeight: 1.2
                }}>
                  {activeProfile?.currency || 'INR'} • {profiles.length} Profiles
                </span>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <ChevronDown
              size={14}
              style={{
                color: 'var(--text-muted)',
                transform: profileDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
                flexShrink: 0
              }}
            />
          )}
        </button>

        {/* Profiles Dropdown Panel */}
        {profileDropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: isCollapsed ? '240px' : '100%',
            background: 'var(--bg-card)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.2), 0 4px 12px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            padding: '0.35rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}>
            <div style={{
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              padding: '0.35rem 0.6rem 0.2rem'
            }}>
              Company Profiles
            </div>

            {profiles.map(p => {
              const isSelected = p.id === activeProfile?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActiveProfile(p);
                    setProfileDropdownOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    padding: '0.5rem 0.6rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'var(--glass-bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
                    {p.logo_url ? (
                      <img
                        src={p.logo_url}
                        alt={p.name}
                        style={{ width: '22px', height: '22px', borderRadius: '5px', objectFit: 'contain', background: '#fff', flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '5px',
                        background: isSelected ? 'var(--brand-blue)' : '#94a3b8',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0
                      }}>
                        {p.name.charAt(0)}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{
                        fontSize: '0.8125rem',
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? 'var(--brand-blue)' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {p.name}
                      </span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        {p.currency || 'INR'}
                      </span>
                    </div>
                  </div>
                  {isSelected && <Check size={14} color="var(--brand-blue)" style={{ flexShrink: 0 }} />}
                </button>
              );
            })}

            <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.25rem 0' }} />

            <button
              type="button"
              onClick={() => {
                setProfileDropdownOpen(false);
                onAddProfileClick();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                padding: '0.5rem 0.6rem',
                borderRadius: '8px',
                border: 'none',
                background: 'transparent',
                color: '#2563eb',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Plus size={14} color="#2563eb" />
              <span>Add Company Profile</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Navigation List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        paddingRight: '0.15rem'
      }}>
        {navSections.map(sec => (
          <div key={sec.title} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {!isCollapsed && (
              <div style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: '#94a3b8',
                padding: '0.35rem 0.6rem 0.25rem 0.6rem',
                textTransform: 'uppercase'
              }}>
                {sec.title}
              </div>
            )}

            {sec.items.map(item => {
              const Icon = item.icon;
              const isActive = currentTab === item.id || 
                (item.id === 'documents' && (currentTab === 'documents_quotation' || currentTab === 'documents')) ||
                (item.id === 'invoices' && currentTab === 'documents_invoice');

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setCurrentTab(item.id);
                    if (window.innerWidth <= 640) onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isCollapsed ? 'center' : 'space-between',
                    padding: isCollapsed ? '0.6rem' : '0.5rem 0.75rem',
                    borderRadius: '10px',
                    border: isActive ? '1px solid rgba(255, 255, 255, 0.9)' : '1px solid transparent',
                    background: isActive ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                    boxShadow: isActive ? '0 4px 16px rgba(37, 99, 235, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04)' : 'none',
                    color: isActive ? 'var(--brand-blue)' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
                    width: '100%',
                    textAlign: 'left'
                  }}
                  title={isCollapsed ? item.label : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <Icon size={16} color={isActive ? 'var(--brand-blue)' : '#64748b'} strokeWidth={isActive ? 2.3 : 1.8} />
                    {!isCollapsed && <span className="nav-label">{item.label}</span>}
                  </div>

                  {!isCollapsed && item.badge !== undefined && (
                    <span style={{
                      background: isActive ? '#eff6ff' : 'rgba(241, 245, 249, 0.9)',
                      color: isActive ? 'var(--brand-blue)' : '#64748b',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      padding: '0.1rem 0.45rem',
                      borderRadius: '9999px',
                      border: '1px solid rgba(226, 232, 240, 0.6)'
                    }}>
                      {item.badge}
                    </span>
                  )}

                  {!isCollapsed && item.badgeText && (
                    <span style={{
                      background: 'rgba(241, 245, 249, 0.7)',
                      color: '#94a3b8',
                      fontSize: '0.625rem',
                      fontWeight: 600,
                      padding: '0.1rem 0.4rem',
                      borderRadius: '6px'
                    }}>
                      {item.badgeText}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* User Profile Card at Bottom */}
      <div style={{
        marginTop: 'auto',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        <div style={{
          background: 'var(--glass-bg-subtle)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isCollapsed ? '0.4rem' : '0.45rem 0.65rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
            {user?.user_metadata?.avatar_url ? (
              <img 
                src={user.user_metadata.avatar_url} 
                alt={user?.user_metadata?.full_name || user?.email || 'User'}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1.5px solid var(--border-color)',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                  flexShrink: 0
                }}
              />
            ) : (
              <div style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.8rem',
                border: '1.5px solid var(--border-color)',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                flexShrink: 0
              }}>
                {((user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'U').charAt(0)).toUpperCase()}
              </div>
            )}
            {!isCollapsed && (
              <div className="profile-details" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                <span style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Staff User')}
                </span>
                <span style={{
                  fontSize: '0.6875rem',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {user?.email || userRole}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Theme Switcher button */}
        {(onOpenThemeSelector || toggleTheme) && (
          <button
            onClick={onOpenThemeSelector || toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              gap: '0.6rem',
              padding: '0.45rem 0.65rem',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            title={isCollapsed ? 'Change Theme' : undefined}
          >
            {theme === 'light' ? (
              <Sun size={15} color="#f59e0b" />
            ) : theme === 'dark-amoled' ? (
              <Zap size={15} color="#38bdf8" />
            ) : theme === 'dark-mocha' ? (
              <Coffee size={15} color="#d97706" />
            ) : theme === 'dark-slate' ? (
              <Sparkles size={15} color="#818cf8" />
            ) : (
              <Moon size={15} color="#60a5fa" />
            )}
            {!isCollapsed && (
              <span>
                {theme === 'light'
                  ? 'Light Mode'
                  : theme === 'dark-amoled'
                  ? 'AMOLED Black'
                  : theme === 'dark-mocha'
                  ? 'Warm Mocha'
                  : theme === 'dark-slate'
                  ? 'Executive Slate'
                  : 'Obsidian Dark'}
              </span>
            )}
          </button>
        )}

        {/* Settings button */}
        <button
          onClick={() => {
            setCurrentTab('settings');
            if (window.innerWidth <= 640) onClose();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: '0.6rem',
            padding: '0.45rem 0.65rem',
            borderRadius: '8px',
            border: 'none',
            background: currentTab === 'settings' ? 'var(--glass-bg-elevated)' : 'transparent',
            color: currentTab === 'settings' ? 'var(--brand-blue)' : 'var(--text-secondary)',
            fontSize: '0.78rem',
            fontWeight: 500,
            cursor: 'pointer'
          }}
          title={isCollapsed ? 'Settings' : undefined}
        >
          <SettingsIcon size={15} color={currentTab === 'settings' ? 'var(--brand-blue)' : '#64748b'} />
          {!isCollapsed && <span>Settings</span>}
        </button>

        {/* Sign Out button */}
        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              gap: '0.6rem',
              padding: '0.45rem 0.65rem',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: '#ef4444',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            title={isCollapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={15} color="#ef4444" />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        )}

        {/* Desktop Collapse Toggle */}
        {onToggleCollapse && (
          <div style={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-end', paddingTop: '0.15rem' }}>
            <button
              onClick={onToggleCollapse}
              className="btn-ghost"
              style={{ padding: '0.25rem 0.45rem', fontSize: '0.72rem', color: '#94a3b8' }}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><ChevronLeft size={14} /> Collapse</span>}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
