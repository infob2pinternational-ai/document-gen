import type React from 'react';

/**
 * Shared text-input style for the mobile app's edit forms (Customers,
 * Services). Was previously an identical copy pasted into both screens.
 */
export const inputStyle: React.CSSProperties = {
  padding: '0.7rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '0.9rem'
};
