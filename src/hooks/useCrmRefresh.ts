import { useEffect, useState } from 'react';
import { hydrateCrmFromCloud } from '../services/officeService';

export function useCrmRefresh(userId?: string, companyId?: string, enabled = false): string {
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !userId || !companyId) return;
    setError('');
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (disposed || refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        await hydrateCrmFromCloud(companyId, () => !disposed);
        if (!disposed) setError('');
      } catch (error) {
        console.error('CRM refresh failed:', error);
        if (!disposed) setError('CRM refresh failed. Displayed records may be out of date. Retrying automatically; check your connection.');
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, companyId, enabled]);
  return error;
}
