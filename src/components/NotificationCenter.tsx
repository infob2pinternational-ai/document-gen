import React, { useState, useEffect, useRef } from 'react';
import { officeService } from '../services/officeService';
import type { NotificationItem } from '../types';
import { Bell } from 'lucide-react';

interface NotificationCenterProps {
  onSelectNotification?: (targetType?: string, targetId?: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ onSelectNotification }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refreshNotifications = () => {
    setNotifications(officeService.getNotifications());
  };

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 15000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const handleMarkAllRead = () => {
    officeService.markAllNotificationsAsRead();
    refreshNotifications();
  };

  const handleItemClick = (n: NotificationItem) => {
    officeService.markNotificationAsRead(n.id);
    refreshNotifications();
    setIsOpen(false);
    if (onSelectNotification && n.target_type && n.target_id) {
      onSelectNotification(n.target_type, n.target_id);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="btn-secondary"
        style={{
          position: 'relative',
          padding: '0.45rem',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Office Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-2px',
            right: '-2px',
            background: '#ef4444',
            color: '#fff',
            fontSize: '0.65rem',
            fontWeight: 800,
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid var(--bg-card)'
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          className="animate-fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '360px',
            maxHeight: '440px',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.9)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-floating)',
            zIndex: 1200,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-color)',
            background: 'rgba(248, 250, 252, 0.8)'
          }}>
            <strong style={{ fontSize: '0.85rem' }}>Office Notifications</strong>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="btn-secondary"
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
            {notifications.length > 0 ? (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid var(--border-color)',
                    background: n.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.06)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.2rem',
                    borderLeft: n.is_read ? '3px solid transparent' : '3px solid var(--accent-primary)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{n.title}</strong>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                    {n.message}
                  </p>
                </div>
              ))
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                No notifications.
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
