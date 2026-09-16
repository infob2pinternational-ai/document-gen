import React from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon, Zap, Coffee, Sparkles, Check, X } from 'lucide-react';
import { THEME_OPTIONS, type AppTheme } from '../types';

interface ThemeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: AppTheme;
  onSelectTheme: (theme: AppTheme) => void;
}

const THEME_ICONS: Record<AppTheme, React.ReactNode> = {
  light: <Sun size={18} color="#f59e0b" />,
  dark: <Moon size={18} color="#60a5fa" />,
  'dark-obsidian': <Moon size={18} color="#60a5fa" />,
  'dark-amoled': <Zap size={18} color="#38bdf8" />,
  'dark-mocha': <Coffee size={18} color="#d97706" />,
  'dark-slate': <Sparkles size={18} color="#818cf8" />
};

export const ThemeSelectorModal: React.FC<ThemeSelectorModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme
}) => {
  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      style={{ zIndex: 2000, animation: 'fadeIn 0.15s ease-out' }}
    >
      <div 
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '560px',
          width: '94%',
          padding: '1.5rem',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-floating)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Appearance & Theme
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Choose your preferred visual theme for B2P Document Portal.
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '0.35rem', borderRadius: '8px', cursor: 'pointer' }}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Theme Cards Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {THEME_OPTIONS.map((opt) => {
            const isSelected = currentTheme === opt.id || (currentTheme === ('dark' as any) && opt.id === 'dark-obsidian');
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onSelectTheme(opt.id);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '12px',
                  border: isSelected 
                    ? `2px solid ${opt.accentColor}` 
                    : '1px solid var(--border-color)',
                  background: isSelected ? 'var(--glass-bg-hover)' : 'var(--bg-card)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = opt.accentColor;
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                  {/* Theme Swatch Preview Box */}
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: opt.bgPreview,
                    border: '1.5px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    flexShrink: 0,
                    overflow: 'hidden'
                  }}>
                    {/* Inner mini card simulation */}
                    <div style={{
                      position: 'absolute',
                      bottom: '4px',
                      right: '4px',
                      width: '20px',
                      height: '14px',
                      borderRadius: '4px',
                      background: opt.cardPreview,
                      border: `1px solid ${opt.accentColor}`
                    }} />
                    {THEME_ICONS[opt.id]}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {opt.name}
                      </span>
                      {opt.id === 'dark-obsidian' && (
                        <span style={{
                          fontSize: '0.68rem',
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: '#60a5fa',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          Recommended
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                      {opt.description}
                    </p>
                  </div>
                </div>

                {/* Selection Radio / Checkmark */}
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: isSelected ? `2px solid ${opt.accentColor}` : '2px solid var(--border-color)',
                  background: isSelected ? opt.accentColor : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginLeft: '1rem',
                  transition: 'all 0.15s ease'
                }}>
                  {isSelected && <Check size={14} color="#ffffff" strokeWidth={3} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
